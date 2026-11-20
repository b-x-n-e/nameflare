// Several moderators at once: conflicts, undo, bulk decisions, reports that
// arrive mid-decision, suspensions, staff notes, presence and live updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';

const recipe = { colors:['#ff1a35','#ffffff'], animation:'none', speed:4, angle:120, glow:0 };

async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-moderation-')), store = new Store(join(dir, 'db.sqlite'));
  store.seedDemo();
  // A second moderator, so two people can moderate at the same time.
  const second = store.linkIdentity({ provider:'twitch', id:'2004', login:'vega', name:'vega' });
  store.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(second);
  store.db.prepare("UPDATE users SET role='artist' WHERE id='demo-creator'").run();
  const app = createApp({ store, dataDir:dir, baseUrl:'http://localhost', env:{} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessions = { owner:store.newSession('demo-owner'), nova:store.newSession('demo-mod'), vega:store.newSession(second), creator:store.newSession('demo-creator') };
  const call = async (path, data, session) => {
    const response = await fetch(base + path, { method:data === undefined ? 'GET' : 'POST', headers:{ ...(data === undefined ? {} : { 'Content-Type':'application/json', Origin:'http://localhost' }), ...(session ? { Cookie:`nameflare_session=${session.raw}`, 'X-CSRF-Token':session.csrf } : {}) }, body:data === undefined ? undefined : JSON.stringify(data) });
    return { status:response.status, body:await response.json() };
  };
  // Pending Flares inserted directly, so tests are not bound by submission caps.
  let made = 0;
  const pending = name => { const id = `test-${++made}`; store.db.prepare("INSERT INTO cosmetics (id,owner_id,name,description,recipe,status,created_at) VALUES (?,?,?,?,?,'pending',?)").run(id, 'demo-creator', name, '', JSON.stringify(recipe), new Date(Date.now() - 1000 * (100 - made)).toISOString()); return id; };
  try { await fn({ store, call, sessions, pending, second }); }
  finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(dir, { recursive:true, force:true }); }
}

test('two moderators deciding the same Flare at once: exactly one wins, the other is told who and when', async () => {
  await withApp(async ({ call, sessions, pending, store }) => {
    for (let round = 0; round < 5; round++) {
      const id = pending(`Race ${round}`);
      const [a, b] = await Promise.all([
        call('/api/admin/review', { id, status:'approved', expect:'pending' }, sessions.nova),
        call('/api/admin/review', { id, status:'rejected', reason:'Too dark', expect:'pending' }, sessions.vega)
      ]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409]);
      const loser = a.status === 409 ? a : b, winner = a.status === 200 ? 'nova' : 'vega';
      assert.match(loser.body.error, new RegExp(`^Already (approved|disapproved) by ${winner} just now\\.$`));
      assert.equal(loser.body.conflict.reviewer, winner);
      assert.equal(store.auditLog().filter(entry => entry.target === id && /^cosmetic\.(approved|rejected)$/.test(entry.action)).length, 1, 'One decision recorded');
    }
  });
});

test('a decision on stale state is refused instead of overwriting the newer one', async () => {
  await withApp(async ({ call, sessions, pending }) => {
    const id = pending('Stale');
    assert.equal((await call('/api/admin/review', { id, status:'approved', expect:'pending' }, sessions.owner)).status, 200);
    const stale = await call('/api/admin/review', { id, status:'rejected', reason:'Looks off', expect:'pending' }, sessions.nova);
    assert.equal(stale.status, 409); assert.match(stale.body.error, /Already approved by orbit/);
    // Revoking on purpose, with the current state, still works.
    assert.equal((await call('/api/admin/review', { id, status:'rejected', reason:'Revoked on purpose', expect:'approved' }, sessions.nova)).status, 200);
  });
});

test('undo puts a Flare back where it was, takes back the notification, and refuses once someone else acted', async () => {
  await withApp(async ({ call, sessions, pending, store }) => {
    const id = pending('Undo me');
    await call('/api/admin/review', { id, status:'rejected', reason:'Wrong colours', expect:'pending' }, sessions.nova);
    assert.ok(store.notifications('demo-creator').some(item => item.target === id && item.kind === 'rejected'));
    const undone = await call('/api/admin/review/undo', { id }, sessions.nova);
    assert.equal(undone.status, 200); assert.equal(undone.body.cosmetic.status, 'pending'); assert.equal(undone.body.cosmetic.reviewer_id, null);
    assert.equal(store.notifications('demo-creator').some(item => item.target === id && item.kind === 'rejected'), false);
    assert.ok(store.auditLog().some(entry => entry.action === 'cosmetic.reopened' && entry.target === id));
    assert.equal((await call('/api/admin/review/undo', { id }, sessions.nova)).status, 409, 'Nothing left to undo');
    await call('/api/admin/review', { id, status:'approved', expect:'pending' }, sessions.vega);
    const other = await call('/api/admin/review/undo', { id }, sessions.nova);
    assert.equal(other.status, 409); assert.match(other.body.error, /Already approved by vega/);
    store.db.prepare('UPDATE cosmetics SET reviewed_at=? WHERE id=?').run(new Date(Date.now() - 11 * 60000).toISOString(), id);
    assert.match((await call('/api/admin/review/undo', { id }, sessions.vega)).body.error, /10 minutes/);
  });
});

test('bulk decisions apply each one on its own and report the ones someone else decided first', async () => {
  await withApp(async ({ call, sessions, pending }) => {
    const ids = [pending('Bulk 1'), pending('Bulk 2'), pending('Bulk 3')];
    await call('/api/admin/review', { id:ids[1], status:'rejected', reason:'Already handled', expect:'pending' }, sessions.vega);
    const bulk = await call('/api/admin/review/bulk', { ids, status:'approved' }, sessions.nova);
    assert.equal(bulk.status, 200); assert.equal(bulk.body.done, 2);
    assert.deepEqual(bulk.body.results.map(result => result.ok), [true, false, true]);
    assert.match(bulk.body.results[1].error, /Already disapproved by vega/);
    assert.equal((await call('/api/admin/review/bulk', { ids, status:'rejected' }, sessions.nova)).status, 400, 'Disapproval needs a note');
    assert.equal((await call('/api/admin/review/bulk', { ids, status:'approved' }, sessions.creator)).status, 403);
  });
});

test('resolving reports only closes the ones the moderator saw; a second moderator is told it is done', async () => {
  await withApp(async ({ call, sessions, store }) => {
    const reporter = store.newSession(store.linkIdentity({ provider:'twitch', id:'3001', login:'r1', name:'r1' }));
    const late = store.newSession(store.linkIdentity({ provider:'twitch', id:'3002', login:'r2', name:'r2' }));
    await call('/api/reports', { target_type:'cosmetic', target_id:'demo-1', reason:'spam' }, reporter);
    const seen = (await call('/api/admin/reports', undefined, sessions.nova)).body.groups[0];
    const seenThrough = Math.max(...seen.items.map(item => item.id));
    // A new report lands while nova is still deciding.
    await call('/api/reports', { target_type:'cosmetic', target_id:'demo-1', reason:'hate' }, late);
    const resolved = await call('/api/admin/reports/resolve', { target_type:'cosmetic', target_id:'demo-1', action:'dismiss', seen_through:seenThrough }, sessions.nova);
    assert.equal(resolved.body.resolved, 1); assert.equal(resolved.body.remaining, 1, 'The new report stays open');
    const again = await call('/api/admin/reports/resolve', { target_type:'cosmetic', target_id:'demo-1', action:'dismiss', seen_through:seenThrough }, sessions.vega);
    assert.equal(again.status, 409); assert.match(again.body.error, /Already dismissed by nova/);
  });
});

test('suspensions end by themselves, keep Flares, and show as Automatic in the log', async () => {
  await withApp(async ({ call, sessions, store }) => {
    assert.equal((await call('/api/admin/ban', { id:'demo-creator', banned:true, reason:'Cool off', days:2 }, sessions.nova)).status, 400, 'Only offered lengths');
    const suspended = await call('/api/admin/ban', { id:'demo-creator', banned:true, reason:'Cool off', days:1 }, sessions.nova);
    assert.equal(suspended.status, 200); assert.ok(suspended.body.user.ban_expires_at);
    assert.equal(store.getCosmetic('demo-0').status, 'approved', 'A suspension does not revoke Flares');
    assert.equal(store.session(sessions.creator.raw), null, 'Sessions end');
    assert.ok(store.auditLog().some(entry => entry.action === 'account.suspended' && entry.detail === '1 day: Cool off'));
    assert.equal(store.liftExpiredBans(), 0, 'Not yet');
    assert.equal(store.liftExpiredBans(new Date(Date.now() + 2 * 86400000).toISOString()), 1);
    assert.equal(store.user('demo-creator').banned_at, null);
    assert.equal(store.auditLog()[0].actor, 'Automatic');
  });
});

test('staff notes: shared between moderators, deletable by their author or the owner, gone with the account', async () => {
  await withApp(async ({ call, sessions, store }) => {
    assert.equal((await call('/api/admin/notes', { user:'demo-creator', body:'Warned about flashing.' }, sessions.creator)).status, 403);
    const added = await call('/api/admin/notes', { user:'demo-creator', body:'Warned about flashing.' }, sessions.nova);
    assert.equal(added.status, 201);
    const notes = (await call('/api/admin/notes?user=demo-creator', undefined, sessions.vega)).body.notes;
    assert.equal(notes[0].author, 'nova');
    assert.equal((await call('/api/admin/notes/delete', { id:notes[0].id }, sessions.vega)).status, 403);
    assert.equal((await call('/api/admin/notes/delete', { id:notes[0].id }, sessions.owner)).status, 200);
    await call('/api/admin/notes', { user:'demo-creator', body:'Second note' }, sessions.nova);
    assert.equal(store.creatorContext('demo-creator').notes.length, 1);
    store.deleteAccount('demo-creator');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM mod_notes').get().n, 0);
  });
});

test('presence and live updates: moderators see who is looking at what, and each other’s decisions', async () => {
  await withApp(async ({ call, sessions, pending }) => {
    const id = pending('Shared');
    const start = (await call('/api/admin/live', undefined, sessions.vega)).body.last_event;
    const claim = await call('/api/admin/claims', { target:`cosmetic:${id}` }, sessions.nova);
    assert.deepEqual(claim.body.claims, [], 'Nobody else yet');
    const seenByVega = await call('/api/admin/claims', { target:`cosmetic:${id}` }, sessions.vega);
    assert.equal(seenByVega.body.claims[0].name, 'nova');
    await call('/api/admin/review', { id, status:'approved', expect:'pending' }, sessions.nova);
    const live = (await call(`/api/admin/live?since=${start}`, undefined, sessions.vega)).body;
    assert.ok(live.events.some(event => event.action === 'cosmetic.approved' && event.target === id && event.actor === 'nova'));
    assert.ok(live.claims.some(item => item.target === `cosmetic:${id}` && item.name === 'nova'));
    await call('/api/admin/claims', { target:`cosmetic:${id}`, active:false }, sessions.nova);
    assert.equal((await call(`/api/admin/live?since=${live.last_event}`, undefined, sessions.vega)).body.claims.some(item => item.name === 'nova'), false);
    assert.equal((await call('/api/admin/live', undefined, sessions.creator)).status, 403);
    const queue = (await call('/api/admin/queue?status=pending&filter=all&sort=oldest', undefined, sessions.vega)).body;
    assert.ok(queue.overview.pending >= 1); assert.ok('oldest_pending_at' in queue.overview);
    assert.ok(queue.cosmetics[0].creator_context, 'Creator history comes with each submission');
    assert.equal((await call('/api/admin/queue?status=pending&filter=nope', undefined, sessions.vega)).status, 400);
  });
});

test('many moderators deciding many Flares in parallel all succeed without corrupting counts', async () => {
  await withApp(async ({ call, sessions, pending, store }) => {
    const ids = Array.from({ length:24 }, (_, i) => pending(`Parallel ${i}`));
    const people = [sessions.nova, sessions.vega, sessions.owner];
    const responses = await Promise.all(ids.map((id, i) => call('/api/admin/review', { id, status:i % 2 ? 'approved' : 'rejected', reason:'Batch', expect:'pending' }, people[i % 3])));
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM cosmetics WHERE name LIKE 'Parallel %' AND status='pending'").get().n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action IN ('cosmetic.approved','cosmetic.rejected') AND detail='Batch' OR (action='cosmetic.approved' AND target IN (SELECT id FROM cosmetics WHERE name LIKE 'Parallel %'))").get().n >= 24, true);
  });
});
