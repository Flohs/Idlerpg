#!/usr/bin/env python3
"""Chroma-key green-screen sprites from assets/raw/sprites into transparent WebP sprites in assets/img."""
import os, sys
import numpy as np
from PIL import Image
RAW = os.path.join(os.path.dirname(__file__), '..', 'assets', 'raw', 'sprites')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'img')

def key(im, height=320):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # detect key colour from the corners: green screen or magenta screen
    corners = np.stack([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]).mean(axis=0)
    magenta = corners[1] < corners[0] and corners[1] < corners[2]
    if magenta:
        greenness = np.minimum(r, b) - g  # magenta-ness
    else:
        greenness = g - np.maximum(r, b)
    # alpha: 0 where strongly green, 1 where not green; soft ramp
    alpha = np.clip(1.0 - (greenness - 40) / 70.0, 0, 1)
    # pure green pixels
    if magenta: alpha[(r > 200) & (b > 200) & (g < 120)] = 0
    else: alpha[(g > 200) & (r < 120) & (b < 120)] = 0
    # despill: clamp green to max(r,b) on semi-transparent / near-edge pixels
    spill = greenness > 0
    if magenta:
        r2 = np.where(spill, np.minimum(r, g + 10), r); b2 = np.where(spill, np.minimum(b, g + 10), b)
        rgb = np.stack([r2, g, b2], axis=-1)
    else:
        g2 = np.where(spill, np.minimum(g, np.maximum(r, b) + 10), g)
        rgb = np.stack([r, g2, b], axis=-1)
    out = np.concatenate([rgb, (alpha * 255)[..., None]], axis=-1).astype(np.uint8)
    res = Image.fromarray(out, 'RGBA')
    # crop to content
    bbox = Image.fromarray((alpha > 0.5).astype(np.uint8) * 255).getbbox()
    if bbox:
        pad = 6
        res = res.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(res.width, bbox[2] + pad), min(res.height, bbox[3] + pad)))
    # erode a hair to remove green fringe
    ratio = height / res.height
    res = res.resize((max(1, int(res.width * ratio)), height), Image.LANCZOS)
    return res

for f in sorted(os.listdir(RAW)):
    if not f.endswith('.png') or f.endswith('_cut.png'): continue
    name = f[:-4]
    src = os.path.join(RAW, f)
    if name.startswith('tile_'):
        im = Image.open(src).convert('RGB').resize((256, 256), Image.LANCZOS)
        im.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=82, method=6)
        print(name, 'tile')
        continue
    res = key(Image.open(src))
    res.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=85, method=6)
    print(name, res.size, os.path.getsize(os.path.join(OUT, name + '.webp')) // 1024, 'KB')
