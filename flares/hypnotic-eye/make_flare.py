"""Hypnotic Eye: a red-and-black Nameflare GIF texture matching B_X_N_E's avatar.

A two-arm hypnotic spiral (the avatar's iris) ripples outward from the centre
and loops seamlessly; thin CRT scanlines and a soft neon bloom match the
avatar's screen texture. The darkest tone is deep crimson, not black, so
letters filled with it stay readable on dark chat.
"""
import math
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H = 480, 160          # wide, like a name; Studio crops/zooms it to fit
SS = 2                   # supersampling for smooth spiral edges
FRAMES = 40              # 40 frames x 40 ms = 1.6 s seamless loop
DELAY = 40

# Avatar palette (sampled): neon #E00020, crimson #560411, near-black #0B0407.
DEEP = np.array([0x86, 0x08, 0x1A], float)      # darkest band: deep red, never black
MID = np.array([0x8C, 0x00, 0x18], float)
NEON = np.array([0xE0, 0x00, 0x20], float)      # the avatar's red
HOT = np.array([0xFF, 0x4A, 0x5E], float)       # bright highlight on the arms
CORE = np.array([0xFF, 0xB0, 0xBA], float)      # white-hot centre glint


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def frame(t):
    w, h = W * SS, H * SS
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w / 2, h / 2
    dx, dy = (x - cx) / SS, (y - cy) / SS
    r = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)

    # Two-arm Archimedean spiral moving outward: phase wraps once per loop.
    arms, pitch = 2, 76.0
    wave = np.sin(arms * theta - (2 * math.pi / pitch) * r * arms + 2 * math.pi * t)
    band = smoothstep(-0.55, 0.65, wave)            # soft, wide arms read at chat size

    # Colour: deep crimson troughs -> neon arms -> hot crest.
    crest = smoothstep(0.55, 1.0, wave)
    rgb = DEEP[None, None] * (1 - band[..., None]) + NEON[None, None] * band[..., None]
    rgb = rgb * (1 - crest[..., None] * 0.55) + HOT[None, None] * (crest[..., None] * 0.55)

    # The iris: brighter and hotter towards the centre, like the avatar's pupil.
    iris = np.exp(-(r / 58.0) ** 2)
    rgb = rgb * (1 - iris[..., None] * 0.35) + CORE[None, None] * (iris[..., None] * 0.35 * band[..., None])
    # A gentle falloff to the sides keeps the eye the focus without going dark.
    side = 1 - 0.28 * smoothstep(150, 260, np.abs(dx))
    rgb = rgb * side[..., None] + MID[None, None] * (1 - side[..., None]) * 0.5

    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)

    # Neon bloom: blur the bright parts and add them back.
    arr = np.asarray(img).astype(float)
    bright = np.clip(arr - 150, 0, 255)
    bloom = np.asarray(Image.fromarray(bright.astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(float)
    arr = np.clip(arr + bloom * 0.6, 0, 255)

    # CRT scanlines, like the avatar: every third row a little darker.
    arr[2::3] *= 0.74
    # A faint rolling brightness band (screen refresh), also seamless.
    roll = 1 + 0.06 * np.cos(2 * math.pi * (np.arange(H) / H - t))
    arr *= roll[:, None, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def main(out_path, preview_path):
    frames = [frame(i / FRAMES) for i in range(FRAMES)]
    # One shared palette built from all frames keeps the loop flicker-free.
    strip = Image.new("RGB", (W, H * 4))
    for i, k in enumerate((0, FRAMES // 4, FRAMES // 2, 3 * FRAMES // 4)):
        strip.paste(frames[k], (0, H * i))
    palette = strip.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    paletted = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    paletted[0].save(out_path, save_all=True, append_images=paletted[1:], duration=DELAY,
                     loop=0, optimize=False, disposal=1)
    frames[0].save(preview_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
