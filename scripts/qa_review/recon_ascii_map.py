"""Colour-class ASCII map of the right-hand end of the plot area.

Purpose: "see" the actual structure without trusting any threshold or any
inherited column table.  Classes are colour-based, not luminance-based.
"""

from __future__ import annotations

import numpy as np
from common import PLOT_BOTTOM, PLOT_TOP, load_rgb

rgb = load_rgb().astype(float)

X0, X1 = 1180, 1400
Y0, Y1 = 232, 862
DX, DY = 4, 10

sub = rgb[Y0:Y1, X0:X1]


def classify(px: np.ndarray) -> str:
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    lum = (r + g + b) / 3.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    sat = np.divide(chroma, mx, out=np.zeros_like(mx), where=mx > 0)
    out = np.full(px.shape[:-1], " ", dtype="<U1")
    out[lum < 100] = "#"
    grey = (lum >= 100) & (lum <= 246) & (chroma <= 12)
    out[grey] = "g"
    warm = (chroma > 12) & (r >= g) & (g >= b)          # red/orange/yellow
    cool = (chroma > 12) & (b > g)                        # blue/cyan
    out[warm] = "O"
    out[cool] = "B"
    out[(lum > 246) & (chroma <= 12)] = " "
    return out


cls = classify(sub)
print(f"map of x[{X0},{X1}) y[{Y0},{Y1})  step x={DX} y={DY}")
print("legend: ' '=white  '#'=dark(lum<100)  'g'=grey mid  "
      "'O'=warm colour  'B'=cool colour")
print()
# column ruler header
hdr = "".join("|" if (X0 + c * DX) % 100 < DX else " "
              for c in range((X1 - X0) // DX))
print("      " + hdr)
# x labels
lab = [" "] * ((X1 - X0) // DX)
for c in range((X1 - X0) // DX):
    x = X0 + c * DX
    if x % 100 < DX:
        s = str(x)
        for k, ch in enumerate(s):
            if c + k < len(lab):
                lab[c + k] = ch
print("      " + "".join(lab))
print()

for r in range(0, Y1 - Y0, DY):
    block = cls[r:r + DY]
    # per x-cell: dominant class
    line = []
    for c in range((X1 - X0) // DX):
        cell = block[:, c * DX:(c + 1) * DX].ravel()
        vals, counts = np.unique(cell, return_counts=True)
        # prefer a non-white class if it occupies >=30% of the cell
        best = " "
        for v, n in zip(vals, counts):
            if v != " " and n / cell.size >= 0.30:
                best = v
                break
        line.append(best)
    print(f"{Y0 + r:>5} " + "".join(line))
