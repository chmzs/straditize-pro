# -*- coding: utf-8 -*-
"""Per-column: dominant HUES and their luminance, to see solid vs shadow families."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
import numpy as np
from PIL import Image
from collections import defaultdict

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 260, 840
COLUMNS = [
    ("Pinus", 332, 370), ("Abies", 370, 407), ("Picea", 407, 445),
    ("Betula", 445, 482), ("QuercusD", 482, 521), ("QuercusE", 521, 582),
    ("Rosaceae", 582, 619), ("Chenopodiaceae", 619, 657),
    ("Hippophae", 657, 704), ("Euphorbiaceae", 704, 924),
    ("Cyperaceae", 924, 1096), ("Artemisia", 1096, 1133),
    ("Poaceae", 1133, 1193), ("Ranunculaceae", 1193, 1231),
    ("Caryophyllaceae", 1231, 1280),
]
arr = np.array(Image.open(FIG).convert("RGB")).astype(int)

def hueq(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0: return None
    if mx == r: h = ((g - b) / d) % 6
    elif mx == g: h = (b - r) / d + 2
    else: h = (r - g) / d + 4
    return int(round(h * 60 / 15.0)) * 15

for name, x0, x1 in COLUMNS:
    sub = arr[Y0:Y1, x0 + 3: x1 - 3].reshape(-1, 3)
    buckets = defaultdict(list)
    for r, g, b in sub:
        if max(r, g, b) - min(r, g, b) < 12:      # neutral
            buckets['neutral'].append((r + g + b) / 3)
        else:
            buckets[hueq(r, g, b)].append((r + g + b) / 3)
    parts = []
    for h, lums in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        if len(lums) < 40: continue
        l = np.array(lums)
        # split into dark / light halves
        darkfrac = (l <= 120).mean()
        midfrac = ((l > 120) & (l <= 200)).mean()
        palefrac = (l > 200).mean()
        parts.append(f"h={h}:n={len(l):>6} dark≤120={darkfrac:.0%} mid={midfrac:.0%} pale>200={palefrac:.0%} medL={np.median(l):.0f}")
    print(f"--- {name} ---")
    for p in parts: print("   " + p)
