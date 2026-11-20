import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createApp, rateKey } from '../server.js';

async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-capacity-')), store = new Store();
  const app = createApp({ store, dataDir: dir, demo: true, baseUrl: 'http://localhost', env: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try { await fn({ base, store }); }
  finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('rate limits group an IPv6 subscriber by /64 and keep IPv4 exact', () => {
  assert.equal(rateKey('198.51.100.7'), '198.51.100.7');
  assert.equal(rateKey('2001:db8:1:2:aaaa::1'), '2001:0db8:0001:0002::/64');
  assert.equal(rateKey('2001:db8:1:2::ffff'), rateKey('2001:db8:1:2:dead:beef:0:1'));
  assert.notEqual(rateKey('2001:db8:1:2::1'), rateKey('2001:db8:1:3::1'));
  assert.equal(rateKey('::1'), '0000:0000:0000:0000::/64');
});

test('public API answers revalidate with 304 and reflect moderation immediately', async () => {
  await withApp(async ({ base, store }) => {
    const first = await fetch(`${base}/api/v1/cosmetics?limit=5`);
    const etag = first.headers.get('etag'), before = (await first.json()).cosmetics.length;
    assert.ok(etag);
    assert.equal((await fetch(`${base}/api/v1/cosmetics?limit=5`, { headers: { 'If-None-Match': etag } })).status, 304);
    // A moderation write invalidates the shared answer at once, not after the TTL.
    store.review(store.user('demo-owner'), 'demo-0', 'rejected', 'Policy check');
    const after = await fetch(`${base}/api/v1/cosmetics?limit=5`, { headers: { 'If-None-Match': etag } });
    assert.equal(after.status, 200);
    assert.ok((await after.json()).cosmetics.every(c => c.id !== 'demo-0'));
    assert.ok(before >= 1);
  });
});

test('only texture uploads may send multi-megabyte bodies', async () => {
  await withApp(async ({ base }) => {
    const big = JSON.stringify({ path: '/discover', pad: 'x'.repeat(200000) });
    const response = await fetch(`${base}/api/views`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: big });
    assert.equal(response.status, 413);
  });
});

test('sorted catalog pages agree with live counts and ignore banned likers', () => {
  const store = new Store(); store.seedDemo();
  try {
    const owner = store.user('demo-owner');
    store.setLike('demo-owner', 'demo-3', true); store.setLike('demo-mod', 'demo-3', true);
    let top = store.catalog({ listedOnly: true, sort: 'liked', limit: 1 })[0];
    assert.equal(top.id, 'demo-3'); assert.equal(top.like_count, 2);
    store.setBan(owner, 'demo-mod', true, 'Spam likes');
    store.setLike('demo-owner', 'demo-4', true); store.setLike('demo-creator', 'demo-4', true);
    top = store.catalog({ listedOnly: true, sort: 'liked', limit: 1 })[0];
    assert.equal(top.id, 'demo-4');
    assert.equal(store.getCosmetic('demo-3').like_count, 1, 'A banned account’s like no longer counts');
  } finally { store.close(); }
});
