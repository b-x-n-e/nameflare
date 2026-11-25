import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedPace, parseStubStatus } from '../lib/pace.js';

// Simulates `overlays` clients that each poll once per interval they were told.
function run(pace, overlays, ticks) {
  const intervals = [];
  let told = pace.pollMs();
  for (let i = 0; i < ticks; i++) {
    const polls = Math.round(overlays * 5000 / told);
    for (let n = 0; n < polls; n++) pace.seen();
    told = pace.pollMs();
    intervals.push(pace.update());
  }
  return intervals;
}

test('feed pacing stays at 4s under the target, slows with load, and settles without see-sawing', () => {
  const quiet = createFeedPace({ env:{}, tick:false });
  assert.deepEqual(run(quiet, 300, 6), Array(6).fill(4000));

  const busy = createFeedPace({ env:{}, tick:false });
  const intervals = run(busy, 1000, 12);
  // 1,000 overlays at 100 polls/s wants 10s.
  assert.equal(intervals[0], 10000);
  assert.ok(intervals.every(ms => ms === 10000), `steady at 10s, got ${intervals}`);

  const raid = createFeedPace({ env:{}, tick:false });
  assert.equal(run(raid, 5000, 3).at(-1), 15000, 'capped at FEED_POLL_MAX_MS');
  // After the raid ends it eases back down rather than snapping to 4s.
  const after = run(raid, 200, 20);
  assert.ok(after[0] > 4000 && after.at(-1) === 4000, `eases back: ${after}`);
  for (let i = 1; i < after.length; i++) assert.ok(after[i] <= after[i - 1]);
});

test('feed pacing settings are validated', () => {
  const tuned = createFeedPace({ env:{ FEED_POLL_TARGET_RPS:'50', FEED_POLL_MAX_MS:'30000' }, tick:false });
  assert.equal(run(tuned, 1000, 2).at(-1), 20000);
  assert.throws(() => createFeedPace({ env:{ FEED_POLL_MAX_MS:'31000' }, tick:false }), /FEED_POLL_MAX_MS/);
  assert.throws(() => createFeedPace({ env:{ FEED_POLL_MAX_MS:'3000' }, tick:false }), /FEED_POLL_MAX_MS/);
  assert.throws(() => createFeedPace({ env:{ FEED_POLL_TARGET_RPS:'0' }, tick:false }), /FEED_POLL_TARGET_RPS/);
  assert.throws(() => createFeedPace({ env:{ NGINX_STATUS_URL:'https://example.com/status' }, tick:false }), /loopback/);
  assert.throws(() => createFeedPace({ env:{ NGINX_STATUS_URL:'http://10.0.0.5/status' }, tick:false }), /loopback/);
  createFeedPace({ env:{ NGINX_STATUS_URL:'http://127.0.0.1:8081/nginx_status' }, tick:false });
});

test('nginx active connections count overlays Node never sees, such as micro-cache hits', async () => {
  assert.equal(parseStubStatus('Active connections: 2412 \nserver accepts handled requests\n 1 1 1 \nReading: 0 Writing: 1 Waiting: 2411 \n'), 2412);
  assert.equal(parseStubStatus('<html>nope</html>'), null);
  let body = 'Active connections: 2000 \n', ok = true;
  const errors = [];
  const pace = createFeedPace({ env:{ NGINX_STATUS_URL:'http://127.0.0.1:8081/nginx_status' }, tick:false, log:{ error: m => errors.push(m) },
    fetchImpl: async () => ok ? new Response(body) : Promise.reject(new Error('refused')) });
  // Node sees only a trickle (the cache answers the rest), nginx sees 2,000 connections.
  await pace.readStatus(); pace.seen(); assert.equal(pace.update(), 15000);
  body = 'Active connections: 600 \n';
  await pace.readStatus(); let last; for (let i = 0; i < 30; i++) last = pace.update();
  // 600 connections wants 6s; the estimate approaches it from above and rounds up to the next 0.5s.
  assert.ok(last >= 6000 && last <= 6500, `settles near 6s, got ${last}`);
  // Status unreachable: warn once and fall back to Node's own count.
  ok = false; await pace.readStatus(); await pace.readStatus();
  assert.equal(errors.length, 1); assert.match(errors[0], /NGINX_STATUS_URL/);
});
