"""Full colour census per column, restricted to non-white pixels.

Purpose: find out what the *actual* solid-fill colour is in each column, so we
can test whether "luminance <= 150" (Lead's proxy for solid fill) selects it.
"""

from __future__ import annotations

import collections

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb()
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1, :, :]

for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    sub = plot[:, x0:x0 + w, :].reshape(-1, 3).astype(float)
    lum = sub.mean(axis=1)
    keep = lum <= 245.0            # drop the white paper
    kept = sub[keep]
    cnt = collections.Counter(map(tuple, kept.astype(int).tolist()))
    print(f"--- col {i:>2} {name:<17} box x[{x0},{x0+w}) w={w}  "
          f"non-white px={kept.shape[0]}")
    for c, n in cnt.most_common(10):
        l = (c[0] + c[1] + c[2]) / 3.0
        print(f"      RGB{c}  lum={l:6.1f}  n={n:>6}  "
              f"{100.0 * n / kept.shape[0]:5.1f}% of non-white")
    print()
