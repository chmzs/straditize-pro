"""Decisive test: is (218,226,237) the 5x exaggerated envelope?

The figure caption says "Shadings are five-fold exaggerated".  So IF the light
layer is the envelope and the dark layer is the true value, then on every row

        light_width  ~=  5 x dark_width

That is a falsifiable prediction.  It is the test that decides which layer is
the reading, instead of assuming it from colour or from luminance.

A second, independent line of evidence: the *right edge* of the dark layer must
be where the true curve is, and the light layer must be a smooth, wider envelope
that never falls inside it.
"""

from __future__ import annotations

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
lum = plot.mean(-1)
nw = lum <= 250


def m(c, tol=1):
    return np.abs(plot - np.array(c)).max(-1) <= tol


LIGHT = m((218, 226, 237))
DARK = m((0, 62, 137))
PINKL = m((244, 226, 226))
PINKR = m((178, 58, 59))

# Column Quercus_E spans x 521..582
x0, x1 = 521, 582
print("=" * 100)
print("Quercus_E (x 521..582): light-blue run width vs deep-blue run width")
print("=" * 100)
print(f"{'row y':>6} {'light run':>22} {'dark run':>22} {'light/dark':>11}")
ratios = []
for r in range(0, plot.shape[0]):
    li = np.where(LIGHT[r, x0:x1])[0]
    di = np.where(DARK[r, x0:x1])[0]
    lw = int(li.max() - li.min() + 1) if len(li) else 0
    dw = int(di.max() - di.min() + 1) if len(di) else 0
    if lw and dw:
        ratios.append(lw / dw)
    if r % 30 == 0 and (lw or dw):
        print(f"{PLOT_TOP + r:>6} {lw:>22} {dw:>22} "
              f"{(lw / dw if dw else float('nan')):>11.2f}")
print()
if ratios:
    print(f"  rows with both layers present: {len(ratios)}")
    print(f"  light/dark ratio  min={min(ratios):.2f} median={np.median(ratios):.2f} "
          f"max={max(ratios):.2f}")
    print(f"  consistent with 5x?  "
          f"{'YES' if 4.0 <= np.median(ratios) <= 6.0 else 'NO'}")

print()
print("=" * 100)
print("Same test on the warm pair (Rosaceae / Betula): "
      "pink (244,226,226) vs deep red (178,58,59)")
print("=" * 100)
for label, (px0, px1) in [("Betula x445..482", (445, 482)),
                          ("Quercus_D x482..521", (482, 521))]:
    rs = []
    for r in range(plot.shape[0]):
        li = np.where(PINKL[r, px0:px1])[0]
        di = np.where(PINKR[r, px0:px1])[0]
        lw = int(li.max() - li.min() + 1) if len(li) else 0
        dw = int(di.max() - di.min() + 1) if len(di) else 0
        if lw and dw:
            rs.append(lw / dw)
    if rs:
        print(f"  {label:<20} rows={len(rs):>3} ratio median={np.median(rs):.2f} "
              f"min={min(rs):.2f} max={max(rs):.2f}  "
              f"5x? {'YES' if 4.0 <= np.median(rs) <= 6.0 else 'NO'}")

print()
print("=" * 100)
print("Right-edge check: does the LIGHT layer ever fall INSIDE the DARK one?")
print("(an envelope must always be at least as wide as the value it envelops)")
print("=" * 100)
for label, px0, px1, light, dark in [
        ("Quercus_E blue", 521, 582, LIGHT, DARK),
        ("Betula warm", 445, 482, PINKL, PINKR)]:
    inside = 0
    both = 0
    for r in range(plot.shape[0]):
        li = np.where(light[r, px0:px1])[0]
        di = np.where(dark[r, px0:px1])[0]
        if not len(li) or not len(di):
            continue
        both += 1
        if li.max() < di.max():
            inside += 1
    print(f"  {label:<16} rows with both={both:>3}  "
          f"light-inside-dark rows={inside:>3}  "
          f"-> {'envelope is always wider (consistent)' if inside == 0 else 'INCONSISTENT'}")
