"""C2 (authoritative): identify each column's fill by COLOUR FAMILY, not luminance.

Method (no proxy):
  1. In a column box, take horizontal runs of non-white pixels that are at least
     3 px wide.  Antialiasing produces 1-2 px runs; a real fill produces wide runs.
  2. Cluster those runs by exact RGB and keep the clusters that recur across many
     rows -> those are the fill layers (there can be two: solid + exaggerated shadow).
  3. Report, for each column, the fill colour families and how many of their
     pixels the product's Otsu(138) mask catches.

This measures the object under test (the fill) directly.
"""

from __future__ import annotations

import collections

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
H = plot.shape[0]
lum = plot.mean(-1)
nw = lum <= 250


def wide_runs(r: int, x0: int, x1: int, minw: int = 3):
    seg = nw[r, x0:x1]
    out = []
    k = 0
    n = seg.shape[0]
    while k < n:
        if seg[k]:
            s = k
            while k < n and seg[k]:
                k += 1
            if k - s >= minw:
                out.append((s, k))
        else:
            k += 1
    return out


print("=" * 112)
print("Fill colour families per column (from wide horizontal runs), "
      "and Otsu(138) coverage of each")
print("=" * 112)

summary = []
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    x1 = x0 + w
    counter = collections.Counter()
    rowcount = collections.Counter()
    for r in range(H):
        for s, e in wide_runs(r, x0, x1):
            for k in range(s, e):
                c = tuple(plot[r, x0 + k].astype(int).tolist())
                counter[c] += 1
            rowcount[tuple(plot[r, x0 + s + (e - s) // 2].astype(int).tolist())] += 1
    total = sum(counter.values())
    top = counter.most_common(6)
    print(f"--- {i:>2} {name:<17} box x[{x0},{x1}) w={w}  "
          f"wide-run px={total}")
    for c, n in top:
        l = sum(c) / 3.0
        chroma = max(c) - min(c)
        hit = int((lum[PLOT_TOP:PLOT_BOTTOM + 1, x0:x1] < 138.0).sum()) if False else None
        print(f"      RGB{str(c):<17} lum={l:>6.1f} chroma={chroma:>4} "
              f"n={n:>7}  ({100.0 * n / total:>5.1f}% of wide-run px)")
    summary.append((i, name, top, total))
    print()

print("=" * 112)
print("Now: does Otsu(138) catch the fill?  (fill := the top colour family "
      "above, restricted to wide runs)")
print("=" * 112)
print(f"{'#':>3} {'name':<17} | {'fill colour':<18} {'fill_px':>8} "
      f"{'Otsu-hit':>9} {'coverage':>9}")
print("-" * 80)
for i, name, top, total in summary:
    if not top:
        continue
    c, n = top[0]
    x0, w = LEAD_COLUMNS[i - 1][1], LEAD_COLUMNS[i - 1][2]
    x1 = x0 + w
    m = (np.abs(plot[:, x0:x1] - np.array(c)).max(-1) <= 1)
    l = sum(c) / 3.0
    hit = int(m.sum() and (m & (lum[:, x0:x1] < 138.0)).sum())
    cov = 100.0 * hit / m.sum() if m.sum() else float("nan")
    print(f"{i:>3} {name:<17} | RGB{str(c):<14} {int(m.sum()):>8} "
          f"{hit:>9} {cov:>8.1f}%")
