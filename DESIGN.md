# Nameflare design

## Purpose

Nameflare is a public collection and a creative tool for animated name styles, called **Flares**. Most visitors are chatters who arrive from a stream, often on a phone, and want to find a Flare, see it on their own name, and equip it within a minute. Studio serves the smaller group who make Flares; Moderation serves staff. Product facts live in `PRODUCT.md`.

## World: Gallery (2026.11)

Discover is a gallery where every Flare is shown like product photography: big, on a chat-dark plate, captioned underneath, in a calm light room. The chrome recedes so the artwork leads.

It replaced the earlier dark "product studio" (neon on near-black, dot-grid stages, bordered cards). **Every theme now shares this one look; a theme only supplies colour.** The default is **Ink**, the same gallery in a dark room; **Gallery** is the light room. Research behind the choice (Nov 2026): Meta's Astryx, Linear, Raycast, Material 3 Expressive, Geist, Spectrum 2 and the shadcn family (coss, Catalyst, Untitled UI, HeroUI, Base UI). The lesson was that quality comes from restraint in the chrome, one characterful typeface, disciplined radius, shadow and hue tiers, and art-directed content. The two ruts to stay out of are grey SaaS and gamer neon.

### Room

Values below are Gallery (light) / Ink (dark, default).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F4F2` / `#0B0B0C` | the page: near-neutral, neither warm nor blue |
| `--surface` | `#FFFFFF` / `#161618` | panels, fields, buttons that sit on the room |
| `--ink` / `--muted` / `--faint` | `#111113` / `#5E5E66` / `#6C6C74`; dark `#F4F4F2` / `#A3A3AA` / `#8E8E96` | text; `--faint` passes 4.5:1 on the surface |
| `--accent` | `#F15A20` | the logo's flame orange; the only accent |
| `--g-plate` | `#0E0E10` / `#111113` | every Flare stage |

- **No hairline borders on content.** Depth comes from three soft shadow tiers. `--shadow-1` is a 1px ring plus a 2px soft shadow, for anything resting on the room. `--shadow-2` is a lifted shadow, for hover and open states. `--shadow-pop` is for menus and dialogs.
- **Radius tiers:** 10px for inner controls, 14–16px for elements (plates, fields, disclosures), 24px for containers (rail panels, page panels). Pills (999px) are reserved for buttons, toggles, chips and the header search.
- **Accent budget:** Create a Flare (the orange gradient pill), Follow on a profile, focus rings, and the active marker on the phone tab bar. Primary buttons are solid ink. Never use orange for decoration.

### Plates

Every Flare is drawn on one object: a chat-dark plate with a faint top light. The background is `radial-gradient(120% 70% at 50% -10%, rgba(255,255,255,.07), transparent 60%)` over `--g-plate`, plus a 4% inner ring. There is no dot grid, stripe or border.

- One selector list covers all stages: `.card-preview`, `.showcase-stage`, `.detail-stage`, `.equipped-stage`, `.rail-identity-stage`, `.profile-stage`, `.notfound-stage`, `.review-preview` and `.pub-preview`. It is prefixed `:is(#main-content, body)` to outrank `stage.css`.
- Plates lift by shadow on hover and focus, never by translation.
- A Flare is authored for dark chat. Where a Flare-styled name sits inline on a light surface, it is wrapped in a `.flare-chip`, a small plate of its own. `fitFlare` measures the box around the chip, not the chip itself. Product CSS never restyles the Flare element.

### Type

- **Mona Sans** (GitHub, OFL 1.1) is self-hosted as a Latin subset. It is a variable font, width 100–125% and weight 400–800, 102KB.
  - **Headlines:** 800 weight at 125% width, with tight tracking. "Find your Flare" is `clamp(38px, 4.6vw, 62px)`; working pages use `clamp(30px, 3vw, 40px)`.
  - **UI:** normal width, 560–650 weight.
- **Mona Sans Mono** is used for numbers only: counts, ranks, stats and keyboard keys.
- **Minimum sizes in Gallery:** `--text-2xs` 11px, `--text-xs` 12px, `--text-sm` 13px.

## Surfaces

- **Header:** logo and lowercase wordmark, then the nav (the current page is a white pill with `--shadow-1`), then a white pill search, the orange Create pill, and the account.
- **Discover, first viewport:**
  - The title sits at the left; the 52px "Try your name" pill field sits at the right.
  - Next comes Trending: large 16:10 plates, about 2.5 visible on desktop and 1.2 on phones, with 30px mono rank numerals and a This week / Most worn pill toggle.
  - Below that, the feed tabs, search and sort, then the filter pills (the active one is ink), then a three-up gallery.
- **Gallery card:** a 4:3 plate, then the title (16px/650), then a single row with the creator and time on the left and More, like and the white Equip pill on the right. There is no box around the card. Share lives in the More menu. Each preview shows the Flare's own name until the visitor types theirs; typing re-sets every plate live.
- **Companion column:** white 24px-radius panels for Your chat identity, Style lens and People to follow, ending with the live counts.
- **Working pages** (Account, Collection, Following, Insights, Moderation, Guide, Integrations, Support):
  - White panels on the room. Fields are white with the `--shadow-1` ring; hovering darkens the ring, and focus adds an orange ring.
  - Wells inside panels (chart empty states, the profile preview, the API base URL) use the room colour with no border.
  - Code blocks are dark plates.
  - Disclosures (Guide FAQ, moderation checklist) are white cards that lift when open.
- **Studio** keeps its three-column workspace in the same materials. Panels are white, the canvas and chat preview are plates, and the template strip shows plates with captions.
- **Phone:** the tab bar is an opaque shelf (97% plus blur) so plates never show through. The first-run steps drop their second "Try your name" button because the field sits directly above.
- **Site footer:** under every page except Studio. It holds the mark, a one-line description, Explore / Learn / Project columns, then ownership and licence.
- **404 page:** "404" drawn in the Sunset fade preset on a plate, plus the failed address and Go to Discover / Search. Unknown pages return status 404, and the guessable aliases redirect with 301.

## System: one set of parts (2026.11)

`public/ui/system.css` loads last. It is where every control gets its shape. Before it, the site rendered 49 distinct button styles (heights from 24 to 40px, 8 radii, 4 weights) from twelve layered stylesheets; there are now a handful, each with a reason.

- **Buttons.**
  - **Sizes:** two. 36px is the default; 32px for anything in a row of other controls (card actions, rails, chips, toolbars). All are pills with 600-weight Mona Sans, 14px or 13px.
  - **Colour:** comes from per-element variables (`--_bg`, `--_ink`, `--_sh` and their hover twins), so a variant is a one-line rule.
  - **Variants:**
    - secondary (white with the hairline ring) is the default;
    - primary is ink;
    - ghost is transparent and muted;
    - accent is the flame gradient, for Create, Publish, Submit and Follow on a profile only;
    - danger is red.
  - **Icon-only buttons** are circles.
  - **Width:** buttons size to their label and never stretch across a panel.
- **Segmented control.** One control for every either/or choice: a tinted track with a white thumb.
  - Trending's This week / Most worn, Studio's Dark/Light/Clear, Type and Bands, the moderation status tabs, account filters, the layout toggle, and the Appearance density and motion settings.
- **Chips.** Stackable filters are 32px pills that turn ink when active.
- **Menus.** Web Awesome dropdowns, the More menu, row menus and Studio's menu share one panel: white, 14px radius, the pop shadow, 36px items with 16px icons.
  - Card menus open toward whichever side of the card has room.
- **Dialogs.** 24px radius, no border, one 36px circular close button (light-on-dark on the Flare detail plate).
- **Badges.** One 22px soft pill.
- **Rules for the layer itself:**
  - `display` is declared at zero specificity (`:where`), so any older rule that hides a control still wins.
  - Entry animations use `fill-mode: backwards`. A leftover identity `transform` on a page section made it the containing block for floating menus and dialogs.

## Files

- `public/ui/tokens.css`: type, the colour scales for every theme (the `gallery` block included), shape, elevation and motion.
- `public/ui/kit.css`, `frame.css`, `shell.css`, `views.css`, `studio.css`, `admin.css`, `profiles.css`, `stage.css`, `slim.css`, `calm.css`: the component kit and page layouts shared by all themes, in load order.
- `public/ui/system.css`: the component system above; loads after gallery.css and applies to every theme.
- `public/ui/gallery.css`: the gallery look for every theme. Rules are prefixed `:root[data-theme]` to keep the weight they need over the older layers. Where an older rule carries an ID, Gallery rules prefix `#main-content` rather than reach for `!important`.
- `public/effects.css`, `public/renderer.js`: the Flare renderer. Never skin these from product CSS; a Flare's colours and motion are authored data.

## Themes, density, and motion

- **Ink** (dark) is the default for new visitors, set in `theme-init.js` and `preferences.js`. Gallery, Paper, Sand, Dusk, Frost, Moss, Plum and Rose remain choices in Appearance, alongside the custom theme. A stored choice always wins.
- **One look, every theme.** gallery.css and system.css apply to all themes. A theme block in tokens.css sets only colour (`--bg`, surfaces, `--ink` scale, `--accent`, status colours). The section "One look, every theme" in tokens.css derives the rest at zero extra specificity: tints, ring shadows, `--on-ink` (text on filled ink buttons), `--ink-hover`, `--on-accent`, the accent gradient and hover, `--on-danger`, `--lift`, `--backdrop` and the plate. Dark rooms (Ink, Dusk, Moss, Plum, dark custom) get black shadows, light rings and dark text on ink buttons.
- Never write `#fff` or a fixed ink colour in product CSS for text on a filled control; use `--on-ink`, `--on-accent` or `--on-danger`. Light-on-plate colours (the plate is always dark) are the exception.
- Compact density sizes Web Awesome buttons only through `--wa-form-control-height`.
- Motion uses short exponential ease-out. Plates animate only on hover or focus. Reduced motion stops chrome animation without changing Flares. There is no bounce, parallax or scroll-jacking.

## Accessibility

- Body copy is at least 4.5:1 on every theme. Muted metadata uses `--muted` when it carries meaning.
- Focus is always visible: a 2px accent outline, offset 2px.
- Touch targets are 44px on phones. Moderation keeps its keyboard shortcuts.
- Never rely on colour alone: badges have labels, charts have tables, and empty states explain what will appear.

## Avoid

- **Chrome:** hairline-bordered cards, nested cards, dashed empty-state boxes, eyebrows above headings, monospace as decoration, glass or blur on content (the phone tab bar's blur is functional), gradient or glow text in the interface.
- **Colour:** orange used for anything but the accent budget.
- **Flares:** a Flare drawn directly on white.
- **Content:** invented numbers, testimonials or partner logos.

## Validation

1. Run `npm run check` and `npm test`.
2. Inspect each page at 1440, 1024, 768, 390 and 320px. Confirm there is no page-level horizontal overflow, using `document.documentElement.scrollWidth` against the viewport.
3. Check Discover, Studio, profiles, Account, Insights, Moderation, Guide, Integrations, Support, the 404 page, dialogs, filters, keyboard paths, theme switching and reduced motion.
4. Check at least one non-Gallery theme after any change to the shared files.
5. When screenshotting through the demo server, batch several captures per page load. The demo rate-limits GETs.
