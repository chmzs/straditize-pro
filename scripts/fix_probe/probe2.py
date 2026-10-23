# -*- coding: utf-8 -*-
"""Per-column colour inventory: which RGB triplets dominate, solid vs shadow."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
import numpy as np
from PIL import Image
from collections import Counter

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 260, 840
COLUMNS = [
    ("Pinus", 332, 370), ("QuercusE", 521, 582), ("Hippophae", 657, 704),
    ("Euphorbiaceae", 704, 924), ("Poaceae", 1133, 1193),
    ("Caryophyllaceae", 1231, 1280),
]
arr = np.array(Image.open(FIG).convert("RGB")).astype(int)
for name, x0, x1 in COLUMNS:
    sub = arr[Y0:Y1, x0 + 3: x1 - 3].reshape(-1, 3)
    # quantize to 4 to merge jpeg noise
    q = (sub // 4) * 4
    cnt = Counter(map(tuple, q))
    print(f"--- {name} ({x0}..{x1}) ---")
    for col, n in cnt.most_common(10):
        r, g, b = col
        lum = (r + g + b) / 3
        chroma = max(col) - min(col)
        print(f"   {col}  n={n:>6}  lum={lum:6.1f}  chroma={chroma}")
