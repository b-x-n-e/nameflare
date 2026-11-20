# Nameflare API & renderer contract

The official origin is configured by the operator in `PUBLIC_BASE_URL`. Until deployment, all examples refer to your local origin, not a reserved official domain. API paths are identical on self-hosted forks. Public API reads require no key; account/moderation mutations require the app's same-origin HttpOnly session plus CSRF token and are not a third-party write API.

## Approved public data

- `GET /api/v1/cosmetics?limit=60&offset=0&q=aurora` — `{version:1, total: number, cosmetics: [...], next_offset: number | null}`. Limit 1–100; offset 0–1,000,000. Only approved, publicly listed Flares. `total` counts all approved public Flares, not the filtered result. Search by Flare or creator name. `effect`: `all` (default), `animated`, `static`, `glow`, `texture`, `depth`. `sort`: `newest` (recent approval, default), `trending` (unique likes added in the last seven days, then lifetime likes), `liked` (like count from non-banned accounts), `popular` (current equipped-user count), `name`. Invalid filter/sort returns 400; filtering happens before pagination.
- `GET /api/v1/cosmetics/:id` — `{cosmetic: {...}}`. Approved unlisted Flares are also readable by ID. Pending/rejected/unknown IDs return 404.
- `GET /api/v1/profiles?q=artist&offset=0` — `{users:[...], next_offset:number|null}`. Pages of 24; search profile names, platform logins/display names, or exact platform IDs. Public profiles include account ID, name, avatar/profile source, join date, public connected identities, and `cosmetic` (approved equipped Flare or null). `is_moderator` is a boolean indicating an assigned Nameflare community moderator (not a Twitch/Kick/YouTube chat role); owners are not labeled moderators. Raw roles, ban notes, and session data are omitted. Banned accounts are omitted.
- `GET /api/v1/artists?q=name&offset=0` — Oracle/Node artist showcase: `{users:[...], next_offset:number|null}` in pages of 24, alphabetically by name then account ID. Only non-banned accounts with the current `artist` role are included, including artists without public Flares. Uses the profile search fields; offset must be an integer from 0–1,000,000. Each public profile adds `flares`, at most three newest approved, listed public Flare objects. The normal profile `cosmetic` field retains its equipped-Flare contract but is not used for showcase previews; only `flares` is rendered. Raw roles, ban notes, sessions, and private submission counts remain omitted. Public CORS and 15-second cache revalidation apply. Share `/artists` to open the showcase. Not available on the optional Cloudflare backend.
- `GET /api/v1/profiles/:id` — `{user:{...}}`; unknown/banned accounts return 404. Share `/profiles/:id` to open a profile.
- `GET /api/v1/profiles/:id/cosmetics?limit=24&offset=0` — `{cosmetics:[...], next_offset:number|null}`. Created-Flare gallery: only approved, publicly listed designs by this account. Limit 1–100; offset 0–1,000,000. Pending, rejected, and unlisted designs are omitted, with sanitized public metadata; unknown/banned profiles return 404.
- `GET /api/v1/users/:provider/:provider_id` — `{user: {provider, provider_id, login, display_name, cosmetic}}`. `cosmetic` is an approved recipe or null. Unknown identity returns 404. Providers: `twitch`, `kick`, `youtube`. Use immutable platform IDs, never a user-supplied username; YouTube uses the channel ID.
- `POST /api/v1/resolve` — JSON `{"provider":"twitch","ids":["123","456"]}` → `{users:[...]}`. At most 100 string IDs; duplicates are resolved once. Unknown identities are omitted; known identities without a cosmetic return null. No credentials needed; wildcard CORS supported. Results have `no-store`. Resolve has its own budget of 240 requests per minute per client IP, separate from the 40/min write budget, so an overlay revalidating a busy chat is not throttled. The Oracle Nginx template also leaves it out of its write limit.
- `GET /textures/:textureId` — approved raster asset. Pending textures are session-restricted to the uploader and reviewers. Access becomes private again upon revocation of all designs referencing a texture. Prior client caches may retain data for up to 15 seconds; previously downloaded files cannot be recalled.

### Integration endpoints (Oracle/Node, 2026.11)

These are Node-only. Clients should feature-detect through `GET /api/v1`, or treat a 404 as "unsupported". The SDK does both.

- `GET /api/v1` describes the API: `{version, features:{resolve, batch, lookup, changes, stats, wearers}, endpoints, limits, timing}`.
- `GET /api/v1/cosmetics/batch?ids=a,b,c` returns `{cosmetics:[...]}` for 1–100 comma-separated IDs. Approved Flares are returned whether listed or not; others are omitted. Use it to revalidate many explicit selections in one request.
- `GET /api/v1/cosmetics/lookup?name=Aurora%20drift` returns `{cosmetics:[...]}`: public Flares whose name matches exactly, ignoring case. Results are ordered by likes, then earliest approval, up to 10. It is for chat commands such as Banechat's `!bc nfpaint <name>`; use `/cosmetics?q=` to search.
- `GET /api/v1/changes?since=<cursor>&epoch=<epoch>` returns `{epoch, cursor, reset, identities:[{provider, provider_id}], cosmetics:[id], poll_ms}`.
  - `identities` lists people whose worn Flare may have changed since `cursor`: they equipped or unequipped, linked a platform, or were banned or unbanned.
  - `cosmetics` lists Flares that were reviewed, revoked or deleted. Recheck every identity currently showing one of them.
  - `reset: true` means the client cannot know what it missed: a first call, a server restart (new `epoch`), or a cursor older than the 15-minute or 20,000-event window. Revalidate everything, then continue from the returned `cursor`.
  - Poll every `poll_ms` (4 s). Responses are `no-store` and count against the 300/min read budget.
  - **Use it to keep results longer, not to skip revalidation.** While the feed is healthy, a result fetched after the feed's baseline can be trusted for up to 90 s. If a poll fails or resets, fall back to the 12 s expiry at once.

### Statistics and listings (Oracle/Node, 2026.11)

All public, CORS-enabled and cached for up to 10 seconds like the rest of `/api/v1`. They cover approved Flares only, and banned accounts never appear. Paginated lists take `offset` and `limit` (1–100) and return `next_offset`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/stats` | Site totals: `accounts`, `creators`, `public_flares`, `wearing_now`, `likes`, `follows`, `linked_accounts` (per platform), plus the top 10 `most_worn`, `most_liked` and `trending` Flares with their counts |
| `GET /api/v1/cosmetics/:id/wearers` | Who is wearing a Flare right now: `total` and `users` (id, name, avatar, badges, linked platform accounts), sorted by name |
| `GET /api/v1/cosmetics/:id/stats` | `wearers`, `likes`, `likes_7d`, `views_30d`, and daily `series.likes` and `series.views` for the last 30 days |
| `GET /api/v1/profiles?sort=name\|newest\|oldest&q=` | Every account (24 per page), with `total` |
| `GET /api/v1/profiles/:id/accounts` | The platform accounts linked to an account: provider, ID, login, display name, avatar and channel URL |
| `GET /api/v1/profiles/:id/stats` | `public_flares`, `likes_received`, `wearers`, `followers`, `following`, `wearing` (Flare ID or null), `joined_at` |
| `GET /api/v1/profiles/:id/cosmetics` | The public Flares an account created |
| `GET /api/v1/users/:provider/:id/profile` | The full public profile behind a Twitch, Kick or YouTube user ID |
| `GET /api/v1/users/:provider/:id/cosmetics` | The public Flares created by the person behind a platform user ID |

`equipped_count` on every Flare is the same live wearer count. Equips and likes can take up to 10 seconds to show.

### Browser SDK (`/client.js`)

`new NameflareClient({origin, live:true})` batches `resolve` calls, caches results, and fails closed:
- `get(provider, id)` returns an identity's worn Flare.
- `resolveCosmetic(nameOrId)` and `getCosmetic(id)` handle explicit selections. Name lookups use `/cosmetics/lookup` and fall back to search on older servers.

With `live: true` the client follows `/api/v1/changes`: equips and revocations show within one poll, and resolve traffic for a stable chat falls by about 8×. Without it, or against a server without the feed, results expire after 12 s as before. `applyCosmetic` and `updateCosmeticText` are re-exported from the renderer.

Read responses include `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=15, must-revalidate`, and an ETag. Repeat requests sending `If-None-Match` get `304 Not Modified`. Public answers are shared for up to 10 seconds; moderation, role, publishing and profile changes invalidate them at once. Never cache a null identity or cosmetic indefinitely. Default Node limits: 300 GET requests and 40 non-GET requests per minute per client IP (including app requests); Node 429 responses include `Retry-After` seconds. Without proxy trust, client IP means the socket peer. Oracle’s `TRUST_PROXY_LOOPBACK=true` enables a single validated `X-Real-IP` only from exact loopback peers after Nginx overwrites that header with `$remote_addr`. Untrusted peers, missing/invalid headers, and `X-Forwarded-For` chains cannot override the socket address. Nginx also retains its independent per-IP limits; users sharing an IP share quotas. Authenticated owner sessions bypass Node quotas, not Nginx/hosting limits.

```json
{
  "id": "cosmetic-uuid",
  "name": "Golden dimension",
  "creator": "artist",
  "updated_at": "2026-10-06T00:00:00.000Z",
  "recipe": {
    "colors": ["#fff3bd", "#e0ac56", "#fff5d8"],
    "animation": "shimmer",
    "speed": 7,
    "angle": 120,
    "glow": 3,
    "glowColor": "#f2c779",
    "shadowX": 2,
    "shadowY": 3,
    "shadowBlur": 4,
    "shadowOpacity": 70,
    "shadowColor": "#000000",
    "outline": 0.5,
    "outlineColor": "#ffffff",
    "depth": 6,
    "depthAngle": 70,
    "depthColor": "#705123"
  }
}
```

## Creator publication and sharing

The UI calls cosmetics **Flares**. Legacy technical identifiers such as `paints.js`, `stats.paints`, and `.nameflare-paint-layer` remain stable for existing integrations. Existing `/cosmetics` routes, response keys, renderer names, and identity resolution contracts remain compatible.

`POST /api/cosmetics` accepts an optional boolean `listed` (default `true`) alongside name, description, and recipe. `false` means unlisted—not private. Regular-user submissions require review and are limited to three Flares total per account, across every status and listing preference. The fourth submission returns 429. On the official Oracle/Node backend, accounts with the owner-assigned `artist` role may submit 20 total; their 21st submission returns 429. Artists still require review and have no staff privileges. Existing extras are preserved and count toward the cap; permanent staff deletion frees a slot. Moderators and owners are exempt. The separate 50-file texture-library quota is unchanged (owner exempt). Moderator/owner submissions are automatically approved with reviewer/time metadata and an audit event. Public metadata includes `description`, `creator_id` (the public profile ID), `creator_avatar`, `creator_provider`, `listed`, `equipped_count`, `like_count`, and `recent_like_count`; it never includes private `owner_id` fields, connected identities, moderation notes, or session data. Batch identity resolution retains its smaller legacy metadata shape.

On Oracle/Node, `POST /api/admin/artists` accepts `{ "id": "account-id", "enabled": true }` (or `false`) and returns `{user}` with `Cache-Control: no-store`. Requires the current owner role, an authenticated same-origin session, and valid CSRF token. Accounts may use any supported identity provider. Only regular/artist accounts can be changed; owner/moderator roles are protected, and banned accounts cannot be granted artist. Changes are idempotent and audited as `artist.added` / `artist.removed`. Grants/removals affect existing sessions immediately. Removal returns the account to `user`, preserves all existing Flares, and blocks further submissions while at or above 3. The optional Cloudflare runtime does not implement this role or endpoint.

`POST /api/cosmetics/publication` accepts `{ "id": "flare-id", "listed": true }`. Requires a same-origin authenticated session, valid CSRF token, and ownership or the owner role; moderators cannot override creator ownership. Every publication change is audited. Changing listing does not change approval, revoke existing equips, or hide public textures. Revocation still removes direct reads and clears all equipped assignments.

`GET /api/my/cosmetics?limit=24&offset=0` requires a session and returns `{cosmetics:[...], next_offset:number|null}` for all of that account's submissions, including pending, rejected, and unlisted designs. Explicit pagination can reach submissions beyond the legacy collection display cap. Calls without pagination retain their existing capped response (uncapped for owners).

Flare details offer **Download JSON** in the same `nameflare-design` version 1 format as studio export: name, description, listing preference, and recipe, without account/session IDs, review metadata, approval, or artwork permissions. Use **Import JSON** at the top of Flare studio (also in Finish) to edit a new copy. Texture IDs/settings are included, but image bytes are not: the editor clears image attachments and requires local files to be reattached before publishing. Old exports with top-level `layers` remain supported.

Share `/discover/:id` to open an approved Flare's preview. Anyone may read it; equipping any approved Flare requires sign-in, not creator ownership. Unlisted recipes/assets are accessible through ID links and equipped identity resolution and are not a confidentiality feature. Listing changes can take up to 15 seconds to leave public client caches.

## Full creator profiles

`GET /api/v1/profiles/:id` and profile search expose `bio`, `profile_color`, and `stats: {paints, likes, wears}` alongside name, avatar, connected public identities, joined date, and approved equipped Flare. Stats count only approved, listed designs by this creator; likes and wearers from banned accounts are excluded. Profiles also expose the server-derived boolean `is_moderator` for the public moderator badge. Oracle/Node profiles additionally expose `is_artist` for the blue Artist badge; neither flag grants client-side authority. They never reveal private favorites, pending/rejected/unlisted submission totals, raw moderation roles, private notes, or sessions. An equipped unlisted Flare remains publicly resolvable under the existing unlisted contract.

`POST /api/account/profile` accepts `{provider, bio?, profile_color?}` with same-origin authentication and CSRF. The provider must already be linked. Bio is trimmed plain text up to 280 characters; accent must be a six-digit hex color. Omitted optional fields preserve existing values, including for older clients. Bios are rendered as text, not HTML. Node adds columns on startup; the optional Worker requires migration `0006_full_profiles.sql`.

Public profile links use `/profiles/:id`; private account sections use `/account/overview`, `/account/settings`, and `/account/platforms`. Flare creator links target public profiles. Flare dialogs opened from profiles return to the originating profile without rebuilding the gallery. Platform links derive only from validated linked identities, not arbitrary user URLs.

## Creator following and personalized feed

`POST /api/profiles/follow` accepts `{id: "creator-profile-id", following: true}` (or `false`) with an authenticated same-origin session and CSRF token. Returns `{id, following}`. Explicit state is idempotent and the database allows one relationship per follower/creator. Self-follow and invalid booleans return 400; missing/banned creators return 404; signed-out requests return 401; invalid Origin/CSRF return 403. Following never likes, equips, or approves a Flare.

`GET /api/me` includes private `following_ids` for active followed creators, or `[]` when signed out. `GET /api/my/following?limit=24&offset=0&q=name` returns `{users, next_offset}` for the viewer's followed creators, ordered by follow date and stable ID. `GET /api/my/feed?limit=24&offset=0&q=flare&effect=all` returns `{cosmetics, next_offset}` for approved, publicly listed Flares by followed, non-banned creators, newest approval first and stable ID for ties. This includes existing public Flares as well as future publications; it is not an unread-notification feed. Sort is always newest. Both require authentication, use `no-store`, and do not allow public CORS. Limits are 1–100; offsets are integers 0–1,000,000.

Follow IDs/lists and viewer-specific state are never added to public profile/search/Flare responses. Bans suppress follows and their feed entries without erasing relationships; unbanning restores visibility of the relationship but not revoked Flare approvals. Unlisting/revocation removes a Flare from the Following feed. Account deletion cascades relationships. The private UI uses `/account/following`; the feed is bookmarkable at `/following`.

Follow controls use the existing tested optimistic toggle controller, with coalesced/serialized writes, stale-read/account-change protection, rollback, and Retry. Signed-out intent is revalidated and resumed after sign-in for up to ten minutes. Self-follow controls are hidden. Node creates the table additively; optional Worker deployments must apply `0007_creator_follows.sql` before activation.

## Post-style likes

`POST /api/cosmetics/like` accepts `{ "id": "flare-id", "liked": true }` with an authenticated same-origin session and CSRF token. Returns `{id, liked, like_count}`. Use `liked:false` to unlike. Explicit state makes retries idempotent; the database permits one like per account per Flare. Only approved, publicly listed Flares can be liked (404 otherwise). Invalid booleans return 400; unsigned-in requests return 401; invalid Origin/CSRF returns 403. Likes never equip a Flare or change approval.

`GET /api/me` includes private `liked_ids` for the current account, or `[]` when signed out. `GET /api/my/likes?limit=24&offset=0` requires a session and returns `{total, cosmetics, next_offset}` with the same search/effect/sort and pagination bounds as Discover. Only still-approved, publicly listed Flares appear. These responses are `no-store`; public catalog/detail responses expose `like_count` only, never viewer-specific liked state or lists of likers. Unlisted/revoked Flares disappear from the liked gallery without erasing stored likes; permanent Flare deletion cascades to its likes. Banned accounts cannot like and do not contribute to counts/ranking. Like totals in public caches may lag by up to 15 seconds.

The UI offers Discover / Trending / Your likes collections and Most liked sorting. Newest first remains the default. Hearts update optimistically, coalesce rapid clicks, serialize requests, reconcile authoritative counts, and roll back failures with Retry. Signed-out like intent resumes after authentication for up to ten minutes. Details preserve feed position; unlike in Your likes removes only that card after confirmation and restores keyboard focus. See [interaction design and references](UX.md). Node creates the likes table additively on startup without replacing existing data.

Cloudflare deployments must apply all pending migrations, including `0005_cosmetic_likes.sql`, `0006_full_profiles.sql`, and `0007_creator_follows.sql` and `0008_flare_submission_limit.sql`, before running this release. Node applies its additive migration on startup. Existing records default to public listing.

## In-app notifications

`GET /api/notifications?limit=30&offset=0` requires an authenticated session and returns `{notifications, unread, next_offset}`. Limit is 1–50 (default 30); offset is an integer 0–1,000,000. Rows are newest first and include `id`, `kind` (`like`, `follow`, `approved`, `rejected`), `target`, `detail`, `read`, `created_at`, and the public `actor` shape. Notifications from banned actors are omitted. Responses are `no-store`; no email or push notification is sent.

`POST /api/notifications/read` accepts `{"id": 123}` to mark one notification read, or `{}` to mark all read, with an authenticated same-origin session and CSRF token. Returns `{unread}`. Invalid IDs return 400; signed-out requests return 401; invalid Origin/CSRF returns 403. Likes, follows, and review decisions create notifications; unliking/unfollowing removes the matching unread item, and self-actions never notify. Bans hide an actor’s notifications and exclude them from unread counts.

## First-party analytics

`POST /api/views` accepts `{"path": "/discover/demo-0"}` from the official app origin. Only application paths are accepted; private account, collection, insights, and moderation paths return 400. Recording increments an aggregate `(UTC day, path)` counter and stores no IP address, account ID, referrer, or per-person session. The browser skips this call when Do Not Track or Global Privacy Control is enabled. Standard Node write rate limits apply. Returns `{ok:true}`.

`GET /api/my/analytics` requires a session and returns `no-store` creator analytics for the last 30 days: total likes received, current wearers, private followers, profile views, daily likes/profile-view series, and per-Flare likes/wearers/detail views. `GET /api/admin/analytics?days=14` requires the moderator or owner role and accepts 7, 14, 30, or 90 days. It returns aggregate accounts, public Flares, creators, pending reviews, likes, wearers, follows, traffic, signup/submission/review/like series, top Flares/creators, and most-visited paths. Counts exclude banned accounts and contain no viewer identity.

## Permanent deletion of disapproved Flares (Oracle/Node)

`POST /api/admin/cosmetics/delete` accepts `{ "id": "flare-id", "confirm": true }` with an authenticated moderator/owner session, exact trusted Origin, and valid CSRF token. Optional `"block_images": true` also blocks the Flare's images from being uploaded again. Returns `{ "ok": true, "id": "flare-id", "deleted_textures": ["sha256.gif"] }`. This is a private moderation mutation, not a public CORS write endpoint. The optional Cloudflare runtime does not implement this operation.

Only `rejected` (Disapproved) Flares can be deleted; pending/approved returns 409, missing/already-deleted returns 404, missing confirmation returns 400, unsigned-in returns 401, and non-moderators or invalid Origin/CSRF return 403. Revoke/disapprove first. The dashboard shows **Permanently delete Flare** on the Disapproved tab with an irreversible-action confirmation.

The Flare’s database record/recipe is deleted, stale equips are cleared, and it disappears from the creator’s collection, moderation queues/counts, and all Flare reads. Public direct reads return 404; reapproval, equipping, or changing publication cannot resurrect the deleted ID. Uploaded images and texture ownership rows are removed only when no other Flare references them, including pending, disapproved, or unlisted Flares. Missing images do not prevent deletion; shared assets remain usable. A minimal `flare.deleted` audit event retains actor, Flare ID, and time, not recipe/artwork. Existing audit decisions, backups, local drafts, previously downloaded files, and up-to-15-second client caches are not purged; this is not secure disk erasure.

No SQLite migration is required for this operation. Update the Oracle application source and restart its Node service.

## Activity log export (moderators)

`GET /api/admin/audit/export?format=csv|json` downloads the whole retained activity log (two years), oldest first: id, time, action, actor name and ID, target and detail. The CSV is spreadsheet-safe: every cell is quoted, and a cell starting with `=`, `+`, `-` or `@` is prefixed with `'`. The same exports are on Moderation → Activity log.

## Image uploads (Oracle/Node)

`POST /api/textures` (signed in, same origin, CSRF) takes `{ "data": "data:image/png;base64,…" }` (PNG, GIF, WebP, JPEG or BMP, at most 2 MB and 2048×2048). JPEG is decoded, turned upright from its EXIF orientation and re-encoded at quality 90, and is stored as `.jpg`. BMP is converted to PNG. The server:

1. Decodes and rebuilds the file.
2. Checks the blocklist.
3. Runs any configured scanners.

It stores the rebuilt file and answers `201` with:

```json
{ "id": "<sha256 of the rebuilt file>.png", "width": 128, "height": 64, "frames": 1, "removed": ["tEXt", "trailing data"], "needs_review": false }
```

| Status | Meaning |
|---|---|
| `400` | The file cannot be decoded |
| `409` | Another account already owns this image |
| `422` | Blocked by moderators, by a scanner, or too slow to process |
| `429` | Upload rate limit (12 per minute) |
| `503` | A configured scanner is down and `SCAN_FAIL_MODE=closed` |

`needs_review` means a scanner asked moderators to take a closer look. The ID differs from a hash of the original file because the stored file is the rebuilt one.

## Reports (Oracle/Node)

`POST /api/reports` (signed in, same origin, CSRF) takes `{ "target_type": "cosmetic" | "user", "target_id": "…", "reason": "rights" | "sexual" | "hate" | "harassment" | "impersonation" | "spam" | "other", "details": "optional, up to 1000 characters" }`.

- **Targets:** only approved Flares and active profiles can be reported, and never your own.
- **One per target:** each person has one open report per target. Sending another updates it and returns `{ "report": { "id": 1, "updated": true } }`.
- **Daily limit:** at most 20 new reports per day; the 21st returns `429`.

Moderators:

- `GET /api/admin/reports?status=open|closed&offset=0` returns `{ groups, open, next_offset }`. Each group is one target with its `reports` count, a `target` summary and up to 25 `items` (reason, details, reporter name, time, and for closed ones the resolution and resolver).
- `POST /api/admin/reports/resolve` takes `{ "target_type", "target_id", "action": "dismiss" | "remove" | "ban", "note", "block_images": false }` and resolves every open report about that target. `remove` revokes a Flare. `ban` bans the account, or a Flare's creator. Both need a note of at least 3 characters. If the action itself is refused (for example a moderator banning a moderator), the reports stay open.

## Your data (Oracle/Node)

- `GET /api/account/export` (signed in) returns everything held about the account as a JSON attachment:
  - the account and its connected identities;
  - every Flare with its recipe and review state;
  - uploads, likes, follows, notifications and reports sent;
  - a count of active sessions.

  It never includes session secrets or other people's private data.
- `POST /api/account/delete` (signed in, same origin, CSRF) takes `{ "confirm": "<the account's name>" }`, deletes the account and everything it owns at once, clears the session cookie and returns `{ "deleted": true, "flares": 3 }`. The owner account cannot be deleted.
- `POST /api/admin/accounts/delete` (moderators for members and artists; the owner for any account but its own) takes `{ "id": "…", "confirm": true, "reason": "at least 3 characters" }`. It is not a ban. Deleting a banned account keeps a one-way hash of each of its identities so the ban still applies.

## Account moderation and owner access

`GET /api/admin/users?q=artist&offset=0&status=all` is available to moderators and the owner (50 accounts per page), including private ban metadata. Status accepts `all`, `active`, `banned`, or `staff`; filtering happens before pagination. Search accepts a name, platform login, exact platform ID, or exact Nameflare account ID. Banned accounts are ordered by ban date, newest first. Reads remain private and uncached. Role assignment remains owner-only.

`POST /api/admin/ban` accepts `{ "id": "account-id", "banned": true, "reason": "Policy violation" }` with same-origin session and CSRF protection. Banning requires a 3–400 character reason; unbanning uses `banned:false`. Moderators can ban/unban regular accounts; only the owner can ban/unban moderators. Self-bans and owner bans are rejected. All bans are permanent (no expiry), persist across restarts, and cover every linked provider identity. They revoke sessions and pending account-link states, block returning OAuth login, hide public profiles/identities, and reject the account’s Flares, clearing affected equips. Repeated ban requests preserve the original date, reason, and audit event. Store authorization rechecks the actor’s current role and banned state. Staff can explicitly lift a ban; unbanning restores neither sessions nor approvals.

Authenticated owners bypass app throttling, account quotas, and collection caps, can manually review any non-banned creator’s Flare (including their own and rejected Flares), and can change any listing. Safe request/image/recipe validation, ownership, CSRF, and external proxy/hosting limits remain in force.

## Recipe version 1

Legacy effect colors and the fallback `colors` palette are six-digit `#RRGGBB`. `colors`: 2–5 colors (the visual studio exposes three fallback colors). Complex layer/stop/shadow colors also allow `#RRGGBBAA` alpha. `animation`: `flow`, `shimmer`, `pulse`, `spectrum`, `none`. `speed`: 1–20 seconds per cycle. `angle`: 0–360 degrees. `glow`: 0–20 px blur with `glowColor` (defaults to first palette color). `shadowX`/`shadowY`: −12–12 px, `shadowBlur`: 0–20 px, `shadowOpacity`: 0–100 percent, `shadowColor`: hex. `outline`: 0–2 px with hex `outlineColor`. `depth`: integer 0–8; `depthAngle`: 0–360 degrees; `depthColor`: hex. Defaults for old recipes: no shadow, outline, or depth; black shadow, white outline, `#303047` extrusion, 45° depth angle. Missing optional effects must not crash a client.

Optional `direction`: `normal` (default), `reverse`, `alternate`, or `alternate-reverse`; alternate modes play a forward/backward pair over two cycles. Optional `letterSpacing`: −1–6 px (default: inherit client typography). Both are bounded/allowlisted by the server and browser SDK. Old recipes and exports remain valid. Clients without Spectrum support should use a static fallback palette rather than reject an otherwise readable name.

Flow uses an inherited, registered numeric CSS property (`--nameflare-phase`, 0→1), not a resetting background-position sweep. For linear/radial fills, close unequal palette endpoints by appending the first color one average stop interval after the last. Repeat the gradient and offset every stop by exactly the closed last-minus-first period each cycle. Preserve stop positions, alpha, angles, canvas sizes, and exported data. Conic fills rotate from their original angle through one complete turn. Solid/image fills remain stationary; uploaded GIF playback is independent. Shimmer uses the same closed, constant-speed gradient sweep without easing pauses; Pulse fades gently; Spectrum rotates hue 0→360° while preserving the existing glow/shadow filter chain. Pause freezes CSS motion; reduced-motion disables it. Browsers lacking registered-property interpolation show a static Flow fill instead of a snapping loop. Animated gradients require repainting; do not treat this as a compositor-only transform animation.

New submissions allow **at most one distinct GIF and one distinct other image (PNG, WebP or JPEG) per Flare** (they share the image slot). Count unique texture IDs across the legacy top-level `textureId` and active image layers; duplicates count once. Both APIs return 400 for excess references, including owner submissions. Dormant gradient attachments are stripped. Previously published recipes still render; the upload endpoint remains an account asset library rather than a per-Flare counter. Animated PNG/WebP files still count in the PNG/WebP category.

Optional `textureId`: SHA-256 file key with `.gif`, `.webp`, or `.png` extension. Fetch only from the same trusted service origin at `/textures/:textureId`. Up to 2 MB; max logical canvas 2048×2048. Uploads are decoded and rebuilt on the server (see Image uploads); WebP pixel data is structurally checked, not decoded.

Render extrusion beneath the name's fill: for each layer i from 1 to depth, offset by `(cos(depthAngle) × i, sin(depthAngle) × i)` in pixels. The web implementation uses a behind-text pseudo-element so shadows do not cover the gradient. Apply glow around the composite glyph; outline around the fill. All names and chat messages must be inserted as text, never HTML. Display names remain the chat platform's display names; recipes never contain identity overrides.

`NameflareClient` consumers should call `expire()` on a regular timer (for example, once per second), or repeatedly call `get()` for active identities. The SDK queues refreshes after seven seconds while verified data remains valid for twelve seconds from request start. Successful unchanged refreshes retain renderer nodes and animation timelines; revocation, failed refresh, and the original expiry still remove the Flare. This avoids an intentional unstyled gap without retaining stale approvals indefinitely. External clients need the updated SDK/renderer and must not clear styles before each successful refresh. GIFs with a pause encoded in their original frame timing are unchanged.

The shared browser reference is `/renderer.js` plus `/effects.css` (also stored under `public`). Use `applyCosmetic(nameElement, cosmetic, serviceOrigin)` after setting `nameElement.textContent`. Reapply if the text changes. Honor reduced motion and provide a full disable toggle. Clamp values defensively even if data came from the official API.

## Complex Flare extension (backward-compatible optional fields)

Recipes can include `layers`, `shadows`, and `fontWeight`. Clients that only support the original fields can use the fallback palette. This is Nameflare’s own Flare format.

- `layers`: 1–6 objects, **top layer first**. Each has `type` (`solid`, `linear`, `radial`, `conic`, `image`), `opacity` (0–1), `size` ([width%, height%], each 1–500), `at` ([x%, y%], each 0–100), and `canvasRepeat` (`no-repeat`, `repeat`, `repeat-x`, `repeat-y`). Optional `blendMode`: `normal` (default), `multiply`, `screen`, `overlay`, or `soft-light`. Composite each layer with the layers beneath it inside the name’s isolated stacking context, never with surrounding chat content.
- Solid fill: `color` in hex RGBA.
- Gradient fill: 2–12 `stops`, each `{at:0..1, color:"#RRGGBB" | "#RRGGBBAA"}`. Stops are normalized into ascending position order and must span distinct positions. Also `angle` (0–360), `repeat` (boolean), and `shape` (`circle` or `ellipse`, for radial gradients).
- Image fill: `textureId` references a locally uploaded GIF, PNG, WebP or JPEG (BMP uploads are stored as PNG). Every layer asset is ownership-checked on submission, privately accessible before review, and publicly accessible only while an approved Flare references it. Opacity applies to the entire image layer, including GIF animation.
- `shadows`: up to 8 extra `{x:-20..20, y:-20..20, blur:0..30, color:"#RRGGBBAA"}` shadows, rendered using ordered drop-shadow filters. Native implementations must take the same stacking order into account.
- `fontWeight`: 400–900. The web renderer leaves the authoritative chat name intact and creates aria-hidden decorative fill layers; no text transformation or HTML injection.

The preview-only font dropdown compares system sans-serif, Arial, Verdana, Georgia, monospace, and the existing locally served Bricolage Grotesque font. It changes both live samples and crop geometry, not recipes, exports, or chat clients.

The studio offers an outline of layers and effects with a one-item inspector, editable positioned alpha stops, layer reorder/duplicate/remove, per-layer sizing/tiling/blending, multi-shadow controls, eight presets, playback direction and letter spacing, randomized starting points, undo/redo, and a pause-motion toggle. **Start with just an image** creates one empty image layer, with no gradient layer, CSS animation, glow, shadow, outline, or depth. Attach a PNG, WebP, or GIF, then name and submit normally. The fallback palette remains for older clients/reduced motion. **Crop & position** uses the existing layer `size` and `at` pairs: pointer/touch drag, arrow keys (Shift for larger steps), proportional zoom, position sliders, Cover without stretching, and Reset crop. The canvas matches the current preview name footprint; it does not rewrite image bytes or freeze animation. Cover is limited by the existing 1–500% size bounds for extreme ratios. Crop settings persist in Undo/drafts/JSON and render in every client supporting those fields. Select an image layer to replace its file; the usage indicator counts active distinct assets, and a rejected attachment leaves the recipe unchanged. GIF/image file selection and drag/drop are **local preview only**; sign-in is needed to upload/submit. Assets stay under 2 MB / 2048×2048, and their original bytes preserve GIF animation. Draft/JSON recipes do not embed image files; reattach images after reloading/importing. Paused or reduced-motion previews replace image fills with a static gradient, rather than pretending to freeze a GIF frame.

## Flare files

The studio exports and imports Nameflare Flare files (`format: "nameflare-design"`, `version: 1`). Any other JSON is rejected. Files carry the recipe only, never image bytes, so image layers must be reattached after import, and an imported Flare is reviewed like any new design.

## OBS / browser overlay

- `/overlay?channel=yourchannel` — transparent Twitch IRC read overlay (anonymous public-channel reader; respects CLEARMSG/CLEARCHAT and reconnects). Requires browser WebSocket internet access. Live operation is not provider-verified by unit tests.
- `/overlay?demo=1` — explicitly labeled sample messages, not live chat.
- Options: `&effects=0` disables cosmetics, `&lifetime=45` sets message lifetime (5–300 seconds).

Kick, YouTube and multi-platform chat overlays are Banechat's job ([chat.bxne.dev](https://chat.bxne.dev)); Nameflare's earlier relay rooms were removed.

## Chatterino / third-party clients

**Stock Chatterino support is not shipped.** A native integration must be implemented and tested in a compatible fork; installing this web app does not modify Chatterino.

Adapter contract:
1. Resolve real platform user IDs from chat messages and batch `/resolve` queries.
2. Cache for at most 15 seconds and invalidate on expiration; support removed designs and null results. Clients that follow `/api/v1/changes` may keep feed-covered results for up to 90 seconds, as described above.
3. Implement gradient animation, bounded outline/shadow/extrusion, and GIF/WebP image decoding in the client's rendering pipeline. A CSS recipe is not directly executable in Qt. Apply frame-count/decode/memory limits and reduced-motion controls.
4. Maintain text selection, Unicode shaping, clipping, badges, readable fallback colors, and high-DPI scaling. Cosmetics must never replace authoritative identity or moderation status.
5. Let users choose the official origin or an explicitly trusted self-hosted fork; never silently fetch arbitrary asset origins embedded by another user.

Future web extensions and native adapters can use this contract, but no Twitch/Kick/YouTube extension or Chatterino binary is included here.
