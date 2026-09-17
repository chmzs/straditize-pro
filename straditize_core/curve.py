"""Curve control point extraction (Ramer-Douglas-Peucker) and spline reconstruction.

Enables interactive or automated curve editing, point reduction, and smoothing.
Pure Python/NumPy/SciPy implementation without GUI or Matplotlib.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise

import numpy as np
import pandas as pd
from scipy.interpolate import CubicSpline, PchipInterpolator, interp1d
from scipy.signal import find_peaks


def detect_stratigraphic_turning_points(
    series_or_values: pd.Series | np.ndarray,
    prominence: float = 1.5,
    min_distance: int = 3,
    epsilon: float = 1.0,
    max_points: int | None = 32,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Extract turning points combining Topological Prominence and RDP.

    Guarantees that all significant physical peaks (local maxima) and valleys
    (local minima / baseline landings) are strictly preserved without omission,
    while RDP adds necessary intermediate anchors on long slopes.

    Parameters
    ----------
    series_or_values : pd.Series or np.ndarray
        1D curve profile values along stratigraphic depth/time.
    prominence : float
        Topological prominence threshold for peak/trough detection.
        Peaks with vertical prominence >= prominence are mandatory anchors.
    min_distance : int
        Minimum row distance between adjacent mandatory peaks.
    epsilon : float
        RDP tolerance for intermediate slope transitions.
    max_points : int or None
        Optional upper limit for total control points.

    Returns
    -------
    rows : np.ndarray
        Sorted row coordinates of all detected turning points.
    values : np.ndarray
        Curve profile values at those coordinates.
    is_mandatory : np.ndarray
        Boolean array indicating whether each point is a mandatory physical
        peak/valley/endpoint (True) or an intermediate slope transition (False).
    """
    if isinstance(series_or_values, pd.Series):
        valid = series_or_values.dropna()
        if valid.empty:
            return np.array([], dtype=float), np.array([], dtype=float), np.array([], dtype=bool)
        all_rows = valid.index.values.astype(float)
        all_vals = valid.values.astype(float)
    else:
        arr = np.asarray(series_or_values, dtype=float)
        valid_idx = np.where(np.isfinite(arr))[0]
        if not len(valid_idx):
            return np.array([], dtype=float), np.array([], dtype=float), np.array([], dtype=bool)
        all_rows = valid_idx.astype(float)
        all_vals = arr[valid_idx]

    # Split into continuous segments (gaps > 1 row)
    split_locs = np.where(np.diff(all_rows) > 1)[0] + 1
    row_groups = np.split(all_rows, split_locs)
    val_groups = np.split(all_vals, split_locs)

    out_rows: list[float] = []
    out_vals: list[float] = []
    out_mandatory: list[bool] = []

    for seg_rows, seg_vals in zip(row_groups, val_groups):
        n_pts = len(seg_rows)
        if n_pts <= 2:
            out_rows.extend(seg_rows.tolist())
            out_vals.extend(seg_vals.tolist())
            out_mandatory.extend([True] * n_pts)
            continue

        # 1. Topological Prominence Peaks (Local Maxima)
        peaks, _ = find_peaks(seg_vals, prominence=prominence, distance=min_distance)

        # 2. Topological Valleys & Baseline Landings (Local Minima)
        valleys, _ = find_peaks(-seg_vals, prominence=prominence, distance=min_distance)

        # Endpoints are mandatory
        mandatory_indices = set(peaks.tolist() + valleys.tolist() + [0, n_pts - 1])

        # 3. Intermediate RDP on long slopes between mandatory anchors
        sorted_anchors = sorted(mandatory_indices)
        all_keep_indices = set(sorted_anchors)

        for a_start, a_end in pairwise(sorted_anchors):
            span_len = a_end - a_start + 1
            if span_len > 6:
                sub_x = seg_rows[a_start : a_end + 1]
                sub_y = seg_vals[a_start : a_end + 1]
                rdp_sub = rdp_indices(sub_x, sub_y, epsilon=epsilon)
                for rel_idx in rdp_sub:
                    all_keep_indices.add(a_start + rel_idx)

        # Keep indices sorted
        sorted_indices = sorted(all_keep_indices)

        # If points exceed max_points, progressively increase epsilon for non-mandatory points
        if max_points is not None and len(sorted_indices) > max_points:
            non_mandatory = [idx for idx in sorted_indices if idx not in mandatory_indices]
            # Prune non-mandatory points with smallest RDP deviations
            excess = len(sorted_indices) - max_points
            if excess > 0 and len(non_mandatory) > 0:
                prune_set = set(non_mandatory[::2][:excess])
                sorted_indices = [i for i in sorted_indices if i not in prune_set]

        for i in sorted_indices:
            out_rows.append(float(seg_rows[i]))
            out_vals.append(float(seg_vals[i]))
            out_mandatory.append(i in mandatory_indices)

    # Global sort and unique by row
    unique_rows, u_idx = np.unique(out_rows, return_index=True)
    res_vals = np.asarray(out_vals, dtype=float)[u_idx]
    res_mand = np.asarray(out_mandatory, dtype=bool)[u_idx]

    return unique_rows, res_vals, res_mand


def rdp_indices(x: Sequence[float],
                y: Sequence[float],
                epsilon: float = 1.0) -> list[int]:
    """Calculate point indices to keep using the Ramer-Douglas-Peucker algorithm.

    Parameters
    ----------
    x : sequence of float
        X-coordinates (e.g. curve row index or pixel coordinates).
    y : sequence of float
        Y-coordinates (e.g. curve profile values).
    epsilon : float
        Perpendicular distance tolerance threshold.

    Returns
    -------
    list of int
        Sorted indices of the preserved control points.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(x)
    if n <= 2:
        return list(range(n))

    start = np.array([x[0], y[0]], dtype=float)
    end = np.array([x[-1], y[-1]], dtype=float)
    vec = end - start
    norm = np.hypot(vec[0], vec[1])

    if norm == 0:
        dists = np.hypot(x[1:-1] - start[0], y[1:-1] - start[1])
    else:
        pts = np.column_stack([x[1:-1], y[1:-1]])
        rel = pts - start
        dists = np.abs(vec[0] * rel[:, 1] - vec[1] * rel[:, 0]) / norm

    if not len(dists):
        return [0, n - 1]

    imax = int(np.argmax(dists))
    if dists[imax] <= epsilon:
        return [0, n - 1]

    split = imax + 1
    left = rdp_indices(x[:split + 1], y[:split + 1], epsilon)
    right = rdp_indices(x[split:], y[split:], epsilon)
    return left[:-1] + [i + split for i in right]


def extract_control_points(series_or_values: pd.Series | np.ndarray,
                           epsilon: float = 1.0,
                           max_points: int | None = 24) -> tuple[np.ndarray, np.ndarray]:
    """Extract key turning/control points from a 1D curve.

    Preserves segment endpoints and significant geometric turning points.

    Parameters
    ----------
    series_or_values : pd.Series or np.ndarray
        Curve profile. If pd.Series, uses its index as row coordinates.
    epsilon : float
        Initial RDP distance tolerance (default: 1.0).
    max_points : int or None
        Maximum number of control points per continuous segment.
        If exceeded, epsilon is iteratively increased.

    Returns
    -------
    rows : np.ndarray
        Row coordinates of extracted control points.
    values : np.ndarray
        Curve values at those control points.
    """
    if isinstance(series_or_values, pd.Series):
        valid = series_or_values.dropna()
        if valid.empty:
            return np.array([], dtype=float), np.array([], dtype=float)
        all_rows = valid.index.values.astype(float)
        all_vals = valid.values.astype(float)
    else:
        arr = np.asarray(series_or_values, dtype=float)
        valid_idx = np.where(np.isfinite(arr))[0]
        if not len(valid_idx):
            return np.array([], dtype=float), np.array([], dtype=float)
        all_rows = valid_idx.astype(float)
        all_vals = arr[valid_idx]

    # Split into continuous segments (gap in rows > 1)
    split_locs = np.where(np.diff(all_rows) > 1)[0] + 1
    row_groups = np.split(all_rows, split_locs)
    val_groups = np.split(all_vals, split_locs)

    out_rows = []
    out_vals = []

    for seg_rows, seg_vals in zip(row_groups, val_groups):
        if len(seg_rows) <= 2:
            out_rows.extend(seg_rows.tolist())
            out_vals.extend(seg_vals.tolist())
            continue

        tol = float(epsilon)
        keep = rdp_indices(seg_rows, seg_vals, tol)
        if max_points is not None and max_points > 2:
            while len(keep) > max_points:
                tol *= 1.5
                keep = rdp_indices(seg_rows, seg_vals, tol)

        # Ensure endpoints are strictly included
        if 0 not in keep:
            keep = [0] + keep
        if (len(seg_rows) - 1) not in keep:
            keep = keep + [len(seg_rows) - 1]
        keep = sorted(set(keep))

        out_rows.extend(seg_rows[keep].tolist())
        out_vals.extend(seg_vals[keep].tolist())

    # Sort and deduplicate
    unique_rows, idx = np.unique(out_rows, return_index=True)
    return unique_rows, np.asarray(out_vals, dtype=float)[idx]


def reconstruct_curve(rows: Sequence[float],
                      values: Sequence[float],
                      target_rows: Sequence[float],
                      method: str = 'linear') -> np.ndarray:
    """Reconstruct a full curve from sparse control points across target rows.

    Parameters
    ----------
    rows : sequence of float
        Row coordinates of control points.
    values : sequence of float
        Values at control points.
    target_rows : sequence of float
        Target row coordinates to interpolate across.
    method : str
        Interpolation method: 'linear' (default), 'pchip' (monotonic cubic),
        'spline' / 'cubic' (cubic spline), or 'nearest'.

    Returns
    -------
    np.ndarray
        Reconstructed 1D curve array evaluated at `target_rows`.
    """
    rows = np.asarray(rows, dtype=float)
    values = np.asarray(values, dtype=float)
    target = np.asarray(target_rows, dtype=float)

    if len(target) == 0:
        return np.array([], dtype=float)
    if len(rows) == 0:
        return np.full_like(target, np.nan, dtype=float)
    if len(rows) == 1:
        return np.full_like(target, values[0], dtype=float)

    order = np.argsort(rows)
    rows = rows[order]
    values = values[order]

    unique_rows, idx = np.unique(rows, return_index=True)
    rows = unique_rows
    values = values[idx]

    if len(rows) == 1:
        return np.full_like(target, values[0], dtype=float)

    method = method.lower()
    if method == 'linear':
        return np.interp(target, rows, values)
    elif method in ('pchip', 'monotonic'):
        # Monotone cubic interpolation prevents overshoot
        if len(rows) >= 2:
            interp = PchipInterpolator(rows, values, extrapolate=True)
            return interp(target)
        return np.interp(target, rows, values)
    elif method in ('spline', 'cubic'):
        if len(rows) >= 4:
            cs = CubicSpline(rows, values, bc_type='natural', extrapolate=True)
            return cs(target)
        elif len(rows) >= 2:
            interp = PchipInterpolator(rows, values, extrapolate=True)
            return interp(target)
        return np.interp(target, rows, values)
    elif method == 'nearest':
        f = interp1d(rows, values, kind='nearest', fill_value='extrapolate')
        return f(target)
    else:
        raise ValueError(f"Unknown interpolation method: '{method}'. Choose from 'linear', 'pchip', 'spline', 'nearest'.")


@dataclass
class ControlPointSet:
    """Manages control points for a single curve column."""
    rows: list[float] = field(default_factory=list)
    values: list[float] = field(default_factory=list)

    @classmethod
    def from_curve(cls,
                   series_or_values: pd.Series | np.ndarray,
                   epsilon: float = 1.0,
                   max_points: int = 24) -> ControlPointSet:
        r, v = extract_control_points(
            series_or_values, epsilon=epsilon, max_points=max_points)
        return cls(rows=list(r), values=list(v))

    def add_or_update(self, row: float, value: float) -> None:
        """Add a new control point or update an existing one at row."""
        row = float(row)
        value = float(value)
        for i, r in enumerate(self.rows):
            if abs(r - row) < 1e-4:
                self.values[i] = value
                return
        self.rows.append(row)
        self.values.append(value)
        # Keep sorted
        order = np.argsort(self.rows)
        self.rows = [self.rows[i] for i in order]
        self.values = [self.values[i] for i in order]

    def remove_at(self, row: float, tol: float = 1.0) -> bool:
        """Remove the control point closest to row if within tol."""
        if not self.rows:
            return False
        diffs = [abs(r - row) for r in self.rows]
        imin = int(np.argmin(diffs))
        if diffs[imin] <= tol:
            self.rows.pop(imin)
            self.values.pop(imin)
            return True
        return False

    def reconstruct(self, target_rows: Sequence[float], method: str = 'linear') -> np.ndarray:
        """Reconstruct values along target_rows."""
        return reconstruct_curve(self.rows, self.values, target_rows, method=method)
