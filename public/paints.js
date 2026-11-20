// SPDX-License-Identifier: MIT OR AGPL-3.0-only
// Copyright (c) 2026 Nameflare contributors. See SDK-LICENSE.md for the MIT option.
export const MAX_TEXTURE_BYTES = 2 * 1024 * 1024;
export const ANIMATIONS = ['flow','pulse','shimmer','spectrum','none'];
export const PLAYBACK_DIRECTIONS = ['normal','reverse','alternate','alternate-reverse'];
export const BLEND_MODES = ['normal','multiply','screen','overlay','soft-light'];
export const isColor = value => typeof value === 'string' && /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(value);
export const isTextureId = value => typeof value === 'string' && /^[a-f0-9]{64}\.(gif|webp|png|jpg)$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const number = (value, min, max, label) => { check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${label} must be between ${min} and ${max}.`); return value; };
const color = (value, label) => { check(isColor(value), `${label} must be a hex color (#RRGGBB or #RRGGBBAA).`); return value; };
export function normalizeLayers(layers, { allowEmptyImages = false } = {}) {
  check(Array.isArray(layers) && layers.length >= 1 && layers.length <= 6, 'Use 1–6 Flare layers.');
  return layers.map((layer, i) => {
    check(object(layer), 'Invalid Flare layer.');
    check(['solid','linear','radial','conic','image'].includes(layer.type), 'Unknown Flare layer type.');
    const result = { type:layer.type, opacity:number(layer.opacity ?? 1,0,1,'Layer opacity') };
    if (layer.blendMode !== undefined) {
      check(BLEND_MODES.includes(layer.blendMode), 'Invalid layer blend mode.');
      result.blendMode = layer.blendMode;
    }
    if (layer.type === 'image') {
      check(isTextureId(layer.textureId) || (allowEmptyImages && !layer.textureId), `Layer ${i+1} needs an uploaded image.`);
      if (layer.textureId) result.textureId = layer.textureId;
    } else if (layer.type === 'solid') result.color = color(layer.color, 'Layer color');
    else {
      check(Array.isArray(layer.stops) && layer.stops.length >= 2 && layer.stops.length <= 12, 'Each gradient needs 2–12 stops.');
      result.stops = layer.stops.map(stop => {
        check(object(stop), 'Invalid gradient stop.');
        return { at:number(stop.at,0,1,'Stop position'), color:color(stop.color,'Stop color') };
      }).sort((a,b) => a.at-b.at);
      check(result.stops[0].at < result.stops.at(-1).at, 'Gradient stops must span more than one position.');
      check(layer.repeat === undefined || typeof layer.repeat === 'boolean', 'Gradient repeat must be boolean.');
      result.repeat = layer.repeat ?? false;
      result.angle = number(layer.angle ?? 90,0,360,'Gradient angle');
      check(['circle','ellipse'].includes(layer.shape ?? 'ellipse'), 'Radial shape must be circle or ellipse.');
      result.shape = layer.shape ?? 'ellipse';
    }
    const size = layer.size ?? [100,100], at = layer.at ?? [50,50];
    check(Array.isArray(size) && size.length === 2 && Array.isArray(at) && at.length === 2, 'Layer size and position must be pairs.');
    result.size = size.map(n => number(n,1,500,'Layer size (%)'));
    result.at = at.map(n => number(n,0,100,'Layer position (%)'));
    check(['no-repeat','repeat','repeat-x','repeat-y'].includes(layer.canvasRepeat ?? 'no-repeat'), 'Invalid canvas repeat.');
    result.canvasRepeat = layer.canvasRepeat ?? 'no-repeat';
    return result;
  });
}
// Submission limits count distinct active assets, including the legacy texture field.
// Keep this separate from normalization so older published designs still render.
export function validateTextureLimits(recipe) {
  const ids = new Set([recipe.textureId,...(recipe.layers || []).filter(layer => layer.type === 'image').map(layer => layer.textureId)].filter(isTextureId));
  const gif = [...ids].filter(id => id.endsWith('.gif')).length;
  const image = ids.size - gif;
  check(gif <= 1 && image <= 1, 'Each Flare allows at most 1 GIF and 1 image (PNG, WebP or JPEG). Replace or remove an existing image layer first.');
  return { gif, image };
}
export function normalizeShadows(shadows) {
  check(Array.isArray(shadows) && shadows.length <= 8, 'Use up to 8 additional shadows.');
  return shadows.map(shadow => {
    check(object(shadow), 'Invalid shadow.');
    return { x:number(shadow.x,-20,20,'Shadow X'), y:number(shadow.y,-20,20,'Shadow Y'), blur:number(shadow.blur,0,30,'Shadow blur'), color:color(shadow.color,'Shadow color') };
  });
}
export function legacyLayer(recipe) {
  if (recipe.textureId) return { type:'image',textureId:recipe.textureId,opacity:1,size:[100,100],at:[50,50],canvasRepeat:'no-repeat' };
  return {type:'linear',opacity:1,angle:recipe.angle,repeat:false,shape:'ellipse',size:[300,100],at:[50,50],canvasRepeat:'no-repeat',stops:recipe.colors.map((color,i) => ({color,at:i/(recipe.colors.length-1)}))};
}
export function rgbaColor(hex, opacity=1) {
  if (!isColor(hex)) return 'rgba(255,255,255,1)';
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const alpha = hex.length === 9 ? parseInt(hex.slice(7,9),16)/255:1;
  return `rgba(${rgb.join(',')},${(alpha*opacity).toFixed(4)})`;
}
// Tile swatches describe the active fill, not the unrelated legacy fallback.
// Textures have no trustworthy palette without decoding their pixels.
export function paintPalette(recipe) {
  if (!recipe.layers) return [...new Set(recipe.colors.map(color=>color.toLowerCase()))];
  const colors=[];
  for (const layer of recipe.layers) {
    if (layer.opacity === 0) continue;
    if (layer.type === 'image') break;
    const values=layer.type === 'solid' ? [layer.color] : (layer.stops || []).map(stop=>stop.color);
    for (const value of values) if (isColor(value) && !(value.length === 9 && value.toLowerCase().endsWith('00')) && !colors.includes(value.toLowerCase())) colors.push(value.toLowerCase());
    if (layer.type === 'solid' && (layer.opacity ?? 1) === 1 && layer.color.length === 7 && (!layer.blendMode || layer.blendMode === 'normal')) break;
  }
  return colors;
}
export function layerBackground(layer, textureUrl, { flow = false } = {}) {
  if (layer.type === 'image') return textureUrl ? `url("${textureUrl}")`:null;
  if (layer.type === 'solid') { const c=rgbaColor(layer.color);return `linear-gradient(${c},${c})`; }
  let cycle=layer.stops, period=0;
  if(flow && layer.type!=='conic') {
    // Close the palette, then move by exactly one repeat period. Background-position
    // percentages cannot do this reliably across angles, canvas sizes, or names.
    const first=cycle[0],last=cycle.at(-1),span=last.at-first.at;
    if(first.color.toLowerCase()!==last.color.toLowerCase())cycle=[...cycle,{color:first.color,at:last.at+span/(cycle.length-1)}];
    period=(cycle.at(-1).at-first.at)*100;
  }
  const stops=cycle.map(s => {
    const at=s.at*100;
    return `${rgbaColor(s.color)} ${period ? `calc(${at}% + var(--nameflare-phase, 0) * ${period}%)` : `${at}%`}`;
  }).join(', ');
  const repeat=layer.repeat || period ? 'repeating-':'';
  if(layer.type==='linear')return `${repeat}linear-gradient(${layer.angle}deg, ${stops})`;
  if(layer.type==='radial')return `${repeat}radial-gradient(${layer.shape} at ${layer.at[0]}% ${layer.at[1]}%, ${stops})`;
  // Rotating a conic fill by one turn preserves arbitrary stop positions/repeats.
  const angle=flow ? `calc(${layer.angle}deg + var(--nameflare-phase, 0) * 360deg)` : `${layer.angle}deg`;
  return `${repeat}conic-gradient(from ${angle} at ${layer.at[0]}% ${layer.at[1]}%, ${stops})`;
}
