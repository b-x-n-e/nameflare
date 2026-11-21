# Nameflare for Moltorino

Shows Nameflare Flares on usernames in [Moltorino](https://github.com/EEVA-inc/Moltorino),
the Chatterino7 fork, for Twitch and Kick chat. A Flare is drawn through
Moltorino's existing name-paint pipeline (the one 7TV paints use), so it sits
with the rest of the client: the nametag, its tooltip, the user card and the
paint settings.

## What it does

- Every chat message reports its sender's platform user ID. IDs are looked up
  in batches of up to 100 with the public `POST /api/v1/resolve` endpoint
  (no key, CORS-free), about once per 750 ms while chat is moving.
- Results are cached for 15 seconds, as the [API contract](../../docs/API.md)
  requires, and re-checked the next time that person speaks. A failed lookup
  keeps what is shown and backs off (5 s, doubling to 2 min).
- A Flare is shown instead of a 7TV paint when someone has both. Turning
  **Settings → General → Display Nameflare Flares** off brings 7TV paints
  back; the 7TV setting is untouched.
- Textures are only ever fetched from the configured Nameflare origin
  (`/misc/nameflareOrigin`, default `https://nameflare.bxne.dev`), and only
  for well-formed texture IDs.

## How a Flare maps onto a Moltorino paint

Every visible layer is drawn, bottom to top, the way the site's CSS renderer
does it: each layer is sized to its `size` (percent of the name), placed at
its `at` position, tiled by `canvasRepeat`, faded by `opacity` and combined
with its `blendMode` (normal, multiply, screen, overlay, soft light).

| Flare | Moltorino |
|---|---|
| Image and GIF layers (PNG, WebP, JPEG, GIF) | loaded with Moltorino's own image loader (the one emotes and 7TV image paints use), drawn at the crop set in Studio, GIFs animated frame by frame; the plain name shows until the image arrives |
| Linear, radial, conic gradients; solid fills; the legacy palette | gradients in the name box (Qt has the conic gradient 7TV paints lack) |
| Flow and Shimmer | the gradient slides by one closed period per cycle (`speed`, `direction`), as on the site; follows the *Animate GIFs* setting |
| 3D depth, outline, glow, drop shadow, extra shadows | drop shadows, applied in the web renderer's stacking order, capped at 14 blur passes |
| Pulse, Spectrum | static |

Layers with zero opacity are skipped, as on the site. A malformed texture
ID is never fetched; that layer is left out and the name falls back to the
Flare's palette.

## Files

- `src/providers/nameflare/NameflarePaint.{hpp,cpp}`: the paint: layer compositing, images, motion.
- `src/providers/nameflare/NameflarePaints.{hpp,cpp}`: lookup, cache and
  recipe parsing; `usernamePaint()` is what the renderer asks.
- `tests/src/NameflarePaints.cpp`: recipe → paint, colours, effects cap,
  texture validation, layer size/position/tiling/stacking, images drawn at
  their crop, motion timing.
- `moltorino-nameflare.patch`: all of the above plus the small hooks in
  Moltorino's own files (settings, settings page, Twitch and Kick message
  builders, the nametag renderer and the user card).

## Applying it

From a Moltorino checkout:

```sh
git apply /path/to/nameflare/integrations/moltorino/moltorino-nameflare.patch
```

Then build as usual (see Moltorino's `BUILDING_ON_*.md`).
