// Web Awesome resolves icons through a library. The default library downloads
// Font Awesome SVGs from a CDN, which breaks offline use and our CSP. Register
// Nameflare's own sprite (Phosphor) as the default library instead: same names,
// same weight, zero network requests.
import { registerIconLibrary } from '/vendor/webawesome/webawesome.loader.js';
// Primitives that the shell composes directly. Loading them explicitly keeps the
// page dependency-free while making avatars, badges, tooltips, and loading
// placeholders behave as Web Awesome components rather than styled spans.
import '/vendor/webawesome/components/avatar/avatar.js';
import '/vendor/webawesome/components/badge/badge.js';
import '/vendor/webawesome/components/tooltip/tooltip.js';
import '/vendor/webawesome/components/skeleton/skeleton.js';

const aliases = {
  'chevron-down': 'chevron',
  'chevron-right': 'chevron',
  'chevron-left': 'chevron',
  'chevron-up': 'chevron',
  'xmark': 'close',
  'close': 'close',
  'magnifying-glass': 'search',
  'house': 'discover',
  'user': 'account',
  'users': 'profiles',
  'heart': 'heart',
  'bell': 'bell',
  'palette': 'palette',
  'pen': 'studio',
  'pen-to-square': 'studio',
  'layer-group': 'layers',
  'share-nodes': 'share',
  'arrow-right': 'arrow',
  'check': 'check',
  'circle-check': 'check',
  'filter': 'filter',
  'bars': 'menu',
  'sparkles': 'spark',
  'chart-simple': 'insights',
  'shield-check': 'moderation',
  'book-open': 'guide',
  'code': 'integrations',
  'arrow-up': 'arrow-up'
};

const cache = new Map();

function serialise(name) {
  if (cache.has(name)) return cache.get(name);
  const symbol = document.getElementById(`icon-${aliases[name] || name}`);
  if (!symbol) return '';
  const viewBox = symbol.getAttribute('viewBox') || '0 0 24 24';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor">${symbol.innerHTML}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(name, uri);
  return uri;
}

registerIconLibrary('default', {
  resolver: name => serialise(name),
  mutator: svg => {
    svg.setAttribute('fill', 'currentColor');
  }
});
