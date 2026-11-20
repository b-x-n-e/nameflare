#!/usr/bin/env bash
# oracle-deploy.sh
# Run in an Oracle SSH terminal as the ubuntu user AFTER SSH is available.
# This script is generated for a manual, reviewed deployment. It stops and
# restarts the live service only after a successful staged extraction.
#
# IMPORTANT: this archive mirrors the source-tree layout from this repo:
#   server.js, package.json, wrangler.jsonc, Dockerfile, compose.yaml,
#   .env.example, .gitignore, .dockerignore,
#   lib/{store,cosmetics,oauth}.js,
#   cloudflare/{worker,store}.js, cloudflare/migrations/*.sql,
#   public/{index.html,app.js,routes.js,likes.js,renderer.js,paints.js,
#     editor.js,fonts.js,client.js,overlay.js,overlay.html,overlay.css,
#     effects.css,fonts/OFL.txt,fonts/BricolageGrotesque.ttf,logo.svg,
#     style.css,SDK-LICENSE.md,google-fonts.json},
#   docs/, scripts/, test/, and package-lock.json
#
# Do NOT extract this archive directly over a running service. The generated
# activation step replaces the live release only after review and testing.
set -euo pipefail

# Set SSH_USER_HOST=ubuntu@<server-ip> in the environment; no address is kept in source.
SSH_USER_HOST="${SSH_USER_HOST:-ubuntu@<server-ip>}"
RELEASE_DIR="/home/ubuntu/nameflare"
SERVICE="nameflare"
RUNTIME_BIN="/home/ubuntu/nameflare-runtime/bin/node"
ARCHIVE="/home/ubuntu/oracle-deploy-archive.tar.gz"
STAGE_DIR_NAME="oracle-deploy-20261013T112502Z"
STAGE_DIR="$RELEASE_DIR/$STAGE_DIR_NAME"

if [ ! -f "$ARCHIVE" ]; then
  echo "ARCHIVE_MISSING: $ARCHIVE" >&2
  echo "Expected the archive to be uploaded first:" >&2
  echo "  scp .wrangler/oracle-deploy-20261013T112502Z.tar.gz ${SSH_USER_HOST}:${ARCHIVE}" >&2
  exit 1
fi

if [ -d "$STAGE_DIR" ]; then
  echo "STAGE_DIR_EXISTS: $STAGE_DIR" >&2
  echo "Remove it first if you want a fresh staged release." >&2
  exit 1
fi

# Snapshot current release tree for rollback safety before touching anything.
echo "--- Backing up current release files (not data or private config) ---"
NOW=$(date -u +'%Y%m%dT%H%M%SZ')
BACKUP_DIR="$RELEASE_DIR/release-before-$NOW"
KNOWN=(
  "server.js"
  "package.json"
  "wrangler.jsonc"
  "Dockerfile"
  "compose.yaml"
  ".env.example"
  ".gitignore"
  ".dockerignore"
  "lib/store.js"
  "lib/cosmetics.js"
  "lib/oauth.js"
  "cloudflare/worker.js"
  "cloudflare/store.js"
  "cloudflare/migrations/0001_initial.sql"
  "cloudflare/migrations/0002_profile_avatars.sql"
  "cloudflare/migrations/0003_flare_publication.sql"
  "cloudflare/migrations/0004_account_moderation.sql"
  "cloudflare/migrations/0005_cosmetic_likes.sql"
  "cloudflare/migrations/0006_full_profiles.sql"
  "cloudflare/migrations/0007_creator_follows.sql"
  "cloudflare/migrations/0008_flare_submission_limit.sql"
  "public/index.html"
  "public/app.js"
  "public/routes.js"
  "public/likes.js"
  "public/renderer.js"
  "public/paints.js"
  "public/editor.js"
  "public/fonts.js"
  "public/client.js"
  "public/overlay.js"
  "public/overlay.html"
  "public/overlay.css"
  "public/effects.css"
  "public/fonts/OFL.txt"
  "public/fonts/BricolageGrotesque.ttf"
  "public/logo.svg"
  "public/style.css"
  "public/SDK-LICENSE.md"
  "public/google-fonts.json"
  "docs/ORACLE.md"
  "docs/API.md"
  "SECURITY.md"
  "README.md"
  "docs/oracle/nameflare.service"
  "docs/oracle/nameflare.nginx.conf"
  "docs/oracle/nameflare-http.nginx.conf"
  "scripts/update-google-fonts.js"
)
mkdir -p "$BACKUP_DIR"
MISSING=""
for f in "${KNOWN[@]+"${KNOWN[@]}"}"; do
  if [ -f "$RELEASE_DIR/$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -a "$RELEASE_DIR/$f" "$BACKUP_DIR/$f"
  else
    MISSING="$MISSING $f"
  fi
done

if [ -n "$MISSING" ]; then
  echo "SNAPSHOT_INCOMPLETE:${MISSING}" >&2
  printf 'INCOMPLETE\n' > "$BACKUP_DIR/.snapshot-status"
else
  printf 'OK\n' > "$BACKUP_DIR/.snapshot-status"
fi

printf '{"release":"nameflare","backupDir":"%s","note":"snapshot before update"}\n' "$BACKUP_DIR" > "$BACKUP_DIR/release-metadata.json"
echo "Backup: $BACKUP_DIR"

# Extract staged release to a timestamped subdirectory, preserving attributes.
echo "--- Extracting staged release ---"
mkdir -p "$STAGE_DIR"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
echo "Staged: $STAGE_DIR"

# Verify the staged package has the expected core entrypoints.
echo "--- Staged package quick sanity check ---"
FAIL=0
for f in server.js package.json public/app.js public/fonts.js public/editor.js public/index.html public/google-fonts.json lib/store.js lib/cosmetics.js lib/oauth.js cloudflare/worker.js cloudflare/store.js; do
  if [ ! -f "$STAGE_DIR/$f" ]; then
    echo "STAGED_MISSING: $f" >&2
    FAIL=1
  fi
done
if [ "$FAIL" -ne 0 ]; then
  echo "STAGED_PACKAGE_INCOMPLETE" >&2
  exit 1
fi

# Optional: run the local Node syntax checks on the staged source if Node is available.
if [ -x "$RUNTIME_BIN" ]; then
  echo "--- Running staged source syntax checks ---"
  "$RUNTIME_BIN" --check "$STAGE_DIR/server.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/lib/store.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/lib/cosmetics.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/lib/oauth.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/app.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/routes.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/likes.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/renderer.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/paints.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/editor.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/fonts.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/scripts/update-google-fonts.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/client.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/public/overlay.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/cloudflare/store.js"
  "$RUNTIME_BIN" --check "$STAGE_DIR/cloudflare/worker.js"
  echo "Staged syntax checks passed"
fi

# Generate a local release metadata snapshot for this update attempt.
STAGED_PKG="$STAGE_DIR/package.json"
RELEASE_NAME="nameflare"
RELEASE_VERSION="0.1.0"
if [ -f "$STAGED_PKG" ] && command -v "$RUNTIME_BIN" >/dev/null 2>&1; then
  RELEASE_VERSION=$("$RUNTIME_BIN" -e 'const p=require(process.argv[1]);process.stdout.write(p.version || "0.1.0");' "$STAGED_PKG" 2>/dev/null || echo "0.1.0")
fi
printf '{"release":"%s","version":"%s","stagedDir":"%s","archiveSha256":"3a76fc68e7a548d43e7a90e02e380b257e72a15c35d7a2ad9f24a5159dfd94aa","deployedAt":"%s","note":"manual staged deploy, run activation before restart"}\n' \
  "$RELEASE_NAME" "$RELEASE_VERSION" "$STAGE_DIR_NAME" "$NOW" > "$STAGE_DIR/release-metadata.json"
echo "Staged metadata: $STAGE_DIR/release-metadata.json"

echo
echo "=== Activation (run after review) ==="
echo
echo "Review the staged release before activation:"
echo "  find $STAGE_DIR -type f | sort"
echo "  cat $STAGE_DIR/release-metadata.json"
echo
echo "After review, run any update hooks you use on Oracle:"
echo "  bash $STAGE_DIR/docs/oracle/update-flare-deletion.sh"
echo "  bash $STAGE_DIR/docs/oracle/update-proxy-limits.sh"
echo
echo "Then replace the live release with the staged one:"
echo "  rm -rf $RELEASE_DIR/release-current"
echo "  cp -a $STAGE_DIR $RELEASE_DIR/release-current"
echo "  ln -sfn $RELEASE_DIR/release-current $RELEASE_DIR/current"
echo
echo "Write the active marker:"
echo "  printf '%s\n' '$STAGE_DIR_NAME' > $RELEASE_DIR/release-active.txt"
echo
echo "And restart the service:"
echo "  sudo systemctl stop $SERVICE"
echo "  sudo systemctl start $SERVICE"
echo "  sudo systemctl status $SERVICE --no-pager"
echo
echo "Do not delete $BACKUP_DIR until the new release is verified."
