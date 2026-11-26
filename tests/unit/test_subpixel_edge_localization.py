# -*- coding: utf-8 -*-
"""Unit tests for sub-pixel edge localization and exaggerated glue fallback."""

from __future__ import annotations

import numpy as np
import pytest

from straditize_core.digitize import (
    compute_column_luminance_levels,
    subpixel_edge_offset,
)
from straditize_core.session import StraditizeSession


def test_subpixel_edge_synthetic_falling_edge():
    # 模拟背景亮度 240，墨迹亮度 20
    l_bg = 240.0
    l_fg = 20.0
    # x=10 处灰度 130，浓度 I = (240 - 130) / (240 - 20) = 110 / 220 = 0.50 (恰好半高)
    gray_row = np.array(
        [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 130, 240, 240], dtype=float
    )
    x_sub = subpixel_edge_offset(
        gray_row, x_right=10, l_bg=l_bg, l_fg=l_fg, zero_offset=1.0
    )
    assert abs(x_sub - 10.0) < 1e-2


def test_subpixel_edge_quarter_step():
    l_bg = 240.0
    l_fg = 20.0
    # x=10 处灰度 75 (I = 0.75), x=11 处灰度 185 (I = 0.25) -> delta = 0.5 -> x_sub = 10.5
    gray_row = np.array(
        [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 75, 185, 240], dtype=float
    )
    x_sub = subpixel_edge_offset(
        gray_row, x_right=10, l_bg=l_bg, l_fg=l_fg, zero_offset=1.0
    )
    assert abs(x_sub - 10.5) < 1e-2


def test_subpixel_edge_smooth_gradient_no_staircase():
    # 构造一条在 y 轴连续变化的斜坡边缘，验证 subpixel_edge_offset 输出严格连续，绝无整数阶梯
    l_bg, l_fg = 255.0, 0.0
    outputs = []
    # 固定 x=10 处浓度 i10 = 0.80，x=11 处浓度从 0.05 升至 0.40（墨迹右侧逐渐变浓）
    for i11 in np.linspace(0.05, 0.40, 10):
        g10 = int(round(255 * (1.0 - 0.80)))
        g11 = int(round(255 * (1.0 - i11)))
        gray = np.array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, g10, g11, 255], dtype=float)
        val = subpixel_edge_offset(
            gray, x_right=10, l_bg=l_bg, l_fg=l_fg, zero_offset=1.0
        )
        outputs.append(val)
    diffs = np.diff(outputs)
    assert np.all(diffs >= 0.0)
    assert len(set(np.round(outputs, 3))) == 10


def test_subpixel_edge_zero_pollen_strict_clamp():
    # 无花粉层位：x_right <= zero_offset (如 1.0px) 必须严格返回 zero_offset，绝无亚像素向右偏置
    gray_row = np.array([20, 100, 240, 240], dtype=float)
    x_sub = subpixel_edge_offset(
        gray_row, x_right=1, l_bg=240.0, l_fg=20.0, zero_offset=1.0
    )
    assert x_sub == 1.0


def test_compute_column_luminance_levels():
    band = np.full((50, 20), 220, dtype=np.uint8)
    band[:, :5] = 30
    l_bg, l_fg = compute_column_luminance_levels(band)
    assert l_bg >= 210.0
    assert l_fg <= 40.0


def test_digitize_subpixel_points_are_float():
    # 验证真实图版数字化后，points 中的 x 坐标具有真正的浮点精度，而非整数
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(
        image_path="tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
    )
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    res = session.digitize(0, reader_type="area")
    xs = [p["x"] for p in res["points"]]
    # 存在非整数的浮点采样点
    fractional = [x for x in xs if not float(x).is_integer()]
    assert len(fractional) > 50, (
        f"期望多数采样点具有亚像素小数位，实际只有 {len(fractional)} 个"
    )


def test_subpixel_edge_below_zero_offset_not_lifted():
    # x_right < zero_offset（如 1px 轴线 x_right=0，stroke=2.0）必须保持 float(x_right)，严禁抬高到 zero_offset
    gray_row = np.array([20, 235, 250, 255], dtype=float)
    assert (
        subpixel_edge_offset(
            gray_row, x_right=0, l_bg=255.0, l_fg=20.0, zero_offset=2.0
        )
        == 0.0
    )
    assert (
        subpixel_edge_offset(
            gray_row, x_right=1, l_bg=255.0, l_fg=20.0, zero_offset=2.0
        )
        == 1.0
    )


def test_empty_row_does_not_get_lifted_by_zero_offset():
    # 无前景行（全白）必须停在 c_start，不能被 zero_offset=float(stroke) 抬高成假读数
    sess = StraditizeSession()
    sess._init_cleanup()
    sess.height, sess.width = 10, 30
    mask = np.zeros((10, 30), dtype=bool)
    mask[0:5, 5:7] = True  # 前 5 行有 2px 轴线，后 5 行完全空白
    pts = sess._read_column_profile(
        mask, c_start=5, c_end=25, y0=0, y1=10, reader_type="area", zero_offset=2.0
    )
    assert pts[7]["x"] == 5.0
