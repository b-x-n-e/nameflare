import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createEdge } from '../lib/edge.js';
import { createApp } from '../server.js';

const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const recipe = textureId => ({ colors:['#71f5bd','#b798ff'], animation:'flow', speed:4, angle:120, glow:5, textureId });
const ZONE = 'a'.repeat(32);
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('edge settings: off by default, both credentials or neither, bounded lifetimes', () => {
  const off = createEdge({ env:{}, baseUrl:'https://nameflare.example' });
  assert.equal(off.enabled, false); assert.equal(off.textureHeader, null); assert.equal(off.feedHeader, null);
  assert.throws(() => createEdge({ env:{ CLOUDFLARE_ZONE_ID:ZONE }, baseUrl:'https://n.example' }), /both/);
  assert.throws(() => createEdge({ env:{ CLOUDFLARE_PURGE_TOKEN:'t' }, baseUrl:'https://n.example' }), /both/);
  assert.throws(() => createEdge({ env:{ CLOUDFLARE_ZONE_ID:'nope', CLOUDFLARE_PURGE_TOKEN:'t' }, baseUrl:'https://n.example' }), /zone ID/);
  const on = createEdge({ env:{ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'t' }, baseUrl:'https://n.example' });
  assert.equal(on.textureHeader, 'public, max-age=86400'); assert.equal(on.feedHeader, 'public, max-age=2'); on.close();
  const tuned = createEdge({ env:{ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'t', EDGE_TEXTURE_TTL:'31536000', EDGE_FEED_TTL:'0' }, baseUrl:'https://n.example' });
  assert.equal(tuned.textureHeader, 'public, max-age=31536000'); assert.equal(tuned.feedHeader, null); tuned.close();
  for (const bad of ['59', '31536001', '1.5', 'x']) assert.throws(() => createEdge({ env:{ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'t', EDGE_TEXTURE_TTL:bad }, baseUrl:'https://n.example' }), /integer/);
  assert.throws(() => createEdge({ env:{ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'t', EDGE_FEED_TTL:'11' }, baseUrl:'https://n.example' }), /integer/);
});

test('purge batches 30 URLs, retries failures, repeats once, and never logs the token', async () => {
  const calls = [], scheduled = [], errors = [];
  let fail = 4;
  const edge = createEdge({
    env:{ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'secret-token' }, baseUrl:'https://n.example/',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return fail-- > 0 ? new Response('{"success":false}', { status:500 }) : Response.json({ success:true }); },
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; },
    log:{ error: message => errors.push(message) }
  });
  const ids = Array.from({ length:31 }, (_, i) => `${String(i).padStart(64, '0')}.gif`);
  edge.purge(ids); await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].options.body).files, ids.slice(0, 30).map(id => `https://n.example/textures/${id}`));
  assert.equal(JSON.parse(calls[1].options.body).files.length, 1);
  // Two 30s repeats, plus a 1s retry for each failed first attempt.
  assert.deepEqual(scheduled.map(s => s.ms).sort((a, b) => a - b), [1000, 1000, 30000, 30000]);
  // Drive the first batch's retries to exhaustion: 1s, 5s, then 30s.
  let retry = scheduled.find(s => s.ms === 1000); scheduled.splice(scheduled.indexOf(retry), 1); retry.fn(); await settle();
  retry = scheduled.find(s => s.ms === 5000); scheduled.splice(scheduled.indexOf(retry), 1); fail = 10; retry.fn(); await settle();
  retry = scheduled.findLast(s => s.ms === 30000); scheduled.splice(scheduled.indexOf(retry), 1); retry.fn(); await settle();
  assert.equal(errors.length, 1); assert.match(errors[0], /after 4 attempts/); assert.doesNotMatch(errors[0], /secret-token/);
  edge.close(); const before = calls.length; edge.purge(ids); await settle(); assert.equal(calls.length, before);
});

async function harness(env, edgeFetch) {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-edge-'));
  const store = new Store(); store.seedDemo();
  store.db.prepare("UPDATE cosmetics SET owner_id='demo-owner' WHERE owner_id='demo-creator'").run();
  const app = createApp({ store, dataDir:dir, baseUrl:'http://localhost', env, edgeFetch });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessions = { creator:store.newSession('demo-creator'), mod:store.newSession('demo-mod') };
  const call = (path, data, role) => {
    const headers = {};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (role) { headers.Cookie = `nameflare_session=${sessions[role].raw}`; headers['X-CSRF-Token'] = sessions[role].csrf; headers.Origin = 'http://localhost'; }
    return fetch(base + path, { method:data === undefined ? 'GET' : 'POST', headers, body:data === undefined ? undefined : JSON.stringify(data) });
  };
  const close = () => new Promise(resolve => app.server.close(() => { rmSync(dir, { recursive:true, force:true }); resolve(); }));
  return { store, call, close };
}
async function publishedFlare(call, name) {
  const upload = await call('/api/textures', { data:gif }, 'creator'); assert.equal(upload.status, 201);
  const textureId = (await upload.json()).id;
  const submit = await call('/api/cosmetics', { name, description:'', recipe:recipe(textureId) }, 'creator'); assert.equal(submit.status, 201);
  return { textureId, id:(await submit.json()).cosmetic.id };
}

test('without purge credentials nothing extra is cached at the edge', async () => {
  const { call, close } = await harness({});
  try {
    const { textureId, id } = await publishedFlare(call, 'Plain edge');
    assert.equal((await call('/api/admin/review', { id, status:'approved', reason:'' }, 'mod')).status, 200);
    const texture = await call(`/textures/${textureId}`);
    assert.equal(texture.status, 200); assert.equal(texture.headers.get('Cache-Control'), 'public, max-age=15, must-revalidate');
    assert.equal(texture.headers.get('Cloudflare-CDN-Cache-Control'), null);
    assert.equal(texture.headers.get('X-Accel-Expires'), '5', 'nginx micro-cache window');
    const feed = await call('/api/v1/changes?since=&epoch=');
    assert.equal(feed.headers.get('Cloudflare-CDN-Cache-Control'), null); assert.equal(feed.headers.get('X-Accel-Expires'), '2');
    assert.equal((await call(`/textures/${textureId}`, undefined, 'creator')).headers.get('X-Accel-Expires'), '5');
    assert.equal((await call('/api/admin/review', { id, status:'rejected', reason:'Rights' }, 'mod')).status, 200);
    const revoked = await call(`/textures/${textureId}`);
    assert.equal(revoked.status, 401); assert.equal(revoked.headers.get('X-Accel-Expires'), null, 'errors are never micro-cached');
  } finally { await close(); }
});

test('with purge credentials: approved textures and the feed are edge-cached, revoked or deleted images are purged', async () => {
  const purged = [];
  const edgeFetch = async (url, options) => { purged.push(...JSON.parse(options.body).files); return Response.json({ success:true }); };
  const { store, call, close } = await harness({ CLOUDFLARE_ZONE_ID:ZONE, CLOUDFLARE_PURGE_TOKEN:'t' }, edgeFetch);
  try {
    const first = await publishedFlare(call, 'Edge one');
    // Pending: private to its creator and never edge-cached.
    const pending = await call(`/textures/${first.textureId}`, undefined, 'creator');
    assert.equal(pending.headers.get('Cache-Control'), 'private, no-store'); assert.equal(pending.headers.get('X-Accel-Expires'), null); assert.equal(pending.headers.get('Cloudflare-CDN-Cache-Control'), null);
    assert.equal((await call('/api/admin/review', { id:first.id, status:'approved', reason:'' }, 'mod')).status, 200);
    await settle(); assert.deepEqual(purged, [], 'approval purges nothing');
    const texture = await call(`/textures/${first.textureId}`);
    assert.equal(texture.headers.get('Cache-Control'), 'public, max-age=15, must-revalidate', 'browsers keep the short window');
    assert.equal(texture.headers.get('Cloudflare-CDN-Cache-Control'), 'public, max-age=86400');
    const feed = await call('/api/v1/changes?since=&epoch=');
    assert.equal(feed.headers.get('Cache-Control'), 'no-store'); assert.equal(feed.headers.get('Cloudflare-CDN-Cache-Control'), 'public, max-age=2');

    assert.equal((await call('/api/admin/review', { id:first.id, status:'rejected', reason:'Rights' }, 'mod')).status, 200);
    await settle(); assert.deepEqual(purged, [`http://localhost/textures/${first.textureId}`]);

    // A creator deleting an approved Flare: the recipe is gone, the event still names the image.
    const second = await publishedFlare(call, 'Edge two');
    store.review(store.user('demo-mod'), second.id, 'approved', '');
    await settle(); purged.length = 0;
    assert.equal((await call('/api/cosmetics/delete', { id:second.id, confirm:true }, 'creator')).status, 200);
    await settle(); assert.deepEqual(purged, [`http://localhost/textures/${second.textureId}`]);

    // An image another approved Flare still uses stays on the edge.
    purged.length = 0;
    const shared = await publishedFlare(call, 'Edge three');
    const twin = store.submit('demo-owner', 'Edge twin', '', recipe(shared.textureId));
    assert.equal(twin.status, 'approved');
    store.review(store.user('demo-mod'), shared.id, 'approved', '');
    store.review(store.user('demo-mod'), shared.id, 'rejected', 'Duplicate');
    await settle(); assert.deepEqual(purged, []);
  } finally { await close(); }
});
