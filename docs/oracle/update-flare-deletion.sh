#!/usr/bin/env bash
set -euo pipefail
umask 077
update=/home/ubuntu/nameflare-update-20261008-flare-deletion
live=/home/ubuntu/nameflare
data=/home/ubuntu/nameflare-data
node=/home/ubuntu/nameflare-runtime/bin/node
files=(server.js lib/store.js public/app.js public/index.html README.md SECURITY.md docs/API.md docs/ORACLE.md test/accounts.test.js)

verify_database() {
  "$node" --input-type=module - "$1" <<'JS'
import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try {
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity check failed.');
  console.log('SQLite backup integrity: ok');
} finally {db.close();}
JS
}

if [[ ${1:-} == --prepare ]]; then
  test ! -e "$update/baseline.sha256"
  (cd "$live"; find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$update/baseline.sha256"
  (cd "$update/app"; sha256sum "${files[@]}") > "$update/staged.sha256"
  tar -czf "$update/code-before.tar.gz" -C "$live" .
  mkdir "$update/online-backup"
  "$node" --input-type=module - "$data/nameflare.sqlite" "$update/online-backup/nameflare.sqlite" <<'JS'
import { DatabaseSync, backup } from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try {await backup(db,process.argv[3]);} finally {db.close();}
JS
  verify_database "$update/online-backup/nameflare.sqlite"
  cp -a "$data/textures" "$update/online-backup/textures"
  printf '%s\n' 'Prepared. Live source, database, secrets, and service are unchanged.'
  exit 0
fi

[[ ${1:-} == --deploy ]] || { printf '%s\n' 'Use --prepare or --deploy.'; exit 1; }
[[ $(systemctl show nameflare -p ActiveState --value) == inactive ]] || { printf '%s\n' 'Stop nameflare with systemctl before installation.'; exit 1; }
test ! -e "$update/deployed"
(cd "$live"; find . -type f -print0 | sort -z | xargs -0 sha256sum) | cmp - "$update/baseline.sha256" || { printf '%s\n' 'Live source changed since staging; installation refused.'; exit 1; }
(cd "$update/app"; sha256sum --check "$update/staged.sha256")
export PATH=/home/ubuntu/nameflare-runtime/bin:$PATH
(cd "$update/app"; npm run check; npm test)
backup="$update/stopped-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$backup"
cp -a "$data" "$backup/data"
tar -czf "$backup/code.tar.gz" -C "$live" .
verify_database "$backup/data/nameflare.sqlite"
rollback() {
  printf '%s\n' 'Installation failed; restoring previous source. Data and secrets were not changed.'
  tar -xzf "$backup/code.tar.gz" -C "$live"
}
trap rollback ERR
for file in "${files[@]}"; do cp -p "$update/app/$file" "$live/$file"; done
(cd "$live"; sha256sum --check "$update/staged.sha256"; npm run check)
trap - ERR
printf '%s\n' "$backup" > "$update/deployed"
printf '%s\n' "Source installed. Backup: $backup" 'Start nameflare with systemctl. No database migration is required.'
