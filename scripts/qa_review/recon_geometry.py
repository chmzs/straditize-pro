"""Independent column-geometry derivation from the figure itself.

Derives column boundaries from the tick rulers (the most reliable structural
feature) rather than from Lead's table, then reports where the fill actually is.
"""

from __future__ import annotations

import numpy as np
from common import load_rgb

rgb = load_rgb().astype(int)
H, W = rgb.shape[:2]
print("figure", W, "x", H)

lum = rgb.mean(-1)
ink = lum < 240

# --- 1. find the horizontal extent of the drawing (top/bottom axes) ----------
rowink = ink.sum(1)
print("\nrows with >40% ink (candidate axis lines):")
for y in range(H):
    if rowink[y] > 0.4 * W:
        print(f"   y={y:>4} ink={rowink[y]}")

# --- 2. find the bottom ruler band ------------------------------------------
print("\nink profile of bottom 70 rows (y 858..927):")
for y in range(858, H):
    print(f"   y={y:>4} ink={rowink[y]:>6}")

# --- 3. vertical rule candidates over the whole image -----------------------
colink = ink.sum(0)
print("\ncolumns with ink spanning >50% of height (vertical rules):")
cand = [x for x in range(W) if colink[x] > 0.5 * H]
merged = []
for x in cand:
    if merged and x - merged[-1][1] <= 2:
        merged[-1][1] = x
    else:
        merged.append([x, x])
print("   ", [tuple(m) for m in merged])
