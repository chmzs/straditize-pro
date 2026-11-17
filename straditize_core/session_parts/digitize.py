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
from .xscale import _resolve_column_group, resolve_axis_stroke
from ..protocol import (
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: 三种**画法**。与 `plot_type`、底层 `digitize_column` 共用同一套**单数**命名。
PLOT_TYPES: tuple[str, ...] = ("area", "line", "bar")

#: 支持的读取器类型 = 三种画法 + 一种读取**策略**。
#:
#: 两类名字在 2026-11 之前恰好同集，本仓首次让它们分叉：`area_exaggerated` 读的
#: 仍然是一张**面积图**（画法不变，`plot_type` 仍写 `"area"`），只是同一列被画了
#: 两层——内线是真实值、外线是同一个数放大后的参考线，于是"读哪一层"成了独立的
#: 决策，画法表达不了它。把它塞进 `plot_type` 会让渲染层见到一个它不认识的画法。
READER_TYPES: tuple[str, ...] = PLOT_TYPES + ("area_exaggerated",)

#: 历史别名 → 规范名。只在此处出现一次：让别名集中在一个入口被消解，
#: 而不是散进每个分支判断（那样 `bar` 曾静默落到 else 走均值，P-04）。
_READER_ALIASES: dict[str, str] = {"bars": "bar"}

# ---- `area_exaggerated` 的判据常量（全部是像素/比值，没有可调"手感"参数）----
#
# 这些数字来自取证组在四列 6080 行上的实测（Picea/Pinus/Betula/Quercus），不是估的：
#
#   合并 ratio 中位 4.17（p5–p95 = 3.00–5.25，93.5% 落在 [3.0, 5.5]）
#   逐列中位：Picea 4.50 / Pinus 3.75 / Betula 4.42 / Quercus 4.00
#
# 倍率**不是恒定 5**，所以局部倍率一律取"本列 sep 行的中位数"，不写常数、不跨列借。

#: 内线起点与列左缘的距离上限：内线是贴着列轴画的填充区，起点必然在轴粗范围内。
#: 轴粗 1–20px，取 5 覆盖常见 6px 轴被 `_without_axis_ink` 扣掉之后剩下的残端。
_EXAG_INNER_ANCHOR_TOL_PX = 5

#: 外线起点必须比内线右缘更靠右这么多，才算"另一段"（抗锯齿会留 1px 毛边）。
_EXAG_OUTER_MIN_GAP_PX = 2

#: 倍率的**放大原点**：`z0 = startX + 1`。取证组用 ratio 离散度扫描验证过——
#: 以 k=1 处的 IQR/中位衡量，z0=startX+1 时离散度最小（0.23），z0 取 startX+k
#: （k≥2）都变大，说明放大线的原点确实在列左缘右侧 1px，而不是读数用的 0 点
#: （列左缘 + 轴粗）。两个原点不是一回事：本读取器的**读数**仍按读数的 0 点换算，
#: `z0` 只用来算"外线距 / 内线距"的比值。
#:
#: 另注意：读数仍含 +4px 常数底（两层曲线都带，那是 S1 的另一半，本 PR 不修，
#: 见 issue #46 的次要项）。
_EXAG_RATIO_ORIGIN_OFFSET_PX = 1.0

#: sep 判据：内线宽（段内像素数）小于这个值的一行，量不出可信的右缘。
_EXAG_INNER_MIN_WIDTH_PX = 4.0

#: sep 判据：倍率必须落在这个区间，否则那段"外线"更可能是邻列基线/图框线。
_EXAG_SEP_RATIO_RANGE = (2.0, 7.0)

#: 自检带宽：`k` 落在区间外只标记 `outer_inconsistent`，不改值。
#: 下限取 3.0（不是 4.0）：实测 p5 = 3.00，收紧到 4.0 会误杀约 1/3 的可分行。
_EXAG_SELFCHECK_RANGE = (3.0, 5.5)

#: 邻域行数：broken/glue 的判据阈值只从**本行 ±10 行内**的 sep 行取，
#: 因为内线宽度沿深度会变，整列一个分位数会把上下的层位差异混进来。
_EXAG_NEIGHBOUR_ROWS = 10

#: 外线右缘距列右界至少这么多像素：贴到界上的那一"段"通常是邻列的基线或图框线，
#: 把它当外线会让整列读数被邻列污染（同 `-1px` 排除列右边界的那条教训）。
_EXAG_OUTER_EDGE_MARGIN_PX = 3.0


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
        """Digitizes curve or bars in the specified column to extract data points.

        未显式传 `reader_type`（也没有 `mode` / `method` 覆盖）时，读法是**该列自己声明的**
        `reader_type`（`column.update` 可写、工程包里持久化），列上也没有才回落 `"area"`。
        这条回落顺序是导出链唯一的读法入口：`_ensure_export_column_points` 调
        `digitize(col_index)` 不传读法，若这里硬编码 `"area"`，列上声明的读法永远不生效。
        """
        if method is not None:
            reader_type = method
        elif mode is not None:
            reader_type = mode
        # 显式值当场归一化：报错时点与旧实现一致（先骂读法，再骂列）。
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
            # 列字典是唯一真源（工程包里持久化的就是它）；列上没声明 → `"area"`。
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

        # 0 点（列左缘 + 轴粗）：`area_exaggerated` 只用它标"空行读到 0"的位置，
        # 读数的换算在 `resolve_column_scale` 那一层（同一个 0 点）。
        zero_x = self._zero_point_x(col_index)
        points = self._read_column_profile(
            mask,
            c_start,
            c_end,
            y0,
            y1,
            reader_type,
            zero_x=float(c_start) if zero_x is None else float(zero_x),
        )
        # `area_exaggerated` 会**跳过**判不出内线的行（留空，不是 0）。把那些行号报出来：
        # 只看 "points 里缺了谁" 分不清"这一行没数据"和"这一行有墨但读法判不出"，
        # 而后者是要人看一眼的。其它读取器逐行必有点，这个键恒为空。
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
                "unreadable_rows": unreadable_rows,
            }

        self._interpolate_across_hlines(points, c_start)

        control_points, ctrl_pts_list = self._turning_control_points(
            points, c_start, y0, y1, col_index, float(c_end - c_start), resolve_axis_stroke(col, None)
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
            "unreadable_rows": unreadable_rows,
        }

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

        name = (
            col.get("species")
            or col.get("name")
            or f"col{col_index + 1:02d}"
        )
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
        *,
        zero_x: float | None = None,
    ) -> list[dict[str, Any]]:
        """逐行把墨迹变成特征 x：area 读本列墨迹右缘、line 读曲线中心或填充顶边、bar 读柱子右缘。

        `zero_x` 只有 `area_exaggerated` 用（0 点像素），其余读取器不碰它。
        """
        if reader_type == "area_exaggerated":
            return self._read_exaggerated_profile(
                mask,
                c_start,
                c_end,
                y0,
                y1,
                float(c_start) if zero_x is None else float(zero_x),
            )
        points: list[dict[str, float]] = []

        # The column's own curve is identified by connected-component size; the
        # labelling is built once for the whole band rather than per row.
        band = mask[y0 : y1 + 1, c_start:c_end]
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

        for row_y in range(y0, y1 + 1):
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

    def _read_exaggerated_profile(
        self,
        mask: np.ndarray,
        c_start: int,
        c_end: int,
        y0: int,
        y1: int,
        zero_x: float,
    ) -> list[dict[str, Any]]:
        """`area_exaggerated`：同一列画了两层时的取数——读**内线**，外线只做自检。

        ## 为什么不能沿用"整行最右墨迹"

        实地图上（一张孢粉图谱的 Picea/Pinus/Betula/Quercus 四列）同一条数据被画了两次：
        贴着列轴的填充区是**真实值**（内线），它外侧另有一条细线是**放大后的同一条数据**
        （外线，倍率中位 4.17，逐列中位 3.75–4.50）。`area` 读"本列连通域的最右墨迹"，
        于是取到外线 = 夸大值；外线在断行处又不存在，读数就掉回内线，整列在 ×1 与 ×4 之间跳。

        ## 行分类（四分；取证组口径，实测覆盖率上限见下）

        逐行只看**该行的段结构**（列窗内连续墨迹段），先定内线再判类型：

        * **内线** = 起点离列左缘 ≤ `_EXAG_INNER_ANCHOR_TOL_PX` 的那一段（面积图的填充区
          必然贴轴，外线浮在值上、不贴轴）。
        * **sep**（可分行，读内线）：本行另有独立外段，且内线宽 ≥ 4px，且
          `ratio = 外线距 / 内线距 ∈ [2, 7]`，且外线右缘 ≤ 列右界 −3px。读数 = 内线右缘。
        * **broken**（外线断行，读内线）：单段行，段宽 ≤ **本行 ±10 行内 sep 行内线宽的 p75**
          —— 段太窄，不可能是"内外线粘连"的那一块，就只能是内线本身。
        * **glue**（内外线粘连，反算）：单段行，段右缘距放大原点 ≥ **本行 ±10 行内 sep 行
          外线距的 p25** —— 段一直长到外线处，说明两线连成一块，内线右缘无从量起；
          用邻域 sep 行 `ratio` 的中位数反算 `x = z0 + (段右缘 − z0) / k`，
          标 `source="derived_from_outer"`。
        * **undet**（判不出）：其余单段行 / 没有贴轴段的行 —— **不给数**，行号进
          `digitize()["unreadable_rows"]`。实测这类行很多（Picea 459/1520、
          Quercus 1048/1520），**不插值**：插值会造出"看起来像实测"的数，
          违反 `docs/ARCHITECTURE.md` §2 的第一不变量。留给后续显式插值功能。

        实测可读行数（sep∪broken）应约为 Picea 770 / Pinus 819 / Betula 938 / Quercus 223
        （各列 1520 行）。**跑出 100% 就是错的**：那说明 undet 被当成了可读行。

        ## 自检与口径

        * `k` 只用于**自检**（`_EXAG_SELFCHECK_RANGE` 外标 `flags=["outer_inconsistent"]`，
          不改值）和**粘连行反算**，不参与 sep/broken 行的读数。
        * 倍率不是常数：局部 `k` 一律取本列（本邻域）sep 行的中位数，不写死 5、不跨列借。
        * 本读法量到的内线**就是真实值**，因此 `exaggeration_mult` 必须按 1 处理 ——
          再除一次等于把同一个倍数罚两次。
        * 读数仍含 +4px 常数底（两层都带，S1 的另一半，见 issue #46 的次要项）。
        """
        points: list[dict[str, Any]] = []
        band = mask[y0 : y1 + 1, c_start:c_end]
        if band.size == 0:
            return points
        band_axis_offsets = _axis_ink_offsets(band)
        # 放大原点（比值分母的原点）：`z0 = startX + 1`，见 `_EXAG_RATIO_ORIGIN_OFFSET_PX`。
        origin = float(c_start) + _EXAG_RATIO_ORIGIN_OFFSET_PX

        # 第一遍只做**逐行分类**，不掺任何统计量：分类只依赖该行自己的段结构，
        # 统计量（邻域分位数）留到第二遍。
        rows: list[tuple[int, str, dict[str, float]]] = []
        for row_y in range(y0, y1 + 1):
            if row_y >= self.height:
                break
            local_y = row_y - y0
            if local_y < 0 or local_y >= band.shape[0]:
                break
            fg_indices = np.where(band[local_y])[0]
            # 轴线墨迹不是数据（P-02）。整行只剩轴线时退回全墨迹：那几列此时就是数据本身。
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
                # 没有任何一段贴轴：既判不出内线，也就无从判断哪一段是真实值。
                rows.append((row_y, "undet", {}))
                continue
            inner_start, inner_end = max(anchored, key=lambda span: span[1])
            inner_span = float(inner_end - inner_start + 1)
            outer_spans = [
                span for span in spans if span[0] > inner_end + _EXAG_OUTER_MIN_GAP_PX
            ]
            sep_payload: dict[str, float] | None = None
            if outer_spans:
                outer_end = max(span[1] for span in outer_spans)
                inner_px = c_start + inner_end
                outer_px = c_start + outer_end
                distance_in = inner_px - origin
                ratio = (outer_px - origin) / distance_in if distance_in > 0 else None
                if (
                    inner_span >= _EXAG_INNER_MIN_WIDTH_PX
                    and ratio is not None
                    and _EXAG_SEP_RATIO_RANGE[0] <= ratio <= _EXAG_SEP_RATIO_RANGE[1]
                    and outer_px <= c_end - _EXAG_OUTER_EDGE_MARGIN_PX
                ):
                    sep_payload = {
                        "inner_px": float(inner_px),
                        "inner_span": inner_span,
                        "outer_extent": float(outer_px - origin),
                        "ratio": float(ratio),
                    }
            if sep_payload is not None:
                rows.append((row_y, "sep", sep_payload))
                continue
            # 单段行，或"多出来的段"不满足 sep 判据（更像邻列/图框的噪声）——
            # 一律按"本行只有内线"处理，读数取内线右缘；是否粘连留给第二遍的邻域判据。
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

        # 第二遍：邻域统计量只从**sep 行**取（内线宽 p75 / 外线距 p25 / ratio 中位）。
        sep_rows = [(row_y, payload) for row_y, kind, payload in rows if kind == "sep"]

        for row_y, kind, payload in rows:
            flags: list[str] = []
            if kind == "empty":
                # 空行读到 0 点是合法读数（这一层没有该物种），不是兜底。
                points.append(
                    {"row": row_y, "x": float(zero_x), "y": float(row_y), "source": "read"}
                )
                continue
            if kind == "undet":
                # 判不出 ⇒ 该行不给数（缺席 ⇒ 导出为空，行号进 `unreadable_rows`）。
                continue
            if kind == "sep":
                if not (
                    _EXAG_SELFCHECK_RANGE[0]
                    <= payload["ratio"]
                    <= _EXAG_SELFCHECK_RANGE[1]
                ):
                    flags.append("outer_inconsistent")
                points.append(
                    {
                        "row": row_y,
                        "x": payload["inner_px"],
                        "y": float(row_y),
                        "source": "read",
                        **({"flags": flags} if flags else {}),
                    }
                )
                continue

            # kind == "single"：靠**本行 ±10 行内**的 sep 行决定是内线还是粘连块。
            neighbours = [
                payload_sep
                for row_sep, payload_sep in sep_rows
                if abs(row_sep - row_y) <= _EXAG_NEIGHBOUR_ROWS
            ]
            if not neighbours:
                # 邻域里一条可分行都没有 ⇒ 无从比较 ⇒ 判不出（不是 0，也不是内线）。
                continue
            inner_p75 = float(np.percentile([p["inner_span"] for p in neighbours], 75))
            outer_p25 = float(np.percentile([p["outer_extent"] for p in neighbours], 25))
            if payload["span"] <= inner_p75:
                # broken：段宽不超过邻域内线宽 —— 它就是内线本身（外线这一行没画）。
                feat_x = payload["end"]
                if feat_x <= zero_x:
                    # 只有轴线墨迹（该行读数为 0）：回 0 点，别把轴粗算成负读数。
                    feat_x = float(zero_x)
                points.append(
                    {"row": row_y, "x": feat_x, "y": float(row_y), "source": "read"}
                )
                continue
            if payload["extent"] >= outer_p25:
                # glue：段一直长到（或超过）邻域外线距 —— 内外线粘连，用邻域 ratio 中位反算。
                k_local = float(np.median([p["ratio"] for p in neighbours]))
                if k_local <= 0:
                    continue
                points.append(
                    {
                        "row": row_y,
                        "x": float(origin + payload["extent"] / k_local),
                        "y": float(row_y),
                        "source": "derived_from_outer",
                    }
                )
                continue
            # 既不是内线、也不是粘连块 ⇒ undet。

        return points

    def _interpolate_across_hlines(
        self, points: list[dict[str, float]], c_start: int
    ) -> None:
        """跨横线插值：横线所在行会被读成 100% 尖峰，按相邻行线性补回来（就地改 points）。"""
        # Interpolate across pervasive horizontal grid lines to eliminate artificial 100% spikes
        if hasattr(self, "hline_rows") and self.hline_rows:
            # 这里把 `hline_rows` 的行号当**数组下标**用，前提是 points 逐行连续。
            # `area_exaggerated` 会对判不出的行**不产出点**（留空而不是编一个数），
            # 于是下标与行号错位；错位时宁可跳过插值，也不要把某一行的高斯峰搬到
            # 另一行上去（那是往数据里注入一个不存在的尖峰）。
            point_rows = [int(p["row"]) for p in points]
            if any(b - a != 1 for a, b in zip(point_rows, point_rows[1:])):
                return
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
        # 垂直容差是**绝对** 2px：它就是重构误差判据本身，不随列宽放宽。
        prominence_px = max(2.0, 0.005 * float(col_width))
        turning_rows, turning_vals, is_mandatory = detect_turning_points_vertical(
            curve_profile,
            epsilon=VERTICAL_TOLERANCE_PX,
            prominence=prominence_px,
            min_distance=3,
        )
        kept_rows, kept_vals = prune_axis_pileups(turning_rows, turning_vals, is_mandatory)
        # 兜底：去堆叠的两点并一点可能把误差顶起来，这里把超差行补回去。
        kept_rows, kept_vals = enforce_error_bound(
            np.arange(len(curve_profile), dtype=float), curve_profile, kept_rows, kept_vals
        )

        ctrl_pts_list: list[dict[str, Any]] = []
        # `kept_rows` 是**数组下标**，行号要经 points 转一次：`area_exaggerated` 会
        # 跳过判不出的行，此时 `y0 + 下标` 已经不是那一行的行号。逐行连续的读取器下
        # `point_rows[i] == y0 + i`，与旧写法逐字节等价。
        point_rows = [int(round(float(p["row"]))) for p in points]
        for r_rel, v_rel in zip(kept_rows, kept_vals):
            pos = int(r_rel)
            r_int = (
                point_rows[pos]
                if 0 <= pos < len(point_rows)
                else int(y0 + r_rel)
            )
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

        # Ensure endpoints exist
        y0_x = float(c_start + max(min_width, points[0]["x"] - c_start))
        y1_x = float(c_start + max(min_width, points[-1]["x"] - c_start))
        control_points[y0] = y0_x
        control_points[y1] = y1_x

        if not any(p["y"] == float(y0) for p in ctrl_pts_list):
            ctrl_pts_list.insert(
                0,
                {
                    "id": f"pt_{col_index}_{y0}",
                    "x": y0_x,
                    "y": float(y0),
                    "type": "trough",
                    "isManual": False,
                },
            )
        if not any(p["y"] == float(y1) for p in ctrl_pts_list):
            ctrl_pts_list.append(
                {
                    "id": f"pt_{col_index}_{y1}",
                    "x": y1_x,
                    "y": float(y1),
                    "type": "trough",
                    "isManual": False,
                }
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
            p.get("x") for p in (self.column_points.get(col_index) or []) if p.get("x") is not None
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

        # Ensure boundary anchor points exist
        if y0 not in ctrls:
            ctrls[y0] = float(usable_xs[0])
        if y1 not in ctrls:
            ctrls[y1] = float(usable_xs[-1])

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

        all_rows = np.arange(y0, y1 + 1)
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
        走单点接口 `core.updateControlPoint` 要逐点往返，且每个点都重算整列插值。

        与单点接口共用 `update_control_point` 的守卫 + 插值实现（只调一次、种子取排序后
        的第一个锚点），避免两条链各写一套插值后给出不同曲线。
        """
        self._record_history("Sync control points")
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

        self.control_points[c_idx] = ctrls
        self._manual_store()[c_idx] = manual
        # 稠密缓存作废：用户刚改的是**曲线本身**，旧墨迹曲线不再代表这一列。
        # 下一次读取（画布载荷 / 导出）按新锚点线性重建 —— 两边重建的是同一条，
        # 所以「拖完手柄后画布曲线与导出值一致」是结构性的，不靠约定。
        seed_row = sorted(ctrls)[0]
        result = self.update_control_point(c_idx, seed_row, ctrls[seed_row])
        # 锚点是曲线本身：旧墨迹作废，立刻按新锚点重建稠密曲线。
        # 重建后 column_points 仍非空 —— 画布与导出读的都是这一份，
        # 「拖完手柄后两边一致」是结构性的，不是约定。
        # update_control_point 已按 Pchip 重建整列曲线（含 column_points），
        # 这里**不得再 pop**：那会让该列退回"无点"状态，导出读成 0.0（实测）。
        return {
            "col_index": c_idx,
            "action": "synced",
            "control_points_count": result["control_points_count"],
            "points": result["points"],
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
            if c_idx not in self.column_points:
                self.digitize(c_idx, "area")

        updated = []
        for c_idx in target_cols:
            pts = self.column_points.get(c_idx, [])
            if not pts:
                continue

            existing_ctrls = self.control_points.get(c_idx, {})
            p_rows = np.array([p["row"] for p in pts], dtype=int)
            p_x = np.array([p["x"] for p in pts], dtype=float)

            dyn_range = float(np.ptp(p_x)) if len(p_x) > 0 else 1.0
            prominence = max(1.0, dyn_range * prominence_ratio)

            peaks_idx = []
            valleys_idx = []
            if find_peaks is not None and len(p_x) > 5:
                peaks_idx, _ = find_peaks(p_x, prominence=prominence)
                valleys_idx, _ = find_peaks(-p_x, prominence=prominence)

            detected_rows = set(p_rows[peaks_idx]).union(set(p_rows[valleys_idx]))

            merged_ctrls = dict(existing_ctrls)
            manual = self._manual_store().get(c_idx, {})
            for r in detected_rows:
                # 用户手工点不接受算法改写（重提取只补/改自动点）
                if int(r) in manual:
                    continue
                idx_arr = np.where(p_rows == r)[0]
                if len(idx_arr) > 0:
                    merged_ctrls[int(r)] = float(p_x[idx_arr[0]])

            self.control_points[c_idx] = merged_ctrls
            updated.append(c_idx)

        self._record_history("Extract turning points")
        return {"success": True, "columns_updated": updated}


DigitizeMixin = DigitizeSessionMixin
