// Upload sanitizer. Every texture is parsed in full and written out again, so
// what Nameflare stores and serves is a file it built itself:
//
// - PNG: chunks and checksums verified, image data inflated (bounded by the
//   size the header declares), every scanline unfiltered to pixels, then
//   re-filtered and re-compressed. Only IHDR, PLTE, tRNS, gAMA, cHRM, sRGB,
//   IDAT and IEND survive; text, EXIF, ICC profiles, APNG frames and any bytes
//   after IEND are dropped.
// - GIF: every frame's LZW stream is decoded to palette indices and encoded
//   again. Frame timing, disposal, transparency and the loop count survive;
//   comments, plain-text blocks, other application blocks and trailing bytes
//   are dropped.
// - JPEG: decoded to pixels (jpeg-js, vendored), turned upright from its EXIF
//   orientation, and encoded again at quality 90, so EXIF, GPS, comments and
//   ICC data are gone.
// - BMP: decoded and stored as a PNG.
// - WebP: the RIFF container is rebuilt from validated chunks. Bitstream
//   headers and dimensions are checked, but VP8/VP8L pixel data is copied, not
//   decoded (there is no pure-JS decoder here); EXIF, XMP, ICC and unknown
//   chunks are dropped.
//
// Pure JavaScript with no dependencies. It runs in a worker thread
// (image-worker.js) so a large GIF never blocks the event loop.
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const decodeJpegPixels = require('./vendor/jpeg-js/decoder.cjs'), encodeJpegPixels = require('./vendor/jpeg-js/encoder.cjs');

export const MAX_SIDE = 2048;
export const MAX_FRAMES = 600;
// Decoded pixels across all frames: bounds the memory and CPU of one upload.
export const MAX_TOTAL_PIXELS = 32 * 1024 * 1024;

export class ImageError extends Error {}
const fail = message => { throw new ImageError(message); };
const need = (condition, message) => { if (!condition) fail(message); };

// Returns { bytes, kind, width, height, frames, dropped }. `kind` is the stored
// format's extension, which can differ from the upload (BMP becomes png).
export function sanitizeImage(kind, input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (kind === 'png') return { kind:'png', ...sanitizePng(bytes) };
  if (kind === 'gif') return { kind:'gif', ...sanitizeGif(bytes) };
  if (kind === 'webp') return { kind:'webp', ...sanitizeWebp(bytes) };
  if (kind === 'jpg' || kind === 'jpeg') return { kind:'jpg', ...sanitizeJpeg(bytes) };
  if (kind === 'bmp') return { kind:'png', ...sanitizeBmp(bytes) };
  return fail('Unsupported image type.');
}

// ---------------------------------------------------------------- PNG
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function pngChunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}
function pngPasses(header) {
  const { width, height, interlace } = header;
  if (!interlace) return [{ width, height }];
  return ADAM7.map(([x, y, dx, dy]) => ({ width: width > x ? Math.ceil((width - x) / dx) : 0, height: height > y ? Math.ceil((height - y) / dy) : 0 }));
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// Parses and validates a PNG; returns its header, kept chunks and unfiltered scanlines.
export function decodePng(buf) {
  need(buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE), 'Not a PNG file.');
  let pos = 8, header = null, palette = null, transparency = null, sawData = false, dataDone = false, ended = false;
  const data = [], color = [], dropped = new Set();
  while (pos < buf.length) {
    need(pos + 12 <= buf.length, 'PNG chunk is truncated.');
    const length = buf.readUInt32BE(pos);
    need(length <= 0x7fffffff && pos + 12 + length <= buf.length, 'PNG chunk is truncated.');
    const type = buf.toString('latin1', pos + 4, pos + 8);
    need(/^[A-Za-z]{4}$/.test(type), 'Invalid PNG chunk.');
    // IDAT is covered by zlib's own Adler-32 check when it is inflated (some
    // encoders write bad IDAT CRCs that browsers accept); every other chunk must match.
    need(type === 'IDAT' || (crc32(buf.subarray(pos + 4, pos + 8 + length)) >>> 0) === buf.readUInt32BE(pos + 8 + length), 'PNG checksum mismatch.');
    const body = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    need(header || type === 'IHDR', 'PNG must start with its header.');
    if (sawData && type !== 'IDAT') dataDone = true;
    if (type === 'IHDR') {
      need(!header && length === 13, 'Invalid PNG header.');
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
      need(header.width > 0 && header.height > 0 && header.width <= MAX_SIDE && header.height <= MAX_SIDE, `PNG must be between 1×1 and ${MAX_SIDE}×${MAX_SIDE}.`);
      need(PNG_DEPTHS[header.color]?.includes(header.depth), 'Unsupported PNG color format.');
      need(body[10] === 0 && body[11] === 0 && body[12] <= 1, 'Unsupported PNG compression or interlacing.');
    } else if (type === 'IDAT') {
      need(!dataDone, 'PNG image data is split by other chunks.');
      sawData = true; data.push(body);
    } else if (type === 'IEND') { ended = true; break; }
    else if (type === 'PLTE') {
      need(!palette && !sawData && length > 0 && length % 3 === 0 && length <= 768, 'Invalid PNG palette.');
      palette = Buffer.from(body);
    } else if (type === 'tRNS') {
      need(!transparency && !sawData, 'Invalid PNG transparency.');
      transparency = Buffer.from(body);
    } else if (!sawData && ((type === 'gAMA' && length === 4) || (type === 'cHRM' && length === 32) || (type === 'sRGB' && length === 1 && body[0] <= 3))) {
      if (!color.some(chunk => chunk.type === type)) color.push({ type, body: Buffer.from(body) });
    } else {
      // An unknown critical chunk changes how the image must be read: refuse it.
      need(type[0] === type[0].toLowerCase() || ['acTL', 'fcTL', 'fdAT'].includes(type), `Unsupported PNG feature (${type}).`);
      dropped.add(type);
    }
  }
  need(ended, 'PNG is missing its end marker.');
  need(data.length, 'PNG has no image data.');
  if (pos < buf.length) dropped.add('trailing data');
  // Palette and transparency rules from the PNG specification.
  if (header.color === 3) {
    need(palette && palette.length / 3 <= 2 ** header.depth, 'PNG palette is missing or too large.');
  } else if (palette) { dropped.add('PLTE'); palette = null; }
  if (transparency) {
    const valid = header.color === 0 ? transparency.length === 2 : header.color === 2 ? transparency.length === 6 : header.color === 3 ? transparency.length <= palette.length / 3 : false;
    if (!valid) { dropped.add('tRNS'); transparency = null; }
  }
  const bitsPerPixel = PNG_CHANNELS[header.color] * header.depth, bpp = Math.max(1, bitsPerPixel >> 3);
  const passes = pngPasses(header).map(pass => ({ ...pass, rowBytes: Math.ceil(pass.width * bitsPerPixel / 8) }));
  const expected = passes.reduce((sum, pass) => sum + (pass.width && pass.height ? pass.height * (1 + pass.rowBytes) : 0), 0);
  let raw;
  // The header promised `expected` bytes: anything larger is a decompression bomb.
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); }
  catch { fail('PNG image data is corrupt or larger than its dimensions.'); }
  need(raw.length === expected, 'PNG image data does not match its dimensions.');
  // Unfilter in place: afterwards each row's filter byte is 0.
  let offset = 0;
  for (const pass of passes) {
    if (!pass.width || !pass.height) continue;
    let previous = -1;
    for (let y = 0; y < pass.height; y++) {
      const filter = raw[offset], start = offset + 1;
      need(filter <= 4, 'Invalid PNG filter.');
      for (let i = 0; i < pass.rowBytes; i++) {
        const at = start + i, left = i >= bpp ? raw[at - bpp] : 0, up = previous >= 0 ? raw[previous + i] : 0, corner = previous >= 0 && i >= bpp ? raw[previous + i - bpp] : 0;
        if (filter === 1) raw[at] = (raw[at] + left) & 255;
        else if (filter === 2) raw[at] = (raw[at] + up) & 255;
        else if (filter === 3) raw[at] = (raw[at] + ((left + up) >> 1)) & 255;
        else if (filter === 4) raw[at] = (raw[at] + paeth(left, up, corner)) & 255;
      }
      raw[offset] = 0; previous = start; offset += 1 + pass.rowBytes;
    }
  }
  return { header, palette, transparency, color, passes, bpp, raw, dropped };
}

function sanitizePng(buf) {
  const decoded = decodePng(buf);
  return { bytes:writePng(decoded), width:decoded.header.width, height:decoded.header.height, frames:1, dropped:[...decoded.dropped] };
}
// Re-filters unfiltered scanlines and writes a minimal PNG.
function writePng({ header, palette, transparency, color = [], passes, bpp, raw }) {
  // Re-filter each row with the cheapest-looking filter (minimum sum of
  // absolute differences, the usual heuristic) so files stay compact.
  const out = Buffer.alloc(raw.length);
  const predict = (filter, left, up, corner) => filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner);
  let offset = 0;
  for (const pass of passes) {
    if (!pass.width || !pass.height) continue;
    let previous = -1;
    for (let y = 0; y < pass.height; y++) {
      const start = offset + 1;
      let best = 0, bestScore = Infinity;
      for (let filter = 0; filter < 5; filter++) {
        let score = 0;
        for (let i = 0; i < pass.rowBytes && score < bestScore; i++) {
          const left = i >= bpp ? raw[start + i - bpp] : 0, up = previous >= 0 ? raw[previous + i] : 0, corner = previous >= 0 && i >= bpp ? raw[previous + i - bpp] : 0;
          const byte = (raw[start + i] - predict(filter, left, up, corner)) & 255;
          score += byte < 128 ? byte : 256 - byte;
        }
        if (score < bestScore) { bestScore = score; best = filter; }
      }
      out[offset] = best;
      for (let i = 0; i < pass.rowBytes; i++) {
        const left = i >= bpp ? raw[start + i - bpp] : 0, up = previous >= 0 ? raw[previous + i] : 0, corner = previous >= 0 && i >= bpp ? raw[previous + i - bpp] : 0;
        out[start + i] = (raw[start + i] - predict(best, left, up, corner)) & 255;
      }
      previous = start; offset += 1 + pass.rowBytes;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width, 0); ihdr.writeUInt32BE(header.height, 4);
  ihdr[8] = header.depth; ihdr[9] = header.color; ihdr[12] = header.interlace;
  const chunks = [PNG_SIGNATURE, pngChunk('IHDR', ihdr), ...color.map(chunk => pngChunk(chunk.type, chunk.body))];
  if (palette) chunks.push(pngChunk('PLTE', palette));
  if (transparency) chunks.push(pngChunk('tRNS', transparency));
  chunks.push(pngChunk('IDAT', deflateSync(out, { level: 9 })), pngChunk('IEND'));
  return Buffer.concat(chunks);
}
// RGBA pixels (top row first) to a PNG.
function rgbaToPng(width, height, rgba) {
  const rowBytes = width * 4, raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  return writePng({ header:{ width, height, depth:8, color:6, interlace:0 }, passes:[{ width, height, rowBytes }], bpp:4, raw });
}

// ---------------------------------------------------------------- JPEG
// EXIF orientation (tag 0x0112 in IFD0 of the APP1 "Exif" segment), 1 if absent.
export function jpegOrientation(buf) {
  let pos = 2;
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1], length = buf.readUInt16BE(pos + 2);
    if (marker === 0xda || length < 2) break;
    if (marker === 0xe1 && buf.toString('latin1', pos + 4, pos + 10) === 'Exif\0\0') {
      const tiff = pos + 10, end = pos + 2 + length;
      if (tiff + 8 > end) return 1;
      const little = buf.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = at => at + 2 <= end ? (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at)) : 0;
      const u32 = at => at + 4 <= end ? (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at)) : 0;
      const ifd = tiff + u32(tiff + 4), count = u16(ifd);
      for (let i = 0; i < count && i < 200; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1; }
      }
      return 1;
    }
    pos += 2 + length;
  }
  return 1;
}
// Applies an EXIF orientation to RGBA pixels, so the stored file is upright.
function orient(width, height, rgba, orientation) {
  if (orientation === 1) return { width, height, rgba };
  const swap = orientation >= 5, w = swap ? height : width, h = swap ? width : height, out = Buffer.alloc(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sx, sy;
    switch (orientation) {
      case 2: sx = width - 1 - x; sy = y; break;
      case 3: sx = width - 1 - x; sy = height - 1 - y; break;
      case 4: sx = x; sy = height - 1 - y; break;
      case 5: sx = y; sy = x; break;
      case 6: sx = y; sy = height - 1 - x; break;
      case 7: sx = width - 1 - y; sy = height - 1 - x; break;
      default: sx = width - 1 - y; sy = x; break; // 8
    }
    rgba.copy(out, (y * w + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
  }
  return { width:w, height:h, rgba:out };
}
function sanitizeJpeg(buf) {
  need(buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff, 'Not a JPEG file.');
  let image;
  try { image = decodeJpegPixels(buf, { useTArray:true, formatAsRGBA:true, tolerantDecoding:false, maxResolutionInMP:(MAX_SIDE * MAX_SIDE) / 1e6 + .01, maxMemoryUsageInMB:160 }); }
  catch (error) { fail(/limit exceeded/.test(error.message) ? `JPEG must be at most ${MAX_SIDE}×${MAX_SIDE}.` : 'JPEG data is corrupt or unsupported.'); }
  need(image.width > 0 && image.height > 0 && image.width <= MAX_SIDE && image.height <= MAX_SIDE, `JPEG must be between 1×1 and ${MAX_SIDE}×${MAX_SIDE}.`);
  const orientation = jpegOrientation(buf), upright = orient(image.width, image.height, Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), orientation);
  const encoded = encodeJpegPixels({ data:upright.rgba, width:upright.width, height:upright.height }, 90).data;
  const dropped = [];
  for (let pos = 2; pos + 4 <= buf.length && buf[pos] === 0xff && buf[pos + 1] !== 0xda;) {
    const marker = buf[pos + 1], length = buf.readUInt16BE(pos + 2);
    if (marker === 0xe1) dropped.push(buf.toString('latin1', pos + 4, pos + 8) === 'Exif' ? 'EXIF' : 'XMP');
    else if (marker === 0xe2) dropped.push('ICC');
    else if (marker === 0xfe) dropped.push('comments');
    if (length < 2) break;
    pos += 2 + length;
  }
  return { bytes:Buffer.from(encoded), width:upright.width, height:upright.height, frames:1, dropped:[...new Set(dropped)], orientation };
}

// ---------------------------------------------------------------- BMP
function sanitizeBmp(buf) {
  need(buf.length >= 26 && buf.toString('latin1', 0, 2) === 'BM', 'Not a BMP file.');
  const dataOffset = buf.readUInt32LE(10), headerSize = buf.readUInt32LE(14);
  need([40, 52, 56, 108, 124].includes(headerSize) && 14 + headerSize <= buf.length, 'Unsupported BMP header.');
  const width = buf.readInt32LE(18), rawHeight = buf.readInt32LE(22), bits = buf.readUInt16LE(28), compression = buf.readUInt32LE(30);
  const height = Math.abs(rawHeight), topDown = rawHeight < 0;
  need(width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE, `BMP must be between 1×1 and ${MAX_SIDE}×${MAX_SIDE}.`);
  need([1, 4, 8, 16, 24, 32].includes(bits), 'Unsupported BMP colour depth.');
  need(compression === 0 || (compression === 3 && (bits === 16 || bits === 32)), 'Compressed BMP files are not supported. Save it as PNG.');
  // Channel masks: given for BI_BITFIELDS (after the 40-byte header, or inside V4/V5), else the defaults.
  let masks = bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0];
  if (compression === 3) {
    need(buf.length >= 14 + 40 + 12, 'BMP is truncated.');
    masks = [buf.readUInt32LE(54), buf.readUInt32LE(58), buf.readUInt32LE(62), headerSize >= 56 ? buf.readUInt32LE(66) : 0];
  }
  const palette = [];
  if (bits <= 8) {
    const colours = buf.readUInt32LE(46) || 2 ** bits, start = 14 + headerSize;
    need(colours <= 256 && start + colours * 4 <= buf.length, 'BMP palette is truncated.');
    for (let i = 0; i < colours; i++) palette.push([buf[start + i * 4 + 2], buf[start + i * 4 + 1], buf[start + i * 4], 255]);
  }
  const stride = Math.ceil(width * bits / 32) * 4;
  need(dataOffset + stride * height <= buf.length, 'BMP image data is truncated.');
  const channel = (value, mask) => { if (!mask) return null; let shift = 0; while (!((mask >>> shift) & 1)) shift++; const max = mask >>> shift; return Math.round(((value & mask) >>> shift) * 255 / max); };
  const rgba = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let pixel;
      if (bits <= 8) {
        const index = (buf[row + ((x * bits) >> 3)] >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
        pixel = palette[index] || [0, 0, 0, 255];
      } else {
        const value = bits === 16 ? buf.readUInt16LE(row + x * 2) : bits === 24 ? buf[row + x * 3] | (buf[row + x * 3 + 1] << 8) | (buf[row + x * 3 + 2] << 16) : buf.readUInt32LE(row + x * 4);
        const alpha = bits === 32 ? channel(value, masks[3] || (compression === 0 ? 0xff000000 : 0)) : null;
        if (alpha) anyAlpha = true;
        pixel = [channel(value, masks[0]), channel(value, masks[1]), channel(value, masks[2]), alpha ?? 255];
      }
      rgba[at] = pixel[0]; rgba[at + 1] = pixel[1]; rgba[at + 2] = pixel[2]; rgba[at + 3] = pixel[3];
    }
  }
  // 32-bit BMPs often leave the alpha byte at 0 meaning "unused": treat as opaque.
  if (bits === 32 && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { bytes:rgbaToPng(width, height, rgba), width, height, frames:1, dropped:['converted from BMP'] };
}

// ---------------------------------------------------------------- GIF
export function lzwDecode(data, minCode, count, fill = 0) {
  const out = new Uint8Array(count).fill(fill);
  const clear = 1 << minCode, end = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; }
  let size = minCode + 1, next = end + 1, old = -1, acc = 0, bits = 0, at = 0, written = 0;
  while (written < count) {
    while (bits < size && at < data.length) { acc |= data[at++] << bits; bits += 8; }
    if (bits < size) break; // Short data: the rest stays `fill`, as browsers show it.
    const code = acc & ((1 << size) - 1); acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = end + 1; old = -1; continue; }
    if (code === end) break;
    if (old === -1) {
      need(code < clear, 'GIF image data is corrupt.');
      out[written++] = code; old = code; continue;
    }
    let sp = 0, c = code;
    if (code === next) { stack[sp++] = first[old]; c = old; }
    else need(code < next, 'GIF image data is corrupt.');
    while (c > end) { stack[sp++] = suffix[c]; c = prefix[c]; }
    stack[sp++] = c;
    while (sp > 0 && written < count) out[written++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = old; suffix[next] = c; first[next] = first[old]; next++;
      if (next === 1 << size && size < 12) size++;
    }
    old = code;
  }
  return out;
}

let lzwCodes = null, lzwStamps = null, lzwGeneration = 0;
export function lzwEncode(indices, minCode) {
  // Dictionary keyed by (prefix code << 8 | next index); entries from earlier
  // tables are invalidated by bumping a generation stamp instead of clearing.
  lzwCodes ||= new Int16Array(1 << 20); lzwStamps ||= new Int32Array(1 << 20);
  const clear = 1 << minCode, end = clear + 1, bytes = [];
  let size = minCode + 1, next = end + 1, acc = 0, bits = 0, generation = ++lzwGeneration;
  const emit = code => { acc |= code << bits; bits += size; while (bits >= 8) { bytes.push(acc & 255); acc >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i], key = (prefix << 8) | value;
    if (lzwStamps[key] === generation) { prefix = lzwCodes[key]; continue; }
    emit(prefix);
    if (next < 4096) {
      lzwCodes[key] = next; lzwStamps[key] = generation; next++;
      if (next > (1 << size) && size < 12) size++;
    }
    if (next === 4096) { emit(clear); size = minCode + 1; next = end + 1; generation = ++lzwGeneration; }
    prefix = value;
  }
  emit(prefix);
  // The decoder adds one more entry on reading `prefix` before it reads the
  // end code, which can widen the code size.
  if (next < 4096) { next++; if (next > (1 << size) && size < 12) size++; }
  emit(end);
  if (bits > 0) bytes.push(acc & 255);
  if (lzwGeneration > 2e9) { lzwGeneration = 0; lzwStamps.fill(0); }
  return Buffer.from(bytes);
}
function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) { const piece = data.subarray(i, i + 255); parts.push(Buffer.from([piece.length]), piece); }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function sanitizeGif(buf) {
  need(buf.length >= 13 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6)), 'Not a GIF file.');
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8), packed = buf[10];
  need(width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE, `GIF must be between 1×1 and ${MAX_SIDE}×${MAX_SIDE}.`);
  let pos = 13;
  const globalSize = packed & 0x80 ? 3 * (2 << (packed & 7)) : 0;
  need(pos + globalSize <= buf.length, 'GIF color table is truncated.');
  const globalTable = globalSize ? buf.subarray(pos, pos + globalSize) : null;
  pos += globalSize;
  const blocks = () => {
    const parts = [];
    for (;;) {
      need(pos < buf.length, 'GIF data is truncated.');
      const length = buf[pos++];
      if (!length) return parts;
      need(pos + length <= buf.length, 'GIF data is truncated.');
      parts.push(buf.subarray(pos, pos + length)); pos += length;
    }
  };
  const frames = [], dropped = new Set();
  let control = null, loop = null, pixels = 0;
  for (;;) {
    need(pos < buf.length, 'GIF is missing its end marker.');
    const block = buf[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      need(pos < buf.length, 'GIF data is truncated.');
      const label = buf[pos++], parts = blocks();
      if (label === 0xf9) {
        const body = Buffer.concat(parts);
        need(body.length === 4, 'Invalid GIF frame timing.');
        // Keep disposal and transparency; drop the obsolete user-input flag.
        control = { packed: body[0] & 0x1d, delay: body.readUInt16LE(1), transparent: body[3] };
      } else if (label === 0xff && parts[0]?.length === 11 && ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(parts[0].toString('latin1')) && parts[1]?.length === 3 && parts[1][0] === 1) {
        loop = parts[1].readUInt16LE(1);
      } else dropped.add(label === 0xfe ? 'comments' : label === 0x01 ? 'plain text' : 'application data');
    } else if (block === 0x2c) {
      need(pos + 9 <= buf.length, 'GIF frame is truncated.');
      const left = buf.readUInt16LE(pos), top = buf.readUInt16LE(pos + 2), w = buf.readUInt16LE(pos + 4), h = buf.readUInt16LE(pos + 6), flags = buf[pos + 8];
      pos += 9;
      need(w > 0 && h > 0 && w <= MAX_SIDE && h <= MAX_SIDE && left + w <= 65535 && top + h <= 65535, 'Invalid GIF frame size.');
      const localSize = flags & 0x80 ? 3 * (2 << (flags & 7)) : 0;
      need(pos + localSize <= buf.length, 'GIF color table is truncated.');
      const localTable = localSize ? buf.subarray(pos, pos + localSize) : null;
      pos += localSize;
      need(globalTable || localTable, 'GIF frame has no colors.');
      need(pos < buf.length, 'GIF data is truncated.');
      const minCode = buf[pos++];
      need(minCode >= 2 && minCode <= 8, 'Invalid GIF image data.');
      need(frames.length < MAX_FRAMES, `GIF has more than ${MAX_FRAMES} frames.`);
      pixels += w * h;
      need(pixels <= MAX_TOTAL_PIXELS, 'GIF animation is too large to process.');
      const fill = control && control.packed & 1 ? control.transparent : 0;
      const indices = lzwDecode(Buffer.concat(blocks()), minCode, w * h, fill);
      frames.push({ control, left, top, w, h, flags: flags & 0xc7, localTable, minCode, indices });
      control = null;
    } else fail('GIF data is corrupt.');
  }
  need(frames.length, 'GIF has no frames.');
  if (pos < buf.length) dropped.add('trailing data');
  const parts = [Buffer.from('GIF89a', 'latin1')];
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0); screen.writeUInt16LE(height, 2); screen[4] = packed & 0xf7; screen[5] = buf[11]; screen[6] = 0;
  parts.push(screen);
  if (globalTable) parts.push(globalTable);
  if (frames.length > 1 && loop !== null) {
    const loopBlock = Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'latin1'), 3, 1, 0, 0, 0]);
    loopBlock.writeUInt16LE(loop, 16); parts.push(loopBlock);
  }
  for (const frame of frames) {
    if (frame.control) {
      const block = Buffer.from([0x21, 0xf9, 4, frame.control.packed, 0, 0, frame.control.transparent, 0]);
      block.writeUInt16LE(frame.control.delay, 4); parts.push(block);
    }
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c; descriptor.writeUInt16LE(frame.left, 1); descriptor.writeUInt16LE(frame.top, 3);
    descriptor.writeUInt16LE(frame.w, 5); descriptor.writeUInt16LE(frame.h, 7); descriptor[9] = frame.flags;
    parts.push(descriptor);
    if (frame.localTable) parts.push(frame.localTable);
    parts.push(Buffer.from([frame.minCode]), subBlocks(lzwEncode(frame.indices, frame.minCode)));
  }
  parts.push(Buffer.from([0x3b]));
  return { bytes: Buffer.concat(parts), width, height, frames: frames.length, dropped: [...dropped] };
}

// ---------------------------------------------------------------- WebP
function riffChunks(buf, start, end) {
  const chunks = [];
  let pos = start;
  while (pos < end) {
    need(pos + 8 <= end, 'WebP chunk is truncated.');
    const type = buf.toString('latin1', pos, pos + 4), size = buf.readUInt32LE(pos + 4);
    need(pos + 8 + size <= end, 'WebP chunk is truncated.');
    chunks.push({ type, data: buf.subarray(pos + 8, pos + 8 + size) });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}
function riffChunk(type, data) {
  const head = Buffer.alloc(8); head.write(type, 0, 'latin1'); head.writeUInt32LE(data.length, 4);
  return Buffer.concat(data.length & 1 ? [head, data, Buffer.alloc(1)] : [head, data]);
}
function bitstreamSize(chunk) {
  const d = chunk.data;
  if (chunk.type === 'VP8L') {
    need(d.length >= 5 && d[0] === 0x2f, 'Invalid WebP lossless data.');
    const bits = d.readUInt32LE(1);
    need(bits >>> 29 === 0, 'Unsupported WebP lossless version.');
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  need(d.length >= 10, 'Invalid WebP data.');
  const tag = d[0] | (d[1] << 8) | (d[2] << 16);
  need((tag & 1) === 0 && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a, 'Invalid WebP data.');
  need((tag >>> 5) <= d.length - 10, 'WebP data is truncated.');
  return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff };
}
function imageChunks(chunks, label) {
  // An image is an optional ALPH (lossy only) followed by VP8 or VP8L; anything else is dropped.
  const index = chunks.findIndex(chunk => chunk.type === 'VP8 ' || chunk.type === 'VP8L');
  need(index >= 0, `${label} has no image data.`);
  const image = chunks[index], alpha = chunks.slice(0, index).find(chunk => chunk.type === 'ALPH');
  const size = bitstreamSize(image);
  const kept = [];
  if (alpha && image.type === 'VP8 ') {
    need(alpha.data.length >= 1 && (alpha.data[0] & 3) <= 1 && (alpha.data[0] >> 6) === 0, 'Invalid WebP transparency.');
    kept.push(alpha);
  }
  kept.push(image);
  return { size, kept };
}

function sanitizeWebp(buf) {
  need(buf.length >= 20 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP', 'Not a WebP file.');
  const end = buf.readUInt32LE(4) + 8;
  need(end >= 20 && end <= buf.length, 'WebP file is truncated.');
  const dropped = new Set(), chunks = riffChunks(buf, 12, end);
  if (end < buf.length) dropped.add('trailing data');
  need(chunks.length, 'WebP file is empty.');
  const box = size => need(size.width > 0 && size.height > 0 && size.width <= MAX_SIDE && size.height <= MAX_SIDE, `WebP must be between 1×1 and ${MAX_SIDE}×${MAX_SIDE}.`);
  const wrap = body => { const riff = Buffer.alloc(12); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length + 4, 4); riff.write('WEBP', 8, 'latin1'); return Buffer.concat([riff, body]); };
  if (chunks[0].type !== 'VP8X') {
    const { size, kept } = imageChunks(chunks, 'WebP');
    box(size);
    for (const chunk of chunks) if (!kept.includes(chunk)) dropped.add(chunk.type.trim());
    return { bytes: wrap(Buffer.concat(kept.map(chunk => riffChunk(chunk.type, chunk.data)))), width: size.width, height: size.height, frames: 1, dropped: [...dropped] };
  }
  const head = chunks[0].data;
  need(head.length >= 10, 'Invalid WebP header.');
  const animated = Boolean(head[0] & 0x02);
  const canvas = { width: head.readUIntLE(4, 3) + 1, height: head.readUIntLE(7, 3) + 1 };
  box(canvas);
  for (const chunk of chunks.slice(1)) if (!['ALPH', 'VP8 ', 'VP8L', 'ANIM', 'ANMF'].includes(chunk.type)) dropped.add(chunk.type.trim());
  const body = [], alpha = Boolean(head[0] & 0x10);
  let frames = 1;
  if (animated) {
    const anim = chunks.find(chunk => chunk.type === 'ANIM');
    need(anim && anim.data.length === 6, 'Animated WebP is missing its settings.');
    const list = chunks.filter(chunk => chunk.type === 'ANMF');
    need(list.length > 0 && list.length <= MAX_FRAMES, `Animated WebP must have 1–${MAX_FRAMES} frames.`);
    let pixels = 0;
    body.push(riffChunk('ANIM', Buffer.from(anim.data)));
    for (const frame of list) {
      const d = frame.data;
      need(d.length >= 16, 'WebP frame is truncated.');
      const x = d.readUIntLE(0, 3) * 2, y = d.readUIntLE(3, 3) * 2, w = d.readUIntLE(6, 3) + 1, h = d.readUIntLE(9, 3) + 1;
      need(x + w <= canvas.width && y + h <= canvas.height, 'WebP frame lies outside the image.');
      pixels += w * h;
      need(pixels <= MAX_TOTAL_PIXELS, 'WebP animation is too large to process.');
      const image = imageChunks(riffChunks(d, 16, d.length), 'WebP frame');
      need(image.size.width === w && image.size.height === h, 'WebP frame size does not match its data.');
      body.push(riffChunk('ANMF', Buffer.concat([d.subarray(0, 16), ...image.kept.map(chunk => riffChunk(chunk.type, chunk.data))])));
    }
    frames = list.length;
  } else {
    const image = imageChunks(chunks.slice(1), 'WebP');
    need(image.size.width === canvas.width && image.size.height === canvas.height, 'WebP size does not match its data.');
    body.push(...image.kept.map(chunk => riffChunk(chunk.type, chunk.data)));
  }
  const vp8x = Buffer.alloc(10);
  vp8x[0] = (alpha ? 0x10 : 0) | (animated ? 0x02 : 0);
  vp8x.writeUIntLE(canvas.width - 1, 4, 3); vp8x.writeUIntLE(canvas.height - 1, 7, 3);
  return { bytes: wrap(Buffer.concat([riffChunk('VP8X', vp8x), ...body])), width: canvas.width, height: canvas.height, frames, dropped: [...dropped] };
}
