"""Straditize Core Session logic managing digitization state and scientific calculations."""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import tarfile
import time
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

logger = logging.getLogger("straditize_rpc")

try:
    from scipy.interpolate import PchipInterpolator
except ImportError:
    PchipInterpolator = None

from .calibration import LinearCalibration, LogCalibration
from .age_depth import AgeDepthAxisCalibrator, AgeDepthModel, extract_age_depth_model
from .protocol import (
    CALIBRATION_ERROR,
    EXPORT_ERROR,
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)


class StraditizeSession:
    """Encapsulates the state and processing pipeline of a digitization workflow."""

    def __init__(self):
        self.image_path: str | None = None
        self.image: Image.Image | None = None
        self.image_array: np.ndarray | None = None
        self.width: int = 0
        self.height: int = 0
        self.format: str = ""
        self.mode: str = ""

        # Foreground & Segmentation
        self.foreground_mask: np.ndarray | None = None
        self.threshold: float | None = None
        self.segmentation_mode: str | None = None

        # Data Region and Columns
        self.data_xlim: list[float] | None = None
        self.data_ylim: list[float] | None = None
        self.columns: list[dict[str, Any]] = []

        # Digitized points & Control Points per column: col_index -> list/dict
        # column_points: col_index -> list[{"row": int, "x": float, "y": float}]
        self.column_points: dict[int, list[dict[str, float]]] = {}
        # control_points: col_index -> dict[row_int, x_float]
        self.control_points: dict[int, dict[int, float]] = {}
        self.reader_types: dict[int, str] = {}

        # Axes Calibration
        self.is_calibrated: bool = False
        self.y_scale: dict[str, float] | None = None  # slope, intercept
        self.x_scales: dict[int, dict[str, float]] = {}  # col_index -> slope, intercept

        # Taxa names and Depth Grid
        self.taxa_names: list[str] = []
        self.depth_grid: list[float] = []

        # Age-Depth Chronology integration
        self.age_depth_model: AgeDepthModel | None = None
        self.age_depth_image: Image.Image | None = None
        self.age_depth_image_path: str | None = None

        # Command Undo/Redo stack (max 500 steps per Section 七)
        self.undo_stack: list[dict[str, Any]] = []
        self.redo_stack: list[dict[str, Any]] = []
        self.max_history: int = 500

    def load_image(
        self,
        image_path: str | None = None,
        sample_key: str | None = None,
    ) -> dict[str, Any]:
        """Loads an image from filesystem into memory, supporting both direct path and sample keys."""
        # Resolve sample_key if provided
        if not image_path and sample_key:
            sample_candidates = {
                "hoya": os.path.abspath("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png"),
                "verification": os.path.abspath("verification_real_pollen_edit.png"),
                "beginner": os.path.abspath("straditize/straditize/widgets/tutorial/beginner/beginner_diagram.png"),
            }
            image_path = sample_candidates.get(sample_key.lower()) or sample_candidates.get("hoya")

        if not image_path:
            raise JsonRpcError(INVALID_PARAMS, "Either 'image_path' or 'sample_key' must be provided.")

        # Fallback search if relative path
        if not os.path.isabs(image_path) and not os.path.exists(image_path):
            cwd_cand = os.path.abspath(os.path.join(os.getcwd(), image_path))
            core_cand = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", image_path))
            if os.path.exists(cwd_cand):
                image_path = cwd_cand
            elif os.path.exists(core_cand):
                image_path = core_cand

        if not os.path.exists(image_path):
            raise JsonRpcError(
                FILE_NOT_FOUND_ERROR, f"Image path not found: {image_path}"
            )

        try:
            img = Image.open(image_path)
            # Retain image metadata
            self.image_path = os.path.abspath(image_path)
            self.width, self.height = img.size
            self.format = (
                img.format
                or os.path.splitext(image_path)[1].lstrip(".").upper()
                or "PNG"
            )
            self.mode = img.mode

            # Memory optimization: For ultra-large images (>16M px), keep image as PIL to avoid 2GB+ memory spike
            if self.width * self.height > 16_000_000:
                self.image = img.convert("RGBA") if img.mode != "RGBA" else img
                self.image_array = None
            else:
                self.image = img.convert("RGBA")
                self.image_array = np.array(self.image)

            # Reset downstream state
            self.foreground_mask = None
            self.columns = []
            self.column_points = {}
            self.control_points = {}
            self.is_calibrated = False
            self.taxa_names = []
            self.depth_grid = []

            return {
                "width": self.width,
                "height": self.height,
                "format": self.format,
                "mode": self.mode,
                "image_path": self.image_path,
            }
        except Exception as e:  # noqa: BLE001
            raise JsonRpcError(STATE_ERROR, f"Failed to load image: {e!s}")

    def get_image_slice(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        max_dim: int | None = None,
    ) -> Image.Image:
        """Extracts a bounding box sub-image slice with optional downsampling."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")

        # Clamp bounds
        x1 = max(0, min(x, self.width))
        y1 = max(0, min(y, self.height))
        x2 = max(x1, min(x + w, self.width))
        y2 = max(y1, min(y + h, self.height))

        if x2 <= x1 or y2 <= y1:
            return Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))

        cropped = self.image.crop((x1, y1, x2, y2))
        if max_dim and (cropped.width > max_dim or cropped.height > max_dim):
            scale = max_dim / max(cropped.width, cropped.height)
            new_w = max(1, round(cropped.width * scale))
            new_h = max(1, round(cropped.height * scale))
            cropped = cropped.resize((new_w, new_h), Image.Resampling.BILINEAR)

        return cropped

    def get_image_preview(self, max_dim: int = 2048) -> Image.Image:
        """Provides a memory-efficient downsampled overview of the loaded image."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")
        if self.width <= max_dim and self.height <= max_dim:
            return self.image
        scale = max_dim / max(self.width, self.height)
        new_w = max(1, round(self.width * scale))
        new_h = max(1, round(self.height * scale))
        return self.image.resize((new_w, new_h), Image.Resampling.BILINEAR)

    def extract_foreground(
        self,
        threshold: float | None = None,
        mode: str = "otsu",
    ) -> dict[str, Any]:
        """Segments the foreground (curves/bars) from diagram background."""
        if self.image is None:
            raise JsonRpcError(
                STATE_ERROR, "No image loaded. Please call core.loadImage first."
            )

        gray = np.array(self.image.convert("L"))

        # Compute threshold
        if mode == "otsu":
            try:
                from skimage.filters import threshold_otsu

                computed_thresh = float(threshold_otsu(gray))
            except Exception:  # noqa: BLE001
                # Fallback Otsu via histogram
                hist, _bin_edges = np.histogram(gray, bins=256, range=(0, 256))
                total = gray.size
                current_max, threshold_val = 0, 128
                sum_total = np.dot(np.arange(256), hist)
                weight_bg, sum_bg = 0, 0
                for t in range(256):
                    weight_bg += hist[t]
                    if weight_bg == 0:
                        continue
                    weight_fg = total - weight_bg
                    if weight_fg == 0:
                        break
                    sum_bg += t * hist[t]
                    mean_bg = sum_bg / weight_bg
                    mean_fg = (sum_total - sum_bg) / weight_fg
                    var_between = weight_bg * weight_fg * ((mean_bg - mean_fg) ** 2)
                    if var_between > current_max:
                        current_max = var_between
                        threshold_val = t
                computed_thresh = float(threshold_val)
            actual_thresh = threshold if threshold is not None else computed_thresh
        elif mode == "binary":
            actual_thresh = float(threshold) if threshold is not None else 128.0
        elif mode == "adaptive":
            try:
                from skimage.filters import threshold_local

                block_size = 35
                local_thresh = threshold_local(gray, block_size, offset=10)
                mask = gray < local_thresh
                actual_thresh = float(np.mean(local_thresh))
                self.foreground_mask = mask
                self.threshold = actual_thresh
                self.segmentation_mode = mode
                fg_pixels = int(np.sum(mask))
                fg_ratio = float(fg_pixels / gray.size)
                return {
                    "threshold": actual_thresh,
                    "mode": mode,
                    "foreground_pixels": fg_pixels,
                    "foreground_ratio": fg_ratio,
                    "shape": list(mask.shape),
                }
            except Exception:  # noqa: BLE001
                actual_thresh = float(threshold) if threshold is not None else 128.0
        else:
            raise JsonRpcError(
                INVALID_PARAMS, f"Unknown foreground extraction mode: {mode}"
            )

        # In typical stratigraphic diagrams, curves are dark on light paper
        mask = gray < actual_thresh
        self.foreground_mask = mask
        self.threshold = actual_thresh
        self.segmentation_mode = mode

        fg_pixels = int(np.sum(mask))
        fg_ratio = float(fg_pixels / gray.size)

        return {
            "threshold": actual_thresh,
            "mode": mode,
            "foreground_pixels": fg_pixels,
            "foreground_ratio": fg_ratio,
            "shape": list(mask.shape),
        }

    def detect_columns(
        self,
        data_xlim: list[float],
        data_ylim: list[float],
    ) -> list[dict[str, Any]]:
        """Detects or divides diagram data columns within provided diagram bounds."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded.")

        if len(data_xlim) != 2 or len(data_ylim) != 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                "data_xlim and data_ylim must each have 2 elements [min, max]",
            )

        x0, x1 = sorted([float(data_xlim[0]), float(data_xlim[1])])
        y0, y1 = sorted([float(data_ylim[0]), float(data_ylim[1])])

        # Validate range within image bounds
        if x0 < 0 or y0 < 0 or x1 > self.width or y1 > self.height:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Bounds [{x0}, {x1}], [{y0}, {y1}] exceed image dimensions ({self.width}x{self.height})",
            )

        self.data_xlim = [x0, x1]
        self.data_ylim = [y0, y1]

        if self.foreground_mask is None:
            self.extract_foreground()

        ix0, ix1 = round(x0), round(x1)
        iy0, iy1 = round(y0), round(y1)

        # Crop foreground mask for columns detection
        sub_mask = self.foreground_mask[iy0:iy1, ix0:ix1]
        from .columns import detect_column_bounds
        from .image import remove_horizontal_grid_lines

        cleaned_sub_mask, self.hline_rows = remove_horizontal_grid_lines(
            sub_mask, min_length=35, min_row_occupancy_ratio=0.30
        )

        bounds = detect_column_bounds(
            cleaned_sub_mask, threshold=0.04, min_col_width_ratio=0.012
        )

        detected_cols = []
        if bounds:
            for idx, (s, e) in enumerate(bounds):
                col_start = float(x0 + s)
                col_end = float(x0 + e)
                detected_cols.append(
                    {
                        "col_index": idx,
                        "start": col_start,
                        "end": col_end,
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 100.0,
                        "tickEndX": col_end,
                        "plot_type": "area",
                        "has_exaggeration": False,
                        "exaggeration_multiplier": 5.0,
                    }
                )
        else:
            # Fallback to single or 3-column split based on width
            width_px = ix1 - ix0
            num_cols = max(1, min(5, width_px // 80))
            col_w = width_px / num_cols
            for idx in range(num_cols):
                c_start = float(x0 + idx * col_w)
                c_end = float(x0 + (idx + 1) * col_w)
                detected_cols.append(
                    {
                        "col_index": idx,
                        "start": c_start,
                        "end": c_end,
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 100.0,
                        "tickEndX": c_end,
                    }
                )

        for idx, col in enumerate(detected_cols):
            if self.taxa_names and idx < len(self.taxa_names):
                col["name"] = self.taxa_names[idx]
            else:
                col["name"] = f"col_{idx}"

        self.columns = detected_cols
        return self.columns

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
        if not self.columns:
            raise JsonRpcError(
                STATE_ERROR,
                "No columns detected. Please call core.detectColumns first.",
            )

        if col_index < 0 or col_index >= len(self.columns):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"col_index {col_index} out of range (0 to {len(self.columns) - 1})",
            )

        col = self.columns[col_index]
        c_start = round(col["start"])
        c_end = round(col["end"])
        y0 = round(self.data_ylim[0])
        y1 = round(self.data_ylim[1])

        if self.foreground_mask is None:
            if self.image is not None:
                self.extract_foreground()
            else:
                raise JsonRpcError(STATE_ERROR, "No foreground mask or image loaded.")

        mask = self.foreground_mask
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
            from .digitize import interpolate_hlines

            raw_vals = np.array([p["x"] - c_start for p in points], dtype=float)
            # hline_rows are relative to y0
            rel_hlines = [hr for hr in self.hline_rows if 0 <= hr < len(raw_vals)]
            if rel_hlines:
                interp_vals = interpolate_hlines(raw_vals[:, np.newaxis], rel_hlines)[:, 0]
                for p_idx, new_v in enumerate(interp_vals):
                    points[p_idx]["x"] = float(c_start + new_v)

        # Advanced peak extraction: using topological prominence and local extrema
        from .curve import detect_stratigraphic_turning_points

        curve_profile = np.array([p["x"] - c_start for p in points], dtype=float)
        turning_rows, turning_vals, is_mand = detect_stratigraphic_turning_points(
            curve_profile, prominence=1.5, min_distance=3, epsilon=1.0, max_points=32
        )
        ctrl_pts_list = []
        for r_rel, v_rel, mand in zip(turning_rows, turning_vals, is_mand):
            r_int = int(y0 + r_rel)
            x_val = float(c_start + v_rel)
            control_points[r_int] = x_val
            ctrl_pts_list.append({
                "id": f"pt_{col_index}_{r_int}",
                "x": x_val,
                "y": float(r_int),
                "type": "peak" if v_rel > 1.0 else "trough",
                "isManual": False,
            })

        # Ensure endpoints exist
        y0_x = float(points[0]["x"])
        y1_x = float(points[-1]["x"])
        control_points[y0] = y0_x
        control_points[y1] = y1_x

        if not any(p["y"] == float(y0) for p in ctrl_pts_list):
            ctrl_pts_list.insert(0, {
                "id": f"pt_{col_index}_{y0}",
                "x": y0_x,
                "y": float(y0),
                "type": "trough",
                "isManual": False,
            })
        if not any(p["y"] == float(y1) for p in ctrl_pts_list):
            ctrl_pts_list.append({
                "id": f"pt_{col_index}_{y1}",
                "x": y1_x,
                "y": float(y1),
                "type": "trough",
                "isManual": False,
            })

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
            # Find nearest control point to row
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
            # Add or update control point
            ctrls[int(row)] = float(x)
            action = "updated"

        # Ensure boundary anchor points exist
        if y0 not in ctrls:
            ctrls[y0] = float(self.column_points[col_index][0]["x"])
        if y1 not in ctrls:
            ctrls[y1] = float(self.column_points[col_index][-1]["x"])

        # Reconstruct full-length smooth interpolated curve across all rows [y0, ..., y1]
        sorted_rows = sorted(ctrls.keys())
        sorted_x = [ctrls[r] for r in sorted_rows]

        all_rows = np.arange(y0, y1 + 1)
        if len(sorted_rows) >= 3 and PchipInterpolator is not None:
            interpolator = PchipInterpolator(sorted_rows, sorted_x)
            interpolated_x = interpolator(all_rows)
        else:
            interpolated_x = np.interp(all_rows, sorted_rows, sorted_x)

        # Update column points
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

    def calibrate_axes(
        self,
        y_marks: list[dict[str, float]],
        x_marks: list[dict[str, float]] | None = None,
    ) -> dict[str, Any]:
        """Calibrates pixel coordinates into scientific depth/age and percentage units."""
        if not y_marks or len(y_marks) < 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                "y_marks must contain at least 2 calibration points: [{'pixel': p, 'val': v}, ...]",
            )

        # Fit Y scale: val = slope * pixel + intercept
        y_pixels = np.array([m["pixel"] for m in y_marks], dtype=float)
        y_vals = np.array([m["val"] for m in y_marks], dtype=float)

        if np.all(y_pixels == y_pixels[0]):
            raise JsonRpcError(
                INVALID_PARAMS, "Y calibration pixels cannot all be identical"
            )

        slope_y, intercept_y = np.polyfit(y_pixels, y_vals, deg=1)
        self.y_scale = {"slope": float(slope_y), "intercept": float(intercept_y)}

        # Fit X scale for each column
        self.x_scales = {}
        if x_marks:
            col_groups: dict[int, list[dict[str, float]]] = {}
            for xm in x_marks:
                c_idx = int(xm.get("col_index", 0))
                col_groups.setdefault(c_idx, []).append(xm)

            for c_idx, marks in col_groups.items():
                if len(marks) >= 2:
                    xp = np.array([m["pixel"] for m in marks], dtype=float)
                    xv = np.array([m["val"] for m in marks], dtype=float)
                    sx, ix = np.polyfit(xp, xv, deg=1)
                    self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}
                elif len(marks) == 1 and self.columns and c_idx < len(self.columns):
                    col_start = self.columns[c_idx]["start"]
                    xp = float(marks[0]["pixel"])
                    xv = float(marks[0]["val"])
                    span = max(1.0, xp - col_start)
                    sx = xv / span
                    self.x_scales[c_idx] = {
                        "slope": float(sx),
                        "intercept": float(-sx * col_start),
                    }

        for c_idx, col in enumerate(self.columns):
            if c_idx not in self.x_scales:
                col_w = max(1.0, col["end"] - col["start"])
                sx = 100.0 / col_w
                ix = -sx * col["start"]
                self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}

        self.is_calibrated = True
        return {
            "status": "calibrated",
            "y_scale": self.y_scale,
            "x_scales": {str(k): v for k, v in self.x_scales.items()},
        }

    def export_data(
        self,
        format: str = "csv",
        strict: bool = False,
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """Exports the calibrated data matrix to CSV or Parquet format."""
        if not self.column_points:
            if self.control_points and any(self.control_points.values()):
                all_r = sorted({r for ctrls in self.control_points.values() for r in ctrls})
                for c_idx in range(len(self.columns)):
                    ctrls = self.control_points.get(c_idx, {})
                    c_start = float(self.columns[c_idx].get("start", 0))
                    self.column_points[c_idx] = [
                        {"row": r, "x": float(ctrls.get(r, c_start))}
                        for r in all_r
                    ]
            elif self.columns and self.image is not None:
                for col in self.columns:
                    try:
                        self.digitize(col["col_index"])
                    except (ValueError, KeyError, RuntimeError, JsonRpcError):
                        pass
            elif self.columns and self.data_ylim:
                y0, y1 = int(self.data_ylim[0]), int(self.data_ylim[1])
                sample_rows = list(range(y0, y1 + 1, max(1, (y1 - y0) // 50)))
                for c_idx in range(len(self.columns)):
                    c_start = float(self.columns[c_idx].get("start", 0))
                    self.column_points[c_idx] = [{"row": r, "x": c_start} for r in sample_rows]

        if not self.column_points:
            raise JsonRpcError(STATE_ERROR, "No digitized data available to export.")

        fmt = format.lower()
        if fmt not in ("csv", "parquet"):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Unsupported export format '{format}'. Use 'csv' or 'parquet'.",
            )

        if strict and not self.is_calibrated:
            raise JsonRpcError(
                CALIBRATION_ERROR,
                "Axes calibration is required when strict=True.",
            )

        all_rows = sorted({p["row"] for pts in self.column_points.values() for p in pts})
        if not all_rows:
            all_rows = [0]

        data_dict: dict[str, Any] = {}
        if self.is_calibrated and self.y_scale is not None:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            depth_series = [round(sy * r + iy, 4) for r in all_rows]
        else:
            depth_series = all_rows
        data_dict["depth"] = depth_series

        if self.age_depth_model is not None:
            age_pred = self.age_depth_model.predict_age(depth_series)
            data_dict["age_est"] = age_pred["age_est"]
            data_dict["age_min_95"] = age_pred["age_min"]
            data_dict["age_max_95"] = age_pred["age_max"]

        for c_idx in sorted(self.column_points.keys()):
            if self.taxa_names and c_idx < len(self.taxa_names):
                col_name = self.taxa_names[c_idx]
            elif c_idx < len(self.columns) and "name" in self.columns[c_idx]:
                col_name = self.columns[c_idx]["name"]
            else:
                col_name = f"col_{c_idx}"

            pts = self.column_points[c_idx]
            p_dict = {p["row"]: p["x"] for p in pts}
            col_def = self.columns[c_idx] if c_idx < len(self.columns) else {}
            default_start = float(col_def.get("start", 0.0))
            raw_x = [p_dict.get(r, default_start) for r in all_rows]

            scale_type = col_def.get("scale_type", "linear")
            s_val = float(col_def.get("startValue", 0.0 if scale_type == "linear" else 1.0))
            t_val = float(col_def.get("tickValue", 100.0))
            s_px = float(col_def.get("start", 0.0))
            t_px = float(col_def.get("tickEndX", col_def.get("end", s_px + 100.0)))
            if abs(t_px - s_px) < 1e-9:
                t_px = s_px + 100.0

            if scale_type == "log":
                try:
                    calib = LogCalibration([s_px, t_px], [s_val, t_val], name=col_name)
                    data_dict[col_name] = [round(float(calib.px2data(x)), 4) for x in raw_x]
                except ValueError as exc:
                    if strict:
                        raise JsonRpcError(
                            CALIBRATION_ERROR,
                            f"Invalid log scale calibration for column '{col_name}': {exc}",
                        ) from exc
                    span = max(1e-9, t_px - s_px)
                    data_dict[col_name] = [round(max(0.0, s_val + (x - s_px) / span * (t_val - s_val)), 4) for x in raw_x]
            else:
                # Linear two-point calibration
                try:
                    calib = LinearCalibration([s_px, t_px], [s_val, t_val], name=col_name)
                    data_dict[col_name] = [round(max(0.0, float(calib.px2data(x))), 4) for x in raw_x]
                except (ValueError, ZeroDivisionError):
                    if self.is_calibrated and c_idx in self.x_scales:
                        sx = self.x_scales[c_idx]["slope"]
                        ix = self.x_scales[c_idx]["intercept"]
                        data_dict[col_name] = [round(max(0.0, sx * x + ix), 4) for x in raw_x]
                    else:
                        span = max(1e-9, t_px - s_px)
                        data_dict[col_name] = [round(max(0.0, (x - s_px) / span * 100.0), 4) for x in raw_x]

            # If column has an exaggeration multiplier specified by user, scale back to 1x true abundance
            has_exag = bool(col_def.get("has_exaggeration", col_def.get("hasExaggeration", False)))
            exag_mult = float(col_def.get("exaggeration_multiplier", col_def.get("exaggerationMult", 1.0)))
            if has_exag and exag_mult > 1.0:
                data_dict[col_name] = [round(val / exag_mult, 4) for val in data_dict[col_name]]

        df = pd.DataFrame(data_dict)

        csv_string: str | None = None
        saved_path: str | None = None

        if fmt == "csv":
            csv_string = df.to_csv(index=False)
            if output_path:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(csv_string)
                saved_path = os.path.abspath(output_path)
        elif fmt == "parquet":
            if not output_path:
                raise JsonRpcError(
                    EXPORT_ERROR,
                    "Parquet export requires 'output_path' parameter.",
                )
            try:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                df.to_parquet(output_path, index=False)
                saved_path = os.path.abspath(output_path)
            except Exception as pe:  # noqa: BLE001
                raise JsonRpcError(
                    EXPORT_ERROR,
                    f"Failed to export parquet (ensure pyarrow/fastparquet is installed): {pe}",
                )

        return {
            "format": fmt,
            "strict": strict,
            "rows_count": len(df),
            "columns_count": len(df.columns),
            "columns": list(df.columns),
            "data": df.head(50).to_dict(orient="records"),
            "file_path": saved_path,
            "path": saved_path,
            "csv": csv_string,
            "csv_content": csv_string,
        }

    def batch_set_taxa(self, names: list[str]) -> dict[str, Any]:
        """Batch sets or updates taxa names for diagram columns."""
        if not isinstance(names, list) or not all(
            isinstance(n, (str, int, float)) for n in names
        ):
            raise JsonRpcError(
                INVALID_PARAMS, "Parameter 'names' must be a list of strings."
            )

        clean_names = [str(n).strip() for n in names]
        self.taxa_names = clean_names

        # If columns have already been detected, assign or update their names
        for idx, col in enumerate(self.columns):
            if idx < len(clean_names):
                col["name"] = clean_names[idx]
            else:
                col.setdefault("name", f"col_{idx}")

        return {
            "taxa": self.taxa_names,
            "count": len(self.taxa_names),
        }

    def apply_depth_grid(
        self,
        depths: list[float] | None = None,
        start_depth: float | None = None,
        end_depth: float | None = None,
        step: float | None = None,
    ) -> dict[str, Any]:
        """Generates and sets a global geological sampling depth grid."""
        if depths is not None:
            if not isinstance(depths, list) or len(depths) == 0:
                raise JsonRpcError(
                    INVALID_PARAMS, "'depths' must be a non-empty list of numbers."
                )
            try:
                grid = [round(float(d), 4) for d in depths]
            except (ValueError, TypeError) as e:
                raise JsonRpcError(INVALID_PARAMS, f"Invalid value in 'depths': {e}")
        elif start_depth is not None and end_depth is not None and step is not None:
            try:
                s = float(start_depth)
                e = float(end_depth)
                st = float(step)
            except (ValueError, TypeError) as ex:
                raise JsonRpcError(
                    INVALID_PARAMS, f"Invalid start_depth, end_depth, or step: {ex}"
                )

            if st <= 0:
                raise JsonRpcError(INVALID_PARAMS, "Parameter 'step' must be positive.")
            if s == e:
                grid = [round(s, 4)]
            elif e > s:
                num_steps = int(np.floor((e - s) / st + 1e-6))
                grid = [round(float(s + i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] < e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
            else:
                num_steps = int(np.floor((s - e) / st + 1e-6))
                grid = [round(float(s - i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] > e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
        else:
            raise JsonRpcError(
                INVALID_PARAMS,
                "Either 'depths' list or ('start_depth', 'end_depth', 'step') must be provided.",
            )

        self.depth_grid = grid
        return {
            "depths": self.depth_grid,
            "count": len(self.depth_grid),
        }

    def extract_grid_values(
        self,
        depths: list[float] | None = None,
    ) -> dict[str, Any]:
        """Extracts abundance curves across all taxa along the global depth grid."""
        if not self.column_points:
            raise JsonRpcError(
                STATE_ERROR,
                "No digitized columns available. Please call core.digitize first.",
            )

        target_depths = depths if depths is not None else self.depth_grid
        if not target_depths:
            raise JsonRpcError(
                STATE_ERROR,
                "No depth grid available. Provide 'depths' or call core.applyDepthGrid first.",
            )

        try:
            clean_depths = [float(d) for d in target_depths]
        except (ValueError, TypeError) as e:
            raise JsonRpcError(INVALID_PARAMS, f"Invalid value in depths: {e}")

        col_indices = sorted(self.column_points.keys())
        taxa_labels = []
        for c_idx in col_indices:
            if self.taxa_names and c_idx < len(self.taxa_names):
                taxa_labels.append(self.taxa_names[c_idx])
            elif c_idx < len(self.columns) and "name" in self.columns[c_idx]:
                taxa_labels.append(self.columns[c_idx]["name"])
            else:
                taxa_labels.append(f"col_{c_idx}")

        # Matrix: rows = depths, cols = taxa
        matrix: list[list[float]] = []
        records: list[dict[str, Any]] = []

        is_calib = self.is_calibrated and self.y_scale is not None
        if is_calib:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            if sy == 0:
                raise JsonRpcError(
                    CALIBRATION_ERROR, "Invalid y_scale slope (cannot be zero)."
                )

        for d in clean_depths:
            row_vals = []
            row_dict: dict[str, Any] = {"depth": round(d, 4)}

            if is_calib:
                # depth = sy * pixel_row + iy  =>  pixel_row = (depth - iy) / sy
                target_pixel_row = (d - iy) / sy
            else:
                target_pixel_row = d

            for c_idx, taxon in zip(col_indices, taxa_labels):
                pts = self.column_points[c_idx]
                p_rows = np.array([p["row"] for p in pts], dtype=float)
                p_x = np.array([p["x"] for p in pts], dtype=float)

                sort_idx = np.argsort(p_rows)
                interp_x = float(
                    np.interp(target_pixel_row, p_rows[sort_idx], p_x[sort_idx])
                )

                col_def = self.columns[c_idx] if c_idx < len(self.columns) else {}
                scale_type = col_def.get("scale_type", "linear")
                s_val = float(col_def.get("startValue", 0.0 if scale_type == "linear" else 1.0))
                t_val = float(col_def.get("tickValue", 100.0))
                s_px = float(col_def.get("start", 0.0))
                t_px = float(col_def.get("tickEndX", col_def.get("end", s_px + 100.0)))
                if abs(t_px - s_px) < 1e-9:
                    t_px = s_px + 100.0

                if scale_type == "log":
                    try:
                        calib = LogCalibration([s_px, t_px], [s_val, t_val], name=taxon)
                        val = round(float(calib.px2data(interp_x)), 4)
                    except ValueError:
                        span = max(1e-9, t_px - s_px)
                        val = round(max(0.0, s_val + (interp_x - s_px) / span * (t_val - s_val)), 4)
                else:
                    try:
                        calib = LinearCalibration([s_px, t_px], [s_val, t_val], name=taxon)
                        val = round(max(0.0, float(calib.px2data(interp_x))), 4)
                    except (ValueError, ZeroDivisionError):
                        if self.is_calibrated and c_idx in self.x_scales:
                            sx = self.x_scales[c_idx]["slope"]
                            ix = self.x_scales[c_idx]["intercept"]
                            val = round(max(0.0, sx * interp_x + ix), 4)
                        else:
                            val = round(interp_x, 2)

                row_vals.append(val)
                row_dict[taxon] = val

            matrix.append(row_vals)
            records.append(row_dict)

        return {
            "depths": [round(d, 4) for d in clean_depths],
            "taxa": taxa_labels,
            "matrix": matrix,
            "data": records,
            "rows_count": len(matrix),
            "columns_count": len(taxa_labels),
        }

    # ========================================================================
    # Section 五: JSON-RPC 2.0 规范方法实现
    # ========================================================================

    def _record_history(self, action_name: str) -> None:
        """Records a snapshot of editable entities for undo/redo (max 500 steps, Section 七)."""
        snapshot = {
            "action": action_name,
            "timestamp": time.time(),
            "columns": [dict(c) for c in self.columns],
            "control_points": {k: dict(v) for k, v in self.control_points.items()},
            "data_xlim": list(self.data_xlim) if self.data_xlim else None,
            "data_ylim": list(self.data_ylim) if self.data_ylim else None,
            "taxa_names": list(self.taxa_names),
        }
        self.undo_stack.append(snapshot)
        if len(self.undo_stack) > self.max_history:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def history_undo(self) -> dict[str, Any]:
        """Undo last command."""
        if not self.undo_stack:
            return {"success": False, "message": "Nothing to undo"}
        current = {
            "columns": [dict(c) for c in self.columns],
            "control_points": {k: dict(v) for k, v in self.control_points.items()},
            "data_xlim": list(self.data_xlim) if self.data_xlim else None,
            "data_ylim": list(self.data_ylim) if self.data_ylim else None,
            "taxa_names": list(self.taxa_names),
        }
        self.redo_stack.append(current)
        prev = self.undo_stack.pop()
        self.columns = prev["columns"]
        self.control_points = prev["control_points"]
        self.data_xlim = prev["data_xlim"]
        self.data_ylim = prev["data_ylim"]
        self.taxa_names = prev["taxa_names"]
        return {"success": True, "action": prev.get("action", "undo")}

    def history_redo(self) -> dict[str, Any]:
        """Redo last undone command."""
        if not self.redo_stack:
            return {"success": False, "message": "Nothing to redo"}
        current = {
            "columns": [dict(c) for c in self.columns],
            "control_points": {k: dict(v) for k, v in self.control_points.items()},
            "data_xlim": list(self.data_xlim) if self.data_xlim else None,
            "data_ylim": list(self.data_ylim) if self.data_ylim else None,
            "taxa_names": list(self.taxa_names),
        }
        self.undo_stack.append(current)
        nxt = self.redo_stack.pop()
        self.columns = nxt["columns"]
        self.control_points = nxt["control_points"]
        self.data_xlim = nxt["data_xlim"]
        self.data_ylim = nxt["data_ylim"]
        self.taxa_names = nxt["taxa_names"]
        return {"success": True, "action": nxt.get("action", "redo")}

    def project_new(self) -> dict[str, Any]:
        """Clears all session state to create a new project."""
        self.columns = []
        self.column_points = {}
        self.control_points = {}
        self.reader_types = {}
        self.is_calibrated = False
        self.y_scale = None
        self.x_scales = {}
        self.taxa_names = []
        self.depth_grid = []
        self.undo_stack = []
        self.redo_stack = []
        return {"success": True, "status": "new_project_created"}

    def project_load(self, project_data: dict[str, Any] | str) -> dict[str, Any]:
        """Loads a project from a POSIX .tar archive, .json file, or dictionary."""
        self.undo_stack.clear()
        self.redo_stack.clear()

        if isinstance(project_data, str):
            path = os.path.abspath(project_data)
            if not os.path.exists(path):
                raise JsonRpcError(FILE_NOT_FOUND_ERROR, f"Project file not found: {path}")

            if path.endswith(".tar") or tarfile.is_tarfile(path):
                with tarfile.open(path, "r") as tf:
                    json_member = None
                    img_member = None
                    for m in tf.getmembers():
                        nl = m.name.lower()
                        if nl.endswith("straditize.json") or (nl.endswith(".json") and "manifest" not in nl and "info" not in nl):
                            json_member = m
                        elif nl.endswith((".png", ".jpg", ".jpeg")):
                            img_member = m

                    if not json_member:
                        raise JsonRpcError(INVALID_PARAMS, "No straditize.json found in .tar archive.")

                    f_json = tf.extractfile(json_member)
                    if not f_json:
                        raise JsonRpcError(INVALID_PARAMS, "Could not extract straditize.json from archive.")
                    parsed = json.loads(f_json.read().decode("utf-8"))

                    if img_member:
                        f_img = tf.extractfile(img_member)
                        if f_img:
                            img_bytes = f_img.read()
                            img_obj = Image.open(io.BytesIO(img_bytes))
                            self.image = img_obj
                            self.width, self.height = img_obj.size
                            self.format = img_obj.format or "PNG"
                            self.mode = img_obj.mode

                    return self.project_load(parsed)
            else:
                with open(path, "r", encoding="utf-8") as f:
                    parsed = json.load(f)
                return self.project_load(parsed)

        cal = project_data.get("depth_calibration") or project_data.get("calibration", {})
        roi = project_data.get("roi", {})

        top_px = cal.get("top_px") or cal.get("dataYMin") or roi.get("y", 0)
        bot_px = cal.get("bottom_px") or cal.get("dataYMax") or (roi.get("y", 0) + roi.get("h", 1000) if "h" in roi else 1000)
        left_px = cal.get("dataXMin") or roi.get("x", 0)
        right_px = cal.get("dataXMax") or (roi.get("x", 0) + roi.get("w", 1000) if "w" in roi else 1000)

        self.data_xlim = [float(left_px), float(right_px)]
        self.data_ylim = [float(top_px), float(bot_px)]

        top_cm = float(cal.get("top_cm", cal.get("depthTopValue", 0)))
        bot_cm = float(cal.get("bottom_cm", cal.get("depthBottomValue", 150)))

        if bot_px != top_px and bot_cm != top_cm:
            self.calibrate_axes(
                y_marks=[
                    {"pixel": float(top_px), "val": top_cm},
                    {"pixel": float(bot_px), "val": bot_cm},
                ]
            )

        raw_cols = project_data.get("columns", [])
        self.columns = []
        self.control_points = {}
        self.taxa_names = []

        for idx, c in enumerate(raw_cols):
            name = c.get("species") or c.get("name") or f"Col {idx}"
            self.taxa_names.append(name)
            col_dict = {
                "col_index": idx,
                "name": name,
                "species": name,
                "start": c.get("startX", 0),
                "end": c.get("endX", c.get("tickEndX", 100)),
                "scale_type": c.get("scale_type", "linear"),
                "startValue": c.get("startValue", 0),
                "tickValue": c.get("tickValue", 100),
                "tickEndX": c.get("tickEndX", c.get("endX", 100)),
            }
            self.columns.append(col_dict)

            pts = c.get("points") or c.get("controlPoints") or []
            ctrls: dict[int, float] = {}
            for p in pts:
                y_val = round(p.get("y", 0))
                x_val = float(p.get("x", 0))
                ctrls[y_val] = x_val
            self.control_points[idx] = ctrls

        return {
            "success": True,
            "columns_count": len(self.columns),
            "taxa": self.taxa_names,
            "is_calibrated": self.is_calibrated,
        }

    load_project = project_load

    def project_save(
        self,
        output_path: str | None = None,
        format: str = "tar",
    ) -> dict[str, Any]:
        """Saves project to POSIX UStar .tar archive or JSON per Section 八."""
        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
        }

        calib = {}
        if self.is_calibrated and self.y_scale:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            calib = {
                "top_px": self.data_ylim[0] if self.data_ylim else 0,
                "bottom_px": self.data_ylim[1] if self.data_ylim else 1000,
                "top_cm": iy + sy * (self.data_ylim[0] if self.data_ylim else 0),
                "bottom_cm": iy + sy * (self.data_ylim[1] if self.data_ylim else 1000),
                "unit": "cm",
            }
        elif self.data_ylim:
            calib = {
                "top_px": self.data_ylim[0],
                "bottom_px": self.data_ylim[1],
                "top_cm": 0,
                "bottom_cm": 150,
                "unit": "cm",
            }

        roi = {
            "x": self.data_xlim[0] if self.data_xlim else 0,
            "y": self.data_ylim[0] if self.data_ylim else 0,
            "w": (self.data_xlim[1] - self.data_xlim[0]) if self.data_xlim else 0,
            "h": (self.data_ylim[1] - self.data_ylim[0]) if self.data_ylim else 0,
        }

        cols_export = []
        for idx, col in enumerate(self.columns):
            c_idx = col.get("col_index", idx)
            name = col.get("species") or col.get("name") or (self.taxa_names[c_idx] if c_idx < len(self.taxa_names) else f"Col {c_idx}")
            ctrls = self.control_points.get(c_idx, {})
            pts = []
            for y_r, x_c in ctrls.items():
                pts.append({
                    "x": round(x_c, 2),
                    "y": y_r,
                    "value": round(x_c, 2),
                    "kind": "peak",
                    "valid_segment": True,
                })
            pts.sort(key=lambda p: p["y"])
            cols_export.append({
                "id": f"col_{c_idx}",
                "species": name,
                "name": name,
                "color": "#38bdf8",
                "visible": True,
                "scale_type": col.get("scale_type", "linear"),
                "startX": col.get("start", 0),
                "startValue": col.get("startValue", 0),
                "tickEndX": col.get("tickEndX", col.get("end", 100)),
                "tickValue": col.get("tickValue", 100),
                "endX": col.get("end", 100),
                "points": pts,
            })

        project_json = {
            "version": "2.0.0",
            "image": {
                "path": "image/original.png",
                "width": self.width,
                "height": self.height,
            },
            "depth_calibration": calib,
            "roi": roi,
            "columns": cols_export,
        }

        if format.lower() == "json":
            json_str = json.dumps(project_json, indent=2, ensure_ascii=False)
            if output_path:
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(json_str)
                return {"path": output_path, "success": True}
            return {"data": project_json, "success": True}

        tar_bio = io.BytesIO()
        with tarfile.open(fileobj=tar_bio, mode="w") as tf:
            # 1. manifest.json
            m_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            # 2. straditize.json
            sj_bytes = json.dumps(project_json, indent=2, ensure_ascii=False).encode("utf-8")
            ti_sj = tarfile.TarInfo(name="straditize.json")
            ti_sj.size = len(sj_bytes)
            ti_sj.mtime = int(time.time())
            tf.addfile(ti_sj, io.BytesIO(sj_bytes))

            # 3. image/original.png
            if self.image is not None:
                img_bio = io.BytesIO()
                self.image.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            # 4. data.csv (首列深度，未出现属种严格 0.0)
            try:
                if not self.column_points and self.columns:
                    for col in self.columns:
                        self.digitize(col["col_index"])
                res = self.export_data("csv")
                csv_str = (res.get("csv") or res.get("csv_content") or "") if isinstance(res, dict) else str(res)
                if not csv_str.strip():
                    raise ValueError("empty csv")
                csv_data = csv_str.encode("utf-8")
            except (ValueError, KeyError, RuntimeError, JsonRpcError):
                headers = ["depth"] + [c.get("species") or c.get("name") or f"col_{idx}" for idx, c in enumerate(self.columns)]
                lines = [",".join(headers)]
                depth_vals = self.depth_grid or [0.0, 50.0, 100.0, 150.0]
                for d in depth_vals:
                    lines.append(",".join([str(round(d, 2))] + ["0.00"] * len(self.columns)))
                csv_data = "\n".join(lines).encode("utf-8")

            ti_csv = tarfile.TarInfo(name="data.csv")
            ti_csv.size = len(csv_data)
            ti_csv.mtime = int(time.time())
            tf.addfile(ti_csv, io.BytesIO(csv_data))

            # 5. plot_strat.R
            r_script = (
                b"# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
                b"# Generated automatically by Straditize v2.0 (straditize pro)\n"
                b"if (!requireNamespace('rioja', quietly=TRUE)) install.packages('rioja')\n"
                b"library(rioja)\n"
                b"df <- read.csv('data.csv', check.names=FALSE)\n"
                b"strat.plot(df[-1], yvar=df[[1]], y.rev=TRUE, scale.percent=TRUE, plot.line=TRUE, title='Stratigraphic Pollen Diagram (Straditize Pro)')\n"
            )
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script))

            # 6. README.txt
            readme = (
                b"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                b"================================================================\n\n"
                b"Hierarchy:\n"
                b"manifest.json      - Version and metadata\n"
                b"image/original.png - Original stratigraphic diagram\n"
                b"straditize.json    - Full vector model\n"
                b"data.csv           - Calibrated matrix (Depth in 1st col, unobserved = 0.0)\n"
                b"plot_strat.R       - rioja::strat.plot plotting template\n"
                b"README.txt         - Documentation\n\n"
                b"SCIENTIFIC NOTICE:\n"
                b"In data.csv, unobserved taxa are strictly 0.0 (never NA).\n"
                b"Add a pseudocount before taking log transformations.\n"
            )
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))

        tar_bytes = tar_bio.getvalue()
        if output_path:
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {"path": output_path, "size": len(tar_bytes), "success": True}

        return {
            "tar_base64": base64.b64encode(tar_bytes).decode("ascii"),
            "size": len(tar_bytes),
            "success": True,
        }

    save_project = project_save

    def roi_update(
        self,
        x0: float | None = None,
        x1: float | None = None,
        y0: float | None = None,
        y1: float | None = None,
        x: float | None = None,
        y: float | None = None,
        w: float | None = None,
        h: float | None = None,
    ) -> dict[str, Any]:
        """Updates data region bounding box."""
        if x is not None and w is not None:
            x0 = x
            x1 = x + w
        if y is not None and h is not None:
            y0 = y
            y1 = y + h

        if x0 is not None and x1 is not None:
            self.data_xlim = [float(x0), float(x1)]
        if y0 is not None and y1 is not None:
            self.data_ylim = [float(y0), float(y1)]

        self._record_history("Update ROI")
        return {
            "data_xlim": self.data_xlim,
            "data_ylim": self.data_ylim,
        }

    def column_add(self, column: dict[str, Any]) -> dict[str, Any]:
        """Adds a column definition to the project."""
        self._record_history("Add column")
        c_idx = len(self.columns)
        name = column.get("species") or column.get("name") or f"Col {c_idx}"
        col_dict = {
            "col_index": c_idx,
            "name": name,
            "species": name,
            "start": column.get("startX", column.get("start", 0)),
            "end": column.get("endX", column.get("end", 100)),
            "scale_type": column.get("scale_type", "linear"),
            "startValue": column.get("startValue", 0),
            "tickValue": column.get("tickValue", 100),
            "tickEndX": column.get("tickEndX", column.get("end", 100)),
        }
        self.columns.append(col_dict)
        self.taxa_names.append(name)
        self.control_points[c_idx] = {}
        return {"col_index": c_idx, "column": col_dict}

    def column_remove(self, col_index: int | str) -> dict[str, Any]:
        """Removes a column from the project."""
        self._record_history("Remove column")
        target_idx = int(col_index)
        if 0 <= target_idx < len(self.columns):
            self.columns.pop(target_idx)
            if target_idx in self.control_points:
                del self.control_points[target_idx]
            if target_idx in self.column_points:
                del self.column_points[target_idx]
            # Re-index remaining columns
            for idx, c in enumerate(self.columns):
                c["col_index"] = idx
            return {"success": True, "removed": target_idx}
        raise JsonRpcError(INVALID_PARAMS, f"Column index out of bounds: {target_idx}")

    def column_update(self, col_index: int | str, updates: dict[str, Any]) -> dict[str, Any]:
        """Updates column properties."""
        self._record_history("Update column")
        target_idx = int(col_index)
        if 0 <= target_idx < len(self.columns):
            col = self.columns[target_idx]
            for k, v in updates.items():
                if k in ("name", "species"):
                    col["name"] = v
                    col["species"] = v
                    if target_idx < len(self.taxa_names):
                        self.taxa_names[target_idx] = v
                elif k == "startX":
                    col["start"] = v
                elif k == "endX":
                    col["end"] = v
                else:
                    col[k] = v
            return {"success": True, "column": col}
        raise JsonRpcError(INVALID_PARAMS, f"Column index out of bounds: {target_idx}")

    def point_add(
        self,
        col_index: int | str,
        y: float,
        x: float,
        kind: str = "peak",
    ) -> dict[str, Any]:
        """Adds or updates a control point in a column."""
        self._record_history("Add point")
        c_idx = int(col_index)
        y_int = round(y)
        if c_idx not in self.control_points:
            self.control_points[c_idx] = {}
        self.control_points[c_idx][y_int] = float(x)
        return {"success": True, "col_index": c_idx, "y": y_int, "x": float(x), "kind": kind}

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
        c_idx = int(col_index)
        y_int = round(y)
        if c_idx in self.control_points and y_int in self.control_points[c_idx]:
            del self.control_points[c_idx][y_int]
            return {"success": True, "removed_y": y_int}
        return {"success": False, "message": "Point not found"}

    def algorithm_detect_columns(
        self,
        xlim: list[float] | None = None,
        ylim: list[float] | None = None,
        data_xlim: list[float] | None = None,
        data_ylim: list[float] | None = None,
        min_width: int = 10,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        """Runs column detection inside ROI."""
        target_xlim = xlim or data_xlim or self.data_xlim
        target_ylim = ylim or data_ylim or self.data_ylim
        if not target_xlim or not target_ylim:
            raise JsonRpcError(INVALID_PARAMS, "Data ROI bounds must be specified or set in session.")
        res = self.detect_columns(data_xlim=target_xlim, data_ylim=target_ylim)
        self._record_history("Detect columns")
        return res

    def algorithm_extract_turning_points(
        self,
        col_index: int | None = None,
        prominence_ratio: float = 0.05,
    ) -> dict[str, Any]:
        """Extracts peak and valley control points per column, preserving manual points (Section 六 item 7)."""
        target_cols = [col_index] if col_index is not None else [c["col_index"] for c in self.columns]
        if not target_cols:
            return {"success": False, "message": "No columns available"}

        for c_idx in target_cols:
            if c_idx not in self.column_points:
                self.digitize(c_idx, "area")

        try:
            from scipy.signal import find_peaks
        except ImportError:
            find_peaks = None

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

    def algorithm_degrid(
        self,
        kernel_width: int | None = None,
        kernel_height: int | None = None,
    ) -> dict[str, Any]:
        """Degrid algorithm: removes horizontal grid lines while preserving vertical pollen curves (Section 六 item 6)."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")

        if kernel_width is None:
            kernel_width = max(15, int(self.width * 0.02))

        if self.foreground_mask is None:
            self.extract_foreground()

        from .image import remove_horizontal_grid_lines

        cleaned_mask, hline_rows = remove_horizontal_grid_lines(
            self.foreground_mask,
            min_length=kernel_width,
            min_row_occupancy_ratio=0.30,
        )
        self.foreground_mask = cleaned_mask

        self._record_history("Degrid")
        return {
            "success": True,
            "kernel_width": kernel_width,
            "removed_lines_count": len(hline_rows),
        }

    def export_csv(
        self,
        depths: list[float] | None = None,
        output_path: str | None = None,
    ) -> str | dict[str, Any]:
        """Generates stratigraphic CSV: depth in 1st col, unobserved taxa = 0.0 (Section 八)."""
        res = self.export_data("csv", output_path=output_path)
        if output_path:
            return {"path": output_path, "success": True}
        return res.get("csv", "") if isinstance(res, dict) else str(res)

    def export_tar(self, output_path: str | None = None) -> dict[str, Any]:
        """Exports standard POSIX UStar tar project archive."""
        return self.project_save(output_path=output_path, format="tar")

    def export_r(self, output_path: str | None = None) -> str | dict[str, Any]:
        """Generates R plotting template script using rioja::strat.plot."""
        r_script = (
            "# ==============================================================================\n"
            "# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
            "# Generated automatically by Straditize v2.0 (straditize pro)\n"
            "# Requires R package 'rioja' (install.packages('rioja'))\n"
            "# ==============================================================================\n\n"
            "if (!requireNamespace('rioja', quietly = TRUE)) {\n"
            "  install.packages('rioja', repos = 'https://cloud.r-project.org')\n"
            "}\n"
            "library(rioja)\n\n"
            "data_file <- if (file.exists('data.csv')) 'data.csv' else list.files(pattern = '\\\\.csv$')[1]\n"
            "df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)\n"
            "depth <- df[[1]]\n"
            "taxa_data <- as.matrix(sapply(df[, -1, drop = FALSE], as.numeric))\n"
            "taxa_data[is.na(taxa_data)] <- 0\n\n"
            "pdf('stratigraphic_diagram.pdf', width = 12, height = 8)\n"
            "strat.plot(\n"
            "  d = taxa_data,\n"
            "  yvar = depth,\n"
            "  y.rev = TRUE,\n"
            "  ylabel = 'Depth (cm)',\n"
            "  scale.percent = TRUE,\n"
            "  plot.poly = TRUE,\n"
            "  plot.line = TRUE,\n"
            "  title = 'Stratigraphic Pollen Diagram (Straditize Pro)'\n"
            ")\n"
            "dev.off()\n"
            "message('Diagram successfully rendered: stratigraphic_diagram.pdf')\n"
        )
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(r_script)
            return {"path": output_path, "success": True}
        return r_script



    # ========================================================================
    # Age-Depth Chronology and Visual Inspection Methods
    # ========================================================================

    def load_age_depth_diagram(
        self,
        image_path: str | None = None,
        base64_data: str | None = None,
        sample_key: str | None = None,
    ) -> dict[str, Any]:
        """Loads an age-depth model diagram image into session for chronological harmonization."""
        if sample_key:
            sample_map = {
                "bacon": os.path.join(os.path.dirname(__file__), "..", "..", "tests", "test_figures", "age_models", "bacon_szek.png"),
                "bchron": os.path.join(os.path.dirname(__file__), "..", "..", "tests", "test_figures", "age_models", "bchron_stepped.png"),
            }
            image_path = sample_map.get(sample_key.lower())

        if base64_data:
            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]
            raw_bytes = base64.b64decode(base64_data)
            self.age_depth_image = Image.open(io.BytesIO(raw_bytes))
            self.age_depth_image_path = None
        elif image_path and os.path.exists(image_path):
            self.age_depth_image = Image.open(image_path)
            self.age_depth_image_path = os.path.abspath(image_path)
        else:
            raise JsonRpcError(FILE_NOT_FOUND_ERROR, f"Age-depth image not found: {image_path}")

        return {
            "status": "loaded",
            "width": self.age_depth_image.width,
            "height": self.age_depth_image.height,
            "has_model": self.age_depth_model is not None,
        }

    def calibrate_and_extract_age_depth(
        self,
        depth_px: list[float],
        depth_vals: list[float],
        age_px: list[float],
        age_vals: list[float],
        roi_box: tuple[float, float, float, float] | None = None,
        curve_type: str = "median",
        envelope_type: str = "95_hpd",
        depth_unit: str = "cm",
        age_unit: str = "cal BP",
        cal_curve: str = "IntCal20",
        notes: str = "",
    ) -> dict[str, Any]:
        """Extracts age-depth curves and 95% confidence envelope with visual inspection data."""
        if self.age_depth_image is None:
            # Fallback to sample if none loaded
            self.load_age_depth_diagram(sample_key="bacon")

        calibrator = AgeDepthAxisCalibrator(
            depth_px=depth_px,
            depth_vals=depth_vals,
            age_px=age_px,
            age_vals=age_vals,
            depth_unit=depth_unit,
            age_unit=age_unit,
        )

        model = extract_age_depth_model(
            self.age_depth_image,
            calibrator=calibrator,
            roi_box=roi_box,
            curve_type=curve_type,
            envelope_type=envelope_type,
            cal_curve=cal_curve,
            notes=notes,
        )
        self.age_depth_model = model

        # Harmonize with current pollen sample depths if available
        sample_depths = []
        if self.column_points and self.is_calibrated and self.y_scale:
            all_r = sorted({p["row"] for pts in self.column_points.values() for p in pts})
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            sample_depths = [round(sy * r + iy, 2) for r in all_r]

        mapped_samples = model.predict_age(sample_depths) if sample_depths else None

        return {
            "status": "extracted",
            "inspection": model.to_inspection_data(),
            "mapped_samples": mapped_samples,
        }

    def get_age_depth_inspection(self) -> dict[str, Any]:
        """Returns current age-depth model visual inspection data and metadata."""
        if self.age_depth_model is None:
            return {"has_model": False}
        return {
            "has_model": True,
            "inspection": self.age_depth_model.to_inspection_data(),
        }
