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
    # to represent a real column, and two candidates that sit closer than
    # ``min_diff`` belong to ONE panel: the winner is the one that spans the
    # panel's full height.
    #
    # Benchmark P-01 (`Pollen_CruveStyle_riojaPlotTestData.png`): the curve
    # drawing puts a candidate 4-8 px right of three real axes, and the legacy
    # rule — keep a candidate when its gap to the NEXT candidate is wide enough —
    # kept that follower instead, so Empetrum's band ran to 609 and read
    # Gramineae's axis (MAE 34.05). Measured vertical coverage at those pairs
    # (fraction of the data region's rows carrying ink at that x):
    #
    #     601 -> 1.000   vs   609 -> 0.094     (real axis vs curve's first ink)
    #     652 -> 1.000   vs   658 -> 0.073
    #     839 -> 1.000   vs   843 -> 0.098
    #     691 -> 1.000   vs   690 -> 0.015     (diatom-like 1-px antialias speck)
    #      76 -> 0.865   vs    73 -> 0.010     (Diatom_riojaPlotTestData.png)
    #
    # A panel axis runs the whole height; a curve's first ink, a tick or an
    # antialias speck does not. So a close pair is resolved by coverage (higher
    # wins; equal coverage keeps the earlier x), which restores 601/652/839
    # without lowering the threshold — 0.005 also drags in the fake 609/658/843
    # candidates, and a plain "keep the earlier one" rule would move 21 real
    # axes of the diatom figure 1-3 px left onto those specks.
    min_diff = max(1.0, float(min_col_width_ratio) * width)
    coverage = summed / float(height)
    keep: list[int] = []
    cluster: list[int] = [int(candidates[0])]
    for candidate in candidates[1:]:
        candidate = int(candidate)
        if candidate - cluster[-1] <= min_diff:
            cluster.append(candidate)
            continue
        keep.append(cluster[int(np.argmax([coverage[c] for c in cluster]))])
        cluster = [candidate]
    keep.append(cluster[int(np.argmax([coverage[c] for c in cluster]))])
    # Mirror the legacy right-edge rule: the last start needs room up to the
    # image edge, otherwise it is a mark inside the last column, not a column.
    if len(keep) > 1 and (width - keep[-1]) <= min_diff:
        keep.pop()
    return np.asarray(keep, dtype=int)


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


def has_measurable_axis(
    gray: np.ndarray,
    start: int,
    y0: int | None = None,
    y1: int | None = None,
    *,
    max_width: int = 10,
    # 阈值由实测分布定，不是拍的：轴沿 y 恒定（std ≤ 18，含 diatom 的浅灰轴 17.7），
    # 曲线/文字沿 y 起伏（std ≥ 59）。取 30 落在两簇中间，两侧都有 1.5 倍余量。
    std_limit: float = 30.0,
    # 与纸白的亮度差：diatom 浅灰轴 48，纸面 0。取 25。
    contrast_min: float = 25.0,
) -> bool:
    """该列起点处是否存在一条**贯穿列高的竖轴**。

    ## 为什么**不经二值化**

    有没有轴是**结构问题**（"这一列像素沿 y 方向是否恒定、且与背景有亮度差"），
    不是"够不够暗"的问题。二值化对图版高度敏感：

    - diatom 的轴是浅灰 (224,224,224)，任何偏低阈值都会把它整批丢成背景
      （实测硬阈值 `gray<128` 让 25 列**全部**被判无轴，而它们每列都有轴）；
    - 反色图（深底浅线）的轴比背景**亮**，`< threshold` 方向整个反掉；
    - 彩色底图还会引入色相，灰度化后再阈值更不可靠。

    所以判据只用两条**连续量**，与"墨"的定义解耦：

    1. 该 x 列在数据区沿 y 方向的**灰度标准差**很小 —— 一条均匀的直线；
    2. 该列均值与**纸白（背景中位数）**有足够亮度差 —— 它确实是"线"而非纸面。

    第 2 条用"与背景的差"而不是绝对暗度，因此浅灰轴、深底浅轴都能命中。
    """
    arr = np.asarray(gray)
    if arr.ndim != 2 or arr.size == 0:
        return False
    height, width = arr.shape
    if height == 0:
        return False
    base = int(start)
    if base < 0 or base >= width:
        return False

    # 只在**数据区**判：图顶部是标题、底部是留白，整列统计会被稀释。
    lo = 0 if y0 is None else max(0, int(y0))
    hi = height if y1 is None else min(height, int(y1))
    if hi - lo < 10:
        return False
    band = arr[lo:hi, :].astype(float)
    paper = float(np.median(band))

    for shift in (-2, -1, 0, 1, 2):
        x_at = base + shift
        if x_at < 0 or x_at >= width:
            continue
        col = band[:, x_at]
        if float(col.std()) > std_limit:
            continue          # 沿 y 起伏大 → 是曲线/纹理，不是均匀直线
        if abs(float(col.mean()) - paper) < contrast_min:
            continue          # 与纸白无差 → 就是纸面
        return True
    return False


def measure_axis_right_edge(rgb: np.ndarray,
                            binary: np.ndarray,
                            starts: Sequence[int],
                            solid_ratio: float = 0.9,
                            max_probe: int = 8,
                            max_axis_width: int = 8,
                            max_color_ratio: float = 0.15) -> list[int]:
    """每个列起点处 Y 轴基线的右缘偏移量（相对起点，单位 px）。

    ## 用途

    `detect_column_bounds` 返回的 `start` 是该列第一个墨迹像素 = 基线**左缘**。
    科研绘图软件（Origin / R / Python / riojaPlot / Tilia）里，X 轴刻度齿从
    基线**右缘**向右生长，曲线也从右缘起笔。拿左缘当零点会让每列系统性左偏
    0~7px（fig3 实测），画布零点标记也与底图刻度齿对不齐。

    ## 判据：只认「极窄 + 纯灰」的实心竖条

    1. 从 `start` 起连续实心（暗占比 > solid_ratio）的宽度 ∈ [1, max_axis_width]；
    2. **起始像素不是彩色**（RGB 通道差 ≤ 30 的占比 > 1 - max_color_ratio）。

    第 2 条只取起始像素、不取整段：紧贴基线生长的曲线会把基线的右邻像素染色
    （实测 fig3 col3：+0 纯灰 RGB(56,61,61) 彩色率 0.00，+1 红线彩色率 0.95）。
    对整段取平均会让真基线被右邻曲线污染而误拒。

    ## 已知边界（实测记录，不要再试图用阈值解决）

    本函数**无法**区分「真基线」与「filled-silhouette 图的填充左缘」：

    | | fig3 col3（真基线） | Aber col2（填充左缘） |
    |:---|:---|:---|
    | 宽度 | 2px | 2px |
    | 暗占比 | 1.00 | 0.99 |
    | 起始像素彩色率 | 0.00 | 0.00 |
    | 右邻 | 深红曲线紧贴 | 深绿填充紧贴 |

    放大并排比对后确认：两者在结构上**完全相同**——都是"细的纯灰竖条，
    右侧紧贴彩色数据"。任何基于宽度/亮度/彩色/间隙的阈值都会在这两张图之间
    来回摇摆（试过：亮度判据使两图区间重叠；「右侧须空白」使 fig3 只剩 2 列）。

    因此本函数只保证"识别出像基线的竖条"，**是否启用由调用方按图决定**
    （`anchor_zero_at_axis_right`）。Aber 这类图必须关闭该开关。

    Returns
    -------
    list of int
        与 `starts` 等长的偏移量列表；不符合判据的列返回 0（零点保持起点）。
    """
    rgb_arr = np.asarray(rgb)
    bin_arr = np.asarray(binary)
    if bin_arr.ndim != 2 or bin_arr.size == 0:
        return [0 for _ in starts]
    if rgb_arr.ndim == 2:
        rgb_arr = np.stack([rgb_arr] * 3, axis=-1)

    height, width = bin_arr.shape
    if height == 0:
        return [0 for _ in starts]

    offsets: list[int] = []
    for start in starts:
        base = int(start)
        if base < 0 or base >= width:
            offsets.append(0)
            continue

        offset = 0
        broke_out = False
        for probe in range(max_probe):
            x = base + probe
            if x < 0 or x >= width:
                break
            if bin_arr[:, x].mean() <= solid_ratio:
                broke_out = True
                break
            offset = probe + 1

        # 探到上限仍未断开 = 是大块实心填充，不是细基线。
        # 这种情况必须返回 0：把整块填充读成偏移量会让零点落进色块内部。
        if offset == 0 or offset > max_axis_width or not broke_out:
            offsets.append(0)
            continue

        axis_first = rgb_arr[:, base].astype(np.int16)
        colored = ((axis_first.max(axis=1) - axis_first.min(axis=1)) > 30).mean()
        if colored > max_color_ratio:
            offsets.append(0)
            continue

        offsets.append(offset)

    return offsets


def slice_columns(image_or_binary: np.ndarray,
                  bounds: Sequence[tuple[int, int]]) -> list[np.ndarray]:
    """Slice 2D or 3D array into column sections based on (start, end) bounds."""
    arr = np.asarray(image_or_binary)
    return [arr[:, s:e] for s, e in bounds]
