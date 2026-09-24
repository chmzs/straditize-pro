"""QA session mixin (T09: Verification gate and geological quality diagnostics).

Strictly adheres to Frozen Contracts v1.3 §2.7 (QaSummary) and §4 (Derived Quantities).
"""

from __future__ import annotations

from typing import Any
import numpy as np

from ..protocol import JsonRpcError
from ..qa import compute_qa_summary


class QaMixin:
    """Session mixin for composition sum check and consistency validation."""

    def _init_qa(self) -> None:
        """Initialize QA state."""
        pass

    def qa_summarize(
        self,
        roi_id: str | None = None,
        tolerance: float = 2.0,
    ) -> dict[str, Any]:
        """Produce the standardized QaSummary diagnostic entity for an ROI.

        Checks:
        1. Composition sum <= 100% (+ tolerance) gate when composition is True.
        2. Empty horizon accounting with reason "no ink read".
        3. Per-column peak vs declared scale max (derived strictly from x_ticks).
        """
        rois = getattr(self, "rois", [])

        # Resolve target ROI
        if roi_id is None:
            if rois:
                target_roi = next(
                    (
                        r
                        for r in rois
                        if r.get("id") == getattr(self, "active_roi_id", None)
                    ),
                    rois[0],
                )
            else:
                target_roi = {"id": "pollen", "name": "pollen", "composition": True}
        else:
            if rois:
                target_roi = next((r for r in rois if r.get("id") == roi_id), None)
                if target_roi is None:
                    raise JsonRpcError(-32602, f"ROI '{roi_id}' not found.")
            else:
                target_roi = {"id": roi_id, "name": roi_id, "composition": True}

        target_roi_id = target_roi.get("id", "pollen")
        roi_name = target_roi.get("name", target_roi_id)
        composition = bool(target_roi.get("composition", True))

        # Filter columns belonging to this ROI
        all_columns = getattr(self, "columns", [])
        target_columns: list[dict[str, Any]] = []
        for col in all_columns:
            c_roi = col.get("roi_id")
            if c_roi == target_roi_id or (
                not c_roi
                and (
                    len(rois) <= 1
                    or target_roi_id == getattr(self, "primary_roi_id", None)
                )
            ):
                target_columns.append(col)

        # Empty ROI check: no columns
        if not target_columns:
            return compute_qa_summary(
                roi_id=target_roi_id,
                roi_name=roi_name,
                composition=composition,
                horizons=[],
                columns_info=[],
                tolerance=tolerance,
            )

        # Gather horizon rows and depths
        horizon_rows: list[int] = []
        horizon_depths: list[float | None] = []

        samples = getattr(self, "samples", [])
        if samples:
            for s in samples:
                r_px = int(round(s.get("row_px", 0)))
                horizon_rows.append(r_px)
                horizon_depths.append(s.get("depth"))
        elif getattr(self, "column_points", None):
            target_indices = {
                c.get("col_index", idx) for idx, c in enumerate(target_columns)
            }
            pts_rows = set()
            for c_idx in target_indices:
                if c_idx in self.column_points:
                    pts_rows.update(p["row"] for p in self.column_points[c_idx])
            if pts_rows:
                sorted_rows = sorted(pts_rows)
                for r in sorted_rows:
                    horizon_rows.append(r)
                    depth_func = getattr(self, "_depth_for_row_px", None)
                    horizon_depths.append(depth_func(r) if depth_func else None)

        if not horizon_rows:
            return compute_qa_summary(
                roi_id=target_roi_id,
                roi_name=roi_name,
                composition=composition,
                horizons=[],
                columns_info=[],
                tolerance=tolerance,
            )

        # Extract values for each column across all horizons
        columns_info: list[dict[str, Any]] = []
        col_values_by_column: list[list[float]] = []

        for idx, col in enumerate(target_columns):
            c_idx = col.get("col_index", idx)
            c_name = col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"

            # Derive declared_max strictly from x_ticks (Contract v1 §4: declaredMax(col))
            x_ticks = col.get("x_ticks")
            if x_ticks and len(x_ticks) >= 2:
                v0 = float(x_ticks[0].get("value", 0.0))
                v1 = float(x_ticks[1].get("value", 0.0))
                declared_max = max(v0, v1)
                px0 = float(x_ticks[0].get("px", 0.0))
                px1 = float(x_ticks[1].get("px", 0.0))
                has_ticks = True
            else:
                declared_max = 0.0
                has_ticks = False
                px0 = float(col.get("startX", col.get("start", 0.0)))
                px1 = float(col.get("endX", col.get("end", px0 + 100.0)))
                v0 = 0.0
                v1 = 100.0

            # Pixel mapping
            pts = (
                self.column_points.get(c_idx, [])
                if hasattr(self, "column_points")
                else []
            )
            p_dict = {p["row"]: p["x"] for p in pts}

            col_start_px = float(col.get("startX", col.get("start", px0)))
            scale_type = col.get("scale_type", "linear")

            c_vals: list[float] = []
            for r in horizon_rows:
                if r in p_dict:
                    raw_x = p_dict[r]
                else:
                    raw_x = col_start_px

                if abs(raw_x - col_start_px) < 1e-6:
                    val = 0.0
                else:
                    if has_ticks:
                        span = px1 - px0
                        if abs(span) > 1e-9:
                            if scale_type == "log" and v0 > 0 and v1 > 0:
                                log_v = np.log10(v0) + (raw_x - px0) / span * (
                                    np.log10(v1) - np.log10(v0)
                                )
                                val = float(10**log_v)
                            else:
                                val = float(v0 + (raw_x - px0) / span * (v1 - v0))
                        else:
                            val = 0.0
                    else:
                        span = px1 - px0
                        if abs(span) > 1e-9:
                            val = float((raw_x - px0) / span * 100.0)
                        else:
                            val = 0.0

                    # Handle exaggeration multiplier
                    exag = col.get("exaggeration_mult")
                    if exag is not None and float(exag) > 1.0:
                        val = val / float(exag)

                c_vals.append(max(0.0, val))

            col_values_by_column.append(c_vals)
            columns_info.append(
                {
                    "name": c_name,
                    "declared_max": declared_max,
                    "col_values": c_vals,
                }
            )

        # Assemble per-horizon structures
        horizons_data: list[dict[str, Any]] = []
        for h_idx in range(len(horizon_rows)):
            row_vals = [
                col_values_by_column[c_i][h_idx] for c_i in range(len(target_columns))
            ]
            horizons_data.append(
                {
                    "depth": horizon_depths[h_idx],
                    "values": row_vals,
                }
            )

        return compute_qa_summary(
            roi_id=target_roi_id,
            roi_name=roi_name,
            composition=composition,
            horizons=horizons_data,
            columns_info=columns_info,
            tolerance=tolerance,
        )
