# -*- coding: utf-8 -*-
"""测试统一参考标尺物理跨度 (Group Scale / Reference Ruler) 刚体平移与边界守卫。

## 背景与缺陷
在花粉图（riojaPlot / Tilia）紧凑排版中：
部分小属种（如含量 <2%）切出的列宽非常窄（例如 14px）。
但花粉图整组的物理刻度模数（如 0~20% 对应 40px）在同组中是全局统一的。

旧后端的 `hi = max(c_start, c_end) + 10` 机械地卡死标尺刻度不能超过当前列宽：
对于 14px 的窄列，hi 只有 24px，导致合法的 40px 标尺无法应用，报：
`参数范围越界：刻度点像素超出该列物理范围`。
前端因而被迫降级为拿每列自己的 endX 硬套数值，导致窄列被压缩、全图标尺全体偏差。

## 修正后的物理判据
1. 起点 px0 必须锚定在当前列起始基线附近（c_start ± 15px）；
2. 终点 px1 必须位于 px0 右侧，并允许延伸至合理标尺跨度范围内（不机械受限于狭窄列宽）；
3. 荒谬越界（如越出图像右侧）依然被坚固拦截。
"""

import pytest
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession


def _setup_narrow_column_session():
    """构造一个包含狭窄列 (14px 宽) 的会话。"""
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s._init_rois()
    roi = s.roi_create(name="pollen", x0=300, x1=600, y0=200, y1=600, composition=True)["roi"]
    # 手动注入一个 14px 宽的狭窄列模拟真实古生态紧凑图版
    s.columns = [
        {
            "id": "roi_1_col01",
            "roi_id": roi["id"],
            "col_index": 0,
            "name": "NarrowTaxa",
            "start": 350.0,
            "end": 364.0,  # 宽仅 14px
            "startX": 350.0,
            "endX": 364.0,
            "unit": "%",
            "x_group_id": roi["default_group_id"],
        },
        {
            "id": "roi_1_col02",
            "roi_id": roi["id"],
            "col_index": 1,
            "name": "StandardTaxa",
            "start": 364.0,
            "end": 444.0,  # 宽 80px
            "startX": 364.0,
            "endX": 444.0,
            "unit": "%",
            "x_group_id": roi["default_group_id"],
        },
    ]
    return s


class TestGroupScaleRuler:
    def test_narrow_column_accepts_standard_ruler_span(self):
        """狭窄列 (14px) 必须能成功接收 40px 的标准组标尺刻度跨度。"""
        s = _setup_narrow_column_session()
        col = s.columns[0]
        start_px = col["start"]
        ruler_span = 40.0  # 40px 对应 20%

        res = s.calibrate_column_xticks(
            0,
            ticks=[
                {"px": start_px, "value": 0.0},
                {"px": start_px + ruler_span, "value": 20.0},
            ],
            unit="%",
        )

        assert res is not None
        assert col.get("x_ticks") is not None
        assert col["x_ticks"][0]["px"] == start_px
        assert col["x_ticks"][1]["px"] == start_px + ruler_span
        assert col["x_ticks"][1]["value"] == 20.0

    def test_anchor_too_far_from_baseline_still_rejected(self):
        """反向哨兵：刻度起点离当前列基线漂移超过 15px 时，依然必须拦截。"""
        s = _setup_narrow_column_session()
        col = s.columns[0]
        start_px = col["start"]

        with pytest.raises(JsonRpcError) as exc_info:
            s.calibrate_column_xticks(
                0,
                ticks=[
                    {"px": start_px - 30.0, "value": 0.0},  # 偏离基线 30px
                    {"px": start_px + 40.0, "value": 20.0},
                ],
                unit="%",
            )
        assert "参数范围越界" in str(exc_info.value)

    def test_reversed_ticks_still_rejected(self):
        """反向哨兵：刻度终点小于或等于起点时必须拦截。"""
        s = _setup_narrow_column_session()
        col = s.columns[0]
        start_px = col["start"]

        with pytest.raises(JsonRpcError) as exc_info:
            s.calibrate_column_xticks(
                0,
                ticks=[
                    {"px": start_px, "value": 20.0},
                    {"px": start_px - 10.0, "value": 0.0},  # 反向
                ],
                unit="%",
            )
        assert exc_info.value.code == -32602
