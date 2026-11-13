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

from ..curve import detect_stratigraphic_turning_points
from ..digitize import (
    _axis_ink_offsets,
    _band_components,
    _band_is_filled,
    _line_own_offset,
    _own_run_last_offset,
    _without_axis_ink,
    interpolate_hlines,
)
from ..protocol import (
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: 唯一支持的读取器类型。与 `plot_type`、底层 `digitize_column` 共用同一套**单数**命名。
READER_TYPES: tuple[str, ...] = ("area", "line", "bar")

#: 历史别名 → 规范名。只在此处出现一次：让别名集中在一个入口被消解，
#: 而不是散进每个分支判断（那样 `bar` 曾静默落到 else 走均值，P-04）。
_READER_ALIASES: dict[str, str] = {"bars": "bar"}


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
        reader_type: str = "area",
        mode: str | None = None,
        method: str | None = None,
    ) -> dict[str, Any]:
        """Digitizes curve or bars in the specified column to extract data points."""
        if method is not None:
            reader_type = method
        elif mode is not None:
            reader_type = mode
        # 归一化一次，后面所有分支只面对规范名单数名。
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

        points = self._read_column_profile(
            mask, c_start, c_end, y0, y1, reader_type
        )
        if not points:
            return {
                "col_index": col_index,
                "reader_type": reader_type,
                "points": [],
                "control_points_count": 0,
            }

        self._interpolate_across_hlines(points, c_start)

        control_points, ctrl_pts_list = self._turning_control_points(
            points, c_start, y0, y1, col_index
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

    def _turning_control_points(
        self,
        points: list[dict[str, float]],
        c_start: int,
        y0: int,
        y1: int,
        col_index: int,
    ) -> tuple[dict[int, float], list[dict[str, Any]]]:
        """按地形显著度抽拐点，再补首末两个端点控制点，返回 (行号→x 字典, 控制点列表)。"""
        control_points: dict[int, float] = {}
        # Advanced peak extraction: using topological prominence and local extrema
        curve_profile = np.array([p["x"] - c_start for p in points], dtype=float)
        turning_rows, turning_vals, is_mand = detect_stratigraphic_turning_points(
            curve_profile, prominence=1.5, min_distance=3, epsilon=1.0, max_points=32
        )
        ctrl_pts_list = []
        for r_rel, v_rel, _mand in zip(turning_rows, turning_vals, is_mand):
            r_int = int(y0 + r_rel)
            x_val = float(c_start + v_rel)
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
        y0_x = float(points[0]["x"])
        y1_x = float(points[-1]["x"])
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

        sorted_rows = sorted(ctrls.keys())
        sorted_x = [ctrls[r] for r in sorted_rows]

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
