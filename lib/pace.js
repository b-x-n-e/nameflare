// Change-feed pacing. Overlays poll GET /api/v1/changes as often as the
// answer's poll_ms says (the SDK accepts 2-30s). When many overlays are
// connected the server asks them to poll less often, trading a few seconds of
// change latency for fewer requests on a small machine.
//
// The interval comes from an estimate of how many overlays are polling, not
// from the request rate itself. Slowing overlays down lowers the rate but not
// the number of overlays, so the interval settles instead of see-sawing.
//
// Two load signals, whichever is higher:
// - feed requests Node answers, times the interval they were told to use;
// - with NGINX_STATUS_URL, nginx's active connections (stub_status). Each
//   overlay holds one keep-alive connection, and unlike Node's count this
//   still sees polls that nginx's micro-cache answers itself.
const TICK_MS = 5000;
const BASE_MS = 4000;

const integer = (value, fallback, min, max, name) => {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return number;
};

export function parseStubStatus(body) {
  const match = /^Active connections:\s*(\d+)/m.exec(String(body));
  return match ? Number(match[1]) : null;
}

export function createFeedPace({ env = process.env, fetchImpl = (...args) => globalThis.fetch(...args), tick = true, log = console } = {}) {
  // Feed polls a second the server is happy to answer before slowing down.
  // 100/s is 400 overlays at the normal 4s interval.
  const targetRps = integer(env.FEED_POLL_TARGET_RPS, 100, 1, 100000, 'FEED_POLL_TARGET_RPS');
  // The slowest interval to ask for. Changes reach overlays within about this long.
  const maxMs = integer(env.FEED_POLL_MAX_MS, 15000, BASE_MS, 30000, 'FEED_POLL_MAX_MS');
  const statusUrl = env.NGINX_STATUS_URL || '';
  if (statusUrl) {
    let parsed; try { parsed = new URL(statusUrl); } catch { throw new Error('NGINX_STATUS_URL must be a URL.'); }
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('NGINX_STATUS_URL must be a plain-HTTP loopback address.');
  }
  let seen = 0, pollMs = BASE_MS, told = BASE_MS, estimate = 0, connections = 0, statusWarned = false, timer = null;

  const intervalFor = overlays => {
    const wanted = overlays * 1000 / targetRps;
    return Math.min(maxMs, Math.max(BASE_MS, Math.ceil(wanted / 500) * 500));
  };
  async function readStatus() {
    try {
      const response = await fetchImpl(statusUrl, { signal:AbortSignal.timeout(2000) });
      const active = parseStubStatus(await response.text());
      if (!response.ok || active === null) throw new Error(`unexpected answer (HTTP ${response.status})`);
      connections = active; statusWarned = false;
    } catch (error) {
      connections = 0;
      if (!statusWarned) { statusWarned = true; log.error(`Feed pacing cannot read NGINX_STATUS_URL (${error.message}); using Node's own count.`); }
    }
  }
  // One step: fold the last window into the estimate and pick the interval.
  function update(windowMs = TICK_MS) {
    // Polls in this window follow the interval answered in the previous one.
    const fromNode = seen / (windowMs / 1000) * (told / 1000);
    seen = 0; told = pollMs;
    const sample = Math.max(fromNode, connections);
    // Rise quickly, settle slowly: a raid of overlays is slowed at once,
    // and a brief lull does not snap everyone back to 4s.
    estimate = sample > estimate ? sample : estimate * 0.8 + sample * 0.2;
    pollMs = intervalFor(estimate);
    return pollMs;
  }
  if (tick) {
    timer = setInterval(async () => { if (statusUrl) await readStatus(); update(); }, TICK_MS);
    timer.unref?.();
  }
  return {
    seen() { seen++; },
    pollMs: () => pollMs,
    estimate: () => estimate,
    update,
    readStatus,
    close() { if (timer) clearInterval(timer); timer = null; }
  };
}
