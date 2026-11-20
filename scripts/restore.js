#!/usr/bin/env node
// Restore a backup into a data directory. Stop the server first.
//
//   node scripts/restore.js nameflare-20261120T033000Z --yes [--data DIR] [--from DIR] [--force]
//
// The current database and images are moved to DATA_DIR/pre-restore-<time>/,
// never deleted. --force restores a backup that failed verification as far
// as it is intact.
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { restoreBackup } from '../lib/backup.js';

const { values, positionals } = parseArgs({ allowPositionals:true, options:{ data:{ type:'string' }, from:{ type:'string' }, yes:{ type:'boolean' }, force:{ type:'boolean' } } });
const dataDir = resolve(values.data || process.env.DATA_DIR || 'data'), backupDir = resolve(values.from || process.env.BACKUP_DIR || 'backups');
const name = positionals[0];
if (!name) { console.error('Name the backup to restore. List them with: node scripts/backup.js --list'); process.exit(1); }
if (!values.yes) { console.error(`This replaces the database and images in ${dataDir}. Run again with --yes to continue.`); process.exit(1); }
try {
  const result = restoreBackup({ snapshot:name.includes('/') ? name : join(backupDir, name), dataDir, force:values.force });
  console.log(`Restored ${result.name}: ${result.counts.users} accounts, ${result.counts.flares} Flares, ${result.textures} images.`);
  console.log(`Your previous data is in ${result.aside}. Start Nameflare again when ready.`);
  if (result.problems.length) console.warn(`Restored with problems:\n- ${result.problems.join('\n- ')}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
