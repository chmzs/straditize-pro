"""QA session mixin (T09: Verification gate and geological quality diagnostics).

Strictly adheres to Frozen Contracts v1.3 §2.7 (QaSummary) and §4 (Derived Quantities).
"""

from __future__ import annotations

from typing import Any

from ..protocol import JsonRpcError
from ..qa import compute_qa_summary
from .layers import INNER_XS_KEY, OUTER_XS_KEY, paired_layer_xs
from .xscale import (
    READ_PROFILE_QA,
    _resolve_column_group,
    read_column_values,
    resolve_axis_stroke,
    resolve_column_scale,
)


def _explicit_axis_stroke(
    col: dict[str, Any], group_obj: dict[str, Any] | None
) -> tuple[float | None, str]:
    """轴宽像素 + 它从哪来；**`None` 表示列与组都没写**，不是 0。

    `resolve_axis_stroke` 在两边都缺时会回落 5.0（`xscale.py:58`）——那是为了防止
    0 点算偏而设的显示兜底，**不是实测值**。旗标拿这个 5.0 去判"这一行是否落在轴线
    覆盖范围内"，等于用一个没人测过的数下结论，违反"取不到就不给数"的不变量。
    所以这里只认显式写入的值：有就用（数值一律走 `resolve_axis_stroke`，保持单一来源），
    没有就返回 `None`，由旗标层整列标 `skipped(axis_width_unset)`。
    """
    for source, holder in (("column", col), ("group", group_obj or {})):
        raw = holder.get("axis_stroke_px")
        if raw is None or isinstance(raw, bool):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value >= 0.0:
            return resolve_axis_stroke(col, group_obj), source
    return None, "unset"



def _is_percent_unit(unit: Any) -> bool:
    """百分比单位判定：**唯一实现在 `session_parts/export.py::is_percent_unit`**，
    这里在函数内转发（模块级 import 会与 export 形成环：export 也 import xscale/agedepth）。"""
    from .export import is_percent_unit

    return is_percent_unit(unit)


class QaMixin:
    """Session mixin for composition sum check and consistency validation."""

    def _init_qa(self) -> None:
        """Initialize QA state."""
        pass

    def qa_summarize(
        self,
        roi_id: str | None = None,
        tolerance: float = 2.0,
    ) -> dict[str, Any]:
        """Produce the standardized QaSummary diagnostic entity for an ROI.

        Checks:
        1. Composition sum <= 100% (+ tolerance) gate when composition is True.
        2. Empty horizon accounting with reason "no ink read".
        3. Per-column peak vs declared scale max (derived strictly from x_ticks).
        """
        target_roi = self._qa_target_roi(roi_id)
        target_roi_id = target_roi.get("id", "pollen")
        roi_name = target_roi.get("name", target_roi_id)
        composition = bool(target_roi.get("composition", True))

        # 掩膜变过（步骤 4 确认过干扰线 / 加过排除区）⇒ 受影响列的逐行点已被作废。
        # 不先补齐的话，`_qa_column_values` 会把缺行按 0 点读出满量程 0 值，
        # QA 会因为"清理过"而给出与导出不同的结论。
        if any(
            bool(roi.get("columns_stale"))
            for roi in (getattr(self, "rois", None) or [])
        ):
            self._fill_missing_column_points()

        target_columns = self._qa_target_columns(target_roi_id)
        if not target_columns:
            return compute_qa_summary(
                roi_id=target_roi_id,
                roi_name=roi_name,
                composition=composition,
                horizons=[],
                columns_info=[],
                tolerance=tolerance,
            )

        horizon_rows, horizon_depths = self._qa_horizons(target_columns)
        if not horizon_rows:
            return compute_qa_summary(
                roi_id=target_roi_id,
                roi_name=roi_name,
                composition=composition,
                horizons=[],
                columns_info=[],
                tolerance=tolerance,
            )

        columns_info, col_values_by_column = self._qa_column_values(
            target_columns, horizon_rows
        )

        # Assemble per-horizon structures
        horizons_data: list[dict[str, Any]] = []
        for h_idx in range(len(horizon_rows)):
            row_vals = [
                col_values_by_column[c_i][h_idx] for c_i in range(len(target_columns))
            ]
            horizons_data.append(
                {
                    "depth": horizon_depths[h_idx],
                    "values": row_vals,
                }
            )

        return compute_qa_summary(
            roi_id=target_roi_id,
            roi_name=roi_name,
            composition=composition,
            horizons=horizons_data,
            columns_info=columns_info,
            tolerance=tolerance,
        )

    def _qa_target_roi(self, roi_id: str | None) -> dict[str, Any]:
        """定位 QA 目标 ROI：显式 ID > 活跃 ROI > 第一个 ROI；一个 ROI 都没有时造一个占位。

        显式给了不存在的 ID 必须报错，不能静默回落到第一个——否则用户以为在看 ROI-B，
        实际看的是 ROI-A 的门禁结果。
        """
        rois = getattr(self, "rois", [])

        # Resolve target ROI
        if roi_id is None:
            if rois:
                target_roi = next(
                    (
                        r
                        for r in rois
                        if r.get("id") == getattr(self, "active_roi_id", None)
                    ),
                    rois[0],
                )
            else:
                target_roi = {"id": "pollen", "name": "pollen", "composition": True}
        else:
            if rois:
                target_roi = next((r for r in rois if r.get("id") == roi_id), None)
                if target_roi is None:
                    raise JsonRpcError(-32602, f"ROI '{roi_id}' not found.")
            else:
                target_roi = {"id": roi_id, "name": roi_id, "composition": True}

        target_roi_id = target_roi.get("id", "pollen")
        roi_name = target_roi.get("name", target_roi_id)
        composition = bool(target_roi.get("composition", True))
        return target_roi

    def _qa_target_columns(self, target_roi_id: str) -> list[dict[str, Any]]:
        """归属过滤：有 roi_id 的按 ID 匹配；没有 roi_id 的老列只在单 ROI 或主 ROI 时才收。"""
        rois = getattr(self, "rois", [])
        all_columns = getattr(self, "columns", [])
        target_columns: list[dict[str, Any]] = []
        for col in all_columns:
            c_roi = col.get("roi_id")
            if c_roi == target_roi_id or (
                not c_roi
                and (
                    len(rois) <= 1
                    or target_roi_id == getattr(self, "primary_roi_id", None)
                )
            ):
                target_columns.append(col)
        return target_columns

    def _qa_horizons(
        self, target_columns: list[dict[str, Any]]
    ) -> tuple[list[int], list[float | None]]:
        """层位与深度：有采样层就以它为准（深度是用户填的），否则取目标列逐行点的并集。"""
        horizon_rows: list[int] = []
        horizon_depths: list[float | None] = []

        samples = getattr(self, "samples", [])
        if samples:
            for s in samples:
                r_px = int(round(s.get("row_px", 0)))
                horizon_rows.append(r_px)
                horizon_depths.append(s.get("depth"))
        elif getattr(self, "column_points", None):
            target_indices = {
                c.get("col_index", idx) for idx, c in enumerate(target_columns)
            }
            pts_rows = set()
            for c_idx in target_indices:
                if c_idx in self.column_points:
                    pts_rows.update(p["row"] for p in self.column_points[c_idx])
            if pts_rows:
                sorted_rows = sorted(pts_rows)
                for r in sorted_rows:
                    horizon_rows.append(r)
                    depth_func = getattr(self, "_depth_for_row_px", None)
                    horizon_depths.append(depth_func(r) if depth_func else None)
        return horizon_rows, horizon_depths

    def _qa_column_values(
        self,
        target_columns: list[dict[str, Any]],
        horizon_rows: list[int],
    ) -> tuple[list[dict[str, Any]], list[list[float]]]:
        """逐列取值。这里 require_calibrated=False 是**有意**的：QA 要能对未标定列粗算，

        好让"该列没标定/总和偏离"的提醒能被触发；导出路径对未标定列一律给 None，两者不通。

        同时把逐行旗标（#91/#92）需要的几何搬进 `columns_info`：逐行原始像素、0 点、
        列右端、轴宽、`plot_type`、点的来历。**旗标判的是逐像素行，不是层位行** ——
        触边/盲区是"这一行墨迹顶到哪儿"的物理事实，`_qa_horizons` 给的采样层位
        （可能每隔 5–10 行一个）会把平台与突刺的关系抹掉，所以这里搬的是
        `column_points` 的完整行序列，不是 `horizon_rows`。

        #99 的内线/外线成对读数（`inner_xs_px` / `outer_xs_px`）也在这里搬：它们是
        `column_points` 点字典上的同名键（落库与键契约见 `session_parts/layers.py`），
        与 `rows_px` 逐位对齐；**整列一行都没有时这两个键根本不出现**，旗标层据此整列
        标 `skipped`，而不是拿一份全 None 的数组算出"零告警"。
        """
        columns_info: list[dict[str, Any]] = []
        col_values_by_column: list[list[float]] = []

        for idx, col in enumerate(target_columns):
            c_idx = col.get("col_index", idx)
            c_name = col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"

            scale = resolve_column_scale(self, col, c_idx)
            declared_max = scale.declared_max

            # Pixel mapping
            pts = (
                self.column_points.get(c_idx, [])
                if hasattr(self, "column_points")
                else []
            )
            p_dict = {p["row"]: p["x"] for p in pts}

            # 与导出同一个读取入口，差异只由 profile 表达：QA 允许未标定列粗算
            # （否则"该列没标定"这条提醒永远不触发）且保留全精度（门限判定不该被取整影响）。
            # 这个差异现在是**显式命名**的，不再是散落在调用处的两个参数。
            baseline_px = float(scale.abs_px0)
            c_vals = read_column_values(
                scale,
                [p_dict.get(r, baseline_px) for r in horizon_rows],
                profile=READ_PROFILE_QA,
                col_name=c_name,
            )

            col_values_by_column.append(c_vals)

            # 逐行旗标（#91/#92）的几何输入。**只搬已有事实，不补任何默认值**：
            # 缺一个键，`compute_qa_flags` 就把该列整列跳过，而不是拿列宽或 0 顶替。
            ctrl_cols = set(getattr(self, "control_point_columns", None) or ())
            anchor_cols = set(getattr(self, "control_points", None) or ())
            axis_px, _axis_source = _explicit_axis_stroke(
                col, _resolve_column_group(self, col)
            )
            right_raw = col.get("endX", col.get("end"))
            # 逐行序列只用**有 x 的行**：没有 x 的行本来就不参与任何几何判定。
            # 成对读数（#99）按同一份行集摊平，两个列表因此与 `rows_px` 逐位对齐。
            measured_pts = [p for p in pts if p.get("x") is not None]
            inner_xs, outer_xs = paired_layer_xs(measured_pts)

            column_info: dict[str, Any] = {
                "name": c_name,
                "declared_max": declared_max,
                "col_values": c_vals,
                "calibrated": scale.calibrated,
                # 只有百分比列进"总和 ≤ 100%"这道门：浓度/粒数/比值的量级完全不同，
                # 混进来会让告警恒为假阳性（现场：最大总和 87135.2%）。
                # 判据见 `tests/unit/test_qa_composition_units.py`。
                "include_in_sum": _is_percent_unit(scale.unit),
                # --- 以下供逐行旗标使用（`straditize_core/qa.py::compute_qa_flags`）---
                # 原始像素序列。由控制点插值合成的列（`_rebuild_column_points_from_anchors`
                # 写进 `control_point_columns`）x 是 `np.interp` 出来的，不是读数；
                # 拿它算跨度会得到"看起来正常"的假跨度，所以整列标成 control_point，
                # 旗标层据此整列 skipped。
                "rows_px": [int(p["row"]) for p in measured_pts],
                "xs_px": [float(p["x"]) for p in measured_pts],
                "points_provenance": (
                    "control_point" if c_idx in ctrl_cols else "measured"
                ),
                "anchor_edited": c_idx in anchor_cols,
                "zero_px": baseline_px,
                # 0 点落在轴线带内 = 0 点被人为写偏（`_scale_from_ticks` 的判据）。
                # 盲区旗标拿它当分母，这种列整列标 skipped，原因见 `qa.py`。
                "origin_suspect": bool(scale.origin_suspect),
                "right_px": (
                    float(right_raw) if right_raw is not None else None
                ),
                "axis_px": axis_px,
                "plot_type": scale.plot_type,
                "exaggeration_mult": scale.exaggeration_mult,
            }
            # 内线 / 外线成对读数（#99）：**整列一行都没有时省略这两个键**。
            # 全 None 的数组会被旗标层算成"已判定、零告警"，与"没有读数"混为一谈；
            # 省略键则整列标 `skipped(no_paired_inner_outer_readings)`。
            # 缺失（单层列 / 外线整列断裂 / 旧工程未重新数字化 / 控制点插值列）是
            # 正常状态，见 `layers.py` 的模块 docstring。
            if any(value is not None for value in inner_xs):
                column_info[INNER_XS_KEY] = inner_xs
                column_info[OUTER_XS_KEY] = outer_xs
            columns_info.append(column_info)
        return columns_info, col_values_by_column
