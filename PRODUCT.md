# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: chatters picking a look.** Viewers who chat on Twitch, Kick or YouTube. They arrive from a stream or a shared link, browse Flares, try them on their own name, and equip one. Visits are short and casual; most never open Studio.
- **Secondary: Flare designers.** People who build Flares in Studio and publish them; they care about their profile, likes and wearers.
- **Secondary: streamers.** They add the overlay or an API-based bot so their chat shows Flares.
- **Staff:** the owner and moderators review submissions, reports and accounts.

## Product Purpose

Nameflare lets anyone give their chat name an animated style (a *Flare*: gradient, image, glow, outline, shadow, 3D depth, motion), wear it across Twitch, Kick and YouTube, and share it. Success is a chatter finding a Flare they like and wearing it within a minute, and designers seeing their work worn.

## Positioning

Free to make and free to wear, open source (AGPL-3.0), and platform-independent: one Flare follows the person across Twitch, Kick and YouTube wherever Nameflare is in chat (OBS overlay, API apps and bots). Every public Flare is reviewed by a moderator.

## Operating Context

- Chatters usually come from a stream, often on a phone, often with the stream playing in another tab or window.
- Flares show in chat at about 18px through the OBS overlay and API clients; the site previews them magnified and at real chat size.
- Sign-in is OAuth with Twitch, Kick or YouTube only; no passwords.
- Staff work in a moderation queue with keyboard shortcuts.

## Capabilities and Constraints

- Vanilla JavaScript and CSS with no build step and no runtime dependencies; Web Awesome 3 is vendored as the component primitive layer. One Node process with SQLite; a Cloudflare Worker runtime mirrors it.
- The Flare renderer (`public/renderer.js`, `public/effects.css`) draws authored data; product CSS never restyles a Flare.
- Features: Discover (search, filters, trending, likes), Following, Creators and Artists, profiles, Studio (layers, effects, motion, import/export, drafts), Collection (submission status), Account (profile, linked platforms, data export and deletion), Insights, Moderation (queue, reports, accounts, bans, activity log), Guide, Integrations & API, Support page, notifications, eight themes plus a custom theme, compact density, reduced motion.
- Nothing about the page structure, routes or navigation is fixed; every feature must keep working.

## Brand Commitments

- Name: Nameflare; wordmark is lowercase "nameflare".
- Logo: `public/logo.svg` (navy "N" over a red-orange-gold flame) is kept as is.
- A Flare is always called a Flare.

## Evidence on Hand

- Real product content: README.md, docs/FEATURES.md, docs/API.md, the in-app Guide.
- The demo (`npm run demo`) seeds sample Flares and three accounts (creator "lumi", moderator "nova", owner "orbit"); they are demonstration data, not real users.
- No user counts, testimonials, press or partner logos exist; none may be invented.

## Product Principles

1. The Flare leads: artwork is the content, chrome stays out of its way.
2. Try before you sign in: anyone can preview any Flare on their own name.
3. Honest and safe: reviewed artwork, plain privacy, no invented numbers.
4. Small and open: runs on a small server, no paywalls, source available.

## Accessibility & Inclusion

Visible focus, keyboard paths (including moderation shortcuts), reduced motion that stops chrome animation, readable contrast on every theme, and 44px touch targets on phones.
