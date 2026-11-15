# -*- coding: utf-8 -*-
"""取样窗口最后一行必须有真实读数，不得回落成"列左缘"。

## 缺陷

_roi_mask 用排他切片 mask[y0:y1, x0:x1]，而下游 _read_column_profile 用闭区间
（mask[y0:y1+1] 与 for row_y in range(y0, y1+1)）。两者不一致的直接后果：
_extraction_mask 把 ROI 最后一行整行清零 → 该行 fg_indices 为空 → 回落
feat_x = float(c_start)，最后一行读数恒等于列左缘（等价于 0%）。

实测：4 列工程包 row 1651（= data_ylim 下界）的 x 全部等于各自 c_start。

## 判据

1. 最后一行必须出现在读数里；
2. 最后一行读数不得等于 c_start（那是"没有墨迹"的哨兵值）；
3. 与倒数第二行**同口径**：实心块列上两行读数必须相等。

## 反向验证

把 _roi_mask 改回排他切片 mask[y0:y1, x0:x1]，本文件必须变红。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession

W, H = 140, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W
BLOCK_X1 = 55
Y0, Y1 = 50, 150
SLOPE = 1.0


def _plate(path) -> None:
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0:AXIS_X0 + AXIS_W] = 0
    img[:, ZERO_X:BLOCK_X1 + 1] = 0
    Image.fromarray(img).save(path)


def _session(tmp_path):
    plate = tmp_path / "full_height_block.png"
    _plate(plate)
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
            "tickValue": SLOPE,
            "tickEndX": float(ZERO_X + 1),
            "axis_stroke_px": AXIS_W,
        }
    ]
    session.rois = {}
    session.roi = None
    session.data_ylim = [float(Y0), float(Y1)]
    return session


def test_last_row_has_a_real_reading(tmp_path):
    session = _session(tmp_path)
    result = session.digitize(0, reader_type="area")
    points = {int(p["row"]): float(p["x"]) for p in result["points"]}
    assert Y1 in points, "取样窗口最后一行必须出现在读数里"
    last = points[Y1]
    prev = points[Y1 - 1]
    assert last != float(AXIS_X0), (
        "最后一行回落成了列左缘（c_start=%d），说明 ROI 那行被整行清零了" % AXIS_X0
    )
    assert abs(last - prev) <= 0.2, (
        "最后一行必须与倒数第二行同口径：last=%.1f prev=%.1f" % (last, prev)
    )
    assert abs(last - float(BLOCK_X1)) <= 0.2, (
        "最后一行应读到块体右缘 %.1f，实得 %.1f" % (float(BLOCK_X1), last)
    )
