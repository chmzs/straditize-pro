"""End-to-end headless digitization pipeline for stratigraphic diagrams.

Pure Python/NumPy/SciPy/pandas/Pillow/scikit-image pipeline without GUI or Matplotlib.
"""
from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image

from straditize_core.calibration import (
    LinearCalibration,
    StratigraphicCalibration,
)
from straditize_core.columns import detect_column_bounds
from straditize_core.curve import (
    ControlPointSet,
)
from straditize_core.digitize import digitize_columns
from straditize_core.image import load_image, to_binary


class StraditizePipeline:
    """Headless stratigraphic diagram digitization pipeline.

    Provides a clean, chained, pure Python workflow for loading diagrams,
    segmenting curves, detecting column partitions, digitizing profiles,
    editing control points, and calibrating to scientific units.
    """

    def __init__(self, source: str | Path | Image.Image | np.ndarray | None = None):
        self.raw_image: Image.Image | None = None
        self.binary: np.ndarray | None = None
        self.column_bounds: list[tuple[int, int]] = []
        self.column_names: list[str] = []
        self.df_pixels: pd.DataFrame | None = None
        self.calibration: StratigraphicCalibration | None = None
        self._control_points: dict[str, ControlPointSet] = {}

        if source is not None:
            self.load(source)

    def load(self, source: str | Path | Image.Image | np.ndarray) -> StraditizePipeline:
        """Load an input diagram image."""
        self.raw_image = load_image(source)
        return self

    def preprocess(self,
                   threshold: float = 230 * 3,
                   extraction_mode: str = 'standard',
                   segmentation_mode: str = 'auto',
                   target_colors: Any = None) -> StraditizePipeline:
        """Extract foreground and convert the loaded image to binary array."""
        if self.raw_image is None:
            raise ValueError("No image loaded. Call load() first.")
        self.binary = to_binary(
            self.raw_image,
            threshold=threshold,
            extraction_mode=extraction_mode,
            segmentation_mode=segmentation_mode,
            target_colors=target_colors)
        return self

    def detect_columns(self,
                       threshold: float = 0.1,
                       min_col_width_ratio: float = 0.01,
                       compact: bool = False,
                       column_names: Sequence[str] | None = None) -> StraditizePipeline:
        """Detect column bounds across the binary image."""
        if self.binary is None:
            raise ValueError("Binary image not available. Call preprocess() first.")
        self.column_bounds = detect_column_bounds(
            self.binary,
            threshold=threshold,
            min_col_width_ratio=min_col_width_ratio,
            compact=compact)

        n_cols = len(self.column_bounds)
        if column_names is not None:
            if len(column_names) != n_cols:
                raise ValueError(f"Length of column_names ({len(column_names)}) != detected columns ({n_cols})")
            self.column_names = list(column_names)
        else:
            self.column_names = [f"col_{i}" for i in range(n_cols)]
        return self

    def set_column_bounds(self,
                          bounds: Sequence[tuple[int, int]],
                          column_names: Sequence[str] | None = None) -> StraditizePipeline:
        """Explicitly override column bounds."""
        self.column_bounds = [(int(s), int(e)) for s, e in bounds]
        n_cols = len(self.column_bounds)
        if column_names is not None:
            if len(column_names) != n_cols:
                raise ValueError(f"Length of column_names ({len(column_names)}) != bounds ({n_cols})")
            self.column_names = list(column_names)
        else:
            self.column_names = [f"col_{i}" for i in range(n_cols)]
        return self

    def digitize(self,
                 method: str | Sequence[str] = 'area',
                 hline_locs: Sequence[int] | None = None,
                 **kwargs: Any) -> StraditizePipeline:
        """Digitize all columns into a pixel-scale DataFrame."""
        if self.binary is None:
            raise ValueError("Binary image not available. Call preprocess() first.")
        if not self.column_bounds:
            raise ValueError("No column bounds defined. Call detect_columns() first.")

        self.df_pixels = digitize_columns(
            self.binary,
            column_bounds=self.column_bounds,
            method=method,
            column_names=self.column_names,
            hline_locs=hline_locs,
            **kwargs)
        # Reset control points cache on re-digitization
        self._control_points.clear()
        return self

    def calibrate(self,
                  y_px: Sequence[float],
                  y_data: Sequence[float],
                  x_scale: float | dict[str, float] | None = None,
                  x_calibration: LinearCalibration | dict[str, LinearCalibration] | None = None,
                  y_name: str = "Depth") -> StraditizePipeline:
        """Set up scientific coordinate calibration."""
        y_cal = LinearCalibration(y_px, y_data, name=y_name)
        self.calibration = StratigraphicCalibration(
            y_calibration=y_cal,
            x_scale=x_scale,
            x_calibration=x_calibration,
            y_name=y_name)
        return self

    def set_calibration(self, calibration: StratigraphicCalibration) -> StraditizePipeline:
        """Directly set a StratigraphicCalibration object."""
        self.calibration = calibration
        return self

    def get_dataframe(self, calibrated: bool = True) -> pd.DataFrame:
        """Return the digitized data as a pandas DataFrame."""
        if self.df_pixels is None:
            raise ValueError("Digitization has not been performed yet. Call digitize() first.")
        if calibrated:
            if self.calibration is None:
                raise ValueError("Calibration not set. Call calibrate() or pass calibrated=False.")
            return self.calibration.transform_dataframe(self.df_pixels)
        return self.df_pixels.copy()

    def get_control_points(self,
                           col: str,
                           epsilon: float = 1.0,
                           max_points: int = 24) -> tuple[np.ndarray, np.ndarray]:
        """Extract or retrieve sparse control points for a specific column."""
        if self.df_pixels is None:
            raise ValueError("No digitized data available. Call digitize() first.")
        if col not in self.df_pixels.columns:
            raise KeyError(f"Column '{col}' not found in digitized columns: {list(self.df_pixels.columns)}")

        if col not in self._control_points:
            series = self.df_pixels[col]
            self._control_points[col] = ControlPointSet.from_curve(
                series, epsilon=epsilon, max_points=max_points)
        cpset = self._control_points[col]
        return np.asarray(cpset.rows, dtype=float), np.asarray(cpset.values, dtype=float)

    def update_control_point(self,
                             col: str,
                             row: float,
                             value: float,
                             rebuild: bool = True,
                             rebuild_method: str = 'linear') -> StraditizePipeline:
        """Add or update a control point for a column, optionally rebuilding the column curve."""
        if self.df_pixels is None:
            raise ValueError("No digitized data available.")
        # Ensure points exist
        self.get_control_points(col)
        cpset = self._control_points[col]
        cpset.add_or_update(row, value)
        if rebuild:
            new_curve = cpset.reconstruct(self.df_pixels.index.values, method=rebuild_method)
            self.df_pixels[col] = new_curve
        return self

    def remove_control_point(self,
                             col: str,
                             row: float,
                             tol: float = 1.0,
                             rebuild: bool = True,
                             rebuild_method: str = 'linear') -> bool:
        """Remove a control point closest to row, optionally rebuilding the column curve."""
        if self.df_pixels is None:
            raise ValueError("No digitized data available.")
        self.get_control_points(col)
        cpset = self._control_points[col]
        removed = cpset.remove_at(row, tol=tol)
        if removed and rebuild:
            new_curve = cpset.reconstruct(self.df_pixels.index.values, method=rebuild_method)
            self.df_pixels[col] = new_curve
        return removed
