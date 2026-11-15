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


# ---- 步骤 7 拐点：垂直误差界族 -------------------------------------------------
#
# 判据是**垂直距离**：控制点线性重构后 |重构值 − 逐行轮廓| 的上界。
# 不是点到弦的垂直距离（perpendicular）——两者在"一行垂直台阶"上差一个数量级：
# 实测列底 172→5 的台阶，perpendicular RDP(eps=2) 会把它拉成 5 行斜坡（单点误差
# 110px），而垂直 RDP(eps=2) 的误差上界恒等于 eps。
VERTICAL_TOLERANCE_PX = 2.0
AXIS_PILEUP_MIN_GAP_PX = 7.0
AXIS_PILEUP_MIN_VALUE_GAP_PX = 2.0
# 去堆叠允许把单点 max 误差用到 2.15px，但 P95 仍必须 <= VERTICAL_TOLERANCE_PX。
# 2.15 = 2.0（RDP 的硬上界）+ 0.15（去堆叠的余量），保证 max 也在 2.15 以内。
AXIS_PILEUP_MAX_ERROR_PX = 2.15


def _abs_error(rows: np.ndarray, values: np.ndarray, keep: Sequence[int]) -> np.ndarray:
    """每个观测行上 |线性重构 − 原值|。"""
    idx = np.asarray(list(keep), dtype=int)
    return np.abs(np.interp(rows, rows[idx], values[idx]) - values)


def _error_stats(rows: np.ndarray, values: np.ndarray, keep: Sequence[int]) -> tuple[float, float]:
    err = _abs_error(rows, values, keep)
    return float(np.percentile(err, 95)), float(err.max())


def count_axis_pileups(rows: Sequence[float],
                       values: Sequence[float],
                       keep: Sequence[int],
                       min_gap: float = AXIS_PILEUP_MIN_GAP_PX,
                       min_value_gap: float = AXIS_PILEUP_MIN_VALUE_GAP_PX,
                       exclude_endpoint_pairs: bool = False) -> int:
    """数「贴轴密点」：相邻控制点行距 < min_gap 且取值差 < min_value_gap。

    Parameters
    ----------
    exclude_endpoint_pairs : bool
        跳过与首/末控制点相邻的对。列底（或列顶）的台阶必须同时保留
        「台阶脚」与 y1 端点，两者天然相邻数行且同为基线值；去掉台阶脚会让
        该处误差跳到上百像素，与「P95 <= 2px」直接冲突。因此端段按定义豁免。
    """
    rows = np.asarray(rows, dtype=float)
    values = np.asarray(values, dtype=float)
    keep = list(keep)
    last = len(rows) - 1
    total = 0
    for left, right in pairwise(keep):
        if rows[right] - rows[left] >= min_gap:
            continue
        if abs(values[right] - values[left]) >= min_value_gap:
            continue
        if exclude_endpoint_pairs and (left in (0, last) or right in (0, last)):
            continue
        total += 1
    return total


def rdp_vertical(x: Sequence[float],
                 y: Sequence[float],
                 epsilon: float = VERTICAL_TOLERANCE_PX) -> list[int]:
    """Ramer-Douglas-Peucker with VERTICAL distance.

    与 rdp_indices 的区别只在距离定义：这里量的是点到弦的**竖直**偏差，
    因此结果满足 max|线性重构 − y| <= epsilon；rdp_indices 量的是点到弦的
    垂直距离，在陡段上不约束竖直误差。

    Returns
    -------
    list of int
        Sorted indices of the preserved points (first and last always kept).
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(x)
    if n <= 2:
        return list(range(n))

    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        span = x[end] - x[start]
        if span == 0:
            continue
        chord = y[start] + (y[end] - y[start]) * (x[start + 1:end] - x[start]) / span
        dev = np.abs(y[start + 1:end] - chord)
        best = int(np.argmax(dev))
        if dev[best] > epsilon:
            mid = start + 1 + best
            keep[mid] = True
            stack.append((start, mid))
            stack.append((mid, end))
    return np.where(keep)[0].tolist()


def detect_turning_points_vertical(
    series_or_values: pd.Series | np.ndarray,
    epsilon: float = VERTICAL_TOLERANCE_PX,
    prominence: float = 2.0,
    min_distance: int = 3,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Extract turning points under a VERTICAL error bound.

    两步，且第二步只做加密、不做删减：
    1. 每个显著极值（prominence >= prominence 的局部极大/极小）都是**强制锚点**，
       因此凸点/凹点不会被"误差够小"这一步吞掉；
    2. 相邻锚点之间用 rdp_vertical 加密，保证 max|重构 − 原值| <= epsilon。

    Parameters
    ----------
    series_or_values : pd.Series or np.ndarray
        Curve profile along the row axis. A Series contributes its index as row
        coordinates; an array is treated as rows 0..n-1.
    epsilon : float
        Vertical tolerance in the profile's own units (pixels for digitizing).
    prominence : float
        Topological prominence threshold for mandatory peaks/valleys.
    min_distance : int
        Minimum row distance between adjacent mandatory peaks.

    Returns
    -------
    rows : np.ndarray
    values : np.ndarray
    is_mandatory : np.ndarray
        True for peaks/valleys/endpoints, False for error-bound reinforcements.
    """
    if isinstance(series_or_values, pd.Series):
        valid = series_or_values.dropna()
        if valid.empty:
            return np.array([], float), np.array([], float), np.array([], bool)
        all_rows = valid.index.values.astype(float)
        all_vals = valid.values.astype(float)
    else:
        arr = np.asarray(series_or_values, dtype=float)
        valid_idx = np.where(np.isfinite(arr))[0]
        if not len(valid_idx):
            return np.array([], float), np.array([], float), np.array([], bool)
        all_rows = valid_idx.astype(float)
        all_vals = arr[valid_idx]

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

        peaks, _ = find_peaks(seg_vals, prominence=prominence, distance=min_distance)
        valleys, _ = find_peaks(-seg_vals, prominence=prominence, distance=min_distance)
        anchors = sorted({0, n_pts - 1} | set(peaks.tolist()) | set(valleys.tolist()))

        keep = set(anchors)
        for start, end in pairwise(anchors):
            if end - start < 2:
                continue
            sub = rdp_vertical(seg_rows[start:end + 1], seg_vals[start:end + 1], epsilon)
            keep.update(start + i for i in sub)

        for i in sorted(keep):
            out_rows.append(float(seg_rows[i]))
            out_vals.append(float(seg_vals[i]))
            out_mandatory.append(i in anchors)

    unique_rows, u_idx = np.unique(out_rows, return_index=True)
    return (
        unique_rows,
        np.asarray(out_vals, dtype=float)[u_idx],
        np.asarray(out_mandatory, dtype=bool)[u_idx],
    )


def prune_axis_pileups(rows: Sequence[float],
                       values: Sequence[float],
                       mandatory: Sequence[bool] | None = None,
                       min_gap: float = AXIS_PILEUP_MIN_GAP_PX,
                       min_value_gap: float = AXIS_PILEUP_MIN_VALUE_GAP_PX,
                       tolerance: float = VERTICAL_TOLERANCE_PX,
                       max_drop_error: float = AXIS_PILEUP_MAX_ERROR_PX,
                       ) -> tuple[np.ndarray, np.ndarray]:
    """Remove control points that pile up against the axis, under an error guard.

    一次删除只在**两个条件同时成立**时被接受：
    1. 贴轴密点数严格下降（否则删掉中间点会把左右两个并成新的一对）；
    2. P95 <= tolerance 且 max <= max_drop_error。

    首末控制点永不删除（曲线必须覆盖整段）；mandatory 为 True 的点也不删除，
    这样强制极值锚点不会被去堆叠顺手吃掉。

    Returns
    -------
    rows, values : np.ndarray
        Pruned control points, sorted by row.
    """
    rows = np.asarray(rows, dtype=float)
    values = np.asarray(values, dtype=float)
    n_total = len(rows)
    if n_total < 3:
        return rows, values
    if mandatory is None:
        mandatory = np.zeros(n_total, dtype=bool)
    mandatory = np.asarray(mandatory, dtype=bool)

    keep = list(range(n_total))
    cap = max(float(max_drop_error), float(_error_stats(rows, values, keep)[1]) + 1e-6)
    tried: set[tuple[int, int]] = set()
    mandatory_idx = np.where(mandatory)[0]

    def _acceptable(trial: list[int], before: int, lo: int, hi: int) -> bool:
        """判据只看**受影响的区间** [lo, hi]，不看全列。

        只看全局会把判据锁死：全列任意处恰好等于上限的一个点，都会让所有
        无关位置的删除被拒（实测就是这一步把去堆叠卡在 13 处不动）。区间内
        要求：局部 max <= max_drop_error、区间内强制极值误差 <= tolerance、
        并且全列 P95 仍 <= tolerance。
        """
        if len(trial) < 2:
            return False
        if count_axis_pileups(rows, values, trial, min_gap, min_value_gap) > before:
            return False
        err = _abs_error(rows, values, trial)
        if float(err[lo:hi + 1].max()) > cap + 1e-9:
            return False
        inside = [i for i in mandatory_idx if lo <= i <= hi]
        if inside and float(err[inside].max()) > tolerance + 1e-9:
            return False
        p95, _ = _error_stats(rows, values, trial)
        return p95 <= tolerance + 1e-9

    for _ in range(4 * n_total + 16):
        pairs = [
            (left, right)
            for left, right in pairwise(keep)
            if rows[right] - rows[left] < min_gap and abs(values[right] - values[left]) < min_value_gap
        ]
        pending = [pair for pair in pairs if pair not in tried]
        if not pending:
            break
        left, right = pending[0]
        before = count_axis_pileups(rows, values, keep, min_gap, min_value_gap)

        accepted = False
        for candidate in (right, left):
            if candidate in (0, n_total - 1):
                continue
            pos = keep.index(candidate)
            lo = keep[pos - 1] if pos > 0 else keep[pos]
            hi = keep[pos + 1] if pos + 1 < len(keep) else keep[pos]
            trial = [i for i in keep if i != candidate]
            if _acceptable(trial, before, lo, hi):
                keep = trial
                accepted = True
                break
        if accepted:
            continue

        if left in (0, n_total - 1) or right in (0, n_total - 1):
            tried.add((left, right))
            continue

        # 两点并一点：在 [left, right] 内挑局部误差最小的那一行
        pos = keep.index(left)
        lo = keep[pos - 1] if pos > 0 else left
        hi = keep[pos + 2] if pos + 2 < len(keep) else right
        best_row, best_local = None, np.inf
        for candidate_row in range(left, right + 1):
            trial = sorted(set([i for i in keep if i not in (left, right)] + [candidate_row]))
            err = _abs_error(rows, values, trial)
            local = float(err[lo:hi + 1].max())
            if local < best_local:
                best_local, best_row = local, candidate_row
        trial = sorted(set([i for i in keep if i not in (left, right)] + [best_row]))
        if _acceptable(trial, before, lo, hi):
            keep = trial
            continue
        tried.add((left, right))

    idx = np.asarray(keep, dtype=int)
    return rows[idx], values[idx]


def enforce_error_bound(rows: Sequence[float],
                        values: Sequence[float],
                        ctrl_rows: Sequence[float],
                        ctrl_values: Sequence[float],
                        tolerance: float = VERTICAL_TOLERANCE_PX,
                        max_passes: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """把违背误差界的行补回控制点集合（结构性的兜底，不是可调参数）。

    正常路径上 detect_turning_points_vertical 已经保证 max <= epsilon，本函数只在
    后续步骤（去堆叠的两点并一点、端点补齐）把误差顶起来时兜住它：每轮把超差行
    的连续段各补一个 argmax 行，直到不再超差或轮数用尽。
    """
    rows = np.asarray(rows, dtype=float)
    values = np.asarray(values, dtype=float)
    ctrl_rows = np.asarray(ctrl_rows, dtype=float)
    ctrl_values = np.asarray(ctrl_values, dtype=float)
    if len(ctrl_rows) < 2:
        return ctrl_rows, ctrl_values

    for _ in range(max_passes):
        err = np.abs(np.interp(rows, ctrl_rows, ctrl_values) - values)
        bad = np.where(err > tolerance + 1e-9)[0]
        if not len(bad):
            break
        extra = []
        for run in np.split(bad, np.where(np.diff(bad) > 1)[0] + 1):
            if len(run):
                extra.append(int(run[int(np.argmax(err[run]))]))
        if not extra:
            break
        merged = sorted(set(ctrl_rows.tolist()) | set(rows[extra].tolist()))
        ctrl_rows = np.asarray(merged, dtype=float)
        ctrl_values = np.interp(ctrl_rows, rows, values)
    return ctrl_rows, ctrl_values


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
