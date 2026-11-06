"""QA session mixin (T09: Verification gate and geological quality diagnostics).

Strictly adheres to Frozen Contracts v1.3 §2.7 (QaSummary) and §4 (Derived Quantities).
"""

from __future__ import annotations

from typing import Any

from ..protocol import JsonRpcError
from ..qa import compute_qa_summary
from .xscale import READ_PROFILE_QA, read_column_values, resolve_column_scale


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
            columns_info.append(
                {
                    "name": c_name,
                    "declared_max": declared_max,
                    "col_values": c_vals,
                    "calibrated": scale.calibrated,
                }
            )
        return columns_info, col_values_by_column
