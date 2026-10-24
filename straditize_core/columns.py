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


def measure_axis_right_edge(binary: np.ndarray,
                            starts: Sequence[int],
                            solid_ratio: float = 0.9,
                            max_probe: int = 8,
                            max_axis_width: int = 8,
                            axis_full_height_ratio: float = 0.95) -> list[int]:
    """每个列起点处灰色 Y 轴线的右缘偏移量（相对起点，单位 px）。

    ## 为什么需要这个量

    `detect_column_bounds` 返回的 `start` 是轴线**左缘**（该处第一个暗像素）。
    但在科研绘图软件（Origin / R / Python）里，X 轴刻度齿是从轴线**右缘**
    开始向右生长的，曲线也从右缘起笔。若直接拿左缘当零点：

    1. 轴线自身会被当成"满值墨迹"读入（该列首几列暗占比 = 1.00），
       造成**逐列不同的系统性左偏**；
    2. 画布上的零点标记落在灰线左侧，与底图刻度齿对不齐。

    实测 fig3_raw.jpeg（2132×928，16 列）轴线宽：
    `[2, 1, 2, 0, 2, 5, 1, 2, 0, 6, 6, 6, 0, 2, 1, 0]` px。
    宽度逐列不同，所以必须**逐列**测量，不能用固定偏移。

    ## 判据（两个条件同时成立才算"轴线"）

    1. 从 `start` 起，连续「该列暗像素占比 > `solid_ratio`」的宽度不超过
       `max_probe`（轴线是**细**线，实测 0~6px）；
    2. 越过这段实心之后，必须能读到非实心像素（曲线或空白）。

    **为什么需要第 1 条**：本图 col10/col11 起点处暗占比 0.98 一直延续
    15px 以上——那不是灰轴线，而是**整块实心填充**（岩性柱/色块）。对这类列
    没有细轴线可寻，强行把零点推进实心块内部会把整块填充读成偏移量，
    反而更错。这种情况返回 0，零点保持在起点。

    Returns
    -------
    list of int
        与 `starts` 等长的偏移量列表，每个元素 ∈ [0, max_probe]。
        实心块列返回 0。
    """
    arr = np.asarray(binary)
    if arr.ndim != 2 or arr.size == 0:
        return [0 for _ in starts]

    height, width = arr.shape
    if height == 0:
        return [0 for _ in starts]

    offsets: list[int] = []
    for start in starts:
        base = int(start)
        offset = 0
        still_solid = True
        for probe in range(max_probe):
            x = base + probe
            if x < 0 or x >= width:
                break
            column = arr[:, x]
            if column.mean() <= solid_ratio:
                still_solid = False
                break
            offset = probe + 1
        # 实心块（宽度达到上限仍未断开）：没有细轴线可寻，零点保持起点。
        if still_solid and offset >= max_probe:
            offset = 0
        # 轴线必须**极窄**：实测真灰轴线宽 0~7px（fig3 最宽 7px）。
        if offset > max_axis_width:
            offset = 0
        # 轴线必须**贯穿整列高度**：Y 轴线从图顶画到底，每一行都有它。
        #
        # 这条是区分「真轴线」与「填充轮廓左缘」的决定性判据。实测对比
        # （同一 mask 口径、同一 solid_ratio）：
        #   fig3_raw.jpeg col1  x=332,333 占比 1.00,1.00 → 贯穿，是轴线
        #   type1_filled_silhouette_aber col6 x=157,158 占比 0.24,0.24 → 不贯穿，
        #     是 filled-silhouette 曲线的左实心边缘（曲线只占部分高度）
        # 两者的"是否实心"相同，只有"是否贯穿全高"不同。
        if offset > 0:
            axis_col = arr[:, base : base + offset]
            covered = axis_col.any(axis=1).mean()
            if covered < axis_full_height_ratio:
                offset = 0
        offsets.append(offset)
    return offsets


def slice_columns(image_or_binary: np.ndarray,
                  bounds: Sequence[tuple[int, int]]) -> list[np.ndarray]:
    """Slice 2D or 3D array into column sections based on (start, end) bounds."""
    arr = np.asarray(image_or_binary)
    return [arr[:, s:e] for s, e in bounds]
