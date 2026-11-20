# Hosting the official Nameflare service

Open-source code and centralized service ownership are compatible. Publish the repository with its license; run the official service at an origin you control. Domain availability/ownership is not verified here. The workspace is not deployed, and hosting bills, DNS changes, OAuth registration, or publication require the owner's explicit action.

## Cloudflare-native alternative

The requested Workers/D1/private-R2 runtime is implemented separately from Node. Use [the Cloudflare runbook](CLOUDFLARE.md) for local migration, provider registration, resource bindings, secret storage, deployment prerequisites, and limits. It has been bundled and locally tested, not remotely deployed.

## Oracle Ubuntu setup

For the verified low-memory Oracle staging layout and administrator/HTTPS prerequisites, see [the Oracle runbook](ORACLE.md). Native Node avoids Docker overhead on the 1 GB host; public launch still requires production configuration and acceptance checks.

## Node topology

One Node 24 container + persistent local volume + HTTPS reverse proxy on one host. The app serves its UI, versioned API, and textures from the same origin. SQLite runs in WAL mode with foreign keys and a busy timeout. Do not run multiple app replicas against a shared network SQLite file. Use PostgreSQL, object storage, a distributed limiter, and pub/sub before horizontal scaling; SSE rooms are in-process today.

1. Publish corresponding source in a public repository, retaining the AGPL license.
2. Create a domain and HTTPS host (for example, a VPS or a container host with a persistent disk). Choose your canonical app/API origin; this MVP uses one origin, such as `https://nameflare.your-domain.example`, with `/api/v1` underneath.
3. Privately configure `.env` or host secrets using `.env.example`: HTTPS `PUBLIC_BASE_URL`, `OWNER_TWITCH_ID`, provider credentials, and `SOURCE_URL` pointing to the actual published repository. Never put client secrets or live data in Git.
4. Register exact provider callbacks and complete required Google verification. Test each login/linking flow against live providers. Account linking was tested only with mocked provider responses in this workspace.
5. Build and start the production image using the supplied Dockerfile or Compose. The Compose volume stores database and texture files. It exposes only `127.0.0.1:3000` to the host; put HTTPS ingress in front of that. If the proxy is in another container, use a private shared network rather than assuming its localhost is the host's localhost.
6. Sign in as the configured owner Twitch identity. Grant reviewers by numeric Twitch ID after they sign in.
7. Configure monitoring, per-client edge rate limiting, upload scanning, storage quotas, privacy procedures, and regular tested backups before opening public signup.

Production startup fails without an HTTPS origin and numeric owner ID. Demo mode is rejected in production and binds loopback in development. Production does not seed users or sample cosmetics. An unconfigured provider is visibly disabled, not faked.

## Reverse proxy checklist

- TLS termination, upstream `http://127.0.0.1:3000`, no public direct access to port 3000.
- Do not rewrite the Origin header. App mutations require exact `PUBLIC_BASE_URL` origin plus session-bound CSRF.
- Cap request bodies at 3 MB; rate-limit uploads, login starts, and public resolves by true client IP at the trusted edge.
- The Node limiter defaults to socket addresses and ignores forwarded headers. For the same-host Oracle Nginx layout only, enable `TRUST_PROXY_LOOPBACK=true` after configuring Nginx to overwrite `X-Real-IP`/`X-Forwarded-For` with `$remote_addr` and strip `Forwarded` in every upstream location. Node accepts only a single valid IP from an exact loopback socket peer, canonicalizes equivalent IPv6/mapped-IPv4 forms, and falls back to the peer for missing/invalid headers. Keep Node private on loopback. Same-host processes are trusted; do not use this setting for arbitrary container networks or public proxies. Per-IP quotas still group users behind a shared NAT. Trusted CDN real-IP handling requires a separate reviewed configuration.
- Apply sensible connection limits.
- Avoid logging authorization headers, OAuth codes, cookies, or overlay room query strings.
- Public recipes and textures have a 15-second freshness window. Do not add longer CDN caching that delays revocation. Do not cache session endpoints, pending textures, or error responses.
- Serve `/source` and `/license` from this app so users can access license and source information; set `SOURCE_URL` for a live repository link.

## Backups & operations

Persist the entire data directory. `npm run backup` takes consistent online snapshots of the database and images, `npm run restore` puts one back, and the Oracle templates include a nightly systemd timer. Retention (old records, abandoned uploads) runs inside the server. See [Operations](OPERATIONS.md) for all of these, plus copying backups off the server, which the templates do not do for you.

Changing `OWNER_TWITCH_ID` does not revoke a previously persisted owner role; ownership transfer needs an explicit audited operational procedure. OAuth identity unlink/merge and moderation appeals are not implemented.

## Remaining launch work

Done in 2026.11 (see [Operations](OPERATIONS.md)): upload decoding and rebuilding, optional malware and content scanning, abuse reports, account deletion and export, retention, per-client edge limits, backups with restore, and a load-test tool. Still open:

- A ClamAV host if malware scanning is wanted (clamd does not fit in an E2.1.Micro's memory), and a content classifier you are licensed to use.
- Off-server backup copies, monitoring and alerting.
- Moderation appeals, published terms and an upload/copyright policy with a contact address.
- Live Twitch connection testing at scale, authorized Kick/YouTube chat connectors, and a native Chatterino adapter.

No commands in this guide have provisioned a server or made the API internet-accessible.
