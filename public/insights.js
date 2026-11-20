import { compactNumber, shortDay } from './social.js';

const node = (tag, cls, content) => { const element = document.createElement(tag); if (cls) element.className = cls; if (content !== undefined) element.textContent = content; return element; };
function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ui-icon ${cls}`); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#icon-${name}`); svg.append(use); return svg;
}
const statusLabel = { approved:'Approved', pending:'In review', rejected:'Needs changes' };

function sectionHeading(title, note) {
  const heading = node('div', 'insights-section-heading'), copy = node('div');
  copy.append(node('h2', '', title), node('p', '', note)); heading.append(copy); return heading;
}
function kpi(label, value, note) {
  const card = node('div', 'panel insight-kpi');
  card.append(node('span', '', label), node('strong', '', compactNumber(value)), node('small', '', note)); return card;
}
function chart(series, label) {
  const wrap = node('div', 'insight-chart'), bars = node('div', 'insight-bars');
  const total = series.reduce((sum, point) => sum + point.count, 0);
  if (!total) {
    const empty = node('div', 'insight-chart-empty');
    empty.append(icon('insights'), node('strong', '', `No ${label.toLowerCase()} yet`), node('span', '', 'Daily totals appear here once this window has activity.'));
    wrap.append(empty); return wrap;
  }
  const maximum = Math.max(1, ...series.map(point => point.count));
  for (const point of series) {
    const column = node('div', 'insight-bar-col'), bar = node('div', 'insight-bar');
    bar.style.height = point.count ? `${Math.max(3, (point.count / maximum) * 100)}%` : '0%';
    column.title = `${shortDay(point.day)} · ${compactNumber(point.count)} ${label.toLowerCase()}`;
    column.append(bar); bars.append(column);
  }
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `${label}: ${compactNumber(total)} total across ${series.length} days`);
  const axis = node('div', 'insight-axis');
  axis.append(node('span', '', shortDay(series[0]?.day || '')), node('span', '', shortDay(series.at(-1)?.day || '')));
  const foot = node('div', 'insight-foot');
  foot.append(node('span', '', label), node('strong', '', `${compactNumber(total)} total`));
  const details = node('details', 'insight-data');
  details.append(node('summary', '', 'View daily data'));
  const table = node('table');
  const head = node('thead'), headRow = node('tr'); headRow.append(node('th', '', 'Day'), node('th', '', 'Count')); head.append(headRow);
  const body = node('tbody');
  for (const point of series) { const row = node('tr'); row.append(node('td', '', shortDay(point.day)), node('td', '', compactNumber(point.count))); body.append(row); }
  table.append(head, body); details.append(table); wrap.append(bars, axis, foot, details);
  return wrap;
}
function insightPanel(title, note) {
  const panel = node('section', 'panel insight-panel'), heading = node('div', 'panel-heading');
  heading.append(node('h2', '', title), node('span', '', note)); panel.append(heading); return panel;
}
function emptyInsight(message) { return node('div', 'insight-empty', message); }

function personalSection(analytics) {
  const section = node('section', 'insights-section');
  section.append(sectionHeading(`Your last ${analytics.window_days} days`, 'Likes, wearers, followers, and profile views. Only you see this breakdown.'));
  const kpis = node('div', 'insight-kpis');
  kpis.append(
    kpi('Likes received', analytics.totals.likes, 'All time · banned accounts excluded'),
    kpi('People wearing', analytics.totals.wears, 'All time · one per account'),
    kpi('Followers', analytics.totals.followers, 'Private creator follows'),
    kpi('Profile views', analytics.totals.profile_views, `Last ${analytics.window_days} days · anonymous`)
  );
  section.append(kpis);
  const charts = node('div', 'insight-grid');
  const likesPanel = insightPanel('Likes received', 'Daily');
  likesPanel.append(chart(analytics.series.likes, 'Likes'));
  const viewsPanel = insightPanel('Profile views', 'Daily');
  viewsPanel.append(chart(analytics.series.profile_views, 'Views'));
  charts.append(likesPanel, viewsPanel); section.append(charts);
  section.append(sectionHeading('Your Flares', 'Likes, wearers, and detail-page views · newest first'));
  const flares = node('div', 'insight-table-wrap');
  if (analytics.flares.length) {
    const table = node('table', 'insight-table');
    const head = node('thead'), row = node('tr');
    row.append(node('th', '', 'Flare'), node('th', '', 'Likes'), node('th', '', 'Wearing'), node('th', '', 'Views'));
    head.append(row);
    const body = node('tbody');
    analytics.flares.forEach((flare, index) => {
      const item = node('tr'), nameCell = node('td');
      const label = node('span', 'insight-rank', String(index + 1));
      const name = flare.status === 'approved' && flare.listed ? node('a', 'insight-flare-link', flare.name) : node('span', 'insight-flare-link', flare.name);
      if (name.tagName === 'A') name.href = `/discover/${encodeURIComponent(flare.id)}`;
      nameCell.append(label, name, node('span', 'insight-status', `${statusLabel[flare.status] || flare.status}${flare.listed ? '' : ' · unlisted'}`));
      item.append(nameCell, node('td', '', compactNumber(flare.like_count)), node('td', '', compactNumber(flare.equipped_count)), node('td', '', compactNumber(flare.view_count)));
      body.append(item);
    });
    table.append(head, body); flares.append(table);
  } else {
    flares.append(emptyInsight('No Flares yet. Create one and its likes, wearers, and page views will appear here.'));
  }
  section.append(flares);
  return section;
}

const pageLabel = path => path==='/discover' ? 'Discover' : path.startsWith('/discover/') ? 'Flare detail' : path==='/following' ? 'Following' : path==='/profiles' ? 'Creator directory' : path.startsWith('/profiles/') ? 'Creator profile' : path==='/studio' ? 'Flare studio' : path==='/artists' ? 'Artists' : path==='/guide' || path.startsWith('/guide/') ? 'Guide' : path==='/integrations' ? 'Integrations' : path;

function platformSection(analytics) {
  const section = node('section', 'insights-section');
  section.append(sectionHeading(`Platform pulse · ${analytics.window_days} days`, 'Aggregate activity for the whole community. Page views are counted without IP addresses or account IDs.'));
  const kpis = node('div', 'insight-kpis');
  kpis.append(
    kpi('Accounts', analytics.totals.accounts, 'Active, non-banned'),
    kpi('Public Flares', analytics.totals.public_flares, `${analytics.totals.creators} creators`),
    kpi('Awaiting review', analytics.totals.pending, 'Moderation queue'),
    kpi('Page views', analytics.totals.views_window, `Last ${analytics.window_days} days`)
  );
  section.append(kpis);
  const charts = node('div', 'insight-grid');
  const views = insightPanel('Traffic', 'Daily page views');
  views.append(chart(analytics.series.views, 'Views'));
  const growth = insightPanel('Community growth', 'Signups, submissions, reviews, and likes');
  const growthBody = node('div', 'insight-list insight-list-grid');
  const totals = [
    ['New accounts', analytics.series.signups.reduce((sum, point) => sum + point.count, 0)],
    ['New submissions', analytics.series.submissions.reduce((sum, point) => sum + point.count, 0)],
    ['Review decisions', analytics.series.reviews.reduce((sum, point) => sum + point.count, 0)],
    ['Likes given', analytics.series.likes.reduce((sum, point) => sum + point.count, 0)],
    ['All-time views', analytics.totals.views]
  ];
  for (const [label, value] of totals) { const item = node('li'); item.append(node('span', '', label), node('strong', '', compactNumber(value))); growthBody.append(item); }
  growth.append(growthBody, chart(analytics.series.signups, 'Signups'));
  charts.append(views, growth); section.append(charts);

  const split = node('div', 'insight-grid');
  const topFlares = insightPanel('Top Flares', 'By likes, then wearers');
  if (analytics.top_flares.length) {
    const table = node('table', 'insight-table'), head = node('thead'), headRow = node('tr');
    headRow.append(node('th', '', 'Flare'), node('th', '', 'Likes'), node('th', '', 'Wearing')); head.append(headRow);
    const body = node('tbody');
    analytics.top_flares.forEach((flare, index) => {
      const row = node('tr'), cell = node('td'), link = node('a', 'insight-flare-link', flare.name);
      link.href = `/discover/${encodeURIComponent(flare.id)}`;
      cell.append(node('span', 'insight-rank', String(index + 1)), link, node('span', 'insight-status', `by ${flare.creator}`));
      row.append(cell, node('td', '', compactNumber(flare.likes)), node('td', '', compactNumber(flare.wears))); body.append(row);
    });
    table.append(head, body);
    const wrapper = node('div', 'insight-table-wrap'); wrapper.append(table); topFlares.append(wrapper);
  } else topFlares.append(emptyInsight('No public Flares yet.'));
  const creators = insightPanel('Top creators', 'Public likes and wearers');
  if (analytics.top_creators.length) {
    const list = node('ul', 'insight-list');
    for (const creator of analytics.top_creators) {
      const item = node('li'), link = node('a', 'insight-flare-link', creator.name);
      link.href = `/profiles/${encodeURIComponent(creator.id)}`;
      item.append(link, node('span', '', `${compactNumber(creator.likes)} likes · ${compactNumber(creator.wears)} wearing`)); list.append(item);
    }
    creators.append(list);
  } else creators.append(emptyInsight('No creator activity yet.'));
  split.append(topFlares, creators); section.append(split);

  const pagesPanel = insightPanel('Most visited', `Pages over the last ${analytics.window_days} days`);
  if (analytics.top_pages.length) {
    const list = node('ul', 'insight-list');
    for (const page of analytics.top_pages) {
      const item = node('li'), copy = node('div');
      copy.append(node('span', '', pageLabel(page.path)), node('small', 'insight-path', page.path));
      item.append(copy, node('strong', '', compactNumber(page.views))); list.append(item);
    }
    pagesPanel.append(list);
  } else pagesPanel.append(emptyInsight('No page views recorded yet.'));
  section.append(pagesPanel);
  return section;
}

export async function renderInsights({ container, api, state, signIn, toast }) {
  container.replaceChildren();
  // Refresh belongs with the page title, not in a one-line toolbar that repeats
  // who is signed in — the top bar already shows that.
  const heading = container.closest('.view')?.querySelector('.page-heading');
  heading?.querySelector('.page-heading-actions')?.remove();
  const refresh = node('button', 'button subtle', 'Refresh insights');
  refresh.type = 'button'; refresh.addEventListener('click', () => { refresh.disabled = true; renderInsights({ container, api, state, signIn, toast }); });
  if (heading) { const actions = node('div', 'page-heading-actions'); actions.append(refresh); heading.append(actions); }
  else container.append(refresh);
  if (!state.user) {
    const empty = node('div', 'empty-state');
    empty.append(node('span', 'empty-glyph', '◔'), node('h3', '', 'Your numbers, once you’re in.'), node('p', '', 'Sign in to see likes received, wearers, followers, profile views, and how each Flare is doing.'));
    const button = node('button', 'button primary', 'Sign in to see insights'); button.type = 'button'; button.addEventListener('click', signIn); empty.append(button);
    container.append(empty); return;
  }
  if (!state.config?.features?.insights) {
    container.append(node('div', 'empty-state', 'Insights are available on the official Nameflare service.'));
    return;
  }
  const loading = node('div', 'insight-kpis');
  for (let index = 0; index < 4; index += 1) loading.append(node('div', 'panel paint-skeleton insight-kpi'));
  container.append(loading);
  try {
    const personal = (await api('/api/my/analytics')).analytics;
    let platform = null;
    if (['owner','moderator'].includes(state.user.role)) platform = (await api('/api/admin/analytics?days=14')).analytics;
    if (!container.isConnected) return;
    container.replaceChildren(personalSection(personal));
    if (platform) container.append(platformSection(platform));
  } catch (error) {
    if (!container.isConnected) return;
    const empty = node('div', 'empty-state');
    empty.append(node('span', 'empty-glyph', '↻'), node('h3', '', 'Couldn’t load insights.'), node('p', '', error.message || 'Check your connection and try again.'));
    const retry = node('button', 'button primary', 'Try again'); retry.type = 'button';
    retry.addEventListener('click', () => renderInsights({ container, api, state, signIn, toast })); empty.append(retry);
    container.replaceChildren(empty);
    if (toast) toast('Insights could not be refreshed.', true);
  }
}
