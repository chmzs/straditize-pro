# -*- coding: utf-8 -*-
"""清除一条干扰线之后，导出读数必须跟着变（S2 现场缺陷：手动清除横线无效）。

## 缺陷背景

`column_points`（逐行点集）是导出/QA/年代模型**唯一**的取数源，只在 `core.digitize`
时写入。步骤 4 的「确认干扰线 / 排除区 / 笔迹擦除」只改掩膜、不碰这个字典，于是：

    掩膜删掉 11335 个像素（`removed_line_pixels` 有数）、`columns_stale=True`，
    而 `data.csv` 的读数一字不变 —— 用户看到的是"清除线无效"。
    （现场实测：`.recon_20261117`，depth 10.227 的 Picea 清线前后都是 13.5714 = 满量程。）

## 判据

合成图：轴线 x10..15（0 点 = 16）、实心块到 x=40（真值 24.0）、一条**横贯到 x=90** 的
区带线在 y100..102。线所在行「整行最右墨迹」是 90 ⇒ 脏读数 74.0。

1. 清线前：y=101 的读数 ≈ 74（脏值，证明干扰真实存在）；
2. 清线后：y=101 的读数必须回到块体边缘 ≈ 24（差值 ≤ 0.2）；
3. 不受影响的行（y=70）清线前后必须**逐值相等**（不许"顺手把别的行也改了"）。

## 反向验证

去掉 `cleanup._recompose` 里那句 `_invalidate_digitized_points(roi_id)`，判据 2 变红
（读数停在 74.0）。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession

W, H = 120, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W  # 16
BLOCK_X1 = 40  # 实心块右缘（真值 24.0，斜率 1.0）
LINE_X0 = 30  # 区带线左端：**压在块体上**（与曲线相连 ⇒ 同一个连通域，才会真的污染读数）
LINE_X1 = 90  # 区带线右端：越过块体 50px ⇒ 脏读数 74.0
LINE_Y0, LINE_Y1 = 100, 102
SLOPE = 1.0
HORIZON_ROWS = (40, 70, 101, 130)


def _synthetic_plate(path) -> None:
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0  # 列轴线
    img[:, ZERO_X : BLOCK_X1 + 1] = 0  # 实心块（通高，与轴线相连）
    # 区带线压在曲线上并越过到 x=90：真实图上的区带线就是"横穿曲线、延伸到列内空白"
    img[LINE_Y0 : LINE_Y1 + 1, LINE_X0 : LINE_X1 + 1] = 0
    Image.fromarray(img).save(path)


def _session(tmp_path):
    plate = tmp_path / "line_removal_plate.png"
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
            # 两点刻度（source="x_ticks"）是唯一能让导出给出数值的标定形式；
            # 只写 tickValue 会落进 legacy 分支（calibrated=False ⇒ 导出 NA）。
            "x_ticks": [
                {"px": float(ZERO_X), "value": 0.0},
                {"px": float(ZERO_X + 10), "value": 10.0 * SLOPE},
            ],
            "axis_stroke_px": float(AXIS_W),
            "points": [],
        }
    ]
    # 合成单 ROI（`upsert_line_geometry` 要按 ROI 归位几何；rois 为空时查不到）
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "name_source": "default",
            "composition": True,
            "visible": True,
            "xlim": [0, W],
            "ylim": [0, H - 1],
            "columns_stale": False,
            "form_defaults": None,
            "x_groups": [],
            "default_group_id": None,
        }
    ]
    session.primary_roi_id = "roi_1"
    session.roi = None
    session.data_xlim = [0, W]
    session.data_ylim = [0, H - 1]
    session.is_calibrated = True
    session.y_scale = {"slope": 0.5, "intercept": 0.0}
    session.samples_set(
        [
            {"row_px": row, "depth": 0.5 * row, "source": "manual"}
            for row in HORIZON_ROWS
        ]
    )
    return session


def _readings(session) -> dict[str, str]:
    result = session.export_data("csv")
    text = result.get("csv") or result.get("csv_content") or ""
    lines = [line for line in text.strip().splitlines() if line.strip()]
    return {line.split(",")[0]: line.split(",")[1] for line in lines[1:]}


def test_removing_a_line_changes_the_exported_reading(tmp_path) -> None:
    session = _session(tmp_path)
    session.digitize(0, "area")
    before = _readings(session)

    # 脏读数：线把"整行最右墨迹"顶到 x=90 ⇒ (90-16)*1.0 = 74
    assert float(before["50.5"]) == 74.0, f"前置：线所在的层位应先读到脏值，实际 {before}"

    session.upsert_line_geometry(
        roi_id=None,
        geometry={"x0": LINE_X0, "y0": LINE_Y0 - 1, "x1": LINE_X1, "y1": LINE_Y1 + 1},
        axis="h",
        selected=True,
    )
    after = _readings(session)

    # 判据只要求「不再是线的量程」：清除几何覆盖整条线时该行墨迹被清空 ⇒ 0.0；
    # 若只覆盖线的外段则回到块体边缘 24.0。两者都合法，**74.0 不合法**。
    assert float(after["50.5"]) < float(before["50.5"]) - 1.0, (
        "清线后读数必须变（当前 {}，清线前 {}）".format(after["50.5"], before["50.5"])
    )
    # 未受影响的行必须逐值相等（只清理被线污染的那几行，不无差别重算整列）
    assert after["35.0"] == before["35.0"]
    assert after["20.0"] == before["20.0"]


def test_invalidation_only_touches_the_edited_roi(tmp_path) -> None:
    """作废点集必须按 ROI 限定：另一个 ROI 的点不能跟着消失。"""
    session = _session(tmp_path)
    session.digitize(0, "area")
    session.column_points[7] = [{"row": 1, "x": 16.0}]
    session.upsert_line_geometry(
        roi_id=None,
        geometry={"x0": LINE_X0, "y0": LINE_Y0, "x1": LINE_X1, "y1": LINE_Y1},
        axis="h",
        selected=True,
    )
    assert 7 in session.column_points, "别的 ROI / 别的列的点不许被一起作废"
