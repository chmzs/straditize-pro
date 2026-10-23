"""P10 + the 5x falsification test, both computed from the figure itself.

P10: does a column pair exist with near-equal tick spacing but a large range
     difference?  (If yes, "equal spacing => equal per-cell value" is dead.)

5x : the caption says "Shadings are five-fold exaggerated".  If the light layer
     is the envelope, then (light span) / (dark span) ~= 5 on rows where neither
     is clipped by the column rule.  That is falsifiable; here is the test.
"""

from __future__ import annotations

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_gray, load_rgb

gray = load_gray()
rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]

from straditize_core import ruler  # noqa: E402

print("=" * 100)
print("P9/P10: tick spacing per column (product ruler) + the extrapolation trap")
print("=" * 100)
geo = []
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    g = ruler.detect_ruler(gray, x0, x0 + w)
    geo.append((i, name, x0, w, g))
    print(f"{i:>3} {name:<17} spacing={str(g['spacing_px']):>6} "
          f"n_ticks={len(g['ticks']):>3} n_cells={g['n_cells']:>3} "
          f"regular={g['regular']}")

sp = [g["spacing_px"] for _, _, _, _, g in geo]
print()
print(f"  distinct spacings: {sorted(set(sp))}")
print(f"  range: {min(sp)} .. {max(sp)}")
print(f"  'all 15 columns ~12.3 px' reproduced? "
      f"{all(abs(s - 12.3) <= 0.3 for s in sp)}")

# --- P10: pairs with near-equal spacing but very different cell counts -------
print()
print("=" * 100)
print("P10: pairs whose spacing differs by <=5% but whose cell count differs a lot")
print("=" * 100)
found = False
for a in range(len(geo)):
    for b in range(a + 1, len(geo)):
        sa, sb = geo[a][4]["spacing_px"], geo[b][4]["spacing_px"]
        na, nb = geo[a][4]["n_cells"], geo[b][4]["n_cells"]
        if sa is None or sb is None or not na or not nb:
            continue
        rel = abs(sa - sb) / max(sa, sb)
        ratio = max(na, nb) / min(na, nb)
        if rel <= 0.05 and ratio >= 1.5:
            found = True
            print(f"  {geo[a][1]:<17} spacing={sa:<5} cells={na:<3}  |  "
                  f"{geo[b][1]:<17} spacing={sb:<5} cells={nb:<3}")
            print(f"      spacing differs {100 * rel:.1f}%, cell count differs "
                  f"{ratio:.1f}x -> per-cell value must differ {ratio:.1f}x")
if not found:
    print("  (none found at these thresholds)")

# --- the 5x test --------------------------------------------------------------
print()
print("=" * 100)
print("5x falsification: light-span / dark-span on unclipped rows")
print("=" * 100)
DARK = np.abs(plot - np.array([0, 62, 137])).max(-1) <= 60
LIGHT = np.abs(plot - np.array([218, 226, 237])).max(-1) <= 12
ax, colw = 521, 61          # Quercus_E

ratios = []
for r in range(plot.shape[0]):
    di = np.where(DARK[r, ax:ax + colw])[0]
    li = np.where(LIGHT[r, ax:ax + colw])[0]
    if not len(di) or not len(li):
        continue
    d = int(di.max()) + 1
    l = int(li.max()) + 1
    # exclude rows where either layer is clipped at the column rule
    if d >= colw - 1 or l >= colw - 1:
        continue
    if d < 4:
        continue
    ratios.append(l / d)

if ratios:
    arr = np.array(ratios)
    print(f"  usable rows: {len(arr)}")
    print(f"  light/dark  median={np.median(arr):.2f}  mean={arr.mean():.2f}  "
          f"p25={np.percentile(arr, 25):.2f}  p75={np.percentile(arr, 75):.2f}")
    print(f"  fraction within [4,6]: {100.0 * ((arr >= 4) & (arr <= 6)).mean():.1f}%")
    print(f"  -> consistent with the caption's 'five-fold'? "
          f"{'YES' if 4.0 <= np.median(arr) <= 6.0 else 'NO'}")

print()
print("  interpretation")
print("  --------------")
print("  If light/dark ~= 5 on unclipped rows, the light layer IS the 5x envelope")
print("  and the dark layer is the true value.  In that case classifying the")
print("  light layer as SOLID would put the envelope into the reading.")
