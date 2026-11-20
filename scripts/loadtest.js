#!/usr/bin/env node
// Load test for a Nameflare server.
//
//   node scripts/loadtest.js --spawn                      seed a server and test it
//   node scripts/loadtest.js --spawn --docker --cpus 0.125 --memory 384m
//                                                         …inside Docker, sized like an
//                                                         Oracle E2.1.Micro
//   node scripts/loadtest.js --base http://127.0.0.1:3000 an existing server (reads only)
//
// Options: --duration 30 (seconds), --visitors 150 (people browsing),
// --overlays 40 (chat overlays resolving names), --writers 20 (signed-in
// people liking and following), --uploaders 2 (creators uploading images),
// --users 5000 and --flares 400 (seed size, with --spawn), --json (print JSON).
//
// Each simulated person sends its own client address (X-Real-IP), which the
// spawned server trusts as if a same-host nginx had set it, so per-client
// limits behave as they do in production. Exits 1 when a budget is missed:
// any 5xx or network error, or p95 latency over --p95 ms (default 400) for
// pages, API reads or overlay lookups.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync, crc32 } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values:o } = parseArgs({ options:{
  base:{ type:'string' }, spawn:{ type:'boolean' }, docker:{ type:'boolean' }, cpus:{ type:'string', default:'0.125' }, memory:{ type:'string', default:'384m' },
  duration:{ type:'string', default:'30' }, visitors:{ type:'string', default:'150' }, overlays:{ type:'string', default:'40' }, writers:{ type:'string', default:'20' }, uploaders:{ type:'string', default:'2' },
  users:{ type:'string', default:'5000' }, flares:{ type:'string', default:'400' }, p95:{ type:'string', default:'400' }, port:{ type:'string', default:'3180' }, json:{ type:'boolean' }
} });
const num = key => Number(o[key]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pick = list => list[Math.floor(Math.random() * list.length)];
const jitter = ms => ms * (0.6 + Math.random() * 0.8);

// ---------------------------------------------------------------- seeding
async function seed(dataDir, users, flares) {
  const { Store } = await import('../lib/store.js');
  mkdirSync(join(dataDir, 'textures'), { recursive:true });
  const store = new Store(join(dataDir, 'nameflare.sqlite')), now = new Date().toISOString();
  const animations = ['none', 'flow', 'shimmer', 'pulse', 'spectrum'], hex = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
  store.transaction(() => {
    const user = store.db.prepare("INSERT INTO users (id,name,role,created_at,profile_provider) VALUES (?,?,?,?, 'twitch')");
    const identity = store.db.prepare("INSERT INTO identities (provider,provider_id,user_id,login,display_name) VALUES ('twitch',?,?,?,?)");
    for (let i = 1; i <= users; i++) { user.run(`u${i}`, `viewer${i}`, i <= 50 ? 'artist' : 'user', now); identity.run(String(i), `u${i}`, `viewer${i}`, `viewer${i}`); }
    const flare = store.db.prepare("INSERT INTO cosmetics (id,owner_id,name,description,recipe,status,created_at,reviewed_at,reviewer_id,listed) VALUES (?,?,?,?,?,'approved',?,?,'u1',1)");
    for (let i = 0; i < flares; i++) {
      const layers = [{ type:'linear', opacity:1, angle:90, repeat:false, shape:'ellipse', size:[100,100], at:[50,50], canvasRepeat:'no-repeat', stops:[{ color:hex(), at:0 }, { color:hex(), at:1 }] }];
      flare.run(`f${i}`, `u${1 + (i % 50)}`, `Flare ${i}`, 'Load test Flare', JSON.stringify({ colors:[hex(), hex()], animation:pick(animations), speed:4, angle:90, glow:i % 6, layers }), now, now);
    }
    const equip = store.db.prepare('UPDATE users SET equipped=? WHERE id=?');
    for (let i = 1; i <= users; i++) if (i % 3) equip.run(`f${i % flares}`, `u${i}`);
    const like = store.db.prepare('INSERT OR IGNORE INTO cosmetic_likes (cosmetic_id,user_id,created_at) VALUES (?,?,?)');
    for (let i = 0; i < users * 3; i++) like.run(`f${Math.floor(Math.random() ** 2 * flares)}`, `u${1 + Math.floor(Math.random() * users)}`, now);
  });
  const sessions = Array.from({ length:Math.max(num('writers'), num('uploaders')) }, (_, i) => store.newSession(`u${51 + i}`));
  store.close();
  return sessions;
}

// A 128×128 PNG with noise: decoding and rebuilding it costs real CPU.
function samplePng(seed) {
  const size = 128, rows = Buffer.alloc(size * (1 + size * 4));
  let state = seed;
  for (let i = 0; i < rows.length; i++) { state = (state * 1103515245 + 12345) & 0x7fffffff; rows[i] = i % (1 + size * 4) === 0 ? 0 : state & 255; }
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1'); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0); return Buffer.concat([head, data, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- measuring
const stats = new Map();
function record(group, ms, status, error) {
  let entry = stats.get(group);
  if (!entry) stats.set(group, entry = { times:[], statuses:{}, errors:0, limited:0 });
  entry.times.push(ms);
  if (error) entry.errors++;
  else { entry.statuses[status] = (entry.statuses[status] || 0) + 1; if (status === 429) entry.limited++; if (status >= 500) entry.errors++; }
}
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

let base, origin, running = true;
async function hit(group, path, { client, method = 'GET', body, session, raw = false } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { method, body, headers:{ 'X-Real-IP':client, ...(body ? { 'Content-Type':'application/json', Origin:origin } : {}), ...(session ? { Cookie:`nameflare_session=${session.raw}`, 'X-CSRF-Token':session.csrf } : {}) } });
    const text = await response.text();
    record(group, performance.now() - started, response.status);
    return raw ? text : (response.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : null;
  } catch { record(group, performance.now() - started, 0, true); return null; }
}
const address = i => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

// ---------------------------------------------------------------- people
async function visitor(i, flareIds) {
  const client = address(1000 + i);
  await sleep(Math.random() * 3000);
  while (running) {
    // A first visit: the page, its main modules, then the API calls the app makes.
    await hit('page', '/discover', { client, raw:true });
    for (const file of ['/app.js', '/ui/calm.css', '/renderer.js', '/effects.css']) await hit('static', file, { client, raw:true });
    await hit('api read', '/api/config', { client });
    await hit('api read', '/api/me', { client });
    await hit('api read', `/api/v1/cosmetics?limit=24&sort=${pick(['newest', 'trending', 'liked'])}`, { client });
    for (let n = 0; n < 3 && running; n++) {
      await sleep(jitter(4000));
      await hit('api read', `/api/v1/cosmetics/${pick(flareIds)}`, { client });
      if (Math.random() < 0.4) await hit('api read', `/api/v1/cosmetics?limit=24&offset=24&q=${pick(['', 'Flare 1', 'glow'])}`, { client });
    }
    await sleep(jitter(5000));
  }
}
async function overlay(i, users) {
  const client = address(50000 + i);
  let epoch = '', cursor = '';
  await sleep(Math.random() * 3000);
  while (running) {
    const ids = Array.from({ length:20 + Math.floor(Math.random() * 60) }, () => String(1 + Math.floor(Math.random() * users)));
    await hit('overlay resolve', '/api/v1/resolve', { client, method:'POST', body:JSON.stringify({ provider:'twitch', ids }) });
    const feed = await hit('overlay changes', `/api/v1/changes?since=${cursor}&epoch=${epoch}`, { client });
    if (feed) { epoch = feed.epoch; cursor = feed.cursor; }
    await sleep(jitter(4000));
  }
}
async function writer(i, session, flareIds) {
  const client = address(60000 + i);
  await sleep(Math.random() * 3000);
  while (running) {
    const id = pick(flareIds);
    await hit('write', '/api/cosmetics/like', { client, session, method:'POST', body:JSON.stringify({ id, liked:true }) });
    await sleep(jitter(3000));
    await hit('write', '/api/cosmetics/like', { client, session, method:'POST', body:JSON.stringify({ id, liked:false }) });
    if (Math.random() < 0.3) await hit('write', '/api/profiles/follow', { client, session, method:'POST', body:JSON.stringify({ id:`u${1 + Math.floor(Math.random() * 50)}`, following:Math.random() < 0.5 }) });
    await sleep(jitter(3000));
  }
}
async function uploader(i, session) {
  const client = address(61000 + i);
  let n = 0;
  await sleep(1000 + Math.random() * 2000);
  while (running) {
    const png = samplePng(i * 100000 + n++);
    await hit('upload', '/api/textures', { client, session, method:'POST', body:JSON.stringify({ data:`data:image/png;base64,${png.toString('base64')}` }) });
    await sleep(jitter(6000));
  }
}

// ---------------------------------------------------------------- run
const scratch = mkdtempSync(join(tmpdir(), 'nameflare-load-'));
let child = null, containerName = null;
async function main() {
  let sessions = [], users = num('users');
  if (o.spawn) {
    const port = num('port'), dataDir = join(scratch, 'data');
    base = `http://127.0.0.1:${port}`; origin = `http://localhost:${port}`;
    process.stderr.write(`Seeding ${users} accounts and ${num('flares')} Flares…\n`);
    sessions = await seed(dataDir, users, num('flares'));
    const env = { PORT:String(port), HOST:'127.0.0.1', DATA_DIR:'/data', TRUST_PROXY_LOOPBACK:'true', PUBLIC_BASE_URL:origin, NODE_ENV:'test' };
    if (o.docker) {
      containerName = `nameflare-load-${process.pid}`;
      execFileSync('docker', ['run', '-d', '--rm', '--name', containerName, '--network', 'host', '--user', `${process.getuid()}:${process.getgid()}`, `--cpus=${o.cpus}`, `--memory=${o.memory}`, '-v', `${root}:/app:ro`, '-v', `${dataDir}:/data`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), 'node:24-bookworm-slim', 'node', '--max-old-space-size=192', '/app/server.js'], { stdio:'ignore' });
    } else {
      child = spawn(process.execPath, ['--max-old-space-size=192', join(root, 'server.js')], { env:{ ...process.env, ...env, DATA_DIR:dataDir }, stdio:'ignore' });
    }
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  } else {
    if (!o.base) throw new Error('Pass --spawn, or --base with the server to test.');
    base = o.base.replace(/\/$/, ''); origin = new URL(base).origin; users = 1000;
  }
  const catalog = await (await fetch(`${base}/api/v1/cosmetics?limit=100`, { headers:{ 'X-Real-IP':'10.255.255.1' } })).json();
  const flareIds = catalog.cosmetics.map(c => c.id);
  if (!flareIds.length) throw new Error('The server has no public Flares to browse.');
  // Warm up the static cache the way the first real visitor would.
  for (const file of ['/discover', '/app.js', '/ui/calm.css', '/renderer.js', '/effects.css']) await fetch(base + file, { headers:{ 'X-Real-IP':'10.255.255.2' } }).then(r => r.text());
  process.stderr.write(`Running ${o.duration}s: ${o.visitors} visitors, ${o.overlays} overlays${sessions.length ? `, ${o.writers} writers, ${o.uploaders} uploaders` : ''}…\n`);
  const started = Date.now(), people = [];
  for (let i = 0; i < num('visitors'); i++) people.push(visitor(i, flareIds));
  for (let i = 0; i < num('overlays'); i++) people.push(overlay(i, users));
  if (sessions.length) {
    for (let i = 0; i < num('writers'); i++) people.push(writer(i, sessions[i], flareIds));
    for (let i = 0; i < num('uploaders'); i++) people.push(uploader(i, sessions[i]));
  }
  // A health probe every 250ms shows how responsive the server stays.
  people.push((async () => { while (running) { await hit('health probe', '/healthz', { client:'10.255.255.3' }); await sleep(250); } })());
  let memoryPeak = 0;
  const sampler = setInterval(() => {
    if (!containerName) return;
    try { const used = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', containerName], { encoding:'utf8' }).split('/')[0].trim(); const mb = parseFloat(used) * (used.includes('GiB') ? 1024 : 1); memoryPeak = Math.max(memoryPeak, mb); } catch {}
  }, 5000);
  await sleep(num('duration') * 1000);
  running = false; clearInterval(sampler);
  const seconds = (Date.now() - started) / 1000;
  // Let requests already in flight finish; they count toward latency.
  await Promise.race([Promise.all(people), sleep(15000)]);

  const rows = [...stats].map(([group, entry]) => {
    const sorted = entry.times.sort((a, b) => a - b);
    return { group, requests:sorted.length, per_second:+(sorted.length / seconds).toFixed(1), p50:Math.round(percentile(sorted, 0.5)), p95:Math.round(percentile(sorted, 0.95)), p99:Math.round(percentile(sorted, 0.99)), limited:entry.limited, errors:entry.errors };
  });
  const total = rows.reduce((sum, row) => sum + row.requests, 0);
  const budget = num('p95'), failures = [];
  for (const row of rows) {
    if (row.errors) failures.push(`${row.group}: ${row.errors} errors (5xx or network)`);
    if (['page', 'api read', 'overlay resolve', 'overlay changes'].includes(row.group) && row.p95 > budget) failures.push(`${row.group}: p95 ${row.p95}ms is over ${budget}ms`);
  }
  const report = { seconds:+seconds.toFixed(1), total_requests:total, per_second:+(total / seconds).toFixed(1), memory_peak_mb:memoryPeak ? Math.round(memoryPeak) : null, docker:o.docker ? { cpus:o.cpus, memory:o.memory } : null, rows, failures };
  if (o.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\n${total} requests in ${report.seconds}s (${report.per_second}/s)${o.docker ? ` · Docker ${o.cpus} CPU, ${o.memory}` : ''}${report.memory_peak_mb ? ` · peak memory ${report.memory_peak_mb} MB` : ''}\n`);
    console.log('group              requests    /s    p50    p95    p99  429s  errors');
    for (const row of rows) console.log(`${row.group.padEnd(18)} ${String(row.requests).padStart(8)} ${String(row.per_second).padStart(5)} ${String(row.p50).padStart(6)} ${String(row.p95).padStart(6)} ${String(row.p99).padStart(6)} ${String(row.limited).padStart(5)} ${String(row.errors).padStart(7)}`);
    console.log(failures.length ? `\nBudget missed:\n- ${failures.join('\n- ')}` : `\nWithin budget: no errors, p95 under ${budget}ms for pages, reads and overlays.`);
  }
  if (failures.length) process.exitCode = 1;
}
try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  running = false;
  if (containerName) { try { execFileSync('docker', ['rm', '-f', containerName], { stdio:'ignore' }); } catch {} }
  child?.kill();
  rmSync(scratch, { recursive:true, force:true });
  setTimeout(() => process.exit(), 100).unref();
}
