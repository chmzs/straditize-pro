"""X-axis tick mark geometric detection algorithm (T07).

Directly adopts the proven implementation and conclusions from support/probe_x_ticks.py (T00-b).
"""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np

TICK_MAX_RUN = 12


def _col_run_through(dark: np.ndarray, x: int, y_ref: int) -> int:
    """Absolute length of the vertical dark run containing (y_ref, x)."""
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
    """Return (merged tick x centres, raw stroke columns) for band."""
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
    """Locate a band of short isolated vertical strokes (an x-axis tick ruler)."""
    h, w = gray.shape
    dark = gray < dark_threshold
    best: tuple[float, int, int] | None = None

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
            continue

        score = (bimodal, n_strokes, top)
        if best is None or score > best:
            best = score

    return None if best is None else (best[2], best[2] + band_height)


def _strokes_in_band(
    gray: np.ndarray,
    band: tuple[int, int],
    *,
    dark_threshold: int,
) -> tuple[list[int], list[dict[str, Any]]]:
    """Return (tick x centres, per-stroke diagnostics) inside band."""
    dark = gray < dark_threshold
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
    """Gap statistics for one sequence of ticks within a column."""
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


def detect_xticks(
    gray: np.ndarray,
    band: tuple[int, int] | Sequence[int] | None = None,
    *,
    tick_band_height: int = 9,
    dark_threshold: int = 160,
    columns: list[tuple[float, float]] | list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Detect x-axis tick marks via 1-D geometric run pass."""
    gray = np.asarray(gray)
    if gray.ndim != 2:
        raise ValueError("detect_xticks expects a 2-D greyscale array")

    auto_band = band is None
    resolved = tuple(band) if band is not None else _find_tick_band(
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
        for idx, col_item in enumerate(columns):
            if isinstance(col_item, dict):
                x0 = col_item.get("startX", col_item.get("start", 0))
                x1 = col_item.get("endX", col_item.get("end", 0))
            else:
                x0, x1 = col_item
            lo, hi = (x0, x1) if x0 <= x1 else (x1, x0)
            inside = [x for x in ticks if lo <= x < hi]
            n = len(inside)
            per_column.append(
                {
                    "column_index": idx,
                    "ticks": inside,
                    "n": n,
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
