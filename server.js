import http from 'node:http';
import { isAppPath } from './public/routes.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { Store, digest, RETENTION, REPORT_REASONS } from './lib/store.js';
import { createImageProcessor, createScanner } from './lib/media.js';
import { assert, HttpError, validateRecipe, validateTexture, text, publishingFlag, catalogFilters } from './lib/cosmetics.js';
import { beginOAuth, finishOAuth, providerConfig, avatarSources } from './lib/oauth.js';

const root = dirname(fileURLToPath(import.meta.url));
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c.length === 2));
const types = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gif': 'image/gif', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml; charset=utf-8' };

// Static assets: read once, compressed once, revalidated by ETag. Entries are
// keyed by path and invalidated by mtime, so edits show up without a restart.
const staticCache = new Map(), brotliAsync = promisify(brotliCompress), gzipAsync = promisify(gzip);
const compressible = /^(text\/|application\/json|image\/svg)/;
// scripts/precompress.js writes file.br and file.gz at deploy time; a copy at
// least as new as its source is used as-is.
function precompressed(full, stat, extension) {
  try { const copy = statSync(`${full}.${extension}`); if (copy.mtimeMs >= stat.mtimeMs) return readFileSync(`${full}.${extension}`); } catch {}
  return null;
}
// Anything not precompressed is compressed on the libuv thread pool, one file
// at a time: done all at once, the first visits after a restart competed with
// requests for a fractional CPU for many seconds. Until then it goes out plain.
let compressionQueue = Promise.resolve();
function staticEntry(file) {
  const full = join(root,'public',file);
  const stat = statSync(full);
  const cached = staticCache.get(full);
  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached;
  const body = readFileSync(full), type = types[`.${file.split('.').pop()}`];
  const entry = { body, type, mtime:stat.mtimeMs, size:stat.size, etag:`"${digest(body.toString('base64')).slice(0,27)}"` };
  if (compressible.test(type) && body.length > 1024) {
    entry.br = precompressed(full, stat, 'br'); entry.gzip = precompressed(full, stat, 'gz');
    if (!entry.br || !entry.gzip) {
      compressionQueue = compressionQueue.then(() => Promise.all([
        entry.br || brotliAsync(body,{ params:{ [zlibConstants.BROTLI_PARAM_QUALITY]:10, [zlibConstants.BROTLI_PARAM_SIZE_HINT]:body.length } }),
        entry.gzip || gzipAsync(body,{ level:9 })
      ])).then(([br, gz]) => { entry.br = br; entry.gzip = gz; }, () => {});
    }
  }
  staticCache.set(full,entry);
  return entry;
}
export function sendStatic(req, res, file, cacheControl) {
  const entry = staticEntry(file);
  res.setHeader('Cache-Control',cacheControl);res.setHeader('ETag',entry.etag);res.setHeader('Vary','Accept-Encoding');
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); return res.end(); }
  const accept = String(req.headers['accept-encoding'] || '');
  const encoding = entry.br && /\bbr\b/.test(accept) ? 'br' : entry.gzip && /\bgzip\b/.test(accept) ? 'gzip' : null;
  const body = encoding ? entry[encoding] : entry.body;
  res.writeHead(200,{ 'Content-Type':entry.type, 'Content-Length':body.length, ...(encoding ? { 'Content-Encoding':encoding } : {}) });
  return res.end(req.method === 'HEAD' ? undefined : body);
}
const staticCacheControl = file => file.startsWith('fonts/') ? 'public, max-age=2592000, immutable' : file.startsWith('vendor/') ? 'public, max-age=604800' : 'public, no-cache';

function canonicalIP(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  // Normalize equivalent IPv6 spellings and IPv4-mapped socket addresses.
  const address = new URL(`http://[${value}]/`).hostname.slice(1,-1).toLowerCase();
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(address);
  if (mapped) {
    const high = parseInt(mapped[1],16), low = parseInt(mapped[2],16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return address;
}
// One IPv6 subscriber usually controls a whole /64, so rate limits count the
// /64, not each of its 2^64 addresses.
export function rateKey(address) {
  if (!address.includes(':')) return address;
  const [head, tail = ''] = address.split('::'), left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0,4).map(group => group.padStart(4,'0')).join(':')}::/64`;
}
export function clientAddress(req, trustLoopbackProxy = false) {
  const peer = canonicalIP(req.socket.remoteAddress) || 'unknown';
  // Only a same-host proxy may supply ONE validated address. Never parse a
  // user-controlled X-Forwarded-For chain or trust public peers by default.
  if (trustLoopbackProxy && ['127.0.0.1','::1'].includes(peer)) {
    return canonicalIP(req.headers['x-real-ip']) || peer;
  }
  return peer;
}

export function createApp({ store, baseUrl = 'http://localhost:3000', demo = false, dataDir = join(root, 'data'), env = process.env } = {}) {
  baseUrl = baseUrl.replace(/\/$/, '');
  assert([undefined,'','false','true'].includes(env.TRUST_PROXY_LOOPBACK),500,'TRUST_PROXY_LOOPBACK must be true or false.');
  const trustLoopbackProxy = env.TRUST_PROXY_LOOPBACK === 'true' && !demo;
  if (demo) {
    assert(env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname), 500, 'Demo mode is restricted to local development.');
  }
  mkdirSync(join(dataDir, 'textures'), { recursive: true });
  store ||= new Store(join(dataDir, 'nameflare.sqlite'));
  if (demo) store.seedDemo();
  const origin = new URL(baseUrl).origin;
  // Local demo previews may be opened as localhost or 127.0.0.1. Both are the
  // same loopback service; production still accepts only the canonical origin.
  const allowedOrigins = new Set([origin]);
  if (demo) {
    const parsed = new URL(origin), loopback = ['localhost','127.0.0.1'].includes(parsed.hostname), port = parsed.port ? `:${parsed.port}` : '';
    if (loopback) allowedOrigins.add(`${parsed.protocol}//${parsed.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}${port}`);
  }
  const secure = origin.startsWith('https:');
  const rates = new Map(), streams = new Set(), rooms = new Map();
  const images = createImageProcessor(), scanner = createScanner(env);
  const textureFile = id => join(dataDir, 'textures', id);
  const removeTextureFile = id => { if (/^[a-f0-9]{64}\.(gif|png|webp|jpg)$/.test(id)) rmSync(textureFile(id), { force:true }); };
  // Retention runs a minute after start and every six hours: expired records
  // (see RETENTION) and image files nothing references any more.
  function maintenance() {
    try {
      const result = store.retention();
      for (const id of result.files) { try { removeTextureFile(id); } catch {} }
      const known = new Set(store.db.prepare('SELECT id FROM textures').all().map(row => row.id));
      let swept = 0;
      for (const name of readdirSync(join(dataDir, 'textures'))) {
        if (known.has(name) || !/^[a-f0-9]{64}\.(gif|png|webp|jpg)$/.test(name)) continue;
        // A day's grace covers an upload written a moment before its row.
        if (Date.now() - statSync(textureFile(name)).mtimeMs > 86400000) { rmSync(textureFile(name), { force:true }); swept++; }
      }
      return { ...result, files:result.files.length, swept };
    } catch (error) { console.error('Maintenance failed:', error.message); return null; }
  }
  const firstMaintenance = setTimeout(maintenance, 60000).unref();
  const maintenanceTimer = setInterval(maintenance, 6 * 3600000).unref();
  const closeRoom = id => { for (const response of rooms.get(id) || []) response.end(); rooms.delete(id); };
  const MAX_RATE_ENTRIES = 100000;
  // Public, cookie-independent API answers are shared by every visitor, so each
  // is computed at most once per few seconds and revalidated with an ETag.
  const publicCache = new Map(), PUBLIC_TTL = 10000, MAX_PUBLIC_ENTRIES = 500;
  const textureApproval = new Map();
  // An entry is fresh while young AND no moderation/publishing write happened since.
  const fresh = entry => entry && entry.expires > Date.now() && entry.generation === store.generation;
  let cachedStats = null, uploadsInFlight = 0, sourceBundle = null, licenseText = null;
  const stats = () => {
    if (!fresh(cachedStats)) cachedStats = { value:store.stats(), expires:Date.now() + PUBLIC_TTL, generation:store.generation };
    return cachedStats.value;
  };
  // Change feed for overlays and chat clients. Events live in memory only; the
  // random epoch tells a client after a restart (or a gap) to revalidate everything.
  const feed = { epoch:randomBytes(6).toString('hex'), seq:0, events:[] };
  const FEED_MAX_EVENTS = 20000, FEED_MAX_AGE = 15 * 60000, FEED_MAX_IDENTITIES = 1000;
  const unsubscribe = store.onEvent?.(event => {
    const entry = { seq:++feed.seq, at:Date.now() };
    if (event.type === 'user') entry.identities = store.identities(event.id).map(identity => [identity.provider, identity.provider_id]);
    else entry.cosmetic = event.id;
    feed.events.push(entry);
    let drop = 0;
    while (drop < feed.events.length && (feed.events.length - drop > FEED_MAX_EVENTS || feed.events[drop].at < entry.at - FEED_MAX_AGE)) drop++;
    if (drop) feed.events.splice(0, drop);
    resolvedCosmetics.delete(event.id);
  });
  // Resolve answers carry the wearer's Flare; most chatters share a few Flares,
  // so each Flare is read once per few seconds rather than once per chatter.
  const resolvedCosmetics = new Map();
  const resolvedCosmetic = id => {
    let entry = resolvedCosmetics.get(id);
    if (!fresh(entry)) {
      entry = { value:store.publicCosmetic(store.getCosmetic(id)), expires:Date.now() + 5000, generation:store.generation };
      if (resolvedCosmetics.size >= 2000) resolvedCosmetics.clear();
      resolvedCosmetics.set(id, entry);
    }
    return entry.value;
  };
  const resolveIdentity = (provider, providerId) => {
    const identity = store.resolve(provider, providerId, { withCosmetic:false });
    return identity && { ...identity, cosmetic:identity.equipped ? resolvedCosmetic(identity.equipped) : null, equipped:undefined };
  };
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const sessionCookie = (res, raw) => res.setHeader('Set-Cookie', cookie('nameflare_session', raw, 604800));
  const getSession = req => store.session(parseCookies(req).nameflare_session);
  const requireUser = req => { const session = getSession(req); assert(session, 401, 'Sign in to continue.'); return session; };
  const requireMod = req => { const session = requireUser(req); assert(['owner','moderator'].includes(session.role), 403, 'Moderator access required.'); return session; };
  const requireOwner = req => { const session = requireUser(req); assert(session.role === 'owner', 403, 'Owner access required.'); return session; };
  // Bans cover the networks a banned account used: sign-in and changes from
  // them are refused (reading the site stays open). Loopback is never counted,
  // so a misconfigured proxy cannot ban the server itself.
  const networkOf = req => {
    const address = clientAddress(req,trustLoopbackProxy);
    return ['127.0.0.1','::1','unknown'].includes(address) ? null : store.networkHash(rateKey(address));
  };
  const networkSeen = new Map();
  const checkNetwork = (req, session) => {
    if (['owner','moderator'].includes(session?.role)) return;
    const network = networkOf(req);
    if (!network) return;
    assert(!store.networkBanned(network),403,'Signing in and making changes are blocked from this network because of a ban.');
    if (!session) return;
    // Remember the network at most once an hour per account.
    const key = `${session.id}:${network}`;
    if ((networkSeen.get(key) || 0) > Date.now() - 3600000) return;
    if (networkSeen.size > 50000) networkSeen.clear();
    networkSeen.set(key, Date.now()); store.recordNetwork(session.id, network);
  };
  const mutation = req => {
    assert(allowedOrigins.has(req.headers.origin), 403, 'Requests must come from the official app origin.');
    const session = requireUser(req);
    assert(safeEqual(req.headers['x-csrf-token'], session.csrf), 403, 'Invalid security token. Refresh the page.');
    checkNetwork(req, session);
    return session;
  };
  // JSON bodies are small except texture uploads; a 2.9 MB allowance on every
  // route let a handful of clients hold most of a 1 GB server's memory.
  async function body(req, max = 65536) {
    assert((req.headers['content-type'] || '').split(';')[0] === 'application/json', 415, 'Send application/json.');
    assert(Number(req.headers['content-length'] || 0) <= max, 413, 'Request body is too large.');
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; assert(length <= max, 413, 'Request body is too large.'); chunks.push(chunk); }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString()); assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'Expected a JSON object.'); return parsed; }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON.'); }
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
  }
  function publicJson(req, res, build) {
    let entry = publicCache.get(req.url);
    if (!fresh(entry)) {
      const serialized = JSON.stringify(build());
      entry = { serialized, etag:`"${digest(serialized).slice(0,32)}"`, expires:Date.now() + PUBLIC_TTL, generation:store.generation };
      publicCache.delete(req.url);
      if (publicCache.size >= MAX_PUBLIC_ENTRIES) publicCache.delete(publicCache.keys().next().value);
      publicCache.set(req.url, entry);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=15, must-revalidate');
    res.setHeader('ETag', entry.etag);
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(entry.serialized);
  }
  function rate(req, key, max) {
    let id = `${rateKey(clientAddress(req,trustLoopbackProxy))}:${key}`;
    // A flood of distinct addresses shares one bucket instead of growing the map.
    if (!rates.has(id) && rates.size >= MAX_RATE_ENTRIES) id = `overflow:${key}`;
    const entry = rates.get(id);
    if (!entry || entry.reset < Date.now()) { rates.set(id, { count: 1, reset: Date.now() + 60000 }); return; }
    entry.count++;
    if (entry.count > max) {
      const error = new HttpError(429,'Too many requests. Try again in a minute.');
      error.retryAfter = Math.max(1,Math.ceil((entry.reset - Date.now()) / 1000));
      throw error;
    }
  }
  const cleanup = setInterval(() => {
    store.cleanup();
    for (const [id, entry] of rates) if (entry.reset < Date.now()) rates.delete(id);
    for (const response of streams) response.write(': heartbeat\n\n');
  }, 25000).unref();

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: ${avatarSources}; connect-src 'self' data: wss://irc-ws.chat.twitch.tv; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url = new URL(req.url, origin), path = url.pathname;
      const method = req.method;
      if (path.startsWith('/api/v1/')) res.setHeader('Access-Control-Allow-Origin','*');
      if (method === 'OPTIONS' && path.startsWith('/api/v1/')) {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }); return res.end();
      }
      const staticRequest = (method === 'GET' || method === 'HEAD') && !path.startsWith('/api/') && !path.startsWith('/auth/') && !path.startsWith('/textures/') && !['/healthz','/license','/source'].includes(path);
      if (!staticRequest && getSession(req)?.role !== 'owner') {
        // Anonymous page-view beacons get their own budget so navigation never
        // consumes a signed-in reader's like/equip/write allowance.
        if (method === 'POST' && path === '/api/views') rate(req, 'view', 120);
        // Batch identity lookups are reads. An overlay revalidating a busy chat
        // sends one every few seconds; the 40/min write budget starved it.
        else if (method === 'POST' && path === '/api/v1/resolve') rate(req, 'resolve', 240);
        // Relay connectors post one request per chat message.
        else if (method === 'POST' && path === '/api/overlay/messages') rate(req, 'ingest', 1200);
        else {
          // Reads match the edge's 10/s per client; one page uses about seven.
          rate(req, method === 'GET' ? 'read':'write', method === 'GET' ? 600 : 40);
          // Decoding images is the most expensive request a visitor can send.
          if (method === 'POST' && path === '/api/textures') rate(req, 'upload', 12);
          if (method === 'POST' && path === '/api/reports') rate(req, 'report', 10);
        }
      }
      if (method === 'GET' && path === '/healthz') return json(res,200,{ status:'ok' });
      if (method === 'GET' && path === '/license') {
        licenseText ||= readFileSync(join(root,'LICENSE'));
        res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end(licenseText);
      }
      if (method === 'GET' && path === '/source') {
        if (env.SOURCE_URL) {
          const source = new URL(env.SOURCE_URL);
          assert(source.protocol === 'https:',500,'SOURCE_URL must be a public HTTPS repository URL.');
          res.writeHead(302, { Location:source.toString() }); return res.end();
        }
        const sourceFiles = ['package.json','server.js','lib/cosmetics.js','lib/store.js','lib/oauth.js','lib/images.js','lib/image-worker.js','lib/vendor/jpeg-js/LICENSE','docs/FEATURES.md','lib/media.js','lib/backup.js','scripts/backup.js','scripts/restore.js','scripts/loadtest.js','scripts/check-edge-limits.mjs','scripts/precompress.js','test/safety.test.js','test/backup.test.js','test/capacity.test.js','test/integrations.test.js','test/donate.test.js','docs/OPERATIONS.md','docs/PRIVACY.md','docs/oracle/nameflare-backup.service','docs/oracle/nameflare-backup.timer','public/index.html','public/fonts/OFL.txt','public/logo.svg','public/style.css','public/redesign.css','public/social.css','public/ui/tokens.css','public/ui/kit.css','public/ui/shell.css','public/ui/views.css','public/icons.js','public/effects.css','public/app.js','public/likes.js','public/routes.js','public/theme-init.js','public/social.js','public/preferences.js','public/insights.js','public/rail.js','public/experience.js','public/fonts.js','public/google-fonts.json','scripts/update-google-fonts.js','public/editor.js','public/renderer.js','public/paints.js','public/client.js','public/donate.js','public/vendor/qrcode/LICENSE.txt','public/SDK-LICENSE.md','public/vendor/basecoat/LICENSE.md','test/client.test.js','public/overlay.html','public/overlay.css','public/overlay.js','test/nameflare.test.js','test/likes.test.js','test/accounts.test.js','test/editor.test.js','test/fonts.test.js','test/paints.test.js','test/social.test.js','README.md','DESIGN.md','LICENSE','SECURITY.md','docs/API.md','docs/UX.md','docs/DESIGN-2026.md','docs/DEPLOYMENT.md','docs/CLOUDFLARE.md','docs/ORACLE.md','docs/oracle/nameflare.service','docs/oracle/nameflare.nginx.conf','docs/oracle/nameflare-http.nginx.conf','cloudflare/worker.js','cloudflare/store.js','cloudflare/migrations/0001_initial.sql','cloudflare/migrations/0002_profile_avatars.sql','wrangler.jsonc','test/cloudflare.test.js','cloudflare/migrations/0003_flare_publication.sql','cloudflare/migrations/0004_account_moderation.sql','cloudflare/migrations/0005_cosmetic_likes.sql','cloudflare/migrations/0006_full_profiles.sql','cloudflare/migrations/0007_creator_follows.sql','cloudflare/migrations/0008_flare_submission_limit.sql','package-lock.json','Dockerfile','compose.yaml','.env.example','.gitignore','.dockerignore'];
        // Built once: rebuilding this multi-megabyte bundle per request was a cheap way to pin the CPU.
        sourceBundle ||= JSON.stringify({ name:'Nameflare', format:'source-file-bundle', license:'AGPL-3.0-only', files:Object.fromEntries(sourceFiles.filter(file => existsSync(join(root,file))).map(file => [file,readFileSync(join(root,file),'utf8')])) });
        res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Content-Disposition':'attachment; filename="nameflare-source.json"' });
        return res.end(sourceBundle);
      }
      if (method === 'GET' && path === '/api/config') return json(res,200,{ name:'Nameflare', owner:'B_X_N_E', demo, officialApi: `${baseUrl}/api/v1`, providers:Object.fromEntries(['twitch','kick','youtube'].map(p => { const c = providerConfig(p,env); return [p,Boolean(c.clientId && c.clientSecret)]; })), stats: stats(), features:{ notifications:true, insights:true, analytics:true, reports:true, account_deletion:true, data_export:true, overlay_rooms:true, scanning:scanner.enabled }, report_reasons:REPORT_REASONS, retention:RETENTION });
      if (method === 'POST' && path === '/api/views') {
        assert(allowedOrigins.has(req.headers.origin),403,'Requests must come from the official app origin.');
        const data = await body(req), viewPath = text(data.path,1,120,'Path');
        assert(isAppPath(viewPath),400,'Invalid application path.');
        assert(!['/account','/collection','/analytics','/moderation'].some(privatePath => viewPath===privatePath || viewPath.startsWith(`${privatePath}/`)),400,'Private paths are not recorded.');
        store.recordView(viewPath);
        return json(res,200,{ ok:true });
      }
      if (method === 'GET' && path === '/api/me') {
        const session = getSession(req);
        return json(res,200,{ user: session ? store.account(session.id):null, csrf:session?.csrf || null, liked_ids:session ? store.likedIds(session.id):[], following_ids:session ? store.followingIds(session.id):[], notifications_unread:session ? store.unreadNotifications(session.id):0 });
      }
      if (method === 'GET' && path === '/api/notifications') {
        const session = requireUser(req), offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 30);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        assert(Number.isInteger(limit) && limit >= 1 && limit <= 50,400,'Invalid pagination.');
        const items = store.notifications(session.id,{offset,limit:limit+1});
        return json(res,200,{ notifications:items.slice(0,limit), unread:store.unreadNotifications(session.id), next_offset:items.length>limit ? offset+limit:null });
      }
      if (method === 'POST' && path === '/api/notifications/read') {
        const session = mutation(req), data = await body(req);
        let id = null;
        if (data.id !== undefined) { assert(Number.isInteger(data.id) && data.id > 0,400,'Invalid notification ID.'); id = data.id; }
        return json(res,200,{ unread:store.markNotificationsRead(session.id,id) });
      }
      if (method === 'POST' && path === '/api/demo/login') {
        assert(demo && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),404,'Not found.');
        assert(allowedOrigins.has(req.headers.origin),403,'Invalid origin.');
        const data = await body(req);
        assert(['owner','creator','mod'].includes(data.role),400,'Invalid demo role.');
        store.revokeSession(parseCookies(req).nameflare_session);
        const session = store.newSession(`demo-${data.role}`); sessionCookie(res,session.raw);
        return json(res,200,{ ok:true });
      }
      const auth = /^\/auth\/(twitch|kick|youtube)(\/callback)?$/.exec(path);
      if (method === 'GET' && auth) {
        assert(!demo,403,'Real account linking is disabled in the isolated demo.');
        const provider = auth[1], session = getSession(req);
        checkNetwork(req, session);
        if (!auth[2]) {
          const started = beginOAuth(provider,store,session,baseUrl,env);
          res.setHeader('Set-Cookie',cookie(`nameflare_oauth_${provider}`,started.binding,600));
          res.writeHead(302,{ Location:started.url }); return res.end();
        }
        const state = store.consumeState(url.searchParams.get('state'),provider,parseCookies(req)[`nameflare_oauth_${provider}`]);
        if (state.user_id) assert(session?.id === state.user_id,403,'Account changed during linking. Please start again.');
        else assert(!session,403,'You signed in during this login attempt. Please start again.');
        assert(!url.searchParams.has('error'),400,'Authorization was cancelled.');
        const profile = await finishOAuth(provider,url.searchParams.get('code'),state.verifier,baseUrl,env);
        const id = store.linkIdentity(profile,state.user_id,env.OWNER_TWITCH_ID);
        const network = networkOf(req);
        if (network && !['owner','moderator'].includes(store.user(id)?.role)) store.recordNetwork(id, network);
        store.revokeSession(parseCookies(req).nameflare_session);
        const created = store.newSession(id);
        res.setHeader('Set-Cookie',[cookie('nameflare_session',created.raw,604800),cookie(`nameflare_oauth_${provider}`,'',0)]);
        res.writeHead(302,{ Location:'/account' }); return res.end();
      }
      if (method === 'POST' && path === '/api/logout') {
        mutation(req); store.revokeSession(parseCookies(req).nameflare_session);
        res.setHeader('Set-Cookie',cookie('nameflare_session','',0)); return json(res,200,{ ok:true });
      }
      if (method === 'POST' && path === '/api/account/profile') {
        const session = mutation(req), data = await body(req);
        assert(['twitch','kick','youtube'].includes(data.provider),400,'Choose a connected platform for your profile.');
        return json(res,200,{ user:store.updateProfile(session.id,data.provider,data) });
      }
      if (method === 'POST' && path === '/api/profiles/follow') {
        const session=mutation(req),data=await body(req);
        return json(res,200,store.setFollow(session.id,text(data.id,1,100,'Creator ID'),data.following));
      }
      if (method === 'GET' && (path === '/api/my/following' || path === '/api/my/feed')) {
        const session=requireUser(req),offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 24);
        assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
        const query=(url.searchParams.get('q') || '').slice(0,80);
        if(path==='/api/my/following'){
          const results=store.followingProfiles(session.id,{offset,limit:limit+1,query});
          return json(res,200,{users:results.slice(0,limit),next_offset:results.length>limit?offset+limit:null});
        }
        const results=store.catalog({followedBy:session.id,offset,limit:limit+1,query,...catalogFilters(url.searchParams),sort:'newest'});
        return json(res,200,{cosmetics:results.slice(0,limit).map(c=>store.publicCosmetic(c)),next_offset:results.length>limit?offset+limit:null});
      }
      if (method === 'GET' && path === '/api/admin/users') {
        requireMod(req);
        const offset = Number(url.searchParams.get('offset') || 0);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        const users = store.adminUsers({query:(url.searchParams.get('q') || '').slice(0,100),status:url.searchParams.get('status') || 'all',offset,limit:51});
        return json(res,200,{ users:users.slice(0,50), next_offset:users.length > 50 ? offset+50:null });
      }
      if (method === 'GET' && path === '/api/my/cosmetics') {
        const user = requireUser(req);
        if (!url.searchParams.has('offset') && !url.searchParams.has('limit')) return json(res,200,{ cosmetics:store.mine(user.id) });
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 24);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isInteger(limit) && limit >= 1 && limit <= 100,400,'Invalid pagination.');
        const results = store.mine(user.id,{offset,limit:limit+1});
        return json(res,200,{ cosmetics:results.slice(0,limit), next_offset:results.length > limit ? offset+limit:null });
      }
      if (method === 'POST' && path === '/api/cosmetics') {
        const session = mutation(req), data = await body(req);
        const recipe = validateRecipe(data.recipe);
        const textureIds = new Set([recipe.textureId,...(recipe.layers || []).filter(layer => layer.type === 'image').map(layer => layer.textureId)].filter(Boolean));
        for (const id of textureIds) assert(store.db.prepare('SELECT id FROM textures WHERE id=? AND owner_id=?').get(id,session.id),400,'Upload every image layer from your own account first.');
        return json(res,201,{ cosmetic:store.submit(session.id,text(data.name,2,40,'Name'),text(data.description || '',0,400,'Description'),recipe,publishingFlag(data.listed)) });
      }
      if (method === 'POST' && path === '/api/cosmetics/publication') {
        const session = mutation(req), data = await body(req);
        assert(typeof data.listed === 'boolean',400,'Public listing must be true or false.');
        return json(res,200,{ cosmetic:store.setPublication(session.id,text(data.id,1,100,'Flare ID'),data.listed) });
      }
      if (method === 'POST' && path === '/api/cosmetics/like') {
        const session = mutation(req), data = await body(req);
        assert(typeof data.liked === 'boolean',400,'Liked must be true or false.');
        return json(res,200,store.setLike(session.id,text(data.id,1,100,'Flare ID'),data.liked));
      }
      if (method === 'GET' && path === '/api/my/analytics') {
        const session = requireUser(req);
        return json(res,200,{ analytics:store.creatorAnalytics(session.id,30) });
      }
      if (method === 'GET' && path === '/api/my/likes') {
        const session = requireUser(req);
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 24);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isInteger(limit) && limit >= 1 && limit <= 100,400,'Invalid pagination.');
        const results = store.catalog({likedBy:session.id,listedOnly:true,offset,limit:limit+1,query:(url.searchParams.get('q') || '').slice(0,80),...catalogFilters(url.searchParams),sort:url.searchParams.get('sort') || 'newest'});
        return json(res,200,{ total:store.likedIds(session.id).length, cosmetics:results.slice(0,limit).map(c => store.publicCosmetic(c)), next_offset:results.length > limit ? offset+limit:null });
      }
      if (method === 'POST' && path === '/api/textures') {
        const session = mutation(req);
        const count = store.db.prepare('SELECT COUNT(*) AS n FROM textures WHERE owner_id=?').get(session.id).n;
        assert(session.role === 'owner' || count < 50,429,'Texture limit reached (50 per account).');
        assert(uploadsInFlight < 4,503,'Uploads are busy. Try again in a moment.');
        uploadsInFlight++;
        try {
          // 1. Type, size and header checks on the bytes as sent.
          const checked = validateTexture((await body(req,2900000)).data,{ formats:['gif','webp','png','jpeg','bmp'] }), kind = checked.kind, sourceHash = checked.id.split('.')[0];
          assert(!store.mediaBlocked(sourceHash),422,'Moderators have blocked this image.');
          // 2. Decode and rebuild the file in the image worker (lib/images.js).
          const clean = await images.process(kind, checked.bytes);
          const id = `${digest(clean.bytes)}.${clean.kind}`;
          assert(!store.mediaBlocked(id.split('.')[0]),422,'Moderators have blocked this image.');
          const existing = store.db.prepare('SELECT owner_id FROM textures WHERE id=?').get(id);
          assert(!existing || existing.owner_id === session.id,409,'This texture is already owned by another creator.');
          let scan = { status:'unscanned', reasons:[] };
          if (!existing) {
            // 3. Malware and content scanners, when configured (lib/media.js).
            try { scan = await scanner.scan({ original:checked.bytes, sanitized:clean.bytes, type:types[`.${clean.kind}`] }); }
            catch (error) { if (error.signature) store.audit(session.id,'upload.blocked',sourceHash,error.signature); throw error; }
            writeFileSync(textureFile(id),clean.bytes);
            store.addTexture(id,session.id,{ scan:scan.status, sourceHash });
          }
          return json(res,201,{ id, width:clean.width, height:clean.height, frames:clean.frames, removed:clean.dropped, needs_review:scan.status === 'review' });
        } finally { uploadsInFlight--; }
      }
      if (method === 'POST' && path === '/api/equip') {
        const session = mutation(req), data = await body(req);
        assert(data.cosmeticId === null || typeof data.cosmeticId === 'string',400,'Invalid cosmetic ID.');
        store.equip(session.id,data.cosmeticId); return json(res,200,{ ok:true });
      }
      if (method === 'POST' && path === '/api/admin/ban') {
        const session = mutation(req); requireMod(req);
        const data = await body(req);
        assert(typeof data.banned === 'boolean',400,'Provide a banned flag.');
        const reason = text(data.reason || '',data.banned ? 3:0,400,'Ban reason');
        return json(res,200,{ user:store.setBan(session,text(data.id,1,100,'Account ID'),data.banned,reason) });
      }
      if (method === 'GET' && path === '/api/admin/queue') {
        requireMod(req);
        const status = url.searchParams.get('status') || 'pending', offset = Number(url.searchParams.get('offset') || 0);
        assert(['pending','approved','rejected'].includes(status),400,'Invalid review status.');
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        const cosmetics = store.moderationCatalog({status,offset,limit:51,query:(url.searchParams.get('q') || '').slice(0,80)});
        return json(res,200,{ cosmetics:cosmetics.slice(0,50), stats:store.stats(), next_offset:cosmetics.length > 50 ? offset+50:null });
      }
      if (method === 'GET' && path === '/api/admin/analytics') {
        requireMod(req);
        const days = Number(url.searchParams.get('days') || 14);
        assert([7,14,30,90].includes(days),400,'Invalid analytics window.');
        return json(res,200,{ analytics:store.analytics(days) });
      }
      if (method === 'GET' && path === '/api/admin/audit/export') {
        requireMod(req);
        const format = url.searchParams.get('format') || 'csv', rows = store.auditExport(), day = new Date().toISOString().slice(0,10);
        assert(['csv','json'].includes(format),400,'Choose csv or json.');
        if (format === 'json') {
          res.writeHead(200,{ 'Content-Type':'application/json; charset=utf-8', 'Content-Disposition':`attachment; filename="nameflare-activity-${day}.json"` });
          return res.end(JSON.stringify({ format:'nameflare-activity-log', exported_at:new Date().toISOString(), entries:rows },null,2));
        }
        // Spreadsheet-safe: quote every cell and defuse leading = + - @ (formula injection).
        const cell = value => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g,'""')}"`; };
        const columns = ['id','created_at','action','actor','actor_id','target','detail'];
        res.writeHead(200,{ 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="nameflare-activity-${day}.csv"` });
        return res.end('\ufeff' + [columns.join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n') + '\r\n');
      }
      if (method === 'GET' && path === '/api/admin/audit') { requireMod(req); return json(res,200,{ entries:store.auditLog() }); }
      if (method === 'GET' && path === '/api/admin/moderators') { requireOwner(req); return json(res,200,{ moderators:store.moderators() }); }
      if (method === 'POST' && path === '/api/admin/review') {
        const session = mutation(req); requireMod(req);
        const data = await body(req);
        assert(['approved','rejected'].includes(data.status),400,'Invalid review decision.');
        const reason = text(data.reason || '',data.status === 'rejected' ? 3:0,400,'Review note');
        return json(res,200,{ cosmetic:store.review(session,text(data.id,1,100,'Cosmetic ID'),data.status,reason) });
      }
      if (method === 'POST' && path === '/api/admin/cosmetics/delete') {
        const session = mutation(req); requireMod(req);
        const data = await body(req);
        assert(data.confirm === true,400,'Confirm permanent deletion.');
        assert(data.block_images === undefined || typeof data.block_images === 'boolean',400,'block_images must be true or false.');
        const deleted = store.deleteRejected(session,text(data.id,1,100,'Flare ID'),removeTextureFile,{ blockImages:data.block_images === true });
        return json(res,200,{ ok:true, ...deleted });
      }
      if (method === 'POST' && path === '/api/reports') {
        const session = mutation(req), data = await body(req,8192);
        return json(res,201,{ report:store.report(session.id,data) });
      }
      if (method === 'GET' && path === '/api/admin/reports') {
        requireMod(req);
        const offset = Number(url.searchParams.get('offset') || 0), status = url.searchParams.get('status') || 'open';
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        const groups = store.reportQueue({ status, offset, limit:21 });
        return json(res,200,{ groups:groups.slice(0,20), open:store.openReportCount(), next_offset:groups.length > 20 ? offset+20:null });
      }
      if (method === 'POST' && path === '/api/admin/reports/resolve') {
        const session = mutation(req); requireMod(req);
        const data = await body(req);
        assert(['cosmetic','user'].includes(data.target_type) && typeof data.target_id === 'string',400,'Choose what to resolve.');
        assert(data.block_images === undefined || typeof data.block_images === 'boolean',400,'block_images must be true or false.');
        return json(res,200,store.resolveReports(session,data));
      }
      if (method === 'GET' && path === '/api/account/export') {
        const session = requireUser(req);
        res.writeHead(200,{ 'Content-Type':'application/json; charset=utf-8', 'Content-Disposition':'attachment; filename="nameflare-account.json"' });
        return res.end(JSON.stringify(store.exportAccount(session.id),null,2));
      }
      if (method === 'POST' && path === '/api/account/delete') {
        const session = mutation(req), data = await body(req);
        assert(typeof data.confirm === 'string' && data.confirm.trim() === session.name,400,'Type your account name exactly to confirm.');
        const ownRooms = store.overlayRooms(session.id).map(room => room.id), deleted = store.deleteAccount(session.id);
        for (const id of deleted.files) { try { removeTextureFile(id); } catch {} }
        for (const id of ownRooms) closeRoom(id);
        res.setHeader('Set-Cookie',cookie('nameflare_session','',0));
        return json(res,200,{ deleted:true, flares:deleted.flares });
      }
      if (method === 'POST' && path === '/api/admin/accounts/delete') {
        const session = mutation(req); requireMod(req);
        const data = await body(req);
        assert(data.confirm === true,400,'Confirm permanent deletion.');
        const target = text(data.id,1,100,'Account ID'), ownRooms = store.overlayRooms(target).map(room => room.id);
        const deleted = store.deleteAccount(target,{ actor:session, reason:data.reason });
        for (const id of deleted.files) { try { removeTextureFile(id); } catch {} }
        for (const id of ownRooms) closeRoom(id);
        return json(res,200,{ deleted:true, flares:deleted.flares });
      }
      if (method === 'GET' && path === '/api/overlay/rooms') {
        const session = requireUser(req);
        return json(res,200,{ rooms:store.overlayRooms(session.id).map(room => ({ ...room, listeners:rooms.get(room.id)?.size || 0 })) });
      }
      if (method === 'POST' && path === '/api/overlay/rooms') {
        const session = mutation(req), data = await body(req);
        return json(res,201,store.createOverlayRoom(session.id,data.name));
      }
      if (method === 'POST' && (path === '/api/overlay/rooms/rotate' || path === '/api/overlay/rooms/delete')) {
        const session = mutation(req), data = await body(req), id = text(data.id,1,40,'Room ID');
        const result = path.endsWith('rotate') ? store.rotateOverlayRoom(session.id,id) : (store.deleteOverlayRoom(session.id,id), { deleted:true });
        // Old keys stop working at once: connected overlays must reconnect with the new link.
        closeRoom(id);
        return json(res,200,result);
      }
      if (method === 'POST' && path === '/api/admin/artists') {
        const session = mutation(req); requireOwner(req);
        const data = await body(req);
        assert(typeof data.enabled === 'boolean',400,'Provide an enabled flag.');
        return json(res,200,{ user:store.setArtist(session,text(data.id,1,100,'Account ID'),data.enabled) });
      }
      if (method === 'POST' && path === '/api/admin/moderators') {
        const session = mutation(req); requireOwner(req);
        const data = await body(req);
        assert(typeof data.enabled === 'boolean' && typeof data.twitchId === 'string' && /^\d{1,30}$/.test(data.twitchId),400,'Provide a numeric Twitch ID and enabled flag.');
        store.setModerator(session,data.twitchId,data.enabled); return json(res,200,{ moderators:store.moderators() });
      }
      if (method === 'GET' && path === '/api/v1/cosmetics') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 60);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isInteger(limit) && limit >= 1 && limit <= 100,400,'Invalid pagination.');
        return publicJson(req,res,() => {
          const results = store.catalog({offset,limit:limit+1,query:(url.searchParams.get('q') || '').slice(0,80),listedOnly:true,...catalogFilters(url.searchParams),sort:url.searchParams.get('sort') || 'newest'});
          return { version:1, total:stats().public, cosmetics:results.slice(0,limit).map(c => store.publicCosmetic(c)), next_offset:results.length > limit ? offset+limit:null };
        });
      }
      if (method === 'GET' && (path === '/api/v1' || path === '/api/v1/')) {
        return publicJson(req,res,() => ({ version:1, name:'Nameflare', origin, features:{ resolve:true, batch:true, lookup:true, changes:true, overlay_relay:true, overlay_rooms:true, stats:true, wearers:true },
          endpoints:['GET /api/v1/stats','GET /api/v1/cosmetics','GET /api/v1/cosmetics/:id','GET /api/v1/cosmetics/:id/stats','GET /api/v1/cosmetics/:id/wearers','GET /api/v1/cosmetics/batch?ids=','GET /api/v1/cosmetics/lookup?name=','GET /api/v1/profiles','GET /api/v1/profiles/:id','GET /api/v1/profiles/:id/cosmetics','GET /api/v1/profiles/:id/accounts','GET /api/v1/profiles/:id/stats','GET /api/v1/artists','GET /api/v1/users/:provider/:id','GET /api/v1/users/:provider/:id/profile','GET /api/v1/users/:provider/:id/cosmetics','POST /api/v1/resolve','GET /api/v1/changes'],
          limits:{ resolve_ids:100, batch_ids:100, page:100, reads_per_minute:600, resolves_per_minute:240 },
          timing:{ public_cache_s:PUBLIC_TTL/1000, changes_poll_ms:4000, client_refresh_ms:7000, client_expiry_ms:12000 } }));
      }
      if (method === 'GET' && path === '/api/v1/cosmetics/batch') {
        const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean))];
        assert(ids.length >= 1 && ids.length <= 100 && ids.every(id => /^[a-zA-Z0-9-]{1,100}$/.test(id)),400,'Provide 1–100 comma-separated Flare IDs.');
        return publicJson(req,res,() => ({ cosmetics:store.cosmeticsByIds(ids).map(c => store.publicCosmetic(c)).filter(Boolean) }));
      }
      if (method === 'GET' && path === '/api/v1/cosmetics/lookup') {
        const name = text(url.searchParams.get('name') || '',1,40,'Flare name');
        return publicJson(req,res,() => ({ cosmetics:store.cosmeticsByName(name).map(c => store.publicCosmetic(c)) }));
      }
      if (method === 'GET' && path === '/api/v1/changes') {
        res.setHeader('Access-Control-Allow-Origin','*');
        const since = Number(url.searchParams.get('since') ?? NaN), oldest = feed.events[0]?.seq ?? feed.seq + 1;
        const base = { epoch:feed.epoch, cursor:feed.seq, poll_ms:4000 };
        // Unknown epoch, a cursor from the future, or one older than the retained
        // window: the client cannot know what it missed, so it revalidates all.
        if (url.searchParams.get('epoch') !== feed.epoch || !Number.isInteger(since) || since < 0 || since > feed.seq || since < oldest - 1) return json(res,200,{ ...base, reset:true, identities:[], cosmetics:[] });
        const identities = new Map(), cosmetics = new Set();
        for (let i = feed.events.length - 1; i >= 0 && feed.events[i].seq > since; i--) {
          const event = feed.events[i];
          if (event.cosmetic) cosmetics.add(event.cosmetic);
          for (const [provider, id] of event.identities || []) identities.set(`${provider}:${id}`, { provider, provider_id:id });
        }
        if (identities.size > FEED_MAX_IDENTITIES) return json(res,200,{ ...base, reset:true, identities:[], cosmetics:[] });
        return json(res,200,{ ...base, reset:false, identities:[...identities.values()], cosmetics:[...cosmetics] });
      }
      // ---- Statistics and listings (all public, approved-only, banned accounts excluded)
      const page = (fallback = 50) => {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || fallback);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isInteger(limit) && limit >= 1 && limit <= 100,400,'Invalid pagination.');
        return { offset, limit };
      };
      if (method === 'GET' && path === '/api/v1/stats') return publicJson(req,res,() => ({ ...store.publicStats(), generated_at:new Date().toISOString() }));
      const cosmeticSub = /^\/api\/v1\/cosmetics\/([a-zA-Z0-9-]+)\/(wearers|stats)$/.exec(path);
      if (method === 'GET' && cosmeticSub) {
        const [, id, kind] = cosmeticSub;
        assert(store.publicCosmetic(store.getCosmetic(id)),404,'Approved cosmetic not found.');
        if (kind === 'stats') return publicJson(req,res,() => ({ stats:store.cosmeticStats(id) }));
        const { offset, limit } = page();
        return publicJson(req,res,() => { const result = store.wearers(id,{ offset, limit }); return { id, total:result.total, users:result.users, next_offset:offset + result.users.length < result.total ? offset + limit : null }; });
      }
      const profileSub = /^\/api\/v1\/profiles\/([a-zA-Z0-9-]+)\/(accounts|stats)$/.exec(path);
      if (method === 'GET' && profileSub) {
        const [, id, kind] = profileSub;
        assert(store.publicProfile(id),404,'Profile not found.');
        return publicJson(req,res,() => kind === 'stats' ? { stats:store.profileStats(id) } : { id, accounts:store.identities(id).map(identity => ({ ...identity, url:{ twitch:`https://www.twitch.tv/${identity.login}`, kick:`https://kick.com/${identity.login}`, youtube:`https://www.youtube.com/channel/${identity.provider_id}` }[identity.provider] })) });
      }
      const identitySub = /^\/api\/v1\/users\/(twitch|kick|youtube)\/([^/]+)\/(profile|cosmetics)$/.exec(path);
      if (method === 'GET' && identitySub) {
        const userId = store.userIdByIdentity(identitySub[1],decodeURIComponent(identitySub[2]));
        assert(userId && store.publicProfile(userId),404,'No linked identity found.');
        if (identitySub[3] === 'profile') return publicJson(req,res,() => ({ user:store.publicProfile(userId) }));
        const { offset, limit } = page(24);
        return publicJson(req,res,() => { const results = store.catalog({owner:userId,listedOnly:true,offset,limit:limit+1}); return { user_id:userId, cosmetics:results.slice(0,limit).map(c => store.publicCosmetic(c)), next_offset:results.length > limit ? offset+limit:null }; });
      }
      const cosmeticMatch = /^\/api\/v1\/cosmetics\/([a-zA-Z0-9-]+)$/.exec(path);
      if (method === 'GET' && cosmeticMatch) {
        assert(store.publicCosmetic(store.getCosmetic(cosmeticMatch[1])),404,'Approved cosmetic not found.');
        return publicJson(req,res,() => ({ cosmetic:store.publicCosmetic(store.getCosmetic(cosmeticMatch[1])) }));
      }
      if (method === 'GET' && path === '/api/v1/artists') {
        const offset = Number(url.searchParams.get('offset') || 0);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        return publicJson(req,res,() => { const users = store.artistShowcase({query:(url.searchParams.get('q') || '').slice(0,80),offset,limit:25}); return { users:users.slice(0,24),next_offset:users.length > 24 ? offset+24:null }; });
      }
      if (method === 'GET' && path === '/api/v1/profiles') {
        const offset = Number(url.searchParams.get('offset') || 0);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000,400,'Invalid pagination.');
        const sort = url.searchParams.get('sort') || 'name';
        assert(['name','newest','oldest'].includes(sort),400,'Sort by name, newest, or oldest.');
        return publicJson(req,res,() => { const users = store.searchProfiles({query:(url.searchParams.get('q') || '').slice(0,80),offset,limit:25,sort}); return { total:store.countProfiles(), users:users.slice(0,24),next_offset:users.length > 24 ? offset+24:null }; });
      }
      const profileFlares = /^\/api\/v1\/profiles\/([a-zA-Z0-9-]+)\/cosmetics$/.exec(path);
      if (method === 'GET' && profileFlares) {
        assert(store.publicProfile(profileFlares[1]),404,'Profile not found.');
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 24);
        assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isInteger(limit) && limit >= 1 && limit <= 100,400,'Invalid pagination.');
        return publicJson(req,res,() => { const results = store.catalog({owner:profileFlares[1],listedOnly:true,offset,limit:limit+1}); return { cosmetics:results.slice(0,limit).map(c => store.publicCosmetic(c)), next_offset:results.length > limit ? offset+limit:null }; });
      }
      const profileMatch = /^\/api\/v1\/profiles\/([a-zA-Z0-9-]+)$/.exec(path);
      if (method === 'GET' && profileMatch) {
        assert(store.publicProfile(profileMatch[1]),404,'Profile not found.');
        return publicJson(req,res,() => ({ user:store.publicProfile(profileMatch[1]) }));
      }
      const identityMatch = /^\/api\/v1\/users\/(twitch|kick|youtube)\/([^/]+)$/.exec(path);
      if (method === 'GET' && identityMatch) {
        const identity = resolveIdentity(identityMatch[1],decodeURIComponent(identityMatch[2]));
        assert(identity,404,'No linked identity found.'); return publicJson(req,res,() => ({ user:identity }));
      }
      if (method === 'POST' && path === '/api/v1/resolve') {
        const data = await body(req,16384);
        assert(['twitch','kick','youtube'].includes(data.provider) && Array.isArray(data.ids) && data.ids.length <= 100 && data.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100),400,'Provide a platform and up to 100 string user IDs.');
        res.setHeader('Cache-Control','no-store');
        return json(res,200,{ users:[...new Set(data.ids)].map(id => resolveIdentity(data.provider,id)).filter(Boolean) });
      }
      const texture = /^\/textures\/([a-f0-9]{64}\.(gif|png|webp|jpg))$/.exec(path);
      if (method === 'GET' && texture) {
        const id = texture[1];
        assert(existsSync(join(dataDir,'textures',id)),404,'Texture not found.');
        let approval = textureApproval.get(id);
        if (!fresh(approval)) {
          // instr() narrows to recipes that mention the ID before any JSON is parsed.
          const approved = Boolean(store.db.prepare("SELECT c.id FROM cosmetics c WHERE c.status='approved' AND instr(c.recipe,?)>0 AND (json_extract(c.recipe,'$.textureId')=? OR EXISTS (SELECT 1 FROM json_each(c.recipe,'$.layers') layer WHERE json_extract(layer.value,'$.textureId')=?)) LIMIT 1").get(id,id,id));
          approval = { approved, expires:Date.now() + PUBLIC_TTL, generation:store.generation };
          if (textureApproval.size >= 5000) textureApproval.clear();
          textureApproval.set(id, approval);
        }
        if (!approval.approved) {
          const session = requireUser(req);
          assert(['owner','moderator'].includes(session.role) || store.db.prepare('SELECT id FROM textures WHERE id=? AND owner_id=?').get(id,session.id),403,'This texture is awaiting approval.');
          res.setHeader('Cache-Control','private, no-store');
        } else { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','public, max-age=15, must-revalidate'); }
        // The ID is the file's SHA-256, so it is a perfect validator.
        res.setHeader('ETag',`"${id}"`);
        if (req.headers['if-none-match'] === `"${id}"`) { res.writeHead(304); return res.end(); }
        let bytes;
        try { bytes = await readFile(join(dataDir,'textures',id)); } catch { throw new HttpError(404,'Texture not found.'); }
        res.writeHead(200,{'Content-Type':types[`.${id.split('.').pop()}`],'Content-Length':bytes.length}); return res.end(bytes);
      }
      if (method === 'GET' && path === '/api/overlay/events') {
        // Each relay room has its own read key (?room=<id>&key=<key>). The
        // operator's single env-configured room (?room=<OVERLAY_ROOM_KEY>) still works.
        const roomParam = url.searchParams.get('room'), key = url.searchParams.get('key');
        let roomId;
        if (key !== null) { assert(store.overlayRoomReadable(roomParam,key),403,'Invalid overlay room.'); roomId = roomParam; }
        else { assert(env.OVERLAY_ROOM_KEY && safeEqual(roomParam,env.OVERLAY_ROOM_KEY),403,'Invalid overlay room.'); roomId = 'legacy'; }
        const listeners = rooms.get(roomId) || new Set();
        assert(getSession(req)?.role === 'owner' || (streams.size < 200 && listeners.size < 10),503,'Overlay capacity reached.');
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(': connected\n\n'); rooms.set(roomId,listeners); listeners.add(res); streams.add(res);
        req.on('close',() => { streams.delete(res); listeners.delete(res); if (!listeners.size && rooms.get(roomId) === listeners) rooms.delete(roomId); });
        return;
      }
      if (method === 'POST' && path === '/api/overlay/messages') {
        // The bearer token picks the room: a room's own ingest token, or the operator's OVERLAY_INGEST_TOKEN.
        const authorization = String(req.headers.authorization || ''), bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        let roomId = store.overlayRoomForIngest(bearer);
        if (!roomId && env.OVERLAY_INGEST_TOKEN && safeEqual(authorization,`Bearer ${env.OVERLAY_INGEST_TOKEN}`)) roomId = 'legacy';
        assert(roomId,401,'Valid overlay ingest token required.');
        const data = await body(req,8192);
        assert(['twitch','kick','youtube'].includes(data.provider),400,'Invalid platform.');
        const message = { provider:data.provider, provider_id:text(data.provider_id,1,100,'User ID'), name:text(data.name,1,80,'Display name'), text:text(data.text,1,1000,'Message') };
        const listeners = rooms.get(roomId) || [];
        for (const response of listeners) response.write(`data: ${JSON.stringify(message)}\n\n`);
        return json(res,202,{ accepted:true, listeners:listeners.size || 0 });
      }
      if (method === 'GET' || method === 'HEAD') {
        const pages = { '/fonts/BricolageGrotesque.ttf':'fonts/BricolageGrotesque.ttf', '/fonts/OFL.txt':'fonts/OFL.txt', '/fonts/NotoSans-latin.woff2':'fonts/NotoSans-latin.woff2', '/fonts/NotoSans-latin-ext.woff2':'fonts/NotoSans-latin-ext.woff2', '/fonts/NotoSans-OFL.txt':'fonts/NotoSans-OFL.txt', '/fonts/GeistMono-latin.woff2':'fonts/GeistMono-latin.woff2', '/fonts/Geist-OFL.txt':'fonts/Geist-OFL.txt', '/fonts/BricolageGrotesque-latin.woff2':'fonts/BricolageGrotesque-latin.woff2', '/logo.svg':'logo.svg', '/favicon.ico':'logo.svg', '/':'index.html', '/guide':'index.html', '/overlay':'overlay.html', '/index.html':'index.html', '/overlay.html':'overlay.html', '/ui/tokens.css':'ui/tokens.css', '/ui/kit.css':'ui/kit.css', '/ui/shell.css':'ui/shell.css', '/ui/frame.css':'ui/frame.css', '/ui/views.css':'ui/views.css', '/ui/studio.css':'ui/studio.css', '/ui/admin.css':'ui/admin.css', '/ui/stage.css':'ui/stage.css', '/ui/slim.css':'ui/slim.css', '/ui/profiles.css':'ui/profiles.css', '/ui/calm.css':'ui/calm.css', '/icons.js':'icons.js', '/wa-test.html':'wa-test.html', '/app.js':'app.js', '/likes.js':'likes.js', '/style.css':'style.css', '/redesign.css':'redesign.css', '/social.css':'social.css', '/theme-init.js':'theme-init.js', '/social.js':'social.js', '/preferences.js':'preferences.js', '/insights.js':'insights.js', '/rail.js':'rail.js', '/experience.js':'experience.js', '/vendor/basecoat/basecoat.css':'vendor/basecoat/basecoat.css', '/vendor/basecoat/all.min.js':'vendor/basecoat/all.min.js', '/vendor/basecoat/LICENSE.md':'vendor/basecoat/LICENSE.md', '/fonts.js':'fonts.js', '/google-fonts.json':'google-fonts.json', '/renderer.js':'renderer.js', '/overlay.js':'overlay.js', '/overlay.css':'overlay.css', '/effects.css':'effects.css', '/paints.js':'paints.js', '/editor.js':'editor.js', '/client.js':'client.js', '/SDK-LICENSE.md':'SDK-LICENSE.md', '/donate.js':'donate.js', '/vendor/qrcode/qrcode.js':'vendor/qrcode/qrcode.js', '/vendor/qrcode/LICENSE.txt':'vendor/qrcode/LICENSE.txt' };
        const file = isAppPath(path) ? 'index.html' : path==='/routes.js' ? 'routes.js' : pages[path];
        if (file) return sendStatic(req,res,file,staticCacheControl(file));
        // Web Awesome is vendored verbatim so the component runtime and its
        // lazy-loaded chunks work without a build step or a CDN dependency.
        if (path.startsWith('/vendor/webawesome/') && /^\/vendor\/webawesome\/[A-Za-z0-9._/-]+$/.test(path) && !path.includes('..')) {
          const vendorFile = path.slice(1), extension = `.${vendorFile.split('.').pop()}`;
          if (types[extension]) {
            try { return sendStatic(req,res,vendorFile,staticCacheControl(vendorFile)); } catch {}
          }
        }
      }
      throw new HttpError(404,'Not found.');
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!(error instanceof HttpError)) console.error('Request failed:',error.message);
      if (error.retryAfter) res.setHeader('Retry-After',String(error.retryAfter));
      json(res,error.status || 500,{ error:error instanceof HttpError ? error.message:'Something went wrong. Please try again.' });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 20000;
  server.on('close',() => { clearInterval(cleanup); clearTimeout(firstMaintenance); clearInterval(maintenanceTimer); images.close(); unsubscribe?.(); for (const response of streams) response.end(); });
  return { server, store, maintenance };
}

// Node resolves ESM filenames through symlinks, but argv retains the launch path.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const demo = process.argv.includes('--demo');
  const port = Number(process.env.PORT || 3000);
  const host = demo ? '127.0.0.1' : (process.env.HOST || '127.0.0.1');
  const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/,'');
  if (demo && process.env.NODE_ENV === 'production') throw new Error('Demo mode is forbidden in production.');
  if (demo && !['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Demo mode requires a loopback PUBLIC_BASE_URL.');
  if (process.env.NODE_ENV === 'production') {
    if (!baseUrl.startsWith('https://') || !/^\d+$/.test(process.env.OWNER_TWITCH_ID || '')) throw new Error('Production needs an HTTPS PUBLIC_BASE_URL and numeric OWNER_TWITCH_ID.');
  }
  const dataDir = resolve(process.env.DATA_DIR || join(root,demo ? 'data-demo':'data'));
  mkdirSync(dataDir,{recursive:true});
  const {server,store} = createApp({store:new Store(join(dataDir,'nameflare.sqlite')),baseUrl,demo,dataDir});
  // scripts/restore.js refuses to replace data while this process is alive.
  const pidFile = join(dataDir,'server.pid');
  server.listen(port,host,() => { writeFileSync(pidFile,String(process.pid)); console.log(`Nameflare ${demo ? 'isolated DEMO':'server'} ready at ${baseUrl}`); });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => {
    server.close(() => { store.close(); rmSync(pidFile,{ force:true }); process.exit(0); });
    setTimeout(() => process.exit(1),5000).unref();
  });
}
