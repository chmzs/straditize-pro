"""C3 + C4 + C5 + P9 + P10 + P11 in one pass.

C3  : per-column tick spacing and cell count (product's own ruler detector)
C4  : split_solid_and_shadow() -- solid & shadow mutually exclusive?
C5  : light_overlay_colored_mask() -- is (218,226,237) judged "coloured"?
P9  : is the tick spacing really ~12.3 px on every column?
P10 : does a pair of columns exist with near-equal spacing but >50% range gap?
P11 : does suggest_scales()'s confidence gate actually block misuse?
"""

from __future__ import annotations

import json

import numpy as np
from common import FIG, LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_gray, load_rgb

gray = load_gray()
rgb = load_rgb().astype(float)

out: dict[str, object] = {}

print("=" * 100)
print("C3 / P9: tick spacing per column (product's straditize_core.ruler)")
print("=" * 100)
from straditize_core import ruler  # noqa: E402

per = []
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    geo = ruler.detect_ruler(gray, x0, x0 + w)
    per.append(geo | {"col": i, "name": name})
    print(f"{i:>3} {name:<17} x[{x0},{x0+w}) | axis_row={geo['axis_row']} "
          f"n_ticks={len(geo['ticks'])} n_cells={geo['n_cells']} "
          f"spacing={geo['spacing_px']} regular={geo['regular']}")
out["C3_per_column"] = per

sp = [g["spacing_px"] for g in per if g["spacing_px"]]
print()
print(f"  columns with a measurable spacing: {len(sp)} / 15")
if sp:
    print(f"  spacing min={min(sp)} max={max(sp)} median={np.median(sp)}")
    print(f"  all within 12.3 +/- 0.5 ? "
          f"{all(abs(s - 12.3) <= 0.5 for s in sp)}")
    print(f"  spacings: {sp}")

print()
print("=" * 100)
print("C4: split_solid_and_shadow() mutual exclusivity")
print("=" * 100)
from straditize_core.image import split_solid_and_shadow  # noqa: E402

solid, shadow = split_solid_and_shadow(rgb)
overlap = int((solid & shadow).sum())
union = int((solid | shadow).sum())
print(f"  solid px  = {int(solid.sum())}")
print(f"  shadow px = {int(shadow.sum())}")
print(f"  overlap   = {overlap}   (claim: 0)")
print(f"  union     = {union}")
print(f"  exclusive? {overlap == 0}")
out["C4"] = {"solid": int(solid.sum()), "shadow": int(shadow.sum()),
             "overlap": overlap, "exclusive": bool(overlap == 0)}

# also test on the full 2-D, and per-column on the figure
print()
print("  per-column solid/shadow on the real figure:")
print(f"  {'#':>3} {'name':<17} {'solid':>8} {'shadow':>8} {'overlap':>8}")
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    s = solid[PLOT_TOP:PLOT_BOTTOM + 1, x0:x0 + w]
    h = shadow[PLOT_TOP:PLOT_BOTTOM + 1, x0:x0 + w]
    print(f"  {i:>3} {name:<17} {int(s.sum()):>8} {int(h.sum()):>8} "
          f"{int((s & h).sum()):>8}")

print()
print("=" * 100)
print("C5: light_overlay_colored_mask() on the two shadow colours")
print("=" * 100)
from straditize_core.image import light_overlay_colored_mask  # noqa: E402

tests = {
    "light pink shadow  (244,226,226)": (244, 226, 226),
    "light blue shadow  (218,226,237)": (218, 226, 237),
    "white              (255,255,255)": (255, 255, 255),
    "orange fill        (255,177,34)": (255, 177, 34),
    "grey fill          (182,182,182)": (182, 182, 182),
    "deep blue          (0,62,137)": (0, 62, 137),
}
print(f"  {'colour':<34} {'sat':>6} {'>=0.08 ?':>9}")
c5 = {}
for label, c in tests.items():
    arr = np.array([[list(c)]], dtype=float)
    m = bool(light_overlay_colored_mask(arr)[0, 0])
    mx, mn = max(c), min(c)
    sat = (mx - mn) / mx if mx > 0 else 0.0
    print(f"  {label:<34} {sat:>6.3f} {str(m):>9}")
    c5[label] = {"sat": round(sat, 4), "is_coloured": m}
out["C5"] = c5

print()
print("=" * 100)
print("P10 / P11: does suggest_scales() block the extrapolation misuse?")
print("=" * 100)
from straditize_core.ruler import suggest_scales  # noqa: E402

sug = suggest_scales(per, anchor_col_index=11, anchor_full_scale=70.07)
print(f"  {'#':>3} {'name':<17} {'n_cells':>8} {'spacing':>8} "
      f"{'suggested':>10} {'confidence':>11}")
for s in sug:
    print(f"  {str(s['col_index']):>3} {str(s['name']):<17} {s['n_cells']:>8} "
          f"{str(s['spacing_px']):>8} {str(s['suggested_full_scale']):>10} "
          f"{str(s['confidence']):>11}")
out["P11_suggest_scales"] = sug

any_number = any(s["suggested_full_scale"] is not None for s in sug)
any_high = any(s["confidence"] == "high" for s in sug)
print()
print(f"  emits any numeric full scale? {any_number}   (Lead claims: no)")
print(f"  emits any 'high' confidence?  {any_high}    (Lead claims: no)")

with open("scripts/qa_review/out_c345_p.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2, default=str)
print("\nwrote scripts/qa_review/out_c345_p.json")
