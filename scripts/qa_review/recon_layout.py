"""Map the figure's true column layout: vertical rules + fill extents.

Independent of Lead's table.  The question: is the fill *inside* the box Lead
declared for each column, or does it grow out of it?
"""

from __future__ import annotations

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(int)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]

# --- vertical rule lines: columns where many rows are dark -------------------
dark = (plot.mean(-1) < 120)
colsum = dark.sum(0)
h = plot.shape[0]
rules = [x for x in range(plot.shape[1]) if colsum[x] > 0.55 * h]
# merge adjacent
merged = []
for x in rules:
    if merged and x - merged[-1][1] <= 2:
        merged[-1][1] = x
    else:
        merged.append([x, x])
print(f"vertical rules spanning >55% of plot height: {len(merged)}")
print([tuple(m) for m in merged])
print()

# --- fill extents on sample rows --------------------------------------------
def runs_of(row, thr=246):
    lum = row.mean(-1)
    nz = np.where(lum < thr)[0]
    out = []
    if len(nz):
        s = p = nz[0]
        for k in nz[1:]:
            if k != p + 1:
                out.append((s, p))
                s = k
            p = k
        out.append((s, p))
    return out

print("fill runs on sample rows (abs x), run length >= 4:")
for y_abs in (300, 400, 500, 600, 700, 800):
    r = y_abs - PLOT_TOP
    rr = [(s, e, e - s + 1) for s, e in runs_of(plot[r]) if e - s + 1 >= 4]
    print(f"  y={y_abs:>4}: {rr}")
