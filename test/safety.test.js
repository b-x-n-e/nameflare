// Upload sanitizing and scanning, abuse reports, account export/deletion,
// retention and relay rooms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { Store, RETENTION } from '../lib/store.js';
import { createApp } from '../server.js';
import { sanitizeImage, decodePng, lzwDecode, lzwEncode, ImageError } from '../lib/images.js';

const recipe = { colors:['#ff1a35','#ffffff'], animation:'none', speed:4, angle:120, glow:0 };
const gifWithExtras = Buffer.from('R0lGODlhBgAEAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh/gZzZWNyZXQAIfkEAAcAAAAsAAAAAAYABAAACAsAAQgcSLCgwYEBAQAh+QQBBwABACwAAAAABgAEAIEA/wAAAAAAAAAAAAAICwABCBxIsKDBgQEBADs8P3BocA==', 'base64');
const webpWithExif = Buffer.from('UklGRkAAAABXRUJQVlA4WAoAAAAYAAAAAwAAAgAAVlA4TA8AAAAvA4AAEAcQ/Y8CBiKi/wEARVhJRgoAAABNTQAqAAAACAAA', 'base64');

function pngChunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0);
  return Buffer.concat([head, data, tail]);
}
// An RGBA PNG with a text chunk (say, GPS from a phone) and a script after IEND.
function pngWithExtras(width = 5, height = 4, { idat } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) rows[y * (1 + width * 4) + 1 + x] = (x * 37 + y * 11) & 255;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('tEXt', Buffer.from('GPS\0 51.5007,-0.1246')), pngChunk('IDAT', idat || deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)), Buffer.from('<script>alert(1)</script>')]);
}

test('PNG uploads are decoded and rebuilt: same pixels, no metadata, no trailing bytes', () => {
  const input = pngWithExtras(), result = sanitizeImage('png', input);
  assert.deepEqual(result.dropped.sort(), ['tEXt', 'trailing data']);
  assert.equal(result.bytes.includes(Buffer.from('GPS')), false);
  assert.equal(result.bytes.includes(Buffer.from('<script>')), false);
  assert.deepEqual(decodePng(result.bytes).raw, decodePng(input).raw);
  assert.deepEqual(sanitizeImage('png', result.bytes).bytes, result.bytes, 'Rebuilding is stable');
});

test('decompression bombs and broken files are refused', () => {
  // The header says 5×4; the data inflates to 4 MB of zeros.
  assert.throws(() => sanitizeImage('png', pngWithExtras(5, 4, { idat:deflateSync(Buffer.alloc(4 * 1024 * 1024)) })), ImageError);
  assert.throws(() => sanitizeImage('png', pngWithExtras().subarray(0, 40)), ImageError);
  assert.throws(() => sanitizeImage('gif', Buffer.from('GIF89a')), ImageError);
  assert.throws(() => sanitizeImage('webp', Buffer.from('RIFF\x10\0\0\0WEBPVP8 ')), ImageError);
  const huge = Buffer.from(gifWithExtras); huge.writeUInt16LE(4000, 6);
  assert.throws(() => sanitizeImage('gif', huge), /2048/);
});

test('GIF frames are LZW-decoded and re-encoded with timing and loop kept, extras dropped', () => {
  const result = sanitizeImage('gif', gifWithExtras);
  assert.equal(result.frames, 2);
  assert.deepEqual(result.dropped.sort(), ['comments', 'trailing data']);
  assert.equal(result.bytes.includes(Buffer.from('secret')), false);
  assert.ok(result.bytes.includes(Buffer.from('NETSCAPE2.0')), 'Loop count survives');
  for (const minCode of [2, 3, 5, 8]) {
    const pixels = Uint8Array.from({ length:5000 }, (_, i) => (i * 7 + (i >> 5)) % (1 << minCode));
    assert.deepEqual(lzwDecode(lzwEncode(pixels, minCode), minCode, pixels.length), pixels, `round trip at ${minCode} bits`);
  }
});

test('WebP containers are rebuilt without EXIF', () => {
  const result = sanitizeImage('webp', webpWithExif);
  assert.deepEqual(result.dropped, ['EXIF']);
  assert.equal(result.bytes.includes(Buffer.from('EXIF')), false);
  assert.equal(result.bytes.readUInt32LE(4) + 8, result.bytes.length, 'RIFF size matches');
});

// ---------------------------------------------------------------- HTTP helpers
async function withApp(env, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-safety-')), store = new Store(join(dir, 'db.sqlite'));
  store.seedDemo();
  // The demo creator already holds three Flares; the artist cap leaves room for test submissions.
  store.db.prepare("UPDATE users SET role='artist' WHERE id='demo-creator'").run();
  const app = createApp({ store, dataDir:dir, baseUrl:'http://localhost', env });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessions = { owner:store.newSession('demo-owner'), creator:store.newSession('demo-creator'), mod:store.newSession('demo-mod') };
  const call = async (path, data, session, extra = {}) => {
    const response = await fetch(base + path, { method:data === undefined ? 'GET' : 'POST', headers:{ ...(data === undefined ? {} : { 'Content-Type':'application/json', Origin:'http://localhost' }), ...(session ? { Cookie:`nameflare_session=${session.raw}`, 'X-CSRF-Token':session.csrf } : {}), ...extra }, body:data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status:response.status, body, headers:response.headers };
  };
  const upload = (bytes, type, session = sessions.creator) => call('/api/textures', { data:`data:image/${type};base64,${bytes.toString('base64')}` }, session);
  try { await fn({ app, store, dir, base, call, upload, sessions }); }
  finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(dir, { recursive:true, force:true }); }
}
// A stand-in for clamd that speaks INSTREAM and flags files containing "EICAR".
async function fakeClamd(dir) {
  const path = join(dir, 'clamd.sock'), seen = [];
  const server = createNetServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 10) return;
      let pos = 10; const parts = [];
      while (pos + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(pos);
        if (!size) { const file = Buffer.concat(parts); seen.push(file); socket.end(file.includes(Buffer.from('EICAR')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); return; }
        if (pos + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(pos + 4, pos + 4 + size)); pos += 4 + size;
      }
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  return { path, seen, close:() => new Promise(resolve => server.close(resolve)) };
}

test('uploads store the rebuilt file under its own hash and report what was removed', async () => {
  await withApp({}, async ({ upload, dir, store }) => {
    const response = await upload(pngWithExtras(), 'png');
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.removed.sort(), ['tEXt', 'trailing data']);
    const stored = readFileSync(join(dir, 'textures', response.body.id));
    assert.equal(stored.includes(Buffer.from('GPS')), false);
    const row = store.db.prepare('SELECT scan, source_hash, created_at FROM textures WHERE id=?').get(response.body.id);
    assert.equal(row.scan, 'unscanned'); assert.match(row.source_hash, /^[a-f0-9]{64}$/); assert.ok(row.created_at);
    assert.equal((await upload(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;garbage'), 'gif')).status, 400);
  });
});

test('clamd scanning rejects malware, audits it, and fails closed or to review when down', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'nameflare-clamd-')), clamd = await fakeClamd(scratch);
  try {
    await withApp({ CLAMD_SOCKET:clamd.path }, async ({ upload, store }) => {
      const clean = await upload(pngWithExtras(), 'png');
      assert.equal(clean.status, 201);
      assert.equal(store.db.prepare('SELECT scan FROM textures WHERE id=?').get(clean.body.id).scan, 'clean');
      assert.ok(clamd.seen[0].includes(Buffer.from('<script>')), 'clamd sees the original upload');
      const infected = Buffer.concat([pngWithExtras(6, 4), Buffer.from('EICAR')]);
      const blocked = await upload(infected, 'png');
      assert.equal(blocked.status, 422);
      assert.ok(store.auditLog().some(entry => entry.action === 'upload.blocked' && entry.detail === 'Eicar-Test-Signature'));
    });
    await withApp({ CLAMD_SOCKET:join(scratch, 'missing.sock') }, async ({ upload }) => {
      assert.equal((await upload(pngWithExtras(), 'png')).status, 503, 'Fails closed by default');
    });
    await withApp({ CLAMD_SOCKET:join(scratch, 'missing.sock'), SCAN_FAIL_MODE:'review' }, async ({ upload, store }) => {
      const response = await upload(pngWithExtras(), 'png');
      assert.equal(response.status, 201); assert.equal(response.body.needs_review, true);
      store.submit('demo-creator', 'Flagged image', '', { ...recipe, layers:[{ type:'image', textureId:response.body.id }] });
      const queued = store.moderationCatalog({ status:'pending' }).find(item => item.name === 'Flagged image');
      assert.deepEqual(queued.media_flags, [response.body.id], 'Reviewers see the scanner flag');
    });
  } finally { await clamd.close(); rmSync(scratch, { recursive:true, force:true }); }
});

test('a content classifier can allow, flag, or block the rebuilt image', async () => {
  let verdict = 'allow';
  const classifier = createHttpServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type':'application/json' }); res.end(JSON.stringify({ verdict, reason:'test' })); }); });
  await new Promise(resolve => classifier.listen(0, '127.0.0.1', resolve));
  try {
    await withApp({ CONTENT_SCAN_URL:`http://127.0.0.1:${classifier.address().port}/scan` }, async ({ upload }) => {
      assert.equal((await upload(pngWithExtras(5, 4), 'png')).status, 201);
      verdict = 'review'; assert.equal((await upload(pngWithExtras(6, 4), 'png')).body.needs_review, true);
      verdict = 'block'; assert.equal((await upload(pngWithExtras(7, 4), 'png')).status, 422);
    });
  } finally { classifier.close(); }
});

test('abuse reports: filing, grouping, and acting on a Flare, including blocking its images', async () => {
  await withApp({}, async ({ call, upload, store, sessions }) => {
    const image = (await upload(pngWithExtras(), 'png')).body.id;
    const flare = store.submit('demo-owner', 'Reported Flare', '', { ...recipe, layers:[{ type:'image', textureId:image }] });
    store.db.prepare('UPDATE textures SET owner_id=? WHERE id=?').run('demo-owner', image);
    const report = data => call('/api/reports', data, sessions.creator);
    assert.equal((await report({ target_type:'cosmetic', target_id:flare.id, reason:'nope' })).status, 400);
    assert.equal((await report({ target_type:'cosmetic', target_id:'demo-0', reason:'spam' })).status, 400, 'Not your own Flare');
    assert.equal((await report({ target_type:'cosmetic', target_id:flare.id, reason:'rights', details:'This is my art.' })).status, 201);
    assert.equal((await report({ target_type:'cosmetic', target_id:flare.id, reason:'rights', details:'Updated details' })).body.report.updated, true, 'One open report per person');
    assert.equal((await call('/api/reports', { target_type:'cosmetic', target_id:flare.id, reason:'hate' }, sessions.mod)).status, 201);
    assert.equal((await call('/api/admin/reports', undefined, sessions.creator)).status, 403);
    const queue = (await call('/api/admin/reports', undefined, sessions.mod)).body;
    assert.equal(queue.open, 1); assert.equal(queue.groups[0].reports, 2); assert.equal(queue.groups[0].target.name, 'Reported Flare');
    assert.equal(queue.groups[0].items.find(item => item.reason === 'rights').details, 'Updated details');
    const resolved = await call('/api/admin/reports/resolve', { target_type:'cosmetic', target_id:flare.id, action:'remove', note:'Artwork belongs to someone else', block_images:true }, sessions.mod);
    assert.equal(resolved.status, 200); assert.equal(resolved.body.resolved, 2);
    assert.equal(store.getCosmetic(flare.id).status, 'rejected');
    assert.equal((await call('/api/admin/reports', undefined, sessions.mod)).body.open, 0);
    assert.ok(store.auditLog().some(entry => entry.action === 'report.actioned'));
    assert.ok(store.auditLog().some(entry => entry.action === 'media.blocked'));
    // The same picture cannot come back, under any account.
    assert.equal((await upload(pngWithExtras(), 'png', sessions.mod)).status, 422);
    const closed = (await call('/api/admin/reports?status=closed', undefined, sessions.mod)).body.groups[0];
    assert.equal(closed.items[0].status, 'actioned'); assert.equal(closed.items[0].resolver, 'nova');
  });
});

test('reports against a profile can be dismissed or end in a ban; moderators cannot ban moderators', async () => {
  await withApp({}, async ({ call, store, sessions }) => {
    assert.equal((await call('/api/reports', { target_type:'user', target_id:'demo-creator', reason:'creator', details:'' }, sessions.mod)).status, 400);
    assert.equal((await call('/api/reports', { target_type:'user', target_id:'demo-creator', reason:'harassment' }, sessions.mod)).status, 201);
    assert.equal((await call('/api/admin/reports/resolve', { target_type:'user', target_id:'demo-creator', action:'dismiss' }, sessions.mod)).status, 200);
    assert.equal((await call('/api/reports', { target_type:'user', target_id:'demo-mod', reason:'spam' }, sessions.creator)).status, 201);
    assert.equal((await call('/api/admin/reports/resolve', { target_type:'user', target_id:'demo-mod', action:'ban', note:'Spam' }, sessions.mod)).status, 403);
    assert.equal(store.openReportCount(), 1, 'A refused action leaves the report open');
    assert.equal((await call('/api/admin/reports/resolve', { target_type:'user', target_id:'demo-mod', action:'ban', note:'Spam links' }, sessions.owner)).status, 200);
    assert.ok(store.user('demo-mod').banned_at);
  });
});

test('people can export their data and delete their account; banned identities stay banned', async () => {
  await withApp({}, async ({ call, upload, store, dir, sessions }) => {
    const image = (await upload(pngWithExtras(), 'png')).body.id;
    const own = store.submit('demo-creator', 'Mine', '', { ...recipe, layers:[{ type:'image', textureId:image }] });
    store.review(store.user('demo-owner'), own.id, 'approved', '');
    store.equip('demo-owner', own.id); store.setLike('demo-owner', own.id, true); store.setLike('demo-creator', 'demo-1', true);
    store.setFollow('demo-creator', 'demo-mod', true);
    await call('/api/reports', { target_type:'cosmetic', target_id:'demo-1', reason:'spam' }, sessions.creator);
    const exported = await call('/api/account/export', undefined, sessions.creator);
    assert.equal(exported.status, 200); assert.match(exported.headers.get('content-disposition'), /attachment/);
    assert.equal(exported.body.account.id, 'demo-creator');
    assert.ok(exported.body.flares.some(flare => flare.id === own.id));
    assert.deepEqual(exported.body.likes.map(like => like.cosmetic_id), ['demo-1']);
    assert.equal(exported.body.reports_filed.length, 1);
    assert.equal(JSON.stringify(exported.body).includes(sessions.creator.raw), false, 'No session secrets');

    assert.equal((await call('/api/account/delete', { confirm:'not my name' }, sessions.creator)).status, 400);
    const deleted = await call('/api/account/delete', { confirm:'lumi' }, sessions.creator);
    assert.equal(deleted.status, 200); assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(store.user('demo-creator'), undefined);
    assert.equal(store.resolve('twitch', '1002'), null);
    assert.equal(store.getCosmetic(own.id), null);
    assert.equal(store.user('demo-owner').equipped, null, 'Wearers are unequipped');
    assert.equal(existsSync(join(dir, 'textures', image)), false);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM cosmetic_likes WHERE user_id='demo-creator'").get().n, 0);
    assert.equal(store.db.prepare('SELECT reporter_id FROM reports').get().reporter_id, null, 'Reports they filed become anonymous');
    assert.ok(store.auditLog().some(entry => entry.action === 'account.deleted' && entry.actor === 'Deleted account'));
    assert.equal((await call('/api/me', undefined, sessions.creator)).body.user, null);

    // Owner-side erasure of a banned account keeps the ban on its identities.
    store.setBan(store.user('demo-owner'), 'demo-mod', true, 'Abuse');
    assert.equal((await call('/api/admin/accounts/delete', { id:'demo-mod', confirm:true }, sessions.mod)).status, 401, 'Banned sessions are gone');
    assert.equal((await call('/api/admin/accounts/delete', { id:'demo-mod', confirm:true }, sessions.owner)).status, 200);
    assert.throws(() => store.linkIdentity({ provider:'twitch', id:'1003', login:'nova', name:'nova' }), /banned/);
    assert.ok(store.linkIdentity({ provider:'twitch', id:'5555', login:'fresh', name:'fresh' }));
    assert.throws(() => store.deleteAccount('demo-owner'), /owner/);
  });
});

test('retention removes old records and abandoned uploads, and keeps recent ones', async () => {
  await withApp({}, async ({ app, store, dir, upload }) => {
    const old = new Date(Date.now() - 800 * 86400000).toISOString();
    store.db.prepare("INSERT INTO notifications (user_id,actor_id,kind,created_at) VALUES ('demo-creator','demo-owner','like',?)").run(old);
    store.db.prepare("INSERT INTO page_views (day,path,count) VALUES (?, '/discover', 3)").run(old.slice(0,10));
    store.audit('demo-owner', 'cosmetic.approved', 'x', 'old'); store.db.prepare("UPDATE audit SET created_at=? WHERE detail='old'").run(old);
    const rejected = store.submit('demo-creator', 'Old rejection', '', recipe);
    store.db.prepare("UPDATE cosmetics SET status='rejected', reviewed_at=? WHERE id=?").run(old, rejected.id);
    const orphan = (await upload(pngWithExtras(), 'png')).body.id, fresh = (await upload(pngWithExtras(6, 4), 'png')).body.id;
    store.db.prepare('UPDATE textures SET created_at=? WHERE id=?').run(old, orphan);
    writeFileSync(join(dir, 'textures', `${'a'.repeat(64)}.png`), 'stray');
    const result = app.maintenance();
    assert.equal(result.notifications, 1); assert.equal(result.page_views, 1); assert.equal(result.audit, 1); assert.equal(result.rejected_flares, 1);
    assert.equal(store.getCosmetic(rejected.id), null);
    assert.equal(existsSync(join(dir, 'textures', orphan)), false);
    assert.ok(existsSync(join(dir, 'textures', fresh)), 'Uploads inside the grace period stay');
    assert.ok(existsSync(join(dir, 'textures', `${'a'.repeat(64)}.png`)), 'Unknown files get a day of grace');
    assert.ok(store.getCosmetic('demo-pending'), 'Pending Flares are never touched');
    assert.equal(RETENTION.orphan_texture_days, 7);
  });
});

async function events(base, query) {
  const controller = new AbortController(), response = await fetch(`${base}/api/overlay/events?${query}`, { signal:controller.signal });
  if (response.status !== 200) { controller.abort(); return { status:response.status }; }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', pending = null;
  return {
    status:200,
    // Reads until one message arrives or `ms` passes. A read still waiting at
    // the deadline is kept for the next call, so no chunk is lost.
    async next(ms = 1500) {
      const deadline = Date.now() + ms;
      while (!/data: .*\n\n/.test(text) && Date.now() < deadline) {
        pending ||= reader.read();
        const chunk = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('timeout'), deadline - Date.now()))]);
        if (chunk === 'timeout') break;
        pending = null;
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      const match = /data: (.*)\n\n/.exec(text);
      if (match) text = text.slice(match.index + match[0].length);
      return match ? JSON.parse(match[1]) : null;
    },
    close() { controller.abort(); }
  };
}

test('relay rooms keep each stream setup separate and rotate their keys', async () => {
  await withApp({ OVERLAY_ROOM_KEY:'legacy-room-key-123', OVERLAY_INGEST_TOKEN:'legacy-ingest-token' }, async ({ call, base, sessions }) => {
    const a = (await call('/api/overlay/rooms', { name:'Main stream' }, sessions.creator)).body;
    const b = (await call('/api/overlay/rooms', { name:'Second' }, sessions.mod)).body;
    assert.match(a.ingest_token, /^nfr_/);
    const send = (token, text) => fetch(`${base}/api/overlay/messages`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({ provider:'kick', provider_id:'7', name:'viewer', text }) });
    assert.equal((await events(base, `room=${a.room.id}&key=wrong`)).status, 403);
    const listenA = await events(base, `room=${a.room.id}&key=${a.read_key}`), listenB = await events(base, `room=${b.room.id}&key=${b.read_key}`), legacy = await events(base, 'room=legacy-room-key-123');
    try {
      assert.equal((await send(a.ingest_token, 'for A')).status, 202);
      assert.equal((await listenA.next()).text, 'for A');
      assert.equal(await listenB.next(300), null, 'Other rooms hear nothing');
      assert.equal(await legacy.next(300), null);
      assert.equal((await send('legacy-ingest-token', 'for legacy')).status, 202);
      assert.equal((await legacy.next()).text, 'for legacy');
      assert.equal((await send('nfr_wrong', 'x')).status, 401);
      const listed = (await call('/api/overlay/rooms', undefined, sessions.creator)).body.rooms;
      assert.deepEqual(listed.map(room => [room.name, room.listeners]), [['Main stream', 1]]);
      assert.equal(JSON.stringify(listed).includes(a.read_key), false, 'Keys are shown once');
      const rotated = (await call('/api/overlay/rooms/rotate', { id:a.room.id }, sessions.creator)).body;
      assert.equal((await send(a.ingest_token, 'old token')).status, 401);
      assert.equal((await events(base, `room=${a.room.id}&key=${a.read_key}`)).status, 403);
      assert.equal((await send(rotated.ingest_token, 'new token')).status, 202);
      assert.equal((await call('/api/overlay/rooms/delete', { id:a.room.id }, sessions.mod)).status, 404, 'Only the owner can delete a room');
      for (const name of ['2', '3']) assert.equal((await call('/api/overlay/rooms', { name }, sessions.creator)).status, 201);
      assert.equal((await call('/api/overlay/rooms', { name:'4' }, sessions.creator)).status, 429);
    } finally { listenA.close(); listenB.close(); legacy.close(); }
  });
});

test('JPEG uploads are decoded, turned upright from EXIF, and re-encoded without metadata; BMP becomes PNG', async () => {
  const { createRequire } = await import('node:module');
  const encode = createRequire(import.meta.url)('../lib/vendor/jpeg-js/encoder.cjs');
  const width = 6, height = 4, rgba = Buffer.alloc(width * height * 4, 255);
  for (let x = 0; x < width; x++) { const at = x * 4; rgba[at] = 255; rgba[at + 1] = 0; rgba[at + 2] = 0; } // red top row
  const plain = encode({ data:rgba, width, height }, 95).data;
  // EXIF orientation 6 (rotate 90° clockwise) plus a GPS-looking string, inserted after SOI.
  const tiff = Buffer.from([0x4d,0x4d,0,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,6,0,0, 0,0,0,0]);
  const exifBody = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from('GPS 51.5007')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exifBody.length + 2) >> 8, (exifBody.length + 2) & 255]), exifBody]);
  const jpeg = Buffer.concat([plain.subarray(0, 2), app1, plain.subarray(2)]);
  const result = sanitizeImage('jpeg', jpeg);
  assert.equal(result.kind, 'jpg');
  assert.deepEqual([result.width, result.height], [4, 6], 'Rotated upright');
  assert.equal(result.bytes.includes(Buffer.from('GPS')), false);
  assert.equal(result.bytes.includes(Buffer.from('Exif')), false);
  assert.deepEqual(result.dropped, ['EXIF']);
  // 2×2, 24-bit, bottom-up BMP.
  const bmp = Buffer.alloc(54 + 16);
  bmp.write('BM', 0, 'latin1'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(2, 18); bmp.writeInt32LE(2, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  bmp.set([0,0,255, 0,255,0, 0,0], 54); bmp.set([255,0,0, 255,255,255, 0,0], 62);
  const converted = sanitizeImage('bmp', bmp);
  assert.equal(converted.kind, 'png');
  const { raw } = decodePng(converted.bytes);
  assert.deepEqual([...raw.subarray(1, 9)], [0,0,255,255, 255,255,255,255], 'Top row: blue, white');
  await withApp({}, async ({ upload }) => {
    const stored = await upload(jpeg, 'jpeg');
    assert.equal(stored.status, 201); assert.match(stored.body.id, /\.jpg$/);
    const fromBmp = await upload(bmp, 'bmp');
    assert.equal(fromBmp.status, 201); assert.match(fromBmp.body.id, /\.png$/);
  });
});
