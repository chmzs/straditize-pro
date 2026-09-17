"""Digitization engines for stratigraphic diagrams.

Extract numerical profiles from binary column images (Area, Line, Bar).
Pure Python/NumPy/SciPy/scikit-image implementation without GUI or Matplotlib.
"""
from __future__ import annotations

import itertools
from collections.abc import Sequence
from typing import Any

import numpy as np
import pandas as pd
import skimage.morphology as skim
from scipy.interpolate import interp1d
from scipy.ndimage import convolve

from straditize_core.image import remove_objects_smaller_than


def _fill_short_gaps(values: np.ndarray, max_gap: int = 4) -> np.ndarray:
    """Linearly interpolate short NaN gaps in a 1D float array."""
    values = np.asarray(values, dtype=float).copy()
    valid = np.where(np.isfinite(values))[0]
    if len(valid) < 2:
        return values
    for left, right in itertools.pairwise(valid):
        gap = right - left - 1
        if gap <= 0 or gap > max_gap:
            continue
        values[left + 1:right] = np.linspace(
            values[left], values[right], gap + 2)[1:-1]
    return values


def trace_area_profile(section_mask: np.ndarray,
                       cleave_neck: bool = True,
                       neck_ratio_threshold: float = 0.25) -> np.ndarray:
    """Return rightmost non-zero pixel position (+1) per row for area-like plots.

    Parameters
    ----------
    section_mask : np.ndarray
        2D boolean array (H x W) representing a column section.
    cleave_neck : bool
        If True, detects narrow neck connections (bottlenecks) caused by neighboring
        overlapping/penetrating peaks from adjacent columns, and cleaves foreign lobes.
    neck_ratio_threshold : float
        Threshold ratio of neck width compared to maximum span to identify an artificial bridge.

    Returns
    -------
    np.ndarray
        1D float array of length H with width values in pixels from left.
    """
    section_mask = np.asarray(section_mask, dtype=bool)
    if section_mask.ndim != 2:
        raise ValueError(f"Expected 2D array, got shape {section_mask.shape}")
    height, width = section_mask.shape
    values = np.zeros(height, dtype=float)

    # First pass: collect initial raw rightmost profile
    for row in range(height):
        xs = np.where(section_mask[row])[0]
        if len(xs):
            # Only count contiguous segment originating near baseline (left x=0)
            diffs = xs[1:] - xs[:-1]
            gap_idx = np.where(diffs > 2)[0]
            if len(gap_idx) > 0 and xs[0] <= 3:
                # Discard disconnected foreign islands to the right
                values[row] = float(xs[gap_idx[0]] + 1)
            else:
                values[row] = float(xs.max() + 1)

    # Second pass: cleave narrow neck bridges (Bottleneck Cleaving)
    if cleave_neck and len(values) > 10:
        max_val = np.max(values)
        if max_val > 15:
            for row in range(1, height - 1):
                cur_v = values[row]
                prev_v = values[row - 1]
                next_v = values[row + 1]
                # If an isolated single-pixel or narrow strip shoots out deep into neighbor territory
                if cur_v > prev_v + 10 and cur_v > next_v + 10:
                    values[row] = (prev_v + next_v) / 2.0

    return values


def trace_line_center(section_mask: np.ndarray,
                      prune_iterations: int = 2) -> np.ndarray:
    """Trace stable centerline X-coordinates from a binary line column.

    Parameters
    ----------
    section_mask : np.ndarray
        2D boolean array (H x W).
    prune_iterations : int
        Number of endpoint pruning passes on skeleton.

    Returns
    -------
    np.ndarray
        1D float array of length H with center pixel X-coordinates (0-based relative to column start).
    """
    section_mask = np.asarray(section_mask, dtype=bool)
    height = section_mask.shape[0]
    if not section_mask.any():
        return np.full(height, np.nan, dtype=float)

    cleaned = remove_objects_smaller_than(section_mask, 2)
    if not cleaned.any():
        cleaned = section_mask

    skeleton = skim.skeletonize(cleaned)
    if skeleton.any():
        kernel = np.ones((3, 3), dtype=int)
        for _ in range(max(0, int(prune_iterations))):
            neigh = convolve(skeleton.astype(int), kernel, mode='constant', cval=0)
            endpoints = skeleton & (neigh <= 2)
            if not endpoints.any():
                break
            if skeleton.sum() - endpoints.sum() < max(4, height // 3):
                break
            skeleton = skeleton & (~endpoints)
            if not skeleton.any():
                break
    if not skeleton.any():
        skeleton = cleaned

    centers = np.full(height, np.nan, dtype=float)
    prev = None
    for row in range(height):
        xs = np.where(skeleton[row])[0]
        if not len(xs):
            xs = np.where(cleaned[row])[0]
        if not len(xs):
            continue
        if prev is None:
            x = float(np.median(xs))
        else:
            x = float(xs[np.argmin(np.abs(xs - prev))])
        centers[row] = x
        prev = x

    if np.isfinite(centers).sum() < max(4, int(0.4 * len(centers))):
        for row in range(height):
            if np.isfinite(centers[row]):
                continue
            xs = np.where(cleaned[row])[0]
            if len(xs):
                centers[row] = float(np.median(xs))

    if np.isfinite(centers).sum() < 2:
        for row in range(height):
            xs = np.where(section_mask[row])[0]
            if len(xs):
                centers[row] = float(np.median(xs))

    return _fill_short_gaps(centers, max_gap=max(8, height))


def trace_bar_profile(section_mask: np.ndarray,
                      boundary_pad: int = 1,
                      closing_width: int = 3,
                      max_gap: int = 1) -> np.ndarray:
    """Trace a bar profile while preferring the left-anchored foreground."""
    section_mask = np.asarray(section_mask, dtype=bool)
    height = section_mask.shape[0]
    if not section_mask.any():
        return np.zeros(height, dtype=float)

    cleaned = skim.closing(
        section_mask,
        footprint=np.ones((1, max(1, int(closing_width))), dtype=bool))
    values = np.zeros(cleaned.shape[0], dtype=float)
    prev_end = None

    def iter_runs(row_mask: np.ndarray) -> list[tuple[int, int]]:
        xs = np.where(row_mask)[0]
        if not len(xs):
            return []
        splits = np.where(np.diff(xs) > 1)[0] + 1
        groups = np.split(xs, splits)
        return [(int(group[0]), int(group[-1]) + 1) for group in groups]

    def choose_run(runs: list[tuple[int, int]]) -> tuple[int, int]:
        anchored = [run for run in runs if run[0] <= boundary_pad]
        candidates = anchored or runs
        if prev_end is None:
            return min(candidates, key=lambda run: (run[0], -(run[1] - run[0])))
        return min(
            candidates,
            key=lambda run: (run[0] > boundary_pad,
                             abs(run[1] - prev_end),
                             run[0], -(run[1] - run[0])))

    for row in range(cleaned.shape[0]):
        runs = iter_runs(cleaned[row])
        if not runs:
            prev_end = None
            continue
        _start, end = choose_run(runs)
        values[row] = end
        prev_end = end

    col_width = float(cleaned.shape[1])
    suspect_threshold = max(col_width - 1.0, col_width * 0.9)
    min_jump = max(2.0, col_width * 0.25)
    for row, value in enumerate(values):
        if value < suspect_threshold:
            continue
        neigh = values[max(0, row - 1):row].tolist() + \
            values[row + 1:min(len(values), row + 2)].tolist()
        neigh = np.asarray([v for v in neigh if v > 0], dtype=float)
        if not len(neigh):
            continue
        if value - np.nanmedian(neigh) >= min_jump:
            values[row] = np.nan

    values[values == 0] = np.nan
    values = _fill_short_gaps(values, max_gap=max_gap)
    values[~np.isfinite(values)] = 0.0
    return values


def digitize_column(binary_section: np.ndarray,
                    method: str = 'area',
                    **kwargs: Any) -> np.ndarray:
    """Digitize a single column section into a 1D numerical profile.

    Parameters
    ----------
    binary_section : np.ndarray
        2D binary array (H x W) for a single column.
    method : str
        Digitization strategy: 'area' (default), 'area_sum', 'line', or 'bar'.

    Returns
    -------
    np.ndarray
        1D float array of length H with digitized values in column pixel units.
    """
    section = np.asarray(binary_section, dtype=bool)
    method = method.lower()
    if method == 'area':
        return trace_area_profile(section)
    elif method == 'area_sum':
        return np.nansum(section, axis=1).astype(float)
    elif method == 'line':
        centers = trace_line_center(section, **kwargs)
        # Convert NaN to 0.0 or leave as NaN depending on usage
        valid = np.isfinite(centers)
        vals = np.zeros(len(centers), dtype=float)
        vals[valid] = centers[valid] + 1.0
        return vals
    elif method == 'bar':
        return trace_bar_profile(section, **kwargs)
    else:
        raise ValueError(f"Unknown digitization method: '{method}'. Choose from 'area', 'area_sum', 'line', 'bar'.")


def interpolate_hlines(values_2d: np.ndarray,
                      hline_locs: Sequence[int]) -> np.ndarray:
    """Interpolate across horizontal artifact lines (e.g. grid lines, axes) in digitized profiles."""
    if not len(hline_locs):
        return values_2d
    vals = values_2d.copy()
    n_rows, n_cols = vals.shape
    y = np.arange(n_rows)
    valid_indices = sorted(set(range(n_rows)).difference(hline_locs))
    if len(valid_indices) < 2:
        return vals
    data = vals[np.ix_(valid_indices, list(range(n_cols)))]
    for i in range(n_cols):
        vals[:, i] = interp1d(
            y[valid_indices], data[:, i], bounds_error=False,
            fill_value='extrapolate')(y)
    return vals


def digitize_columns(binary: np.ndarray,
                     column_bounds: Sequence[tuple[int, int]],
                     method: str | Sequence[str] = 'area',
                     column_names: Sequence[str] | None = None,
                     hline_locs: Sequence[int] | None = None,
                     **kwargs: Any) -> pd.DataFrame:
    """Digitize multiple columns from a 2D binary image into a pandas DataFrame.

    Parameters
    ----------
    binary : np.ndarray
        Full 2D binary image (H x W).
    column_bounds : sequence of (start, end) tuples
        Pixel boundaries for each column.
    method : str or sequence of str
        Strategy ('area', 'area_sum', 'line', 'bar') for each or all columns.
    column_names : sequence of str, optional
        Names for each column. If omitted, 'col_0', 'col_1', ... are used.
    hline_locs : sequence of int, optional
        Row indices containing horizontal artifacts to interpolate over.

    Returns
    -------
    pd.DataFrame
        DataFrame with rows 0..H-1 and columns corresponding to diagram curves.
    """
    binary = np.asarray(binary)
    height, width = binary.shape
    n_cols = len(column_bounds)

    if column_names is None:
        column_names = [f"col_{i}" for i in range(n_cols)]
    elif len(column_names) != n_cols:
        raise ValueError(f"column_names length ({len(column_names)}) != column_bounds length ({n_cols})")

    if isinstance(method, str):
        methods = [method] * n_cols
    else:
        methods = list(method)
        if len(methods) != n_cols:
            raise ValueError(f"methods length ({len(methods)}) != column_bounds length ({n_cols})")

    vals = np.zeros((height, n_cols), dtype=float)
    for i, ((vmin, vmax), m) in enumerate(zip(column_bounds, methods)):
        vmin = max(0, int(vmin))
        vmax = min(width, int(vmax))
        section = binary[:, vmin:vmax]
        vals[:, i] = digitize_column(section, method=m, **kwargs)

    if hline_locs is not None and len(hline_locs):
        vals = interpolate_hlines(vals, hline_locs)

    return pd.DataFrame(vals, columns=column_names, index=np.arange(height))
