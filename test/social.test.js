import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';

test('notifications follow likes, follows, reviews, and unread state without self-notifying', () => {
  const store = new Store(); store.seedDemo();
  try {
    assert.equal(store.unreadNotifications('demo-creator'), 1);
    const noise = store.notifications('demo-creator');
    assert.equal(noise.length, 1); assert.equal(noise[0].kind, 'approved');

    store.setLike('demo-owner', 'demo-0', true);
    const like = store.notifications('demo-creator')[0];
    assert.equal(like.kind, 'like'); assert.equal(like.actor.name, 'orbit'); assert.equal(like.read, false);
    assert.equal(store.unreadNotifications('demo-creator'), 2);

    store.setLike('demo-owner', 'demo-0', false);
    assert.equal(store.unreadNotifications('demo-creator'), 1, 'unliking removes the matching notification');

    store.setFollow('demo-owner', 'demo-creator', true);
    assert.equal(store.unreadNotifications('demo-creator'), 2);
    store.setFollow('demo-owner', 'demo-creator', false);
    assert.equal(store.unreadNotifications('demo-creator'), 1, 'unfollowing removes the matching notification');

    store.setLike('demo-creator', 'demo-0', true);
    assert.equal(store.unreadNotifications('demo-creator'), 1, 'self-likes never notify');

    assert.equal(store.markNotificationsRead('demo-creator'), 0);
    assert.equal(store.notifications('demo-creator').every(item => item.read), true);

    const tester = store.linkIdentity({ provider:'twitch', id:'2001', login:'tester', name:'tester' }, null, '1001');
    store.setLike(tester, 'demo-0', true);
    assert.equal(store.unreadNotifications('demo-creator'), 1);
    store.setBan(store.user('demo-mod'), tester, true, 'Test ban');
    assert.equal(store.notifications('demo-creator').some(item => item.actor?.name === 'tester'), false, 'banned actors are hidden');
    assert.equal(store.unreadNotifications('demo-creator'), 0, 'banned actors do not count as unread');
  } finally { store.close(); }
});

test('page views feed creator and platform analytics without storing client identity', () => {
  const store = new Store(); store.seedDemo();
  try {
    const beforePersonal = store.creatorAnalytics('demo-creator', 30);
    const beforeFlare = beforePersonal.flares.find(flare => flare.id === 'demo-0').view_count;
    const beforePlatform = store.analytics(14);
    assert.equal(beforePlatform.window_days, 14);
    assert.equal(beforePlatform.series.views.length, 14);
    assert.equal(beforePlatform.series.views.reduce((sum, point) => sum + point.count, 0), beforePlatform.totals.views_window);

    store.recordView('/discover/demo-0');
    store.recordView('/discover/demo-0');
    store.recordView('/profiles/demo-creator');

    const personal = store.creatorAnalytics('demo-creator', 30);
    assert.equal(personal.totals.profile_views, beforePersonal.totals.profile_views + 1);
    assert.equal(personal.flares.find(flare => flare.id === 'demo-0').view_count, beforeFlare + 2);
    assert.equal(personal.series.profile_views.reduce((sum, point) => sum + point.count, 0), personal.totals.profile_views);

    const platform = store.analytics(14);
    assert.equal(platform.totals.views, beforePlatform.totals.views + 3);
    assert.equal(platform.totals.views_window, beforePlatform.totals.views_window + 3);
    assert.ok(platform.top_pages.some(page => page.path === '/discover/demo-0'));
    assert.equal(platform.series.views.reduce((sum, point) => sum + point.count, 0), platform.totals.views_window);
    assert.equal(store.creatorAnalytics('missing-account'), null);
  } finally { store.close(); }
});

test('HTTP notifications, view counting, and insights enforce privacy and roles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nameflare-social-')), store = new Store(); store.seedDemo();
  const app = createApp({ store, dataDir:dir, baseUrl:'http://localhost', env:{} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const creator = store.newSession('demo-creator'), owner = store.newSession('demo-owner');
  const request = async (path, { method = 'GET', session, data, origin = 'http://localhost', headers = {} } = {}) => fetch(base + path, {
    method,
    headers: {
      ...(session ? { Cookie:`nameflare_session=${session.raw}` } : {}),
      ...(method === 'GET' ? {} : { 'Content-Type':'application/json', Origin:origin, 'X-CSRF-Token':session?.csrf || '' }),
      ...headers
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  try {
    const config = await (await request('/api/config')).json();
    assert.deepEqual(config.features, { notifications:true, insights:true, analytics:true, reports:true, account_deletion:true, data_export:true, scanning:{ malware:false, content:false } });

    assert.equal((await request('/api/notifications')).status, 401);
    assert.equal((await request('/api/my/analytics')).status, 401);
    assert.equal((await request('/api/admin/analytics', { session:creator })).status, 403);

    assert.equal((await request('/api/views', { method:'POST', data:{ path:'/discover' }, origin:'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/views', { method:'POST', data:{ path:'/account' } })).status, 400);
    assert.equal((await request('/api/views', { method:'POST', data:{ path:'/discover/demo-0' } })).status, 200);

    const list = await (await request('/api/notifications', { session:creator })).json();
    assert.ok(list.notifications.length >= 1);
    assert.equal(list.unread, 1);
    assert.equal(list.next_offset, null);
    assert.equal(list.notifications[0].kind, 'approved');
    assert.equal(list.notifications[0].actor.name, 'orbit');

    assert.equal((await request('/api/notifications/read', { method:'POST', session:creator, data:{ id:'not-a-number' } })).status, 400);
    assert.equal((await request('/api/notifications/read', { method:'POST', session:creator, data:{}, headers:{ 'X-CSRF-Token':'' } })).status, 403);
    const read = await (await request('/api/notifications/read', { method:'POST', session:creator, data:{} })).json();
    assert.equal(read.unread, 0);
    assert.equal((await (await request('/api/notifications', { session:creator })).json()).unread, 0);

    assert.equal((await request('/api/cosmetics/like', { method:'POST', session:owner, data:{ id:'demo-0', liked:true } })).status, 200);
    const pageOne = await (await request('/api/notifications?limit=1', { session:creator })).json();
    assert.equal(pageOne.notifications.length, 1);
    assert.equal(pageOne.next_offset, 1);
    const pageTwo = await (await request('/api/notifications?limit=1&offset=1', { session:creator })).json();
    assert.equal(pageTwo.notifications.length, 1);
    assert.equal(pageTwo.next_offset, null);
    assert.equal((await request('/api/notifications?limit=51', { session:creator })).status, 400);

    const personal = await (await request('/api/my/analytics', { session:creator })).json();
    assert.equal(personal.analytics.window_days, 30);
    assert.ok(personal.analytics.flares.some(flare => flare.id === 'demo-0' && flare.view_count > 0));

    const admin = await (await request('/api/admin/analytics?days=7', { session:owner })).json();
    assert.equal(admin.analytics.window_days, 7);
    assert.ok(admin.analytics.top_pages.some(page => page.path === '/discover/demo-0'));
    assert.equal((await request('/api/admin/analytics?days=3', { session:owner })).status, 400);
    assert.equal((await request('/api/admin/analytics?days=abc', { session:owner })).status, 400);
  } finally {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    store.close(); rmSync(dir, { recursive:true, force:true });
  }
});
