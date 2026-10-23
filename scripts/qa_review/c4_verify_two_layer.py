"""Verify the NEW two_layer_split() (image.py @ 003b6d00) on known colours.

The synthetic gate found that a pink envelope (244,226,226) drawn next to a deep
red solid is classified as SOLID, not shadow.  The same two colours exist in the
real figure.  This script asks the product directly where each known colour goes.

Ground truth for the real figure (from the figure caption: "Shadings are
five-fold exaggerated"):
  * (244,226,226) and (218,226,237) are SHADOW (the 5x envelope)
  * (229,229,229) is the plot-area background tint, not data
  * (0,0,0), (178,58,59), (0,62,137), (182,182,182) are ink/solid
"""

from __future__ import annotations

import numpy as np
from common import FIG, load_rgb

from straditize_core.image import grey_matrix, two_layer_split

rgb = load_rgb().astype(float)
parts = two_layer_split(rgb)

print("image.py two_layer_split() on the real figure")
print("=" * 92)
print(f"{'colour':<20} {'lum(grey)':>10} {'chroma':>7} {'px':>9} | "
      f"{'solid':>9} {'shadow':>9} {'background':>11} | verdict")
print("-" * 92)

KNOWN = {
    "pink envelope": (244, 226, 226),
    "blue envelope": (218, 226, 237),
    "grey 229 tint": (229, 229, 229),
    "grey 242": (242, 242, 242),
    "white paper": (255, 255, 255),
    "black ink": (0, 0, 0),
    "deep red solid": (178, 58, 59),
    "deep blue solid": (0, 62, 137),
    "grey 182 fill": (182, 182, 182),
    "orange fill": (255, 177, 34),
}

for label, c in KNOWN.items():
    m = (np.abs(rgb - np.array(c)).max(-1) <= 1)
    n = int(m.sum())
    if n == 0:
        print(f"{label:<20} {'':>10} {'':>7} {0:>9} | (colour absent)")
        continue
    s = int((m & parts["solid"]).sum())
    h = int((m & parts["shadow"]).sum())
    b = int((m & parts["background"]).sum())
    g = float(grey_matrix(np.array([[c]], dtype=float))[0, 0])
    chroma = max(c) - min(c)
    if s == n:
        verdict = "-> SOLID (enters the reading)"
    elif h == n:
        verdict = "-> shadow (correct)"
    elif b == n:
        verdict = "-> background (correct)"
    else:
        verdict = f"-> SPLIT s={s} h={h} b={b}"
    print(f"{label:<20} {g:>10.1f} {chroma:>7} {n:>9} | "
          f"{s:>9} {h:>9} {b:>11} | {verdict}")

print()
print("=" * 92)
print("Aggregate")
print("=" * 92)
for k in ("background", "shadow", "solid", "content_neutral"):
    if k in parts:
        print(f"  {k:<18} {int(parts[k].sum()):>9} px  "
              f"({100.0 * parts[k].mean():.1f}% of image)")

# --- white point that drives the shadow/paper boundary ----------------------
lum = grey_matrix(rgb)
chroma = rgb.max(-1) - rgb.min(-1)
neutral = chroma <= 32.0
pop = lum[neutral & (lum >= 180.0)]
print()
print("white-point derivation (as two_layer_split computes it with "
      "column_edges=None):")
print(f"  population (neutral & lum>=180) = {pop.size} px")
print(f"  95th percentile (= paper_level) = {np.percentile(pop, 95):.2f}")
pl = float(np.percentile(pop, 95))
print(f"  near_paper cut = paper_level * 0.93 = {pl * 0.93:.2f}")
print(f"  pink envelope lum = {grey_matrix(np.array([[[244,226,226]]], dtype=float))[0,0]:.2f}"
      f"  -> {'ABOVE cut' if 231.38 >= pl*0.93 else 'below cut'}"
      f"  ({'classified solid' if 231.38 >= pl*0.93 else 'classified shadow'})")
print(f"  grey 229 lum = {grey_matrix(np.array([[[229,229,229]]], dtype=float))[0,0]:.2f}"
      f"  -> {'ABOVE cut' if 229 >= pl*0.93 else 'below cut'}"
      f"  ({'classified solid' if 229 >= pl*0.93 else 'classified shadow'})")
