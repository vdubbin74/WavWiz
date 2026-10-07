#!/usr/bin/env python3
"""Regenerates the Inno Setup wizard bitmaps from the EXACT logo files in assets/logo (never redrawn). Needs Pillow."""
from PIL import Image, ImageDraw
import os
root = os.path.join(os.path.dirname(__file__), '..')
logo = Image.open(os.path.join(root, 'assets/logo/wavwiz-1024.png')).convert('RGBA')
BG = logo.getpixel((2, 2))[:3]      # the logo sits on its own near-black corner color; use it so no square shows
def make(w, h, size, name, big):
    im = Image.new('RGB', (w, h), BG)
    if big:       # tall side banner: logo near the top on the dark background with a thin orange/teal line
        d = ImageDraw.Draw(im); d.rectangle([0, h - 6, w // 2, h], fill=(255, 60, 0)); d.rectangle([w // 2, h - 6, w, h], fill=(25, 195, 177))
        lg = logo.resize((size, size), Image.LANCZOS); im.paste(lg, ((w - size) // 2, int(h * 0.12)), lg)
    else:
        lg = logo.resize((size, size), Image.LANCZOS); im.paste(lg, ((w - size) // 2, (h - size) // 2), lg)
    im.save(os.path.join(root, 'installer', name), 'BMP')
for w, h in ((164, 314), (246, 471), (328, 628)): make(w, h, int(w * 0.8), f'wizard-large-{w}.bmp', True)
for s in (55, 83, 110): make(s, s, int(s * 0.9), f'wizard-small-{s}.bmp', False)
