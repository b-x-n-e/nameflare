#!/usr/bin/env node
// Back up a Nameflare data directory, list backups, or verify one.
//
//   node scripts/backup.js [--data DIR] [--out DIR] [--keep 14]
//   node scripts/backup.js --list [--out DIR]
//   node scripts/backup.js --verify nameflare-20261120T033000Z [--out DIR]
//
// DATA_DIR and BACKUP_DIR are used when --data and --out are not given.
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { createBackup, listBackups, verifyBackup } from '../lib/backup.js';

const { values } = parseArgs({ options:{ data:{ type:'string' }, out:{ type:'string' }, keep:{ type:'string', default:'14' }, list:{ type:'boolean' }, verify:{ type:'string' } } });
const dataDir = resolve(values.data || process.env.DATA_DIR || 'data'), backupDir = resolve(values.out || process.env.BACKUP_DIR || 'backups');
try {
  if (values.list) {
    const backups = listBackups(backupDir);
    if (!backups.length) console.log(`No backups in ${backupDir}.`);
    for (const item of backups) console.log(`${item.name}  ${item.counts.users} accounts · ${item.counts.flares} Flares · ${item.textures} images${item.problems ? ` · ${item.problems} problems` : ''}`);
  } else if (values.verify) {
    const result = verifyBackup(values.verify.includes('/') ? values.verify : join(backupDir, values.verify));
    console.log(result.ok ? 'Backup verified: database checksum, integrity and every image match.' : `Backup has problems:\n- ${result.problems.join('\n- ')}`);
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const keep = Number(values.keep);
    const result = createBackup({ dataDir, backupDir, keep });
    const { counts, missing, damaged } = result.manifest;
    console.log(`Backed up to ${result.path}: ${counts.users} accounts, ${counts.flares} Flares, ${result.manifest.textures.length} images (${result.copied} new).`);
    if (result.pruned.length) console.log(`Removed ${result.pruned.length} older backup(s), keeping ${keep}.`);
    if (missing.length || damaged.length) { console.warn(`Warning: ${missing.length} image(s) missing and ${damaged.length} damaged in ${dataDir}/textures.`); process.exitCode = 2; }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
