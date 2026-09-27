"""Generate ground truth for the T00 probe tickets.

Ground truth must be derived from a **stated rule**, never from the implementation
under test -- otherwise a probe author can grade their own homework. Every file
written here records:

* the source image and its sha256 (so a probe cannot silently use another image),
* the derivation rule in prose,
* the resulting data.

Run:  pixi run python support/probe_truth/gen_ground_truth.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "probe_truth"

IMAGES = {
    "exaggeration_bell": ROOT / "tests/test_figures/benchmark_types/type2_exaggeration_bell.png",
    "composite_cluster": ROOT / "tests/test_figures/benchmark_types/type6_composite_zonation_cluster.png",
    "filled_silhouette": ROOT / "tests/test_figures/benchmark_types/type1_filled_silhouette_aber.png",
    "hoya": ROOT / "straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------
# T00-a  exaggeration layers
# --------------------------------------------------------------------------
# Rule: the four layer colours are exact flat fills in the source figure. A pixel
# belongs to a layer iff its RGB is within LAYER_TOL of that layer's colour.
# This is objective (the colours are constants of the generating script), and it
# does NOT consult any segmentation algorithm.
LAYER_TOL = 12
LAYERS = {
    "true_green": [34, 139, 34],
    "exag_green": [143, 197, 143],
    "true_yellow": [238, 201, 0],
    "exag_yellow": [247, 228, 126],
}


def layer_truth(path: Path) -> dict:
    rgb = np.array(Image.open(path).convert("RGB")).astype(int)
    out = {}
    for name, colour in LAYERS.items():
        m = np.abs(rgb - np.array(colour)).sum(axis=2) <= LAYER_TOL
        ys, xs = np.where(m)
        out[name] = {
            "colour": colour,
            "pixels": int(m.sum()),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if m.any() else None,
        }
    return out


# --------------------------------------------------------------------------
# T00-b  x-axis tick marks
# --------------------------------------------------------------------------
# Two INDEPENDENT rules are run and their agreement is recorded. A tick is a short
# vertical stroke in the tick band. Only strokes that both rules agree on enter
# the ground truth; disagreements are reported so the ticket cannot hide them.
TICK_BAND_HEIGHT = 9  # rows a tick stroke spans
TICK_MAX_RUN = TICK_BAND_HEIGHT + 3  # a tick is a short stroke, not a line


def _merge_adjacent(xs: list[int], gap: int = 2) -> list[int]:
    if not xs:
        return []
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= gap:
            cur.append(x)
        else:
            groups.append(int(round(float(np.mean(cur)))))
            cur = [x]
    groups.append(int(round(float(np.mean(cur)))))
    return groups


def _col_run_through(dark: np.ndarray, x: int, y_ref: int) -> int:
    """Absolute length of the vertical dark run containing ``(y_ref, x)``."""
    h = dark.shape[0]
    if not dark[y_ref, x]:
        return 0
    a = b = y_ref
    while a - 1 >= 0 and dark[a - 1, x]:
        a -= 1
    while b + 1 < h and dark[b + 1, x]:
        b += 1
    return b - a + 1


def _detect_tick_band(gray: np.ndarray) -> tuple[int, int] | None:
    """Locate a band of **short isolated vertical strokes** (an x-axis tick ruler).

    Stated geometric rule:
      1. the band's per-column darkness is bimodal (>= 0.97 of columns are either
         almost fully dark or almost fully light);
      2. **every** stroke column's absolute vertical run through the band centre is
         ``<= TICK_MAX_RUN`` -- a tick, not a column baseline passing through;
      3. at least 3 stroke columns, at most half the image width.

    **v1.1 fix**: the first version dropped requirement 2, so it also matched bands
    of *long column baselines* crossing them. That is exactly what happened to
    ``type1_filled_silhouette_aber.png`` (median "stroke" length 64 px, max 333 px)
    and ``hoya`` (median 149 px, max 1162 px): their supposed ticks were baselines.
    The T00-b probe surfaced this; a figure with no tick ruler legitimately has no
    ticks, and reporting 35 fake ones is worse than reporting 0.
    """
    h, w = gray.shape
    dark = gray < 160
    best: tuple[int, float, int] | None = None

    for top in range(int(h * 0.70), h - TICK_BAND_HEIGHT):
        band = dark[top : top + TICK_BAND_HEIGHT, :]
        col_fill = band.mean(axis=0)
        stroke = col_fill > 0.95
        n_strokes = int(stroke.sum())
        if n_strokes < 3 or n_strokes > int(w * 0.5):
            continue
        bimodal = float(((col_fill > 0.95) | (col_fill < 0.05)).mean())
        if bimodal < 0.97:
            continue
        y_ref = top + TICK_BAND_HEIGHT // 2
        if any(_col_run_through(dark, x, y_ref) > TICK_MAX_RUN for x in np.where(stroke)[0]):
            continue  # a line passes through -> this is data, not a ruler
        if best is None or bimodal > best[1] or (bimodal == best[1] and n_strokes > best[2]):
            best = (top, bimodal, n_strokes)

    return None if best is None else (best[0], best[0] + TICK_BAND_HEIGHT)


def tick_truth(path: Path) -> dict:
    gray = np.array(Image.open(path).convert("L"))
    band = _detect_tick_band(gray)
    if band is None:
        # No tick ruler found. That is a legitimate outcome (some figures have no
        # tick comb, or their band is crossed by long baselines) and must be
        # reported as such rather than padded with fake ticks.
        return {
            "band": None,
            "has_tick_ruler": False,
            "ticks": [],
            "count": 0,
            "rule_a_count": 0,
            "rule_b_count": 0,
            "agreement": None,
        }

    top, bottom = band
    sub = gray[top:bottom, :] < 160

    # Rule A: a column is a tick iff every row of the band is dark there.
    rule_a = _merge_adjacent(np.where(sub.all(axis=0))[0].tolist())

    # Rule B: connected runs of "mostly dark" columns, then keep runs whose width
    # is stroke-like (<= 4 px). Independent of Rule A's all-dark requirement.
    mostly = sub.mean(axis=0) > 0.6
    runs, start = [], None
    for x, v in enumerate(mostly):
        if v and start is None:
            start = x
        elif not v and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, len(mostly) - 1))
    rule_b = [
        int(round((a + b) / 2.0))
        for a, b in runs
        if 1 <= (b - a + 1) <= 4
    ]
    rule_b = _merge_adjacent(rule_b, gap=1)

    # Agreement: a Rule B tick counts as confirmed if some Rule A tick is within 1 px.
    confirmed = [x for x in rule_b if any(abs(x - a) <= 1 for a in rule_a)]
    only_a = [a for a in rule_a if not any(abs(a - b) <= 1 for b in rule_b)]

    return {
        "band": [int(top), int(bottom)],
        "has_tick_ruler": True,
        "ticks": confirmed,
        "count": len(confirmed),
        "rule_a_only": only_a,
        "rule_a_count": len(rule_a),
        "rule_b_count": len(rule_b),
        "agreement": round(len(confirmed) / max(1, max(len(rule_a), len(rule_b))), 4),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}

    for key, path in IMAGES.items():
        if not path.is_file():
            print(f"SKIP {key}: {path} not found")
            continue
        digest = sha256(path)
        w, h = Image.open(path).size

        layers = layer_truth(path)
        with open(OUT / f"{key}__exaggeration_layers.json", "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "image": str(path.relative_to(ROOT)).replace("\\", "/"),
                    "sha256": digest,
                    "size": [w, h],
                    "rule": (
                        "A pixel belongs to a layer iff its RGB is within "
                        f"{LAYER_TOL} (sum of absolute differences) of that layer's exact colour. "
                        "Colours are constants of the generating script, not of any algorithm."
                    ),
                    "layers": layers,
                },
                fh,
                indent=2,
            )

        ticks = tick_truth(path)
        with open(OUT / f"{key}__x_ticks.json", "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "image": str(path.relative_to(ROOT)).replace("\\", "/"),
                    "sha256": digest,
                    "size": [w, h],
                    "rule": (
                        "Band rule: the band's per-column darkness is bimodal (>=0.97 of columns "
                        "almost fully dark or almost fully light), >=3 stroke columns, at most half "
                        f"the width, AND every stroke column's absolute vertical run <= {TICK_MAX_RUN} px "
                        "(a short isolated tick, not a column baseline crossing the band). "
                        "Tick rule A: a column is a tick iff every row of the band is dark (<160). "
                        "Rule B: runs of columns with >60% dark rows whose width is 1..4 px. "
                        "Ground truth keeps only strokes confirmed by BOTH rules within 1 px. "
                        "If no band satisfies the band rule, has_tick_ruler is false and there are no ticks."
                    ),
                    "band": ticks["band"],
                    "has_tick_ruler": ticks.get("has_tick_ruler", False),
                    "ticks": ticks["ticks"],
                    "count": ticks.get("count", 0),
                    "rule_a_count": ticks.get("rule_a_count"),
                    "rule_b_count": ticks.get("rule_b_count"),
                    "agreement": ticks.get("agreement"),
                },
                fh,
                indent=2,
            )

        index[key] = {
            "sha256": digest,
            "size": [w, h],
            "has_tick_ruler": ticks.get("has_tick_ruler", False),
            "ticks": ticks.get("count", 0),
        }
        print(f"{key:20s} {w}x{h}  ruler={ticks.get('has_tick_ruler')!s:5s} ticks={ticks.get('count', 0):3d} "
              f"(A={ticks.get('rule_a_count')} B={ticks.get('rule_b_count')} "
              f"agree={ticks.get('agreement')})")
        for lname, linfo in layers.items():
            print(f"    {lname:12s} {linfo['pixels']:8d} px  {linfo['colour']}")

    with open(OUT / "index.json", "w", encoding="utf-8") as fh:
        json.dump({"images": index}, fh, indent=2)
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
