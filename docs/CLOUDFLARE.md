# Cloudflare-native Nameflare

> The Cloudflare runtime is an optional alternative and is not used by the official service. It does not have the 2026.11 safety work: upload decoding and scanning, abuse reports, account deletion and export, retention, artist roles, or the backup tools. Use the Node/SQLite deployment for a public launch.

The second runtime is Workers + D1 + private R2 + Workers static assets. No Node server, filesystem, or `node:sqlite` is bundled into the Worker. The original Node backend remains usable locally. Neither this code nor a dry-run deploy has provisioned resources, changed DNS, or enabled a live OAuth app.

## Local development

Wrangler is a local development dependency. Install using `npm ci`, then:

```bash
npm run cf:migrate:local
npm run cf:dev
```

Open `http://127.0.0.1:8787`. The `local` environment uses local D1/R2 resources and placeholder owner ID `1001`, not demo seed data. It has no real provider credentials. The existing sample-account demo remains `npm run demo`.

If testing OAuth locally, use `.dev.vars.local` (ignored by Git) for provider client IDs/secrets and register the exact callback origin accepted by the provider. Do not reuse production resources or secrets for local testing. The `LOCAL_DEV` bypass is allowed only on a loopback canonical URL.

`npm run cf:check` bundles the Worker and assets without uploading. `npm test` checks application behavior against a SQLite-backed D1 test adapter; that is not a substitute for live D1 concurrency tests or provider verification.

## Provisioning checklist (owner action required)

Confirm the account, billing/quotas, hostname ownership, and published AGPL source repository first. The following commands **create remote resources** and are instructions, not commands already run here:

```bash
npx wrangler login
npx wrangler d1 create nameflare
npx wrangler r2 bucket create nameflare-textures
```

The chosen planned origin is `https://nameflare.bxne.dev`; ownership/DNS and account access have not been verified. No custom-domain route is enabled yet.

This version includes `0002_profile_avatars.sql` for account/profile avatars and `0003_flare_publication.sql` for public/unlisted Flares (existing designs remain publicly listed), plus `0004_account_moderation.sql` for bans, automatic staff approval, and owner exemptions. It also includes `0005_cosmetic_likes.sql` for post-style likes and `0006_full_profiles.sql` for bios and profile accents, plus `0007_creator_follows.sql` for private creator follows and personalized feeds. Apply pending migrations before running the updated Worker; do not recreate or replace existing production tables. For detailed provider registration and public account behavior, see [the provider setup guide](ORACLE.md#public-accounts-and-provider-setup). Store Cloudflare credentials with Wrangler secrets rather than the Node `.env` instructions.

Replace the zero database ID in `wrangler.jsonc` with the returned D1 ID. Set the actual bucket name. Set top-level vars:

- `PUBLIC_BASE_URL`: one HTTPS origin without a trailing slash/path (e.g. your actual owned hostname).
- `OWNER_TWITCH_ID`: B_X_N_E's immutable numeric Twitch ID. Never a login name.
- `SOURCE_URL`: a public HTTPS repository containing the complete corresponding version, license, frontend and backend source.

Add an explicit custom-domain route to top-level configuration:

```json
"routes": [{ "pattern": "YOUR_OWNED_HOSTNAME", "custom_domain": true }]
```

Keep `workers_dev` and preview URLs disabled for a single canonical origin. The handler rejects alternate Host origins. Do not enable the `local` environment on a public route.

Apply the migration only after reviewing the target database:

```bash
npx wrangler d1 migrations apply nameflare --env='' --remote
```

Set provider credentials with secret prompts, never literal secrets in shell history or `wrangler.jsonc`:

```bash
npx wrangler secret put TWITCH_CLIENT_ID --env=''
npx wrangler secret put TWITCH_CLIENT_SECRET --env=''
npx wrangler secret put KICK_CLIENT_ID --env=''
npx wrangler secret put KICK_CLIENT_SECRET --env=''
npx wrangler secret put YOUTUBE_CLIENT_ID --env=''
npx wrangler secret put YOUTUBE_CLIENT_SECRET --env=''
```

Register only the providers you intend to offer. Unconfigured providers remain visibly disabled. Deploy only with explicit approval of this account, domain and resources:

```bash
npx wrangler deploy --env=''
```

## OAuth registration

Callbacks must match `PUBLIC_BASE_URL` exactly:

| Provider | Callback path | Provider configuration |
| --- | --- | --- |
| Twitch | `/auth/twitch/callback` | Confidential web application, client ID/secret, authorization-code grant; no posting scope |
| Kick | `/auth/kick/callback` | OAuth application, `user:read`, authorization code with S256 PKCE |
| Google/YouTube | `/auth/youtube/callback` | Web OAuth client, YouTube Data API v3 enabled, consent screen and test users, `youtube.readonly`, S256 PKCE |

Twitch developer console: https://dev.twitch.tv/console/apps
Kick developer documentation: https://docs.kick.com/
Google credentials: https://console.cloud.google.com/apis/credentials

Google's read-only scope may require verification before broad public use. A Google account must have a YouTube channel. Provider tokens are used only to retrieve the immutable identity and are never persisted or exposed to the browser. Linking is cookie/session-bound; expired or replayed state is rejected. User cancellation must be tested along with identity collisions.

The configured owner must sign in with Twitch. First signup and matching display names confer no privilege. Changing the configured owner ID does not revoke persisted owner roles; transfer needs an explicit operational procedure.

## Security and parity

- D1 stores hashed sessions and OAuth states. State consumption is one atomic `DELETE ... RETURNING`; identity linking uses a transactional D1 batch plus uniqueness and ownership constraints.
- D1 triggers enforce the three-Flare regular-account cap (migration 0008) and non-owner texture quotas, moderator manual no-self-review, audit staff publication/review decisions, and atomically clear equipped Flares on revocation.
- R2 must remain **private**: no `r2.dev` public URL, bucket custom domain, or long-lived object URL. All reads go through the Worker, which checks current approval/ownership.
- Public responses and approved textures use a 15-second cache window. Do not add longer CDN cache rules. Errors and private endpoints use `no-store`.
- Writes require a same-origin cookie session and CSRF token. Public batch resolve is the documented exception and accepts only bounded public reads.
- Rate-limit bindings use Cloudflare's trusted `CF-Connecting-IP`. Workers rate limiting is edge-local, not a strict globally consistent quota; account quotas live in D1.
- Scheduled hourly cleanup deletes expired sessions/state. Configure backups, D1 restore drills, R2 retention/quota monitoring, and privacy policies.
- Direct anonymous Twitch overlay is supported. The old overlay relay endpoints return 501 here; the relay has been removed from Node as well. Kick/YouTube account linking does not implement their live chat connectors. Multi-room relay requires Durable Objects or another deliberate streaming architecture.
- Image validation is still header/dimension validation, not full raster decoding, frame/time/memory limits or scanning. Harden uploads and abuse handling before opening unrestricted public signup.
- There is no automatic migration of existing SQLite data or image files to D1/R2. Use a separately reviewed import/backup plan; do not import demo accounts to production.

## Staging acceptance

Verify on the actual HTTPS hostname: each provider login/link, cancellation and replay rejection, account collision, new session rotation, owner bootstrap, moderator grant/revocation, private GIF upload, duplicate upload, review/no-self-review, equip/resolve, anonymous private-asset rejection, approval and revocation, CORS/error caching, R2 privacy, and OBS Twitch behavior. Live provider checks and deployment require credentials/access not supplied in this thread.

Reference documentation:
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
