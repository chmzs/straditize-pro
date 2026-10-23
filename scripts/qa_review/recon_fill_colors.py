"""What colour is each column's fill, and what is the background?

The goal: determine, for every column, the *set of colours that constitute the
fill layer*, without assuming any luminance threshold.  Method: the fill is what
sits between the column's left rule and the curve's right edge; instead we
classify by exact colour clusters and check their spatial footprint.
"""

from __future__ import annotations

import collections

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(int)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]

# Vertical rules found independently (see recon_layout.py)
RULES = [332, 370, 408, 446, 483, 521, 582, 620, 657, 704, 924, 1096, 1133, 1193,
         1231, 1280, 1328]
print("independently detected rules:", RULES)
print()

# --- global colour inventory of the plot area --------------------------------
flat = plot.reshape(-1, 3)
lum = flat.mean(-1)
cnt = collections.Counter(map(tuple, flat[lum <= 250].tolist()))
print("top-25 colours with lum<=250 over whole plot area:")
for c, n in cnt.most_common(25):
    mx, mn = max(c), min(c)
    sat = (mx - mn) / mx if mx > 0 else 0.0
    print(f"  RGB{c}  lum={(c[0]+c[1]+c[2])/3:6.1f} sat={sat:.3f} n={n:>7}")
print()


# --- where does each key colour live? ----------------------------------------
def footprint(target: tuple[int, int, int], tol: int = 2):
    d = np.abs(plot - np.array(target)).max(-1)
    m = d <= tol
    if not m.any():
        return None
    cols = np.where(m.sum(0) > 0)[0]
    rows = np.where(m.sum(1) > 0)[0]
    per_col = m.sum(0)
    col_hist = {int(i): int(v) for i, v in enumerate(per_col) if v > 0}
    return dict(n=int(m.sum()), x0=int(cols.min()), x1=int(cols.max()),
                y0=int(rows.min()) + PLOT_TOP, y1=int(rows.max()) + PLOT_TOP,
                col_hist=col_hist)


for c in [(182, 182, 182), (208, 207, 191), (244, 226, 226), (218, 226, 237),
          (229, 229, 229), (255, 177, 34), (0, 0, 0)]:
    fp = footprint(c)
    print(f"RGB{c}:")
    if fp is None:
        print("   absent")
    else:
        hist = fp.pop("col_hist")
        print(f"   {fp}")
        peaks = sorted(hist.items(), key=lambda kv: -kv[1])[:6]
        print(f"   busiest columns (x -> count): {peaks}")
    print()
