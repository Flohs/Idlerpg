#!/usr/bin/env python3
"""Convert raw OpenArt PNGs in assets/raw into web-sized WebP files in assets/img."""
import os, sys
from PIL import Image
RAW = os.path.join(os.path.dirname(__file__), '..', 'assets', 'raw')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'img')
os.makedirs(OUT, exist_ok=True)
for f in sorted(os.listdir(RAW)):
    if not f.endswith('.png'): continue
    name = f[:-4]
    src = os.path.join(RAW, f)
    im = Image.open(src).convert('RGB')
    if name.startswith('bg_'):
        target = (1280, 720); q = 78
    elif name.startswith('item_'):
        target = (256, 256); q = 80
    else:
        target = (512, 512); q = 80
    im.thumbnail((target[0], target[1]), Image.LANCZOS)
    # crop to exact aspect if needed
    if name.startswith('bg_'):
        w, h = im.size
        tw = min(w, int(h * 16 / 9)); th = int(tw * 9 / 16)
        im = im.crop(((w - tw)//2, (h - th)//2, (w - tw)//2 + tw, (h - th)//2 + th))
    dst = os.path.join(OUT, name + '.webp')
    im.save(dst, 'WEBP', quality=q, method=6)
    print(f"{name}: {im.size} -> {os.path.getsize(dst)//1024} KB")
