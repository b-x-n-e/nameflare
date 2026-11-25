"""Hypnotic Eye: Overdrive. A detailed red-and-black Nameflare GIF texture
built on B_X_N_E's avatar (a neon line-drawn eye with a spiral iris on a CRT).

Layers, every one periodic in t so the GIF loops seamlessly:
  1. plasma      domain-warped flowing energy in deep reds (the base; never black,
                 so letters stay readable in dark chat)
  2. eye         the avatar's almond lid strokes as thin neon lines
  3. iris        a fine-line two-arm spiral turning inside a glowing iris ring
  4. shockwave   a ring that leaves the pupil and travels out once per loop
  5. lightning   red-white cracks out of the iris, flickering
  6. embers      sparks drifting up and across
  7. screen      bloom, chromatic split, scanlines, a scan sweep and a glitch beat
"""
import math
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H = 480, 160
SS = 2
FRAMES = int(sys.argv[3]) if len(sys.argv) > 3 else 36
DELAY = 45
TAU = 2 * math.pi
rng = np.random.default_rng(1729)

C = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
VOID = C("#14000a")     # the black of the avatar, used for veins and outlines
EMBER = C("#a8061c")
NEON = C("#ff1a35")     # the avatar's red, at neon brightness
HOT = C("#ff3d55")
WHITE = C("#ffd6dc")


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def line(dist, width, soft):
    """A glowing line: a sharp core of `width` plus a soft halo."""
    core = 1 - ss(width * 0.5, width * 0.5 + 1.0, dist)
    halo = np.exp(-(dist / soft) ** 2)
    return core, halo


# Lightning: fixed branch skeletons (polylines from the iris rim outwards).
def make_bolts(n=7):
    bolts = []
    for k in range(n):
        ang = TAU * k / n + rng.uniform(-0.25, 0.25)
        pts, r, a = [], 40.0, ang
        while r < 250:
            pts.append((math.cos(a) * r, math.sin(a) * r * 0.55))
            r += rng.uniform(10, 18)
            a += rng.uniform(-0.22, 0.22)
        bolts.append((np.array(pts), rng.integers(0, 4), rng.uniform(0.6, 1.0)))
    return bolts


BOLTS = make_bolts()
EMBERS = [(rng.uniform(-W / 2, W / 2), rng.uniform(0, H), rng.uniform(1.4, 3.2),
           int(rng.integers(1, 3)), rng.uniform(0, 1), int(rng.choice([-1, 1])))
          for _ in range(46)]


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def frame(i):
    t = i / FRAMES
    w, h = W * SS, H * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x = (xx - w / 2) / SS                  # pixel units, centred
    y = (yy - h / 2) / SS
    r = np.hypot(x, y)
    th = np.arctan2(y, x)

    # 1. Plasma: sines warped by sines, every time term an integer multiple of t.
    wx = x / 38 + 0.9 * np.sin(y / 23 + TAU * t) + 0.5 * np.sin(x / 61 - TAU * 2 * t)
    wy = y / 31 + 0.8 * np.cos(x / 29 - TAU * t) + 0.4 * np.cos(r / 40 + TAU * t)
    p = (np.sin(wx + wy * 0.6 + TAU * t) + np.sin(wy * 1.3 - wx * 0.4 - TAU * 2 * t)
         + 0.6 * np.sin(np.hypot(wx, wy) * 1.7 - TAU * t)) / 2.6
    p = ss(-0.9, 1.0, p)
    # Bright energy with dark veins: veins sit where the warped field crosses zero.
    vein = np.exp(-((np.sin(wx * 1.3 + wy * 0.7 - TAU * t)) / 0.2) ** 2)
    SHADE = C("#3e0210")                                  # the plasma's deep shadow
    lift = ss(0.15, 0.85, p)                               # half shadow, half neon
    rgb = SHADE + (NEON - SHADE) * lift[..., None] + (HOT - NEON) * (ss(0.75, 1.0, p) * 0.7)[..., None]
    rgb = rgb * (1 - vein[..., None] * 0.85) + VOID * (vein[..., None] * 0.85)

    glow = np.zeros((h, w))          # energy that will bloom
    white = np.zeros((h, w))         # white-hot cores

    # 2. Eye: the avatar's almond outline, two lid strokes and a lower flick.
    ex = np.clip(np.abs(x) / 205, 0, 1.0)
    upper = -62 * (1 - ex ** 2) ** 0.85
    lower = 50 * (1 - ex ** 2) ** 1.1
    for curve, wid in ((upper, 4.5), (upper - 11 * (1 - ex ** 2), 2.4), (lower, 4.0)):
        d = np.abs(y - curve)
        d = np.where(np.abs(x) < 205, d, 99)
        core, halo = line(d, wid, 7)
        rim = (1 - ss(wid * 0.5 + 1, wid * 0.5 + 5, d)) * (1 - core)   # black outline around the stroke
        breathe = 0.85 + 0.15 * math.cos(TAU * t)
        rgb = rgb * (1 - rim[..., None] * 0.9) + VOID * rim[..., None] * 0.9
        rgb = rgb * (1 - core[..., None]) + (HOT * breathe) * core[..., None]
        glow += halo * 0.7 * breathe

    # 3. Iris: a glowing ring and a fine-line two-arm spiral turning inside it.
    iris_r = 58
    inside = 1 - ss(iris_r - 2, iris_r + 2, r)
    ring_core, ring_halo = line(np.abs(r - iris_r), 4.0, 6)
    ring_rim = (1 - ss(3, 7, np.abs(r - iris_r))) * (1 - ring_core)
    rgb = rgb * (1 - ring_rim[..., None] * 0.9) + VOID * ring_rim[..., None] * 0.9
    # The avatar's iris: bold two-arm spiral, bright arms and dark gaps of equal width.
    pitch = 34.0
    spiral = np.sin(2 * th - (TAU / pitch) * r * 2 + TAU * 2 * t)
    arm = ss(-0.18, 0.18, spiral)                 # 1 on the bright arm, 0 in the gap
    edge = np.exp(-(spiral / 0.22) ** 2)          # the arm's rim, for a neon edge
    iris_bright = NEON + (HOT - NEON) * ss(0, iris_r, iris_r - r)[..., None] * 0.7
    iris_rgb = VOID * (1 - arm[..., None]) + iris_bright * arm[..., None]
    rgb = rgb * (1 - inside[..., None]) + iris_rgb * inside[..., None]
    glow += edge * inside * 0.35 + arm * inside * 0.25
    rgb = rgb * (1 - ring_core[..., None]) + HOT * ring_core[..., None]
    glow += ring_halo * 1.1
    pupil = np.exp(-(r / 7) ** 2)
    white += pupil * 0.9

    # 4. Shockwave: one ring per loop, from the pupil out past the lids.
    sr = (t * 300) % 300
    fade = 1 - t
    sh_core, sh_halo = line(np.abs(r - sr), 1.6, 9)
    glow += sh_halo * 0.9 * fade
    white += sh_core * 0.5 * fade

    # 5. Lightning: each bolt flickers on for a few frames of the loop.
    for pts, phase, strength in BOLTS:
        on = 0.5 + 0.5 * math.cos(TAU * (t * 3 + phase / 4))
        on = max(0.0, on - 0.35) / 0.65
        if on <= 0.02:
            continue
        d = np.full((h, w), 1e9)
        jit = 1.5 * math.sin(TAU * (t * 6 + phase))
        for a, b in zip(pts[:-1], pts[1:]):
            d = np.minimum(d, seg_dist(x, y, a[0], a[1] + jit, b[0], b[1] - jit))
        core, halo = line(d, 2.6, 6)
        rim = (1 - ss(2, 5, d)) * (1 - core)
        rgb = rgb * (1 - (rim * on * 0.8)[..., None]) + VOID * (rim * on * 0.8)[..., None]
        white += core * on * strength
        glow += halo * on * strength * 0.9

    # 6. Embers: sparks drifting up (integer laps per loop) with a little sway.
    em = np.zeros((h, w))
    for ex0, ey0, size, laps, ph, drift in EMBERS:
        ey = (ey0 - t * laps * H) % H - H / 2
        exx = ex0 + 6 * math.sin(TAU * (t * laps + ph)) + drift * t * 0
        twinkle = 0.6 + 0.4 * math.cos(TAU * (t * 2 + ph))
        em += np.exp(-((x - exx) ** 2 + (y - ey) ** 2) / (size ** 2)) * twinkle
    white += em * 0.8
    glow += em * 0.6

    # Compose the energy: glow tints to neon, cores burn towards white.
    rgb = rgb + NEON * np.clip(glow, 0, 1.5)[..., None] * 0.55
    rgb = rgb + (WHITE - rgb) * np.clip(white, 0, 1)[..., None]
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)

    # 7. Screen: bloom, chromatic split, scanlines, scan sweep, glitch beat.
    arr = np.asarray(img).astype(float)
    bright = np.clip(arr - 170, 0, 255).astype(np.uint8)
    bloom = np.asarray(Image.fromarray(bright).filter(ImageFilter.GaussianBlur(6))).astype(float)
    arr = arr + bloom * 0.8
    shift = 2
    arr[:, shift:, 0] = np.maximum(arr[:, shift:, 0], arr[:, :-shift, 0] * 0.9)   # red fringe right
    arr[:, :-shift, 2] = np.maximum(arr[:, :-shift, 2], arr[:, shift:, 2] * 0.85)  # cool fringe left
    rows = np.arange(H)
    sweep = np.exp(-(((rows / H - t) + 0.5) % 1 - 0.5) ** 2 / 0.004)
    arr *= (1 + 0.35 * sweep)[:, None, None]
    arr[2::3] *= 0.8
    if i in (FRAMES * 5 // 9, FRAMES * 5 // 9 + 1):          # glitch beat: two frames
        for _ in range(5):
            y0 = int(rng.integers(0, H - 12)); hh = int(rng.integers(3, 12)); dx = int(rng.integers(-18, 18))
            arr[y0:y0 + hh] = np.roll(arr[y0:y0 + hh], dx, axis=1)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def main(out_path, preview_path):
    frames = [frame(i) for i in range(FRAMES)]
    strip = Image.new("RGB", (W, H * 6))
    for j, k in enumerate(range(0, FRAMES, max(1, FRAMES // 6))):
        if j < 6:
            strip.paste(frames[k], (0, H * j))
    palette = strip.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    paletted = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    paletted[0].save(out_path, save_all=True, append_images=paletted[1:], duration=DELAY,
                     loop=0, optimize=False, disposal=1)
    sheet = Image.new("RGB", (W, H * 3))
    for j, k in enumerate((0, FRAMES // 3, 2 * FRAMES // 3)):
        sheet.paste(frames[k], (0, H * j))
    sheet.save(preview_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
