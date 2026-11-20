import { compactNumber } from './social.js';
import { paintPalette } from './paints.js';
import { applyCosmetic } from './renderer.js';

// Rail previews are small and many; they stay still until hovered or focused.
function flareText(text, cosmetic, cls = '') {
  const name = node('strong', cls, text);
  if (cosmetic?.recipe) {
    applyCosmetic(name, cosmetic, location.origin, { paused: true });
    const host = () => name.closest('a, .rail-creator');
    queueMicrotask(() => {
      const target = host(); if (!target) return;
      const play = paused => applyCosmetic(name, cosmetic, location.origin, { paused });
      target.addEventListener('pointerenter', () => play(false)); target.addEventListener('pointerleave', () => play(true));
      target.addEventListener('focusin', () => play(false)); target.addEventListener('focusout', () => play(true));
    });
  }
  return name;
}

function node(tag, cls, content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (content !== undefined) el.textContent = content;
  return el;
}

function hueFor(name = '') {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return 200 + (hue % 140);
}

function avatar(user, cls = '') {
  const element = node('wa-avatar', `avatar ${cls}`.trim());
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('initials', (user.name || '?').slice(0, 1).toUpperCase());
  element.setAttribute('loading', 'lazy');
  element.style.setProperty('--avatar-hue', String(hueFor(user.name)));
  return element;
}

export function setRailStats(stats = {}) {
  const publicCount = document.querySelector('#rail-public-count');
  const creators = document.querySelector('#rail-creator-count');
  if (publicCount) publicCount.textContent = compactNumber(stats.public ?? 0);
  if (creators) creators.textContent = compactNumber(stats.creators ?? 0);
}

function fillCreatorStrip(strip, users, limit) {
  strip.replaceChildren();
  strip.setAttribute('aria-busy', 'false');
  if (!users.length) {
    strip.append(node('p', 'rail-empty', 'The first featured creators are on their way.'));
    return;
  }
  for (const user of users.slice(0, limit)) {
    const link = node('a', 'creator-card');
    link.href = `/profiles/${encodeURIComponent(user.id)}`;
    link.setAttribute('aria-label', `View ${user.name}'s profile`);
    const paints = Number(user.stats?.paints || 0);
    const title = node('span', 'creator-card-name', user.name);
    const meta = node('span', 'creator-card-meta', paints ? `${paints} Flare${paints === 1 ? '' : 's'}` : 'New here');
    link.append(avatar(user, 'creator-card-avatar'), title, meta);
    strip.append(link);
  }
  const more = node('a', 'creator-card creator-card-more');
  more.href = '/profiles';
  more.setAttribute('aria-label', 'Find more creators');
  const plus = node('span', 'creator-more-plus', '+');
  plus.setAttribute('aria-hidden', 'true');
  more.append(plus, node('span', 'creator-card-name', 'More'), node('span', 'creator-card-meta', 'Find people'));
  strip.append(more);
}

function renderCreatorStrip(users) {
  const targets = [
    ['#creator-strip', 6],
    ['#creator-strip-mobile', 3],
    ['#rail-creator-strip', 3]
  ];
  for (const [selector, limit] of targets) {
    const strip = document.querySelector(selector);
    if (strip) fillCreatorStrip(strip, users, limit);
  }
}

function renderCreators(users, followButton) {
  const list = document.querySelector('#rail-creators');
  if (!list) return;
  list.replaceChildren();
  if (!users.length) {
    list.append(node('p', 'rail-empty', 'No creators to show yet.'));
    return;
  }
  for (const user of users.slice(0, 3)) {
    const row = node('div', 'rail-creator');
    const link = node('a', 'rail-creator-main');
    link.href = `/profiles/${encodeURIComponent(user.id)}`;
    const copy = node('span', 'rail-creator-copy');
    const flares = Number(user.stats?.paints || 0), likes = Number(user.stats?.likes || 0);
    copy.append(flareText(user.name, user.cosmetic, 'rail-creator-name'), node('small', '', [`${flares} Flare${flares === 1 ? '' : 's'}`, likes ? `${compactNumber(likes)} like${likes === 1 ? '' : 's'}` : '', user.cosmetic ? `wearing ${user.cosmetic.name}` : ''].filter(Boolean).join(' · ')));
    link.append(avatar(user, 'rail-creator-avatar'), copy);
    row.append(link);
    if (typeof followButton === 'function') {
      const button = followButton(user);
      button.classList.add('rail-follow');
      row.append(button);
    }
    list.append(row);
  }
}

export async function loadRail({ api, state, followButton }) {
  setRailStats(state.config?.stats);
  const list = document.querySelector('#rail-trending-list');
  for (const selector of ['#creator-strip', '#creator-strip-mobile', '#rail-creator-strip']) {
    const strip = document.querySelector(selector);
    if (strip) strip.setAttribute('aria-busy', 'true');
  }
  const [trending, profiles] = await Promise.allSettled([
    api('/api/v1/cosmetics?sort=trending&limit=5'),
    api('/api/v1/profiles?limit=6')
  ]);

  if (profiles.status === 'fulfilled') {
    // "People to follow" should never suggest the reader to themselves.
    const creators = (profiles.value.users || []).filter(user => user.id !== state.user?.id);
    renderCreatorStrip(creators);
    renderCreators(creators, followButton);
  } else {
    renderCreatorStrip([]);
    renderCreators([], followButton);
  }

  if (trending.status === 'fulfilled') trendCache.set('trending', trending.value);
  renderTrend(list, trending.status === 'fulfilled' ? trending.value : null, 'trending');
  wireTrendTabs(api);
  refreshRailIdentity({ api, state });
}

const trendCache = new Map();
function renderTrend(list, result, kind) {
  if (!list?.isConnected) return;
  list.setAttribute('aria-busy', 'false');
  list.replaceChildren();
  if (!result) { list.append(node('li', 'rail-empty', 'Trending is quiet right now.')); return; }
  if (!result.cosmetics.length) { list.append(node('li', 'rail-empty', kind === 'popular' ? 'Nobody is wearing a Flare yet.' : 'The first weekly trend is still forming.')); return; }
  result.cosmetics.forEach((cosmetic, index) => {
    const item = node('li');
    const link = node('a', 'rail-trend');
    link.href = `/discover/${encodeURIComponent(cosmetic.id)}`;
    const swatch = node('span', 'rail-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    const colors = paintPalette(cosmetic.recipe);
    if (colors[0]) swatch.style.setProperty('--paint-color', colors[0]);
    swatch.append(flareText(cosmetic.name.slice(0, 2), cosmetic));
    const copy = node('span', 'rail-trend-copy');
    const likes = Number(kind === 'popular' ? cosmetic.like_count : (cosmetic.recent_like_count || cosmetic.like_count) || 0);
    const wearing = Number(cosmetic.equipped_count || 0);
    const stat = kind === 'popular'
      ? (wearing ? `${compactNumber(wearing)} wearing` : 'Not worn yet')
      : (likes ? `${compactNumber(likes)} like${likes === 1 ? '' : 's'}` : 'New this week');
    copy.append(node('strong', '', cosmetic.name), node('small', '', `${cosmetic.creator || 'Community'} · ${stat}`));
    link.append(node('span', 'rail-rank', String(index + 1)), swatch, copy);
    item.append(link);
    list.append(item);
  });
}
let trendRequest = 0;
function wireTrendTabs(api) {
  const tabs = [...document.querySelectorAll('[data-trend]')];
  for (const tab of tabs) {
    if (tab.dataset.wired) continue;
    tab.dataset.wired = 'true';
    tab.addEventListener('click', async () => {
      const kind = tab.dataset.trend, list = document.querySelector('#rail-trending-list'), request = ++trendRequest;
      for (const other of tabs) other.setAttribute('aria-pressed', String(other === tab));
      if (!trendCache.has(kind)) {
        list.setAttribute('aria-busy', 'true');
        try { trendCache.set(kind, await api(`/api/v1/cosmetics?sort=${kind}&limit=5`)); }
        catch { if (request === trendRequest) renderTrend(list, null, kind); return; }
      }
      if (request === trendRequest) renderTrend(list, trendCache.get(kind), kind);
    });
  }
}

// The reader's own equipped Flare, drawn on their own name.
export async function refreshRailIdentity({ api, state }) {
  const panel = document.querySelector('#rail-identity');
  if (!panel) return;
  if (!state.user) { panel.hidden = true; return; }
  panel.hidden = false;
  const stage = document.querySelector('#rail-identity-stage'), meta = document.querySelector('#rail-identity-meta'), link = document.querySelector('#rail-identity-link');
  let cosmetic = null;
  if (state.user.equipped) {
    try {
      const result = await api(`/api/v1/cosmetics/${encodeURIComponent(state.user.equipped)}`);
      cosmetic = result.cosmetic || result || null;
      if (!cosmetic?.recipe) cosmetic = null;
    } catch { cosmetic = null; }
  }
  const name = flareText(state.user.name || 'you', cosmetic, 'rail-identity-name');
  name.id = 'rail-identity-name';
  stage.replaceChildren(name);
  if (cosmetic) stage.style.setProperty('--paint-color', paintPalette(cosmetic.recipe)[0] || 'var(--accent)'); else stage.style.removeProperty('--paint-color');
  stage.classList.toggle('is-empty', !cosmetic);
  meta.textContent = cosmetic ? `Wearing ${cosmetic.name} by ${cosmetic.creator}` : 'No Flare equipped. Your name shows in its original platform style.';
  link.firstChild.textContent = cosmetic ? 'Change ' : 'Choose ';
  link.href = cosmetic ? '/account' : '/discover';
  stage.href = cosmetic ? `/discover/${encodeURIComponent(cosmetic.id)}` : '/discover';
}

export function wireRailFilters(apply) {
  for (const button of document.querySelectorAll('[data-rail-filter]')) {
    button.addEventListener('click', () => apply(button.dataset.railFilter));
  }
}
