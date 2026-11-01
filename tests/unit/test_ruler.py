# -*- coding: utf-8 -*-
"""刻度尺几何检测的回归测试。

两条主线：

1. **几何检测必须准**：合成图（真值已知）上，格数、刻距必须精确复现；
2. **绝不允许跨列外推读数**：这是一次真实事故的钉子，见
   :func:`straditize_core.ruler.suggest_scales` 的文档。

第 2 条比第 1 条重要。本项目曾试图"用户读一列 → 其余列按格数外推"，
在真实期刊图版上实测误差达 **−84% / +151%**，属于编造读数
（违反 ``docs/ARCHITECTURE.md`` §2）。这里把它焊死在测试里。
"""
from __future__ import annotations

import numpy as np
import pytest

from straditize_core.ruler import (
    MIN_TICK_HEIGHT,
    TICK_SEARCH_BELOW,
    detect_ruler,
    detect_ruler_for_columns,
    suggest_scales,
)


def _synthetic_column(
    *,
    width: int = 60,
    height: int = 120,
    axis_y: int = 100,
    ticks: tuple[int, ...] = (5, 17, 29, 42),
    major_every: int = 2,
) -> np.ndarray:
    """Draw a white column with a bottom axis and ticks hanging **below** it.

    Returns a greyscale array of shape ``(height, width)``. This mirrors the
    real figure's geometry (Han et al. 2026 Fig.3): axis on top, ticks below.
    """
    gray = np.full((height, width), 255, dtype=np.uint8)
    # 轴线：横向贯穿
    gray[axis_y, :] = 0
    # 刻线：轴线下方
    below = TICK_SEARCH_BELOW
    for i, x in enumerate(ticks):
        if x >= width:
            continue
        major = i % major_every == 0
        depth = below[1] - below[0] if major else MIN_TICK_HEIGHT + 1
        for dy in range(below[0], min(below[0] + depth, below[1])):
            gray[axis_y + dy, x] = 0
    return gray


def _column_with_spine(
    *,
    width: int = 80,
    height: int = 140,
    axis_y: int = 110,
    spine_x: int = 12,
    stroke: int = 3,
    ticks: tuple[int, ...] = (30, 50, 70),
) -> np.ndarray:
    """白色底 + 横轴 + **贯穿全高的竖向轴线（spine）** + 轴下刻线。

    用于验证「数据 0 点 = 轴线」这一条：面积/柱状图的填充从轴线起画，
    所以轴线位置必须实测，不能拿列切分给的 ``start`` 当 0 点。
    """
    gray = np.full((height, width), 255, dtype=np.uint8)
    gray[axis_y, :] = 0
    gray[:, spine_x : spine_x + stroke] = 0
    below = TICK_SEARCH_BELOW
    for x in ticks:
        if x < width:
            for dy in range(below[0], below[1]):
                gray[axis_y + dy, x] = 0
    return gray


class TestGeometryOnSynthetic:
    """几何检测在真值已知的合成图上必须精确。"""

    def test_axis_x_is_measured_not_guessed(self) -> None:
        """数据 0 点必须是实测轴线右缘，而不是列切分给的 start。"""
        gray = _column_with_spine(spine_x=12, stroke=3, ticks=(30, 50, 70))
        got = detect_ruler(gray, 4, 76)
        assert got["axis_x"] == 12, f"轴线左缘应为 12，实际 {got['axis_x']}"
        assert got["axis_x_right"] == 14, f"轴线右缘应为 14（12+3-1），实际 {got['axis_x_right']}"

    def test_axis_x_none_when_no_vertical_spine(self) -> None:
        """只有横向轴、没有竖向轴线时必须返回 None —— 调用方据此退回 startX。"""
        gray = _synthetic_column(ticks=(5, 17, 29, 42))
        got = detect_ruler(gray, 0, 60)
        assert got["axis_x"] is None
        assert got["axis_x_right"] is None

    def test_cells_and_spacing_exact(self) -> None:
        gray = _synthetic_column(ticks=(5, 17, 29, 42), major_every=2)
        got = detect_ruler(gray, 0, 60)
        assert got["axis_row"] == 100, f"轴线行应检出 100，实际 {got['axis_row']}"
        assert got["ticks"] == [5, 17, 29, 42]
        assert got["n_cells"] == 3
        assert got["spacing_px"] == pytest.approx(12.33, abs=0.55)
        assert got["regular"] is True

    def test_minor_ticks_are_not_dropped(self) -> None:
        """副齿（矮刻线）必须被检出 —— 漏掉它格数就少一半，量程直接错。"""
        gray = _synthetic_column(ticks=tuple(range(4, 56, 6)), major_every=2)
        got = detect_ruler(gray, 0, 60)
        assert got["n_cells"] == len(range(4, 56, 6)) - 1

    def test_no_axis_returns_empty_not_raise(self) -> None:
        """没有轴线时应返回空结构，不能抛异常。"""
        gray = np.full((50, 50), 255, dtype=np.uint8)
        got = detect_ruler(gray, 0, 50)
        assert got["axis_row"] is None
        assert got["ticks"] == []
        assert got["n_cells"] == 0

    def test_batch_reports_median_spacing(self) -> None:
        gray = _synthetic_column(ticks=(5, 17, 29, 42), major_every=2)
        cols = [
            {"col_index": 0, "name": "a", "start": 0, "end": 60},
            {"col_index": 1, "name": "b", "start": 0, "end": 60},
        ]
        got = detect_ruler_for_columns(gray, cols)
        assert len(got["per_column"]) == 2
        assert got["median_spacing_px"] == pytest.approx(12.33, abs=0.55)


class TestNoCrossColumnInference:
    """跨列外推读数 = 编造。这是真实事故的回归钉子。"""

    def test_suggest_scales_produces_no_numbers(self) -> None:
        """``suggest_scales`` 必须**一个数字都不产出**。

        背景：本项目曾据"刻距统一 12.5px/格"外推各列满量程，实测在真实图版上
        `Artemisia` 误差 −84%（刻距 12.5 vs 锚点 13.0，几乎相同）、
        `Caryophyllaceae` +151%。故该函数现在只交出「格数」这一客观事实。
        """
        per_column = [
            {"col_index": 0, "name": "anchor", "n_cells": 13, "spacing_px": 13.0},
            {"col_index": 1, "name": "target", "n_cells": 2, "spacing_px": 12.5},
        ]
        got = suggest_scales(per_column, anchor_col_index=0, anchor_full_scale=70.07)

        assert len(got) == 2
        for item in got:
            assert item["suggested_full_scale"] is None, (
                f"{item['name']} 产出了数字 {item['suggested_full_scale']} —— "
                "跨列外推必须保持关闭（见 docs/findings/agent-mcp-design.md）"
            )
            assert item["confidence"] == "none"
            assert item["reason"], "拒绝外推必须给出理由，否则用户不知道为什么"

    def test_suggest_scales_keeps_cell_counts(self) -> None:
        """拒绝外推，但必须保留「格数」供 UI 展示（这是客观事实）。"""
        per_column = [{"col_index": 0, "name": "a", "n_cells": 7, "spacing_px": 12.5}]
        got = suggest_scales(per_column, anchor_col_index=0, anchor_full_scale=10.0)
        assert got[0]["n_cells"] == 7
        assert got[0]["spacing_px"] == 12.5
