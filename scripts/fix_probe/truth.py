# -*- coding: utf-8 -*-
"""Ground-truth measurement of the two-layer pollen figure.

Prints, per column, the histogram of "neutral dark" candidate pixels so we can
separate solid fill from the pale exaggeration envelope without guesswork.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import numpy as np
from PIL import Image

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 245, 850
COLUMNS = [
    ("Pinus", 332, 370), ("Abies", 370, 407), ("Picea", 407, 445),
    ("Betula", 445, 482), ("QuercusD", 482, 521), ("QuercusE", 521, 582),
    ("Rosaceae", 582, 619), ("Chenopodiaceae", 619, 657),
    ("Hippophae", 657, 704), ("Euphorbiaceae", 704, 924),
    ("Cyperaceae", 924, 1096), ("Artemisia", 1096, 1133),
    ("Poaceae", 1133, 1193), ("Ranunculaceae", 1193, 1231),
    ("Caryophyllaceae", 1231, 1280),
]

arr = np.array(Image.open(FIG).convert("RGB")).astype(float)
rgb = arr
lum = rgb.mean(axis=-1)
chroma = rgb.max(axis=-1) - rgb.min(axis=-1)

for name, x0, x1 in COLUMNS:
    sub_lum = lum[Y0:Y1, x0 + 3: x1 - 3]
    sub_chroma = chroma[Y0:Y1, x0 + 3: x1 - 3]
    # neutral = low chroma
    neutral = sub_chroma <= 20
    vals = sub_lum[neutral]
    # histogram over 100..255 in bins of 5
    hist, edges = np.histogram(vals, bins=32, range=(95, 255))
    top = sorted(zip(hist, edges[:-1] + 2.5), reverse=True)[:5]
    print(f"{name:<17} neutral px={neutral.sum():>7}  "
          f"top lum bins: " + ", ".join(f"{int(e):.0f}:{h}" for h, e in top))
