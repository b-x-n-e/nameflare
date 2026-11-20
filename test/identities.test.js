// Changing linked platforms: switching one to another account, and unlinking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';

const twitch = id => ({ provider:'twitch', id, login:`t${id}`, name:`Twitch ${id}`, avatar_url:'https://static-cdn.jtvnw.net/a.png' });
const kick = id => ({ provider:'kick', id, login:`k${id}`, name:`Kick ${id}`, avatar_url:'https://files.kick.com/a.png' });
const fails = (fn, status, pattern) => assert.throws(fn, error => error.status === status && (!pattern || pattern.test(error.message)));

test('unlinking keeps one platform, moves the profile source, and tells integrations', () => {
  const store = new Store();
  try {
    const id = store.linkIdentity(kick('50'), null, '1');
    fails(() => store.unlinkIdentity(id, 'kick', '1'), 400, /at least one/);
    store.linkIdentity(twitch('60'), id, '1');
    assert.equal(store.user(id).profile_provider, 'kick');
    const seen = [];
    const stop = store.onEvent(event => { if (event.type === 'user') seen.push(store.identities(event.id).map(item => item.provider_id)); });
    const account = store.unlinkIdentity(id, 'kick', '1');
    stop();
    assert.deepEqual(account.identities.map(item => item.provider), ['twitch']);
    assert.equal(store.user(id).profile_provider, 'twitch');
    assert.equal(store.user(id).name, 'Twitch 60');
    assert.ok(seen[0].includes('50'), 'the old Kick ID was announced before it stopped resolving');
    assert.equal(store.userIdByIdentity('kick', '50'), null);
    fails(() => store.unlinkIdentity(id, 'kick', '1'), 404);
    // The freed Kick account can now be linked to another Nameflare account.
    const other = store.linkIdentity(twitch('70'), null, '1');
    assert.equal(store.linkIdentity(kick('50'), other, '1'), other);
    assert.ok(store.auditLog().some(entry => entry.action === 'identity.unlinked' && entry.target === id));
  } finally { store.close(); }
});

test('staff keep Twitch: the owner identity cannot be unlinked or switched, moderators cannot unlink it', () => {
  const store = new Store();
  try {
    const owner = store.linkIdentity(twitch('1'), null, '1');
    store.linkIdentity(kick('2'), owner, '1');
    fails(() => store.unlinkIdentity(owner, 'twitch', '1'), 403, /owner/);
    fails(() => store.linkIdentity(twitch('9'), owner, '1', { replace:true }), 403, /owner/);
    assert.equal(store.unlinkIdentity(owner, 'kick', '1').identities.length, 1, 'other platforms can go');
    const mod = store.linkIdentity(twitch('3'), null, '1');
    store.linkIdentity(kick('4'), mod, '1');
    store.setModerator(store.user(owner), '3', true);
    fails(() => store.unlinkIdentity(mod, 'twitch', '1'), 403, /Staff/);
    store.linkIdentity(twitch('5'), mod, '1', { replace:true });
    assert.equal(store.moderators().find(row => row.id === mod).twitch_id, '5', 'a switched moderator is still managed by Twitch ID');
  } finally { store.close(); }
});

test('switching replaces the platform account only when asked, never takes one from another account', () => {
  const store = new Store();
  try {
    const id = store.linkIdentity(twitch('10'), null, '1');
    store.linkIdentity(kick('11'), id, '1');
    fails(() => store.linkIdentity(kick('12'), id, '1'), 409, /different identity/);
    const taken = store.linkIdentity(kick('13'), null, '1');
    fails(() => store.linkIdentity(kick('13'), id, '1', { replace:true }), 409, /another account/);
    assert.equal(store.identities(id).find(item => item.provider === 'kick').provider_id, '11', 'a refused switch changes nothing');
    store.linkIdentity(kick('12'), id, '1', { replace:true });
    assert.equal(store.identities(id).find(item => item.provider === 'kick').provider_id, '12');
    assert.equal(store.identities(taken)[0].provider_id, '13');
    // The old Kick account is free again, and signs in to a new account of its own.
    const fresh = store.linkIdentity(kick('11'), null, '1');
    assert.notEqual(fresh, id);
    assert.ok(store.auditLog().some(entry => entry.action === 'identity.changed'));
  } finally { store.close(); }
});

test('switch and unlink over HTTP: platform screens, friendly outcomes, CSRF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-identities-')), store = new Store(), originalFetch = globalThis.fetch;
  const env = { TWITCH_CLIENT_ID:'c', TWITCH_CLIENT_SECRET:'s', KICK_CLIENT_ID:'c', KICK_CLIENT_SECRET:'s', OWNER_TWITCH_ID:'1' };
  const app = createApp({ store, dataDir:dir, baseUrl:'http://localhost', env });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let kickUser = '21';
  globalThis.fetch = (url, options) => String(url).startsWith(base) ? originalFetch(url, options)
    : Promise.resolve(String(url).includes('/token') ? Response.json({ access_token:'x' }) : Response.json({ data:[{ user_id:Number(kickUser), name:`kicker${kickUser}`, profile_picture:'https://files.kick.com/p.png' }] }));
  try {
    const id = store.linkIdentity(twitch('20'), null, '1');
    let session = store.newSession(id), cookie = `nameflare_session=${session.raw}`;
    const flow = async (provider, mode, { cancel = false } = {}) => {
      const start = await fetch(`${base}/auth/${provider}${mode ? `?mode=${mode}` : ''}`, { redirect:'manual', headers:{ Cookie:cookie } });
      const location = new URL(start.headers.get('Location')), binding = start.headers.get('Set-Cookie').split(';')[0];
      const done = await fetch(`${base}/auth/${provider}/callback?state=${location.searchParams.get('state')}&${cancel ? 'error=access_denied' : 'code=x'}`, { redirect:'manual', headers:{ Cookie:`${cookie}; ${binding}` } });
      // A finished sign-in rotates the session cookie.
      const rotated = done.headers.getSetCookie().find(value => value.startsWith('nameflare_session=') && !value.startsWith('nameflare_session=;'));
      if (rotated) { cookie = rotated.split(';')[0]; session = store.db.prepare('SELECT csrf FROM sessions ORDER BY expires DESC LIMIT 1').get(); }
      return { authorize:location, status:done.status, to:done.headers.get('Location') };
    };
    let result = await flow('kick');
    assert.equal(result.to, '/account/platforms?auth=linked&provider=kick');
    result = await flow('kick');
    assert.equal(result.to, '/account/platforms?auth=refreshed&provider=kick');
    kickUser = '22';
    result = await flow('kick');
    assert.equal(result.to, '/account/platforms?auth=occupied&provider=kick', 'a plain link never replaces');
    result = await flow('kick', 'replace');
    assert.equal(result.to, '/account/platforms?auth=switched&provider=kick');
    assert.equal(store.identities(id).find(item => item.provider === 'kick').provider_id, '22');
    result = await flow('kick', 'replace');
    assert.equal(result.to, '/account/platforms?auth=same&provider=kick');
    store.linkIdentity(kick('23'), null, '1'); kickUser = '23';
    result = await flow('kick', 'replace');
    assert.equal(result.to, '/account/platforms?auth=taken&provider=kick');
    result = await flow('kick', 'replace', { cancel:true });
    assert.equal(result.to, '/account/platforms?auth=cancelled&provider=kick');
    const twitchStart = await fetch(`${base}/auth/twitch?mode=replace`, { redirect:'manual', headers:{ Cookie:cookie } });
    assert.equal(new URL(twitchStart.headers.get('Location')).searchParams.get('force_verify'), 'true', 'Twitch shows its account screen when switching');
    const plainStart = await fetch(`${base}/auth/twitch`, { redirect:'manual' });
    assert.equal(new URL(plainStart.headers.get('Location')).searchParams.get('force_verify'), null);
    const unlink = (headers = {}) => fetch(`${base}/api/account/identities/unlink`, { method:'POST', headers:{ Cookie:cookie, 'Content-Type':'application/json', Origin:'http://localhost', 'X-CSRF-Token':session.csrf, ...headers }, body:JSON.stringify({ provider:'kick' }) });
    assert.equal((await unlink({ 'X-CSRF-Token':'bad' })).status, 403);
    const response = await unlink();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user.identities.map(item => item.provider), ['twitch']);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.features.identity_changes, true);
  } finally {
    globalThis.fetch = originalFetch; app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(dir, { recursive:true, force:true });
  }
});
