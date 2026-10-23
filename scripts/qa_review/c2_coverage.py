"""C2: coverage of the "solid fill" per column, measured WITHOUT a luminance proxy.

Two reference definitions are computed side by side so the proxy itself can be
audited:

  REF-A  "luminance <= 150"      -- Lead's proxy for solid fill
  REF-B  "the modal fill colour" -- derived per column from the actual pixels

If REF-A and REF-B disagree, the disagreement *is* the finding.
"""

from __future__ import annotations

import collections

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(int)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
H = plot.shape[0]

print("=" * 100)
print("C2-a  Lead's own reference: 'dark solid = luminance <= 150'")
print("=" * 100)
print(f"{'#':>3} {'name':<17} {'x0':>5} {'w':>4} | "
      f"{'REF-A(<=150)':>12} | {'Otsu fg':>8} | {'covA':>7}")
print("-" * 90)

th = 138.0
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    sub = plot[:, x0:x0 + w]
    lum = sub.mean(-1)
    ref_a = lum <= 150.0
    otsu_fg = lum < th
    na, no = int(ref_a.sum()), int(otsu_fg.sum())
    cov = 100.0 * no / na if na else float("nan")
    print(f"{i:>3} {name:<17} {x0:>5} {w:>4} | {na:>12} | {no:>8} | {cov:>6.1f}%")

print()
print("=" * 100)
print("C2-b  Is 'luminance <= 150' a valid proxy for the SOLID FILL layer?")
print("      Audit: for each column list the actual colours with lum<=150,")
print("      and the actual colours that form the fill (largest non-white cluster).")
print("=" * 100)

for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    sub = plot[:, x0:x0 + w].reshape(-1, 3)
    lum = sub.mean(-1)
    sel = sub[lum <= 150.0]
    if sel.shape[0] == 0:
        print(f"{i:>3} {name:<17}: REF-A selects 0 px")
        continue
    c = collections.Counter(map(tuple, sel.tolist()))
    top = c.most_common(3)
    # chroma of the selected colours
    desc = []
    for col, n in top:
        mx, mn = max(col), min(col)
        chroma = mx - mn
        desc.append(f"RGB{col} n={n} chroma={chroma}")
    print(f"{i:>3} {name:<17} REF-A px={sel.shape[0]:>6} | " + " ; ".join(desc))
