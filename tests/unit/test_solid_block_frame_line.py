# -*- coding: utf-8 -*-
"""实心块列 + 右侧图框线：读数必须取本列自己的墨迹，不能把图框线当成数据。

## 缺陷背景（真实工程包 col04，row 425）

工程包 straditize_project_1794746567262 的 col04 是一块实心柱：row 425 的前景掩膜
在列窗 x∈[1576,1807] 上是 (1576,1675) 与 (1798,1801) 两段——前一段是"轴线 +
实心块"（同一个连通域），后一段是图版的**右框线**，与块体隔着 122px 空白。
导出给的是 15.5% ＝ (1675 − 1582) × 0.166667（1582 = 列左缘 1576 + 轴粗 6），
而"取整行最右墨迹"会得到 (1801 − 1582) × 0.166667 = 36.5%，**差 21 个百分点**。

## 判据

area 读取器必须返回**本列连通域**的最右端：
(最右墨迹 − abs_px0) × slope 与真值（本例块宽 39px、斜率 1.0 → 39.0）差 <= 0.2。

## 反向验证

把 _own_run_last_offset 换成 fg_indices[-1]（"整行最右墨迹"的旧口径）后，
读数从 39 跳到 86，本文件必须变红。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession

W, H = 140, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W          # 16
BLOCK_X1 = 55                       # 块体右缘（含）
FRAME_X0, FRAME_W = 100, 4          # 图版右框线：独立连通域，距块体 45px
Y0, Y1 = 50, 150
SLOPE = 1.0


def _synthetic_plate(path) -> None:
    """轴(6px) + 通高实心块(x 16..55) + 右侧图框线(x 100..103)。

    块体做成**通高**：真实实心块列（如工程包 col04）本来就贯穿整个取样窗口，
    这样 y0/y1 两端不会引入"块体边界"这个额外变量。
    """
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0:AXIS_X0 + AXIS_W] = 0            # 列轴线
    img[:, ZERO_X:BLOCK_X1 + 1] = 0                 # 实心块（与轴线相连，通高）
    img[:, FRAME_X0:FRAME_X0 + FRAME_W] = 0         # 图框线（独立连通域，45px 外）
    Image.fromarray(img).save(path)


def _session(tmp_path):
    plate = tmp_path / "solid_block_with_frame.png"
    _synthetic_plate(plate)
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


def test_area_reader_takes_the_columns_own_ink_not_the_frame_line(tmp_path):
    session = _session(tmp_path)
    result = session.digitize(0, reader_type="area")
    points = {int(p["row"]): float(p["x"]) for p in result["points"]}
    assert points, "合成图必须产出读数"
    expected = float(BLOCK_X1 - ZERO_X) * SLOPE       # 39.0
    # 只断言窗口内部行：取样窗口的**最后一行**恒回落 c_start（读到列左缘），
    # 那是连通域标注少一行的既有问题，与本缺陷无关（真实工程包 4 列的最后一行
    # x 都等于各自 c_start）。已登记为已知风险，见 PR body。
    for row in (Y0, (Y0 + Y1) // 2, Y1 - 1):
        value = (points[row] - ZERO_X) * SLOPE
        assert abs(value - expected) <= 0.2, (
            "row %d: 读数 %.2f 期望 %.2f（读到 x=%.0f；取整行最右墨迹会得到 %.1f）"
            % (row, value, expected, points[row], (FRAME_X0 + FRAME_W - 1 - ZERO_X) * SLOPE)
        )
    assert max(points.values()) < FRAME_X0, "读数越过图框线：max x = %.0f" % max(points.values())
