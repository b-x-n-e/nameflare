#!/usr/bin/env node
// Checks the edge rate limits in docs/oracle/nameflare.nginx.conf against a
// real nginx (Docker) in front of a real Nameflare server.
//
//   node scripts/edge-test.mjs [--image nginx:1.26]
//
// The production config is used as-is except for TLS (plain HTTP on a local
// port) and one test-only line: nginx takes the client address from an
// X-Edge-Test-Client header, so one machine can play many clients.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options:{ image:{ type:'string', default:'nginx:1.26' } } });
const NODE_PORT = 3170, EDGE_PORT = 8089, sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scratch = mkdtempSync(join(tmpdir(), 'nameflare-edge-'));
const container = `nameflare-edge-${process.pid}`;
let server;

function testConfig() {
  let site = readFileSync(join(root, 'docs/oracle/nameflare.nginx.conf'), 'utf8');
  site = site.replace(/server \{\n    listen 80;[\s\S]*?\n\}\n\n/, '');
  site = site.replace('listen 443 ssl http2;', `listen ${EDGE_PORT};\n    set_real_ip_from 127.0.0.1;\n    real_ip_header X-Edge-Test-Client;`);
  site = site.replace(/^\s*(ssl_|http2_).*\n/gm, '');
  site = site.replace('server 127.0.0.1:3000;', `server 127.0.0.1:${NODE_PORT};`);
  site = site.replace('error_log /var/log/nginx/nameflare-error.log crit;', 'error_log stderr crit;');
  return `worker_processes 1;\npid /tmp/nginx.pid;\nerror_log stderr crit;\nevents { worker_connections 1024; }\nhttp {\n${site}\n}\n`;
}

async function send(client, path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${EDGE_PORT}${path}`, { method, headers:{ 'X-Edge-Test-Client':client, ...(body ? { 'Content-Type':'application/json', Origin:'http://localhost' } : {}) }, body });
  const text = await response.text();
  // nginx's 429 says "a few seconds"; Node's says "a minute".
  return { status:response.status, edge:response.status === 429 && text.includes('a few seconds'), retryAfter:response.headers.get('retry-after') };
}
async function burst(clients, path, count, options) {
  const results = await Promise.all(Array.from({ length:count }, (_, i) => send(clients[i % clients.length], path, options)));
  return { passed:results.filter(result => !result.edge).length, edge:results.filter(result => result.edge).length, retryAfter:results.find(result => result.edge)?.retryAfter };
}

const checks = [];
const expect = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); };

try {
  writeFileSync(join(scratch, 'nginx.conf'), testConfig());
  server = spawn(process.execPath, [join(root, 'server.js')], { env:{ ...process.env, PORT:String(NODE_PORT), HOST:'127.0.0.1', DATA_DIR:join(scratch, 'data'), TRUST_PROXY_LOOPBACK:'true', PUBLIC_BASE_URL:'http://localhost', NODE_ENV:'test' }, stdio:'ignore' });
  execFileSync('docker', ['run', '--rm', '-d', '--name', container, '--network', 'host', '-v', `${join(scratch, 'nginx.conf')}:/etc/nginx/nginx.conf:ro`, values.image], { stdio:'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${EDGE_PORT}/healthz`)).ok) break; } catch {} await sleep(200); }
  const upload = { method:'POST', body:'{"data":""}' };

  let r = await burst(['203.0.113.5'], '/api/textures', 20, upload);
  expect('uploads: one client gets its burst, then 429 at the edge', r.passed === 5 && r.edge === 15, `${r.passed} through, ${r.edge} limited`);
  expect('edge 429s carry Retry-After', r.retryAfter === '10', `Retry-After ${r.retryAfter}`);
  r = await burst(['203.0.113.6'], '/api/textures', 5, upload);
  expect('uploads: another address is unaffected', r.edge === 0, `${r.passed} through`);

  const sameSlash64 = Array.from({ length:20 }, (_, i) => `2001:db8:1:2::${(i + 1).toString(16)}`);
  r = await burst(sameSlash64, '/api/textures', 20, upload);
  expect('IPv6: twenty addresses in one /64 share one budget', r.passed === 5, `${r.passed} through`);
  r = await burst(['2001:db8:1:3::1'], '/api/textures', 5, upload);
  expect('IPv6: the neighbouring /64 has its own budget', r.edge === 0, `${r.passed} through`);
  r = await burst(['2001:db8::1', '2001:db8::5:6:7:8', '2001:db8:0:0:9::1'], '/api/textures', 9, upload);
  expect('IPv6: compressed spellings of one /64 are one client', r.passed === 5, `${r.passed} through`);

  r = await burst(['198.51.100.7'], '/api/v1/cosmetics', 80);
  expect('API reads: burst of 40, then 429', r.passed >= 41 && r.passed <= 43, `${r.passed} through, ${r.edge} limited`);
  // A first visit loads ~130 files; a browser keeps at most 64 in flight.
  let pages = 0;
  for (let wave = 0; wave < 3; wave++) pages += (await burst(['198.51.100.8'], '/discover', 50)).passed;
  expect('pages and modules: no request-rate limit', pages === 150, `${pages}/150 through`);
  r = await burst(['198.51.100.11'], '/api/v1/cosmetics/lookup?name=x', 120);
  expect('more than 64 requests in flight from one client: the rest get 429', r.edge > 0 && r.passed <= 64, `${r.passed} through, ${r.edge} limited`);
  r = await burst(['198.51.100.9'], '/auth/twitch', 30);
  expect('sign-in: burst of 10, then 429', r.passed === 11, `${r.passed} through`);
  r = await burst(['198.51.100.10'], '/api/likes', 30, { method:'POST', body:'{}' });
  expect('writes: burst of 10, then 429', r.passed === 11, `${r.passed} through`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  try { execFileSync('docker', ['rm', '-f', container], { stdio:'ignore' }); } catch {}
  server?.kill();
  rmSync(scratch, { recursive:true, force:true });
}
const failed = checks.filter(check => !check.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} edge checks passed.`);
if (failed) process.exitCode = 1;
