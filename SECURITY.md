# Security & moderation

## Current controls

- OAuth state is random, browser-cookie-bound, provider-specific, time-limited, and single-use upon successful validation. Kick and YouTube use PKCE. Linking refuses an identity already owned by another account and refuses replacing a different identity for the same provider.
- Provider tokens are used only for identity lookup and are never persisted. YouTube requires read-only channel access; channel ID, not email, is the linked identity.
- Session bearer tokens are stored hashed. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Mutations require an exact trusted Origin and session-bound CSRF token. Logout and new authentication rotate/revoke the current session.
- Owner identity is configured, never assigned to first signup. Role enforcement is server-side. Mods cannot appoint other mods, ban other moderators/the owner/themselves, or manually review their own designs. Moderator and owner submissions are automatically approved and audited. The owner can review their own designs, reapprove rejected designs, and change any Flare’s listing. Reviews, bans, and role changes have an audit trail.
- Oracle/Node Artist roles can be granted/removed only by the current owner, with same-origin session/CSRF checks and audit events. Artists may submit 20 Flares (regular users: 3), counting every status/listing; submissions still require review. Artists have no moderation or automatic-approval privilege. Mods may ban/unban artists like regular users. Artist controls cannot alter owner/moderator roles or grant the role to banned accounts. Removal immediately lowers the budget without deleting existing work. Only `is_artist`, not raw roles or private notes, is added to public profiles. No schema migration is needed; the optional Cloudflare runtime does not support artist roles.
- Bans immediately revoke sessions and block sign-in, omit public profiles/identities, and reject all the account’s pending/approved Flares, clearing every affected equip. Only the owner can ban/unban moderators; the owner is protected. Unbanning does not restore sessions or approval.
- Public endpoints and assets publish approved material only. Revocation clears equipped instances. Readers must expire their cache; previously downloaded files cannot be revoked retroactively.
- On Oracle/Node, mods and the owner can permanently delete only disapproved Flares, with exact Origin, session/CSRF, and explicit confirmation. Deletes the Flare record and unreferenced texture files/ownership rows, clears stale equips, and retains a minimal `flare.deleted` audit event. Image references in all remaining Flares (pending/approved/disapproved, listed/unlisted) protect shared assets. This is logical deletion, not secure disk erasure or backup/client-cache purging.
- Preview-only Google Fonts families come from a validated local catalog. Selecting one loads only `fonts.googleapis.com` stylesheet and `fonts.gstatic.com` font resources; CSP allows those specific style/font origins without broadening script access. Font requests do not include application session tokens, names, or recipes in their URLs; stylesheet referrers are suppressed. Google receives the visitor’s font-resource requests/IP. Local fonts make no Google requests. Font choices are not recipe fields or account settings; loading failures visibly fall back to system font.
- Names, descriptions, review notes, and chat messages are rendered as plain text. Cosmetic properties are constrained and bounded; raw CSS/HTML/SVG/shaders and arbitrary external URLs are not accepted.
- Node rate limiting ignores forwarded headers by default. Opt-in `TRUST_PROXY_LOOPBACK=true` trusts only a single valid `X-Real-IP` from exact loopback peers, canonicalizes IPv6/mapped IPv4, and falls back to the socket address for malformed/missing headers. The Oracle Nginx template overwrites client-IP headers and strips `Forwarded` in every upstream location. Node must remain bound to loopback; same-host processes are trusted. CDN/proxy chains require separate reviewed real-IP handling. Limits are per IP, so shared-NAT users share quotas.
- Requests, upload bytes/canvas dimensions, pending submissions, and texture count have baseline limits. Authenticated owners bypass application throttling, account quotas, collection caps; they still require valid sessions/CSRF, artwork ownership, and safe recipe/image validation. External proxy/hosting limits remain. Browser reduced-motion uses a static gradient instead of animated image textures.

- Resource limits (2026.11):
  - JSON bodies are capped at 64 KB. Only texture uploads may send up to 2.9 MB, with at most four uploads in flight.
  - Rate-limit buckets count an IPv6 /64 as one client. The bucket map is capped at 100,000 entries, and floods from new addresses share an overflow bucket instead of growing memory.
  - Distinct page-view paths are capped at 5,000 per day.
  - `/source` and `/license` are built once.
  - Responses send `Cross-Origin-Opener-Policy: same-origin`.
  - Shared public API answers and texture approval checks are cached for at most 10 s, and every moderation, role, publishing or profile write invalidates them immediately. Equips and likes may take up to 10 s to show in public answers, within the documented 15 s client revalidation window.

- Uploads and safety (2026.11; details in [Operations](docs/OPERATIONS.md)):
  - **Rebuilt images:** every image is decoded and rebuilt in a worker thread before storage. PNG pixels and GIF frames are fully decoded and re-encoded; the WebP container is rebuilt from validated chunks.
  - **Stripped extras:** metadata, unknown chunks and trailing bytes are dropped.
  - **Decoding limits:** decompression bombs are refused; decoding is capped at 600 frames and 32 million pixels, with a 30 s timeout.
  - **Scanning:** the original file can be scanned by ClamAV (clamd `INSTREAM`), and the rebuilt image by a content classifier. With a scanner configured, a scanner outage refuses uploads by default.
  - **Blocked images:** moderators can block an image's hashes so neither the original upload nor its rebuilt form can be uploaded again.
  - **Abuse reports:** reports are limited to one open report per person per target and 20 a day. Moderators resolve each target once (dismiss, remove, or ban), and every decision is audited.
  - **Account deletion:** it is self-service and immediate. The owner can erase other accounts on request; erasing a banned account keeps hashed identities so the ban persists. Data export is self-service.
  - **Retention:** the server enforces the published retention periods ([Privacy](docs/PRIVACY.md)) and removes abandoned uploads and stray image files.
  - **Bans cover networks:** a ban also blocks sign-in, new accounts and changes (not browsing) from the networks the account used in the last 90 days, for 90 days. Networks are stored only as HMAC hashes with a per-database key (an IPv6 /64 counts as one); loopback is never recorded, and the owner and moderators are exempt. Lifting the ban unblocks them. Shared networks (a school, a mobile carrier's NAT) can block innocent people for the 90 days; lift and re-apply a ban to adjust.
  - **Staff deletion:** moderators can delete member and artist accounts (the owner any but its own) with a reason, without banning; the person can sign up again.
  - **Edge limits:** nginx applies per-client limits (IPv4 address or IPv6 /64) per traffic class, verified by `npm run edgetest`.

## Known limitations

This project is not independently audited. Gaps that remain:

- **WebP pixel data:** it is not decoded, only structurally checked, so a crafted WebP bitstream relies on the browser's decoder (keep browsers updated) and on ClamAV signatures when configured.
- **Photosensitive content:** nothing is detected automatically; moderators check flashing.
- **Blocklist:** hashes match exact files only, not near-duplicates.
- **Single host:** synchronous SQLite and an in-process limiter are a single-host design; see [Load testing](docs/OPERATIONS.md#load-testing) for measured limits.
- **Disk use:** each account may store 50 images of up to 2 MB, so disk use is bounded per account but not globally.
- **Not implemented:** moderation appeals and live provider chat connectors.
- **Public identities:** the public API intentionally discloses linked platform names/IDs and equipped designs; make that visibility clear to users.

Account sessions last seven days. If provider-level disconnection/reauthorization enforcement is required, implement shorter sessions or explicit revocation; the app does not keep long-lived provider tokens. Changing owner configuration alone does not revoke historical owner roles.

## Review checklist

Approve only original or licensed artwork. Check hateful/sexual/illegal material, impersonation, harmful symbols, unreadable designs, and rapid flashes. Keep outlines, shadows, and depth readable in chat at normal size. Explain rejections; remove approval for later policy violations. Staff automatic approval is a trust privilege, not an exemption from artwork/content policy. Do not use a second controlled moderator account to evade manual-review restrictions. Creator artwork rights are separate from the software license.

## Reporting issues

Before public launch, the operator must publish a private security contact in the live service and repository. Do not put credentials, exploit details for a live service, personal data, or private pending artwork in public issues. Rotate compromised OAuth secrets, overlay keys, and sessions through an audited incident procedure. Keep demo mode off internet-facing deployments.
