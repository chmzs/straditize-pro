"""Quality Assurance (QA) and Geological Diagnostics Core (T09).

Strictly adheres to Frozen Contracts v1.3 §2.7 (QaSummary) and §4 (Derived Quantities).
"""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np


def compute_qa_summary(
    roi_id: str,
    roi_name: str,
    composition: bool,
    horizons: Sequence[dict[str, Any]],
    columns_info: Sequence[dict[str, Any]],
    tolerance: float = 2.0,
) -> dict[str, Any]:
    """Compute QaSummary entity according to Frozen Contract v1.3 §2.7.

    Parameters:
    - roi_id: Identifier of the target ROI.
    - roi_name: Display name of the target ROI.
    - composition: If True, enforces abundance sum <= 100% (+ tolerance) gate.
    - horizons: List of horizon dicts, each containing:
        - "depth": float | None (physical depth or None if uncalibrated)
        - "values": Sequence[float] (readings across columns at this horizon)
    - columns_info: List of column info dicts, each containing:
        - "name": str (column name)
        - "declared_max": float (derived strictly from x_ticks, never from stored/defaults)
        - "col_values": Sequence[float] (values for this column across all horizons)
    - tolerance: Allowed excess percentage for composition gate (default 2.0%).
    """
    n_horizons = len(horizons)

    # Empty ROI / zero horizons case: return complete structure with 0 counts without error
    if n_horizons == 0:
        return {
            "roi_id": roi_id,
            "roi_name": roi_name,
            "composition": bool(composition),
            "n_horizons": 0,
            "n_horizons_with_data": 0,
            "n_horizons_empty": 0,
            "empty_horizons": [],
            "sum": {"min": 0.0, "p50": 0.0, "max": 0.0, "mean": 0.0},
            "tolerance": float(tolerance),
            "violations_over": [],
            "shortfall": {"min": 0.0, "max": 0.0, "mean": 0.0},
            "per_column_max": [],
        }

    empty_horizons: list[dict[str, Any]] = []
    sums: list[float] = []

    for h in horizons:
        vals = h.get("values", [])
        row_sum = float(sum(vals)) if vals else 0.0
        sums.append(row_sum)

        # Check for empty horizon (all zero / no ink read)
        is_empty = len(vals) == 0 or all(abs(v) < 1e-9 for v in vals)
        if is_empty:
            empty_horizons.append(
                {
                    "depth": h.get("depth"),
                    "reason": "no ink read",
                }
            )

    n_horizons_empty = len(empty_horizons)
    n_horizons_with_data = n_horizons - n_horizons_empty

    # Sum statistics MUST include all-zero horizons
    sum_min = float(np.min(sums))
    sum_p50 = float(np.percentile(sums, 50))
    sum_max = float(np.max(sums))
    sum_mean = float(np.mean(sums))

    sum_dict = {
        "min": round(sum_min, 1),
        "p50": round(sum_p50, 1),
        "max": round(sum_max, 1),
        "mean": round(sum_mean, 1),
    }

    # Composition gate violations (only checked when composition == True)
    violations_over: list[dict[str, Any]] = []
    if composition:
        threshold = 100.0 + float(tolerance)
        for h, s in zip(horizons, sums):
            if s > threshold:
                violations_over.append(
                    {
                        "depth": h.get("depth"),
                        "sum": round(s, 1),
                    }
                )

    # Shortfall statistics: 100 - sum for horizons with data (excess horizons have 0 shortfall)
    if composition:
        data_sums = [s for s in sums if s > 1e-9]
        if data_sums:
            shortfalls = [max(0.0, 100.0 - s) for s in data_sums]
            shortfall_min = float(np.min(shortfalls))
            shortfall_max = float(np.max(shortfalls))
            shortfall_mean = float(np.mean(shortfalls))
            shortfall_dict = {
                "min": round(shortfall_min, 1),
                "max": round(shortfall_max, 1),
                "mean": round(shortfall_mean, 1),
            }
        else:
            shortfall_dict = {"min": 0.0, "max": 0.0, "mean": 0.0}
    else:
        shortfall_dict = {"min": 0.0, "max": 0.0, "mean": 0.0}

    # Per-column peak vs declared scale max
    per_column_max: list[dict[str, Any]] = []
    for col in columns_info:
        c_name = col.get("name", "")
        declared_max = float(col.get("declared_max", 0.0))
        c_vals = col.get("col_values", [])
        peak = float(np.max(c_vals)) if len(c_vals) > 0 else 0.0
        over = bool(declared_max > 0.0 and peak > declared_max)
        per_column_max.append(
            {
                "name": c_name,
                "peak": round(peak, 1),
                "declared_max": round(declared_max, 1),
                "over": over,
            }
        )

    return {
        "roi_id": roi_id,
        "roi_name": roi_name,
        "composition": bool(composition),
        "n_horizons": n_horizons,
        "n_horizons_with_data": n_horizons_with_data,
        "n_horizons_empty": n_horizons_empty,
        "empty_horizons": empty_horizons,
        "sum": sum_dict,
        "tolerance": float(tolerance),
        "violations_over": violations_over,
        "shortfall": shortfall_dict,
        "per_column_max": per_column_max,
    }
