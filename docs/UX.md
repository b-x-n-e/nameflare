# Nameflare interaction design

> **2026 shell update:** the desktop interface uses a fixed left rail, a 54px utility bar, a flat single-column Flare feed, a companion rail with live try-on and creator discovery, and Web Awesome primitives (buttons, search, sort dropdown, filter chips) vendored in `public/vendor/webawesome`. Ink is the default theme; Paper and six mood variations remain available. Frosted chrome is removed. See [DESIGN.md](../DESIGN.md) for the current visual contract.

## References and decisions

- [Nielsen Norman Group: Animation for attention and comprehension](https://www.nngroup.com/articles/animation-usability/): state feedback begins immediately; motion explains the user's action rather than delaying it. Hearts update before the network round trip. The Flare specimen has one short already-visible entrance; the collection does not stagger/hide cards or use a blocking intro sequence.
- [W3C WAI: Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/): native buttons support Enter/Space, toggle labels stay stable, and `aria-pressed` conveys state. Flare hearts retain “Like [Flare name]” as their accessible name; counts are visible and changes are announced separately. Removing a liked card returns focus to the adjacent heart or the collection selector.
- [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide): motion uses transform/opacity for heart pops, counters, dialog entrances, and cards. No full-page moving background or unnecessary permanent `will-change`; the hero's authored ink entrance and Flare motion are visibility-gated and can be paused.
- [web.dev: prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion): reduced-motion users receive the same immediate state feedback without UI animation; the existing Flare renderer also honors this preference.
- [TanStack: Optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates): snapshot, update immediately, reconcile success, roll back failure, and protect against stale refetches. The underlying pattern is implemented in vanilla JavaScript; TanStack is not a dependency.

## Visual system

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): navigation recedes behind the working area; separators establish relationships without boxing every section. Applied to the sidebar, homepage, catalog tools, guide, and moderation sections.
- [Vercel Geist: Colors](https://vercel.com/geist/colors): separate page/component surfaces, use neutral borders by default, and distinguish default, hover, active, and text roles. Nameflare uses its own graphite/coral palette, not Vercel branding or a new UI dependency.
- [Vercel Geist: Typography](https://vercel.com/geist/typography): establish a small, deliberate hierarchy for headings, copy, labels, and metadata. The homepage has one editorial display heading; working screens use smaller titles and quiet supporting text.
- [GitHub Primer: UI patterns](https://primer.style/product/ui-patterns/): native disclosure, purposeful empty states, and clear navigation keep secondary information available without competing with primary actions.

The site uses locally served Bricolage Grotesque for display type, native body/chat fonts, the supplied navy N and sweeping red-orange-gold flame recreated as vector SVG paths, and embedded line icons. The [Impeccable-guided visual specification](DESIGN-2026.md) defines ink surfaces, crimson actions, open composition, readable specimen controls, and no nested showcase cards or heading kickers. The interactive signature canvas uses original red ink strokes and one already-visible entrance. Pause, viewport/tab visibility, and reduced-motion preferences stop hero effects and Flare motion. Fine-pointer visitors get a small perspective shift; controls and hit targets do not move. Changing its name, preset, or motion setting updates both the magnified canvas and the actual chat-size sample. These are explicitly labeled studio presets, not community recommendations or fabricated popularity.

Flare cards show real palette/effect data and synchronized equipped states. Creator covers derive from the creator’s chosen profile accent and initials; they imply neither verification nor paid membership. The material tiles illustrate studio capabilities, not published/equippable designs. Compact horizontal navigation groups discovery and personal work; secondary resources are in a native menu. On mobile the same destinations expand behind an explicit Menu button. Quick navigation (Ctrl/⌘ K) filters actual destinations and can search the Flare collection; native dialog focus handling and Escape make it optional and accessible. Small shadows, restrained card lifts, and material details provide hierarchy without custom cursors, scan lines, or blocking entrances. The authored ink entrance and immediate state feedback never delay interaction; repeated section reveals and elastic motion are removed. Reduced-motion users keep all content and controls and get the renderer’s static fallback. Guide content remains documentation rather than dashboard cards.

Discover presents search, sort, and effects first. Less-frequent preview controls live in a keyboard-operable native disclosure with explicit labels; Escape closes it and returns focus to its summary, and an outside click dismisses it. Selected filter states and live result feedback remain intact. Nothing implies fabricated popularity, a verified endorsement, or live-provider compatibility.

## Navigation and studio keyboard controls

- App links use clean paths such as `/discover`, `/profiles/:id`, and `/studio`. Both server adapters serve direct deep links. Navigation preserves browser Back/Forward; legacy hash bookmarks are replaced with their clean equivalent. Anchor links used for skip-to-content and SVG references stay unchanged.
- Studio shortcuts: Ctrl/⌘ Z to undo, Ctrl/⌘ Shift Z or Ctrl Y to redo, Ctrl/⌘ S to save a local draft, Alt 1–5 for Fill/Effects/Motion/Lettering/Publish, Alt ↑/↓ to select a layer, Ctrl/⌘ D to duplicate, Delete/Backspace to remove, Space to pause/resume, and arrows to nudge layer position (Shift for larger steps). Native tab-list arrows and crop controls keep their own keyboard behavior. Text/select fields keep native editing/undo; shortcuts are inactive outside the studio or while dialogs are open. Saving a draft does not publish.
- Creator directory cards reserve matching header, bio, platform, stats, preview, and action slots. Bios/names are clamped only in directory cards; full profiles retain their content. Desktop rows align; mobile remains a single column without horizontal overflow.

## Moderation workspace

Review queue, Accounts, Settings, and Activity log are distinct bookmarkable sections. Review cards separate the preview from decisions, and keep account identifiers/recipes behind native disclosure. Settings contains a searchable, paginated list of permanently banned accounts with identities, dates, reasons, and a permitted Lift ban action. Suggested artwork-rights, readability, and motion-safety notes fill an editable reason; they never submit a decision automatically. Canceling a revocation no longer refreshes away the reviewer’s draft note.

All bans have no expiry. A required reason and explicit acknowledgement precede confirmation; the dialog defaults focus to Cancel, traps focus natively, retains errors, prevents dismissal during saving, and restores focus when possible. Owner/self protections and moderator-versus-owner permissions remain server-enforced. Ban records and all linked identities survive restarts; explicit unbanning does not revive sessions or Flare approvals.

## Appearance, activity, and insights

- Appearance is a browser preference applied before first paint by a tiny blocking script. Choosing a theme updates `data-theme`, the theme-color meta tag, and the preference dialog's `aria-pressed` swatches without reloading. Density and interface motion are separate choices. `T` cycles themes outside text fields and dialogs; the dialog is also reachable from More and the command palette. Reset restores Ink, comfortable density, and full motion. Stored preferences never change a Flare's recipe or its authored colors.
- The notification bell appears only for signed-in accounts when notifications are enabled. The unread count is capped at `99+`, the dialog uses native modal focus behavior, and polling pauses while the tab is hidden or the dialog is open. Per-item clicks mark read optimistically and roll back silently on failure; Mark all read is disabled when caught up. Load older activity appends pages without rebuilding existing rows. No email or push permission is requested.
- Insights is a private tab for signed-in creators. Anonymous visitors see a sign-in explanation, not fake data. Staff see an additional 14-day platform pulse. Numbers label their window and exclusions; every chart has an accessible summary and an expandable daily table. Profile and Flare views are aggregate counters only; private workspace routes are excluded, DNT/GPC stop recording, and no IP address or account ID is stored with a view.
- Mobile keeps the five primary destinations in a fixed tab bar with safe-area padding; the appearance, search, shortcuts, guide, and integrations entries stay in the expandable menu. Toasts sit above the tab bar and remain dismissible. The back-to-top control is hidden while the tab bar would overlap it.

## Flow

Discover → preview a Flare → heart to save or inspect details → equip.

- Discover, Trending, and Your likes are separate collection selectors. Your likes has a purposeful sign-in state, not a surprise authentication popup just for browsing.
- Trending sorts by unique, active-account likes created in the last seven days, then lifetime likes, approval date, and stable ID. No fabricated popularity, moderation bypass, or seeded production posts.
- Empty production catalogs offer explicitly labeled studio presets that open a new editable copy. These are not community posts and cannot be liked/equipped as published Flares.
- Opening/closing detail previews preserves the feed, scroll position, and focus. Like controls share one state machine across cards and details.
- Signing in after a heart click resumes that like. Intent is stored in sessionStorage for up to ten minutes and revalidated against the approved public API.
- Loading keeps existing results readable; first loads show delayed skeletons. Aborted/superseded reads do not replace newer results. Load-more appends deduplicated cards without rebuilding the existing grid.
- Like clicks coalesce for 160 ms. Requests for one Flare are serialized; users can change their mind while a request is in flight. Failure rolls back to the last confirmed state and exposes Retry.
- A tiny pending dot indicates saving without disabling the heart or fading the entire control. Hearts never reorder the feed under the user's pointer.

## Creator journey

Discover → creator byline → full profile → public Flare gallery → inspect/remix/equip → your creator space.

- Public creator pages have an editable plain-text bio, accent, linked platforms, joined date, real public Flare/received-like/wearer counts, and a current-wearing preview. No invented follower or activity counters.
- Private favorites and submission/review details are separate from public stats. Unlisted is link-only, not confidential; an equipped unlisted Flare remains resolvable.
- Account Overview shows current Flare, private favorites shortcut, and paginated submissions. Edit profile and Connected platforms are distinct, bookmarkable sections instead of a long mixed-purpose page.
- Flare dialogs preserve the originating profile/gallery, scroll, and focus. Opening from a creator page does not first jump to or fetch the entire Discover feed.
- Profile search stays intact when opening a creator. Detail titles identify the creator, and a clear All creators link returns to the directory. Errors expose Retry rather than silently presenting an empty gallery.
- Bios use text nodes. Platform links use validated linked identities; profiles do not introduce arbitrary outbound URL/image upload fields. Name/avatar continue to come from verified sign-in providers.

## Following

Creator profile → Follow creator → Following feed → inspect, like, remix, or equip independently.

- Following is a private subscription list, not another heart, entitlement, or automatic equip. Public pages do not expose follower lists or viewer-specific follow state.
- The feed shows approved, listed Flares from active followed creators, newest first, including existing designs. No fabricated new/unread badges, algorithmic ranking, or empty-feed filler from unfollowed creators.
- A direct Following route skips the general homepage hero. Find creators and Manage following remain visible alongside clear signed-out, no-follows, no-public-Flares, and filtered-empty states.
- Native follow toggles keep a stable accessible name and `aria-pressed`; the visible label distinguishes Follow creator from Following. They reuse the tested ordered optimistic controller, including rollback/Retry and account-generation protection.
- Signing in after a follow resumes the intent, except self-follow. Own-profile controls are hidden. Unfollowing in private management removes the confirmed card only and moves focus to a neighbor or the active account section.
- Banned accounts are omitted; stored follows are not erased by bans. Feed queries explicitly enforce approved/listed/non-banned restrictions in both adapters.

## Upload limits and preview fonts

- Oracle/Node `/artists` is a searchable, alphabetically paginated showcase of active Artist accounts. Show blue badges, public-only counts, Follow and profile links, and up to three newest approved/public Flare previews per artist. Include a clear no-public-Flares state without revealing private submission totals. Preview buttons open existing Flare details; Pause previews toggles `aria-pressed` and honors reduced motion. Search, loading, retry, empty, and previous/next states use the existing dependency-free UI. Removed roles and bans are reflected after the public cache revalidates. Do not use the profile’s potentially unlisted equipped Flare as a showcase preview.
- Feed-tab switches preserve the tabs’ viewport offset during header changes and result replacement, including signed-out/empty likes. Short feeds keep enough minimum height to prevent scroll clamping; a reader’s manual scroll during loading wins. Feed changes do not reset the page to its top. This is separate from navigation to another workspace.
- Studio font search filters the complete bundled Google Fonts snapshot locally; only selecting a family downloads its stylesheet/available weights. Local/system fallbacks, loading/retry text, explicit Google-CDN privacy disclosure, and selection-race protection are required. Font is preview-only and applied consistently to magnified name, actual-size chat, and crop guide; it is never serialized into Flare JSON. Keyboard shortcuts have their own linked Guide chapter with native typing/tab/crop exceptions.
- Regular accounts may submit three Flares total across pending, approved, rejected, and unlisted designs; on Oracle/Node artists may submit 20, with the same review requirements and no moderation access. Owner-only Make artist / Remove artist controls live in Moderation → Accounts and use the existing confirmation dialog. Show a static blue Artist badge with a pen icon and readable label beside public/private profile names and in the accounts table. Explain that it is a Nameflare role, not a platform chat role. Removal immediately restores the 3-Flare limit without deleting designs. Moderators may ban artists like regular users. The optional Cloudflare runtime does not offer this role. Moderators/owners remain exempt. Existing extras are retained. Permanent staff deletion frees a slot. Texture-library limits are separate and unchanged.
- Preview font changes both studio specimens and crop geometry without touching recipes, drafts, exports, or API data. Options use installed system fonts and the existing local Bricolage font; system availability affects exact appearance.
- The SDK refreshes at seven seconds while its last verified result remains valid, rather than deliberately clearing an equipped Flare before every fetch. Offline results still expire at the original twelve-second deadline; revocations clear immediately on a successful refresh. Renderer reapplication restores decorative layers if a chat client replaced the text node and retains the animation time.

## Flare motion and compositing

- Flow is a closed, repeating gradient cycle, not a background-position reset. Linear/radial stops move by exactly one closed repeat period, independent of name width, gradient angle, or canvas scale; conic fills turn through 360°. Render-time closure never changes saved/exported stops. Shimmer uses a constant-speed closed sweep without pauses at either end; Pulse returns to full opacity. Unchanged previews keep their Flare nodes and animation timeline; style edits retain current animation time. Tile swatches describe active fill-layer colors rather than the legacy fallback palette, and image fills are labeled without inventing colors. Signed-in account names populate hero, tile, and studio previews, while deliberate custom names survive ordinary account refreshes.
- Spectrum cycles hue through a full turn with the existing glow/shadow chain intact. Playback supports forward, reverse, and ping-pong. GIF playback remains independent; Flow does not pan images or solids into blank space.
- Each Flare layer can blend with layers beneath it using Normal, Screen, Multiply, Overlay, or Soft light. Blending is isolated from the page/chat backdrop. Letter spacing is bounded and inherited by decorative fills so their glyph positions match the authoritative text.
- Pause and reduced-motion rules cover all CSS effects. Reduced-motion render paths omit animated gradient phase expressions and replace animated textures with a static fallback. Gradient phase animation repaints; profile large galleries before adding more simultaneous effects.
- Regression checks cover loop periods across angles/canvas sizes, safe bounds, old-recipe compatibility, SDK/import/export round-trips, and Node/Worker publication. Browser checks sampled Flow at phase 0 and 1, Spectrum with preserved glow, reverse playback, spacing/Undo, pause, reduced-motion rules, and desktop/mobile overflow. Mobile screenshot capture was unavailable in this host; layout/accessibility/computed-style checks succeeded.

## Image-only Flares and branding

- Start with just an image replaces the design with one empty image layer, Static animation, and no extra effects. Undo restores the previous design. The fallback palette is retained for older/reduced-motion clients; a file must be attached before submission.
- One distinct GIF and one distinct PNG/WebP are permitted per Flare. Reused assets count once; PNG/WebP share a slot. Replacing one layer cannot leave a second unique asset in another duplicate layer. Dormant attachments count only when switched back to Image. Asset-library and history cache sizes are not per-Flare quotas.
- A live usage indicator and replacement instructions explain the limits. Attachments are checked against the current recipe after asynchronous decoding/hash work; failed attachment preflight revokes its temporary preview URL and leaves the design unchanged. Both server adapters validate references, including legacy IDs, before ownership/publication.
- The logo uses scalable vector paths and gradients, with accessible title/description and a transparent background—only the N and flame remain. The same SVG is used for the brand, dialogs, and favicon. User texture uploads still exclude SVG.
- Per-image Crop & position offers a proportional canvas showing the name footprint over the selected file, pointer/touch dragging, arrow-key nudges (Shift for larger steps), proportional zoom, horizontal/vertical position sliders, Cover without stretching, and Reset crop. It updates the existing bounded `size`/`at` fields, so Undo, drafts, exports, and both renderers need no new format. At 100% size there is no room to pan that axis; cover retains aspect ratio unless the existing 1–500% bounds constrain an extreme ratio. Image bytes and animation remain intact.
- Crop verification used browser controls for Cover, zoom, keyboard nudges, Reset, Undo/Redo, and saving a draft; the saved settings matched the renderer. Synthetic mouse/touch pointer events exercised pan and cancellation (native pointer capture still needs a manual device check). Desktop/mobile DOM/computed-layout checks found no horizontal overflow. Screenshot capture was unavailable during this crop pass because the preview webview was not composited. Browser canvas sampling verified transparent logo corners/negative space and opaque N/flame pixels.
- Browser acceptance: 390×844 and 1440×1000 layouts have no horizontal overflow; the single-image fill renders with CSS animation disabled. PNG/GIF combination, excess-file rejection without design mutation, PNG replacement, and Undo restoring original attachments were exercised. Mobile/desktop screenshots and the full SVG were inspected. Automated Node/Worker checks cover owner enforcement, duplicate reuse, and legacy-field bypass attempts.

## Acceptance

Automated checks cover immediate feedback, click coalescing, ordered requests, rollback/retry, stale responses, account changes, invalid mutation responses, unique database likes, pagination, bans, unlisting, and recent-like ranking.

Browser checks should cover signed-out continuation, heart/unheart, removal focus, card/detail synchronization, preserved scroll, search reset, useful empty states, loading/failure states, desktop/mobile overflow, and reduced motion. Live-provider OAuth credentials and consent remain operator-managed.
