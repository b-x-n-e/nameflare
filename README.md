# Nameflare

**Animated name cosmetics for stream chat.** Design a *Flare* (a gradient,
image, glow or 3D style for your name), wear it with your Twitch, Kick or
YouTube name, and share it with your community. Free to make, free to wear,
and open source.

[Live site](https://nameflare.bxne.dev) · [Feature reference](docs/FEATURES.md) · [API](docs/API.md) · [Support the project](https://nameflare.bxne.dev/donate)

---

## Why Nameflare

Your name is the first thing people see in chat. Nameflare lets anyone make it
their own without a subscription:

- **Make a Flare in the studio.** Layer gradients, solid colours and images
  (including animated GIFs), then add glow, outlines, shadows, 3D depth and
  motion. Start from one of eight presets or from a blank canvas, and preview it
  at real chat size.
- **Get it approved.** Moderators review every new Flare for artwork rights,
  readability and safety before it goes public.
- **Wear it.** Equip any approved Flare. It shows up wherever Nameflare is in
  chat: the OBS overlay, and apps and bots built on the API.
- **Share it.** Browse, like and follow creators in Discover, and share any Flare by link.

## Highlights

| | |
|---|---|
| **Studio** | Up to six layers, 2–12 colour stops per gradient, image fills (GIF, PNG, WebP, JPEG, BMP) with crop and zoom, glow, outline, shadow stacks, 3D extrusion, four motion styles, undo/redo, local drafts, and Flare file import/export |
| **Community** | Discover with search, filters and trending, likes, follows, creator profiles, an Artists showcase, notifications, creator insights, and eight themes plus your own custom one |
| **In chat** | A public JSON API (Flares, wearers, live stats, profiles and linked accounts), a change feed, a drop-in browser SDK, an OBS overlay, and relay rooms for Kick, YouTube and other chats |
| **Safety** | Moderator review, abuse reports, bans, images decoded and rebuilt on upload, optional malware and content scanning, and an exportable activity log |
| **Privacy** | No passwords or platform tokens stored, privacy-friendly page counts, published retention periods, and self-service data download and account deletion |
| **Runs small** | One Node process with SQLite and no runtime dependencies. Sized and load-tested for a 1 GB Oracle Always Free instance |

The [feature reference](docs/FEATURES.md) lists everything in detail.

## Try it

You need Node 22.13 or newer (Node 24 recommended). There is nothing to install.

```sh
git clone https://github.com/b-x-n-e/nameflare.git
cd nameflare
npm run demo
```

Open http://localhost:3000 and use **Sign in** to switch between the sample
Creator, Moderator and Owner accounts. The demo has its own data folder, only
listens on your machine, and has real sign-in turned off.

```sh
npm test          # the test suite
npm run check     # syntax check of every script
```

## Bring Flares into chat

- **OBS overlay.** Add `/overlay?channel=yourchannel` from this site as a Browser
  Source. It reads public Twitch chat and draws each chatter's Flare.
- **Relay rooms.** For Kick, YouTube or anything else, create a relay room.
  Your connector posts chat messages to it, and your private overlay link shows them.
- **API and SDK.** Approved Flares are public JSON with CORS. Look people up by
  platform ID one at a time or 100 at a time, list who is wearing a Flare, read
  live stats, follow the change feed, and render with the same renderer the site
  uses. See the [API guide](docs/API.md).

Nameflare is its own format. Twitch, Kick and YouTube do not show Flares by
themselves, and stock Chatterino needs an adapter.

## Run your own server

The official service runs on an Oracle Always Free E2.1.Micro with Node, SQLite
and nginx.

| Guide | Covers |
|---|---|
| [Oracle runbook](docs/ORACLE.md) | Server setup, TLS, OAuth apps for Twitch, Kick and YouTube, the systemd service |
| [Operations](docs/OPERATIONS.md) | Deploys, nightly backups and restore, upload scanning, reports, retention, edge rate limits, load testing |
| [Deployment notes](docs/DEPLOYMENT.md) | Topology and reverse-proxy checklist |
| [Security](SECURITY.md) | Controls and known limits |
| [Privacy](docs/PRIVACY.md) | What is stored, for how long, and how people get or delete it |

Copy `.env.example` to `.env`, then fill in:

- the OAuth credentials;
- `OWNER_TWITCH_ID`, your numeric Twitch ID, which makes you the owner;
- `PUBLIC_BASE_URL`;
- `SOURCE_URL`, pointing at your public repository (required by the license).

Then `npm start`. A Cloudflare Workers port also lives in `cloudflare/`, but it
lacks the newer safety features and is not used in production
([notes](docs/CLOUDFLARE.md)).

## How the code is laid out

```
server.js        HTTP server: pages, API, uploads, overlay relay, rate limits
lib/             store.js (SQLite), images.js (upload decoder), media.js (scanners),
                 backup.js, oauth.js, cosmetics.js (validation)
public/          the web app: app.js, editor.js (studio), renderer.js + effects.css
                 (how Flares are drawn), client.js (SDK), overlay.*, ui/*.css
scripts/         backup, restore, precompress, loadtest, edge limit check, font catalog update
test/            node:test suites
docs/            guides above, plus oracle/ (nginx, systemd units)
cloudflare/      optional Workers + D1 port
```

There is no build step: the browser loads the files in `public/` as they are.
The design language is in [DESIGN.md](DESIGN.md).

## Contributing

Issues and pull requests are welcome.

- Add tests for changes that touch moderation, identity linking, uploads,
  rendering or what the API publishes.
- Keep secrets, real user data and private artwork out of examples, issues and
  fixtures.
- Report security problems privately, not in public issues (see [SECURITY.md](SECURITY.md)).

## Support

Nameflare and its sibling projects are free and built independently. If they
are useful to you, [donations](https://nameflare.bxne.dev/donate) keep them
online and in development.

## License

[GNU AGPL v3.0 only](LICENSE). If you run a modified version for others, you
must offer them its source. Creators keep the rights to their artwork; the
software license grants none. The Nameflare name and the official API are not
covered by the license.

Nameflare is not affiliated with Twitch, Kick, YouTube or Chatterino.
