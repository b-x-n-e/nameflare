(() => {
  try {
    const themes = ['ink', 'gallery', 'paper', 'sand', 'dusk', 'frost', 'moss', 'plum', 'rose'];
    document.documentElement.dataset.theme = 'ink';
    const saved = JSON.parse(localStorage.getItem('nameflare.appearance.v1') || 'null');
    if (!saved || typeof saved !== 'object') return;
    const root = document.documentElement;
    if (themes.includes(saved.theme)) root.dataset.theme = saved.theme;
    // Custom theme: same maths as preferences.js (luminance and contrast).
    const hex = /^#[0-9a-f]{6}$/i, custom = saved.custom || {};
    if (saved.theme === 'custom' && hex.test(custom.bg) && hex.test(custom.accent)) {
      const lum = value => { const c = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      root.dataset.theme = 'custom';
      root.style.setProperty('--custom-bg', custom.bg); root.style.setProperty('--custom-accent', custom.accent);
      root.style.setProperty('--custom-accent-ink', ratio(lum(custom.accent), 1) >= ratio(lum(custom.accent), lum('#111111')) ? '#ffffff' : '#111111');
      root.dataset.customScheme = lum(custom.bg) > .36 ? 'light' : 'dark';
    }
    if (saved.density === 'compact') root.dataset.density = 'compact';
    if (saved.motion === 'reduced') root.dataset.motion = 'reduced';
  } catch {}
})();
// Header shape from the last visit (signed in, staff, demo), applied before
// first paint so navigation does not shift when the account loads. Hints only
// stand in until app.js marks the real state ready.
(() => {
  try {
    const shell = JSON.parse(localStorage.getItem('nameflare.shell.v1') || 'null');
    if (!shell || typeof shell !== 'object') return;
    const root = document.documentElement;
    if (shell.signed) root.dataset.shellSigned = '';
    if (shell.staff) root.dataset.shellStaff = '';
    if (shell.demo) root.dataset.shellDemo = '';
  } catch {}
})();

// Which page is loading, before first paint: the markup opens on Discover, so
// without this a refresh of any other page showed Discover until app.js ran.
(() => {
  try {
    const view = location.pathname.split('/')[1] || 'discover';
    document.documentElement.dataset.bootView = /^[a-z]{1,20}$/.test(view) ? view : 'discover';
  } catch {}
})();
