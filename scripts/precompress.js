#!/usr/bin/env node
// Writes Brotli (.br) and gzip (.gz) copies of every compressible file in
// public/, so the server never compresses on a visitor's time. Run it after
// each deploy (docs/OPERATIONS.md); copies older than their source are ignored.
//
//   node scripts/precompress.js [--clean]
import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const clean = process.argv.includes('--clean');
const compressible = /\.(js|css|html|json|svg|md|txt)$/;
let files = 0, before = 0, after = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes:true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.(br|gz)$/.test(entry.name)) { if (clean) rmSync(full); continue; }
    if (clean || !compressible.test(entry.name)) continue;
    const stat = statSync(full);
    if (stat.size <= 1024) continue;
    const body = readFileSync(full);
    const br = brotliCompressSync(body, { params:{ [constants.BROTLI_PARAM_QUALITY]:11, [constants.BROTLI_PARAM_SIZE_HINT]:body.length } }), gz = gzipSync(body, { level:9 });
    for (const [extension, data] of [['br', br], ['gz', gz]]) { writeFileSync(`${full}.${extension}`, data); utimesSync(`${full}.${extension}`, stat.atime, new Date(Math.max(Date.now(), stat.mtimeMs))); }
    files++; before += body.length; after += br.length;
  }
}
walk(publicDir);
console.log(clean ? 'Removed precompressed copies.' : `Precompressed ${files} files: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB with Brotli.`);
