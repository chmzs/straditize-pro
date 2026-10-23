"""Authoritative column + fill analysis, anchored on the columns' left axes.

A percentage-diagram column has a vertical LEFT AXIS line; the fill grows
rightward from it.  So:

  1. left axis  := a vertical dark line spanning a large fraction of the plot height
  2. for each row, the fill = the contiguous non-white run starting at that axis
     (2 px gap tolerance for JPEG noise)
  3. the fill's colour = the modal colour of those runs' *interior* pixels
     (interior = excluding the first and last 2 px, which are the axis stroke and
      the curve stroke / antialiasing)

This separates "stroke" from "fill" -- the failure mode that made my earlier
colour-family probe mislabel the black curve as the solid fill.
"""

from __future__ import annotations

import collections
import json

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
H, W = plot.shape[:2]
lum = plot.mean(-1)
nw = lum <= 250
OTSU = 138.0

# --- 1. left axes -------------------------------------------------------------
dark = lum < 130
cover = dark.mean(0)
raw = [x for x in range(W) if cover[x] > 0.55]
axes = []
for x in raw:
    if axes and x - axes[-1][-1] <= 2:
        axes[-1].append(x)
    else:
        axes.append([x])
axes = [int(round(np.mean(a))) for a in axes]
print("candidate left axes (dark for >55% of plot height):")
print("  ", axes)
print()

# --- 2/3. fill per axis -------------------------------------------------------
print("=" * 112)
print("Per-axis fill measurement (fill := run starting at the axis, interior colour)")
print("=" * 112)
print(f"{'axis_x':>6} | {'fill_px':>8} | {'max_w':>6} | {'interior modal colour':<24} "
      f"{'lum':>6} | {'Otsu keeps':>10} {'cov':>7}")
print("-" * 112)

rows_out = []
for ax in axes:
    fill_px = 0
    maxw = 0
    interior = collections.Counter()
    otsu_kept = 0
    for r in range(H):
        if not nw[r, ax]:
            probe = np.where(nw[r, ax:ax + 5])[0]
            if not len(probe):
                continue
            start = ax + int(probe[0])
        else:
            start = ax
        end, k, gap = start, start, 0
        while k < W:
            if nw[r, k]:
                end, gap = k, 0
            else:
                gap += 1
                if gap > 2:
                    break
            k += 1
        if end - start < 2:
            continue
        seg = plot[r, start:end + 1]
        seg_lum = seg.mean(-1)
        fill_px += seg.shape[0]
        maxw = max(maxw, end - start + 1)
        otsu_kept += int((seg_lum < OTSU).sum())
        if end - start >= 6:
            inner = plot[r, start + 3:end - 1]
            interior.update(map(tuple, inner.astype(int).tolist()))
    if not interior:
        print(f"{ax:>6} | {fill_px:>8} | {maxw:>6} | {'(no interior px)':<24}")
        continue
    c, n = interior.most_common(1)[0]
    l = sum(c) / 3.0
    cov = 100.0 * otsu_kept / fill_px if fill_px else float("nan")
    print(f"{ax:>6} | {fill_px:>8} | {maxw:>6} | RGB{str(c):<19} {l:>6.1f} "
          f"| {otsu_kept:>10} {cov:>6.1f}%")
    rows_out.append({"axis_x": ax, "fill_px": fill_px, "max_width": maxw,
                     "interior_colour": list(c), "interior_lum": round(l, 1),
                     "otsu_kept": otsu_kept, "coverage_pct": round(cov, 2)})

with open("scripts/qa_review/out_axes.json", "w", encoding="utf-8") as fh:
    json.dump(rows_out, fh, indent=2)
print()
print("wrote scripts/qa_review/out_axes.json")
