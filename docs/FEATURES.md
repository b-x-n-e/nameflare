# Feature reference

Everything Nameflare does today, in detail. The [README](../README.md) has the short version; safety, privacy and operations are in [Operations](OPERATIONS.md) and [Privacy](PRIVACY.md).

## Studio

- Live design-tool studio (structure outline, canvas with templates, one-item inspector, gradient bar with draggable stops, effect switches, publish dialog): up to six solid/linear/radial/conic/image layers, per-layer opacity/sizing/tiling/blending, 2–12 positioned RGBA gradient stops, animated GIF/WebP/PNG fills, glow, outline, eight additional colored shadows, adjustable text weight/letter spacing, and 0–8 layers of 3D-style extrusion.
- Searchable full Google Fonts preview catalog (1,951 families in the bundled snapshot), downloaded only on selection, with local/system choices, loading feedback and Retry. Preview typography never changes saved Flare recipes. Catalog metadata is hosted locally; choosing Google fonts contacts Google’s CDN. Refresh the snapshot with `npm run fonts:update` using Fontsource’s public Google API metadata mirror—no API key or runtime dependency. Studio shortcuts are documented in Guide → Keyboard shortcuts (`/guide/shortcuts`).
- Seamless gradient Flow with matching cycle endpoints, Shimmer, Pulse, Spectrum hue cycling, forward/reverse/ping-pong playback, and isolated Screen/Multiply/Overlay/Soft light layer blending. Existing recipes remain valid; pause and reduced-motion are supported.
- Eight layer-based presets (Sunset fade, Aurora, Neon tube, Liquid chrome, Retro extrude, Sticker, Prism, Holo foil), randomized starting points, layer reorder/duplicate, undo/redo, pause motion, light/dark/checkerboard previews, actual chat-size preview with a magnified inspection view, browser-local drafts, and JSON import/export.
- Start with just an image for a PNG/WebP/GIF-only fill without gradients or extra effects. Visually crop using drag/touch or keyboard positioning, proportional zoom, Cover, and Reset; changes use portable layer size/position fields; the crop never edits the image itself. Drag/drop files without signing in to preview them locally. Each Flare permits at most one distinct GIF plus one distinct PNG/WebP image; reusing the same file across layers counts once. The studio and both APIs enforce this, including legacy texture references and owner submissions. The authenticated upload happens on submission and validates ownership for every image layer. Files remain limited to 2 MB / 2048×2048; the server rebuilds each file and keeps its animation. Reattach image files after reload/import; JSON drafts do not embed them. Preview text does not rename a platform account.
- Flare details offer Download JSON for editing a copy through the studio’s prominent Import JSON button. Downloads preserve recipe settings, name, description, and listing preference—not image bytes, approval, or artwork rights. Reattach image files before publishing.

## Discover and community

- **Flares** are the product name for name cosmetics. Name and describe a Flare in Finish, then choose public listing (default) or unlisted sharing. Approved public Flares appear in Discover; anyone can browse without signing in and equip after signing in. Unlisted Flares are omitted from the catalog, not private: their link, equipped identity, recipe, and assets remain public. Their creator or the owner can change listing, with an audit record. Regular-user Flares require review; moderator and owner submissions are approved automatically.
- Discover includes server-side search/effect filters, newest/weekly-trending/most-liked/most-equipped/name sorting, optimistic animated hearts with rollback/retry and sign-in continuation, a private Your likes collection, equip counts, custom-name and paused previews, direct equip buttons, and shareable `/discover/:id` detail pages. Collection has review-status filters, share links, and publication controls. SVG Twitch, Kick, and YouTube brand paths are embedded locally from [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0); trademarks remain with their owners.
- Private creator following with optimistic profile toggles, sign-in continuation, a newest-first approved/public Flare feed, and paginated followed-creator management. Following is separate from likes/equips; bans and private publication are respected.
- Public profile search by name, platform login/display name, or exact platform ID, shareable profile pages, live equipped-Flare previews, and paginated galleries of each creator’s approved, publicly listed Flares. My account shows all your own submissions and review states, with pagination beyond the legacy collection cap. Banned accounts are omitted.
- Public **Artists** showcase at `/artists` on Oracle/Node: searchable, paginated owner-selected artists with blue badges, public stats, Follow/profile links, and up to three approved, publicly listed Flare previews each. Pending/rejected/unlisted Flares and banned accounts never appear as showcase previews. Pause/resume respects reduced motion; artist role removal removes the account from the showcase on the next uncached read (public caches: up to 15 seconds).
- In-app activity without email: unread notification bell, paginated inbox, per-item and mark-all read, notifications for likes, follows, and review decisions, a five-destination mobile tab bar, native share sheets with clipboard fallback, command palette, shortcut sheet, offline banner, and relative timestamps.
- Insights at `/analytics`: creators see daily likes and profile views, wearers, followers, and per-Flare likes/wearers/detail views; staff also see a 14-day platform pulse with traffic, signups, submissions, reviews, top Flares/creators, and most-visited pages. Page views are first-party aggregate counters without IP addresses or account IDs. DNT/GPC stop tracking; private account, collection, insights, and moderation routes are never recorded.
- Appearance studio with eight coordinated themes (Ink as the default, Paper, Sand, Dusk, Frost, Moss, Plum, Rose), comfortable/compact density, full/reduced interface motion, instant `T` theme cycling, and a pre-paint boot script so the saved theme never flashes. Preferences stay in this browser; Flare previews keep their own authored colors.
- Responsive social interface with a fixed desktop rail, a flat single-column Flare feed, a companion rail with live try-on and creator discovery, sticky collection tabs, creator-colored avatars, eight named themes, and Web Awesome-powered search, dropdown, filter chips, and generated action buttons. Web Awesome is vendored locally (no runtime package or build step). Design references are in [DESIGN.md](DESIGN.md), [the UX notes](docs/UX.md), and [the 2026 specification](docs/DESIGN-2026.md). Node tests, Docker hosting configuration, and a local Wrangler development dependency.

## Accounts

- Public passwordless sign-up/sign-in through Twitch, Kick (PKCE), and YouTube channel OAuth. Full creator pages with editable plain-text bios/profile accents, public-only Flare/received-like/wearer stats, linked platform avatars, selectable profile source, account creation time, connected identities, and equipped Flares; a private dashboard separates overview, profile editing, and platform linking; one account can link one identity per platform. No provider access/refresh tokens are persisted.
- SQLite persistence for users, hashed sessions, cosmetics, follows, in-app notifications, anonymous daily page-view counters, moderation roles, and audit records.

## Moderation

- Moderator-accessible searchable, paginated accounts table with audited ban/unban controls. Bans revoke sessions, block sign-in, and revoke the account’s Flares and their equipped assignments. Unbanning does not restore sessions or Flare approval. Only the owner can manage moderator roles or ban/unban moderators; the owner and self-bans are protected.
- Owner-only **Artist** grant/removal from **Moderation → Accounts** on the official Oracle/Node backend. Artists get a blue badge on public profiles, their account, and the accounts table, with **20 submitted Flares** instead of 3. All review states and unlisted Flares count; artist submissions still require review and the role grants no moderation privileges. Removal immediately restores the 3-Flare limit without deleting existing designs. Works with any linked platform, not just Twitch; changes are audited and need no database migration. The optional Cloudflare runtime does not support artist roles.
- Owner-only moderator grant/removal controls using verified numeric Twitch IDs. The owner is bootstrapped only from `OWNER_TWITCH_ID`; first signup is never automatically an admin.
- Searchable, paginated pending/approved/disapproved dashboard with creator avatars/verified identities, submission/review timestamps, reviewer, feedback, full recipe, and pause/light-backdrop previews. Independent manual review for moderators (no self-review), owner review overrides, audited automatic publication/approval/rejection/revocation, and approved-only public recipes/assets.
- Oracle/Node moderation: permanently delete disapproved Flares with explicit confirmation. Removes the recipe/database record and image files no other Flare uses, including API/collection/dashboard entries; retains a minimal audit event. Existing backups and downloaded copies are not erased.
- Owner exemptions from account quotas, app request throttling, and the collection display cap, with safe upload/recipe validation and authentication intact. External hosting/proxy limits still apply.

## Integrations

- CORS-enabled versioned public API, batch identity resolution, a transparent OBS browser-source overlay, direct public Twitch chat connection. Kick, YouTube and multi-platform chat overlays are covered by Banechat.
- On-site creator, OAuth, moderation, OBS, troubleshooting, and API handbook (`/guide` or the Guide navigation item).

## Hosting

- Oracle same-host Nginx/Node per-client rate limiting with opt-in loopback proxy trust, overwritten client-IP headers, spoof protection, and `Retry-After` responses. Users no longer share the entire proxy’s Node quota when configured this way.
- Oracle server hosting with the Node/SQLite backend and filesystem textures; see the [Oracle runbook](docs/ORACLE.md). The repository also contains an optional Cloudflare Worker implementation, but it is **not used by the official service**.

## Safety and privacy (2026.11)

- Uploaded images are decoded and rebuilt on the server: metadata, comments and anything appended are removed, decompression bombs are refused, and decoding is capped in frames, pixels and time. Optional ClamAV and content-classifier scanning, and a moderator blocklist that stops a removed image from coming back.
- Report a Flare or a profile; moderators resolve everything reported about it at once (dismiss, remove, ban) from Moderation → Reports.
- Account → Your data: download everything as JSON, or delete the account and everything in it.
- Published retention periods enforced by the server, including cleanup of abandoned uploads.
- Per-client edge rate limits in nginx (IPv4 address or IPv6 /64), nightly backups with verified restore, and a load-test tool sized for an Oracle E2.1.Micro.

## Added in late 2026.11

- Custom theme: pick a background and an accent under Appearance; text, panels and lines are derived from them and switch between light and dark automatically, with a contrast warning for hard-to-see accents.
- JPEG and BMP uploads. JPEGs are re-encoded upright without EXIF; BMPs are stored as PNG.
- API: site stats, live wearer lists and counts per Flare, per-Flare and per-creator stats, every account with a total, linked platform accounts, and lookups of a person's profile and Flares by platform ID.
- Moderators can export the whole activity log as CSV or JSON.
- An aligned accounts table with one Manage menu per row, one-line names on profile cards, readable caution notes and status badges, automatic retries when the server is busy, and no Discover flash when refreshing another page.
