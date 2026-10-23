"""Find the rotation angle of the slanted column labels, then render them flat.

The label text is slanted; to read it we must deskew it.  The correct angle is
the one that maximises the variance of the horizontal ink projection (text
becomes horizontal -> rows separate into strong/weak).
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from common import FIG

im = Image.open(FIG).convert("L")
band = im.crop((0, 0, 2132, 232))

best = None
for ang10 in range(-600, 601, 10):
    ang = ang10 / 10.0
    r = band.rotate(ang, expand=True, fillcolor=255, resample=Image.BICUBIC)
    a = np.asarray(r, dtype=float)
    ink = (a < 200).sum(1).astype(float)
    score = float(ink.var())
    if best is None or score > best[0]:
        best = (score, ang, ink)
print(f"best rotation angle = {best[1]} deg (projection variance {best[0]:.1f})")

ang = best[1]
r = band.rotate(ang, expand=True, fillcolor=255, resample=Image.BICUBIC)
r.save("scripts/qa_review/topband_deskewed.png")
print("saved scripts/qa_review/topband_deskewed.png", r.size)

# also render at the discovered angle in slices so text is readable
w, h = r.size
for k in range(0, 4):
    sl = r.crop((0, k * h // 4, w, (k + 1) * h // 4))
    sl = sl.resize((sl.width * 2, sl.height * 2), Image.LANCZOS)
    sl.save(f"scripts/qa_review/top_deskew_{k}.png")
print("saved 4 slices")
