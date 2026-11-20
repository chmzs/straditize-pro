# -*- coding: utf-8 -*-
"""控制点不得落在红线（列左缘）与绿线（0 点）之间。

用户口径：c_start < x < c_start + stroke 的点代表负/零读数，图上不该存在。
判据不是"x >= c_start"（那只是下界），而是 **x >= c_start + resolve_axis_stroke(col, group)**。

## 覆盖的四条产出路径

1. 逐行轮廓采样后的拐点：profile 先 clip 到 min_width（= 轴粗）再抽点；
2. 首末端点 y0_x / y1_x：同样走 max(min_width, points.x - c_start)；
3. _interpolate_across_hlines 的中途改写：只改 points 的 x，之后仍过同一次 clip；
4. 手工点（update_control_point / setControlPoints）：**不钳制**（见 PR 说明的已知缺口）。

## 反向验证

把 _turning_control_points 里 np.clip(profile, min_width, None) 的下界改成 0.0，
本文件必须变红（那些"只有轴线"的行会产出 x = c_start + 5 < c_start + 6 的控制点）。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_axis_stroke

W, H = 120, 160
AXIS_X0, AXIS_W = 12, 6
ZERO_X = AXIS_X0 + AXIS_W
FILL_END = 60
Y0, Y1 = 20, 120


def _plate(path) -> None:
    """轴 6px；row 20..120 有填充到 x=60；其余行只有轴线（读数应为 0 = 0 点）。"""
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0
    # 填充只覆盖 60..100 行：20..59 行整行只有轴线 ⇒ 读数应恰好是 0 点，
    # 这正是"控制点落进轴线区间"最容易出现的地方。
    img[60:101, AXIS_X0 : FILL_END + 1] = 0
    Image.fromarray(img).save(path)


def _session(tmp_path):
    plate = tmp_path / "axis_interval.png"
    _plate(plate)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(plate))
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "c0",
            "species": "c0",
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
    return session


def test_no_control_point_between_left_edge_and_zero_point(tmp_path):
    session = _session(tmp_path)
    result = session.digitize(0, reader_type="area")
    ctrl = session.control_points[0]
    assert ctrl, "合成图必须产出控制点"
    stroke = resolve_axis_stroke(session.columns[0], None)
    zero_px = AXIS_X0 + stroke
    offenders = {row: x for row, x in sorted(ctrl.items()) if x < zero_px - 1e-9}
    assert offenders == {}, (
        "控制点落在红线与绿线之间（等价负读数）：%r；0 点 = %.1f" % (offenders, zero_px)
    )
    # 端点也一样（它们在 result 里单独下发）
    for point in result["control_points"]:
        assert point["x"] >= zero_px - 1e-9, "端点 %r 落在 0 点左侧" % (point,)


def test_profile_rows_without_data_read_as_zero_point(tmp_path):
    """整行只有轴线的行（row 10 之类）读数必须是 0 点，不是列左缘。"""
    session = _session(tmp_path)
    session.digitize(0, reader_type="area")
    points = {int(p["row"]): float(p["x"]) for p in session.column_points[0]}
    stroke = resolve_axis_stroke(session.columns[0], None)
    # 只取窗口内部行：窗口**最后一行**恒回落 c_start（连通域标注少一行），
    # 那是独立缺陷，判据与修复在 fix/step7-last-row-profile。
    for row in (Y0, 40, Y1 - 1):
        assert points[row] >= AXIS_X0 + stroke - 1.0, (
            "row %d 的采样点 x=%.1f 落进轴线区间（0 点 = %.1f）"
            % (row, points[row], AXIS_X0 + stroke)
        )
