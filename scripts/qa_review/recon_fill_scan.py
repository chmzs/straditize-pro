"""Where is every fill colour, and what luminance does it have?

No threshold is assumed.  For each column of the image we take the modal
non-white colour inside the plot band and report it.  This directly answers
"which pixels constitute the fill layer", which is the reference that both
Otsu(138) and Lead's `lum <= 150` proxy must be judged against.
"""

from __future__ import annotations

import collections

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(int)
band = rgb[PLOT_TOP:PLOT_BOTTOM + 1]          # (631, 2132, 3)
lum = band.mean(-1)
nonwhite = lum <= 248

rows = []
for x in range(band.shape[1]):
    col = band[:, x]
    sel = col[nonwhite[:, x]]
    if sel.shape[0] < 8:
        rows.append((x, None, 0, 0))
        continue
    cnt = collections.Counter(map(tuple, sel.tolist()))
    (colr, n) = cnt.most_common(1)[0]
    rows.append((x, colr, n, sel.shape[0]))

# group consecutive x with the same modal colour
groups = []
cur = None
for x, c, n, tot in rows:
    if cur and c == cur[1] and x - cur[2] == 1:
        cur[2] = x
        cur[3] += n
        cur[4] += tot
    else:
        cur = [x, c, x, n, tot]
        groups.append(cur)

print(f"{'x0':>5} {'x1':>5} {'w':>5} | {'modal colour':<18} {'lum':>6} "
      f"{'chroma':>6} | {'modal_n':>8} {'nonwhite':>9} | share")
print("-" * 100)
for g in groups:
    x0, c, x1, n, tot = g
    if c is None:
        continue
    l = sum(c) / 3.0
    chroma = max(c) - min(c)
    w = x1 - x0 + 1
    share = 100.0 * n / tot if tot else 0.0
    print(f"{x0:>5} {x1:>5} {w:>5} | RGB{str(c):<14} {l:>6.1f} {chroma:>6} "
          f"| {n:>8} {tot:>9} | {share:>5.1f}%")
