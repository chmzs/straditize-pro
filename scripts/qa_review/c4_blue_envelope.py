"""Verify: is (218,226,237) really the exaggerated envelope, and does the
current two_layer_split() put it into the reading?

Two independent checks:
  A. GEOMETRY -- an envelope extends *beyond* the solid on the same row; a solid
     does not.  If (218,226,237) always reaches further right than the deep blue
     (0,62,137), it is the envelope.
  B. PRODUCT -- what does build_foreground(extraction_mode='solid-over-shadow')
     do with those pixels?  That is the mask that would feed a reading.
"""

from __future__ import annotations

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

from straditize_core.image import build_foreground, two_layer_split

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]

BLUE_ENV = (218, 226, 237)
DEEP_BLUE = (0, 62, 137)
PINK_ENV = (244, 226, 226)
DEEP_RED = (178, 58, 59)


def mask_of(c, tol=1):
    return np.abs(plot - np.array(c)).max(-1) <= tol


print("=" * 96)
print("A. GEOMETRY: envelope vs solid on the same row (column Quercus_E, x 521..582)")
print("=" * 96)
x0, x1 = 521, 582
be = mask_of(BLUE_ENV)[:, x0:x1]
db = mask_of(DEEP_BLUE)[:, x0:x1]
print(f"{'row y':>6} | {'blue-env right edge':>19} | {'deep-blue right edge':>20} | "
      f"env beyond solid?")
env_further = 0
solid_further = 0
for r in range(0, plot.shape[0], 20):
    ei = np.where(be[r])[0]
    di = np.where(db[r])[0]
    e = int(ei.max()) + x0 if len(ei) else -1
    d = int(di.max()) + x0 if len(di) else -1
    if e < 0 and d < 0:
        continue
    if e > d:
        env_further += 1
    elif d > e:
        solid_further += 1
    print(f"{PLOT_TOP + r:>6} | {e:>19} | {d:>20} | "
          f"{'YES' if e > d else ('no (solid further)' if d > e else 'n/a')}")
print(f"\n  rows where envelope reaches further right: {env_further}")
print(f"  rows where solid reaches further right  : {solid_further}")
print("  => envelope geometry" if env_further > solid_further
      else "  => NOT envelope geometry")

print()
print("=" * 96)
print("B. PRODUCT: build_foreground(mode='solid-over-shadow') on those colours")
print("=" * 96)
rgba = np.concatenate(
    [rgb.astype(np.uint8), np.full(rgb.shape[:2] + (1,), 255, np.uint8)], axis=-1)
fg_full = build_foreground(rgba, extraction_mode="solid-over-shadow")
fg = fg_full[PLOT_TOP:PLOT_BOTTOM + 1]
parts_full = two_layer_split(rgb)
parts = {k: v[PLOT_TOP:PLOT_BOTTOM + 1] for k, v in parts_full.items()}

print(f"{'colour':<22} {'px in figure':>13} {'in fg mask':>11} {'% of colour':>12}")
print("-" * 96)
for label, c in [("blue envelope", BLUE_ENV), ("pink envelope", PINK_ENV),
                 ("deep blue solid", DEEP_BLUE), ("deep red solid", DEEP_RED),
                 ("grey 229 tint", (229, 229, 229))]:
    m = mask_of(c)
    n = int(m.sum())
    k = int((m & fg).sum())
    print(f"{label:<22} {n:>13} {k:>11} {100.0 * k / n if n else 0:>11.1f}%")

print()
print("two_layer_split() verdict for the same colours:")
print(f"{'colour':<22} {'solid':>9} {'shadow':>9} {'background':>11}")
print("-" * 96)
for label, c in [("blue envelope", BLUE_ENV), ("pink envelope", PINK_ENV),
                 ("deep blue solid", DEEP_BLUE), ("deep red solid", DEEP_RED)]:
    m = mask_of(c)
    print(f"{label:<22} {int((m & parts['solid']).sum()):>9} "
          f"{int((m & parts['shadow']).sum()):>9} "
          f"{int((m & parts['background']).sum()):>11}")

print()
print("=" * 96)
print("VERDICT")
print("=" * 96)
be_n = int(mask_of(BLUE_ENV).sum())
be_solid = int((mask_of(BLUE_ENV) & parts["solid"]).sum())
if be_solid == be_n and be_n > 0:
    print(f"  The blue exaggerated envelope ({BLUE_ENV}, {be_n} px) is classified")
    print("  SOLID by the current two_layer_split().  Under the caption")
    print("  'Shadings are five-fold exaggerated' those pixels are the 5x visual")
    print("  envelope, so this puts shadow into the reading (values x5).")
else:
    print("  blue envelope is not fully solid; see numbers above")
