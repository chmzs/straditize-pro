"""C1: is the product's default extract_foreground() Otsu threshold 138.0?

Two independent routes:
  (a) call the *product* method on a real session loaded with the figure;
  (b) compute Otsu myself, both a textbook integer-threshold variant and a
      skimage-bin-centre variant, to see which one the product's number matches.
"""

from __future__ import annotations

import numpy as np
from common import FIG, load_gray, my_otsu, my_otsu_skimage_equivalent

from straditize_core.session import StraditizeSession

gray = load_gray()

print("=== (b) my own Otsu on PIL grey of the figure ===")
print("  textbook integer-threshold Otsu :", my_otsu(gray))
print("  skimage bin-centre equivalent   :", my_otsu_skimage_equivalent(gray))

print()
print("=== (b2) my own Otsu via numpy on the product's own grey pipeline ===")
from PIL import Image  # noqa: E402

img = Image.open(FIG).convert("RGB")
g2 = np.array(img.convert("L"))
print("  same array as PIL grey?          :", bool(np.array_equal(g2, gray)))

print()
print("=== (a) product route: StraditizeSession.extract_foreground() ===")
s = StraditizeSession()
res = s.load_image(str(FIG))
print("  load_image                      :", {k: res[k] for k in ("success", "width", "height")})
out = s.extract_foreground()
print("  extract_foreground()            :", out)

# What threshold does the *product* itself report, and does `gray < thresh`
# reproduce the product's own foreground pixel count?
th = float(out["threshold"])
prod_mask = gray < th
print()
print("=== consistency check: does `gray < reported_thresh` equal the product mask? ===")
print("  product foreground_pixels       :", out["foreground_pixels"])
print("  my  (gray < thresh).sum()       :", int(prod_mask.sum()))
print("  identical mask?                 :",
      bool(np.array_equal(prod_mask, s.foreground_mask)))

# Otsu via skimage directly, to pin which implementation produced 138.0
try:
    from skimage.filters import threshold_otsu

    print("  skimage.threshold_otsu(gray)    :", float(threshold_otsu(gray)))
except Exception as exc:  # noqa: BLE001
    print("  skimage unavailable:", exc)
