"""Measure the right edge of the filled area per row, and its colour.

The previous run-based probe was wrong because it walked from the left rule and
swallowed neighbouring columns' fills.  Here we look at what is actually there:
for each row, list ALL non-white runs with their mean colour, so the structure
(stacked fills / shadow / curve) is visible rather than assumed.
"""

from __future__ import annotations

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
lum = plot.mean(-1)
nw = lum <= 248


def runs(r):
    idx = np.where(nw[r])[0]
    out = []
    if not len(idx):
        return out
    s = p = idx[0]
    for k in idx[1:]:
        if k != p + 1:
            out.append((s, p))
            s = k
        p = k
    out.append((s, p))
    return out


for label, xa, xb in [("Caryophyllaceae-ish x[1193,1290]", 1193, 1290),
                      ("Artemisia x[1093,1133]", 1093, 1133),
                      ("Poaceae x[1131,1193]", 1131, 1193)]:
    print("=" * 100)
    print(label)
    print("=" * 100)
    for y_abs in range(240, 862, 40):
        r = y_abs - PLOT_TOP
        rr = []
        for s, e in runs(r):
            if e < xa or s > xb:
                continue
            seg = plot[r, s:e + 1]
            m = seg.mean(0)
            rr.append(f"x[{s},{e}]w{e-s+1} RGB({m[0]:.0f},{m[1]:.0f},{m[2]:.0f})")
        print(f"  y={y_abs:>4}: " + ("  ".join(rr) if rr else "(none)"))
    print()
