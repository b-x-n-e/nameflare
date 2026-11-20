// Backups and restores for the Node/SQLite deployment.
//
// A backup directory holds one folder per snapshot plus a shared image pool:
//
//   backups/
//     nameflare-20261120T033000Z/
//       nameflare.sqlite   consistent copy made with VACUUM INTO (safe while the server runs)
//       manifest.json      database hash, row counts, and the images the snapshot needs
//     textures/            images, named by their SHA-256, stored once for every snapshot
//
// Every image ID is the SHA-256 of its stored bytes, so the pool deduplicates
// itself and every copy can be verified.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const TEXTURE = /^[a-f0-9]{64}\.(gif|png|webp)$/;
export const SNAPSHOT = /^nameflare-\d{8}T\d{6}Z$/;
const stampOf = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function inspectDatabase(path) {
  const db = new DatabaseSync(path);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check);
    const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      ok:integrity.length === 1 && integrity[0] === 'ok', integrity:integrity.slice(0, 5),
      counts:{ users:count('users'), flares:count('cosmetics'), textures:count('textures') },
      textures:db.prepare('SELECT id FROM textures ORDER BY id').all().map(row => row.id).filter(id => TEXTURE.test(id))
    };
  } finally { db.close(); }
}

export function createBackup({ dataDir, backupDir, keep = 14, now = new Date() }) {
  dataDir = resolve(dataDir); backupDir = resolve(backupDir);
  const source = join(dataDir, 'nameflare.sqlite');
  if (!existsSync(source)) throw new Error(`No database at ${source}.`);
  const name = `nameflare-${stampOf(now)}`, folder = join(backupDir, name), pool = join(backupDir, 'textures');
  if (existsSync(folder)) throw new Error(`${name} already exists.`);
  mkdirSync(pool, { recursive:true, mode:0o700 });
  const partial = `${folder}.partial`;
  rmSync(partial, { recursive:true, force:true });
  mkdirSync(partial, { mode:0o700 });
  try {
    // 1. One consistent copy of the live database, without stopping the server.
    const live = new DatabaseSync(source);
    try { live.exec('PRAGMA busy_timeout=10000'); live.exec(`VACUUM INTO '${join(partial, 'nameflare.sqlite').replace(/'/g, "''")}'`); }
    finally { live.close(); }
    const database = readFileSync(join(partial, 'nameflare.sqlite')), inspected = inspectDatabase(join(partial, 'nameflare.sqlite'));
    if (!inspected.ok) throw new Error(`The database copy failed its integrity check: ${inspected.integrity.join('; ')}`);
    // 2. Images the database refers to, copied into the shared pool once.
    const missing = [], damaged = [];
    let copied = 0;
    for (const id of inspected.textures) {
      const from = join(dataDir, 'textures', id), to = join(pool, id);
      if (existsSync(to)) continue;
      if (!existsSync(from)) { missing.push(id); continue; }
      const bytes = readFileSync(from);
      if (sha256(bytes) !== id.split('.')[0]) { damaged.push(id); continue; }
      writeFileSync(`${to}.partial`, bytes, { mode:0o600 }); renameSync(`${to}.partial`, to); copied++;
    }
    const manifest = { format:'nameflare-backup', version:1, created_at:now.toISOString(), database:{ file:'nameflare.sqlite', sha256:sha256(database), bytes:database.length }, counts:inspected.counts, textures:inspected.textures.filter(id => !missing.includes(id) && !damaged.includes(id)), missing, damaged };
    writeFileSync(join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode:0o600 });
    renameSync(partial, folder);
    const pruned = pruneBackups(backupDir, keep);
    return { name, path:folder, manifest, copied, pruned };
  } catch (error) { rmSync(partial, { recursive:true, force:true }); throw error; }
}

export function listBackups(backupDir) {
  backupDir = resolve(backupDir);
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir).filter(name => SNAPSHOT.test(name) && existsSync(join(backupDir, name, 'manifest.json'))).sort().map(name => {
    const manifest = JSON.parse(readFileSync(join(backupDir, name, 'manifest.json'), 'utf8'));
    return { name, created_at:manifest.created_at, counts:manifest.counts, textures:manifest.textures.length, problems:manifest.missing.length + manifest.damaged.length };
  });
}

// Keeps the newest `keep` snapshots and removes pool images none of them need.
export function pruneBackups(backupDir, keep = 14) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Keep at least one backup.');
  const all = listBackups(backupDir).map(item => item.name), pruned = all.slice(0, Math.max(0, all.length - keep));
  for (const name of pruned) rmSync(join(backupDir, name), { recursive:true, force:true });
  const needed = new Set(), pool = join(backupDir, 'textures');
  for (const name of all.slice(pruned.length)) for (const id of JSON.parse(readFileSync(join(backupDir, name, 'manifest.json'), 'utf8')).textures) needed.add(id);
  if (existsSync(pool)) for (const file of readdirSync(pool)) if (!needed.has(file)) rmSync(join(pool, file), { force:true });
  return pruned;
}

export function verifyBackup(snapshot) {
  snapshot = resolve(snapshot);
  const problems = [], manifestPath = join(snapshot, 'manifest.json');
  if (!existsSync(manifestPath)) return { ok:false, problems:['manifest.json is missing'] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')), pool = join(dirname(snapshot), 'textures');
  if (manifest.format !== 'nameflare-backup' || manifest.version !== 1) problems.push('Unknown backup format');
  const databasePath = join(snapshot, manifest.database?.file || 'nameflare.sqlite');
  if (!existsSync(databasePath)) problems.push('Database file is missing');
  else {
    if (sha256(readFileSync(databasePath)) !== manifest.database.sha256) problems.push('Database file does not match its checksum');
    else { const inspected = inspectDatabase(databasePath); if (!inspected.ok) problems.push(`Database integrity: ${inspected.integrity.join('; ')}`); }
  }
  for (const id of manifest.textures || []) {
    const file = join(pool, id);
    if (!existsSync(file)) problems.push(`Image ${id} is missing from the pool`);
    else if (sha256(readFileSync(file)) !== id.split('.')[0]) problems.push(`Image ${id} is damaged`);
  }
  return { ok:problems.length === 0, problems, manifest };
}

function serverRunning(dataDir) {
  const pidFile = join(dataDir, 'server.pid');
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return pid; } catch (error) { return error.code === 'EPERM' ? pid : null; }
}

// Replaces the data directory's database and images with a snapshot. The
// current files are moved aside (never deleted) so a restore can be undone.
export function restoreBackup({ snapshot, dataDir, force = false, now = new Date() }) {
  snapshot = resolve(snapshot); dataDir = resolve(dataDir);
  const running = serverRunning(dataDir);
  if (running) throw new Error(`Nameflare is running (process ${running}). Stop it first, for example: sudo systemctl stop nameflare`);
  const verified = verifyBackup(snapshot);
  if (!verified.ok && !force) throw new Error(`The backup failed verification:\n- ${verified.problems.join('\n- ')}\nPass --force to restore what is intact.`);
  const { manifest } = verified, pool = join(dirname(snapshot), 'textures');
  mkdirSync(dataDir, { recursive:true });
  const aside = join(dataDir, `pre-restore-${stampOf(now)}`);
  mkdirSync(aside, { mode:0o700 });
  for (const file of ['nameflare.sqlite', 'nameflare.sqlite-wal', 'nameflare.sqlite-shm', 'textures']) if (existsSync(join(dataDir, file))) renameSync(join(dataDir, file), join(aside, file));
  copyFileSync(join(snapshot, manifest.database.file), join(dataDir, 'nameflare.sqlite.partial'));
  renameSync(join(dataDir, 'nameflare.sqlite.partial'), join(dataDir, 'nameflare.sqlite'));
  mkdirSync(join(dataDir, 'textures'), { recursive:true, mode:0o700 });
  let restored = 0;
  for (const id of manifest.textures) { if (existsSync(join(pool, id))) { copyFileSync(join(pool, id), join(dataDir, 'textures', id)); restored++; } }
  const inspected = inspectDatabase(join(dataDir, 'nameflare.sqlite'));
  if (!inspected.ok) throw new Error(`The restored database failed its integrity check. Your previous data is in ${aside}.`);
  return { name:basename(snapshot), aside, counts:inspected.counts, textures:restored, problems:verified.problems };
}

