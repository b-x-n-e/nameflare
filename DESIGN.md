# Nameflare design

## Purpose

Nameflare is a creative tool and a public collection of animated **name paints**, called Flares. Discovery helps people choose a look; Studio helps them make one; creator profiles connect the work to its author. Keep real paints and usable tools at the center. Do not present it as an emote marketplace, an AI product, or a native platform feature.

## Direction

A dark, precise product studio with editorial confidence. The interface is built from a small set of layered neutral surfaces, hairline rules, one signal accent, and generous type. Color and motion belong to the Flares, not the chrome: the only accent moments are the primary creation action, live/focus states, and artwork-derived washes inside preview stages.

The visual system was rebuilt from scratch in 2026.2 around a Once UI–style foundation — a stepped neutral surface scale, semantic `surface`/`ink`/`accent` tokens, a single radius scale, compact controls, and calm depth — implemented in plain CSS so the project keeps its no-build, no-runtime-dependency constraint. Once UI itself is React-only and was therefore used as a design reference, not a dependency.

## Files

- `public/ui/tokens.css` — the whole material system: type, colour scales, eight themes, shape, elevation, layout, motion, the Web Awesome token contract, base reset and shared atoms.
- `public/ui/kit.css` — the component kit: buttons, fields, ranges, segmented controls, tabs, chips, panels, cards, badges, avatars, menus, dialogs, toasts, tables, skeletons.
- `public/ui/frame.css` — the frame: the top header (brand, primary navigation, More menu, search, create, account), the page container, the mobile menu sheet, and the rhythm/declutter layer (empty states, pagination, section spacing).
- `public/ui/shell.css` — the frame: rail, top bar, discovery header, feed controls, feed cards, margin column, mobile header and tab bar, breakpoints.
- `public/ui/views.css` — profiles, account, insights, moderation, guide, integrations, and every dialog body.
- `public/ui/studio.css` — the Flare studio workspace: command bar, section rail, panels, canvas, and its responsive pinned-stage layout.
- `public/ui/admin.css` — the moderation workspace: section bar, queue + focused review, account rows, and the activity timeline.
- `public/effects.css` and `public/renderer.js` — the Flare renderer. Never skin these from product CSS; a Flare's colours and motion are authored data.

There are no override layers. Earlier `craft.css`, `ember.css`, `modern.css`, and `atelier.css` passes were removed with the rebuild; new work belongs in the seven files above, in the section that owns it.

## Visual language

- **Ink** is the default: near-black field (`#08080a`), surfaces from `#0c0c10` to `#22222a`, hairlines at 9%/16% white, pale text, and one vermilion signal (`#ff5a36`) running to warm coral. Paper is the light alternative. Emerald marks moderators, blue marks artists, green marks equipped states.
- **Type.** One family: Noto Sans (self-hosted variable woff2 with weight and width axes, OFL) for everything — headings at 680–720 weight narrowed with `font-stretch` (86–92%) and tracking no tighter than `-.04em`; navigation, controls, and prose at 12–15px. Values, shortcuts, IDs, and timestamps use Geist Mono with tabular numerals. Bricolage Grotesque stays only as a local Studio preview-font option. Metadata and captions are Geist at 10–12px in sentence case; uppercase monospace labels were retired as a "technical" costume. Monospace is reserved for real values: numbers, IDs, paths, shortcuts, timestamps. Titles that read as sentences keep their period ("Meet the creators."); label titles do not ("Insights"). Flare previews keep their own authored font stack.
- **Surfaces.** Panels are one step above the page with a 1px hairline and a 1px inner highlight (`--shadow-inset`). Elevation belongs only to floating surfaces: menus, dialogs, toasts, back-to-top. One fixed ambient wash of accent at 5–7% sits behind the page; there is no noise texture, no frosted card, and no gradient border.
- **Shape.** 6/9/12/16/22px radii and full pills for chips and segmented controls. Controls are 32–40px tall. Media stages are 16:9 on desktop and 4:3 on phones.
- **Numbers.** A 4px spacing rhythm, 8/12/16px control gaps, 22/32px section spacing, and a 648px reading column with a 320px margin column.

## Navigation and controls

- Desktop uses a 264px sticky rail: brand, one accent-gradient **Create a Flare** action with its `N` shortcut, grouped navigation labelled Browse / Make / Learn, and the account, appearance, and demo state at the bottom. The current destination gets a surface fill and a short accent bar.
- A sticky 60px top bar spans the reading and margin columns with the current page, a centred search affordance (`Ctrl K`), appearance, and sign-in/account. Both bars use the same translucent surface token with a 1px rule, not a shadow.
- **Primary:** solid ink (cream on dark) for principal actions. **Accent:** the gradient, reserved for creating a Flare. **Secondary:** hairline outline. **Ghost:** borderless muted text. **Danger:** only for destructive moderation and removal actions. Equipping in the feed is a quiet accent outline pill that fills on hover.
- Feed tabs are a segmented pill container with an ink-filled active segment. Effect filters are pill toggles. Sorting uses the Web Awesome dropdown, search uses `wa-input`, and filters are real `wa-button` toggles so focus, clear, and pressed state share one contract.
- Web Awesome 3 is vendored in `public/vendor/webawesome` as the primitive layer and skinned through `--wa-*` tokens and `::part()`. Native dialogs, editor tabs, and the native fields the editor reads directly stay native.
- Maintain visible focus (`2px` accent, 2px offset), disabled and busy states, native dialog behaviour, keyboard editor tabs, 44px phone targets, and one icon family.

## Discovery

- The header is a single editorial block: a hairline-capped kicker, a 34–52px title, one invitation sentence, the public count, and a compact "Preview as" field. No marketing hero.
- A single quiet composer row invites creation, followed by the collection tabs, search/sort, effect filters, and a one-column feed of Flare posts.
- A post is a surface card with a creator byline and follow action, the Flare title and description, a 16:9 media stage carrying the artwork's own colour wash, a metadata row (palette, animation), then likes, sharing, wearer count, and equip. Cards lift 2px on hover; the media stage reveals an open arrow.
- The 320px margin column holds the **Style lens** (a live try-on with three presets, a name field, and pause), people to follow, and weekly trending. It is sticky and disappears below 1180px, where a compact featured-creator strip takes over.
- Mobile keeps the feed, a fixed five-destination tab bar, and a collapsible rail drawer. Search remains available in the top bar.

## Studio (2026.5)

A design tool, not a form. Only the selected thing's controls are on screen.

- **Command bar:** the Flare's name is the inline title (mirrored into the publish dialog's required name field), save state, undo/redo, Shuffle, a More menu (Import JSON, Export JSON, Start with just an image, Keyboard shortcuts), Save draft, and **Publish**.
- **Outline (left):** *Fill* lists the 1–6 layers top-first with a live thumbnail of each fill, type, opacity and blend; **+** adds a layer. *Effects* — Glow, Outline, Drop shadow, Shadow stack, 3D depth — each with an on/off switch and a value summary; switching off zeroes the value and remembers it for switching back on. *Motion & type* — Motion (animation · duration), Lettering (weight · spacing), Fallback colors (three dots).
- **Canvas (centre):** preview name, Dark/Light/Clear backdrop, pause; the magnified stage; zoom and chat-size sliders; a Preview font popover (Google Fonts search, never saved); chat at actual size; a template strip (all 8 presets, animate on hover) with Import a design file. Dropping an image anywhere on the canvas adds it as a layer.
- **Inspector (right):** a header with title and context, then only the selected item's controls. Layers: type segmented control (Linear/Radial/Conic/Solid/Image), a **gradient bar** (click to add a stop, drag stops to move, arrow keys to nudge, Delete to remove; the selected stop gets color + alpha + position), an **angle dial** (drag; Shift snaps to 15°), Smooth/Repeat bands, opacity, blend, and a *Size, position & tiling* disclosure; image layers show the drop zone and crop canvas. Motion uses five preview cards that animate on hover plus a Playback segmented control.
- **Controls share one language:** sliders with a filled track and the live value on the label line, color swatch + hex + checkerboard alpha track, segmented controls, and spring switches.
- **Publish** is a dialog: the Flare on your name at left; name, description, Public/Unlisted cards, artwork rights, submit, and the account's policy at right.
- **Responsive:** three columns above 1180px; at 1001–1180px the outline and inspector share the left column; at 1000px and below the stage is pinned and the outline, inspector, templates and chat stack, with tapping an item scrolling to its controls and an *All settings* button to return.
- Alt 1–5 jump to Fill, Effects, Motion, Lettering, and Publish. Undo/redo, drafts, JSON import/export, uploads, crop, and validation behave exactly as before.

## Profiles, account, insights, moderation

- **Profiles:** a full-width identity surface with an accent cover, avatar, name and role badges, plain-text bio, linked platforms, three public stats, and the equipped Flare stage. Creator galleries follow the identity block and use the same card vocabulary as the feed.
- **Account:** a 288px identity and actions aside with a tabbed main column (Overview, Profile, Platforms, Following). The equipped panel pairs a live stage with metadata and actions; shortcuts are three equal panels.
- **Insights:** four KPI tiles, 130px bar charts with text alternatives and tables, ranked lists, and explicit empty states. All numbers are server-derived; never fabricate a chart.
- **Moderation:** operational hierarchy — a pill navigation, four count tiles, a searchable queue, and review surfaces that pair the Flare stage with facts, feedback, and clearly separated destructive actions. Danger actions are never adjacent to approval without spacing and distinct colour.
- **Guide and Integrations:** an anchored reading column with 74ch measure and hairline separators; integrations is a two-column technical grid that stacks on phones, with compatibility limits stated plainly.

## Themes, density, and motion

- Eight coordinated themes share the same scale: **Ink** (default), **Paper**, **Sand**, **Dusk**, **Frost**, **Moss**, **Plum**, **Rose**. Each sets its own surface ramp, ink, muted text, hairlines, and accent pair. Flare artwork keeps its authored palette and must remain legible on every theme.
- Appearance is a local preference stored in `localStorage` and applied before first paint by `theme-init.js`: no flash, no layout shift. `T` cycles themes; the dialog shows named swatch cards, density, motion, and reset.
- Motion is short and directional: 180ms fades, 8px rises, one heart pop, a 2.4s live pip. Interface motion and `prefers-reduced-motion` both stop chrome animation without changing Flares. No bounce, parallax, or scroll-jacking.

## Accessibility

- Contrast: body copy ≥ 4.5:1 on every theme; muted metadata uses the `--muted` step, not the faint step, when it carries meaning. Never rely on colour alone: badges have labels, charts have tables, and empty states explain what will appear.
- Focus is always visible; dialogs trap focus natively and restore it; the skip link, landmarks, live regions, and labelled controls are preserved. Charts need text alternatives and readable tables. Reduced motion is respected in both CSS and renderer code.

## Avoid

Frosted glass cards, backdrop blur on content, decorative gradients or borders, glow text, purple-tinted chrome, fake usage figures or filler bios, nested preview cards, repeated page titles, a second marketing header, and motion that competes with the artwork. Do not copy another product's identity; once the system is in place, one accent moment per screen is enough.

## Validation

Run `npm run check` and `npm test`. Inspect rendered layouts at 1440, 1024, 768, 390, and 320px and confirm no page-level horizontal overflow. Check discovery, Studio, profiles, account, insights, moderation, guide, dialogs, filters, import/export, keyboard navigation, theme switching, and reduced motion. A screenshot of one view is not a visual review of the others.

## Toolkit research

Reviewed [Once UI](https://once-ui.com/), [shadcn/ui](https://ui.shadcn.com/), [Radix Themes](https://www.radix-ui.com/themes), [Park UI](https://park-ui.com/), [Mantine](https://mantine.dev/), [DaisyUI](https://daisyui.com/), [Web Awesome](https://webawesome.com/), [Aceternity UI](https://ui.aceternity.com/), [Magic UI](https://magicui.design/), [Tremor](https://tremor.so/), and [Geist](https://vercel.com/geist) for token, theme, density, and interaction ideas. Adopted Once UI's stepped surface model, semantic token naming, compact control sizing, and restrained ambient depth; shadcn/Radix's semantic colour roles; DaisyUI's coordinated named themes; and Web Awesome's web-component contract. Rejected React-only systems and gradient-heavy marketing cards. Nameflare remains vanilla JavaScript/CSS with **no runtime package and no build step**.

[Raycast](https://www.raycast.com/) remains the benchmark for restrained controls; [Impeccable](https://impeccable.style/) and [Vercel's documented-system approach](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md) inform the critique and documentation discipline. No external design package or skill was installed.

## Moderation workspace

- A section bar (Review queue, Accounts, Bans & team, Activity log) with an underline indicator, not pills.
- The review queue is a triage tool: status tabs with live counts, search, a sticky queue list of submissions (a paused Flare swatch, name, creator, age), and one focused review beside it. The review shows the Flare on a chat backdrop and in a chat line, collapsible facts and recipe, feedback with suggested notes, and decisions: Approve fills the row, Disapprove sits apart on the right. Keyboard: J/K or ↑/↓ move, A approves, D jumps to the feedback note.
- Accounts are dense rows (person and ID, identity chips, role/state badges, actions). Destructive actions are outlined in danger red and fill only on hover.
- The activity log is grouped by day with filter tabs (Flare decisions, Bans, Access changes) and a status-coloured dot per entry.

## Motion and performance

- Views enter with a 340ms expo-out rise; page titles and lists stagger in (capped at five steps). Only transform and opacity animate on the chrome. Reduced motion and the in-app Reduced setting remove all of it.
- Flare names stop animating when off-screen (IntersectionObserver in `renderer.js` sets `data-offscreen`; `effects.css` pauses them). Visually hidden copies never animate. No `backdrop-filter` anywhere: the top bar, mobile header, tab bar, and dialog backdrop are solid.
- The Node server serves static files from an in-memory cache with ETag revalidation (304s) and brotli/gzip, fonts as immutable, and applies the rate limiter to API, auth, and texture routes only. `index.html` preloads the critical fonts and every first-view module so the Web Awesome import chain downloads in parallel.

## Discover layouts

- Feed (one large stage per Flare) or Grid (4:3 stages, auto-fill columns of at least 260px). The choice is a per-device preference stored in `localStorage` under `nameflare.layout`; phones always use the feed.

## Frame (2026.4)

- One sticky 64px header replaces the old sidebar and page bar. Left: logomark + wordmark (and a compact demo badge in the demo). Middle: five primary destinations as text tabs — Discover, Following, Creators, Studio, Collection — plus Moderation for staff; the active tab gets a surface pill and a 2px accent underline on the header edge. Then **More**, a popover holding Insights, Account, Artists, Guide, API & overlays, Search, Appearance, Keyboard shortcuts, theme swatches, and source links. Right: search (collapses to an icon below 1500px), notifications, **Create a Flare** (icon-only between 1001–1240px), and the account avatar or Sign in.
- Content is centred at up to 1280px; Discover adds the 300–320px companion column above 1180px.
- At 1000px and below the header is a 60px fixed bar (logomark, search, account, menu). The menu opens a sheet: primary destinations as large two-column tiles, then every More item. The bottom tab bar stays.
- Pagination renders only when there is a previous or next page. Empty states are one calm panel with a heading, one line, and actions side by side; no icon tiles, eyebrows, or duplicated decoration.
- Global single-key shortcuts (N, T, G-sequences, ?, /) ignore keystrokes from any field, including Web Awesome inputs whose focus lives in a shadow root.

## Companion column (Discover, above 1180px)

Every panel shows real Flares, not just names, and uses only real data:

1. **Your chat identity** (signed in): your own name drawn in your equipped Flare (fetched by its ID), with Change/Choose. Empty state explains that the platform style is shown.
2. **Style lens**: one stage with your name in a preset, a footer with the preset name, its position (1 / 8), and an icon pause; all eight studio presets as one-tap swatches. Its name field mirrors “Preview as”, so it is not shown twice. “Open in studio” remixes the preset.
3. **Trending** with two tabs: *This week* (recent likes) and *Most worn* (equipped count). Each row: rank, a 44px tile with the Flare's first letters rendered in the Flare, name, creator, and the stat for that tab.
4. **People to follow**: each creator's name is drawn in the Flare they wear, with their Flare count and what they are wearing.
5. **Footer**: live public Flare and creator counts, then quiet links.

Rail previews stay paused and animate only on hover or focus, so the column adds no idle motion cost. The column is sticky and scrolls on its own when taller than the window.

## First paint and small details (2026.5)

- The header renders in its final shape from the first frame: `theme-init.js` applies the last-known header state (signed in, staff, demo) from `localStorage` (`nameflare.shell.v1`) before paint; `app.js` replaces it with the real state and marks `data-shell-ready`. The demo badge sits with the header actions, where the flexible search absorbs its width, so primary links never move.
- The Studio template strip has ← / → buttons that page through it and disable at the ends, a thin visible scrollbar, scroll-snapping, edge fades, and vertical-wheel-to-horizontal scrolling. Focused gradient stops also accept Home / End.
- The Guide reads as an article (hairline-separated sections, 760px column, sticky contents), and its Studio instructions match the current outline/inspector Studio.

## Discover showcase, filters, and consistent previews (2026.5)

- **Trending showcase** sits above the feed controls: up to eight large 16:9 tiles (rank badge, the Flare on your preview name, name, creator, and the week's likes or the wearer count) with *This week* / *Most worn* tabs, arrows, and scroll-snap. Clicking a tile opens its details. It stays in place while a search, effect chip, or advanced filter is active, and folds away only on Saved. A soft edge fade marks a row that scrolls further; #1's rank is set in the accent colour. The small trending list left the companion column.
- **Filters:** effect chips stay visible; the filter button opens Color (nine families plus any; the family is the hue of the Flare's first layer color, computed in SQL so pagination stays exact), Motion (flow, shimmer, pulse, spectrum, static), and Fill (gradient, solid, image/GIF). The button shows how many are active, removable pills summarise every active filter and search, and the state lives in the URL (`/discover?color=green&motion=flow`). The API accepts the same `color`, `motion`, and `fill` parameters (allowlisted) on `/api/v1/cosmetics`, likes, and the following feed, on both the Node and Cloudflare runtimes.
- **One rendering everywhere:** every Flare preview is drawn at 18px chat size in the preview font and magnified with CSS `zoom`, so glow, outline, shadows, depth, and image fills scale together and match the Studio canvas.
- **Image crop** shows the name's exact box at a larger scale with the image mapped exactly as the renderer maps it: bright inside the letters, dimmed outside. Drag to move, wheel to zoom, arrows to nudge.
- **Moderation badge** loads the pending count with the page for staff and refreshes with notifications.

## The Flare stage (2026.5)

`public/ui/stage.css` (loaded last) gives every Flare preview one material instead of blurred colour washes: a deep neutral `#0c0c0f` surface, a faint top light, a bottom vignette, an 18px dot grid, and a crisp 2px ribbon of the Flare's own palette (`--paint-color` → `--paint-secondary`) along the bottom edge. Small tiles (rail swatches, review queue, Studio templates) use the surface without the grid. The Studio canvas uses the same material without a ribbon. Light-backdrop toggles keep their own light surface. Colour belongs to the Flare; the stage never fogs it.

## Slim (2026.6)

`public/ui/slim.css` loads last and makes the whole frame quieter:

- **Cards are one surface.** The Flare stage runs edge to edge at the top of the card, with no inner border.
  - The byline is just avatar, name and time.
  - Palette dots and type badges are gone, since the ribbon already shows the colours.
  - Actions are a single compact row.
- **Discover defaults to the grid.** List view is still one tap away.
- **Discover has one toolbar plus one chip row.**
  - The pause and layout toggles sit at the end of the chip row.
  - The old "Preview settings" popover and the Refresh button are removed.
- **Page titles are 26–30px, with no rule underneath.**
- **The companion column is flat.** Sections are divided by hairlines instead of three framed cards.
- **The header is 56px and translucent.** The active nav item uses one cue (a filled pill), not a pill plus an underline.
- **Every control presses down slightly** (`scale(.97)`). Reduced motion turns this off.
- **Feed switches never pad the page with blank space.** Switching to a short feed (such as an empty Saved list) scrolls back as far as the new height allows, so the header and controls stay in view.

## Creators (2026.6)

`public/ui/profiles.css`, loaded after slim.css. A creator is their name in the Flare they wear, so that name is the hero everywhere.

- **Directory and Following cards** (`.creator-tile`): a stage showing the name in their Flare, with a small tag naming the Flare ("No Flare yet" otherwise). Below it, one identity row (avatar, name, badge, first platform, Follow) and one inline stat line. The name link stretches over the whole card; Follow and the badge sit above it. Not `.creator-card`, which is the Featured creators strip.
- **Profile page** (`.profile-hero`): a full-width banner stage with the Flare-rendered name and a "Wearing …" pill that opens the Flare. The avatar overlaps the banner edge, then name, joined date and platform chips, with Share and a filled Follow on the right. The bio and stat line sit underneath.
- Stats are `profile-stat-row` (number then label). `[data-stat]` stays on the number for live like updates.
- A profile's Flares section is titled "Flares" with no count line; the wearer count is hidden on those narrower cards.
- **Connected platforms**: `platformLink()` renders a creator's channels as pills: a logo in the platform's own colour, the handle, the platform name, and an arrow when it links out. They appear on the profile hero, creator cards (flat variant, first platform with text, others icon-only), and the Account sidebar. `platformUrl()` builds the URL only for safe shapes: twitch.tv/login, kick.com/login, youtube.com/channel/UC…; otherwise the pill is plain text. Account → Connected platforms is one grouped list with brand tiles, a Connected status, the channel link, its ID and an Open channel button. Unlinked rows are dimmed.

## Calm (2026.7)

`public/ui/calm.css`, loaded last, is a system-wide declutter based on Linear's March 2026 refresh: "structure should be felt, not seen", and secondary chrome recedes. It also follows Vercel/Geist's control language. It changes components only, never theme colours, so all eight themes keep their ramps.

- **Structure from surfaces, not outlines.**
  - Panels, info cards, Studio's outline and inspector, and the feed tab group lose their borders.
  - Inputs are filled wells that gain an outline on hover and focus.
  - Secondary buttons are filled with the next surface step (`wa-button` outlined, `.button.subtle`).
  - Follow, Equip and stage pills keep their own styles.
- **Badges and the demo state** are soft pills with no outline. The demo badge is neutral, not warning yellow.
- **Page titles are short labels** with no filler subtitle: Collection, Account, Insights, Moderation, Creators, Artists, Guide. Discover's invitation line stays for screen readers only.
- **Running counts** ("8 Flares", "4 Flares · 4 approved …", "3 profiles shown") stay as live regions for screen readers but are visually hidden.
- **Removed:**
  - Eyebrow labels on Account.
  - The Equipped / Not equipped badge.
  - The three shortcut tiles on Account.
  - The remix footnote in Flare details; its caveat is now the Remix button's tooltip, and Download JSON is an icon button.
  - The per-card Follow button in the Discover and Following feeds.
  - "Reviewed by …" on collection cards.
  - Following's "Find creators" button (still in its empty state).
- **Following** uses the same auto-fill card grid as the rest of the site.
- **Text floor:** nothing functional renders below 11px (`--text-2xs` is 11px).

### One shape system and spacing (2026.7b)

Six unrelated pill styles became three shapes, defined in `calm.css`:

- **Page tabs** (Discover feed tabs, Account tabs, Moderation sections): plain text with a 2px ink underline on the current tab. No container and no cream fill. On phones the feed tabs share the width over a hairline.
- **Toggles** (effect filters, This week / Most worn, collection and review status filters, segmented controls): 8px rounded rectangles. Hover is a 6% ink tint; active is a 10% ink tint. No outlines or shadows.
- **Badges** (Approved, Moderator, Artist, counts, review reasons): 6px tinted labels, 11px/600, no outline. "1 wearing" is plain text.
- **Card buttons:** Equip is an 8px ink-tint button that fills with the accent on hover and turns green when equipped. Follow is the same small button; Following is outlined and muted.
- **Small tags:** trending ranks are 6px dark tags (#1 has an accent underline). Platform pills, the demo badge and stage tags use the 8px radius.
- **Mobile tab bar:** the current tab is ink with a short accent bar above it, not a filled pill.
- **Shape tokens:** `--ctl-r` 8px, `--badge-r` 6px, `--tint-1/2/3` (6/10/14% ink). Full pills remain only for count dots, avatars and switches.
- **Spacing rhythm:** 4px steps, with 8/12/16 inside groups and 24/32 between them.
  - Cards have a 16px inset and grids an 18px gap.
  - The showcase has 32px below it, and companion sections 22px.
  - Page sections start 32px apart, and panels are padded 24px.

### Equipping (2026.7d)

- **One control:** every Equip button (feed, collection, details dialog) carries `data-equip-id` and is set by `syncEquipButton()`.
  - Labels are only "Equip" ⇄ "Wearing" ("Equip Flare" in the dialog), matching "Currently wearing" elsewhere.
  - The button has a fixed minimum width (108px in cards), so Like and Share never shift, and it never stretches on phones.
  - Buttons whose state didn't change keep their nodes, so a running animation never restarts.
- **Optimistic:** the change shows on click and rolls back only if the save fails. There is no spinner, and the button never looks disabled while it saves. Clicking a Flare you already wear does nothing.
- **The look uses the Flare's colours, not a system green:**
  - "Wearing" is a tint of the Flare's first colour over the surface, with a hairline of it and ink text.
  - The check is drawn in that colour.
  - The worn card's palette ribbon thickens to 3px.
- **One authored moment:**
  - The check draws itself.
  - The stage's palette ribbon fills left to right and glows once.
  - The name gets a short brightness lift.
  - The sidebar identity fades in, sharp.
  - Reduced motion turns all of it off.
- **Toasts:**
  - "Now wearing Aurora drift." — a compact bar at the bottom centre with a check or error icon.
  - One copy per message.
  - The stack is a manual popover kept open, so it stays a live region and appears above open dialogs.

## Flow (2026.8)

The site's flows were audited journey by journey: a first-time visitor, a signed-out visitor who equips, likes or follows, a creator who submits, and the review and fix loop. They were checked against Baymard's sign-in research, the Sign-In Continuity pattern, NN/g on login walls, and App Review / LINE Creators' rejection-and-resubmit guidance.

- **Sign-in continuity:**
  - Every sign-in remembers why it was asked and where from (`nameflare.intent`: kind, id, route; expires after 15 minutes).
  - After signing in (the demo picker, or a real OAuth round trip, which lands on `/account`), `resumeIntent()` returns to that page and finishes the action. Equip puts the Flare on in place; it no longer jumps to Account. Publish reopens the publish dialog. Like and follow finish as before.
  - Leaving for OAuth from Studio saves the draft first, so a design survives the round trip.
- **The sign-in dialog says why it's being asked:** "Sign in to wear it.", "Sign in to submit.", follow and like versions, and a short default.
- **Account refreshes re-sync every Equip button**, since Discover reuses cards. Switching accounts no longer shows the previous account's state.
- **Review loop:**
  - In Collection, only approved Flares show Share.
  - Needs changes shows the reviewer note as a note and a **Revise** button. `editor.revise()` reopens the design as itself (same name, description and listing, not a remix) and shows the note again in Studio.
  - The "needs changes" notification opens Collection filtered to Needs changes. The "approved" notification opens the Flare itself, ready to wear.
  - After submitting: "Submitted for review. It waits in your Collection until a moderator decides."
- **Where it shows:**
  - Account → Currently wearing says the Flare shows in Nameflare chat overlays and API apps, with "Set up an overlay".
  - The first equip's toast offers "Where it shows".
- **First visit, signed out:** one dismissible strip on Discover. 1 Try any Flare on your name · 2 Sign in with Twitch, Kick, or YouTube · 3 Wear it in Nameflare overlays. "Try your name" focuses the preview name. It hides once signed in or dismissed.
- **Signed-out Collection** opens sign-in directly, or Studio, instead of linking to Account.

## Refine (2026.11)

The last section of `public/ui/calm.css`.

- **The Flare leads.** Grid-card and trending names size by their length (`--name-scale`), so short names fill the stage and long ones still fit. A trending tile's name brightens slightly on hover.
- **Icons are Phosphor** (2.1, regular weight, MIT; licence in `public/vendor/phosphor/`), inlined as the sprite in `index.html` and served to Web Awesome by `icons.js`. They render as fills, not strokes, so never set `stroke-width` on `.ui-icon`. Heart, Discover, Creators, Studio, Collection and Account also carry Phosphor's fill weight: `--i-line: none; --i-solid: inline` (or `.is-solid`) switches to it, which the liked heart, the active Saved tab and the active mobile tab use. Resuming paused motion uses `icon-play`. The equip check reveals left to right with `clip-path`.
- **Sort** opens a menu, so its trigger ends in a down chevron. Like counts use the UI face with tabular numerals, not monospace.

## Presets and one renderer path (2026.11)

- **Presets are starting points, not finished looks.** The eight presets live in `editor.js` and are written in the Studio's own layer model. Each shows one technique:
  - Sunset fade and Aurora: a flowing gradient.
  - Neon tube: a pale core with a coloured glow and halo.
  - Liquid chrome: hard vertical bands.
  - Retro extrude: 3D depth.
  - Sticker: a white outline with a hard drop shadow.
  - Prism: a full spectrum.
  - Holo foil: a conic layer under a soft-light sheen.

  Gradients are fitted to the name (100% size), so the Studio's gradient bar shows exactly the colours on the name. The old 300%-wide legacy fill showed only a slice. Effect values are moderate, so they are easy to edit. The Style lens, the Studio template strip and Discover's starter tiles all use the same objects.
- **One renderer path.** `applyCosmetic` always paints a Flare's fill on `.nameflare-paint-layer` children, including legacy single-fill recipes. Painted as the element's own background, the fill sat beneath the `z-index: -1` shadow layer, so depth, glow and drop shadows drew over the letters. That was why the Style lens and the Studio disagreed.


## Support page (2026.11)

`/donate` is a Read-mode page: a short first-person letter, the projects donations fund, then one card per wallet. Addresses live once in `index.html`; `donate.js` draws each QR code from the same text the visitor copies (vendored MIT `qrcode-generator`, loaded only on this page), always black on white with a four-module quiet zone. Every card names its network, and a warning says that coins sent on the wrong network are lost. `test/donate.test.js` pins the exact addresses.

## Safety and data surfaces (2026.11)

Reports, moderation of reports and Account → Your data are Operate-mode screens: they reuse the panel surfaces, type scale and button styles around them and add no new colours.

- **Report dialog.** One radio card per reason, each with a one-line example, so people pick by meaning rather than by policy jargon. The selected card takes the accent outline. Details are optional. The copy says who sees the report, and that the person reported is not told who sent it.
- **Moderation → Reports.** One card per reported Flare or profile, carrying a paused preview, the count, and every report's reason and details. A single decision note serves the whole card. Dismiss is subtle; Remove and Ban are the only danger buttons, and they need a note. An optional checkbox blocks the images too.
- **Review cards.** Scanner flags and open-report counts appear as a warning strip at the top of the card, so they are seen before the decision buttons.
- **Your data.** Download comes first, then the retention table, then deletion in its own outlined panel. The delete button stays disabled until the account name is typed exactly.
