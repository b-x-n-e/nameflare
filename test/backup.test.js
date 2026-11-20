import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createBackup, listBackups, verifyBackup, restoreBackup, pruneBackups } from '../lib/backup.js';

const recipe = { colors:['#ff1a35','#ffffff'], animation:'none', speed:4, angle:120, glow:0 };
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'nameflare-backup-')), dataDir = join(root, 'data'), backupDir = join(root, 'backups');
  mkdirSync(join(dataDir, 'textures'), { recursive:true });
  const store = new Store(join(dataDir, 'nameflare.sqlite')); store.seedDemo();
  const addImage = content => {
    const bytes = Buffer.from(content), id = `${createHash('sha256').update(bytes).digest('hex')}.png`;
    writeFileSync(join(dataDir, 'textures', id), bytes); store.addTexture(id, 'demo-owner'); return id;
  };
  return { root, dataDir, backupDir, store, addImage, done:() => { try { store.close(); } catch {} rmSync(root, { recursive:true, force:true }); } };
}

test('a backup taken while the database is open restores exactly, and the previous data is kept aside', () => {
  const { dataDir, backupDir, store, addImage, done } = setup();
  try {
    const image = addImage('first image');
    const flare = store.submit('demo-owner', 'Backed up', '', { ...recipe, layers:[{ type:'image', textureId:image }] });
    const backup = createBackup({ dataDir, backupDir, now:new Date('2026-11-20T03:30:00Z') });
    assert.equal(backup.name, 'nameflare-20261120T033000Z');
    assert.deepEqual(backup.manifest.textures, [image]);
    assert.equal(backup.manifest.counts.users, 3);
    assert.equal(verifyBackup(backup.path).ok, true);
    // Later changes that the restore must undo.
    store.removeFlare(flare.id); rmSync(join(dataDir, 'textures', image));
    store.linkIdentity({ provider:'twitch', id:'9999', login:'later', name:'later' });
    // The guard reads server.pid; this test process stands in for a live server.
    writeFileSync(join(dataDir, 'server.pid'), String(process.pid));
    assert.throws(() => restoreBackup({ snapshot:backup.path, dataDir }), /running/);
    rmSync(join(dataDir, 'server.pid'));
    store.close();
    const result = restoreBackup({ snapshot:backup.path, dataDir, now:new Date('2026-11-21T00:00:00Z') });
    assert.equal(result.textures, 1);
    const restored = new Store(join(dataDir, 'nameflare.sqlite'));
    try {
      assert.ok(restored.getCosmetic(flare.id));
      assert.equal(restored.resolve('twitch', '9999'), null);
      assert.ok(existsSync(join(dataDir, 'textures', image)));
    } finally { restored.close(); }
    assert.ok(existsSync(join(result.aside, 'nameflare.sqlite')), 'Previous database moved aside');
  } finally { done(); }
});

test('images are stored once across snapshots, old snapshots are pruned, and damage is detected', () => {
  const { dataDir, backupDir, store, addImage, done } = setup();
  try {
    const a = addImage('shared');
    store.submit('demo-owner', 'A', '', { ...recipe, layers:[{ type:'image', textureId:a }] });
    createBackup({ dataDir, backupDir, now:new Date('2026-11-18T03:30:00Z') });
    const b = addImage('second');
    const second = createBackup({ dataDir, backupDir, now:new Date('2026-11-19T03:30:00Z') });
    assert.equal(second.copied, 1, 'Only the new image is copied');
    assert.equal(readdirSync(join(backupDir, 'textures')).length, 2);
    store.db.prepare('DELETE FROM textures WHERE id=?').run(b);
    createBackup({ dataDir, backupDir, now:new Date('2026-11-20T03:30:00Z') });
    assert.deepEqual(pruneBackups(backupDir, 1), ['nameflare-20261118T033000Z', 'nameflare-20261119T033000Z']);
    assert.deepEqual(readdirSync(join(backupDir, 'textures')), [a], 'Images no snapshot needs are removed');
    assert.equal(listBackups(backupDir).length, 1);
    writeFileSync(join(backupDir, 'textures', a), 'tampered');
    const verdict = verifyBackup(join(backupDir, 'nameflare-20261120T033000Z'));
    assert.equal(verdict.ok, false); assert.match(verdict.problems[0], /damaged/);
    assert.throws(() => restoreBackup({ snapshot:join(backupDir, 'nameflare-20261120T033000Z'), dataDir }), /verification/);
  } finally { done(); }
});

test('the command-line scripts back up, list, verify and restore', () => {
  const { dataDir, backupDir, store, done } = setup();
  try {
    const run = (script, ...args) => execFileSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', script), ...args], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
    assert.match(run('backup.js', '--data', dataDir, '--out', backupDir), /3 accounts/);
    const [name] = readdirSync(backupDir).filter(file => file.startsWith('nameflare-'));
    assert.match(run('backup.js', '--list', '--out', backupDir), new RegExp(name));
    assert.match(run('backup.js', '--verify', name, '--out', backupDir), /verified/);
    assert.throws(() => run('restore.js', name, '--data', dataDir, '--from', backupDir), /--yes/);
    store.close();
    assert.match(run('restore.js', name, '--yes', '--data', dataDir, '--from', backupDir), /Restored/);
    assert.ok(readFileSync(join(dataDir, 'nameflare.sqlite')).length > 0);
  } finally { done(); }
});
