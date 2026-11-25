# Running Nameflare

Day-to-day operations for the Node/SQLite deployment: deploys, backups,
upload scanning, data retention, edge limits and load testing. Server setup
itself (OAuth apps, TLS, the systemd service) is in the [Oracle runbook](ORACLE.md).

## Deploying a new version

1. Unpack the release next to the current one, for example
   `/home/ubuntu/nameflare-releases/release-<time>/`, from `git archive` so only
   committed files go up.
2. In the release folder, run `npm test` with the server's Node, then
   `node scripts/precompress.js`. Precompressing writes `.br` and `.gz` copies
   of the static files so the server never compresses on a visitor's time.
   Without it, the first minute after a restart was several times slower on an
   E2.1.Micro.
3. Take a backup: `sudo systemctl start nameflare-backup`.
4. Point `/home/ubuntu/nameflare` at the new folder and
   `sudo systemctl restart nameflare`. Schema changes are additive and applied
   on start.
5. If `docs/oracle/` changed, install the new nginx site and systemd units (below),
   run `sudo nginx -t`, then reload.

Rolling back is the same switch pointed at the previous folder.

## Backups

`scripts/backup.js` takes a consistent copy of the live database with SQLite's
`VACUUM INTO`, so the server keeps running. It checks the copy's integrity and
copies the images the database refers to. Images are named by their SHA-256, so
they go into one shared pool and each is stored once across all snapshots.

```
nameflare-backups/
  nameflare-20261120T033000Z/   nameflare.sqlite + manifest.json
  textures/                     every image any snapshot needs, stored once
```

```sh
npm run backup -- --data /home/ubuntu/nameflare-data --out /home/ubuntu/nameflare-backups --keep 14
npm run backup -- --list   --out /home/ubuntu/nameflare-backups
npm run backup -- --verify nameflare-20261120T033000Z --out /home/ubuntu/nameflare-backups
```

`--keep` removes the oldest snapshots past that number, and then any pool image
none of the remaining snapshots need. `--verify` re-hashes the database and every
image.

**Nightly on Oracle.** Install the timer once:

```sh
sudo install -m 644 docs/oracle/nameflare-backup.service docs/oracle/nameflare-backup.timer /etc/systemd/system/
sudo mkdir -p /home/ubuntu/nameflare-backups && sudo chown ubuntu:ubuntu /home/ubuntu/nameflare-backups && chmod 700 /home/ubuntu/nameflare-backups
sudo systemctl daemon-reload && sudo systemctl enable --now nameflare-backup.timer
systemctl list-timers nameflare-backup.timer
```

It runs at 03:30 UTC, keeps 14 snapshots and runs at idle I/O priority.

**Off the server.** A backup on the same disk does not survive losing the
instance. Copy the backup folder somewhere else, for example to OCI Object
Storage (the Always Free tier includes 20 GB) with `rclone sync`, or pull it
with `rsync` from another machine. The pool layout means each sync only
transfers new images.

### Restoring

```sh
sudo systemctl stop nameflare
node scripts/restore.js nameflare-20261120T033000Z --yes --data /home/ubuntu/nameflare-data --from /home/ubuntu/nameflare-backups
sudo systemctl start nameflare
```

The restore refuses to run while the server is up (it checks the `server.pid`
the server writes), and refuses a snapshot that fails verification unless you
pass `--force`. Nothing is deleted: the current database and images move to
`nameflare-data/pre-restore-<time>/`. Remove that folder once you are sure.

Sign-in sessions are in the database, so people signed in after the snapshot
will need to sign in again.

## Uploaded images

Every upload goes through four steps before it is stored:

1. **Checks on the bytes as sent:** type (PNG, GIF, WebP, JPEG or BMP; never
   SVG), at most 2 MB and 2048×2048, and a valid header.
2. **Decode and rebuild** (`lib/images.js`, in a worker thread):
   - **PNG:** every scanline is decoded to pixels and re-encoded.
   - **GIF:** every frame's LZW data is decoded and re-encoded. Timing, disposal,
     transparency and the loop count are kept.
   - **JPEG:** decoded to pixels (the vendored, pure-JavaScript jpeg-js),
     turned upright from its EXIF orientation, and re-encoded at quality 90.
   - **BMP:** decoded and stored as PNG.
   - **WebP:** the container is rebuilt from validated chunks. VP8/VP8L pixel data
     is copied after its headers are checked, not decoded.
   - **All formats:** metadata (EXIF and GPS, XMP, text, comments, ICC profiles),
     unknown chunks and anything after the end of the image are dropped.
   - **Limits:** the PNG "decompress to a huge size" trick is refused, and decoding
     is capped at 600 frames and 32 million pixels per file.
   - **Timeout:** a file that takes over 30 s is abandoned and the worker replaced.
   - **Result:** the stored file is the rebuilt one, named by its own SHA-256.
3. **Blocklist:** images moderators blocked, matched by the hash of the original
   upload and of the rebuilt file.
4. **Scanners, if configured** (below).

Uploads stay private until a moderator approves a Flare that uses them.

### Malware scanning with ClamAV

Set `CLAMD_SOCKET=/run/clamav/clamd.ctl` (or `CLAMD_HOST`/`CLAMD_PORT`). Each
original upload is streamed to clamd with `INSTREAM`. A match is refused, and
the activity log records the signature against the uploader.

clamd keeps its signature database in memory, about 1–1.5 GB. **That does not
fit beside Nameflare on an E2.1.Micro (1 GB).** Run clamd on a bigger machine
reachable over a private network and point `CLAMD_HOST` at it, or run Nameflare
on a larger shape. Never expose clamd's port to the internet.

### Content classification

`CONTENT_SCAN_URL` (HTTPS, or HTTP on this machine) receives each rebuilt image
as the request body, with `Authorization: Bearer $CONTENT_SCAN_TOKEN` when set. It
answers `{"verdict":"allow"|"review"|"block","reason":"…"}`.

- **review:** the upload is accepted and flagged on the moderators' review card.
- **block:** the upload is refused.

This is the hook for a nudity/violence classifier or a hash-matching service you
are licensed to use.

### When a scanner is down

`SCAN_FAIL_MODE=closed` (the default) refuses uploads with a 503 until it is
back. `SCAN_FAIL_MODE=review` accepts them and flags them for moderators instead.

## Reports and moderation

Signed-in people report a Flare or a profile, with a reason and optional
details. Each person has one open report per target, and at most 20 reports a
day. Moderators work through **Moderation → Reports**, grouped by target and
most-reported first. One decision closes every open report about that target:

- **Dismiss:** no action.
- **Remove Flare:** revokes the Flare and unequips it for everyone. Optionally
  **blocks its images** so the same files cannot be uploaded again by anyone.
- **Ban:** bans the account (or the Flare's creator), with the usual
  ban rules: moderators cannot ban moderators.

Every decision is in the activity log. Disapproved Flares can also be deleted
with their images blocked from the review queue.

## Moderating as a team

Several moderators can work at the same time without stepping on each other.

- **No silent overwrites.** Every decision carries the state the moderator was looking at. If someone else changed it first, the decision is refused with who did what and when ("Already approved by nova 2 minutes ago"). Two moderators clicking at the same moment: exactly one wins.
- **Presence.** Opening a submission or a report tells the others ("nova looking"). It is a hint, never a lock, and fades 45 seconds after the page closes.
- **Live queues.** Open moderation pages check for news every 5 seconds: others' decisions are marked in your queue (and the open card's buttons switch off), counts update, and new submissions show a "Show" button.
- **Reports.** A decision closes only the reports the moderator was shown. Reports that arrive meanwhile stay open.
- **Undo.** Your own approve or disapprove can be undone for 10 minutes, as long as nobody has changed it since; the creator's notification is taken back.
- **Bulk decisions.** Tick submissions (or press X) and approve or disapprove them together. Each is checked on its own; anything someone else decided first is skipped and listed.

Also on hand:

- **The review card** shows the creator's history (approved, disapproved, pending, open reports, recent disapproval notes) and shared staff notes.
- **Filters and order:** flagged by the scanner, reported, uses images, creator had a disapproval; oldest first by default.
- **Quick notes:** six built in, plus each moderator's own, saved in their browser.
- **Suspensions:** 1, 3, 7 or 30 days. They end by themselves, keep the account's Flares, and appear in the log as "Automatic". Permanent bans still revoke Flares.
- **Staff notes on any account:** Accounts → Manage → Staff notes. Authors (and the owner) can delete their notes; notes go with the account.
- **Activity log:** filter by moderator, search, and export.
- **Keyboard:** J/K move, N next free item, A approve, R disapprove, D note, X select, U undo, / search.

## Data retention

The server applies these a minute after it starts and every six hours
(`Store.retention()`, values in `RETENTION` in `lib/store.js`):

| Record | Kept for |
|---|---|
| Notifications | 180 days |
| Daily page-view counts (no personal data) | 400 days |
| Moderation activity log | 2 years |
| Details text of closed reports | 90 days after closing |
| Closed reports | 1 year after closing |
| Disapproved Flares and their unshared images | 1 year after the decision |
| Uploaded images no Flare uses | 7 days after upload |
| Image files with no database record | 1 day |
| Sign-in sessions | 7 days |
| Nightly backups | 14 snapshots |

Pending and approved Flares, accounts, likes and follows are kept until the
person deletes them or their account.

## Account deletion and export

- **Download my data:** under Account → Your data. Returns everything held about
  the account as JSON: `GET /api/account/export`.
- **Delete my account:** under Account → Your data (`POST /api/account/delete`).
  Removes:
  - the profile and linked platforms;
  - every Flare the person made, including ones others wear (those people are
    unequipped);
  - uploads, likes, follows and notifications.

  Reports the person filed stay, with the reporter removed. The activity log
  records `account.deleted` with the account ID only.
- **Staff deletion:** under Moderation → Accounts → Manage → **Delete account**.
  Moderators can delete members and artists, and the owner can delete anyone but
  itself. A reason is required and goes into the activity log. This is not a ban:
  the person can sign up again. Deleting a banned account keeps a one-way hash of
  each of its platform identities, so that ban still holds.
- **Bans and networks:** a ban also blocks sign-in, new accounts and changes from
  the networks (IP addresses, an IPv6 /64 as one) the account used in the last
  90 days, for 90 days. Browsing is not blocked. Networks are kept only as keyed
  hashes; the owner and moderators are exempt.
- **Backups:** a deleted account is still in older backups until they roll off
  (14 nights). Restoring an older backup brings it back; delete it again after
  any restore.

## Edge rate limits (nginx)

`docs/oracle/nameflare.nginx.conf` limits each client before requests reach
Node. A client is one IPv4 address, or one IPv6 /64: home and mobile connections
usually get a whole /64, so per-address IPv6 limits would be easy to dodge.

| Traffic | Limit per client |
|---|---|
| API and image reads | 10/s, bursts of 40 |
| Writes (anything but GET/HEAD/OPTIONS) | 40/min, bursts of 10 |
| Image uploads | 12/min, bursts of 4 |
| Sign-in (`/auth/`) | 20/min, bursts of 10 |
| Requests in flight | 64 |
| Pages, scripts, styles, fonts | No rate limit (only the in-flight cap) |

Overlay lookups (`POST /api/v1/resolve`) are exempt from the write limit; Node
gives them their own budget. Turned-away requests get `429` with
`Retry-After` and the same JSON shape as Node's own limits.

`npm run edgetest` runs these rules in a real nginx (Docker) in front of a real
server and checks each one, including IPv6 /64 grouping and compressed IPv6
spellings. Run it after changing the nginx file.

Behind Cloudflare or another CDN, `$remote_addr` would be the CDN. Use nginx's
`real_ip` module with the CDN's published address ranges first, then these
limits still apply per visitor. Cloudflare's own rate-limiting rules can add a
further layer at its edge. For Cloudflare, the next section has the steps.

## Micro-cache and feed pacing

These need no outside service and are on in the Oracle template.

- **Overlays trust the change feed.** The SDK keeps a chatter's result for 10
  minutes while the feed is healthy, instead of rechecking every chatter every
  minute. Every equip, unequip, revocation, ban or unlink arrives as a feed
  event and is refetched within one poll, and any feed failure or silence drops
  results back to the 12-second expiry at once. Identity lookups mostly come
  from new chatters now.
- **nginx micro-cache.** Node marks what nginx may store with
  `X-Accel-Expires`: the change feed for 2 seconds and approved textures for 5.
  Simultaneous identical feed polls reach Node once (`proxy_cache_lock`), and
  nginx sends repeat image bytes itself. Nothing else is stored. Responses carry
  `X-Cache-Status` (`HIT`, `MISS`, `EXPIRED`, `REVALIDATED`) for checking.
  The cache lives in `/var/cache/nginx/nameflare` (up to 1 GB, usually far less).
- **Feed pacing** (`lib/pace.js`). Every feed answer says how long to wait
  (`poll_ms`). The server estimates how many overlays are polling and, past
  `FEED_POLL_TARGET_RPS` polls a second (default 100, which is 400 overlays at
  4 s), asks them to slow down, up to `FEED_POLL_MAX_MS` (default 15 s). Changes
  then take up to that long to reach overlays. The estimate rises at once and
  eases back over about a minute.

  Because the micro-cache answers most polls, Node alone undercounts. Set
  `NGINX_STATUS_URL=http://127.0.0.1:8081/nginx_status`: the template serves
  nginx's `stub_status` there, on loopback only, and pacing counts its active
  connections (one per overlay). If it can't be read, pacing logs once and uses
  Node's own count.

After updating the nginx file: `sudo nginx -t && sudo systemctl reload nginx`,
then check `curl -sI "https://nameflare.bxne.dev/api/v1/changes?since=&epoch=" | grep -i x-cache-status`
twice in a row (`MISS`, then `HIT`). `npm run edgetest` checks the cache rules
in a real nginx alongside the rate limits.

## Cloudflare edge cache

One E2.1.Micro can't answer thousands of overlays alone. Every overlay polls
the change feed every 4 seconds and downloads each image Flare it meets, so
10,000 overlays would mean about 2,500 feed polls a second and hundreds of
gigabytes of images. Cloudflare in front answers most of that from its cache.

What Nameflare does once `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_PURGE_TOKEN` are
set (`lib/edge.js`):

- **Approved textures** get `Cloudflare-CDN-Cache-Control: public, max-age=86400`
  (`EDGE_TEXTURE_TTL`). Texture IDs are SHA-256 hashes of the file, so the bytes
  behind a URL never change. Browsers keep the 15-second window and revalidate
  against the nearest Cloudflare location, which answers 304 itself.
- **Revocation purges.** When a Flare is disapproved (including by a ban) or
  deleted, every image of it that no other approved Flare uses is purged from
  Cloudflare by URL, retried up to three times, and purged once more 30
  seconds later. A purge that still fails is logged with the URLs to purge by
  hand; the edge lifetime bounds how long such an image can stay up.
- **The change feed** gets `Cloudflare-CDN-Cache-Control: public, max-age=2`
  (`EDGE_FEED_TTL`). Every up-to-date overlay asks for the same cursor, so one
  answer per location serves them all. Changes reach overlays at most 2 seconds
  later than before.
- Pending textures, identity lookups (`POST /api/v1/resolve`), sessions and
  errors keep `no-store` and are never cached.

`Cloudflare-CDN-Cache-Control` is read only by Cloudflare. Without the two
settings Nameflare sends no edge headers at all, so a CDN put in front without
purge access can't hold a revoked image past 15 seconds.

### Setting it up

1. **Token.** In Cloudflare, create an API token with only *Zone → Cache Purge
   → Purge* on the `bxne.dev` zone. Put it and the zone ID (zone overview page)
   in `.env`.
2. **Real client addresses.** Write the nginx snippet from Cloudflare's
   published ranges, then uncomment its `include` in
   `/etc/nginx/sites-available/nameflare`:

   ```sh
   { for v in 4 6; do curl -fsS https://www.cloudflare.com/ips-v$v | sed 's/.*/set_real_ip_from &;/'; done
     echo 'real_ip_header CF-Connecting-IP;'; } | sudo tee /etc/nginx/snippets/nameflare-cloudflare-ips.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Do this **before** switching the proxy on, or the rate limits will treat
   every visitor as one of a few Cloudflare addresses. Cloudflare changes its
   ranges rarely; rerun the command when it announces a change.
3. **Cache rule for the feed.** Cloudflare caches images by extension already,
   but not API paths. Add a Cache Rule: *URI Path equals `/api/v1/changes`* →
   *Eligible for cache*, edge TTL *Use cache-control header if present*, cache
   key including the query string (the default).
4. **SSL/TLS mode:** Full (strict). The origin keeps its Let's Encrypt
   certificate. Leave *Always Use HTTPS* off: nginx already redirects port 80,
   and that redirect skips `/.well-known/acme-challenge/`, which certificate
   renewal needs.
5. **Proxy on.** Turn the `nameflare` DNS record to Proxied (orange cloud),
   then restart Nameflare so it reads the new `.env`.
6. **Check:**

   ```sh
   curl -sI https://nameflare.bxne.dev/textures/<an approved texture id> | grep -i cf-cache-status   # HIT on a repeat
   curl -sI "https://nameflare.bxne.dev/api/v1/changes?since=&epoch=" | grep -i cf-cache-status
   ```

   Then disapprove a test Flare with an image and confirm its texture URL
   returns 401 through Cloudflare within a few seconds.

Optional: once everything works, allow ports 80 and 443 on the instance only
from Cloudflare's ranges, so nobody can go around the cache to the origin.

## Load testing

```sh
npm run loadtest -- --spawn --docker --cpus 0.125 --memory 384m --duration 60
```

`--spawn` seeds a throwaway server (5,000 accounts and 400 Flares by default) and
simulates:

- **Visitors:** first page loads and browsing.
- **Chat overlays:** batch identity lookups of 20–80 chatters, plus the change
  feed.
- **Signed-in people:** liking and following.
- **Creators:** uploading images, which go through the full decode and rebuild.

`--docker --cpus 0.125 --memory 384m` runs the server with the CPU and memory
limits of an E2.1.Micro's baseline. It fails (exit 1) on any server error, or a
p95 above 400 ms for pages, API reads or overlay lookups.

Results on 2026-11-19, at a 1/8-CPU quota with 384 MB:

| Load (simultaneous) | Requests/s | Page p95 | API read p95 | Overlay lookup p95 | Errors | Peak memory |
|---|---|---|---|---|---|---|
| 150 visitors, 40 overlays, 20 writers, 2 uploaders | 146 | 175 ms | 128 ms | 180 ms | 0 | 59 MB |
| Twice that (20,000 accounts, 1,000 Flares) | 260 | 3.6 s | 0.4 s | 3.1 s | 0 | — |

The first row is within budget; the second is past the quota's capacity. Nothing
fails, but latency climbs.

At full CPU the same server was idle 94% of the time at 349 requests/s. The tail
latency at 1/8 CPU comes from how a hard CPU quota pauses the process in 100 ms
slices. A real E2.1.Micro can burst above its baseline, so treat these figures as
the floor.

Run `--base https://your.host` (reads only) against a live server only with the
operator's agreement, and expect the edge limits to answer most of it.
