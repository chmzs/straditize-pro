"""Column boundary detection and segmentation for stratigraphic diagrams.

Pure Python/NumPy implementation without GUI or Matplotlib.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ColumnBound:
    """Represents the horizontal span of a diagram column in pixel coordinates."""
    start: int
    end: int
    index: int = 0

    @property
    def width(self) -> int:
        return max(0, self.end - self.start)

    def to_tuple(self) -> tuple[int, int]:
        return (self.start, self.end)


def groupby_arr(arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Group consecutive identical values in a 1D boolean/numeric array.

    Parameters
    ----------
    arr : np.ndarray
        1D array.

    Returns
    -------
    keys : np.ndarray
        Unique consecutive keys.
    bounds : np.ndarray
        Boundary indices partitioning the array into runs.
    """
    arr = np.asarray(arr)
    if len(arr) == 0:
        return np.array([]), np.array([0])
    diff = np.ones_like(arr, dtype=bool)
    diff[1:] = arr[1:] != arr[:-1]
    idx = np.where(diff)[0]
    keys = arr[idx]
    bounds = np.r_[idx, [len(arr)]]
    return keys, bounds


def detect_column_starts(binary: np.ndarray,
                         threshold: float = 0.1,
                         min_col_width_ratio: float = 0.01) -> np.ndarray:
    """Detect horizontal starting pixel coordinates for each column.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (shape: H x W), foreground is non-zero.
    threshold : float
        Fraction of column height that must be covered by foreground pixels
        to be considered a valid column start candidate (default: 0.1).
    min_col_width_ratio : float
        Minimum distance between column starts as a fraction of image width.

    Returns
    -------
    np.ndarray
        Sorted 1D integer array of detected column start coordinates.
    """
    binary = np.asarray(binary)
    if binary.ndim != 2 or binary.size == 0:
        return np.array([], dtype=int)

    height, width = binary.shape
    col_mask = binary.any(axis=0)
    summed = binary.sum(axis=0).astype(float)
    valid = (summed / float(height)) >= float(threshold)

    nulls = np.where(col_mask)[0]
    if not len(nulls):
        return np.array([], dtype=int)

    diff = nulls[1:] - nulls[:-1]
    if len(diff) == 0:
        starts = np.array([], dtype=int)
    else:
        # An isolated first foreground run is not a column start. This mirrors
        # the legacy estimator: only a contiguous run from the first pixel or
        # a later gap can introduce a start.
        starts = np.asarray(
            np.r_[[nulls[0]] if diff[0] == 1 else [], nulls[1:][diff > 1]],
            dtype=int,
        )
        starts = starts[valid[starts]]

    doubled = np.where((summed[1:] > summed[:-1] * 2) & valid[1:])[0] + 1

    increasing, bounds = groupby_arr(summed[1:] > summed[:-1])
    increased: list[int] = []
    if len(increasing):
        from0 = int(not increasing[0])
        starts_ends = zip(bounds[from0::2], bounds[1 + from0::2])
        increased = [
            s + 1
            for s, e in starts_ends
            if e < len(summed) and summed[e] > summed[s] * 2 and valid[e]
        ]

    candidates = np.unique(np.r_[starts, doubled, increased]).astype(int)
    if not len(candidates):
        valid_indices = np.where(valid)[0]
        if not len(valid_indices):
            return np.array([], dtype=int)
        candidates = np.array([valid_indices[0]], dtype=int)

    # A candidate is useful only when the following column span is wide enough
    # to represent a real column. The legacy code applies this to the gap to
    # the next candidate, including the image's right edge for the last one.
    min_diff = max(1.0, float(min_col_width_ratio) * width)
    gaps = np.r_[candidates[1:], width] - candidates
    return candidates[gaps > min_diff].astype(int)


def detect_column_bounds(binary: np.ndarray,
                         threshold: float = 0.1,
                         min_col_width_ratio: float = 0.01,
                         compact: bool = False) -> list[tuple[int, int]]:
    """Detect (start, end) bounding intervals for all columns in a binary image.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W).
    threshold : float
        Detection threshold ratio (0.0 to 1.0).
    min_col_width_ratio : float
        Minimum column width as a fraction of image width.
    compact : bool
        If False (standard stratigraphic tiling), column i ends where column i+1 starts,
        and the last column ends at image width.
        If True, each column is trimmed to only cover where foreground data is actually present.

    Returns
    -------
    list of (start, end) tuples
    """
    binary = np.asarray(binary)
    if binary.ndim != 2 or binary.size == 0:
        return []

    _height, width = binary.shape
    starts = detect_column_starts(
        binary, threshold=threshold, min_col_width_ratio=min_col_width_ratio)
    if len(starts) == 0:
        return []

    ends = np.r_[starts[1:], [width]].astype(int)
    bounds = []
    for i, (s, e) in enumerate(zip(starts, ends)):
        if s >= e:
            continue
        if compact:
            section = binary[:, s:e]
            cols_with_data = np.where(section.any(axis=0))[0]
            if len(cols_with_data):
                actual_s = s + int(cols_with_data[0])
                actual_e = s + int(cols_with_data[-1]) + 1
                bounds.append((actual_s, actual_e))
            else:
                bounds.append((int(s), int(e)))
        else:
            bounds.append((int(s), int(e)))

    return bounds


def slice_columns(image_or_binary: np.ndarray,
                  bounds: Sequence[tuple[int, int]]) -> list[np.ndarray]:
    """Slice 2D or 3D array into column sections based on (start, end) bounds."""
    arr = np.asarray(image_or_binary)
    return [arr[:, s:e] for s, e in bounds]
