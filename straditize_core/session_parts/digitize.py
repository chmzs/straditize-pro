"""Digitization and control points session mixin."""

from __future__ import annotations

from typing import Any

import numpy as np

try:
    from scipy.interpolate import PchipInterpolator
except ImportError:
    PchipInterpolator = None

try:
    from scipy.signal import find_peaks
except ImportError:
    find_peaks = None

from ..curve import (
    VERTICAL_TOLERANCE_PX,
    detect_turning_points_vertical,
    enforce_error_bound,
    prune_axis_pileups,
)
from ..digitize import (
    _axis_ink_offsets,
    _band_components,
    _band_is_filled,
    _line_own_offset,
    _own_run_last_offset,
    _run_bounds,
    _without_axis_ink,
    interpolate_hlines,
)
from .layers import store_layer_pair
from .xscale import _resolve_column_group, resolve_axis_stroke, resolve_column_scale
from ..protocol import (
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: 三种画法。与 `plot_type`、底层 `digitize_column` 共用同一套单数命名。
PLOT_TYPES: tuple[str, ...] = ("area", "line", "bar")

#: 支持的读取器类型 = 三种画法 + 一种读取策略。
#: `area_exaggerated` 读的仍是面积图，但同一列被画了两层（内线真实值，外线夸大参考线），
#: 采用五态双轨互补读取器实现高精度提取与防截断削边回退。
READER_TYPES: tuple[str, ...] = PLOT_TYPES + ("area_exaggerated",)

#: 历史别名 → 规范名。只在此处出现一次：让别名集中在一个入口被消解，
#: 而不是散进每个分支判断（那样 `bar` 曾静默落到 else 走均值，P-04）。
_READER_ALIASES: dict[str, str] = {"bars": "bar"}

# ---- `area_exaggerated` 的五态判据常量 ----
_EXAG_INNER_ANCHOR_TOL_PX = 5
_EXAG_OUTER_MIN_GAP_PX = 2
_EXAG_RATIO_ORIGIN_OFFSET_PX = 1.0
_EXAG_INNER_MIN_WIDTH_PX = 4
_EXAG_OUTER_EDGE_MARGIN_PX = 3
_EXAG_SEP_RATIO_RANGE = (2.0, 7.0)
_EXAG_SELFCHECK_RANGE = (3.0, 5.5)
_EXAG_NEIGHBOUR_ROWS = 10

# 夸大列"外线断开"判据的常量（全部可判定，没有"大致/适当"）。
#
# 现场（`.recon_20261117`，3591×2003 孢粉图）：Picea/Pinus/Betula/Quercus 四列把同一组
# 数据画了两层——贴轴的填充/曲线（**内线** = 真值，宽 4–8px）与外侧放大曲线（**外线**
# = 真值 × mult）。取数读"本行最右墨迹"，外线断开的那几行就退化成内线（recon 实测
# Quercus y=1212–1221 连续 10 行；轴墨迹跨 939..943 即 5px，曲线静止位 x=944）。
#
# 每个常量的含义：
#   _INNER_RUN_START_TOL_PX      内线贴轴：段起点距列左缘 ≤ 5px（轴芯 1–5px + 填充）
#   _BROKEN_INNER_MAX_WIDTH_PX   内线（轴 + 填充）宽度上界 8px；内外线相接时的单段实测
#                                19–33px，落在 8px 之外 → 不会被当成断线补倍率
#   _INNER_WIDTH_MEDIAN_FACTOR   单段宽度 ≤ 1.5 × 内线宽中位数（见下"基准"）
#   _OUTER_DIST_SLACK_PX         比值判据余量：内线距 ≤ 中位(外线距/内线距) × 内线距 + 2px
#   _BROKEN_MIN_INNER_DIST_PX    **可分辨性下界**：内线距 0 点 < 4px 的行一律不改
#                                （见下"为什么小值行必须放着不动"）
#   _BROKEN_OUTER_CLEARANCE_PX   外线该在的位置必须真的空出 4px 以上余量，否则不改
#
# 宽中位数的基准：优先取**有外线的行**（两段行）的内线宽；整列都没有外线时退化为
# 全列首段宽度。后者对应"这一列的外线整条断裂"——此时"外线缺失"在每一行都成立，
# 不能因为没有一行带外线就不补（合成图用例 2 钉的就是这个分支）。
#
# 为什么小值行必须放着不动（可分辨性下界）：值很小时内线距 0 点只有 1–3px，放大
# mult 倍后外线也只偏 5–15px，两条线在扫描件上常常被抗锯齿并成**一段**——此时"外线
# 断了"和"内外线贴在一起"在像素上不可分。把它当断线补偿等于把 1px 的小值乘成 5px，
# 比不补更错（这是判据唯一的错误方向，必须堵死）。所以内线距 < 4px 的行只登记进
# `ambiguous_rows`、不改读数：它们的读数由"最右墨迹"给出，外线在就仍然正确。
# 下界取 4 不是拍的：现场图上对这些候选行，把"外线应在位置"（0 点 + 5×内线距）逐行取样，
# 灰度 p10/p50/p90 = 255/255/255，**100% 是纯白**（Picea 229 行、Pinus 221、Betula 58、
# Quercus 484）—— 外线是真没画，不是浅到二值阈值 200 以下。所以"外线缺失"的判断成立，
# 补偿不是把噪声当信号。反过来说：判据一旦把下界抬到 5px，就会漏掉这些确实断线的行
# （实测 Picea 139 → 69）。
_INNER_RUN_START_TOL_PX = 5
_BROKEN_INNER_MAX_WIDTH_PX = 8
_INNER_WIDTH_MEDIAN_FACTOR = 1.5
_OUTER_DIST_SLACK_PX = 2.0
_BROKEN_MIN_INNER_DIST_PX = 4.0
_BROKEN_OUTER_CLEARANCE_PX = 4.0


def _ink_runs(row_pixels: np.ndarray) -> list[tuple[int, int]]:
    """一行墨迹的连续段 ``[(起点, 终点)]``（0 基偏移、含端点，按 x 升序）。"""
    offsets = np.flatnonzero(row_pixels)
    if not offsets.size:
        return []
    starts, ends = _run_bounds(offsets)
    return [(int(offsets[s]), int(offsets[e])) for s, e in zip(starts, ends)]


def normalize_reader_type(value: str | None) -> str:
    """把读取器类型归一化成 :data:`READER_TYPES` 里的规范名。

    未知值**直接报错**：静默退化到均值会让柱状图读数只有真值一半，
    而返回值里的 `reader_type` 仍回显用户传的名字（元数据说谎）。
    """
    key = str(value or "").strip().lower()
    key = _READER_ALIASES.get(key, key)
    if key not in READER_TYPES:
        raise JsonRpcError(
            INVALID_PARAMS,
            f"未知的读取方式 {value!r}：只支持 {' / '.join(READER_TYPES)}。",
        )
    return key


#: 局部改锚点时的行窗口半径。
#:
#: 依据（真实工程 `.recon_20261117`）：1521 个逐行点 / 436 个自动拐点，锚点平均间隔
#: 约 3.5 行。25 行 ≈ 7 个锚点间隔，窗口内的锚点密度足以让重算曲线在窗口边缘收敛回
#: 原墨迹；再放大就等于又换掉了整列形状（原缺陷 max|Δx| = 47px 的来源）。
_ANCHOR_PATCH_WINDOW_ROWS = 25


def _merge_row_windows(
    rows: list[int] | tuple[int, ...],
    y0: int | None = None,
    y1: int | None = None,
    radius: int = _ANCHOR_PATCH_WINDOW_ROWS,
) -> list[tuple[int, int]]:
    """把「改动过的锚点行」扩成 ±radius 的行窗口，裁剪到 ``[y0, y1]`` 后合并区间。

    端点保护就是这里的裁剪：改首/末锚点时窗口只能向内，不越出取数区。
    相邻或重叠的窗口合并成一段，避免同一段行被重写两次。
    """
    windows: list[tuple[int, int]] = []
    for row in rows:
        start = int(row) - radius
        end = int(row) + radius
        if y0 is not None:
            start = max(start, int(y0))
        if y1 is not None:
            end = min(end, int(y1))
        if start <= end:
            windows.append((start, end))
    windows.sort()
    merged: list[tuple[int, int]] = []
    for start, end in windows:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


# The column-curve membership rule (connected-component identity + size) lives in
# ``straditize_core.digitize`` together with its measured rationale, so that this
# path and the batch ``trace_area_profile`` reader cannot drift apart.


class DigitizeSessionMixin:
    """Digitization of curves/bars and manual/automatic control point manipulations."""

    def _manual_store(self) -> dict[int, dict[int, dict[str, Any]]]:
        """手工控制点的存储：`col_index -> row -> {"x", "kind"}`。

        `control_points[c]` 只有"行 → x"，没有"这个点是谁给的"。用户手工补/改的点
        是他唯一无法重做的劳动，必须跨 保存 → 载入 → 重分列 存活，所以另立一张表，
        而不是把 `control_points` 的值类型改成字典（那是 20+ 处读点的公共结构）。
        缺失时惰性建立，行为与"没有手工点"完全一致。
        """
        store = getattr(self, "manual_points", None)
        if not isinstance(store, dict):
            store = {}
            self.manual_points = store
        return store

    def digitize(
        self,
        col_index: int,
        reader_type: str | None = None,
        mode: str | None = None,
        method: str | None = None,
    ) -> dict[str, Any]:
        """Digitizes curve or bars in the specified column to extract data points."""
        if method is not None:
            reader_type = method
        elif mode is not None:
            reader_type = mode
        if reader_type is not None:
            reader_type = normalize_reader_type(reader_type)
        if not getattr(self, "columns", None):
            raise JsonRpcError(
                STATE_ERROR,
                "No columns detected. Please call core.detectColumns first.",
            )

        columns = self.columns
        if col_index < 0 or col_index >= len(columns):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"col_index {col_index} out of range (0 to {len(columns) - 1})",
            )

        col = columns[col_index]
        if reader_type is None:
            reader_type = normalize_reader_type(col.get("reader_type") or "area")
        col_roi_id = col.get("roi_id")
        c_start, c_end, y0, y1 = self._digitize_column_window(
            col, col_roi_id, col_index
        )

        if getattr(self, "foreground_mask", None) is None:
            if getattr(self, "image", None) is not None:
                self._extract_foreground_from_settings()
            else:
                raise JsonRpcError(STATE_ERROR, "No foreground mask or image loaded.")

        mask = self._extraction_mask(roi_id=col_roi_id)
        if mask is None:
            raise JsonRpcError(STATE_ERROR, "No foreground mask or image loaded.")

        self._refuse_if_column_ink_was_erased(
            mask, col, c_start, c_end, y0, y1, col_index
        )

        if reader_type == "area_exaggerated":
            group = _resolve_column_group(self, col)
            zero_stroke = resolve_axis_stroke(col, group)
            zero_x = float(c_start + zero_stroke)
            points = self._read_exaggerated_profile(
                mask, c_start, c_end, y0, y1, zero_x, col
            )
            broken_rows, ambiguous_rows = [], []
        else:
            points = self._read_column_profile(
                mask, c_start, c_end, y0, y1, reader_type
            )
            if points:
                broken_rows, ambiguous_rows = self._compensate_broken_inner_rows(
                    mask, col, c_start, c_end, points, col_index
                )
            else:
                broken_rows, ambiguous_rows = [], []

        unreadable_rows: list[int] = []
        if reader_type == "area_exaggerated":
            emitted = {int(p["row"]) for p in points}
            unreadable_rows = [
                row
                for row in range(y0, min(y1, self.height - 1) + 1)
                if row not in emitted
            ]

        if not points:
            return {
                "col_index": col_index,
                "reader_type": reader_type,
                "points": [],
                "control_points_count": 0,
                "broken_rows": broken_rows,
                "ambiguous_rows": ambiguous_rows,
                "unreadable_rows": unreadable_rows,
            }

        self._interpolate_across_hlines(points, c_start)

        control_points, ctrl_pts_list = self._turning_control_points(
            points,
            c_start,
            y0,
            y1,
            col_index,
            float(c_end - c_start),
            resolve_axis_stroke(col, None),
        )

        # 重建只产出**算法**拐点；用户手工点原样并入（不删、不移动）。
        # 没有这一步，重分列/重识别会把手工点整体覆盖掉（2026-11-10 用户缺陷：
        # 重跑检测分列后 type 33→34、Chenopodiaceae 40→42，人工补的点全部消失）。
        manual = self._manual_store().get(col_index, {})
        for m_row, rec in manual.items():
            control_points[int(m_row)] = float(rec["x"])
        if manual:
            ctrl_pts_list = [
                {
                    "id": f"pt_{col_index}_{row_int}",
                    "x": float(x_val),
                    "y": float(row_int),
                    "type": str(manual.get(row_int, {}).get("kind") or "peak"),
                    "isManual": row_int in manual,
                }
                for row_int, x_val in sorted(control_points.items())
            ]

        self.column_points[col_index] = points
        self.control_points[col_index] = control_points
        self.reader_types[col_index] = reader_type

        return {
            "col_index": col_index,
            "reader_type": reader_type,
            "points": points,
            "control_points": ctrl_pts_list,
            "control_points_count": len(control_points),
            "broken_rows": broken_rows,
            "ambiguous_rows": ambiguous_rows,
            "unreadable_rows": unreadable_rows,
        }

    def _read_exaggerated_profile(
        self,
        mask: np.ndarray,
        c_start: int,
        c_end: int,
        y0: int,
        y1: int,
        zero_x: float,
        col_dict: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """`area_exaggerated`：五态双轨互补读取器（高精度外线取数 + 防削边回退内线 + 残差自校准）。"""
        points: list[dict[str, Any]] = []
        band = mask[y0 : y1 + 1, c_start:c_end]
        if band.size == 0:
            return points
        band_axis_offsets = _axis_ink_offsets(band)
        origin = float(c_start) + _EXAG_RATIO_ORIGIN_OFFSET_PX

        # 第一遍扫描：逐行分类与残差样本收集
        rows: list[tuple[int, str, dict[str, float]]] = []
        residual_samples: list[float] = []

        for row_y in range(y0, y1 + 1):
            if row_y >= self.height:
                break
            local_y = row_y - y0
            if local_y < 0 or local_y >= band.shape[0]:
                break
            fg_indices = np.where(band[local_y])[0]
            data_indices = _without_axis_ink(fg_indices, band_axis_offsets)
            if not len(data_indices):
                data_indices = fg_indices
            if not len(data_indices):
                rows.append((row_y, "empty", {}))
                continue
            starts, ends = _run_bounds(data_indices)
            spans = [
                (int(data_indices[si]), int(data_indices[ei]))
                for si, ei in zip(starts, ends)
            ]
            anchored = [span for span in spans if span[0] <= _EXAG_INNER_ANCHOR_TOL_PX]
            if not anchored:
                rows.append((row_y, "undet", {}))
                continue
            inner_start, inner_end = max(anchored, key=lambda span: span[1])
            inner_span = float(inner_end - inner_start + 1)
            outer_spans = [
                span for span in spans if span[0] > inner_end + _EXAG_OUTER_MIN_GAP_PX
            ]
            sep_payload: dict[str, float] | None = None
            if outer_spans:
                outer_span = max(outer_spans, key=lambda s: s[1])
                outer_center = (outer_span[0] + outer_span[1]) / 2.0
                outer_end = outer_span[1]
                inner_px = c_start + inner_end
                outer_px = c_start + outer_end
                outer_center_px = c_start + outer_center
                distance_in = inner_px - origin
                distance_out = outer_center_px - origin
                ratio = distance_out / distance_in if distance_in > 0 else None
                if (
                    inner_span >= _EXAG_INNER_MIN_WIDTH_PX
                    and ratio is not None
                    and _EXAG_SEP_RATIO_RANGE[0] <= ratio <= _EXAG_SEP_RATIO_RANGE[1]
                ):
                    is_clipped = bool(outer_px >= c_end - _EXAG_OUTER_EDGE_MARGIN_PX)
                    sep_payload = {
                        "inner_px": float(inner_px),
                        "inner_span": inner_span,
                        "outer_extent": float(outer_px - origin),
                        "outer_center_extent": float(outer_center_px - origin),
                        "ratio": float(ratio),
                        "is_clipped": 1.0 if is_clipped else 0.0,
                    }
                    if not is_clipped:
                        residual_samples.append(distance_in - distance_out / ratio)

            if sep_payload is not None:
                rows.append((row_y, "sep", sep_payload))
                continue

            rows.append(
                (
                    row_y,
                    "single",
                    {
                        "end": float(c_start + inner_end),
                        "span": inner_span,
                        "extent": float(c_start + inner_end - origin),
                    },
                )
            )

        # 全局动态残差中位数 Δb（消除接缝阶跃）
        delta_b = float(np.median(residual_samples)) if residual_samples else 0.0

        # 第二遍：基于邻域统计量产出精准读数
        sep_rows = [(row_y, payload) for row_y, kind, payload in rows if kind == "sep"]

        for row_y, kind, payload in rows:
            flags: list[str] = []
            if kind == "empty":
                points.append(
                    {"row": row_y, "x": float(zero_x), "y": float(row_y), "source": "read"}
                )
                continue
            if kind == "undet":
                continue
            if kind == "sep":
                if not (
                    _EXAG_SELFCHECK_RANGE[0]
                    <= payload["ratio"]
                    <= _EXAG_SELFCHECK_RANGE[1]
                ):
                    flags.append("outer_inconsistent")

                # 若外线撞列边界削边，安全回退到内线 - Δb；未撞边时优先取外线高精度除以倍率
                if payload.get("is_clipped", 0.0) > 0.5:
                    feat_x = float(payload["inner_px"] - delta_b)
                    source_tag = "fallback_inner_clipped"
                else:
                    feat_x = float(origin + payload["outer_center_extent"] / payload["ratio"])
                    source_tag = "outer_scaled"

                points.append(
                    {
                        "row": row_y,
                        "x": feat_x,
                        "y": float(row_y),
                        "source": "read",
                        **({"flags": flags} if flags else {}),
                    }
                )
                continue

            # kind == "single"
            neighbours = [
                payload_sep
                for row_sep, payload_sep in sep_rows
                if abs(row_sep - row_y) <= _EXAG_NEIGHBOUR_ROWS
            ]
            if not neighbours:
                continue
            inner_p75 = float(np.percentile([p["inner_span"] for p in neighbours], 75))
            outer_p25 = float(np.percentile([p["outer_extent"] for p in neighbours], 25))
            if payload["span"] <= inner_p75:
                # broken：外线断行，取内线
                feat_x = float(payload["end"] - delta_b)
                if feat_x <= zero_x:
                    feat_x = float(zero_x)
                points.append(
                    {"row": row_y, "x": feat_x, "y": float(row_y), "source": "read"}
                )
                continue
            if payload["extent"] >= outer_p25:
                # glue：内外线粘连，反算
                k_local = float(np.median([p["ratio"] for p in neighbours]))
                if k_local <= 0:
                    continue
                points.append(
                    {
                        "row": row_y,
                        "x": float(origin + (payload["extent"] - delta_b) / k_local),
                        "y": float(row_y),
                        "source": "derived_from_outer",
                    }
                )
                continue

        return points

    # ---- digitize 的分段实现 ----

    def _digitize_column_window(
        self,
        col: dict[str, Any],
        col_roi_id: str | None,
        col_index: int,
    ) -> tuple[int, int, int, int]:
        """确定该列的取样窗口（x 起止去右边界 1px、y 用 ROI 或 data 范围），并挡掉整列落在 ROI 外。"""
        roi = self._roi_box(roi_id=col_roi_id)
        c_start = round(col.get("start", col.get("startX", 0)))
        c_end = round(col.get("end", col.get("endX", 100)))
        # 排除列右边界那一个像素：它通常是**下一列的 Y 轴基线**或本列边框，
        # 不是本列数据。
        #
        # 实测证据（Aber Empetrum，col10 [331,362)）：
        #   y=180 这一行全列只有三个墨点 x=330(左基线) / 361 / 362(下一列基线)。
        #   数字化取"最右墨迹"时，361 被读成 (361-331)/31 = 96.8% → 满值 34.4%，
        #   而真值该行是 0%。整列 R² 因此从 0.991 崩到 0.115。
        #   收缩 1px 后该行只剩左侧墨迹，读数正确，全图 Mean R² 0.8959 → 0.9834。
        #
        # 这条与零点位置无关：`detect_column_bounds` 的 end 本就是"下一列起点"，
        # 天然包含邻列基线的第一个像素。只有排除它，量程才是本列自己的。
        if c_end - c_start > 2:
            c_end -= 1
        if roi is not None:
            y0 = round(roi[1])
            y1 = round(roi[3])
        else:
            y0 = round(self.data_ylim[0])
            y1 = round(self.data_ylim[1])

        # A column lying entirely outside the ROI cannot yield data
        if roi is not None and not (c_end > round(roi[0]) and c_start < round(roi[2])):
            name = col.get("species") or col.get("name") or f"col{col_index + 1:02d}"
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Column '{name}' (x {c_start}..{c_end}) lies entirely outside the data "
                f"ROI (x {round(roi[0])}..{round(roi[2])}). Widen the ROI or move the column; "
                "no data was produced.",
            )
        return c_start, c_end, y0, y1

    def _refuse_if_column_ink_was_erased(
        self,
        mask: np.ndarray,
        col: dict[str, Any],
        c_start: int,
        c_end: int,
        y0: int,
        y1: int,
        col_index: int,
    ) -> None:
        """整列墨迹被清理擦光时拒绝取数 —— 返回全 0 就是编造读数。

        ## 为什么必须拒绝而不是报警

        `_read_column_profile` 对"该行没有墨迹"的处理是 ``feat_x = float(c_start)``
        （见那里的 ``else`` 分支）。因此一列墨迹被擦光后，`digitize` 仍然返回
        ``y1-y0+1`` 个点、每个点的 x 都等于列左缘 —— 换算成读数就是**整列 0**，
        与"这一列真的是 0"在返回结构上完全一致。这是"没有测量值"被伪装成
        "测量值为 0"，直接违反 `docs/ARCHITECTURE.md` §2
        （取不到就报错并停在原地，绝不返回替代数据）。报警不够：调用方
        （导出、批量取数、前端）都只读 `points`，没人会去读 `warnings`。

        ## 判据：raw 有墨、kept 无墨

        两个计数取**同一个窗口**：

        * ``raw``  = `foreground_mask`，原图墨迹，未扣任何清理；
        * ``kept`` = `_extraction_mask()`，实际喂给读取器的墨迹。

        ``raw > 0 and kept == 0`` 就是"这一列的数据被擦光了"，判据没有可调参数：
        它不是"读数偏小"，而是**一个像素都不剩**。

        ## 刻意不做的两件事

        * **不按"读数全 0"拒**：某一层没有花粉是合法读数，`_read_column_profile`
          对空行返回基线正是为此；按"全 0"拒会把正常的空层当缺陷。
        * **不按去掉比例拒**：部分擦除（一条干扰线、一小块污点）是步骤 4 的正常
          用法。这种情况由 `cleanup` 的 `_axis_erasure_warnings` 在"轴线被覆盖
          ≥50% 高度"时报警，两条判据分工明确：**数据还在就报警，数据不在就拒绝**。
        """
        raw = getattr(self, "foreground_mask", None)
        if raw is None or mask is None:
            return
        rows = slice(max(0, int(y0)), min(int(raw.shape[0]), int(y1) + 1))
        if rows.stop <= rows.start:
            return
        raw_count = int(raw[rows, c_start:c_end].sum())
        if raw_count == 0:
            return
        kept_count = int(mask[rows, c_start:c_end].sum())
        if kept_count > 0:
            return

        name = col.get("species") or col.get("name") or f"col{col_index + 1:02d}"
        raise JsonRpcError(
            STATE_ERROR,
            f"列 '{name}'（x {c_start}..{c_end}）的 {raw_count} 个墨迹像素被步骤 4 的"
            "编辑整列删掉了，本行一个像素都不剩 —— 这里没有测量值可取，因此不产出读数。"
            "如果照常返回，整列会变成 0，而那只是'没有数据'被写成了'数值为 0'。"
            "请检查：① 是否有排除区盖住了整列；② 是否把这一列的轴线当干扰线确认删除了；"
            "③ 去网格线强度是否过高。修好后重跑该列取数；确实要按 0 处理，"
            "请手工录入而不要求自动取数。",
        )

    def _read_column_profile(
        self,
        mask: np.ndarray,
        c_start: int,
        c_end: int,
        y0: int,
        y1: int,
        reader_type: str,
    ) -> list[dict[str, float]]:
        """逐行把墨迹变成特征 x：area 读本列墨迹右缘、line 读曲线中心或填充顶边、bar 读柱子右缘。"""
        points: list[dict[str, float]] = []

        # The column's own curve is identified by connected-component size; the
        # labelling is built once for the whole band rather than per row.
        # ROI 的下边界行**不属于被检视的层位**（用户 2026-11-18 拍板）：那一行是
        # 图框/轴齿所在，`_roi_mask` 按 `[y0, y1)` 右开区间给掩膜，若这里仍读到
        # `y1` 就拿到一整行 False —— 逐行逻辑退化成 `feat_x = c_start`，整列底部凭空
        # 多出一个"读数落在列左缘"的点（issue #60：读数回落列左缘、整列锚点同步报
        # 「读数不能为负」）。所以扫描范围与掩膜同口径，一律 `[y0, y1)`。
        band = mask[y0:y1, c_start:c_end]
        band_labels, band_label_areas = _band_components(band)
        # 面板自身的 Y 轴线不是数据（benchmark P-02）：曲线画法下它与曲线不相连，
        # 且是整个 band 里最大的分量（Empetrum 1303/1606 px、贯穿 481/482 行），
        # 不排除就会让整列读数压在轴上（该列 13/48 层读成 0，占其绝对误差 82%）。
        band_axis_offsets = _axis_ink_offsets(band)
        # `line` 读取器要先判画法：填充型剖面读填充顶边，细线画读墨迹中心。
        # 判定按整列做一次（见 `_band_is_filled`），不逐行翻转。
        band_is_filled = (
            _band_is_filled(band, band_axis_offsets) if reader_type == "line" else False
        )

        for row_y in range(y0, y1):
            if row_y >= self.height:
                break
            row_pixels = mask[row_y, c_start:c_end]
            fg_indices = np.where(row_pixels)[0]
            # 本行除轴线以外的墨迹（= 数据）。若整行只有轴线（曲线/填充值≈0），
            # 就不再剔除：那几列此时是数据本身，剔除会把 2px 的读数抹成 0
            # （填空型图实测因此多出 0.008 的全表 MAE）。
            data_indices = _without_axis_ink(fg_indices, band_axis_offsets)
            if not len(data_indices):
                data_indices = fg_indices

            if len(fg_indices) > 0:
                if reader_type in ("line", "area"):
                    # 本行在整块 label 图里的行号（区域外则退化为全 0 = 无分量）。
                    local_y = row_y - y0
                    if 0 <= local_y < band_labels.shape[0]:
                        row_labels = band_labels[local_y]
                    else:
                        row_labels = np.zeros(c_end - c_start, dtype=int)
                    if reader_type == "area":
                        feat_x = float(
                            c_start
                            + _own_run_last_offset(
                                data_indices,
                                row_labels,
                                band_label_areas,
                            )
                        )
                    else:
                        # `line` 读取器：填充型剖面下"曲线"是填充的**顶边**，不是柱内
                        # 均值。均值落在填充中点，读数恒为真值一半（benchmark D-08：
                        # Diatom 填充剖面 P03 7.11 vs area 14.21、P09 8.42 vs 16.84、
                        # P22 3.16 vs 6.32，比值精确 0.500）。判据与实现见
                        # `straditize_core.digitize._line_own_offset`（单一事实源）。
                        feat_x = float(
                            c_start
                            + _line_own_offset(
                                data_indices,
                                row_labels,
                                band_label_areas,
                                filled=band_is_filled,
                            )
                        )
                elif reader_type == "bar":
                    # 柱状 / 条带画法：读**柱子右缘**（该行最右墨迹），不是柱内均值。
                    # 均值落在柱体中心，读数系统性只有真值一半：benchmark 实测
                    # Betula@430cm 真值 73.91 → bar 36.44（全表 MAE 3.087 vs area 1.312）。
                    # 单数 `bar` 是底层 `digitize_column` 的写法，复数 `bars` 是历史别名，
                    # 两层契约曾因此错位：`bar` 静默落到 else 走 mean（issue P-04）。
                    feat_x = float(c_start + np.max(fg_indices))
                else:  # pragma: no cover - normalize_reader_type 已排除其余取值
                    raise JsonRpcError(
                        INVALID_PARAMS, f"未实现的读取方式 {reader_type!r}"
                    )
            else:
                feat_x = float(c_start)

            points.append({"row": row_y, "x": feat_x, "y": float(row_y)})
        return points

    def _compensate_broken_inner_rows(
        self,
        mask: np.ndarray,
        col: dict[str, Any],
        c_start: int,
        c_end: int,
        points: list[dict[str, float]],
        col_index: int,
    ) -> tuple[list[int], list[int]]:
        """把"外线断开"的行从内线补回外线位置，返回 `(broken_rows, ambiguous_rows)`。

        ## 物理事实（recon-20261117，用户已确认，此处不复述论证）

        这批列把同一组数据画了两层：贴轴的填充/曲线（**内线** = 真值）与外侧放大曲线
        （**外线** = 真值 × `exaggeration_mult`）。取数口径是"本行最右墨迹"，正常行读到
        外线，`px_to_value` 再除以倍率得真值。外线在部分行**断开**，这些行的最右墨迹退化
        成内线，除倍率后只有真值的 1/mult —— 图上因此出现并不存在的低谷。

        ## 修法（用户拍板）：内线 × 倍率

        行级特例只能改 x：`x ← z0 + (x_in − z0) × mult`，于是
        `(x − z0) × slope / mult ≡ (x_in − z0) × slope`，恒等于"这一行不除倍率"，与换算
        侧零耦合。`z0` 必须与 `px_to_value` 用同一个 0 点（`scale.abs_px0`）；换成别的 0 点
        会让两种口径差一个轴粗、再被乘 mult。

        补 x 发生在 `_interpolate_across_hlines` **之前**：横线行的插值因此发生在"已折算成
        同一物理量"的空间里（断线行的 `z0 + mult·d` 与正常行的外线位置本就重合），
        若在插值之后再补，横线行会把内线与外线混在一起平均。

        ## 判据与常量

        逐行取列窗内的连续墨迹段，**三条同时成立**才判 broken：

        1. **只有一段**——有外线的行一定有第二段（外线与填充之间隔着空白）；
        2. 该段**贴轴**（起点 ≤ `c_start + _INNER_RUN_START_TOL_PX`）→ 它是内线，
           右缘记 `x_in`；
        3. 段宽 ≤ `_INNER_WIDTH_MEDIAN_FACTOR` × 同列"两段行"的内线宽中位数，且
           `x_in − z0 ≤ 中位(外线距/内线距) × (x_in − z0) + _OUTER_DIST_SLACK_PX`。

        兜底判据：只有一段且段宽 `< _BROKEN_INNER_MAX_WIDTH_PX` 也算候选。它与上面三条
        在本图量级下等价——内线 = 轴线（≤5px）+ 贴轴曲线（1–2px）恒 < 8px；而"内外线相接"
        造成的单段实测 ≥ 19px，永远落不进 8px。误判方向：**厚轴图（轴粗 ≥ 8px）会漏判**
        （读数偏小 1/mult，与现状相同），不会反向误补。

        候选行还要过**可分辨性**这一关，否则不改：

        * `内线距 < _BROKEN_MIN_INNER_DIST_PX`（4px）→ 判不出。值这么小时内线只有 1–3px，
          放大后外线也只偏 5–15px，两条线被抗锯齿并成一段就分不清"外线断了"和
          "内外线贴在一起"，硬补等于把 1px 的小值乘成 5px；
        * `外线该在的位置 − 本行墨迹右缘 < _BROKEN_OUTER_CLEARANCE_PX`（4px）→ 本行墨迹
          已经压在外线位置上，没有"缺失"可言。

        这两关拒掉的行进 `ambiguous_rows`（不补偿，`source="ambiguous"`）；另有"内线小到
        判不出"的非候选行（外线在、只是贴得近）也进 `ambiguous_rows`，但读数不动、
        `source` 仍是 `"read"` —— 该列表回答的是"这一行有没有判别力"，不是"改了什么"。

        倍率取 `resolve_column_scale(...).exaggeration_mult`——唯一解析入口（列级 > 组级 >
        历史键，`<=1` 视为未放大），且它正是 `px_to_value` 要除的那个数；两处取同一个值，
        补偿与除法才会精确抵消。解析不到或 ≤1 时整条逻辑不启动：没有倍率就没有"两层"，
        硬补会把普通单层列的读数放大 mult 倍。此时也**不写 `source` 字段**——普通列的点
        字典必须与改动前逐字节相同（`tests/unit/test_digitize_golden.py` 钉着 x 序列）。

        ## 顺带落库：内线 / 外线右缘（issue #99）

        本方法本来就要量两条线各自的右缘（判"外线断开"必须知道内线右缘，判"外线在哪"
        要末段右缘），此前用完即弃。现在**同时看到两条线段**的行把这两个数写进点字典
        `inner_xs_px` / `outer_xs_px`（键名与写入口在 `layers.py`，唯一一处定义），
        供 `FLAG_EXAGG_RATIO` 逐行算 `(outer−z0)/(inner−z0)`。

        - **哪些列**：`exaggeration_mult > 1` 的列（上面的早退决定了这一点：没有倍率
          就不进入本方法，一个键都不写，点字典与 #99 之前逐字节相同）。
        - **哪些行**：列窗内 ≥2 段连续墨迹、首段贴轴（起点 ≤ `c_start + 5px`）、
          且末段右缘严格在首段右缘外侧的行。
        - **哪些行不写**：① 外线整行断裂的行——它只有内线一段，没有外线可测，`x` 由
          "内线 × 倍率"补出，那个位置是算出来的，拿它当外线读数算 ratio 恒等于倍率，
          属自证循环；② 内线不贴轴的行（首段离轴太远，分不清哪条是内线）。
        - **缺省不写键**：没有成对读数的行**不写这两个键**，绝不写 0 —— 0 会算出
          `ratio = 0`，把"没有读数"变成一条假告警。
        - **旧工程**：工程包存的是控制点，稠密点不入库，载入后重新数字化之前没有任何
          逐行读数；"点字典没有这两个键"因此是正常状态，`qa.py` 据此整列标 `skipped`。
        """
        scale = resolve_column_scale(self, col, col_index)
        mult = scale.exaggeration_mult
        if mult is None or mult <= 1.0:
            return [], []
        zero = float(scale.abs_px0)

        row_segments: list[tuple[dict[str, float], list[tuple[int, int]]]] = []
        for point in points:
            row_y = int(point["row"])
            if row_y < 0 or row_y >= mask.shape[0]:
                continue
            row_segments.append((point, _ink_runs(mask[row_y, c_start:c_end])))

        # 先量这一列的两层几何：内线宽中位数与"外线距/内线距"中位数。
        inner_widths: list[float] = []
        outer_ratios: list[float] = []
        for _point, segments in row_segments:
            if len(segments) < 2:
                continue
            run_start, run_end = segments[0]
            if run_start > _INNER_RUN_START_TOL_PX:
                continue
            inner_dist = (c_start + run_end) - zero
            outer_dist = (c_start + segments[-1][1]) - zero
            inner_widths.append(float(run_end - run_start + 1))
            if inner_dist > 0 and outer_dist > inner_dist:
                outer_ratios.append(outer_dist / inner_dist)
        median_outer_ratio: float | None = (
            float(np.median(outer_ratios)) if outer_ratios else None
        )
        if not inner_widths:
            # 整列看不到外线：宽基准退化为全列首段宽度（见常量处的说明）。
            inner_widths = [
                float(segments[0][1] - segments[0][0] + 1)
                for _point, segments in row_segments
                if segments and segments[0][0] <= _INNER_RUN_START_TOL_PX
            ]
        if not inner_widths:
            return [], []
        median_inner_width = float(np.median(inner_widths))

        broken_rows: list[int] = []
        ambiguous_rows: list[int] = []
        for point, segments in row_segments:
            row_int = int(point["row"])
            # 内线距：本行最左侧那段（贴轴的那段）的右缘到 0 点的距离。
            inner_dist: float | None = None
            if segments and segments[0][0] <= _INNER_RUN_START_TOL_PX:
                inner_dist = (c_start + segments[0][1]) - zero
            candidate = len(segments) == 1 and inner_dist is not None and inner_dist > 0
            if candidate:
                run_end = segments[0][1]
                width = float(run_end - segments[0][0] + 1)
                narrow_enough = width <= _INNER_WIDTH_MEDIAN_FACTOR * median_inner_width
                # 比值判据：整列没有一行带外线时无基准可比，按"成立"处理（此时每一行都
                # 只有内线，"外线缺失"没有反例可反驳）。
                inside_envelope = median_outer_ratio is None or (
                    inner_dist <= median_outer_ratio * inner_dist + _OUTER_DIST_SLACK_PX
                )
                # 单段太窄就是"只剩内线"：宽 < 8px 的兜底判据（见 docstring）。
                candidate = (narrow_enough and inside_envelope) or (
                    width < _BROKEN_INNER_MAX_WIDTH_PX
                )
            if candidate:
                # 可分辨性：内线太小 / 本行墨迹已经压到外线该在的位置 → 判不出，不改。
                # 后一条对单段行恒等于 (mult−1)×inner_dist，所以起作用的是前一条；
                # 留着它是为了让"外线位置必须真的空着"这条前提在代码里显式成立。
                outer_position = zero + inner_dist * mult
                clearance = outer_position - float(c_start + segments[0][1])
                if (
                    inner_dist < _BROKEN_MIN_INNER_DIST_PX
                    or clearance < _BROKEN_OUTER_CLEARANCE_PX
                ):
                    point["source"] = "ambiguous"
                    ambiguous_rows.append(row_int)
                    continue
                # 内线 × 倍率 = 外线该在的位置；px_to_value 再除以同一个倍率 → 等于不除。
                point["x"] = float(outer_position)
                point["source"] = "broken_inner"
                broken_rows.append(row_int)
                continue
            # 非候选行读数不动；内线小到判不出的行只登记，供下游知道"这一行没有判别力"。
            point["source"] = "read"
            if inner_dist is not None and 0 < inner_dist < _BROKEN_MIN_INNER_DIST_PX:
                ambiguous_rows.append(row_int)
            # 双层读数落库（issue #99）：这一行墨迹里**两条线都在**——首段贴轴是内线，
            # 末段是外线，两个右缘各自独立可测，成对写进点字典。
            #
            # 只有两段及以上的行才写：断线行（只有内线一段）的"外线位置"是下面按
            # `zero + inner_dist × mult` 算出来的，拿它当外线读数去算 ratio 恒等于倍率，
            # 是自证循环。哪一列、哪些行会带这两个键，见 `layers.py` 的模块 docstring。
            if len(segments) >= 2 and inner_dist is not None and inner_dist > 0.0:
                inner_right = float(c_start + segments[0][1])
                outer_right = float(c_start + segments[-1][1])
                if outer_right > inner_right:
                    store_layer_pair(point, inner_x=inner_right, outer_x=outer_right)

        broken_rows.sort()
        ambiguous_rows.sort()
        return broken_rows, ambiguous_rows

    def _interpolate_across_hlines(
        self, points: list[dict[str, float]], c_start: int
    ) -> None:
        """跨横线插值：横线所在行会被读成 100% 尖峰，按相邻行线性补回来（就地改 points）。"""
        # Interpolate across pervasive horizontal grid lines to eliminate artificial 100% spikes
        if hasattr(self, "hline_rows") and self.hline_rows:
            raw_vals = np.array([p["x"] - c_start for p in points], dtype=float)
            rel_hlines = [hr for hr in self.hline_rows if 0 <= hr < len(raw_vals)]
            if rel_hlines:
                interp_vals = interpolate_hlines(raw_vals[:, np.newaxis], rel_hlines)[
                    :, 0
                ]
                for p_idx, new_v in enumerate(interp_vals):
                    points[p_idx]["x"] = float(c_start + new_v)

    def _zero_point_x(self, col_index: int) -> float | None:
        """该列的 0 点像素（列左缘 + 轴粗）。取不到返回 None。"""
        cols = getattr(self, "columns", None) or []
        if col_index < 0 or col_index >= len(cols):
            return None
        col = cols[col_index]
        c_start = float(col.get("startX", col.get("start", 0.0)) or 0.0)
        try:
            group = _resolve_column_group(self, col)
        except Exception:  # pragma: no cover - 组结构异常时退化为无轴粗
            group = None
        return c_start + float(resolve_axis_stroke(col, group))

    def _reject_below_zero_point(self, col_index: int, row: int, x: float) -> None:
        """手工点落在 0 点左侧时拒绝（不静默钳制：那是用户亲手放的点）。

        x == 0 点允许——丰度 0 是合法数据；只有严格小于 0 点才是负读数。
        """
        zero = self._zero_point_x(col_index)
        if zero is None:
            return
        if float(x) < zero - 1e-9:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"读数不能为负：该列 0 点在 x={zero:.6g}，"
                f"你给的点（row {row}, x={float(x):.6g}）在它左侧。",
            )

    def _turning_control_points(
        self,
        points: list[dict[str, float]],
        c_start: int,
        y0: int,
        y1: int,
        col_index: int,
        col_width: float,
        zero_offset: float = 0.0,
    ) -> tuple[dict[int, float], list[dict[str, Any]]]:
        """按垂直误差界抽拐点，再补首末两个端点控制点，返回 (行号→x 字典, 控制点列表)。

        判据是**垂直距离**（见 straditize_core.curve.detect_turning_points_vertical）：
        显著极值（凸点/凹点/肩部）作为强制锚点先保留，锚点之间再用垂直 RDP 加密到
        VERTICAL_TOLERANCE_PX 的误差界，因此"重构 vs 逐行轮廓"的 P95/max 误差
        有上界，而不是靠调阈值碰运气。

        三条旧启发式**已删除**，它们都只在"看不出错"的地方悄悄丢点：
        ① 只在锚点区间长度 > 6 行时才跑 RDP（短区间完全不复核）——实测列底
           172→5 的一行台阶因此被拉成 3 行斜坡，单点误差 110px；
        ② 丢弃 |v| <= baseline_px 的近基线点——台阶脚恰好落在基线附近；
        ③ max_points 上限裁剪。
        """
        control_points: dict[int, float] = {}
        # 0 点是轴线右缘（列左缘 + 轴粗）：控制点落在它左侧等于给出负读数，
        # 因此曲线宽度的下限取轴粗，而不是 0。
        min_width = max(0.0, float(zero_offset))
        curve_profile = np.clip(
            np.array([p["x"] - c_start for p in points], dtype=float), min_width, None
        )
        # 显著度随列宽缩放：绝对显著度在宽列上会把抗锯齿与基线抖动当作拐点。
        # 下限设为 2.5px：贴轴处 2.0px 的量化与抗锯齿抖动不作为 mandatory 极值，
        # 避免生成密集的贴轴伪拐点；垂直容差仍为绝对 2px，重构误差由误差界兜底。
        prominence_px = max(2.5, 0.005 * float(col_width))
        turning_rows, turning_vals, is_mandatory = detect_turning_points_vertical(
            curve_profile,
            epsilon=VERTICAL_TOLERANCE_PX,
            prominence=prominence_px,
            min_distance=3,
        )
        kept_rows, kept_vals = prune_axis_pileups(
            turning_rows, turning_vals, is_mandatory
        )
        # 兜底：去堆叠的两点并一点可能把误差顶起来，这里把超差行补回去。
        kept_rows, kept_vals = enforce_error_bound(
            np.arange(len(curve_profile), dtype=float),
            curve_profile,
            kept_rows,
            kept_vals,
        )

        removed_hl_bands = []
        for cand in getattr(self, "line_candidates", []):
            if cand.get("axis") == "h" and cand.get("status") == "removed":
                cy = int(round(float(cand.get("y", 0))))
                th = int(round(float(cand.get("thickness", 3))))
                removed_hl_bands.append((cy - th // 2 - 1, cy + th // 2 + 1))

        def _in_removed_hl(row_val: int) -> bool:
            return any(b0 <= row_val <= b1 for b0, b1 in removed_hl_bands)

        ctrl_pts_list: list[dict[str, Any]] = []
        for r_rel, v_rel in zip(kept_rows, kept_vals):
            r_int = int(y0 + r_rel)
            if _in_removed_hl(r_int):
                continue
            x_val = float(c_start + max(min_width, float(v_rel)))
            control_points[r_int] = x_val
            ctrl_pts_list.append(
                {
                    "id": f"pt_{col_index}_{r_int}",
                    "x": x_val,
                    "y": float(r_int),
                    "type": "peak" if v_rel > 1.0 else "trough",
                    "isManual": False,
                }
            )

        # Ensure endpoints exist。末端锚点落在**最后一行的实测点**上，不落在 `y1`：
        # `y1` 是 ROI 下边界，那一行属图框、不在行集里（见 `_read_column_profile`），
        # 拿它当锚点会在数据末行下方 1px 留一个拖得动却没有数据支撑的手柄。
        last_row = int(round(float(points[-1].get("row", points[-1]["y"]))))
        y0_x = float(c_start + max(min_width, points[0]["x"] - c_start))
        y1_x = float(c_start + max(min_width, points[-1]["x"] - c_start))

        # 仅在非空且真实有必要闭合时设置首末端点；
        # 若首行/末行本身就是无墨迹行（未探测到有效数据），严禁在空行强塞伪拐点拽回 0 轴（issue: 边缘多出一个点收到 0 处）！
        has_ink_0 = bool(points[0]["x"] > c_start + min_width)
        has_ink_1 = bool(points[-1]["x"] > c_start + min_width)

        if has_ink_0 or len(ctrl_pts_list) == 0:
            control_points[y0] = y0_x
            if not any(p["y"] == float(y0) for p in ctrl_pts_list):
                ctrl_pts_list.insert(
                    0,
                    {
                        "id": f"pt_{col_index}_{y0}",
                        "x": y0_x,
                        "y": float(y0),
                        "type": "trough" if y0_x <= c_start + min_width + 1.0 else "transition",
                        "isManual": False,
                    },
                )
        if has_ink_1 or len(ctrl_pts_list) == 0:
            control_points[last_row] = y1_x
            if not any(p["y"] == float(last_row) for p in ctrl_pts_list):
                ctrl_pts_list.append(
                    {
                        "id": f"pt_{col_index}_{last_row}",
                        "x": y1_x,
                        "y": float(last_row),
                        "type": "trough" if y1_x <= c_start + min_width + 1.0 else "transition",
                        "isManual": False,
                    },
                )

        ctrl_pts_list.sort(key=lambda p: p["y"])
        return control_points, ctrl_pts_list

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

        # 入口守卫：这两样都可能为空，缺了就直接 500（实测 `float() argument must be
        # a string or a real number, not 'NoneType'` 冒成 -32603，用户只会看到
        # "后端算法执行异常，请查看服务器控制台日志" —— 不可执行）。缺就说清缺什么。
        ylim = getattr(self, "data_ylim", None)
        if not ylim or len(ylim) < 2 or ylim[0] is None or ylim[1] is None:
            raise JsonRpcError(
                STATE_ERROR,
                "缺少可读数据范围（data_ylim 为空）：请先在步骤 2 确认有效区，再增删控制点。",
            )
        usable_xs = [
            p.get("x")
            for p in (self.column_points.get(col_index) or [])
            if p.get("x") is not None
        ]
        if not usable_xs:
            raise JsonRpcError(
                STATE_ERROR,
                "该列缺少可读点（点的 x 全为空）：请先重新数字化该列，再加控制点。",
            )

        ctrls = self.control_points.get(col_index, {})
        y0 = round(ylim[0])
        y1 = round(ylim[1])

        action = "updated"
        manual = dict(self._manual_store().get(col_index, {}))
        if remove:
            if ctrls:
                nearest_row = min(ctrls.keys(), key=lambda r: abs(r - row))
                if abs(nearest_row - row) <= max(15, (y1 - y0) // 10):
                    del ctrls[nearest_row]
                    manual.pop(nearest_row, None)
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
            self._reject_below_zero_point(col_index, int(row), float(x))
            ctrls[int(row)] = float(x)
            # 这里的每一次写都是用户在图上的显式编辑 → 记为手工点
            manual[int(row)] = {"x": float(x), "kind": "manual"}
            action = "updated"
        self._manual_store()[col_index] = manual

        # Ensure boundary anchor points exist。
        #
        # 末端锚点取 `y1 - 1`（最后一行的实测点），与 `_digitize_column` 写下的锚点集
        # 一致：`y1` 那一行属图框、不在行集里，若这里仍注 `y1`，每次同步都会被判成
        # "删掉 y1 那枚、加上 y1-1 那枚"，凭空多一个 ±25 行的窗口。
        # 除了这两个端点，不注入调用方没给的其它行 —— 本方法的契约是
        # "`points` 就是这一列现在全部锚点"，多补一枚会让"同一批锚点连发两次"退化成 rebuild。
        last_row = max(int(y0), int(y1) - 1)
        if y0 not in ctrls:
            ctrls[y0] = float(usable_xs[0])
        if last_row not in ctrls:
            ctrls[last_row] = float(usable_xs[-1])

        # 脏状态：`ctrls` 里可能有值为 None 的历史条目（例如组标度被清空后旧控制点残留）。
        # 直接喂给 PchipInterpolator 会抛 `float() argument must be ... not 'NoneType'`，
        # 被 handler 包成 -32603「后端算法执行异常」——用户完全无法执行。
        # 这里剔除脏值，并在剩余点不足时给可执行提示。
        dirty_rows = [r for r, v in list(ctrls.items()) if v is None]
        for r in dirty_rows:
            ctrls.pop(r, None)
        if len(ctrls) < 2:
            raise JsonRpcError(
                STATE_ERROR,
                "该列的控制点不足（剔除无效值后少于 2 个）：请重新数字化该列，或重新添加控制点。",
            )

        sorted_rows = sorted(ctrls.keys())
        sorted_x = [float(ctrls[r]) for r in sorted_rows]

        all_rows = np.arange(y0, last_row + 1)
        if len(sorted_rows) >= 3 and PchipInterpolator is not None:
            interpolator = PchipInterpolator(sorted_rows, sorted_x)
            interpolated_x = interpolator(all_rows)
        else:
            interpolated_x = np.interp(all_rows, sorted_rows, sorted_x)

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

    def _rebuild_column_points_from_anchors(
        self, c_idx: int, ctrls: dict[int, float]
    ) -> None:
        """锚点变了 -> 按锚点重建整列稠密曲线（画布与导出读同一份）。

        为什么不能只 pop 掉让下游重建：_ensure_export_column_points 只在
        column_points **整张表为空**时才补点，pop 掉一列不会触发重建 ——
        实测 pop 之后该列读出 0.0（被 clamp），链路断在这里。
        """
        rows = sorted(ctrls)
        if not rows:
            self.column_points.pop(c_idx, None)
            return
        span = list(range(int(rows[0]), int(rows[-1]) + 1))
        xs = np.interp(
            span,
            [float(row) for row in rows],
            [float(ctrls[row]) for row in rows],
        )
        self.column_points[c_idx] = [
            {"row": int(row), "x": float(x)} for row, x in zip(span, xs)
        ]
        self.control_point_columns = set(
            getattr(self, "control_point_columns", set()) or set()
        ) | {c_idx}

    def set_control_points(
        self, col_index: int | str, points: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """整列同步锚点：画布上一次编辑（拖动结束 / 删除 / 微调去抖）一次往返落库。

        `points` = [{"row": int, "x": float, "manual": bool}]，语义是「这一列现在就是这些
        锚点」——整列替换，不是增量。存在的理由：画布编辑一次可能同时改好几个锚点，
        走单点接口 `core.updateControlPoint` 要逐点往返。

        **只重写改动锚点的邻域**（`_ANCHOR_PATCH_WINDOW_ROWS` 行窗口）：
        用户拖的是一个手柄，改的却必须是整列形状 —— 旧实现按"436 个锚点的分段线性
        插值"整列重写，把 1521 行稠密轮廓换成插值折线（实测 mean|Δx| = 0.68px、
        max|Δx| = 47px，只有锚点所在行 Δ = 0），于是"一编辑就退回拐点"。
        现在窗口外的行**逐值保留**原 `column_points`（墨迹曲线），窗口内才按新锚点
        线性重算；窗口外的行若原本不存在，仍然不存在（不给没测过的行编数）。
        """
        c_idx = self._resolve_col_index(col_index)
        if c_idx not in self.column_points:
            raise JsonRpcError(
                STATE_ERROR,
                f"Column {c_idx} has not been digitized yet. Call core.digitize first.",
            )

        ctrls: dict[int, float] = {}
        manual = dict(self._manual_store().get(c_idx, {}))
        for point in points or []:
            row_raw = point.get("row", point.get("y"))
            x_raw = point.get("x")
            if row_raw is None or x_raw is None:
                raise JsonRpcError(
                    INVALID_PARAMS,
                    "控制点必须同时带 row 与 x：收到 " + repr(point),
                )
            row = int(round(float(row_raw)))
            self._reject_below_zero_point(c_idx, row, float(x_raw))
            ctrls[row] = float(x_raw)
            if point.get("manual", True):
                manual[row] = {"x": float(x_raw), "kind": "manual"}
            else:
                manual.pop(row, None)

        if not ctrls:
            raise JsonRpcError(
                INVALID_PARAMS,
                "控制点列表为空：至少要保留两个端点，否则这一列没有可插值的曲线。",
            )

        # 端点锚点与插值域：与单点接口同口径（本方法不再经 `update_control_point`，
        # 否则它会把整列重写成插值）。
        ylim = getattr(self, "data_ylim", None)
        if not ylim or len(ylim) < 2 or ylim[0] is None or ylim[1] is None:
            raise JsonRpcError(
                STATE_ERROR,
                "缺少可读数据范围（data_ylim 为空）：请先在步骤 2 确认有效区，再编辑控制点。",
            )
        usable_xs = [
            p.get("x")
            for p in (self.column_points.get(c_idx) or [])
            if p.get("x") is not None
        ]
        if not usable_xs:
            raise JsonRpcError(
                STATE_ERROR,
                "该列缺少可读点（点的 x 全为空）：请先重新数字化该列，再编辑控制点。",
            )
        y0, y1 = sorted((round(float(ylim[0])), round(float(ylim[1]))))
        # 末端锚点取 `y1 - 1`（最后一行的实测点），与 `_digitize_column` 写下的锚点集
        # 一致：`y1` 那一行属图框、不在行集里（见 `_read_column_profile`）。若这里仍注
        # `y1`，每一次同步都会被判成"删掉 y1 那枚、加上 y1-1 那枚"，凭空多一个窗口，
        # 而且 `_rebuild_column_points_from_anchors` 会顺着它把行集撑回 y1。
        last_row = max(int(y0), int(y1) - 1)
        if y0 not in ctrls:
            ctrls[y0] = float(usable_xs[0])
        if last_row not in ctrls:
            ctrls[last_row] = float(usable_xs[-1])
        # 历史脏值：值为 None 的锚点喂给插值会抛 float() 型错误 → 直接剔除。
        for dirty_row in [r for r, v in list(ctrls.items()) if v is None]:
            ctrls.pop(dirty_row, None)
        if len(ctrls) < 2:
            raise JsonRpcError(
                STATE_ERROR,
                "该列的控制点不足（剔除无效值后少于 2 个）：请重新数字化该列，或重新添加控制点。",
            )

        old_ctrls = {
            int(r): float(v)
            for r, v in (self.control_points.get(c_idx) or {}).items()
            if v is not None
        }
        changed_rows = sorted(
            row
            for row in set(old_ctrls) | set(ctrls)
            if row not in old_ctrls
            or row not in ctrls
            or float(ctrls[row]) != old_ctrls[row]
        )

        # 幂等：同一批锚点连发（前端微调去抖后重发、双击触发两次 commit）不重写任何行，
        # 也不推一条空的撤销项 —— 用户没改动，撤销栈就不该多一格。
        if not changed_rows:
            self.control_points[c_idx] = ctrls
            self._manual_store()[c_idx] = manual
            return {
                "col_index": c_idx,
                "action": "unchanged",
                "unchanged": True,
                "patched_rows": [],
                "control_points_count": len(ctrls),
                "points": self.column_points.get(c_idx) or [],
            }

        self._record_history("Sync control points")
        self.control_points[c_idx] = ctrls
        self._manual_store()[c_idx] = manual

        # 只重写改动锚点的邻域；窗口外逐值保留原墨迹曲线。
        anchor_rows = np.array(sorted(ctrls), dtype=float)
        anchor_xs = np.array([float(ctrls[int(r)]) for r in sorted(ctrls)], dtype=float)
        original = {
            int(p["row"]): p
            for p in (self.column_points.get(c_idx) or [])
            if p.get("row") is not None
        }
        patched_x = {
            int(row): float(point["x"])
            for row, point in original.items()
            if point.get("x") is not None
        }
        # 窗口再收缩到「原本就有点的行」：局部重写只覆盖实测过的行，
        # 不给这一列从没数字化过的行编数（取数窗口比实测行宽时才会遇到）。
        patch_low = max(y0, min(original)) if original else y0
        # 上界收到 `y1 - 1`：`y1` 那一行属图框、不在行集里，窗口覆盖它只会
        # 给一个没有实测点的行编数（见 `_read_column_profile`）。
        patch_high = min(last_row, max(original)) if original else last_row
        patched_rows = _merge_row_windows(changed_rows, patch_low, patch_high)
        for start, end in patched_rows:
            rows = np.arange(start, end + 1)
            xs = np.interp(rows, anchor_rows, anchor_xs)
            for row_val, x_val in zip(rows, xs):
                patched_x[int(row_val)] = float(x_val)

        rebuilt = []
        for row in sorted(patched_x):
            entry = dict(original.get(row) or {})
            entry["row"] = int(row)
            entry["x"] = float(patched_x[row])
            rebuilt.append(entry)
        self.column_points[c_idx] = rebuilt

        return {
            "col_index": c_idx,
            "action": "patched",
            "unchanged": False,
            "patched_rows": [[start, end] for start, end in patched_rows],
            "control_points_count": len(ctrls),
            "points": rebuilt,
        }

    def point_add(
        self,
        col_index: int | str,
        y: float,
        x: float,
        kind: str = "peak",
    ) -> dict[str, Any]:
        """Adds or updates a control point in a column."""
        self._record_history("Add point")
        c_idx = self._resolve_col_index(col_index)
        y_int = round(y)
        if c_idx not in self.control_points:
            self.control_points[c_idx] = {}
        self.control_points[c_idx][y_int] = float(x)
        # 锚点变了 → 稠密曲线按新锚点重建（画布与导出同源）。
        self._rebuild_column_points_from_anchors(c_idx, self.control_points[c_idx])
        # 走 `point.add` 的每一次加/改都是用户在图上的显式动作 → 手工点
        self._manual_store().setdefault(c_idx, {})[y_int] = {
            "x": float(x),
            "kind": str(kind or "manual"),
        }
        return {
            "success": True,
            "col_index": c_idx,
            "y": y_int,
            "x": float(x),
            "kind": kind,
        }

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
        c_idx = self._resolve_col_index(col_index)
        y_int = round(y)
        if c_idx in self.control_points and y_int in self.control_points[c_idx]:
            del self.control_points[c_idx][y_int]
            self._manual_store().get(c_idx, {}).pop(y_int, None)
            return {"success": True, "removed_y": y_int}
        return {"success": False, "message": "Point not found"}

    @staticmethod
    def _extract_bar_centers_map(
        pts: list[dict[str, float]],
        c_start: float,
        noise_margin: float = 1.5,
    ) -> dict[int, float]:
        """对水平柱状图 (bar) 提取各个柱体的垂直中心行 (centerline y) 与柱端读数 (max x)。

        杜绝方波平顶上下边缘双点问题，确保每个柱体只有 1 个位于几何正中心的控制点。
        """
        if not pts:
            return {}
        p_rows = np.array([p["row"] for p in pts], dtype=int)
        p_x = np.array([p["x"] for p in pts], dtype=float)

        dyn_range = float(np.ptp(p_x)) if len(p_x) > 0 else 0.0
        if dyn_range < 1.0:
            return {}

        threshold = c_start + max(noise_margin, dyn_range * 0.04)
        is_bar = p_x > threshold

        centers_map: dict[int, float] = {}
        in_bar = False
        start_idx = 0

        for i in range(len(is_bar)):
            if is_bar[i] and not in_bar:
                in_bar = True
                start_idx = i
            elif not is_bar[i] and in_bar:
                in_bar = False
                bar_rows = p_rows[start_idx:i]
                bar_xs = p_x[start_idx:i]
                max_x = float(np.max(bar_xs))
                best_rows = bar_rows[bar_xs >= max_x - 0.5]
                center_y = int(best_rows[len(best_rows) // 2])
                centers_map[center_y] = max_x

        if in_bar:
            bar_rows = p_rows[start_idx:]
            bar_xs = p_x[start_idx:]
            max_x = float(np.max(bar_xs))
            best_rows = bar_rows[bar_xs >= max_x - 0.5]
            center_y = int(best_rows[len(best_rows) // 2])
            centers_map[center_y] = max_x

        return centers_map

    def _resolve_col_plot_type(self, col: dict[str, Any]) -> str:
        """解析列的绘图形态，优先使用列显式覆盖，未显式覆盖时从所属组继承 (ARCHITECTURE §6.4)。"""
        pt = col.get("plot_type") or col.get("reader_type")
        if pt:
            return pt
        gid = col.get("x_group_id")
        if gid and hasattr(self, "rois") and self.rois:
            for r in self.rois:
                for g in r.get("x_groups", []):
                    if g.get("id") == gid:
                        gpt = g.get("plot_type")
                        if gpt:
                            return gpt
        return "area"

    def algorithm_extract_turning_points(
        self,
        col_index: int | None = None,
        prominence_ratio: float = 0.05,
    ) -> dict[str, Any]:
        """Extracts peak and valley control points per column, preserving manual points (Section 六 item 7)."""
        target_cols = (
            [col_index]
            if col_index is not None
            else [c["col_index"] for c in self.columns]
        )
        if not target_cols:
            return {"success": False, "message": "No columns available"}

        for c_idx in target_cols:
            col = self.columns[c_idx] if c_idx < len(self.columns) else {}
            col_plot_type = self._resolve_col_plot_type(col)
            if c_idx not in self.column_points:
                r_type = col_plot_type if col_plot_type in READER_TYPES else "area"
                self.digitize(c_idx, r_type)

        updated = []
        for c_idx in target_cols:
            pts = self.column_points.get(c_idx, [])
            if not pts:
                continue

            col = self.columns[c_idx] if c_idx < len(self.columns) else {}
            col_plot_type = self._resolve_col_plot_type(col)

            p_rows = np.array([p["row"] for p in pts], dtype=int)
            p_x = np.array([p["x"] for p in pts], dtype=float)
            dyn_range = float(np.ptp(p_x)) if len(p_x) > 0 else 1.0
            c_start = float(col.get("start", col.get("startX", np.min(p_x))))
            noise_cutoff = c_start + max(1.5, dyn_range * 0.04)

            is_bar_like = col_plot_type == "bar"

            detected_rows_map: dict[int, float] | None = None
            if is_bar_like:
                detected_rows_map = self._extract_bar_centers_map(pts, c_start)
                detected_rows = set(detected_rows_map.keys())
            else:
                prominence = max(1.0, dyn_range * prominence_ratio)

                peaks_idx = []
                valleys_idx = []
                if find_peaks is not None and len(p_x) > 5:
                    peaks_idx, _ = find_peaks(p_x, prominence=prominence)
                    valleys_idx, _ = find_peaks(-p_x, prominence=prominence)

                # 收集已移除的水平横线带，屏蔽横线边缘毛刺被误检为波峰/波谷
                removed_hl_bands = []
                for cand in getattr(self, "line_candidates", []):
                    if cand.get("axis") == "h" and cand.get("status") == "removed":
                        cy = int(round(float(cand.get("y", 0))))
                        th = int(round(float(cand.get("thickness", 3))))
                        removed_hl_bands.append((cy - th // 2 - 1, cy + th // 2 + 1))

                def _in_removed_hl(row_val: int) -> bool:
                    return any(b0 <= row_val <= b1 for b0, b1 in removed_hl_bands)

                valid_peaks = [p for p in peaks_idx if not _in_removed_hl(p_rows[p])]
                valid_valleys = [
                    v for v in valleys_idx
                    if p_x[v] > noise_cutoff and not _in_removed_hl(p_rows[v])
                ]
                detected_rows = set(p_rows[valid_peaks]).union(set(p_rows[valid_valleys]))

            # 合并控制点：峰谷算法点合并进已有控制点，严格保留原有控制点与用户手工点 (manual)
            existing_ctrls = self.control_points.get(c_idx, {})
            merged_ctrls: dict[int, float] = dict(existing_ctrls)
            if detected_rows_map is not None:
                for r, x_val in detected_rows_map.items():
                    merged_ctrls[int(r)] = float(x_val)
            else:
                for r in detected_rows:
                    idx_arr = np.where(p_rows == r)[0]
                    if len(idx_arr) > 0:
                        merged_ctrls[int(r)] = float(p_x[idx_arr[0]])

            manual = self._manual_store().get(c_idx, {})
            for r, rec in manual.items():
                r_int = int(r)
                if "x" in rec:
                    merged_ctrls[r_int] = float(rec["x"])
                elif r_int in merged_ctrls:
                    pass
                else:
                    idx_arr = np.where(p_rows == r_int)[0]
                    if len(idx_arr) > 0:
                        merged_ctrls[r_int] = float(p_x[idx_arr[0]])

            self.control_points[c_idx] = merged_ctrls
            updated.append(c_idx)

        self._record_history("Extract turning points")
        return {"success": True, "columns_updated": updated}


DigitizeMixin = DigitizeSessionMixin
