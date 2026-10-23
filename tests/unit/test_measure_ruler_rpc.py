# -*- coding: utf-8 -*-
"""`algorithm.measureRuler` 的契约测试。

该接口只测量刻度尺**几何**，用于让 Step 6 显示"本 ROI 共 N 列 / 中位刻距 X px /
各列格数"——帮助用户**发现**哪些列没有印刷数字，而**不是**用来生成读数。

最重要的断言在 `TestNoSuggestions`：这个接口必须一个校准数字都不产出。
"""
from __future__ import annotations

import numpy as np
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.ruler import MIN_TICK_HEIGHT, TICK_SEARCH_BELOW
from straditize_core.session import StraditizeSession


def _make_diagram(
    session: StraditizeSession,
    *,
    width: int = 200,
    height: int = 140,
    axis_y: int = 120,
    column_spans: tuple[tuple[int, int], ...] = ((10, 60), (70, 120)),
    ticks_per_column: int = 4,
) -> str:
    """Draw a two-column diagram with measured rulers; return the ROI id."""
    from PIL import Image

    gray = np.full((height, width), 255, dtype=np.uint8)
    gray[axis_y, :] = 0  # 轴线
    below = TICK_SEARCH_BELOW
    for x0, x1 in column_spans:
        step = max(3, (x1 - x0) // ticks_per_column)
        for i in range(ticks_per_column):
            x = x0 + i * step
            if x >= x1:
                break
            depth = (below[1] - below[0]) if i % 2 == 0 else MIN_TICK_HEIGHT + 1
            for dy in range(below[0], min(below[0] + depth, below[1])):
                gray[axis_y + dy, x] = 0

    img = Image.fromarray(gray).convert("RGBA")
    session.image = img
    session.image_array = np.array(img)
    session.width, session.height = width, height
    session.format, session.mode = "PNG", "RGBA"

    session._init_rois()
    roi = session.roi_create(name="probe", x0=0, x1=width, y0=0, y1=height)
    roi_id = roi["roi"]["id"]
    session.roi_set_primary(roi_id)
    session.roi_set_active(roi_id)

    session.columns = []
    for i, (x0, x1) in enumerate(column_spans):
        session.column_add({"name": f"c{i}", "species": f"c{i}",
                            "startX": float(x0), "endX": float(x1)})
        session.column_update(i, {"roi_id": roi_id,
                                  "start": float(x0), "end": float(x1),
                                  "startX": float(x0), "endX": float(x1)})
    return roi_id


class TestGeometryContract:
    def test_reports_every_column(self) -> None:
        s = StraditizeSession()
        _make_diagram(s)
        res = s.measure_ruler_geometry()
        assert len(res["per_column"]) == 2
        assert res["roi_id"]
        for col in res["per_column"]:
            assert set(col) >= {"col_index", "name", "axis_row", "ticks",
                                "n_cells", "spacing_px", "regular"}

    def test_axis_row_matches_synthetic_axis(self) -> None:
        s = StraditizeSession()
        _make_diagram(s, axis_y=120)
        res = s.measure_ruler_geometry()
        assert all(c["axis_row"] == 120 for c in res["per_column"])

    def test_cell_counts_are_positive(self) -> None:
        s = StraditizeSession()
        _make_diagram(s, ticks_per_column=4)
        res = s.measure_ruler_geometry()
        assert all(c["n_cells"] >= 1 for c in res["per_column"])

    def test_median_spacing_is_reported(self) -> None:
        s = StraditizeSession()
        _make_diagram(s)
        res = s.measure_ruler_geometry()
        assert res["median_spacing_px"] is not None
        assert res["median_spacing_px"] > 0


class TestNoSuggestions:
    """接口**不得**产出任何校准数字（这是 B-01 那类缺陷的防线）。"""

    def test_calibration_suggestions_always_empty(self) -> None:
        s = StraditizeSession()
        _make_diagram(s)
        res = s.measure_ruler_geometry()
        assert res["calibration_suggestions"] == [], (
            "measureRuler 产出了建议读数 —— 每格数值是作图书版设定，图上无法推得；"
            "实测跨列外推误差 84%–151%（见 docs/findings/defects-from-real-figure.md）"
        )

    def test_note_explains_refusal(self) -> None:
        s = StraditizeSession()
        _make_diagram(s)
        res = s.measure_ruler_geometry()
        assert res["note"], "拒绝产出读数时必须写明理由，否则前端无法向用户解释"
        assert "不产出" in res["note"] or "无法推" in res["note"]


class TestErrorPaths:
    def test_no_image_raises_state_error(self) -> None:
        s = StraditizeSession()
        with pytest.raises(JsonRpcError) as exc:
            s.measure_ruler_geometry()
        assert exc.value.code == -32001

    def test_no_columns_raises_state_error(self) -> None:
        """有图但没有列时，应明确报"先去步骤 5 分列"，而不是返回空结果。"""
        s = StraditizeSession()
        _make_diagram(s, column_spans=((10, 60),))  # 先建一列拿到 ROI
        s.columns = []  # 再清空，模拟"未分列"
        with pytest.raises(JsonRpcError) as exc:
            s.measure_ruler_geometry()
        assert exc.value.code == -32001
        assert "分列" in exc.value.message
