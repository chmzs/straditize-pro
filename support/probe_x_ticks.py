"""T00-b probe: geometric detection of x-axis tick marks.

**Why this file exists**

The ticket `T00-b` asks whether tick marks can be located reliably enough that
the user only has to read *two numbers* (the first tick's value and the step)
instead of clicking two endpoints on all ~30 columns. That decision gates
whether `T07` gets a geometry path at all.

**Anti-circularity, and how it changed twice**

The requirement (ticket T00-b) is that the probe author must not *annotate* the
ground truth. It does not require a different algorithm -- but a probe that merely
re-implements the ground-truth rule proves nothing, so this probe tries to bring
**independent evidence**:

* it detects ticks in a **1-D column pass** with its own thresholds, band search and
  stroke merging, and
* it additionally reports **spacing uniformity**, which the ground-truth rule does
  not use at all (a ruler's ticks are equally spaced).

**Two findings from running it**

1. *The ground truth was wrong.* Scoring candidate bands by "most strokes" prefers
   the **data area** -- every column baseline is a 9-px-tall narrow stroke, so any
   9-row window inside the plot looks like a comb (228 "strokes" in the bell figure
   vs 80 in the real ruler). Chasing that exposed that
   ``type1_filled_silhouette_aber.png`` (median "tick" run 64 px, max 333 px) and
   ``hoya`` (median 149 px, max 1162 px) had **no tick ruler at all**: their supposed
   35 / 13 ticks were **long column baselines crossing the band**.
   ``gen_ground_truth.py`` was tightened (a tick must be a short isolated stroke) and
   both now honestly report ``has_tick_ruler = false``. Inventing ticks for a figure
   that has no ruler is exactly the defect this probe exists to catch.

2. *2-D connected components do not work for this shape.* The first implementation
   segmented strokes with ``regionprops`` in a window taller than the band. It broke:
   a scale bar often has a **horizontal connector line** joining its ticks, so the
   whole comb becomes **one component** -- wide, not tall -- and every tick is
   rejected by the width filter. Component analysis is therefore unsuitable here;
   the column-wise pass is required. (Logged because "be clever with components" is
   the obvious thing to try next, and it does not work.)

Run:  pixi run python support/probe_x_ticks.py [--json]
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from skimage.measure import label, regionprops  # noqa: F401  (kept: see docstring finding #2)

ROOT = Path(__file__).resolve().parents[1]
TRUTH_DIR = ROOT / "tests" / "data" / "truth"

# --- gate / non-gate split, per ticket T00-b ---------------------------------
# Images whose ground truth establishes a genuine tick ruler participate in the
# exact-count gate. The other two report `has_tick_ruler = false` (see module
# docstring): their band is crossed by long column baselines, so they are kept only
# as "must not crash, must report honestly (0 ticks)" cases.
GATE_KEYS = ("exaggeration_bell", "composite_cluster")
NON_GATE_KEYS = ("filled_silhouette", "hoya")

# A tick is a short stroke. The probe measures this as the *absolute vertical run*
# through the band in the full image, so a column baseline crossing the band is
# rejected. (See the module docstring: 2-D components cannot be used here because a
# scale bar's connector line joins all its ticks into one wide component.)
TICK_MAX_RUN = 12  # must match gen_ground_truth.TICK_MAX_RUN (same stated criterion)


# --------------------------------------------------------------------------
# band search
# --------------------------------------------------------------------------
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


def _stroke_columns(
    dark: np.ndarray,
    band: tuple[int, int],
) -> tuple[list[int], list[int]]:
    """Return (merged tick x centres, raw stroke columns) for ``band``.

    A stroke column is one that is dark for the whole band. Adjacent stroke columns
    within 2 px are merged into one tick (antialiasing / dashed rendering).
    """
    y0, y1 = band
    col_fill = dark[y0:y1, :].mean(axis=0)
    cols = list(np.where(col_fill > 0.95)[0])
    merged: list[int] = []
    for x in cols:
        if merged and x - merged[-1] <= 2:
            merged[-1] = int(round((merged[-1] + x) / 2.0))
        else:
            merged.append(int(x))
    return merged, [int(c) for c in cols]


def _find_tick_band(
    gray: np.ndarray,
    *,
    band_height: int,
    dark_threshold: int,
) -> tuple[int, int] | None:
    """Locate a band of short isolated vertical strokes (an x-axis tick ruler).

    A tick band is **not** a horizontal line: only a handful of columns are dark,
    so a "row extent" test would wrongly reject it. What identifies it is that
    (a) the per-column darkness is *bimodal* -- every column is a stroke or paper,
    and (b) the strokes are **short**: every stroke column's absolute vertical run
    is <= ``TICK_MAX_RUN``. Criterion (b) is what rejects a data-area window, where
    every column baseline is a short stroke *within* the band but a long line
    overall.

    Score by *how clean the comb is* (bimodality), not by stroke count -- the data
    area has far more strokes, it is just not a ruler.
    """
    h, w = gray.shape
    dark = gray < dark_threshold
    best: tuple[float, int, int] | None = None  # (bimodality, n_strokes, top)

    for top in range(int(h * 0.70), h - band_height):
        band = dark[top : top + band_height, :]
        col_fill = band.mean(axis=0)
        stroke_cols = col_fill > 0.95
        n_strokes = int(stroke_cols.sum())
        if n_strokes < 3 or n_strokes > int(w * 0.5):
            continue
        bimodal = float(((col_fill > 0.95) | (col_fill < 0.05)).mean())
        if bimodal < 0.97:
            continue

        y_ref = top + band_height // 2
        if any(_col_run_through(dark, x, y_ref) > TICK_MAX_RUN for x in np.where(stroke_cols)[0]):
            continue  # a long line (column baseline) crosses the band

        score = (bimodal, n_strokes, top)
        if best is None or score > best:
            best = score

    return None if best is None else (best[2], best[2] + band_height)


# --------------------------------------------------------------------------
# stroke extraction
# --------------------------------------------------------------------------
def _strokes_in_band(
    gray: np.ndarray,
    band: tuple[int, int],
    *,
    dark_threshold: int,
) -> tuple[list[int], list[dict[str, Any]]]:
    """Return (tick x centres, per-stroke diagnostics) inside ``band``.

    A tick is a narrow stroke covering the band whose **absolute vertical run** is
    short; anything longer is a line crossing the band. (2-D components cannot be
    used: a scale bar's connector line joins all ticks into one wide component --
    see the module docstring.)
    """
    dark = np.asarray(gray) < dark_threshold
    merged, cols = _stroke_columns(dark, band)
    y_ref = (band[0] + band[1]) // 2
    diag = [{"x": c, "run": _col_run_through(dark, c, y_ref)} for c in cols]
    kept = [c for c in cols if _col_run_through(dark, c, y_ref) <= TICK_MAX_RUN]

    ticks: list[int] = []
    for x in merged:
        if any(abs(x - c) <= 2 for c in kept):
            ticks.append(x)
    return ticks, diag


def _spacing_uniformity(ticks: list[int]) -> dict[str, Any]:
    """Gap statistics for one sequence of ticks.

    **Important**: a ruler is drawn *per column*, so spacing is uniform **within a
    column** but not across the whole strip -- the measured gaps in the bell figure
    run ``20,20,20,20,19,14,20,13,20,24``, where the 13/14 sit at column
    boundaries. Gating on *global* spacing was this probe's own mistake; the gate
    now uses the median of the per-column values (see ``main``).
    """
    if len(ticks) < 3:
        return {"n": len(ticks), "gaps": 0, "median": None, "cv": None, "frac_within_15pct": None}
    gaps = np.diff(np.asarray(sorted(ticks), dtype=float))
    med = float(np.median(gaps))
    if med <= 0:
        return {"n": len(ticks), "gaps": len(gaps), "median": 0.0, "cv": None, "frac_within_15pct": 0.0}
    return {
        "n": len(ticks),
        "gaps": int(len(gaps)),
        "median": round(med, 3),
        "cv": round(float(gaps.std() / gaps.mean()), 4),
        "frac_within_15pct": round(float((np.abs(gaps - med) <= 0.15 * med).mean()), 4),
    }


def _per_column_spacing(
    ticks: list[int],
    columns: list[tuple[float, float]],
) -> list[dict[str, Any]]:
    """Spacing uniformity of each column's own ruler (the meaningful unit)."""
    out: list[dict[str, Any]] = []
    for idx, (x0, x1) in enumerate(columns):
        lo, hi = (x0, x1) if x0 <= x1 else (x1, x0)
        inside = [x for x in ticks if lo <= x < hi]
        st = _spacing_uniformity(inside)
        st["column_index"] = idx
        st["x_range"] = [int(lo), int(hi)]
        out.append(st)
    return out


# --------------------------------------------------------------------------
# frozen API
# --------------------------------------------------------------------------
def detect_xticks(
    gray: np.ndarray,
    band: tuple[int, int] | None = None,
    *,
    tick_band_height: int = 9,
    dark_threshold: int = 160,
    columns: list[tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """Detect x-axis tick marks.

    Parameters
    ----------
    gray:
        2-D greyscale image as ``np.ndarray``.
    band:
        ``(y0, y1)`` to use directly, or ``None`` to auto-search.
    tick_band_height:
        Height in rows of the band to search for.
    dark_threshold:
        Grey level below which a pixel counts as ink.
    columns:
        Optional ``[(startX, endX), ...]`` column bounds. When given, ticks are
        grouped per column and each entry reports whether it is **usable**
        (a column needs >= 2 ticks to define a mapping; fewer must be reported
        honestly and routed to the manual path).

    Returns
    -------
    dict with keys ``band``, ``ticks``, ``per_column``, ``auto_band``.
    """
    gray = np.asarray(gray)
    if gray.ndim != 2:
        raise ValueError("detect_xticks expects a 2-D greyscale array")

    auto_band = band is None
    resolved = band if band is not None else _find_tick_band(
        gray, band_height=tick_band_height, dark_threshold=dark_threshold
    )
    if resolved is None:
        return {
            "band": None,
            "ticks": [],
            "per_column": [],
            "auto_band": auto_band,
            "spacing": _spacing_uniformity([]),
        }

    ticks, _ = _strokes_in_band(gray, resolved, dark_threshold=dark_threshold)

    per_column: list[dict[str, Any]] = []
    if columns:
        for idx, (x0, x1) in enumerate(columns):
            lo, hi = (x0, x1) if x0 <= x1 else (x1, x0)
            inside = [x for x in ticks if lo <= x < hi]
            n = len(inside)
            per_column.append(
                {
                    "column_index": idx,
                    "ticks": inside,
                    "n": n,
                    # A column with fewer than two ticks cannot define a scale.
                    # Never emit a "successful" entry for it -- the caller must
                    # fall back to the manual two-endpoint path.
                    "usable": n >= 2,
                    "reason": None if n >= 2 else f"only {n} tick(s) detected",
                }
            )

    return {
        "band": [int(resolved[0]), int(resolved[1])],
        "ticks": ticks,
        "per_column": per_column,
        "auto_band": auto_band,
        "spacing": _spacing_uniformity(ticks),
    }


# --------------------------------------------------------------------------
# probe driver
# --------------------------------------------------------------------------
def evaluate(gray: np.ndarray, truth: dict[str, Any]) -> dict[str, Any]:
    """Compare both band modes against the ground truth and report recall/FPs."""
    gt = sorted(int(x) for x in truth["ticks"])
    out: dict[str, Any] = {"gt_count": len(gt), "gt_has_ruler": bool(truth.get("has_tick_ruler"))}

    for label_name, band in (
        ("auto", None),
        ("manual", tuple(truth["band"]) if truth.get("band") else None),
    ):
        if label_name == "manual" and band is None:
            # No ruler in the ground truth -> there is no band to hand over; the
            # honest expectation is that auto mode also finds nothing.
            out[label_name] = {"skipped": "ground truth has no band"}
            continue
        res = detect_xticks(gray, band)
        found = res["ticks"]

        missed = [x for x in gt if not any(abs(x - f) <= 1 for f in found)]
        spurious = [x for x in found if not any(abs(x - g) <= 1 for g in gt)]
        out[label_name] = {
            "band": res["band"],
            "found": len(found),
            "recall": round(1.0 - len(missed) / max(1, len(gt)), 4),
            "missed": missed[:10],
            "spurious": spurious[:10],
            "fp": len(spurious),
            "spacing": res["spacing"],
            "pass": not missed and not spurious,
        }
    return out


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    index = json.loads((TRUTH_DIR / "index.json").read_text(encoding="utf-8"))["images"]
    results: dict[str, Any] = {}
    failures: list[str] = []

    for key in GATE_KEYS + NON_GATE_KEYS:
        truth = json.loads(
            (TRUTH_DIR / f"{key}__x_ticks.json").read_text(encoding="utf-8")
        )
        path = ROOT / truth["image"]
        digest = _sha256(path)
        if digest != truth["sha256"]:
            failures.append(f"{key}: sha256 mismatch ({digest[:12]} != {truth['sha256'][:12]})")
            continue

        gray = np.array(Image.open(path).convert("L"))
        ev = evaluate(gray, truth)
        gate = key in GATE_KEYS

        # Real column bounds, so the per-column guard (criterion 4) and the
        # per-column spacing check run against production geometry rather than a
        # hand-made stand-in. This mirrors how T07 will work: columns are known.
        columns: list[tuple[float, float]] = []
        try:
            from straditize_core.session import StraditizeSession

            sess = StraditizeSession()
            sess.load_image(str(path))
            h, w = gray.shape
            cols = sess.detect_columns([int(w * 0.02), int(w * 0.995)], [int(h * 0.27), int(h * 0.96)])
            columns = [(float(c["start"]), float(c["end"])) for c in cols]
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{key}: could not obtain real column bounds ({exc!r})")

        res = detect_xticks(gray, None)
        band = res["band"]
        guard_ok = None
        col_spacing: list[dict[str, Any]] = []
        if band:
            gres = detect_xticks(gray, band, columns=columns)
            per = gres["per_column"]
            usable = [c for c in per if c["usable"]]
            unusable = [c for c in per if not c["usable"]]
            # criterion 4: columns with <2 ticks must be reported unusable WITH a
            # reason, never silently treated as calibrated.
            guard_ok = bool(unusable) and all(c["reason"] for c in unusable) and bool(usable)
            col_spacing = _per_column_spacing(gres["ticks"], columns)

        results[key] = {
            "gate": gate,
            "sha256": digest[:12],
            "image": truth["image"],
            "gt_has_ruler": bool(truth.get("has_tick_ruler")),
            "gt_ticks": len(truth["ticks"]),
            "n_columns": len(columns),
            "evaluation": ev,
            "per_column_guard_ok": guard_ok,
            "per_column_spacing": col_spacing,
        }

        if gate:
            for mode in ("auto", "manual"):
                res_m = ev.get(mode, {})
                if res_m.get("skipped"):
                    continue
                if not res_m.get("pass"):
                    failures.append(
                        f"{key}[{mode}]: recall {res_m['recall']}, "
                        f"missed {res_m['missed']}, spurious {res_m['spurious']}"
                    )
            # Independent corroboration, on the meaningful unit: a ruler is drawn
            # per column, so spacing must be uniform WITHIN each column's own ruler
            # (the gaps between columns differ by construction).
            vals = [
                c["frac_within_15pct"]
                for c in col_spacing
                if c.get("frac_within_15pct") is not None
            ]
            if not vals:
                failures.append(f"{key}: no column had >=3 ticks to check spacing on")
            elif float(np.median(vals)) < 0.9:
                failures.append(
                    f"{key}: within-column spacing not uniform "
                    f"(median frac_within_15pct={float(np.median(vals)):.4f}, n_cols={len(vals)})"
                )
            if guard_ok is not True:
                failures.append(f"{key}: per-column '<2 ticks -> unusable' guard failed")
        else:
            # non-gate: the figure has no tick ruler, so the honest report is
            # "no band / zero ticks" -- inventing ticks here is the defect this
            # probe was written to catch.
            if truth.get("has_tick_ruler"):
                failures.append(f"{key}: classified non-gate but ground truth has a ruler")
            if ev["auto"]["found"]:
                failures.append(
                    f"{key}: ground truth has NO tick ruler but probe reported "
                    f"{ev['auto']['found']} ticks (false positives)"
                )

    if as_json:
        print(json.dumps({"results": results, "failures": failures}, ensure_ascii=False, indent=2))
    else:
        for key, r in results.items():
            tag = "GATE" if r["gate"] else "non-gate"
            print(
                f"[{tag}] {key}  sha256={r['sha256']}  gt_ruler={r['gt_has_ruler']} "
                f"gt_ticks={r['gt_ticks']} columns={r['n_columns']}"
            )
            for mode in ("auto", "manual"):
                m = r["evaluation"].get(mode, {})
                if m.get("skipped"):
                    print(f"    {mode:6s}: skipped ({m['skipped']})")
                    continue
                gsp = m.get("spacing") or {}
                print(
                    f"    {mode:6s}: band={m['band']} found={m['found']:3d} "
                    f"recall={m['recall']:.4f} fp={m['fp']} "
                    f"global_cv={gsp.get('cv')} "
                    f"{'PASS' if m['pass'] else 'FAIL'}"
                )
                if not m["pass"]:
                    print(f"            missed={m['missed']} spurious={m['spurious']}")
            cs = r["per_column_spacing"]
            if cs:
                vals = [c["frac_within_15pct"] for c in cs if c.get("frac_within_15pct") is not None]
                n3 = sum(1 for c in cs if c["n"] >= 3)
                if vals:
                    print(
                        f"    per-column spacing: {n3}/{len(cs)} cols with >=3 ticks, "
                        f"median within15% = {float(np.median(vals)):.4f}"
                    )
            if r["per_column_guard_ok"] is not None:
                print(f"    <2-tick guard: {'ok' if r['per_column_guard_ok'] else 'FAIL'}")

    print()
    if failures:
        print("T00-b RESULT: FAIL")
        for f in failures:
            print("  -", f)
        return 1
    print("T00-b RESULT: PASS")
    print("  gate images: 100% recall, 0 false positives, both band modes, equal spacing")
    print("  non-gate images: honestly report 0 ticks (no tick ruler in the figure)")
    print("  → T07 may use the geometry path (design doc §5.3.1 path ①)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
