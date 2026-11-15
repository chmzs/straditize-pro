"""X-axis tick mark geometric detection algorithm (T07).

Directly adopts the proven implementation and conclusions from support/probe_x_ticks.py (T00-b).
"""

from __future__ import annotations

from typing import Any
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

