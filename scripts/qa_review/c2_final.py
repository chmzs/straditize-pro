"""C2 (correct definition) + C3 + C4 + C5.

C2: the object under test is the *solid fill layer*.  Definition used here is
    colour-family based, NOT luminance based:
      * in each column box, collect horizontal runs >= 3 px wide (a real fill
        forms wide runs; antialiasing forms 1-2 px runs);
      * cluster them into families by exact RGB, weighted by count;
      * the SOLID family = the one with the lower mean luminance;
        the SHADOW family = the higher one.
    Then measure how much of the SOLID family the product's Otsu(138) mask keeps.

    This is done because Lead's own reference ("luminance <= 150") is a *proxy*,
    and a proxy must be validated against the object before being trusted.
"""

from __future__ import annotations

import collections
import json

import numpy as np
from common import LEAD_COLUMNS, PLOT_BOTTOM, PLOT_TOP, load_rgb, my_otsu_skimage_equivalent

rgb = load_rgb().astype(float)
plot = rgb[PLOT_TOP:PLOT_BOTTOM + 1]
H, W = plot.shape[:2]
lum = plot.mean(-1)
nw = lum <= 250
OTSU = 138.0

report: dict[str, object] = {"otsu_threshold": OTSU, "columns": []}


def wide_runs(r: int, x0: int, x1: int, minw: int = 3):
    seg = nw[r, x0:x1]
    out = []
    k, n = 0, seg.shape[0]
    while k < n:
        if seg[k]:
            s = k
            while k < n and seg[k]:
                k += 1
            if k - s >= minw:
                out.append((s, k))
        else:
            k += 1
    return out


print("=" * 112)
print("C2: solid-fill coverage under the product's Otsu(138) mask")
print("    solid family := lower-luminance wide-run colour family in the column box")
print("=" * 112)
print(f"{'#':>3} {'name':<17} | {'SOLID family':<18} {'lum':>6} {'n':>7} "
      f"| {'Otsu-kept':>9} {'cov':>7} | {'SHADOW family':<18} {'lum':>6}")
print("-" * 112)

for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    x1 = x0 + w
    fam = collections.Counter()
    for r in range(H):
        for s, e in wide_runs(r, x0, x1):
            for k in range(s, e):
                fam[tuple(plot[r, x0 + k].astype(int).tolist())] += 1
    # merge near-identical colours into families (tolerance 6) to survive JPEG noise
    groups: list[list] = []
    for c, n in fam.most_common():
        placed = False
        for g in groups:
            if max(abs(c[k] - g[0][k]) for k in range(3)) <= 6:
                g[1] += n
                g[2].append((c, n))
                placed = True
                break
        if not placed:
            groups.append([c, n, [(c, n)]])
    groups.sort(key=lambda g: -g[1])
    top2 = groups[:2]
    if len(top2) < 2:
        top2 = top2 + [[(0, 0, 0), 0, []]]
    (cA, nA, _), (cB, nB, _) = top2
    lumA = sum(cA) / 3.0
    lumB = sum(cB) / 3.0
    if lumA <= lumB:
        solid, shadow = cA, cB
        n_solid, lum_solid = nA, lumA
        lum_shadow = lumB
    else:
        solid, shadow = cB, cA
        n_solid, lum_solid = nB, lumB
        lum_shadow = lumA

    # measure Otsu coverage over ALL pixels matching the solid family (tol 6)
    mask = (np.abs(plot[:, x0:x1] - np.array(solid)).max(-1) <= 6)
    kept = int((mask & (lum[:, x0:x1] < OTSU)).sum())
    cov = 100.0 * kept / int(mask.sum()) if mask.sum() else float("nan")
    print(f"{i:>3} {name:<17} | RGB{str(solid):<14} {lum_solid:>6.1f} {n_solid:>7} "
          f"| {kept:>9} {cov:>6.1f}% | RGB{str(shadow):<14} {lum_shadow:>6.1f}")
    report["columns"].append({
        "col": i, "name": name, "x0": x0, "w": w,
        "solid_family": list(solid), "solid_lum": round(lum_solid, 1),
        "shadow_family": list(shadow), "shadow_lum": round(lum_shadow, 1),
        "solid_px": int(mask.sum()), "otsu_kept": kept, "coverage_pct": round(cov, 2),
    })

print()
print("=" * 112)
print("C2-BIS: audit of Lead's proxy 'luminance <= 150' as the solid reference")
print("=" * 112)
print(f"{'#':>3} {'name':<17} | {'lum<=150 px':>11} {'Otsu<138 px':>11} {'cov':>7} "
      f"| {'does <=150 cover the SOLID family?':<38}")
print("-" * 112)
for i, (name, x0, w) in enumerate(LEAD_COLUMNS, 1):
    x1 = x0 + w
    ref = lum[:, x0:x1] <= 150.0
    kept = int((ref & (lum[:, x0:x1] < OTSU)).sum())
    nref = int(ref.sum())
    cov = 100.0 * kept / nref if nref else float("nan")
    rec = report["columns"][i - 1]
    solid = np.array(rec["solid_family"])
    solid_lum = rec["solid_lum"]
    covered = solid_lum <= 150.0
    verdict = ("YES" if covered else
               f"NO - solid lum {solid_lum} > 150, proxy MISSES the fill")
    print(f"{i:>3} {name:<17} | {nref:>11} {kept:>11} {cov:>6.1f}% | {verdict}")
    report["columns"][i - 1]["proxy_covers_solid"] = bool(covered)
    report["columns"][i - 1]["proxy_cov_pct"] = round(cov, 2)

with open("scripts/qa_review/out_c2.json", "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
print("\nwrote scripts/qa_review/out_c2.json")
