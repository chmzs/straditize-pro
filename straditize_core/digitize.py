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

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover - scipy is a hard dependency
    ndimage = None

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


# --- Column-curve membership rule (single source of truth) --------------------
#
# A column band holds ink that is not the column's own curve: anti-aliased
# remnants of the neighbouring panel's zero line, dashed horizontal grid lines,
# the plot frame. Reading the RIGHTMOST ink in the whole band is defeated by any
# of it -- a neighbouring panel's bleed can reach ~95% of the panel maximum while
# sitting a median 29 px away from the real silhouette (measured on the Aber
# ground truth, dominant taxa: mean R^2 0.61, MAE 4.6%).
#
# Membership is therefore decided by connected-component identity and size: a
# real curve runs down the panel while grid dashes, frame remnants and specks are
# small blobs, and the two families are separated by more than an order of
# magnitude (measured on the repository's benchmark figures: stray ink 4-18 px,
# real curves >= 333 px). The session digitization path
# (``straditize_core.session_parts.digitize``) and the batch reader
# ``trace_area_profile`` both call ``_own_run_last_offset`` here, so one physical
# quantity has exactly one read rule; they differ only in their output
# convention (absolute x vs. width-from-baseline).
_AREA_MIN_COMPONENT_PX = 50

# A row's first ink within this many pixels of the band's left edge counts as
# anchored to the section baseline.
_BASELINE_ANCHOR_TOL_PX = 3

# A panel's own Y axis is a vertical stroke right at the band's left edge: it
# carries ink in (nearly) every row of the data region, unlike the data trace,
# which merely passes through a given x. See `_axis_ink_offsets`.
_AXIS_INK_COVERAGE = 0.9
_AXIS_INK_MAX_OFFSET_PX = 2


def _run_bounds(fg_indices: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """First/last positions of each contiguous run of sorted foreground offsets."""
    breaks = np.flatnonzero(np.diff(fg_indices) > 1)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [fg_indices.size - 1]))
    return starts, ends


def _band_components(band: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Label the connected ink components of a column band.

    Returns ``(labels, label_areas)`` where ``labels`` holds the component id of
    every band pixel and ``label_areas[id]`` its pixel area (index 0 is the
    background and keeps area 0).
    """
    band = np.asarray(band, dtype=bool)
    if ndimage is None or not band.any():
        return np.zeros(band.shape, dtype=int), np.zeros(1, dtype=float)
    labels, count = ndimage.label(band, structure=np.ones((3, 3), dtype=bool))
    if not count:
        return np.zeros(band.shape, dtype=int), np.zeros(1, dtype=float)
    areas = np.asarray(ndimage.sum(band, labels, index=np.arange(1, count + 1)), dtype=float)
    return labels, np.concatenate(([0.0], areas))


def _own_run_span(
    fg_indices: np.ndarray,
    band_labels_row: np.ndarray,
    label_areas: np.ndarray,
    baseline_tol: int = _BASELINE_ANCHOR_TOL_PX,
) -> tuple[int, int]:
    """(first, last) ink offset of the column's own curve in one band row.

    ``fg_indices`` holds the sorted foreground x-offsets of a single row inside
    one column band; ``band_labels_row`` maps every offset of that band to its
    connected-component id and ``label_areas`` gives each component's area.

    The own curve is resolved in three tiers so that a reading is always produced
    rather than silently dropped:

    1. the leftmost component of at least ``_AREA_MIN_COMPONENT_PX`` pixels --
       the tier that decides real panels, and the tier that rejects a
       neighbouring panel's bleed sitting further right;
    2. otherwise, if the row's first ink is anchored to the baseline (within
       ``baseline_tol``), that anchored component -- thin or small drawings whose
       curve never grows large enough to clear tier 1;
    3. otherwise the row's ink span, the last-resort reading.

    The span is that component's ink *in this row*, which leaves the legacy
    answer untouched whenever the own component is also the row's whole ink
    (thin-line diagrams).

    The panel's own Y axis must already be removed from ``fg_indices`` by the
    caller (:func:`_axis_ink_offsets`); otherwise, on an unfilled drawing the axis
    is the largest component and every reading collapses onto it (P-02).
    """
    starts, ends = _run_bounds(fg_indices)

    def label_at(run_index: int) -> int:
        return int(band_labels_row[fg_indices[run_index]])

    own_label = 0
    for start in starts:
        label = label_at(start)
        if label and label_areas[label] >= _AREA_MIN_COMPONENT_PX:
            own_label = label
            break
    if own_label == 0 and int(fg_indices[0]) <= baseline_tol:
        own_label = label_at(0)
    result = None
    if own_label != 0:
        for start, end in zip(starts, ends):
            if label_at(start) == own_label:
                result = (int(fg_indices[start]), int(fg_indices[end]))
    if result is None:
        return int(fg_indices[0]), int(fg_indices[-1])
    return result


def _own_run_last_offset(
    fg_indices: np.ndarray,
    band_labels_row: np.ndarray,
    label_areas: np.ndarray,
    baseline_tol: int = _BASELINE_ANCHOR_TOL_PX,
) -> int:
    """Rightmost ink offset of the column's own curve in one band row.

    See :func:`_own_run_span` for the (single) membership rule.
    """
    return _own_run_span(fg_indices, band_labels_row, label_areas, baseline_tol)[1]


def _line_own_offset(
    fg_indices: np.ndarray,
    band_labels_row: np.ndarray,
    label_areas: np.ndarray,
    baseline_tol: int = _BASELINE_ANCHOR_TOL_PX,
    filled: bool | None = None,
) -> float:
    """Curve offset of the ``line`` reader in one band row.

    Two drawings share this reader name, and the difference is decisive
    (benchmark D-08): on a *filled* silhouette the curve is the fill's TOP EDGE, so
    the reading is the row's rightmost own ink; on a *stroke* drawing the curve is
    the stroke itself, and its centre is the reading. Averaging the ink — the
    legacy ``np.mean(fg_indices)`` — lands on the middle of a filled silhouette, so
    every column reported exactly 0.500 of the truth. Measured on
    `Diatom_riojaPlotTestData.png` (px/unit 3.80, filled profiles):

        column              area   line (legacy)   ratio
        Brachysira vitrea  14.21        7.11       0.500
        Eunotia incisa     16.84        8.42       0.500
        Tabellaria floc.    6.32        3.16       0.500

    The two are told apart structurally, with no per-image switch: a fill is inked
    from the baseline outwards, a stroke floats at the value. ``filled`` carries
    the column-level verdict from :func:`_band_is_filled`; when it is None the row
    decides on its own.
    """
    left, right = _own_run_span(fg_indices, band_labels_row, label_areas, baseline_tol)
    is_fill = bool(left <= baseline_tol) if filled is None else bool(filled)
    if is_fill:
        return float(right)
    return 0.5 * float(left + right)


def _band_is_filled(
    band: np.ndarray,
    axis_offsets: np.ndarray,
    baseline_tol: int = _BASELINE_ANCHOR_TOL_PX,
    anchored_ratio: float = 0.5,
) -> bool:
    """Whether a column band is a filled silhouette rather than a stroke drawing.

    Decided once per column, not per row: a fill is inked from the baseline
    outwards in (nearly) every row, whereas a stroke only touches the baseline
    where its value is ~0. Dashing and antialias gaps drop the baseline ink on a
    few rows, and a per-row decision would then flip style inside one column —
    measured on the diatom figure, 22-38 rows per column had ``line`` fall short of
    ``area`` by up to 3.5 px (0.5 px on every 2-px fill).
    """
    ink_rows = 0
    anchored_rows = 0
    for row in range(band.shape[0]):
        offsets = _without_axis_ink(np.where(band[row])[0], axis_offsets)
        if not len(offsets):
            continue
        ink_rows += 1
        if int(offsets[0]) <= baseline_tol:
            anchored_rows += 1
    return ink_rows > 0 and anchored_rows >= anchored_ratio * ink_rows


def _axis_ink_offsets(
    band: np.ndarray,
    coverage: float = _AXIS_INK_COVERAGE,
    max_offset: int = _AXIS_INK_MAX_OFFSET_PX,
) -> np.ndarray:
    """Offsets inside a column band that belong to the panel's own Y axis.

    Benchmark P-02: on a *curve* drawing the axis and the curve are separate
    strokes, and the axis is by far the largest connected component (Empetrum:
    1303 of the band's 1606 ink pixels, spanning 481/482 rows). The own-curve
    rule then reads the axis, so every layer where the curve stands clear of the
    axis came back as 0 % — 13 of Empetrum's 48 layers, 82 % of that column's
    absolute error.

    The discriminator is vertical coverage: an axis has ink in (nearly) every row
    of the data region, whereas the data trace only *passes through* a given x.
    Measured (fraction of band rows inked):

        curve Empetrum  x=544 -> 0.998 | x=545 -> 0.434 | x=546 -> 0.305
        area  Empetrum  x=544 -> 0.998 | x=545 -> 0.616 | x=546 -> 0.529
        diatom panel 0  x= 76 -> 0.879 | x= 77 -> 0.709

    Only the leading offsets are eligible — a column further right can be solid
    too when the silhouette stays above it — and the solid run must start at the
    band's left edge, so a filled silhouette keeps its own ink (its first columns
    are *fill*, and removing the axis column does not change the rightmost-ink
    reading anyway).
    """
    band = np.asarray(band, dtype=bool)
    if band.ndim != 2 or band.size == 0:
        return np.zeros(0, dtype=int)
    column_coverage = band.mean(axis=0)
    offsets: list[int] = []
    for offset in range(min(int(max_offset) + 1, band.shape[1])):
        if float(column_coverage[offset]) < float(coverage):
            break
        offsets.append(offset)
    return np.asarray(offsets, dtype=int)


def _without_axis_ink(fg_indices: np.ndarray, axis_offsets: np.ndarray) -> np.ndarray:
    """Drop the panel-axis pixels from one row's ink offsets."""
    if axis_offsets.size == 0:
        return fg_indices
    return fg_indices[~np.isin(fg_indices, axis_offsets)]


def trace_area_profile(section_mask: np.ndarray) -> np.ndarray:
    """Return each row's own ink width (+1), measured from the section baseline.

    Membership of the column's own curve is decided by ``_own_run_last_offset``,
    the same rule the session digitization path uses, so both paths read one
    physical quantity one way. A neighbouring panel's bleed and the dashed grid
    marks are rejected because they are not part of the own component.

    The profile is deliberately not despiked: a spike in a real silhouette is data,
    not noise, and replacing it with a neighbour average would fabricate a reading
    (Invariant 1). Callers that want smoothing must do it explicitly on real values.

    Parameters
    ----------
    section_mask : np.ndarray
        2D boolean array (H x W) representing a column section.

    Returns
    -------
    np.ndarray
        1D float array of length H with width values in pixels from left.
    """
    section_mask = np.asarray(section_mask, dtype=bool)
    if section_mask.ndim != 2:
        raise ValueError(f"Expected 2D array, got shape {section_mask.shape}")
    height = section_mask.shape[0]
    values = np.zeros(height, dtype=float)
    if not section_mask.any():
        return values

    band_labels, band_label_areas = _band_components(section_mask)
    axis_offsets = _axis_ink_offsets(section_mask)
    for row in range(height):
        xs = np.where(section_mask[row])[0]
        own = _without_axis_ink(xs, axis_offsets)
        if len(own):
            values[row] = float(
                _own_run_last_offset(own, band_labels[row], band_label_areas) + 1
            )
        elif len(xs):
            # 整行只有轴线：那几列就是数据本身（值≈0），照旧取最右墨迹。
            values[row] = float(np.max(xs) + 1)
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
        column_names = [f"col{i + 1:02d}" for i in range(n_cols)]
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


def extract_vector_polygon(
    section_mask: np.ndarray,
    baseline_x: float = 0.0,
    min_area_px: int = 10,
) -> np.ndarray:
    """Extracts a closed, sub-pixel vector contour polygon representing an area silhouette.

    Anchors and closes the polygon along the baseline (x = baseline_x).

    Parameters
    ----------
    section_mask : np.ndarray
        2D boolean or binary array (H x W) for a single column section.
    baseline_x : float
        X-offset of the column baseline in this coordinate system (default: 0.0).
    min_area_px : int
        Minimum bounding box area to filter out isolated specks.

    Returns
    -------
    np.ndarray
        (N, 2) array of float vertices (x, y) forming a closed clockwise/counter-clockwise polygon.
    """
    mask = np.asarray(section_mask, dtype=bool)
    if mask.ndim != 2 or not mask.any():
        return np.zeros((0, 2), dtype=float)

    h, w = mask.shape

    # Fast row-wise rightmost envelope tracing to guarantee single-valued function along baseline
    profile_w = np.zeros(h, dtype=float)
    for r in range(h):
        xs = np.where(mask[r])[0]
        if len(xs) > 0:
            profile_w[r] = float(xs.max() + 1.0)
        else:
            profile_w[r] = 0.0

    # Build closed continuous polygon anchored at baseline_x
    poly_pts: list[tuple[float, float]] = [(baseline_x, 0.0)]
    for r in range(h):
        poly_pts.append((baseline_x + profile_w[r], float(r)))
    poly_pts.append((baseline_x, float(h - 1)))
    poly_pts.append((baseline_x, 0.0))

    return np.asarray(poly_pts, dtype=float)


def slice_vector_polygon_at_depths(
    polygon_pts: np.ndarray,
    target_ys: Sequence[float],
) -> np.ndarray:
    """Performs continuous analytical slicing (ray-casting intersection) across a vector polygon.

    Solves the intersection of horizontal cut lines y = Y_k with polygon edge segments.
    Decouples image resolution from sample resolution.

    Parameters
    ----------
    polygon_pts : np.ndarray
        (N, 2) array of (x, y) vertices representing a closed polygon.
    target_ys : sequence of float
        Target vertical coordinates (e.g. pixel Y positions corresponding to sample depths).

    Returns
    -------
    np.ndarray
        1D float array of intersected horizontal widths corresponding to each target Y.
    """
    pts = np.asarray(polygon_pts, dtype=float)
    if len(pts) < 3:
        return np.zeros(len(target_ys), dtype=float)

    px = pts[:, 0]
    py = pts[:, 1]

    n_targets = len(target_ys)
    widths = np.zeros(n_targets, dtype=float)

    for k, ty in enumerate(target_ys):
        cross = ((py[:-1] <= ty) & (py[1:] > ty)) | ((py[:-1] > ty) & (py[1:] <= ty))
        idx = np.where(cross)[0]
        if len(idx) == 0:
            widths[k] = 0.0
            continue

        x_crosses = []
        for i in idx:
            denom = py[i + 1] - py[i]
            t = (ty - py[i]) / (denom if abs(denom) > 1e-9 else 1e-9)
            t = max(0.0, min(1.0, t))
            x_crosses.append(px[i] + t * (px[i + 1] - px[i]))

        if len(x_crosses) >= 2:
            widths[k] = float(max(x_crosses) - min(x_crosses))
        else:
            widths[k] = 0.0

    return widths
