// Small, dependency-free interaction layer shared by the shell and feed.
// It keeps timing and geometry in one place instead of scattering magic values.

export function moveFeedIndicator(tabs = document.querySelector('.feed-tabs')) {
  if (!tabs) return;
  const active = tabs.querySelector('[data-feed].active, [data-feed][aria-pressed="true"]');
  if (!active) return;
  tabs.style.setProperty('--tab-x', `${active.offsetLeft}px`);
  tabs.style.setProperty('--tab-w', `${active.offsetWidth}px`);
  // The indicator must sit above the tab background but under labels.
  tabs.dataset.ready = 'true';
}

export function initScrollState() {
  let frame = 0;
  const sync = () => {
    frame = 0;
    document.documentElement.dataset.scrolled = window.scrollY > 8 ? 'true' : 'false';
  };
  const request = () => {
    if (frame) return;
    frame = requestAnimationFrame(sync);
  };
  window.addEventListener('scroll', request, { passive: true });
  sync();
  return () => window.removeEventListener('scroll', request);
}

export function initFeedGeometry() {
  const refresh = () => requestAnimationFrame(() => moveFeedIndicator());
  window.addEventListener('resize', refresh);
  if ('ResizeObserver' in window) {
    const tabs = document.querySelector('.feed-tabs');
    if (tabs) new ResizeObserver(refresh).observe(tabs);
  }
  document.addEventListener('nameflare:feed', refresh);
  refresh();
  return refresh;
}
