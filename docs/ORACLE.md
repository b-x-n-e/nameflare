# Nameflare on Oracle Ubuntu

## Verified staging target

The inspected target is an Oracle E2.1.Micro instance (`<server-ip>` below), Ubuntu 22.04.5 LTS, x86-64, approximately 1 GB RAM, and 44 GB free disk. SSH is available as `ubuntu`. An enabled Internet Gateway and subnet default route restored SSH access. The earlier console helper's ARM output was not the instance architecture; `uname -m` on the instance reports `x86_64`.

The setup uses native Node rather than Docker to minimize memory and storage overhead. Node 24 is downloaded from nodejs.org and checked against that release's published SHA-256 digest. No third-party production dependencies are required.

Staging paths:

- `/home/ubuntu/nameflare-runtime`: Node 24 runtime.
- `/home/ubuntu/nameflare`: allowlisted application source only.
- `/home/ubuntu/nameflare-private/.env`: private configuration, mode 600; do not upload it with source.
- `/home/ubuntu/nameflare-data`: persistent SQLite database and textures; mode 700.

SSH keys, `.env`, OAuth credentials, `node_modules`, `.wrangler`, and demo data must not be copied with application source. The deployment files below are templates, not proof of an active public service.

## Production gates

1. Configure a DNS A record for `nameflare.bxne.dev` pointing at the instance's public IP (`<server-ip>`). Verify ownership and check existing records before editing. Start DNS-only; if enabling the Cloudflare proxy later, use Full (strict), avoid caching private/API endpoints, and deliberately configure trusted real-IP handling. Never blindly trust client-provided forwarding headers.
2. Permit inbound TCP 80 and 443 in the Oracle subnet security lists / VNIC security groups and the Ubuntu host firewall. Keep SSH limited to trusted source IPs; keep port 3000 private. Inspect existing firewall rules before making changes; do not flush them or remove Oracle rules.
3. Set a real numeric `OWNER_TWITCH_ID`; no dummy/demo identity. Configure at least Twitch OAuth for sign-in. Register `https://nameflare.bxne.dev/auth/twitch/callback` exactly.
4. Configure HTTPS and a persistent system service only after the application source has passed tests on this host.
5. A public repository is recommended. The Node runtime also provides an allowlisted source-file bundle at `/source` and the license at `/license` when `SOURCE_URL` is unset. Verify both before launch; never point the source URL at an unrelated repository. Operators remain responsible for AGPL corresponding-source obligations.

## Administrator setup (not automatically executed)

Run administrator commands yourself in an SSH terminal, or approve an appropriate elevation workflow. These commands install packages and affect the host; review first. They do not enable the application yet.

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot
sudo install -d -m 0755 /var/www/nameflare-acme
```

Before certificate issuance, enable [the HTTP-only bootstrap site](oracle/nameflare-http.nginx.conf). It serves ACME challenges and returns an uncached maintenance response elsewhere; it never exposes the unconfigured app. The following commands deliberately refuse to overwrite an existing Nameflare site. Preserve the Ubuntu default and any other sites.

```bash
test ! -e /etc/nginx/sites-available/nameflare && \
  test ! -L /etc/nginx/sites-available/nameflare && \
  test ! -e /etc/nginx/sites-enabled/nameflare && \
  test ! -L /etc/nginx/sites-enabled/nameflare && \
  sudo install -m 0644 /home/ubuntu/nameflare/docs/oracle/nameflare-http.nginx.conf \
    /etc/nginx/sites-available/nameflare && \
  sudo ln -s /etc/nginx/sites-available/nameflare /etc/nginx/sites-enabled/nameflare && \
  sudo nginx -t && sudo systemctl reload nginx
```

Do not enable the TLS block before the certificate exists: `nginx -t` would fail. Verify external port-80 access and DNS before requesting a certificate. Use the administrator's real email when issuing a certificate:

```bash
sudo certbot certonly --webroot -w /var/www/nameflare-acme \
  -d nameflare.bxne.dev --agree-tos --non-interactive \
  --email YOUR_REAL_EMAIL
```

Once certificates exist, install [the complete Nginx template](oracle/nameflare.nginx.conf) as a separate site, validate with `sudo nginx -t`, then reload Nginx. Preserve any existing sites. The template caps bodies at 3 MB, limits requests by client IP and disables API proxy caching. Cloudflare-proxied traffic requires additional reviewed trusted-IP configuration; the template assumes direct clients. The template overwrites `X-Real-IP` and `X-Forwarded-For` with Nginx’s `$remote_addr` in both proxy locations and removes `Forwarded`. With `TRUST_PROXY_LOOPBACK=true` in the Oracle service, Node uses that single validated IP only when the socket peer is exactly `127.0.0.1` or `::1` (including mapped IPv4). It ignores forwarded headers by default and from non-loopback peers. Keep Node bound to loopback; local processes are inside this trust boundary. Node’s 300 reads/40 writes per minute now apply per client IP rather than to all Nginx users together. Never enable this setting before the overwriting proxy config is active.

Privately edit the `.env` file with the numeric owner ID and OAuth credentials, then install the service:

```bash
sudo install -m 0644 /home/ubuntu/nameflare/docs/oracle/nameflare.service \
  /etc/systemd/system/nameflare.service
sudo systemctl daemon-reload
sudo systemctl enable --now nameflare.service
sudo systemctl status nameflare.service --no-pager
```

The service enforces production mode, binds `127.0.0.1:3000`, and uses a 256 MB memory ceiling. It runs as the non-root Ubuntu user, has a private temporary directory, and limits writable paths to persistent application data. Startup intentionally fails without HTTPS configuration and a numeric owner ID. Do not bypass this validation or start public demo mode. A deployment operator controlling this Unix user also controls the application; use a dedicated service account as a future hardening step.

## Public accounts and provider setup

Anyone can use **Sign in / Create account**. The first successful provider sign-in creates a regular Nameflare account; later sign-ins reuse that verified identity. There is no invite list or separate password. Only the configured owner Twitch ID receives owner access. Link other providers from **My account while signed in** to avoid separate accounts; automatic merging and unlinking are not implemented.

The provider profile supplies the display name and avatar. Existing accounts get these fields on their next provider sign-in. Users can choose a linked profile source; changing it does not rename their platform accounts. Unsupported image hosts or missing images use initials. Nameflare stores verified profile metadata, not provider tokens. Loading provider avatars contacts their image CDN with no referrer; include this in your privacy notice.

### Kick

1. Sign in at [Kick Developers](https://dev.kick.com/), open account settings → **Developer**, and create an application. Follow any developer-access requirements shown by Kick.
2. Set the exact redirect URI to `https://nameflare.bxne.dev/auth/kick/callback`.
3. If scope configuration is offered, allow `user:read`. Nameflare uses PKCE and does not need chat-write permissions for sign-in.
4. Copy the application **Client ID** and **Client Secret** into the private configuration as `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`. Never copy credentials into public source, chat, screenshots, or shell command arguments.
5. Test both a new account and linking Kick to an existing account, including cancellation. Kick sign-in alone does not implement a live-chat connector.

### YouTube / Google

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project. Under APIs & Services → Library, enable **YouTube Data API v3**.
2. Open **Google Auth Platform → Branding** (or OAuth consent screen). Enter Nameflare's app name, real support/developer email, and the requested site/privacy information. Add `bxne.dev` as an authorized domain when required; complete domain ownership verification if requested.
3. Under **Audience**, select **External** for public users. While the app is in Testing, add the Google accounts of your testers under **Test users**. Testing is not unrestricted public access.
4. Under **Data Access**, add `https://www.googleapis.com/auth/youtube.readonly`. This reads the authenticated YouTube channel identity; no upload or posting scope is requested.
5. Under **Clients**, create an OAuth client of type **Web application**. Add `https://nameflare.bxne.dev/auth/youtube/callback` under **Authorized redirect URIs**. A JavaScript origin, API key, or service account is not a substitute for this redirect or OAuth client. Nameflare's server-side flow does not require an authorized JavaScript origin.
6. Copy the **Client ID** and **Client Secret** securely at creation into `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Google may only display the secret at creation; store it privately.
7. Test with an allowed Google account that owns a YouTube channel. The stored identity is the channel ID, not the email/Google account ID. If no channel is returned, create/select a channel and restart the flow.
8. Before broad public YouTube sign-up, publish the consent application and complete any Google-required verification for the sensitive scope. Prepare actual privacy/terms pages and domain verification; do not use placeholders or promise verification is automatic. Review quota and user-data policy requirements.

### Apply credentials privately

In the server SSH terminal:

```bash
TERM=xterm-256color nano /home/ubuntu/nameflare-private/.env
```

Update the existing entries (no duplicates):

```dotenv
KICK_CLIENT_ID=YOUR_KICK_CLIENT_ID
KICK_CLIENT_SECRET=YOUR_KICK_CLIENT_SECRET
YOUTUBE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
YOUTUBE_CLIENT_SECRET=YOUR_GOOGLE_WEB_CLIENT_SECRET
```

Replace placeholders with actual credentials. Keep the canonical `PUBLIC_BASE_URL=https://nameflare.bxne.dev`. Save, then deliberately restart the service:

```bash
sudo systemctl restart nameflare
systemctl is-active nameflare
curl --fail https://nameflare.bxne.dev/api/config
```

`providers.kick` and `providers.youtube` become `true` when credentials are present, but this is not proof they are valid. Complete actual sign-in/linking tests. If callbacks change, update provider registration to match the exact origin/path.

### Admin and reviewer workflow

- Sign in with the configured owner Twitch account, then open **Moderation**. **Accounts & moderation team**, available to moderators and the owner, lists registered users, linked IDs, join dates and current roles. Search by name/login or exact platform ID. Only the owner sees **Make moderator** and **Remove moderator** controls. Adding by numeric Twitch ID also remains available; the user must first sign in/link Twitch.
- Owner-only **Make artist / Remove artist** controls in **Moderation → Accounts** assign the blue Artist role to an existing regular account from any platform. Artists have a 20-Flare submission budget, ordinary review requirements, and no moderation access. Removal restores the 3-Flare budget without deleting existing designs. Public `/artists` showcases active artists with up to three approved, publicly listed designs; granting the role is enough to include an artist, even before their first public Flare. Banned accounts and removed artist roles disappear after public cache revalidation (up to 15 seconds).
- Moderators see the Flare dashboard, audit history, and account table with ban/unban controls for regular users. Access is checked on every request; removal affects existing sessions immediately. Owner access cannot be removed from the table.
- Use **Pending**, **Approved**, or **Disapproved** plus creator/Flare search. Each Flare shows animated/chat-size preview, pause/light backdrop, description, full recipe, creator identities, creation/review timestamps, reviewer and feedback. Lists are paginated in batches of 50.
- Approval publishes the Flare. Disapproval requires feedback. Revocation removes approved Flares from the public API and clears equipped assignments; public clients revalidate within 15 seconds. Moderator and owner submissions are automatically approved. Moderators cannot manually review their own Flares; the owner can review any non-banned creator’s Flare, including their own. Moderators can ban/unban regular accounts; only the owner can ban/unban moderators. Bans end sessions and revoke the account’s Flares.
- In **Disapproved**, moderators and the owner can choose **Permanently delete Flare** and confirm. This removes the Flare from SQLite, API reads, collections, and the review queue, plus image files no other Flare uses. Approved/pending Flares must be disapproved first. A minimal audit event and existing backups remain; there is no in-app undo. No database migration is needed for deletion.
- Creators see status, reviewer/time, and feedback under **My collection** and may edit a copy to submit again. Approval is never inherited.

### Updating this version

These workspace edits do not automatically update the server. Review the source changes and back up production data with SQLite online backup or a controlled service stop before upload/restart. Copy only changed application/source files, preserving private environment, database, textures, and other local edits. The official Oracle deployment runs Node/SQLite, not Cloudflare. Node adds avatar/profile, Flare publication, and account-ban columns on startup without replacing data; no manual SQL or Cloudflare migrations are required. Keep secrets and the data directory unchanged when updating application source.

Official references: [Kick Developers](https://dev.kick.com/), [Kick API docs](https://docs.kick.com/), [Google consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [YouTube web-server OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps).

## Capacity on an E2.1.Micro (2026.11)

For the current mixed-traffic load test (browsing, chat overlays, writes and image uploads together) and the tool to rerun it, see [Operations → Load testing](OPERATIONS.md#load-testing). The measurements below are the earlier read-path tests.

Load-tested with a synthetic production-scale database: 50,000 accounts, 3,000 Flares, 300,000 likes, 14,000 equipped Flares. The app ran in a container capped at 1/8 of a CPU (the shape's sustained baseline) and at the systemd unit's memory limits. A "visit" replays a real first page load: 129 requests, including every module, font and API call.

| Scenario at 1/8 CPU | Throughput | p95 latency |
|---|---|---|
| First visits (nothing cached) | ~40 visits/s | 87 ms |
| Returning visits (ETag revalidation) | ~45 visits/s | 89 ms |
| Discover API calls only | ~490 bundles/s (~3,400 req/s) | 92 ms |
| Cache-busting attack (a random sorted page each time) | ~37 req/s | ~3.4 s |

At 1 CPU (burst), first visits reached ~265/s with p95 6 ms. Resident memory stayed under 170 MB.

What makes this work, and must be kept:

- **Indexes and two-step catalog queries.** Before them, one "Most equipped" page took 4.6 s even at full CPU.
- **A 10 s shared cache for public API answers.** Moderation and publishing writes invalidate it at once.
- **A ranking table for sorts by likes and wearers**, rebuilt at most every 30 s.
- **Nginx limits only `/api/`, `/auth/` and `/textures/`.** The earlier template limited static files too: a single new visitor had 84 of 115 first-load requests rejected with 429.
- **HTTP/2, TLS session resumption and upstream keep-alive** in Nginx.

Operational notes:

- **Add swap.** The shape has 1 GB and no swap, so a spike can trigger the OOM killer:
  `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, then add it to `/etc/fstab`.
- **Burst credit.** The 1/8 baseline is what sustained load gets once burst credit is spent; the table above assumes that worst case.
- **The limit is distributed abuse, not normal traffic.** One client (an IPv4 address or IPv6 /64) is held to 10 API reads/s at the edge. Eight or more addresses doing that at once will slow the API. Put a CDN or WAF in front before an expected spike.
- **Updating Nginx.** Install the new [`nameflare.nginx.conf`](oracle/nameflare.nginx.conf) and [`nameflare.service`](oracle/nameflare.service), then run `sudo nginx -t`, `sudo systemctl daemon-reload` and restart both. The first start after this update builds the new indexes once; expect a few seconds at 1/8 CPU on a large database.

## Acceptance and operations

- Check localhost `/healthz`, public HTTPS `/healthz`, `/api/config`, `/source`, and `/license`.
- Verify the service survives SSH disconnect and a planned reboot.
- Complete live-provider login, cancellation, account linking, owner bootstrap, moderation, private-image access, approval/revocation, and equip/resolve checks.
- Keep database/textures outside the code directory. Install the nightly backup timer and test a restore (see [Operations](OPERATIONS.md#backups)) before public signup.
- Copy backups off the server; the templates back up to the same disk only.
- Monitor memory, disk, CPU, API abuse, and service errors. The host's apparent free capacity is not a load-test result.
- Do not perform an unconditional full system upgrade or force reboot as part of deployment. Oracle free-tier billing/quotas and reclamation rules must be reviewed separately.
