"""Crimson Overload: a red-and-black Nameflare GIF made for the inside of letters.

No picture: everything is sized to read inside a letter stroke and loops
seamlessly (every time term is an integer multiple of the loop).
  1. molten flow   red current rising through the letters, black veins, hot crests
  2. light sweep   a diagonal white-hot shine crossing the whole name once per loop
  3. arcs          horizontal lightning flickering through the word
  4. embers        sparks rising inside the strokes
  5. screen        bloom, scanlines, a heartbeat pulse and a one-frame glitch
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 512, 128          # a name's shape (about 4:1), so nothing stretches
SS = 2
FRAMES = 40
DELAY = 40               # 1.6 s loop
TAU = 2 * math.pi
rng = np.random.default_rng(31337)

C = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
BLACK = C("#0c0006")
SHADE = C("#6e0416")
RED = C("#e00020")       # the avatar's red
NEON = C("#ff2846")
HOT = C("#ff8a9a")
WHITE = C("#fff2f4")


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


ARCS = []
for k in range(3):       # three arcs, each with its own path and moment
    xs = np.linspace(-20, W + 20, 26)
    ys = H * (0.32 + 0.36 * rng.random()) + np.cumsum(rng.normal(0, 7, len(xs)))
    ys = np.clip(ys, 14, H - 14)
    ARCS.append((xs, ys, k / 3 + rng.uniform(-0.05, 0.05)))
EMBERS = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.0, 2.4), int(rng.integers(1, 3)), rng.uniform(0, 1))
          for _ in range(55)]


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def frame(i):
    t = i / FRAMES
    w, h = W * SS, H * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x, y = xx / SS, yy / SS

    # 1. Molten flow, rising: warped sines.
    # Every time term is a whole number of cycles per loop, so frame N equals frame 0.
    # Positive phase on a y term moves that wave upward: the current rises.
    u = x / 26 + 0.9 * np.sin(y / 17 + TAU * t + 1.3 * np.sin(x / 41 + TAU * t))
    v = y / 15 + 0.8 * np.sin(x / 23 - TAU * t)
    f = (np.sin(u + v + TAU * t) + 0.7 * np.sin(1.7 * u - 0.9 * v + 2 * TAU * t)
         + 0.5 * np.sin(2.9 * v + 0.6 * u + 3 * TAU * t)) / 2.2
    heat = ss(-0.7, 0.9, f)
    vein = np.exp(-(np.sin(u * 0.9 + v * 0.6 + TAU * t) / 0.16) ** 2)
    rgb = SHADE + (RED - SHADE) * heat[..., None]
    rgb += (NEON - RED) * ss(0.55, 0.9, heat)[..., None]
    rgb += (HOT - NEON) * (ss(0.85, 1.0, heat) * 0.8)[..., None]
    vein = np.exp(-(np.sin(u * 0.9 + v * 0.6 + TAU * t) / 0.13) ** 2)
    rim = np.clip(np.exp(-(np.sin(u * 0.9 + v * 0.6 + TAU * t) / 0.34) ** 2) - vein, 0, 1)
    rgb = rgb + (NEON - rgb) * (rim * 0.55)[..., None]           # cracks glow at their edges
    rgb = rgb * (1 - vein[..., None] * 0.75) + BLACK * (vein[..., None] * 0.75)

    white = np.zeros((h, w))
    glow = np.zeros((h, w))

    # 2. Light sweep: a slanted band crossing the name once per loop.
    pos = -0.35 + 1.7 * t                      # in name widths, enters left, leaves right
    d = (x - y * 0.45) / W - pos
    white += np.exp(-(d / 0.018) ** 2) * 0.95
    glow += np.exp(-(d / 0.07) ** 2) * 0.7

    # 3. Arcs: each one strikes for a few frames, jittering while it lives.
    for xs, ys, moment in ARCS:
        age = (t - moment) % 1.0
        if age > 0.09:
            continue
        on = 1 - age / 0.09
        jit = np.random.default_rng(1000 * (i % FRAMES) + int(moment * 997)).normal(0, 3.5, len(ys))
        dist = np.full((h, w), 1e9)
        for j in range(len(xs) - 1):
            dist = np.minimum(dist, seg_dist(x, y, xs[j], ys[j] + jit[j], xs[j + 1], ys[j + 1] + jit[j + 1]))
        white += (1 - ss(1.0, 2.6, dist)) * on
        glow += np.exp(-(dist / 9) ** 2) * on
        rgb = rgb * (1 - ((1 - ss(2.6, 6, dist)) * (ss(1.0, 2.6, dist)) * on * 0.7)[..., None]) + \
            BLACK * ((1 - ss(2.6, 6, dist)) * ss(1.0, 2.6, dist) * on * 0.7)[..., None]

    # 4. Embers rising (integer laps per loop), twinkling.
    for ex, ey, size, laps, ph in EMBERS:
        py = (ey - t * laps * H) % H
        px = ex + 5 * math.sin(TAU * (t * laps + ph))
        edge = math.sin(math.pi * py / H) ** 0.6
        k = np.exp(-((x - px) ** 2 + (y - py) ** 2) / size ** 2) * (0.55 + 0.45 * math.cos(TAU * (2 * t + ph))) * edge
        white += k * 0.9
        glow += k * 0.5

    rgb = rgb + NEON * np.clip(glow, 0, 1.4)[..., None] * 0.5
    rgb = rgb + (WHITE - rgb) * np.clip(white, 0, 1)[..., None]
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)

    # 5. Screen: bloom, heartbeat, scanlines, glitch.
    arr = np.asarray(img).astype(float)
    bright = np.clip(arr - 175, 0, 255).astype(np.uint8)
    arr += np.asarray(Image.fromarray(bright).filter(ImageFilter.GaussianBlur(4))).astype(float) * 0.7
    beat = 1 + 0.12 * math.exp(-((t - 0.5) / 0.04) ** 2) + 0.07 * math.exp(-((t - 0.62) / 0.04) ** 2)
    arr *= beat
    arr[1::3] *= 0.88
    if i % FRAMES == FRAMES * 3 // 4:
        g = np.random.default_rng(7)
        for _ in range(6):
            y0 = int(g.integers(0, H - 10)); hh = int(g.integers(3, 10)); dx = int(g.integers(-24, 24))
            arr[y0:y0 + hh] = np.roll(arr[y0:y0 + hh], dx, axis=1)
            arr[y0:y0 + hh, :, 1:] *= 0.4
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def preview_text(frames, path, text="B_X_N_E"):
    """Fill the name with chosen frames, large and at chat size, on chat dark."""
    sheet = Image.new("RGB", (1100, 420), (24, 24, 27))
    picks = [0, FRAMES // 5, 2 * FRAMES // 5, 3 * FRAMES // 5]
    for col, k in enumerate(picks[:2]):
        for row, kk in enumerate((k, picks[col + 2])):
            big = text_fill(frames[kk], text, 96)
            sheet.paste(big, (20 + col * 540, 20 + row * 130), big)
    for j, k in enumerate(picks):
        small = text_fill(frames[k], text, 18)
        sheet.paste(small, (40 + j * 140, 300), small)
        small2 = text_fill(frames[k], text, 18).resize((small.width * 2, small.height * 2), Image.NEAREST)
        sheet.paste(small2, (40 + j * 260, 340), small2)
    sheet.save(path)


def text_fill(tex, text, px):
    font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", px)
    bbox = font.getbbox(text)
    tw, th = bbox[2] - bbox[0] + 8, bbox[3] - bbox[1] + 8
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).text((4 - bbox[0], 4 - bbox[1]), text, font=font, fill=255)
    fill = tex.resize((tw, th), Image.LANCZOS).convert("RGBA")
    fill.putalpha(mask)
    glow = Image.new("RGBA", (tw, th), (224, 0, 32, 0))
    glow.putalpha(mask.filter(ImageFilter.GaussianBlur(max(1, px // 14))).point(lambda a: a // 2))
    out = Image.alpha_composite(glow, fill)
    return out


def main(out_path, artwork_path, preview_path):
    frames = [frame(i) for i in range(FRAMES)]
    strip = Image.new("RGB", (W, H * 8))
    for j in range(8):
        strip.paste(frames[j * FRAMES // 8], (0, H * j))
    palette = strip.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    paletted = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    paletted[0].save(out_path, save_all=True, append_images=paletted[1:], duration=DELAY,
                     loop=0, optimize=False, disposal=1)
    art = Image.new("RGB", (W, H * 4))
    for j, k in enumerate((0, FRAMES // 4, FRAMES // 2, 3 * FRAMES // 4)):
        art.paste(frames[k], (0, H * j))
    art.save(artwork_path)
    preview_text(frames, preview_path)


if __name__ == "__main__":
    main(*sys.argv[1:4])
