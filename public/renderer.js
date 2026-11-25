// SPDX-License-Identifier: MIT OR AGPL-3.0-only
// Copyright (c) 2026 Nameflare contributors. See SDK-LICENSE.md for the MIT option.
import { normalizeLayers, normalizeShadows, legacyLayer, layerBackground, rgbaColor, isTextureId, ANIMATIONS, PLAYBACK_DIRECTIONS } from './paints.js';
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const visualLayers = new WeakMap();
const renderedPaints = new WeakMap();
// Off-screen names stop animating: each running Flare costs a style recalc and
// repaint per frame, so a long feed would otherwise animate dozens of hidden names.
let visibility, observed;
function watchVisibility(element, retry = true) {
  if (typeof IntersectionObserver !== 'function') return;
  if (!element.isConnected) { if (retry && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (element.isConnected) watchVisibility(element, false); }); return; }
  if (!visibility) {
    observed = new Set();
    visibility = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.target.isConnected) { visibility.unobserve(entry.target); observed.delete(entry.target); continue; }
        if (entry.isIntersecting) delete entry.target.dataset.offscreen; else entry.target.dataset.offscreen = '';
      }
    }, { rootMargin: '160px 0px' });
    setInterval(() => { for (const target of observed) if (!target.isConnected) { visibility.unobserve(target); observed.delete(target); } }, 20000);
  }
  if (observed.has(element)) return;
  observed.add(element); visibility.observe(element);
}
// Reduced motion and paused previews show an image layer's first frame rather
// than dropping it to the palette. Windows reports reduced motion whenever
// "Animation effects" is off, so many PCs would otherwise never see the image.
// GIF, WebP and PNG (APNG) can animate; JPEG cannot and is used as is.
const stills = new Map();
const canAnimate = id => !id.endsWith('.jpg');
function stillFrame(url) {
  if (stills.has(url)) return stills.get(url);
  if (typeof Image !== 'function' || typeof document?.createElement !== 'function' || typeof URL.createObjectURL !== 'function') return null;
  const pending = (async () => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; image.src = url; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No still frame.');
    return URL.createObjectURL(blob);
  })().then(still => { stills.set(url, still); return still; }, () => { stills.set(url, null); return null; });
  stills.set(url, pending);
  return pending;
}
// Keep a user's custom preview on ordinary refresh; reset it on account changes.
export function createPreviewNameBinding(input) {
  let accountId, automatic='yourname', custom=false;
  input.addEventListener('input',()=>{custom=Boolean(input.value.trim()) && input.value!==automatic;});
  return user => {
    const nextId=user?.id ?? null, nextName=user?.name || 'yourname';
    if(accountId!==nextId || !custom || !input.value.trim())input.value=nextName;
    if(accountId!==nextId)custom=false;
    accountId=nextId;automatic=nextName;
  };
}
// Text-only edits must not recreate fills, reset animations, or reload GIFs.
export function updateCosmeticText(element, text) {
  const value = String(text), children = visualLayers.get(element) || [];
  if (element.firstChild?.nodeType === 3) {
    if (element.firstChild.data !== value) element.firstChild.data = value;
  } else if (children.length) element.insertBefore(document.createTextNode(value), element.firstChild);
  else if (element.textContent !== value) element.textContent = value;
  if (element.dataset.text !== undefined && element.dataset.text !== value) element.dataset.text = value;
  for (const child of children) if (child.dataset.text !== value) child.dataset.text = value;
}
// Read the latest input at paint time; multiple input events share one render.
export function createFrameUpdate(update, requestFrame = callback => requestAnimationFrame(callback)) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestFrame(() => { pending = false; update(); });
  };
}
export function applyCosmetic(element, cosmetic, apiOrigin = location.origin, { previewTextures = {}, paused = false } = {}) {
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const signature=JSON.stringify([cosmetic?.recipe,apiOrigin,previewTextures,paused,reduced]);
  const attached=(visualLayers.get(element) || []).every(child=>!element.contains || element.contains(child));
  if(cosmetic?.recipe && attached && renderedPaints.get(element)===signature){updateCosmeticText(element,element.textContent);return;}
  const currentTime=element.getAnimations?.().find(animation=>animation.animationName?.startsWith('nameflare-'))?.currentTime;
  renderedPaints.delete(element);
  for (const child of visualLayers.get(element) || []) child.remove();
  visualLayers.delete(element);
  element.classList.remove('nameflare-name','nameflare-complex');
  for (const key of ['background-image','background-size','background-repeat','background-position','filter','font-weight','-webkit-text-stroke','letter-spacing','--nameflare-speed','--nameflare-shadows','--nameflare-filter','--nameflare-direction']) element.style.removeProperty(key);
  delete element.dataset.animation; delete element.dataset.text; delete element.dataset.paused;
  if (!cosmetic?.recipe) return;
  const r = cosmetic.recipe;
  if (!Array.isArray(r.colors) || r.colors.length < 2 || r.colors.length > 5 || !r.colors.every(hex)) return;
  if (!ANIMATIONS.includes(r.animation) || ![r.angle,r.glow,r.speed].every(Number.isFinite)) return;
  if (r.direction !== undefined && !PLAYBACK_DIRECTIONS.includes(r.direction)) return;
  if (r.letterSpacing !== undefined && (!Number.isFinite(r.letterSpacing) || r.letterSpacing < -1 || r.letterSpacing > 6)) return;
  let layers, extraShadows;
  try { layers=normalizeLayers(r.layers || [legacyLayer(r)]);extraShadows=normalizeShadows(r.shadows || []); }
  catch { return; }
  const text=element.textContent;
  element.classList.add('nameflare-name');element.dataset.text=text;element.dataset.animation=r.animation;
  element.dataset.paused=String(paused);element.style.setProperty('--nameflare-speed',`${bounded(r.speed,4,1,20)}s`);
  element.style.setProperty('--nameflare-direction',r.direction || 'normal');
  if(r.letterSpacing!==undefined)element.style.letterSpacing=`${r.letterSpacing}px`;
  if(r.fontWeight!==undefined)element.style.fontWeight=bounded(r.fontWeight,800,400,900);
  // Glow and shadows live on the text-shadow layer, not on a CSS filter.
  // A filter rasterises the gradient-clipped glyphs and visibly blurs every
  // name; text-shadow keeps the fill crisp at any size. `--nameflare-filter`
  // stays as the identity stage for the spectrum hue rotation.
  const glow=bounded(r.glow,0,0,20),glowColor=hex(r.glowColor) ? r.glowColor:r.colors[0];
  element.style.setProperty('--nameflare-filter','brightness(1)');
  element.style.webkitTextStroke=`${bounded(r.outline,0,0,2)}px ${hex(r.outlineColor) ? r.outlineColor:'#ffffff'}`;
  const shadows=[],depth=Math.floor(bounded(r.depth,0,0,8)),angle=bounded(r.depthAngle,45,0,360)*Math.PI/180,depthColor=hex(r.depthColor) ? r.depthColor:'#303047';
  for(let i=1;i<=depth;i++)shadows.push(`${(Math.cos(angle)*i).toFixed(2)}px ${(Math.sin(angle)*i).toFixed(2)}px 0 ${depthColor}`);
  if(glow)shadows.push(`0 0 ${glow}px ${glowColor}`);
  for(const s of extraShadows)shadows.push(`${s.x}px ${s.y}px ${s.blur}px ${rgbaColor(s.color)}`);
  if(bounded(r.shadowOpacity,0,0,100))shadows.push(`${bounded(r.shadowX,0,-12,12)}px ${bounded(r.shadowY,0,-12,12)}px ${bounded(r.shadowBlur,0,0,20)}px ${rgbaColor(hex(r.shadowColor) ? r.shadowColor:'#000000',bounded(r.shadowOpacity,0,0,100)/100)}`);
  element.style.setProperty('--nameflare-shadows',shadows.join(',') || 'none');
  const fallback=`linear-gradient(${bounded(r.angle,120,0,360)}deg, ${r.colors.join(', ')}, ${r.colors[0]})`;
  const textureUrl=id => {
    if(!isTextureId(id))return null;
    const local=previewTextures[id];
    if(typeof local==='string' && /^blob:/.test(local))return local;
    try{const base=new URL(apiOrigin);if(['http:','https:'].includes(base.protocol))return `${base.origin}/textures/${id}`;}catch{}
    return null;
  };
  const styleLayer=(target,layer) => {
    let url=textureUrl(layer.textureId);
    if(url && (reduced || paused) && canAnimate(layer.textureId)){
      const still=stillFrame(url);
      url=typeof still==='string' ? still:null;
      // The palette shows until the frame is ready, then the image replaces it
      // unless this element has been repainted with something else meanwhile.
      if(still && typeof still.then==='function')still.then(frame=>{if(frame && target.isConnected!==false && renderedPaints.get(element)===signature)target.style.backgroundImage=layerBackground(layer,frame);});
    }
    target.style.backgroundImage=layerBackground(layer,url,{flow:['flow','shimmer'].includes(r.animation) && !reduced}) || fallback;
    target.style.backgroundSize=`${layer.size[0]}% ${layer.size[1]}%`;
    target.style.backgroundRepeat=layer.canvasRepeat;
    target.style.backgroundPosition=`${layer.at[0]}% ${layer.at[1]}%`;
  };
  // Paint the fill on child layers even for a single legacy fill. Painted as
  // the element's own background it sits beneath the z-index:-1 shadow layer,
  // so depth, glow and drop shadows were drawn over the letters.
  if(typeof document!=='undefined' && typeof element.append==='function') {
    element.classList.add('nameflare-complex');element.style.backgroundImage=fallback;
    const children=[];
    for(const [i,layer] of layers.entries()){
      const visual=document.createElement('span');visual.className='nameflare-paint-layer';visual.setAttribute('aria-hidden','true');visual.dataset.text=text;visual.style.zIndex=String(layers.length-i);visual.style.opacity=layer.opacity;visual.style.mixBlendMode=layer.blendMode || 'normal';styleLayer(visual,layer);element.append(visual);children.push(visual);
    }
    visualLayers.set(element,children);
  } else styleLayer(element,layers[0]);
  renderedPaints.set(element,signature);
  if(r.animation!=='none' && !paused && !reduced)watchVisibility(element);
  // Recipe/control changes should not rewind the animation on every input event.
  if(typeof currentTime==='number')for(const animation of element.getAnimations?.() || [])if(animation.animationName?.startsWith('nameflare-'))animation.currentTime=currentTime;
}
