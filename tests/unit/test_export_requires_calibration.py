"""没有 Y 轴标定就不许导出。

理由：没有深度就没有可交付的剖面。此前有两条"未标定也能出数"的形态——
把像素行号写进 `depth` 列（用单位撒谎），以及后来的 `depth` 全空 + `row_px` 列。
两者都让下游拿到一张看起来合法的表。步骤 3 本来就在导出之前，这个门槛不会挡住正常流程。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import CALIBRATION_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def _digitized_but_uncalibrated() -> StraditizeSession:
    session = StraditizeSession()
    session.columns = [{"name": "A", "col_index": 0, "start": 100, "end": 200}]
    session.control_points = {0: {100: 120.0, 200: 140.0}}
    session.column_points = {0: [{"row": 100, "x": 120.0}, {"row": 200, "x": 140.0}]}
    session.is_calibrated = False
    session.y_scale = None
    return session


def test_export_requires_y_calibration() -> None:
    session = _digitized_but_uncalibrated()
    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data("csv")
    assert excinfo.value.code == CALIBRATION_ERROR
    message = str(excinfo.value)
    assert "步骤 3" in message and "标定" in message, message


def test_union_points_dataset_also_refuses_without_calibration() -> None:
    session = _digitized_but_uncalibrated()
    with pytest.raises(JsonRpcError):
        session.export_data("csv", dataset="union_points")
