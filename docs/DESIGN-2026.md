# Nameflare / Red ink — 2026 UI specification

## Product truth

Nameflare is B_X_N_E's independent animated-name Flare studio and community collection. Visitors discover, preview, remix, submit, and equip original Flares. Twitch, Kick, and YouTube identities can be linked when enabled; Flares appear only in supported integrations, not native platform chat. Real accounts and staff permissions must remain unchanged.

## Direction

A type-led creative studio, not a technical dashboard or a generic SaaS landing page. Crimson is the brand color; Flare palettes belong to the artwork. Discovery is an **Experience** surface, the editor/accounts/moderation are **Operate**, and the guide is **Read**.

Guidance inspected directly from [Impeccable](https://impeccable.style/), its [skill](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md), and [craft floor](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/reference/craft-floor.md). This is a manual application of that guidance, not a claim that its CLI, hooks, or detector have been installed or run.

## Visual rules

- Ink is the default material: warm near-black surfaces, pale text, hairline rules, one vermilion signal. Paper is the light alternative. An editorial serif carries page titles and the wordmark; native sans carries navigation, controls, and body text. Bricolage Grotesque remains a local preview-only font for the studio and never changes a Flare recipe.
- No glass, frosted panels, decorative gradients, fake status dots, nested preview cards, or repeated icon tiles. Gradient text remains essential inside the actual Flare renderer. Small uppercase labels are reserved for real rail sections and metadata.
- Desktop uses one sticky top header: brand, five primary destinations (plus Moderation for staff), a More menu for secondary pages and settings, then search, notifications, **Create a Flare**, and the account. Mobile uses a 60px header with a full menu sheet above a fixed five-destination tab bar. See DESIGN.md → Frame.
- Compact discovery header: one title row with the live community context and public count, then a one-line invitation. The companion rail opens with a live, borderless name preview and three working preset pills. No marketing hero or chat-card chrome.
- The collection is a single-column social feed. Each post has a creator byline, a 16:9 media stage, real style metadata, a caption, then a like action, wearer count, and a quiet accent outline equip pill. Desktop creator discovery lives in the companion rail while filters stay in the feed; mobile keeps a compact featured-creator strip.
- Web Awesome is the primitive layer, vendored in `public/vendor/webawesome`. Buttons, search, the sort dropdown, filter chips, generated actions, and the try-on field are real framework elements skinned through `--wa-*` tokens. Native dialogs and editor tabs remain where their tested behavior is the better primitive. There is no runtime package or build step.
- Accounts/moderation retain calm forms, distinct states, real counts, and clear destructive-action wording.
- Heading tracking no tighter than −0.06em. Readable text measure and visible native focus/caret/selection. Test long names and narrow widths.

## Motion

Feed posts enter with a short, staggered opacity/translate settle (capped at five steps). The collection selector has a sliding underline, the like control has a contained heart pop, toasts reveal a quiet life bar, and navigation uses the View Transitions API when available. The try-on Flare motion is visibility-gated and stops with reduced motion; preset switching cancels previous transitions. Tabs and the Web Awesome menu share the same short easing family. No identical scroll reveal on every section, blocking intro, or elastic/bounce motion.

Reduced motion removes card entrances, tab-indicator transitions, the rail shimmer, page transitions, and the mobile tab press scale. Flare renderers fall back to their static fills.

## Font provenance

Page titles use the platform serif stack (Iowan Old Style / Palatino / Georgia) with no network font. Bricolage Grotesque by the Bricolage Grotesque Project Authors, retrieved from [Google Fonts' distribution](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque) with user permission, remains a local studio preview option. The original variable TTF is served with `font-display: swap`; the SIL Open Font License remains in `public/fonts/OFL.txt`. No font CDN, external script, or new runtime dependency.

## Verification

- Preserve editor selectors/routes, authentication, moderation, likes/follows, and API compatibility.
- Run syntax checks, automated tests, and Worker build dry run.
- Inspect desktop/mobile discovery, studio, account, creator directory, and moderation. Check name input, preset remix, pause, quick navigation/search, menus, reduced motion, loading/errors, console, and document overflow.
- Local demo only. Production deployment is not authorized by this visual change.
