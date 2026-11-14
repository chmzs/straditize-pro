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


def _column_with_dashed_spine(
    *,
    width: int = 80,
    height: int = 140,
    axis_y: int = 110,
    spine_x: int = 20,
    stroke: int = 2,
    period: int = 4,
    ticks: tuple[int, ...] = (30, 50, 70),
) -> np.ndarray:
    """白底 + 横轴 + **虚线**竖轴（每 ``period`` 行实、``period`` 行虚）。

    真图上的窄列就是这样画的（见 ``TestDashedSpine`` 的实测证据），
    所以「贯穿率 ≥85%」在这类列上恒不成立，轴线位置只能靠"孤立竖线"判据找。
    """
    gray = np.full((height, width), 255, dtype=np.uint8)
    gray[axis_y, :] = 0
    for y in range(0, axis_y):
        if (y // period) % 2 == 0:
            gray[y, spine_x : spine_x + stroke] = 0
    below = TICK_SEARCH_BELOW
    for x in ticks:
        if x < width:
            for dy in range(below[0], below[1]):
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


def _synthetic_spine_column(
    *,
    width: int = 200,
    height: int = 200,
    spine_x: int = 20,
    spine_w: int = 4,
    axis_y: int = 150,
) -> np.ndarray:
    """合成一列「竖直轴线 + 面积填充」。

    填充宽度随行变化（多数行 30px、每 17 行只剩 2px），既能测出轴线本体宽度，
    又让**整个列区间几乎都满足「85% 行都暗」**——这正是错位扫描最容易骗到的地方。
    """
    gray = np.full((height, width), 255, dtype=np.uint8)
    gray[axis_y, :] = 0  # 底部横轴，供 find_axis_row 定位
    gray[0:axis_y, spine_x : spine_x + spine_w] = 0  # 竖直轴线
    for y in range(0, axis_y):
        # 每 17 行有一层完全没有花粉：这是面积图的常态，也是 `min(run)` 能测出
        # 轴线本体的前提。若整列每层都有花粉，`min(run)` 必然高估——那条限制由
        # 「用户给轴线粗细」覆盖，不在这里断言。
        run = 0 if y % 17 == 0 else 30
        if run:
            gray[y, spine_x + spine_w : spine_x + spine_w + run] = 0
    return gray


class TestDashedSpine:
    """虚线轴线必须被检出 —— 真图窄列实测钉子。

    ## 实测证据（`hoya-del-castillo.png`，28 列，axis_row=1307，ROI y=[511,1311]）

    15/28 列的 `axis_x` 是 `None`。逐行取样后原因只有一条：这些列的竖轴是
    **点划线**，4px 实 / 4px 虚，贯穿率恒为 ~50%（col09 x=1097 实测 0.44、
    col05 x=939 实测 0.81），而 `min_frac=0.85` 要求 85%。

    这条与 `DARK_THRESHOLD` 无关：该图去灰度后只剩 11 个灰度级、柱内像素
    非 0 即 255，把阈值从 170 放到 210、采样从 132 行加密到 264 行，
    `axis_x` 通过列数都是 **13/28（0 恢复）**。也不是"图没画线"：那 15 列的
    轴线 x 与列切分的 `start` **逐个相等**（939/971/1001/1065/1097/1193/1225/
    1330/1436/1468/1616/1648/1680/1711/1743）。

    判据：轴线是"孤立竖线"——覆盖率达到背景的 4 倍以上，
    而不是"覆盖率达到 85%"。填充区同样暗，但它不孤立。
    """

    def test_axis_x_found_on_dashed_spine(self) -> None:
        gray = _column_with_dashed_spine(spine_x=20, stroke=2, ticks=(30, 50, 70))
        got = detect_ruler(gray, 4, 76)

        assert got["axis_x"] == 20, (
            f"虚线轴线的左缘应为 20，实际 {got['axis_x']!r} —— "
            "「贯穿率 ≥85%」对 4 实 4 虚的轴线恒不成立，必须另有孤立竖线判据"
        )
        assert got["axis_x_right"] == 21, (
            f"虚线轴线 2px 宽，右缘应为 21，实际 {got['axis_x_right']!r}"
        )

    def test_no_spine_still_returns_none(self) -> None:
        """金丝雀：**没有**轴线时不得凭空造一个 —— 放宽判据不能变成"总能找到"。"""
        gray = _synthetic_column(ticks=(5, 17, 29, 42))
        got = detect_ruler(gray, 0, 60)

        assert got["axis_x"] is None, (
            f"纯白列上检出了 axis_x={got['axis_x']!r} —— 孤立竖线判据被放宽成了" \
            "「总能找到」，axis_x 从此不可信"
        )


class TestAxisAnchorIsImmuneToColumnStart:
    """列切分的 start 偏移不得传导到轴线位置。

    实测事故：`_find_axis_x` 的搜索窗口曾是固定的 `startX - 8`，而 22 列图上
    列切分的 start 可偏右 20px。偏右 12px 时扫描从填充区内部起步，面积填充同样
    「85% 行都暗」，于是返回一个错位的 x，**且不报错**——beginner col0 真左缘 259，
    实测在 start 偏 12 / 20 / 30px 时得到 263 / 271 / 281。
    """

    @pytest.mark.parametrize("shift", [0, 9, 20, 30])
    def test_axis_x_constant_under_start_offset(self, shift: int) -> None:
        gray = _synthetic_spine_column()
        geo = detect_ruler(gray, 20 + shift, 199)
        assert geo["axis_x"] == pytest.approx(20, abs=1), (
            f"start 偏右 {shift}px 时轴线被判到 {geo['axis_x']}（真值 20）——"
            "搜索窗口必须容纳列切分偏移，否则是静默错位而不是识别失败"
        )
        assert geo["axis_x_right"] == pytest.approx(23, abs=1)


class TestAxisStrokeOverride:
    """用户显式给的轴线粗细必须优先于 `min(run)` 估计。

    为什么需要：`min(run)` 在「整列每层都有花粉」的列上必然高估（最薄行仍带
    基部填充），而 1–6px 的夹取会截断高 DPI 图的粗轴（600 dpi 的 1 pt 线 ≈ 8px）。
    实测 beginner：col01 轴线本体 4px、col02–04 是 6px，同一张图内就不一致。
    """

    @pytest.mark.parametrize(
        ("stroke", "expected_right"),
        [(4, 23), (6, 25), (10, 29), (12, 31)],
    )
    def test_explicit_stroke_sets_right_edge(self, stroke: int, expected_right: int) -> None:
        gray = _synthetic_spine_column()
        geo = detect_ruler(gray, 20, 199, axis_stroke=stroke)
        assert geo["axis_x"] == pytest.approx(20, abs=1)
        assert geo["axis_x_right"] == pytest.approx(
            20 + stroke - 1, abs=0.01
        ), f"显式粗细 {stroke}px 应得右缘 {20 + stroke - 1}，实际 {geo['axis_x_right']}"

    def test_stroke_override_beats_run_estimate(self) -> None:
        """显式值必须完全无视 run 估计（10px 已超过 1–6px 的夹取上限）。"""
        gray = _synthetic_spine_column()
        auto = detect_ruler(gray, 20, 199)
        forced = detect_ruler(gray, 20, 199, axis_stroke=10)
        assert auto["axis_x_right"] != forced["axis_x_right"], "显式粗细必须覆盖自动估计"
        assert forced["axis_x_right"] == pytest.approx(29, abs=0.01)
