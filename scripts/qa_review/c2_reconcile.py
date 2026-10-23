"""C2 reconciliation: which definition yields Lead's 1.4% for Caryophyllaceae?

Lead's stated definition is "coverage = Otsu(138) foreground / solid pixels,
where solid := luminance <= 150".  Under that definition I measure 80.9%, not
1.4%.  This script enumerates the plausible alternative denominators and reports
which (if any) produce ~1.4%, so the disagreement can be stated precisely
instead of hand-waved.
"""

from __future__ import annotations

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
lum = plot.mean(-1)
mx = plot.max(-1)
mn = plot.min(-1)
chroma = mx - mn

name = "Caryophyllaceae"
x0, w = 1231, 49
x1 = x0 + w
sub = plot[:, x0:x1]
sl = lum[:, x0:x1]
sc = chroma[:, x0:x1]

otsu = sl < 138.0

candidates = {
    "A  lum<=150 (Lead's stated reference)": sl <= 150.0,
    "B  grey band lum in [143,200], chroma<=10": (sl >= 143) & (sl <= 200) & (sc <= 10),
    "C  exact grey (182,182,182) +/- 1": np.abs(sub - 182).max(-1) <= 1,
    "D  all non-white lum<=250": sl <= 250.0,
    "E  all non-white lum<=246": sl <= 246.0,
    "F  chroma<=10 and lum<=246 (greyscale only)": (sc <= 10) & (sl <= 246),
    "G  deepest 10% by luminance (the ORIGINAL bad proxy)":
        sl <= np.percentile(sl, 10),
}

print(f"{name}  box x[{x0},{x1}) rows {PLOT_TOP}..{PLOT_BOTTOM}  "
      f"box px={sl.size}")
print(f"Otsu(138) foreground px in box = {int(otsu.sum())}")
print()
print(f"{'definition':<52} {'ref_px':>9} {'otsu&ref':>9} {'coverage':>9}")
print("-" * 84)
for label, ref in candidates.items():
    n_ref = int(ref.sum())
    n_hit = int((otsu & ref).sum())
    cov = 100.0 * n_hit / n_ref if n_ref else float("nan")
    flag = "  <== ~1.4%" if abs(cov - 1.4) < 0.8 else ""
    print(f"{label:<52} {n_ref:>9} {n_hit:>9} {cov:>8.1f}%{flag}")

print()
print("=" * 84)
print("Same table for the 14 other columns, using Lead's stated definition (A),")
print("to see whether 'other 14 columns >= 92%' reproduces.")
print("=" * 84)
print(f"{'#':>3} {'name':<17} {'ref_px(A)':>10} {'otsu&ref':>9} {'coverage':>9}")
for i, (nm, cx0, cw) in enumerate(LEAD_COLUMNS, 1):
    s = lum[:, cx0:cx0 + cw]
    o = s < 138.0
    ref = s <= 150.0
    n_ref, n_hit = int(ref.sum()), int((o & ref).sum())
    cov = 100.0 * n_hit / n_ref if n_ref else float("nan")
    print(f"{i:>3} {nm:<17} {n_ref:>10} {n_hit:>9} {cov:>8.1f}%")
