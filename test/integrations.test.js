import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';
import { NameflareClient } from '../public/client.js';

async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-integrations-')), store = new Store();
  const app = createApp({ store, dataDir: dir, demo: true, baseUrl: 'http://localhost', env: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = async path => { const response = await fetch(base + path); return { status: response.status, body: await response.json() }; };
  try { await fn({ base, store, get }); }
  finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('API index advertises features, limits and timings for client feature detection', async () => {
  await withApp(async ({ get }) => {
    const { status, body } = await get('/api/v1');
    assert.equal(status, 200);
    assert.equal(body.version, 1);
    assert.deepEqual(Object.keys(body.features).sort(), ['batch', 'changes', 'lookup', 'resolve', 'stats', 'wearers']);
    assert.equal(body.limits.resolve_ids, 100);
    assert.ok(body.endpoints.includes('GET /api/v1/changes'));
  });
});

test('change feed reports equips and moderation, and resets on unknown epochs or cursors', async () => {
  await withApp(async ({ store, get }) => {
    const start = (await get('/api/v1/changes')).body;
    assert.equal(start.reset, true);
    const since = `/api/v1/changes?since=${start.cursor}&epoch=${start.epoch}`;
    assert.deepEqual((await get(since)).body.identities, [], 'No events, no changes');

    store.equip('demo-creator', 'demo-2');
    store.equip('demo-creator', 'demo-2'); // unchanged: no second event
    let feed = (await get(since)).body;
    assert.equal(feed.reset, false);
    assert.deepEqual(feed.identities, [{ provider: 'twitch', provider_id: '1002' }]);
    assert.equal(feed.cursor, start.cursor + 1);

    store.review(store.user('demo-owner'), 'demo-2', 'rejected', 'Policy check');
    feed = (await get(`/api/v1/changes?since=${feed.cursor}&epoch=${feed.epoch}`)).body;
    assert.deepEqual(feed.cosmetics, ['demo-2']);

    for (const query of [`since=${feed.cursor}&epoch=other`, `since=${feed.cursor + 50}&epoch=${feed.epoch}`, `since=-1&epoch=${feed.epoch}`, `since=abc&epoch=${feed.epoch}`])
      assert.equal((await get(`/api/v1/changes?${query}`)).body.reset, true, query);
  });
});

test('batch and exact-name lookup return approved Flares only', async () => {
  await withApp(async ({ store, get }) => {
    store.review(store.user('demo-owner'), 'demo-2', 'rejected', 'Policy check');
    const batch = (await get('/api/v1/cosmetics/batch?ids=demo-0,demo-2,missing,demo-0')).body;
    assert.deepEqual(batch.cosmetics.map(c => c.id), ['demo-0']);
    assert.equal((await get('/api/v1/cosmetics/batch?ids=')).status, 400);
    assert.equal((await get(`/api/v1/cosmetics/batch?ids=${Array.from({ length: 101 }, (_, i) => `x${i}`).join(',')}`)).status, 400);
    assert.deepEqual((await get('/api/v1/cosmetics/lookup?name=aurora%20DRIFT')).body.cosmetics.map(c => c.id), ['demo-0']);
    assert.deepEqual((await get('/api/v1/cosmetics/lookup?name=aurora')).body.cosmetics, [], 'Lookup is exact, not a search');
    assert.equal((await get('/api/v1/cosmetics/lookup?name=')).status, 400);
  });
});

test('identity resolution has its own budget, so a busy overlay is not throttled like writes', async () => {
  await withApp(async ({ base }) => {
    const resolve = () => fetch(`${base}/api/v1/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'twitch', ids: ['1002', '1002', '999'] }) });
    const statuses = [];
    for (let i = 0; i < 60; i++) statuses.push((await resolve()).status);
    assert.ok(statuses.every(status => status === 200), 'More than the 40/min write budget');
    const users = (await (await resolve()).json()).users;
    assert.equal(users.length, 1, 'Duplicate IDs resolve once; unknown IDs are omitted');
    assert.equal(users[0].cosmetic.id, 'demo-0');
    assert.equal(users[0].equipped, undefined, 'Internal fields stay private');
  });
});

const paint = { id: 'p1', name: 'Aurora', recipe: { colors: ['#ff1a35', '#ffffff'], animation: 'none', speed: 4, angle: 120, glow: 0 } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('SDK live mode keeps feed-covered results longer, applies events, and degrades when the feed fails', async () => {
  let time = 0, feed = { epoch: 'e1', cursor: 5, reset: true, identities: [], cosmetics: [], poll_ms: 4000 }, equipped = true, feedDown = false;
  const urls = [];
  const client = new NameflareClient({ live: true, batchDelay: 60000, now: () => time, fetchImpl: async (url, options) => {
    urls.push(url);
    if (url.includes('/api/v1/changes')) { if (feedDown) throw new Error('offline'); return Response.json(feed); }
    const { provider, ids } = JSON.parse(options.body);
    return Response.json({ users: equipped ? ids.map(id => ({ provider, provider_id: id, cosmetic: paint })) : [] });
  } });
  try {
    client.get('twitch', '1'); await sleep(10);
    assert.ok(urls[0].includes('/api/v1/changes?since=&epoch='));
    await client.flush();
    assert.equal(client.get('twitch', '1').id, 'p1');
    assert.equal(client.cache.get('twitch:1').expires, 90000, 'Covered by the feed: long expiry');

    // An unequip arrives as an event and is applied without waiting for expiry.
    equipped = false; feed = { epoch: 'e1', cursor: 6, reset: false, identities: [{ provider: 'twitch', provider_id: '1' }], cosmetics: [], poll_ms: 4000 };
    time = 3000; await client.pollFeed();
    assert.equal(client.pending.has('twitch:1'), true);
    await client.flush();
    assert.equal(client.get('twitch', '1'), null);

    // Feed loss: everything returns to the short, fail-closed timings.
    equipped = true; client.cache.get('twitch:1').refreshAt = 0; client.expire(); await client.flush();
    assert.equal(client.cache.get('twitch:1').expires, 93000);
    feedDown = true; time = 20000; await client.pollFeed();
    assert.ok(client.cache.get('twitch:1').expires <= 32000);
    assert.equal(client.feedBaseline, null);
  } finally { client.close(); }
});

test('SDK live mode switches itself off against servers without the feed', async () => {
  const client = new NameflareClient({ live: true, batchDelay: 60000, fetchImpl: async url => url.includes('/changes') ? Response.json({ error: 'Not found.' }, { status: 404 }) : Response.json({ users: [] }) });
  try { await client.pollFeed(); assert.equal(client.live, false); }
  finally { client.close(); }
});

test('SDK resolves chat-command names through exact lookup, falling back to search on older servers', async () => {
  for (const legacy of [false, true]) {
    const urls = [];
    const client = new NameflareClient({ fetchImpl: async url => {
      urls.push(url);
      if (url.includes('/lookup')) return legacy ? Response.json({ error: 'Approved cosmetic not found.' }, { status: 404 }) : Response.json({ cosmetics: [paint] });
      return Response.json({ cosmetics: [{ ...paint, name: 'Aurora (remix)', id: 'p2' }, paint] });
    } });
    try {
      assert.equal((await client.resolveCosmetic('aurora')).id, 'p1');
      assert.match(urls[0], /\/api\/v1\/cosmetics\/lookup\?name=aurora$/);
      assert.equal(urls.length, legacy ? 2 : 1);
    } finally { client.close(); }
  }
});

test('statistics and listing endpoints: site stats, wearers, Flare and profile stats, linked accounts, lookups by platform ID', async () => {
  await withApp(async ({ store, get }) => {
    store.equip('demo-mod', 'demo-0'); store.setLike('demo-mod', 'demo-0', true); store.setFollow('demo-mod', 'demo-creator', true);
    const stats = (await get('/api/v1/stats')).body;
    assert.equal(stats.accounts, 3); assert.equal(stats.wearing_now, 2); assert.equal(stats.linked_accounts.twitch, 3);
    assert.equal(stats.most_worn[0].id, 'demo-0'); assert.equal(stats.most_worn[0].wearers, 2);
    const wearers = (await get('/api/v1/cosmetics/demo-0/wearers')).body;
    assert.equal(wearers.total, 2); assert.deepEqual(wearers.users.map(user => user.name).sort(), ['lumi', 'nova']);
    assert.equal(wearers.users[0].identities[0].provider, 'twitch');
    const flare = (await get('/api/v1/cosmetics/demo-0/stats')).body.stats;
    assert.equal(flare.wearers, 2); assert.equal(flare.likes, 1); assert.equal(flare.series.likes.length, 30);
    const profile = (await get('/api/v1/profiles/demo-creator/stats')).body.stats;
    assert.equal(profile.followers, 1); assert.equal(profile.wearing, 'demo-0');
    const accounts = (await get('/api/v1/profiles/demo-creator/accounts')).body.accounts;
    assert.deepEqual(accounts.map(a => [a.provider, a.provider_id, a.url]), [['twitch', '1002', 'https://www.twitch.tv/lumi']]);
    assert.equal((await get('/api/v1/users/twitch/1002/profile')).body.user.id, 'demo-creator');
    assert.ok((await get('/api/v1/users/twitch/1002/cosmetics')).body.cosmetics.every(c => c.creator_id === 'demo-creator'));
    const list = (await get('/api/v1/profiles?sort=newest')).body;
    assert.equal(list.total, 3);
    store.setBan(store.user('demo-owner'), 'demo-mod', true, 'Spam');
    assert.equal((await get('/api/v1/users/twitch/1003/profile')).status, 404, 'Banned accounts are not listed');
    assert.equal((await get('/api/v1/cosmetics/missing/wearers')).status, 404);
  });
});
