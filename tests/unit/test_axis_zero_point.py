# -*- coding: utf-8 -*-
"""零点必须锚定在灰色 Y 轴线的**右缘**，而不是左缘。

## 缺陷（用户实测反馈）

画布上的蓝色零点标记落在灰色 Y 轴线的**左侧**，与底图刻度齿对不齐。用户原话：

> 正确的零点位置：请观察灰色粗线的右侧边缘或正中心。下方 X 轴的刻度线
> （像小钉子一样）是紧贴着灰色 Y 轴右侧边缘开始的。在绝大多数科研绘图软件
> （如 Origin、R、Python）中，坐标轴的原点要么在轴线中心，要么在轴线与刻度
> 对齐的内侧/右侧。

## 根因

`detect_column_bounds` 返回的 `start` 是该列第一个暗像素，也就是轴线**左缘**。
直接拿它当零点会有两个后果：

1. 轴线自身（实测逐列宽 0~6px 不等）被当成"满值墨迹"读入，造成**逐列不同的
   系统性左偏**；
2. 零点标记落在灰线左侧，与刻度齿对不齐。

## 修法

`measure_axis_right_edge()` 逐列测量轴线宽度（相对起点），把零点推到右缘。
宽度逐列不同，因此**不能**用固定偏移。

## 反向哨兵（防过度偏移）

本图 col10/col11 起点处暗占比 0.98 一直延续 15px 以上 —— 那不是细轴线，而是
**整块实心填充**（岩性柱/色块）。对这类列必须返回 0（零点保持起点），
否则会把整块填充读成偏移量，反而更错。
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from straditize_core.columns import measure_axis_right_edge


class TestMeasureAxisRightEdge:
    """纯函数层：轴线宽度测量与实心块排除。"""

    def test_thin_axis_returns_its_width(self) -> None:
        """细轴线：偏移量 = 轴线宽度，零点落在右缘。"""
        # 20 行高；x=0..2 是实心轴线，x>=3 是空白
        binary = np.zeros((20, 10), dtype=bool)
        binary[:, 0:3] = True

        offsets = measure_axis_right_edge(binary, [0])

        assert offsets == [3], f"轴线宽 3px，偏移应为 3，实得 {offsets}"

    def test_no_axis_returns_zero(self) -> None:
        """起点本身不是实心：没有轴线，零点即起点。"""
        binary = np.zeros((20, 10), dtype=bool)
        binary[0:2, 0] = True  # 只有零星墨迹，不构成实心列

        offsets = measure_axis_right_edge(binary, [0])

        assert offsets == [0]

    def test_solid_block_returns_zero(self) -> None:
        """反向哨兵：整块实心填充（超过探测上限）必须返回 0，不得把填充读成偏移。"""
        binary = np.zeros((20, 40), dtype=bool)
        binary[:, 0:20] = True  # 20px 宽的实心块，远超 max_probe=8

        offsets = measure_axis_right_edge(binary, [0], max_probe=8)

        assert offsets == [0], (
            "实心块列必须返回 0（零点保持起点）；"
            "把整块填充读成偏移量会让零点落进色块内部"
        )

    def test_per_column_widths_are_independent(self) -> None:
        """逐列宽度不同时必须逐列测量，不能用同一个固定偏移。"""
        binary = np.zeros((20, 40), dtype=bool)
        binary[:, 0:2] = True   # 第 1 列轴线宽 2
        binary[:, 10:13] = True  # 第 2 列轴线宽 3

        offsets = measure_axis_right_edge(binary, [0, 10])

        assert offsets == [2, 3], f"逐列宽度必须各自测量，实得 {offsets}"

    def test_empty_input_is_safe(self) -> None:
        assert measure_axis_right_edge(np.zeros((0, 0), dtype=bool), []) == []
        assert measure_axis_right_edge(np.zeros((5, 0), dtype=bool), [0]) == [0]


REAL_PLATE = "output/han2026_ngamring/fig3_raw.jpeg"


@pytest.mark.skipif(
    not os.path.exists(REAL_PLATE),
    reason="真实图版不在本机（output/ 不入库），需 fig3_raw.jpeg 才能验真",
)
class TestRealPlateZeroPoint:
    """真实图版上：分列后每列零点必须落在灰线右缘（或实心块左缘）。"""

    def test_zero_point_never_inside_axis_line(self) -> None:
        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        session._init_cleanup()
        # 显式开启零点右缘锚定（默认关闭，见 core.py 的说明：filled-silhouette
        # 图无法与真轴线区分，无条件开启会让 Aber 精度从 0.9866 掉到 0.8957）。
        session.anchor_zero_at_axis_right = True
        session.load_image(image_path=REAL_PLATE)
        session._init_rois()
        session.roi_create(
            name="pollen", x0=330, x1=1330, y0=233, y1=869, composition=True
        )
        session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])

        gray = np.asarray(session.image.convert("L"))
        dark = gray < 160
        y0, y1 = 233, 869

        offenders = []
        for index, column in enumerate(session.columns):
            start_x = int(column["start"])
            if start_x <= 0 or start_x >= gray.shape[1]:
                continue
            current = dark[y0:y1, start_x].mean()
            if current <= 0.9:
                # 零点已不在实心区 → 合法（灰线右缘或空白起点）
                continue
            # 零点本身是实心：必须区分「细灰线内部」与「整块填充左缘」。
            # 向右探测这段实心有多宽：很快脱离（<= 8px）= 细灰线，零点应已推过 → 违规；
            # 一直实心（> 8px）= 实心块，零点保持起点是正确的 → 合法。
            solid_width = 0
            for probe in range(8):
                x = start_x + probe
                if x >= gray.shape[1] or dark[y0:y1, x].mean() <= 0.9:
                    break
                solid_width = probe + 1
            if solid_width < 8:
                offenders.append(
                    {
                        "col": index + 1,
                        "startX": column["start"],
                        "solid_width": solid_width,
                    }
                )

        assert offenders == [], (
            f"零点仍落在细灰线内部（未推到右缘）：{offenders}。"
            "这会让每列系统性左偏 0~6px，且画布零点与底图刻度齿对不齐。"
        )
