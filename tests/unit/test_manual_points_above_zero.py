# -*- coding: utf-8 -*-
"""手工控制点落在 0 点左侧时必须拒绝（不静默钳制）。

0 点 = 列左缘 + 轴粗（ARCHITECTURE 6.4，画布绿线）。x 严格小于 0 点等于负读数，
用户口径是"图上不该存在"。但 x == 0 点必须放行：丰度 0 是合法数据。

两条入口各一条用例：core.updateControlPoint（单点）、column.setControlPoints（整列）。
反向验证：去掉 _reject_below_zero_point 调用，两条必须红。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

W, H = 140, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W  # 16
BLOCK_X1 = 55
Y0, Y1 = 50, 150
ROW = Y0 + 10


def _session(tmp_path):
    plate = tmp_path / "block.png"
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0
    img[:, ZERO_X : BLOCK_X1 + 1] = 0
    Image.fromarray(img).save(plate)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(plate))
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "block",
            "species": "block",
            "roi_id": None,
            "start": float(AXIS_X0),
            "startX": float(AXIS_X0),
            "end": float(W),
            "endX": float(W),
            "plot_type": "area",
            "scale_type": "linear",
            "unit": "%",
            "startValue": 0.0,
            "tickValue": 1.0,
            "tickEndX": float(ZERO_X + 1),
            "axis_stroke_px": AXIS_W,
        }
    ]
    session.rois = {}
    session.roi = None
    session.data_ylim = [float(Y0), float(Y1)]
    session.digitize(0, reader_type="area")
    return session


def test_update_control_point_rejects_point_left_of_zero(tmp_path):
    session = _session(tmp_path)
    with pytest.raises(JsonRpcError) as exc:
        session.update_control_point(0, ROW, float(ZERO_X - 2))
    assert exc.value.code == -32602, "必须是 INVALID_PARAMS（-32602）"
    assert ("0 点在 x=%d" % ZERO_X) in str(exc.value.message), (
        "消息必须写明 0 点像素位置，便于用户自己核对：%r" % str(exc.value.message)
    )


def test_update_control_point_accepts_exactly_zero(tmp_path):
    session = _session(tmp_path)
    session.update_control_point(0, ROW, float(ZERO_X))  # 不得抛
    assert session.control_points[0][ROW] == float(ZERO_X)


def test_set_control_points_rejects_point_left_of_zero(tmp_path):
    session = _session(tmp_path)
    with pytest.raises(JsonRpcError) as exc:
        session.set_control_points(
            0,
            [
                {"row": Y0, "x": float(BLOCK_X1), "manual": True},
                {"row": ROW, "x": float(ZERO_X - 2), "manual": True},
                {"row": Y1, "x": float(BLOCK_X1), "manual": True},
            ],
        )
    assert exc.value.code == -32602
    assert ("0 点在 x=%d" % ZERO_X) in str(exc.value.message)


def test_set_control_points_accepts_exactly_zero(tmp_path):
    session = _session(tmp_path)
    session.set_control_points(
        0,
        [
            {"row": Y0, "x": float(ZERO_X), "manual": True},
            {"row": Y1, "x": float(BLOCK_X1), "manual": True},
        ],
    )
    assert session.control_points[0][Y0] == float(ZERO_X)
