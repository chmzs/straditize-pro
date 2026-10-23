"""Minimal synthetic probe: where does two_layer_split() put each colour?

Built after the synthetic gate flagged a disagreement between the real figure
and a synthetic canvas for the SAME shadow colour.  A minimal canvas removes
every confound (JPEG noise, column bands, structure lines) so the rule itself is
what is being measured.
"""

from __future__ import annotations

import numpy as np

from straditize_core.image import grey_matrix, two_layer_split

W, H = 120, 200


def canvas(regions):
    a = np.full((H, W, 3), 255, dtype=np.uint8)
    for x0, x1, c in regions:
        a[:, x0:x1] = c
    return a


PINK = (244, 226, 226)
BLUE = (218, 226, 237)
GREY229 = (229, 229, 229)
RED = (178, 58, 59)
DEEPBLUE = (0, 62, 137)
BLACK = (0, 0, 0)

CASES = {
    "pink envelope alone":        [(20, 70, PINK)],
    "pink envelope + red solid":  [(20, 70, PINK), (20, 60, RED)],
    "blue envelope alone":        [(20, 70, BLUE)],
    "blue envelope + deepblue":   [(20, 70, BLUE), (20, 60, DEEPBLUE)],
    "grey229 alone":              [(20, 70, GREY229)],
    "grey229 + black solid":      [(20, 70, GREY229), (20, 60, BLACK)],
}

print("=" * 96)
print("two_layer_split() on minimal synthetic canvases")
print("=" * 96)
for name, regs in CASES.items():
    a = canvas(regs)
    parts = two_layer_split(a.astype(float))
    lum = grey_matrix(a.astype(float))
    ch = a.astype(float).max(-1) - a.astype(float).min(-1)
    neu = ch <= 32.0
    pop = lum[neu & (lum >= 180.0)]
    pl = float(np.percentile(pop, 95)) if pop.size else 255.0
    print(f"--- {name}")
    print(f"    paper_level={pl:.2f}  near_paper_cut={pl * 0.93:.2f}  "
          f"white_point_pop={pop.size}px")
    for x0, x1, c in regs:
        m = np.zeros(a.shape[:2], dtype=bool)
        m[:, x0:x1] = True
        s = int((m & parts["solid"]).sum())
        h = int((m & parts["shadow"]).sum())
        b = int((m & parts["background"]).sum())
        g = float(grey_matrix(np.array([[c]], dtype=float))[0, 0])
        verdict = ("SOLID -> enters the reading"
                   if s == m.sum() else
                   "shadow" if h == m.sum() else
                   "background" if b == m.sum() else f"SPLIT s={s} h={h} b={b}")
        print(f"    RGB{c} lum={g:6.2f} chroma={max(c)-min(c):>3} "
              f"n={int(m.sum()):>6} solid={s:>6} shadow={h:>6} bg={b:>6} -> {verdict}")
    print()

print("=" * 96)
print("Rule read-out (from source):")
print("  near_paper = lum >= paper_level * 0.93   [paper_level = 95th pct of "
      "neutral & lum>=180]")
print("  shadow     = near_paper & neutral & ~structure & ~paper")
print("  pale_chromatic requires ~neutral (chroma > 32)")
print("=" * 96)
for label, c in [("pink envelope", PINK), ("blue envelope", BLUE),
                 ("grey229", GREY229), ("white paper", (255, 255, 255))]:
    g = float(grey_matrix(np.array([[c]], dtype=float))[0, 0])
    ch = max(c) - min(c)
    print(f"  {label:<16} lum={g:6.2f} chroma={ch:>3} neutral={ch <= 32} "
          f"near_paper(>=237.15)={g >= 237.15}")
