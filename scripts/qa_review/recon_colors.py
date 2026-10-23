"""Reconnaissance: what colours actually exist inside each column?

This is deliberately *descriptive* -- it makes no assumption about which pixels
are "solid fill".  The point is to see whether "luminance <= 150" (Lead's proxy
for solid fill) actually selects the solid layer, or something else.
"""

from __future__ import annotations

import collections

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb()
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1, :, :]

print(f"plot area rows {PLOT_TOP}..{PLOT_BOTTOM}  shape={plot.shape}")
print()
hdr = f"{'col':>3} {'name':<17} {'x0':>5} {'w':>4} | " \
      f"{'npx':>7} | top-5 exact RGB (count, lum)"
print(hdr)
print("-" * len(hdr) + "-" * 30)

for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    sub = plot[:, x0:x0 + w, :]
    flat = sub.reshape(-1, 3)
    lum = flat.mean(axis=1)
    cnt = collections.Counter(map(tuple, flat.tolist()))
    top = cnt.most_common(5)
    parts = []
    for c, n in top:
        parts.append(f"{c}:{n}@{lum[0]:.0f}".replace(f"@{lum[0]:.0f}", ""))
        parts[-1] = f"{c}:{n}"
    print(f"{i:>3} {name:<17} {x0:>5} {w:>4} | {flat.shape[0]:>7} | "
          + "  ".join(parts))
    # luminance histogram of the distinct colours, weighted by count
    dark = (lum <= 150).sum()
    print(f"{'':>3} {'':<17} {'':>5} {'':>4} | {'':>7} | "
          f"lum<=150 -> {dark} px ({100*dark/flat.shape[0]:.1f}% of column box)")
