"""Scientific coordinate calibration and bi-directional transformations.

Supports linear and piecewise calibration between image pixel coordinates
and real-world scientific units (depth, age, abundance %, concentration).
Pure Python/NumPy/SciPy/pandas implementation without GUI or Matplotlib.
"""
from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d

__all__ = [
    "LinearCalibration",
    "LogCalibration",
    "PiecewiseCalibration",
    "StratigraphicCalibration",
]


class LinearCalibration:
    """Bi-directional linear mapping between pixel and scientific coordinates.

    Supports either 2-point specification or multiple points fitted with linear regression.
    """

    def __init__(self,
                 px_points: Sequence[float],
                 data_points: Sequence[float],
                 name: str = "axis"):
        px = np.asarray(px_points, dtype=float)
        data = np.asarray(data_points, dtype=float)

        if len(px) != len(data):
            raise ValueError(f"Length of px_points ({len(px)}) != data_points ({len(data)})")
        if len(px) < 2:
            raise ValueError("At least 2 points are required for linear calibration.")

        self.name = name
        self.px_points = px
        self.data_points = data

        if len(px) == 2:
            d_px = px[1] - px[0]
            d_data = data[1] - data[0]
            if abs(d_px) < 1e-9:
                raise ValueError("Pixel points cannot be identical.")
            self.slope = d_data / d_px
            self.intercept = data[0] - self.slope * px[0]
        else:
            # Linear least-squares fit for multiple calibration points
            A = np.vstack([px, np.ones(len(px))]).T
            self.slope, self.intercept = np.linalg.lstsq(A, data, rcond=None)[0]

    def px2data(self, px: np.ndarray | float) -> np.ndarray | float:
        """Convert pixel coordinates to scientific data values."""
        return self.intercept + self.slope * np.asarray(px, dtype=float)

    def data2px(self, data: np.ndarray | float) -> np.ndarray | float:
        """Convert scientific data values back to pixel coordinates."""
        if abs(self.slope) < 1e-12:
            raise ZeroDivisionError("Calibration slope is zero; cannot invert.")
        return (np.asarray(data, dtype=float) - self.intercept) / self.slope

    def __call__(self, px: np.ndarray | float) -> np.ndarray | float:
        return self.px2data(px)

    def __repr__(self) -> str:
        return f"LinearCalibration({self.name!r}, slope={self.slope:.6g}, intercept={self.intercept:.6g})"


class LogCalibration:
    """Bi-directional logarithmic mapping between pixel and scientific coordinates.

    Supports converting between image pixel coordinates and logarithmic scientific
    units (e.g. concentration, exponential pollen counts, or proxy metrics).

    Mathematical formulation:
      Forward (pixel -> scientific data):
        data(px) = exp( ln(s) + ((px - x0) / (x1 - x0)) * (ln(t) - ln(s)) )
      Backward (scientific data -> pixel):
        px(data) = x0 + ((ln(data) - ln(s)) / (ln(t) - ln(s))) * (x1 - x0)

    Hard constraints:
      - At least 2 points: px_points and data_points
      - abs(x1 - x0) > 1e-9 (pixel span non-zero)
      - s > 0 and t > 0 (scientific values must be strictly positive)
      - abs(s - t) > 1e-12 (start value and tick value cannot be equal)
    """

    def __init__(self,
                 px_points: Sequence[float],
                 data_points: Sequence[float],
                 name: str = "log_axis"):
        px = np.asarray(px_points, dtype=float)
        data = np.asarray(data_points, dtype=float)

        if len(px) != len(data):
            raise ValueError(f"Length of px_points ({len(px)}) != data_points ({len(data)})")
        if len(px) < 2:
            raise ValueError("At least 2 points are required for log calibration.")

        x0, x1 = float(px[0]), float(px[1])
        s_val, t_val = float(data[0]), float(data[1])

        if abs(x1 - x0) < 1e-9:
            raise ValueError("Pixel points cannot be identical (zero span).")
        if s_val <= 0 or t_val <= 0:
            raise ValueError(
                f"Logarithmic calibration requires strictly positive values (got {s_val}, {t_val})."
            )
        if abs(s_val - t_val) < 1e-12:
            raise ValueError(
                "Start value and tick value cannot be equal for logarithmic calibration."
            )

        self.name = name
        self.px_points = px
        self.data_points = data
        self.x0 = x0
        self.x1 = x1
        self.start_val = s_val
        self.tick_val = t_val

        self._ln_start = np.log(s_val)
        self._ln_tick = np.log(t_val)
        self._ln_diff = self._ln_tick - self._ln_start
        self._px_diff = self.x1 - self.x0

    def px2data(self, px: np.ndarray | float) -> np.ndarray | float:
        """Convert pixel coordinates to scientific log data values."""
        px_arr = np.asarray(px, dtype=float)
        frac = (px_arr - self.x0) / self._px_diff
        ln_val = self._ln_start + frac * self._ln_diff
        res = np.exp(ln_val)
        if np.ndim(px) == 0:
            return float(res)
        return res

    def data2px(self, data: np.ndarray | float) -> np.ndarray | float:
        """Convert scientific data values back to pixel coordinates."""
        d_arr = np.asarray(data, dtype=float)
        if np.any(d_arr <= 0):
            raise ValueError("Cannot map non-positive values to logarithmic pixel coordinates.")
        ln_val = np.log(d_arr)
        frac = (ln_val - self._ln_start) / self._ln_diff
        res = self.x0 + frac * self._px_diff
        if np.ndim(data) == 0:
            return float(res)
        return res

    def __call__(self, px: np.ndarray | float) -> np.ndarray | float:
        return self.px2data(px)

    def __repr__(self) -> str:
        return (f"LogCalibration({self.name!r}, x0={self.x0:.6g}, x1={self.x1:.6g}, "
                f"start_val={self.start_val:.6g}, tick_val={self.tick_val:.6g})")


class PiecewiseCalibration:
    """Bi-directional piecewise linear mapping for non-linear depth-age models."""

    def __init__(self,
                 px_points: Sequence[float],
                 data_points: Sequence[float],
                 name: str = "piecewise"):
        px = np.asarray(px_points, dtype=float)
        data = np.asarray(data_points, dtype=float)

        if len(px) != len(data) or len(px) < 2:
            raise ValueError("At least 2 coordinate pairs are required.")

        order = np.argsort(px)
        self.px = px[order]
        self.data = data[order]
        self.name = name

        self._forward = interp1d(
            self.px, self.data, kind='linear', fill_value='extrapolate')

        # For inverse mapping, data must be strictly monotonic
        diff = np.diff(self.data)
        if np.all(diff > 0):
            self._backward = interp1d(
                self.data, self.px, kind='linear', fill_value='extrapolate')
        elif np.all(diff < 0):
            self._backward = interp1d(
                self.data[::-1], self.px[::-1], kind='linear', fill_value='extrapolate')
        else:
            self._backward = None

    def px2data(self, px: np.ndarray | float) -> np.ndarray | float:
        return self._forward(np.asarray(px, dtype=float))

    def data2px(self, data: np.ndarray | float) -> np.ndarray | float:
        if self._backward is None:
            raise ValueError("Data points are not strictly monotonic; inverse mapping is ambiguous.")
        return self._backward(np.asarray(data, dtype=float))


class StratigraphicCalibration:
    """Complete scientific coordinate system for stratigraphic diagrams.

    Combines vertical calibration (depth, elevation, or age along Y-axis) with
    horizontal calibration (abundance percentage, count, or concentration along X-axis).
    """

    def __init__(self,
                 y_calibration: LinearCalibration | PiecewiseCalibration,
                 x_scale: float | dict[str, float] | None = None,
                 x_calibration: LinearCalibration | LogCalibration | PiecewiseCalibration | dict[str, LinearCalibration | LogCalibration | PiecewiseCalibration] | None = None,
                 y_name: str = "Depth"):
        """
        Parameters
        ----------
        y_calibration : LinearCalibration or PiecewiseCalibration
            Vertical axis calibration converting row pixels to depth/age.
        x_scale : float or dict, optional
            Data units per pixel width (e.g. 0.2 means 100 pixels = 20%).
            Can be given as a single global float or a dict mapping column names to scales.
        x_calibration : LinearCalibration, LogCalibration, PiecewiseCalibration or dict of them, optional
            Explicit X-axis calibration mapping relative pixel width to data values.
        y_name : str
            Label for the vertical coordinate (e.g. 'Depth (cm)', 'Age (cal BP)').
        """
        self.y_calibration = y_calibration
        self.x_scale = x_scale
        self.x_calibration = x_calibration
        self.y_name = y_name

    def px2data_y(self, y_px: np.ndarray | float) -> np.ndarray | float:
        """Convert Y pixel rows to scientific depth/age values."""
        return self.y_calibration.px2data(y_px)

    def data2px_y(self, y_val: np.ndarray | float) -> np.ndarray | float:
        """Convert scientific depth/age values to Y pixel rows."""
        return self.y_calibration.data2px(y_val)

    def px2data_x(self, x_px: np.ndarray | float, col_name: str | None = None) -> np.ndarray | float:
        """Convert column pixel values (width from origin) to scientific data values."""
        if self.x_calibration is not None:
            if isinstance(self.x_calibration, dict):
                cal = self.x_calibration.get(col_name) if col_name else None
                if cal is not None:
                    return cal.px2data(x_px)
            elif isinstance(self.x_calibration, (LinearCalibration, LogCalibration, PiecewiseCalibration)):
                return self.x_calibration.px2data(x_px)

        if self.x_scale is not None:
            if isinstance(self.x_scale, dict):
                scale = self.x_scale.get(col_name, 1.0) if col_name else 1.0
            else:
                scale = float(self.x_scale)
            return np.asarray(x_px, dtype=float) * scale

        # Default fallback: 1 pixel = 1 unit
        return np.asarray(x_px, dtype=float)

    def data2px_x(self, x_val: np.ndarray | float, col_name: str | None = None) -> np.ndarray | float:
        """Convert scientific data values back to column pixel widths."""
        if self.x_calibration is not None:
            if isinstance(self.x_calibration, dict):
                cal = self.x_calibration.get(col_name) if col_name else None
                if cal is not None:
                    return cal.data2px(x_val)
            elif isinstance(self.x_calibration, (LinearCalibration, LogCalibration, PiecewiseCalibration)):
                return self.x_calibration.data2px(x_val)

        if self.x_scale is not None:
            if isinstance(self.x_scale, dict):
                scale = self.x_scale.get(col_name, 1.0) if col_name else 1.0
            else:
                scale = float(self.x_scale)
            if scale == 0:
                raise ZeroDivisionError("X scale factor cannot be zero.")
            return np.asarray(x_val, dtype=float) / scale

        return np.asarray(x_val, dtype=float)

    def transform_dataframe(self, df_pixels: pd.DataFrame) -> pd.DataFrame:
        """Transform a digitized DataFrame (in pixel coordinates) to scientific units.

        The index (pixel rows) is mapped using the vertical Y calibration, and
        the columns values are scaled using the X calibration.
        """
        df_out = df_pixels.copy()
        for col in df_out.columns:
            df_out[col] = self.px2data_x(df_out[col].values, col_name=str(col))

        # Transform index
        y_data = self.px2data_y(df_out.index.values.astype(float))
        df_out.index = pd.Index(y_data, name=self.y_name)
        return df_out

    def inverse_transform_dataframe(self, df_scientific: pd.DataFrame) -> pd.DataFrame:
        """Transform scientific DataFrame back to pixel coordinates."""
        df_out = df_scientific.copy()
        for col in df_out.columns:
            df_out[col] = self.data2px_x(df_out[col].values, col_name=str(col))

        y_px = self.data2px_y(df_out.index.values.astype(float))
        df_out.index = pd.Index(y_px, name="pixel_row")
        return df_out
