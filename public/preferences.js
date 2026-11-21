export const THEMES = [
  { id:'ink', name:'Ink', note:'Dark room · flame', bg:'#0b0b0c', palette:['#0b0b0c','#161618','#f15a20','#f4f4f2'] },
  { id:'gallery', name:'Gallery', note:'Light room · flame', bg:'#f4f4f2', palette:['#f4f4f2','#ffffff','#f15a20','#111113'] },
  { id:'paper', name:'Paper', note:'Warm paper · vermilion', bg:'#f5f1e8', palette:['#f5f1e8','#fffdf8','#c8451f','#191510'] },
  { id:'sand', name:'Sand', note:'Oat · burnt sienna', bg:'#efe7d8', palette:['#efe7d8','#fbf6ec','#a75f28','#2a2118'] },
  { id:'dusk', name:'Dusk', note:'Slate night · clear blue', bg:'#0f1115', palette:['#0f1115','#181b22','#8db4f0','#eef0f4'] },
  { id:'frost', name:'Frost', note:'Cool mist · marine', bg:'#edf1f4', palette:['#edf1f4','#fbfcfd','#3f6f96','#16202a'] },
  { id:'moss', name:'Moss', note:'Forest ink · lichen', bg:'#0c0f0b', palette:['#0c0f0b','#151a13','#b3d48c','#ecf0e5'] },
  { id:'plum', name:'Plum', note:'Aubergine · lilac', bg:'#100c12', palette:['#100c12','#19131c','#d3a7e6','#f1e9f3'] },
  { id:'rose', name:'Rose', note:'Blush · deep rose', bg:'#f7eceb', palette:['#f7eceb','#fff9f8','#b2404b','#2a1719'] }
];
const STORAGE_KEY = 'nameflare.appearance.v1';
// A custom theme is two colours; tokens.css derives the rest. theme-init.js
// repeats the scheme maths so it applies before first paint.
const HEX = /^#[0-9a-f]{6}$/i;
export const CUSTOM_DEFAULT = { bg:'#14121a', accent:'#ff5a36' };
const DEFAULTS = { theme:'ink', density:'comfortable', motion:'system', custom:CUSTOM_DEFAULT };
const knownTheme = id => id === 'custom' || THEMES.some(item => item.id === id);
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
export const contrast = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05); };
const customTheme = custom => ({ id:'custom', name:'Custom', note:'Your colours', bg:custom.bg, palette:[custom.bg, luminance(custom.bg) > .36 ? '#ffffff' : '#2a2a30', custom.accent, luminance(custom.bg) > .36 ? '#18161b' : '#f4f2ef'] });
const themeFor = id => id === 'custom' ? customTheme(preferences.custom) : THEMES.find(item => item.id === id) || THEMES[0];
const normalize = value => ({
  theme: knownTheme(value?.theme) ? value.theme : DEFAULTS.theme,
  density: value?.density === 'compact' ? 'compact' : 'comfortable',
  motion: value?.motion === 'reduced' ? 'reduced' : 'system',
  custom: { bg:HEX.test(value?.custom?.bg) ? value.custom.bg.toLowerCase() : CUSTOM_DEFAULT.bg, accent:HEX.test(value?.custom?.accent) ? value.custom.accent.toLowerCase() : CUSTOM_DEFAULT.accent }
});
function stored() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return { ...DEFAULTS }; }
}
let preferences = stored();

export function applyAppearance(next = {}, { persist = true } = {}) {
  preferences = normalize({ ...preferences, ...next });
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  if (preferences.theme === 'custom') {
    const { bg, accent } = preferences.custom;
    root.style.setProperty('--custom-bg', bg); root.style.setProperty('--custom-accent', accent);
    root.style.setProperty('--custom-accent-ink', contrast(accent, '#ffffff') >= contrast(accent, '#111111') ? '#ffffff' : '#111111');
    root.dataset.customScheme = luminance(bg) > .36 ? 'light' : 'dark';
  } else {
    for (const name of ['--custom-bg', '--custom-accent', '--custom-accent-ink']) root.style.removeProperty(name);
    delete root.dataset.customScheme;
  }
  if (preferences.density === 'compact') root.dataset.density = 'compact'; else root.removeAttribute('data-density');
  if (preferences.motion === 'reduced') root.dataset.motion = 'reduced'; else root.removeAttribute('data-motion');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = themeFor(preferences.theme).bg;
  if (persist) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {} }
  document.dispatchEvent(new CustomEvent('nameflare:appearance', { detail:{ ...preferences } }));
  return { ...preferences };
}

export function currentAppearance() { return { ...preferences }; }

export function cycleTheme() {
  const list = [...THEMES, customTheme(preferences.custom)];
  const index = Math.max(0, list.findIndex(item => item.id === preferences.theme));
  const next = list[(index + 1) % list.length];
  applyAppearance({ theme:next.id });
  return themeFor(next.id);
}

export function openPreferences() {
  const dialog = document.querySelector('#preferences-dialog');
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.theme-card[aria-pressed="true"]')?.focus({ preventScroll:true });
}

export function closePreferences() { document.querySelector('#preferences-dialog')?.close(); }

export function initPreferences() {
  applyAppearance({}, { persist:false });
  const grid = document.querySelector('#theme-grid');
  if (!grid) return { open:openPreferences, close:closePreferences, cycle:cycleTheme, current:currentAppearance };
  const rail = document.querySelector('#rail-themes');
  if (rail) {
    for (const item of [...THEMES, customTheme(preferences.custom)]) {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'rail-theme'; chip.dataset.theme = item.id;
      chip.setAttribute('aria-pressed', String(preferences.theme === item.id));
      chip.setAttribute('aria-label', `${item.name}: ${item.note}`);
      chip.title = `${item.name} — ${item.note}`;
      chip.style.background = `linear-gradient(135deg, ${item.palette[0]} 0 50%, ${item.palette[2]} 50% 100%)`;
      chip.addEventListener('click', () => { applyAppearance({ theme:item.id }); sync(); });
      rail.append(chip);
    }
  }
  for (const item of [...THEMES, customTheme(preferences.custom)]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'theme-card'; button.dataset.theme = item.id;
    button.setAttribute('aria-pressed', String(preferences.theme === item.id));
    button.setAttribute('aria-label', `${item.name} theme`);
    const swatches = document.createElement('span'); swatches.className = 'theme-swatches'; swatches.setAttribute('aria-hidden', 'true');
    for (const color of item.palette) { const chip = document.createElement('i'); chip.style.background = color; swatches.append(chip); }
    const name = document.createElement('span'); name.className = 'theme-card-name'; name.textContent = item.name;
    const note = document.createElement('small'); note.textContent = item.note;
    button.append(swatches, name, note);
    button.addEventListener('click', () => { applyAppearance({ theme:item.id }); sync(); if (item.id === 'custom') editor.querySelector('input')?.focus({ preventScroll:true }); });
    grid.append(button);
  }
  // Custom theme editor, shown while the Custom card is selected.
  const editor = document.createElement('div'); editor.className = 'custom-theme'; editor.id = 'custom-theme';
  const fields = document.createElement('div'); fields.className = 'custom-theme-fields';
  const note = document.createElement('p'); note.className = 'custom-theme-note'; note.setAttribute('role', 'status');
  const picker = (key, label) => {
    const wrap = document.createElement('label'), input = document.createElement('input'), value = document.createElement('code');
    input.type = 'color'; input.dataset.custom = key;
    wrap.append(input, document.createTextNode(label), value);
    input.addEventListener('input', () => { applyAppearance({ theme:'custom', custom:{ ...preferences.custom, [key]:input.value } }); sync(); });
    return wrap;
  };
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button ghost sm'; reset.textContent = 'Reset colours';
  reset.addEventListener('click', () => { applyAppearance({ theme:'custom', custom:CUSTOM_DEFAULT }); sync(); });
  fields.append(picker('bg', 'Background'), picker('accent', 'Accent'), reset);
  editor.append(fields, note);
  grid.after(editor);
  const sync = () => {
    const current = themeFor(preferences.theme);
    const moodName = document.querySelector('#rail-mood-name');
    const moodDot = document.querySelector('#rail-mood-dot');
    const moodButton = document.querySelector('#rail-mood-open');
    if (moodName) moodName.textContent = current.name;
    if (moodDot) moodDot.style.background = current.palette[2];
    if (moodButton) moodButton.title = `Appearance: ${current.name}. ${current.note}.`;
    for (const card of grid.children) card.setAttribute('aria-pressed', String(card.dataset.theme === preferences.theme));
    const customCard = grid.querySelector('[data-theme="custom"]'), custom = customTheme(preferences.custom);
    if (customCard) [...customCard.querySelectorAll('.theme-swatches i')].forEach((chip, i) => { chip.style.background = custom.palette[i]; });
    editor.hidden = preferences.theme !== 'custom';
    for (const input of editor.querySelectorAll('input[data-custom]')) { if (input.value !== preferences.custom[input.dataset.custom]) input.value = preferences.custom[input.dataset.custom]; input.nextSibling.nextSibling.textContent = preferences.custom[input.dataset.custom]; }
    const ratio = contrast(preferences.custom.accent, preferences.custom.bg);
    note.textContent = ratio < 2.2 ? `Your accent is hard to see on this background (contrast ${ratio.toFixed(1)}:1). Try a lighter or darker accent.` : `Text, panels and lines follow your background automatically (${luminance(preferences.custom.bg) > .36 ? 'light' : 'dark'} mode).`;
    note.dataset.warn = String(ratio < 2.2);
    for (const chip of document.querySelectorAll('#rail-themes .rail-theme')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.theme === preferences.theme));
      if (chip.dataset.theme === 'custom') chip.style.background = `linear-gradient(135deg, ${custom.palette[0]} 0 50%, ${custom.palette[2]} 50% 100%)`;
    }
    for (const button of document.querySelectorAll('#density-options [data-density]')) button.setAttribute('aria-pressed', String(button.dataset.density === preferences.density));
    for (const button of document.querySelectorAll('#motion-options [data-motion]')) button.setAttribute('aria-pressed', String(button.dataset.motion === preferences.motion));
  };
  for (const button of document.querySelectorAll('#density-options [data-density]')) button.addEventListener('click', () => { applyAppearance({ density:button.dataset.density }); sync(); });
  for (const button of document.querySelectorAll('#motion-options [data-motion]')) button.addEventListener('click', () => { applyAppearance({ motion:button.dataset.motion }); sync(); });
  for (const id of ['#preferences-open','#preferences-menu','#rail-mood-open']) document.querySelector(id)?.addEventListener('click', openPreferences);
  for (const id of ['#close-preferences','#close-preferences-done']) document.querySelector(id)?.addEventListener('click', closePreferences);
  document.querySelector('#preferences-reset')?.addEventListener('click', () => { applyAppearance(DEFAULTS); sync(); });
  document.addEventListener('nameflare:appearance', sync);
  sync();
  return { open:openPreferences, close:closePreferences, cycle:cycleTheme, current:currentAppearance };
}
