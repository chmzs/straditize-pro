"""Decisive: is the dark layer a FILL (real value) or an OUTLINE STROKE?

This decides whether the current two_layer_split() classification of the light
blue (218,226,237) as SOLID is a defect.

  H1 (defect):  dark = solid fill (true value); light = 5x exaggerated envelope.
                Then light should be a *wider region containing* dark, and
                classifying light as solid would put the envelope into the reading.
  H2 (no defect): light = the filled area (true value); dark = its outline stroke.
                Then dark should be a thin boundary of light, and classifying
                light as solid is correct.

Three discriminating measurements:
  T1  containment:   is dark  subset-of  light ?      (H2 predicts yes)
  T2  stroke-ness:   is dark's thickness ~constant and small?  (H2 predicts yes)
  T3  baseline:      does dark start AT the column's left axis?  (H1 predicts yes;
                     an outline stroke sits at the region boundary instead)
"""

from __future__ import annotations

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
lum = plot.mean(-1)


def m(c, tol=1):
    return np.abs(plot - np.array(c)).max(-1) <= tol


PAIRS = [
    ("Quercus_E / Rosaceae / Chenopodiaceae (cool)",
     (0, 62, 137), (218, 226, 237), [(521, 582), (582, 619), (619, 657)]),
    ("Betula / Quercus_D (warm)",
     (178, 58, 59), (244, 226, 226), [(445, 482), (482, 521)]),
]

for label, dark_c, light_c, bands in PAIRS:
    dark = m(dark_c)
    light = m(light_c)
    print("=" * 100)
    print(f"{label}")
    print(f"  dark={dark_c}  light={light_c}")
    print("=" * 100)

    # ---- T1 containment ------------------------------------------------------
    d_in_l = int((dark & light).sum())
    d_tot = int(dark.sum())
    print(f"  T1 containment: dark px={d_tot}, of which inside light={d_in_l} "
          f"({100.0 * d_in_l / d_tot if d_tot else 0:.1f}%)")
    print(f"     H2 (dark = outline of light) predicts ~100%")
    print(f"     H1 (dark = separate fill) predicts much less")

    # ---- T2 stroke-ness: dark run length distribution ------------------------
    widths = []
    for x0, x1 in bands:
        for r in range(plot.shape[0]):
            idx = np.where(dark[r, x0:x1])[0]
            if len(idx):
                widths.append(int(idx.max() - idx.min() + 1))
    if widths:
        w = np.array(widths)
        print(f"  T2 dark run width: n={len(w)} min={w.min()} median={np.median(w)} "
              f"max={w.max()} std={w.std():.2f}")
        print(f"     a constant-width outline stroke would give a tiny std")
    # same for light
    lw = []
    for x0, x1 in bands:
        for r in range(plot.shape[0]):
            idx = np.where(light[r, x0:x1])[0]
            if len(idx):
                lw.append(int(idx.max() - idx.min() + 1))
    if lw:
        w2 = np.array(lw)
        print(f"     light run width: n={len(w2)} min={w2.min()} "
              f"median={np.median(w2)} max={w2.max()}")

    # ---- T3 baseline anchoring ----------------------------------------------
    print(f"  T3 baseline anchoring (does each layer start at the column axis?):")
    for x0, x1 in bands:
        d_left, l_left = [], []
        for r in range(plot.shape[0]):
            di = np.where(dark[r, x0:x1])[0]
            li = np.where(light[r, x0:x1])[0]
            if len(di):
                d_left.append(int(di.min()))
            if len(li):
                l_left.append(int(li.min()))
        if d_left and l_left:
            print(f"     band x[{x0},{x1}): dark starts at median offset "
                  f"{np.median(d_left):.1f} px from axis, "
                  f"light starts at {np.median(l_left):.1f} px")
            print(f"       -> dark anchored to axis? "
                  f"{'YES (median offset <=2)' if np.median(d_left) <= 2 else 'NO'}; "
                  f"light anchored? "
                  f"{'YES' if np.median(l_left) <= 2 else 'NO'}")
    print()
