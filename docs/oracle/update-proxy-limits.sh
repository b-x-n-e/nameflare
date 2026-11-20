#!/usr/bin/env bash
set -euo pipefail
umask 077
update=/home/ubuntu/nameflare-update-20261008-proxy-limits
live=/home/ubuntu/nameflare
data=/home/ubuntu/nameflare-data
node=/home/ubuntu/nameflare-runtime/bin/node
files=(server.js test/nameflare.test.js docs/oracle/nameflare.nginx.conf docs/oracle/nameflare.service docs/API.md docs/ORACLE.md docs/DEPLOYMENT.md README.md SECURITY.md .env.example)

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
  cp -p /etc/nginx/sites-available/nameflare "$update/nginx-before.conf"
  cp -p /etc/systemd/system/nameflare.service "$update/service-before.conf"
  sha256sum /etc/nginx/sites-available/nameflare /etc/systemd/system/nameflare.service > "$update/config-before.sha256"
  tar -czf "$update/code-before.tar.gz" -C "$live" .
  mkdir "$update/online-backup"
  "$node" --input-type=module - "$data/nameflare.sqlite" "$update/online-backup/nameflare.sqlite" <<'JS'
import { DatabaseSync, backup } from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try {await backup(db,process.argv[3]);} finally {db.close();}
JS
  verify_database "$update/online-backup/nameflare.sqlite"
  cp -a "$data/textures" "$update/online-backup/textures"
  printf '%s\n' 'Prepared. Live code, proxy/service configuration, database and secrets are unchanged.'
  exit 0
fi

[[ ${1:-} == --deploy ]] || { printf '%s\n' 'Use --prepare or --deploy.'; exit 1; }
[[ $(systemctl show nameflare -p ActiveState --value) == inactive ]] || { printf '%s\n' 'Stop nameflare before source installation.'; exit 1; }
test ! -e "$update/deployed"
cmp /etc/nginx/sites-available/nameflare "$update/app/docs/oracle/nameflare.nginx.conf" || { printf '%s\n' 'Install, validate, and reload the overwriting Nginx configuration first.'; exit 1; }
if grep -qE '^[[:space:]]*TRUST_PROXY_LOOPBACK=' /home/ubuntu/nameflare-private/.env; then
  printf '%s\n' 'Private environment overrides proxy trust. Review that setting privately before proceeding.'
  exit 1
fi
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
  printf '%s\n' 'Source install failed; restoring previous source. Data and secrets were not changed.'
  tar -xzf "$backup/code.tar.gz" -C "$live"
}
trap rollback ERR
for file in "${files[@]}"; do cp -p "$update/app/$file" "$live/$file"; done
(cd "$live"; sha256sum --check "$update/staged.sha256"; npm run check)
trap - ERR
printf '%s\n' "$backup" > "$update/deployed"
printf '%s\n' "Source installed. Backup: $backup" 'Install the staged service template, daemon-reload, and start nameflare to activate loopback proxy trust.'
