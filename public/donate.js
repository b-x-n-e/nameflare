// Support page: copy buttons and wallet QR codes. The addresses live once, in
// the page markup; each QR is drawn from the same text the visitor can copy,
// so the two can never disagree.
import { copyText } from './social.js';

let qrLoad = null;
function loadQr() {
  qrLoad ??= new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const script = document.createElement('script');
    script.src = '/vendor/qrcode/qrcode.js';
    script.async = true;
    script.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('QR unavailable'));
    script.onerror = () => { qrLoad = null; script.remove(); reject(new Error('QR unavailable')); };
    document.head.append(script);
  });
  return qrLoad;
}

const SVG = 'http://www.w3.org/2000/svg';
// Black modules on white with the standard four-module quiet zone, whatever
// the theme: scanners need that contrast.
export function qrSvg(qrcode, text, label) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const count = qr.getModuleCount(), quiet = 4, size = count + quiet * 2;
  let d = '';
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const back = document.createElementNS(SVG, 'rect'), modules = document.createElementNS(SVG, 'path');
  back.setAttribute('width', String(size)); back.setAttribute('height', String(size)); back.setAttribute('fill', '#fff');
  modules.setAttribute('d', d); modules.setAttribute('fill', '#000');
  svg.append(back, modules);
  return svg;
}

export function setupDonate(root) {
  if (!root) return;
  const status = root.querySelector('.wallet-status');
  root.addEventListener('click', async event => {
    const button = event.target.closest('.wallet-copy');
    if (!button) return;
    const card = button.closest('.wallet'), address = card.querySelector('.wallet-address').textContent.trim();
    const label = button.querySelector('span'), copied = await copyText(address);
    clearTimeout(button.resetTimer);
    button.dataset.state = copied ? 'copied' : 'failed';
    label.textContent = copied ? 'Copied' : 'Select and copy';
    if (status) status.textContent = copied ? `${card.dataset.coin} address copied.` : 'Couldn’t copy. Select the address and copy it manually.';
    if (!copied) { const range = document.createRange(); range.selectNodeContents(card.querySelector('.wallet-address')); getSelection()?.removeAllRanges(); getSelection()?.addRange(range); }
    button.resetTimer = setTimeout(() => { delete button.dataset.state; label.textContent = 'Copy address'; }, 2200);
  });
}

export async function renderDonate(root) {
  if (!root || root.dataset.qrReady) return;
  try {
    const qrcode = await loadQr();
    for (const card of root.querySelectorAll('.wallet')) {
      const slot = card.querySelector('.wallet-qr'), address = card.querySelector('.wallet-address').textContent.trim();
      slot.replaceChildren(qrSvg(qrcode, address, `QR code for the ${card.dataset.coin} address`));
      slot.hidden = false;
    }
    root.dataset.qrReady = '1';
  } catch { /* QR codes are a convenience; the addresses still copy. */ }
}
