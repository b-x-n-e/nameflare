// Optional Cloudflare edge cache in front of the official service.
//
// Off unless CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN are set. Long edge
// caching is only safe when revocation can take it back, so the two arrive
// together: approved textures get a Cloudflare-only cache lifetime, and when a
// texture stops being public (Flare disapproved, banned or deleted) its URL is
// purged from Cloudflare.
//
// Browsers keep the 15-second freshness window either way. They revalidate
// against the nearest Cloudflare location, which answers 304 from its cache,
// so the origin sends each texture about once per location per lifetime
// instead of once per overlay.
//
// `Cloudflare-CDN-Cache-Control` is read by Cloudflare only: another CDN put in
// front by mistake would keep the short public lifetime, which needs no purge.
const ZONE = /^[a-f0-9]{32}$/;
const PURGE_BATCH = 30; // URLs per request on every Cloudflare plan
const RETRY_MS = [1000, 5000, 30000];
// A request that passed the approval check just before a revocation can still
// be filling the edge as the first purge lands. One repeat closes that window.
const REPEAT_MS = 30000;

const integer = (value, fallback, min, max) => {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Expected an integer from ${min} to ${max}, got "${value}".`);
  return number;
};

export function createEdge({ env = process.env, baseUrl, fetchImpl = (...args) => globalThis.fetch(...args), log = console, schedule = setTimeout } = {}) {
  const zone = env.CLOUDFLARE_ZONE_ID || '', token = env.CLOUDFLARE_PURGE_TOKEN || '';
  if (Boolean(zone) !== Boolean(token)) throw new Error('Set both CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN, or neither.');
  if (zone && !ZONE.test(zone)) throw new Error('CLOUDFLARE_ZONE_ID must be the 32-character zone ID.');
  const enabled = Boolean(zone);
  // One day by default: if every purge attempt fails, a revoked image still
  // leaves the edge within a day. Up to a year is allowed.
  const textureTtl = integer(env.EDGE_TEXTURE_TTL, 86400, 60, 31536000);
  // Every up-to-date overlay asks the change feed the same question, so a
  // couple of seconds at the edge collapses thousands of polls into one.
  // 0 turns it off. Overlays poll every 4s, so 10s is the most that is useful.
  const feedTtl = integer(env.EDGE_FEED_TTL, 2, 0, 10);
  const origin = new URL(baseUrl).origin;
  const timers = new Set();
  let closed = false;
  const later = (fn, ms) => { const timer = schedule(() => { timers.delete(timer); if (!closed) fn(); }, ms); timer?.unref?.(); timers.add(timer); };

  async function send(urls, attempt) {
    try {
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ files:urls }), signal:AbortSignal.timeout(10000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(`HTTP ${response.status}${data.errors?.[0]?.message ? `: ${data.errors[0].message}` : ''}`);
    } catch (error) {
      if (attempt < RETRY_MS.length) return later(() => void send(urls, attempt + 1), RETRY_MS[attempt]);
      // Never log the token. The URLs are public texture paths.
      log.error(`Edge purge failed after ${attempt + 1} attempts (${error.message}). Purge by hand: ${urls.join(' ')}`);
    }
  }
  function purge(textureIds) {
    if (!enabled || closed) return;
    const urls = [...new Set(textureIds)].map(id => `${origin}/textures/${id}`);
    for (let i = 0; i < urls.length; i += PURGE_BATCH) {
      const batch = urls.slice(i, i + PURGE_BATCH);
      void send(batch, 0);
      later(() => void send(batch, 0), REPEAT_MS);
    }
  }
  return {
    enabled,
    textureTtl,
    feedTtl,
    // Header values for Cloudflare only; null means "send nothing extra".
    textureHeader: enabled ? `public, max-age=${textureTtl}` : null,
    feedHeader: enabled && feedTtl ? `public, max-age=${feedTtl}` : null,
    purge,
    close() { closed = true; for (const timer of timers) clearTimeout(timer); timers.clear(); }
  };
}
