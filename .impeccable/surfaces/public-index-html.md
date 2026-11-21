---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Discover (and the site frame)

Scope: Discover first, then the frame and every other page in the same world. Mode: Experience (a gallery where the artwork leads), Operate rules for Studio and Moderation.
Audience: chatters picking a look, often arriving from a stream link, often on a phone. Job: find a Flare, see it on their own name, equip it.
Constraints: vanilla JS/CSS, no build; the Flare renderer is untouchable; the logo (navy N over flame) stays as is; eight themes plus custom remain user options.
Research (Nov 2026): Astryx (Meta), Linear, Raycast, Material 3 Expressive, shadcn/coss/Catalyst/Park/Radix/Untitled/HeroUI/Base UI, Geist, Spectrum 2, Once UI, 7TV. Lesson: restraint in chrome, one characterful face, disciplined radius/shadow/hue tiers, and art-directed content carry the quality; the grey-SaaS look and gamer neon are the two ruts.

## Direction contract

THESIS: Discover is a gallery where every Flare is shot like product photography: big, on a chat-dark plate, captioned underneath, in a calm light room. It refuses the dark neon card grid with dot-grid stages and identical bordered boxes.
OWN-WORLD: A near-neutral light room (#F4F4F2 page, #FFFFFF raised), ink #111113, secondary #5E5E66, no hairline borders on content; depth from three soft shadow tiers; radius tiers 10 / 14 / 24; plates are chat-dark (#0E0E10) with a faint top light; the logo's flame orange is the only accent, on Create and the current state. Type: Mona Sans, expanded and heavy for headlines, normal width for UI; Mona Sans Mono for numbers.
STORY: A chatter lands, types their name once, scrolls a gallery of their name in every Flare, opens one, and equips it.
FIRST VIEWPORT: Header (logo, nav, search, Create). A title row: "Find your Flare" in expanded display type at left, the name field large at right. Then the trending row: large plates with big mono rank numerals, about 2.5 visible. Filters sit below as quiet text toggles, then a three-up gallery of plates with captions (name, creator, likes, Equip).
FORM: Grounded direction chosen by the user after research ("Gallery, light"), outside the dealt roll. seed: 8f5b981499fc8564. Signature interaction: the name field re-sets every plate live; plates animate only on hover or focus. Motion grammar: short exponential ease-out, plates lift by shadow not translation.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
