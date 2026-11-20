import { createHash } from 'node:crypto';
import { normalizeLayers, normalizeShadows, validateTextureLimits, MAX_TEXTURE_BYTES, ANIMATIONS, PLAYBACK_DIRECTIONS } from '../public/paints.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
export function text(value, min, max, label) {
  assert(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, 400, `${label} must be ${min}–${max} characters.`);
  return value.trim();
}
export function publishingFlag(value = true) {
  assert(typeof value === 'boolean', 400, 'Public listing must be true or false.');
  return value;
}
export function profileFields(input) {
  const fields = {};
  if (input.bio !== undefined) fields.bio = text(input.bio,0,280,'Bio');
  if (input.profile_color !== undefined) {
    assert(typeof input.profile_color === 'string' && /^#[0-9a-f]{6}$/i.test(input.profile_color),400,'Profile color must be a six-digit hex color.');
    fields.profile_color = input.profile_color.toLowerCase();
  }
  return fields;
}
// Only allowlisted SQL fragments are used by both storage adapters.
// Catalog filters beyond the effect chips: the Flare's main color family, its
// motion, and what fills it. Every value is allowlisted; none reach SQL raw.
const COLOR_FAMILIES = { all:1, red:1, orange:1, yellow:1, green:1, cyan:1, blue:1, purple:1, pink:1, mono:1 };
const MOTION_FILTERS = { all:'1=1', flow:"json_extract(c.recipe,'$.animation')='flow'", shimmer:"json_extract(c.recipe,'$.animation')='shimmer'", pulse:"json_extract(c.recipe,'$.animation')='pulse'", spectrum:"json_extract(c.recipe,'$.animation')='spectrum'", none:"json_extract(c.recipe,'$.animation')='none'" };
const fillFilters = image => ({
  all:'1=1',
  image,
  solid:"EXISTS (SELECT 1 FROM json_each(c.recipe,'$.layers') layer WHERE json_extract(layer.value,'$.type')='solid')",
  gradient:`(NOT ${image} AND (json_extract(c.recipe,'$.layers') IS NULL OR EXISTS (SELECT 1 FROM json_each(c.recipe,'$.layers') layer WHERE json_extract(layer.value,'$.type') IN ('linear','radial','conic'))))`
});
// The main color is the first layer's first stop (or solid color), else the
// fallback palette's first color. Hue is computed in SQL so pagination stays exact.
const hexDigit = i => `(instr('0123456789abcdef',substr(h,${i},1))-1)`;
const colorFamilySql = `SELECT CASE
  WHEN mx-mn < 28 THEN 'mono'
  WHEN hue < 15 OR hue >= 345 THEN 'red' WHEN hue < 45 THEN 'orange' WHEN hue < 70 THEN 'yellow' WHEN hue < 165 THEN 'green'
  WHEN hue < 200 THEN 'cyan' WHEN hue < 255 THEN 'blue' WHEN hue < 290 THEN 'purple' ELSE 'pink' END
  FROM (SELECT mx, mn, CASE WHEN mx=mn THEN 0 WHEN mx=r THEN (60.0*(g-b)/(mx-mn)+360) % 360 WHEN mx=g THEN 60.0*(b-r)/(mx-mn)+120 ELSE 60.0*(r-g)/(mx-mn)+240 END AS hue
    FROM (SELECT r, g, b, max(r,g,b) AS mx, min(r,g,b) AS mn
      FROM (SELECT ${hexDigit(2)}*16+${hexDigit(3)} AS r, ${hexDigit(4)}*16+${hexDigit(5)} AS g, ${hexDigit(6)}*16+${hexDigit(7)} AS b
        FROM (SELECT lower(COALESCE(json_extract(c.recipe,'$.layers[0].stops[0].color'),json_extract(c.recipe,'$.layers[0].color'),json_extract(c.recipe,'$.colors[0]'),'#808080')) AS h))))`;
export function catalogFilters(params) {
  return { effect:params.get('effect') || 'all', color:params.get('color') || 'all', motion:params.get('motion') || 'all', fill:params.get('fill') || 'all' };
}
export function catalogSelection({ effect = 'all', sort = 'newest', color = 'all', motion = 'all', fill = 'all' } = {}) {
  const image = "(json_extract(c.recipe,'$.textureId') IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(c.recipe,'$.layers') layer WHERE json_extract(layer.value,'$.type')='image'))";
  const filters = { all:'1=1', animated:`(json_extract(c.recipe,'$.animation')!='none' OR ${image})`, static:`(json_extract(c.recipe,'$.animation')='none' AND NOT ${image})`, glow:"json_extract(c.recipe,'$.glow')>0", texture:image, depth:"json_extract(c.recipe,'$.depth')>0" };
  const orders = { trending:'recent_like_count DESC,like_count DESC,COALESCE(c.reviewed_at,c.created_at) DESC,c.id', liked:'like_count DESC,COALESCE(c.reviewed_at,c.created_at) DESC,c.id', newest:'COALESCE(c.reviewed_at,c.created_at) DESC,c.id', popular:'equipped_count DESC,COALESCE(c.reviewed_at,c.created_at) DESC,c.id', name:'c.name COLLATE NOCASE,c.id' };
  assert(Object.hasOwn(filters,effect) && Object.hasOwn(orders,sort),400,'Invalid Flare filter or sort.');
  assert(Object.hasOwn(COLOR_FAMILIES,color) && Object.hasOwn(MOTION_FILTERS,motion) && Object.hasOwn(fillFilters(image),fill),400,'Invalid Flare filter.');
  const clauses=[filters[effect]];
  if(color!=='all')clauses.push(`(${colorFamilySql}) = '${color}'`);
  if(motion!=='all')clauses.push(MOTION_FILTERS[motion]);
  if(fill!=='all')clauses.push(fillFilters(image)[fill]);
  return { filter:clauses.join(' AND '), order:orders[sort] };
}
export function validateRecipe(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'A recipe is required.');
  assert(Array.isArray(input.colors) && input.colors.length >= 2 && input.colors.length <= 5, 400, 'Choose 2–5 colors.');
  assert(input.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)), 400, 'Colors must be six-digit hex values.');
  assert(ANIMATIONS.includes(input.animation), 400, 'Invalid animation.');
  const numeric = (name, min, max) => {
    assert(typeof input[name] === 'number' && Number.isFinite(input[name]) && input[name] >= min && input[name] <= max, 400, `${name} must be between ${min} and ${max}.`);
    return input[name];
  };
  const recipe = { colors: input.colors, animation: input.animation, speed: numeric('speed', 1, 20), angle: numeric('angle', 0, 360), glow: numeric('glow', 0, 20) };
  const optionalNumber = (key, fallback, min, max) => {
    if (input[key] === undefined) return fallback;
    return numeric(key, min, max);
  };
  const optionalColor = (key, fallback) => {
    const value = input[key] === undefined ? fallback : input[key];
    assert(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), 400, `${key} must be a six-digit hex color.`);
    return value;
  };
  Object.assign(recipe, {
    glowColor: optionalColor('glowColor', input.colors[0]),
    shadowX: optionalNumber('shadowX', 0, -12, 12),
    shadowY: optionalNumber('shadowY', 0, -12, 12),
    shadowBlur: optionalNumber('shadowBlur', 0, 0, 20),
    shadowOpacity: optionalNumber('shadowOpacity', 0, 0, 100),
    shadowColor: optionalColor('shadowColor', '#000000'),
    outline: optionalNumber('outline', 0, 0, 2),
    outlineColor: optionalColor('outlineColor', '#ffffff'),
    depth: optionalNumber('depth', 0, 0, 8),
    depthAngle: optionalNumber('depthAngle', 45, 0, 360),
    depthColor: optionalColor('depthColor', '#303047')
  });
  assert(Number.isInteger(recipe.depth), 400, '3D depth must be a whole number.');
  if (input.direction !== undefined) {
    assert(PLAYBACK_DIRECTIONS.includes(input.direction),400,'Invalid playback direction.');
    recipe.direction = input.direction;
  }
  if (input.letterSpacing !== undefined) recipe.letterSpacing = numeric('letterSpacing',-1,6);
  if (input.layers !== undefined || input.shadows !== undefined || input.fontWeight !== undefined) {
    try {
      if (input.layers !== undefined) recipe.layers = normalizeLayers(input.layers);
      if (input.shadows !== undefined) recipe.shadows = normalizeShadows(input.shadows);
      if (input.fontWeight !== undefined) recipe.fontWeight = numeric('fontWeight', 400, 900);
    } catch (error) { throw new HttpError(400, error.message); }
  }
  if (input.textureId) {
    assert(typeof input.textureId === 'string' && /^[a-f0-9]{64}\.(gif|webp|png|jpg)$/.test(input.textureId), 400, 'Invalid texture ID.');
    recipe.textureId = input.textureId;
  }
  try { validateTextureLimits(recipe); }
  catch (error) { throw new HttpError(400, error.message); }
  return recipe;
}
// `formats` lists what this runtime can store. The Node server also takes JPEG
// and BMP, because lib/images.js decodes and re-encodes them.
export function validateTexture(data, { formats = ['gif','webp','png'] } = {}) {
  assert(typeof data === 'string' && data.length <= 2800000, 400, 'Texture must be under 2 MB.');
  const match = /^data:image\/(gif|webp|png|jpeg|jpg|bmp|x-ms-bmp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  const kind = match && { jpg:'jpeg', 'x-ms-bmp':'bmp' }[match[1]] || match?.[1];
  assert(match && formats.includes(kind), 400, `Upload a ${formats.includes('jpeg') ? 'GIF, PNG, WebP, JPEG or BMP' : 'GIF, WebP, or PNG'}. SVG and arbitrary URLs are not accepted.`);
  const bytes = Buffer.from(match[2], 'base64');
  assert(bytes.length > 12 && bytes.length <= MAX_TEXTURE_BYTES, 400, 'Texture must be under 2 MB.');
  let valid = false, width = 0, height = 0;
  if (kind === 'jpeg') {
    valid = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    // Size comes from the first start-of-frame marker.
    for (let pos = 2; valid && pos + 9 < bytes.length && bytes[pos] === 0xff;) {
      const marker = bytes[pos + 1], length = bytes.readUInt16BE(pos + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { height = bytes.readUInt16BE(pos + 5); width = bytes.readUInt16BE(pos + 7); break; }
      if (length < 2) break;
      pos += 2 + length;
    }
  } else if (kind === 'bmp') {
    valid = bytes.length >= 26 && bytes.subarray(0, 2).toString() === 'BM';
    if (valid) { width = bytes.readInt32LE(18); height = Math.abs(bytes.readInt32LE(22)); }
  } else if (match[1] === 'gif') {
    valid = ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (match[1] === 'png') {
    valid = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString() === 'IHDR';
    if (valid) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
  } else {
    valid = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' && bytes.length >= 30;
    const kind = bytes.subarray(12,16).toString();
    if (valid && kind === 'VP8X') {
      width = 1 + bytes.readUIntLE(24,3); height = 1 + bytes.readUIntLE(27,3);
    } else if (valid && kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (valid && kind === 'VP8 ' && bytes.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a]))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    } else { valid = false; }
  }
  assert(valid && width > 0 && height > 0 && width <= 2048 && height <= 2048, 400, 'Invalid image header or dimensions above 2048×2048.');
  return { bytes, kind, id: `${createHash('sha256').update(bytes).digest('hex')}.${kind}` };
}
