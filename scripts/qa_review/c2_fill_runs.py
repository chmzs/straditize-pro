"""C2 (decisive): measure the fill the way a bar chart actually works.

For a percentage diagram each taxon column has a left rule; the filled area
grows rightward from that rule and the curve is its right edge.  So the fill on
row r is the contiguous non-white run that STARTS AT the left rule.

This is a direct measurement of the object under test.  It uses no luminance
proxy: each run pixel is labelled by its own colour, and the "solid vs shadow"
split is taken from that column's own colour distribution.
"""

from __future__ import annotations

import collections

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
H, W = plot.shape[:2]
lum = plot.mean(-1)
nonwhite = lum <= 248

# Left rules, detected independently by recon_layout.py (a rule = a column that
# is dark for >55% of the plot height).  For each column we take the leftmost
# rule at or before Lead's x0.
RULES = [332, 370, 408, 446, 483, 521, 582, 620, 657, 704, 924, 1096, 1133,
         1193, 1231]

print("Per-column fill measured as 'contiguous non-white run starting at the "
      "left rule'")
print("=" * 108)
print(f"{'#':>3} {'name':<17} {'rule_x':>6} {'w':>4} | {'fill_px':>8} | "
      f"{'Otsu<138':>9} {'cov':>7} | {'lum<=150':>9} {'cov':>7} | "
      f"colours of the fill (top-3)")
print("-" * 108)

results = []
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    rule = None
    for r in RULES:
        if r <= x0 + 3:
            rule = r
    if rule is None:
        rule = x0
    xr = rule - PLOT_TOP * 0  # absolute x inside plot
    fill_px = 0
    otsu_hit = 0
    lum150_hit = 0
    colour_counter = collections.Counter()
    for r in range(H):
        row_nw = nonwhite[r]
        # walk right from the rule; allow a 2px gap tolerance (antialiasing)
        if not row_nw[xr]:
            # the rule itself may be lighter; probe a small window
            probe = np.where(row_nw[xr:xr + 4])[0]
            if len(probe) == 0:
                continue
            start = xr + int(probe[0])
        else:
            start = xr
        end = start
        gap = 0
        k = start
        while k < W:
            if row_nw[k]:
                end = k
                gap = 0
            else:
                gap += 1
                if gap > 2:
                    break
            k += 1
        if end <= start:
            continue
        seg = plot[r, start:end + 1]
        fill_px += seg.shape[0]
        seg_lum = seg.mean(-1)
        otsu_hit += int((seg_lum < 138.0).sum())
        lum150_hit += int((seg_lum <= 150.0).sum())
        colour_counter.update(map(tuple, seg.astype(int).tolist()))
    cov_otsu = 100.0 * otsu_hit / fill_px if fill_px else float("nan")
    cov_150 = 100.0 * lum150_hit / fill_px if fill_px else float("nan")
    top = colour_counter.most_common(3)
    desc = ", ".join(f"RGB{c}:{n}" for c, n in top)
    results.append((i, name, rule, w, fill_px, cov_otsu, cov_150))
    print(f"{i:>3} {name:<17} {rule:>6} {w:>4} | {fill_px:>8} | "
          f"{otsu_hit:>9} {cov_otsu:>6.1f}% | {lum150_hit:>9} {cov_150:>6.1f}% | {desc}")

print()
print("SUMMARY")
fails_otsu = [r for r in results if r[5] < 90.0]
print(f"  columns with Otsu(138) coverage < 90%  : {len(fails_otsu)} / 15 "
      f"-> {[r[1] for r in fails_otsu]}")
fails_150 = [r for r in results if r[6] < 90.0]
print(f"  columns with lum<=150 coverage < 90%   : {len(fails_150)} / 15 "
      f"-> {[r[1] for r in fails_150]}")
