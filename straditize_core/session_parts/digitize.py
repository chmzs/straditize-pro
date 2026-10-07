"""Digitization and control points session mixin."""

from __future__ import annotations

from typing import Any

import numpy as np

try:
    from scipy.interpolate import PchipInterpolator
except ImportError:
    PchipInterpolator = None

try:
    from scipy.signal import find_peaks
except ImportError:
    find_peaks = None

from ..curve import detect_stratigraphic_turning_points
from ..digitize import interpolate_hlines
from ..protocol import (
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)


class DigitizeSessionMixin:
    """Digitization of curves/bars and manual/automatic control point manipulations."""

    def digitize(
        self,
        col_index: int,
        reader_type: str = "area",
        mode: str | None = None,
        method: str | None = None,
    ) -> dict[str, Any]:
        """Digitizes curve or bars in the specified column to extract data points."""
        if method is not None:
            reader_type = method
        elif mode is not None:
            reader_type = mode
        if not getattr(self, "columns", None):
            raise JsonRpcError(
                STATE_ERROR,
                "No columns detected. Please call core.detectColumns first.",
            )

        columns = self.columns
        if col_index < 0 or col_index >= len(columns):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"col_index {col_index} out of range (0 to {len(columns) - 1})",
            )

        col = columns[col_index]
        col_roi_id = col.get("roi_id")
        roi = self._roi_box(roi_id=col_roi_id)
        c_start = round(col.get("start", col.get("startX", 0)))
        c_end = round(col.get("end", col.get("endX", 100)))
        if roi is not None:
            y0 = round(roi[1])
            y1 = round(roi[3])
        else:
            y0 = round(self.data_ylim[0])
            y1 = round(self.data_ylim[1])

        # A column lying entirely outside the ROI cannot yield data
        if roi is not None and not (c_end > round(roi[0]) and c_start < round(roi[2])):
            name = col.get("species") or col.get("name") or f"col{col_index + 1:02d}"
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Column '{name}' (x {c_start}..{c_end}) lies entirely outside the data "
                f"ROI (x {round(roi[0])}..{round(roi[2])}). Widen the ROI or move the column; "
                "no data was produced.",
            )

        if getattr(self, "foreground_mask", None) is None:
            if getattr(self, "image", None) is not None:
                self.extract_foreground()
            else:
                raise JsonRpcError(STATE_ERROR, "No foreground mask or image loaded.")

        mask = self._extraction_mask(roi_id=col_roi_id)
        if mask is None:
            raise JsonRpcError(STATE_ERROR, "No foreground mask or image loaded.")
        points: list[dict[str, float]] = []
        control_points: dict[int, float] = {}

        for row_y in range(y0, y1 + 1):
            if row_y >= self.height:
                break
            row_pixels = mask[row_y, c_start:c_end]
            fg_indices = np.where(row_pixels)[0]

            if len(fg_indices) > 0:
                if reader_type in ("line", "area"):
                    if reader_type == "area":
                        feat_x = float(c_start + fg_indices[-1])
                    else:
                        feat_x = float(c_start + np.mean(fg_indices))
                elif reader_type == "bars":
                    feat_x = float(c_start + np.max(fg_indices))
                else:
                    feat_x = float(c_start + np.mean(fg_indices))
            else:
                feat_x = float(c_start)

            points.append({"row": row_y, "x": feat_x, "y": float(row_y)})

        if not points:
            return {
                "col_index": col_index,
                "reader_type": reader_type,
                "points": [],
                "control_points_count": 0,
            }

        # Interpolate across pervasive horizontal grid lines to eliminate artificial 100% spikes
        if hasattr(self, "hline_rows") and self.hline_rows:
            raw_vals = np.array([p["x"] - c_start for p in points], dtype=float)
            rel_hlines = [hr for hr in self.hline_rows if 0 <= hr < len(raw_vals)]
            if rel_hlines:
                interp_vals = interpolate_hlines(raw_vals[:, np.newaxis], rel_hlines)[
                    :, 0
                ]
                for p_idx, new_v in enumerate(interp_vals):
                    points[p_idx]["x"] = float(c_start + new_v)

        # Advanced peak extraction: using topological prominence and local extrema
        curve_profile = np.array([p["x"] - c_start for p in points], dtype=float)
        turning_rows, turning_vals, is_mand = detect_stratigraphic_turning_points(
            curve_profile, prominence=1.5, min_distance=3, epsilon=1.0, max_points=32
        )
        ctrl_pts_list = []
        for r_rel, v_rel, _mand in zip(turning_rows, turning_vals, is_mand):
            r_int = int(y0 + r_rel)
            x_val = float(c_start + v_rel)
            control_points[r_int] = x_val
            ctrl_pts_list.append(
                {
                    "id": f"pt_{col_index}_{r_int}",
                    "x": x_val,
                    "y": float(r_int),
                    "type": "peak" if v_rel > 1.0 else "trough",
                    "isManual": False,
                }
            )

        # Ensure endpoints exist
        y0_x = float(points[0]["x"])
        y1_x = float(points[-1]["x"])
        control_points[y0] = y0_x
        control_points[y1] = y1_x

        if not any(p["y"] == float(y0) for p in ctrl_pts_list):
            ctrl_pts_list.insert(
                0,
                {
                    "id": f"pt_{col_index}_{y0}",
                    "x": y0_x,
                    "y": float(y0),
                    "type": "trough",
                    "isManual": False,
                },
            )
        if not any(p["y"] == float(y1) for p in ctrl_pts_list):
            ctrl_pts_list.append(
                {
                    "id": f"pt_{col_index}_{y1}",
                    "x": y1_x,
                    "y": float(y1),
                    "type": "trough",
                    "isManual": False,
                }
            )

        ctrl_pts_list.sort(key=lambda p: p["y"])

        self.column_points[col_index] = points
        self.control_points[col_index] = control_points
        self.reader_types[col_index] = reader_type

        return {
            "col_index": col_index,
            "reader_type": reader_type,
            "points": points,
            "control_points": ctrl_pts_list,
            "control_points_count": len(control_points),
        }

    def update_control_point(
        self,
        col_index: int,
        row: int,
        x: float,
        remove: bool = False,
    ) -> dict[str, Any]:
        """Adds, updates, or removes a control point and recalculates interpolated curve."""
        if col_index not in self.column_points:
            raise JsonRpcError(
                STATE_ERROR,
                f"Column {col_index} has not been digitized yet. Call core.digitize first.",
            )

        ctrls = self.control_points.get(col_index, {})
        y0 = round(self.data_ylim[0])
        y1 = round(self.data_ylim[1])

        action = "updated"
        if remove:
            if ctrls:
                nearest_row = min(ctrls.keys(), key=lambda r: abs(r - row))
                if abs(nearest_row - row) <= max(15, (y1 - y0) // 10):
                    del ctrls[nearest_row]
                    action = "removed"
                else:
                    raise JsonRpcError(
                        INVALID_PARAMS, f"No control point near row {row} to remove"
                    )
            else:
                raise JsonRpcError(
                    INVALID_PARAMS, "No control points available to remove"
                )
        else:
            ctrls[int(row)] = float(x)
            action = "updated"

        # Ensure boundary anchor points exist
        if y0 not in ctrls:
            ctrls[y0] = float(self.column_points[col_index][0]["x"])
        if y1 not in ctrls:
            ctrls[y1] = float(self.column_points[col_index][-1]["x"])

        sorted_rows = sorted(ctrls.keys())
        sorted_x = [ctrls[r] for r in sorted_rows]

        all_rows = np.arange(y0, y1 + 1)
        if len(sorted_rows) >= 3 and PchipInterpolator is not None:
            interpolator = PchipInterpolator(sorted_rows, sorted_x)
            interpolated_x = interpolator(all_rows)
        else:
            interpolated_x = np.interp(all_rows, sorted_rows, sorted_x)

        new_points = []
        for r_val, x_val in zip(all_rows, interpolated_x):
            new_points.append({"row": int(r_val), "x": float(x_val), "y": float(r_val)})

        self.column_points[col_index] = new_points
        self.control_points[col_index] = ctrls

        return {
            "col_index": col_index,
            "action": action,
            "updated_row": int(row),
            "control_points_count": len(ctrls),
            "points": new_points,
        }

    def point_add(
        self,
        col_index: int | str,
        y: float,
        x: float,
        kind: str = "peak",
    ) -> dict[str, Any]:
        """Adds or updates a control point in a column."""
        self._record_history("Add point")
        c_idx = self._resolve_col_index(col_index)
        y_int = round(y)
        if c_idx not in self.control_points:
            self.control_points[c_idx] = {}
        self.control_points[c_idx][y_int] = float(x)
        return {
            "success": True,
            "col_index": c_idx,
            "y": y_int,
            "x": float(x),
            "kind": kind,
        }

    def point_move(
        self,
        col_index: int | str,
        y: float,
        new_x: float,
    ) -> dict[str, Any]:
        """Moves a control point."""
        return self.point_add(col_index=col_index, y=y, x=new_x)

    def point_remove(
        self,
        col_index: int | str,
        y: float,
    ) -> dict[str, Any]:
        """Removes a control point."""
        self._record_history("Remove point")
        c_idx = self._resolve_col_index(col_index)
        y_int = round(y)
        if c_idx in self.control_points and y_int in self.control_points[c_idx]:
            del self.control_points[c_idx][y_int]
            return {"success": True, "removed_y": y_int}
        return {"success": False, "message": "Point not found"}

    def algorithm_extract_turning_points(
        self,
        col_index: int | None = None,
        prominence_ratio: float = 0.05,
    ) -> dict[str, Any]:
        """Extracts peak and valley control points per column, preserving manual points (Section 六 item 7)."""
        target_cols = (
            [col_index]
            if col_index is not None
            else [c["col_index"] for c in self.columns]
        )
        if not target_cols:
            return {"success": False, "message": "No columns available"}

        for c_idx in target_cols:
            if c_idx not in self.column_points:
                self.digitize(c_idx, "area")

        updated = []
        for c_idx in target_cols:
            pts = self.column_points.get(c_idx, [])
            if not pts:
                continue

            existing_ctrls = self.control_points.get(c_idx, {})
            p_rows = np.array([p["row"] for p in pts], dtype=int)
            p_x = np.array([p["x"] for p in pts], dtype=float)

            dyn_range = float(np.ptp(p_x)) if len(p_x) > 0 else 1.0
            prominence = max(1.0, dyn_range * prominence_ratio)

            peaks_idx = []
            valleys_idx = []
            if find_peaks is not None and len(p_x) > 5:
                peaks_idx, _ = find_peaks(p_x, prominence=prominence)
                valleys_idx, _ = find_peaks(-p_x, prominence=prominence)

            detected_rows = set(p_rows[peaks_idx]).union(set(p_rows[valleys_idx]))

            merged_ctrls = dict(existing_ctrls)
            for r in detected_rows:
                idx_arr = np.where(p_rows == r)[0]
                if len(idx_arr) > 0:
                    merged_ctrls[int(r)] = float(p_x[idx_arr[0]])

            self.control_points[c_idx] = merged_ctrls
            updated.append(c_idx)

        self._record_history("Extract turning points")
        return {"success": True, "columns_updated": updated}


DigitizeMixin = DigitizeSessionMixin
