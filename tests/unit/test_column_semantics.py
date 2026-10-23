# -*- coding: utf-8 -*-
"""按列判定「单层 / 双层」的回归测试。

## 背景

`split_by_colour_and_luminance` 原先用**一个图级边界**分层，判据是
``pale_tier & vivid``：淡档里"非彩色"的像素一律判阴影。

后果：**单层灰列**（如 ``(182,182,182)``，该列根本没有包络）被整块判成阴影，
覆盖率 0%。而同一张图上"中灰实心 + 浅灰包络"的双层列却需要把 229 判成阴影。
两种情形在**列内直方图上完全同构**（都是单峰），仅凭图级信息无法区分。

## 判据（实测决定性事实）

| 图类型 | 列内峰 | 语义 |
| :--- | :--- | :--- |
| 单层图 | 每列 **1** 个墨层峰 | 该峰就是实心 |
| 双层图 | 每列 **2** 个墨层峰（15/15 列） | 亮的是包络、暗的是实心 |

所以"该列内部有几个墨层峰"是区分单层/双层列的直接判据，无需跨列猜测。

规格见 `docs/findings/spec-column-semantics.md`。
"""
from __future__ import annotations

import numpy as np
import pytest

from straditize_core.image import (
    _luminance_peaks,
    build_foreground,
    grey_matrix,
    paper_white,
    split_by_colour_and_luminance,
)

PAPER = (255, 255, 255)


def _column_figure(
    columns: list[tuple[int, int, tuple[int, ...]]],
    *,
    height: int = 60,
    width: int | None = None,
) -> tuple[np.ndarray, list[int]]:
    """Draw one ink value per column band; return (canvas, column_edges).

    ``columns`` items are ``(x0, x1, colour)``. The colour fills the whole band,
    so each band has exactly one ink tier by construction.
    """
    if width is None:
        width = max(x1 for _x0, x1, _c in columns) + 4
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    canvas[...] = PAPER
    for x0, x1, colour in columns:
        canvas[5:55, x0:x1] = colour
    edges = [x0 for x0, _x1, _c in columns] + [columns[-1][1]]
    return canvas, edges


def _coverage(mask: np.ndarray, box: tuple[int, int, int, int]) -> float:
    y0, y1, x0, x1 = box
    return float(mask[y0:y1, x0:x1].mean())


class TestSingleLayerColumns:
    """单层列：唯一的墨层峰就是实心，整列非纸像素进 solid。"""

    def test_grey_single_column_is_read(self) -> None:
        """核心缺陷：单层灰列曾被整块判成阴影（覆盖率 0%）。"""
        canvas, edges = _column_figure([(10, 50, (182, 182, 182))])
        solid, shadow = split_by_colour_and_luminance(canvas, column_edges=edges)
        assert _coverage(solid, (5, 55, 10, 50)) == pytest.approx(1.0), (
            "单层灰列应整列进 solid —— 它只有一个墨层峰，没有包络")
        assert _coverage(shadow, (5, 55, 10, 50)) == pytest.approx(0.0)

    @pytest.mark.parametrize("grey", [0, 60, 120, 182, 215])
    def test_every_single_grey_level_is_read(self, grey: int) -> None:
        canvas, edges = _column_figure([(10, 50, (grey,) * 3)])
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=edges)
        assert _coverage(solid, (5, 55, 10, 50)) == pytest.approx(1.0), (
            f"单层灰列（明度 {grey}）应被完整提取")

    def test_two_independent_single_columns(self) -> None:
        """黑列 + 灰列各自单层：两列都必须被提取（这是 V5 的场景）。"""
        canvas, edges = _column_figure([(10, 50, (0, 0, 0)), (60, 100, (182, 182, 182))])
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=edges)
        assert _coverage(solid, (5, 55, 10, 50)) == pytest.approx(1.0)
        assert _coverage(solid, (5, 55, 60, 100)) == pytest.approx(1.0), (
            "灰列与黑列分属不同列带，灰列不该因为'比黑列淡'而被判成阴影")


class TestDoubleLayerColumns:
    """双层列：亮的是包络、暗的是实心。"""

    def test_grey_solid_with_grey_envelope(self) -> None:
        """真实图版形态：中灰实心 + 浅灰包络，在同一列内。"""
        canvas = np.zeros((60, 60, 3), dtype=np.uint8)
        canvas[...] = PAPER
        # 包络铺满整列，实心盖在其左段（复刻"包络画得更宽"的真实形态）
        canvas[5:55, 10:50] = (229, 229, 229)
        canvas[5:55, 10:30] = (182, 182, 182)
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=[10, 50])
        assert _coverage(solid, (5, 55, 10, 30)) == pytest.approx(1.0), "实心应被提取"
        assert _coverage(solid, (5, 55, 30, 50)) == pytest.approx(0.0), (
            "包络不得漏进读数（×5 放大方向）")

    def test_coloured_solid_with_coloured_envelope(self) -> None:
        canvas = np.zeros((60, 60, 3), dtype=np.uint8)
        canvas[...] = PAPER
        canvas[5:55, 10:50] = (218, 226, 237)   # 浅蓝包络
        canvas[5:55, 10:30] = (0, 62, 137)      # 深蓝实心
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=[10, 50])
        assert _coverage(solid, (5, 55, 10, 30)) == pytest.approx(1.0)
        assert _coverage(solid, (5, 55, 30, 50)) == pytest.approx(0.0)


class TestMixedFigure:
    """同一张图里单层列与双层列并存 —— 真实图版的常态。"""

    def test_single_and_double_columns_side_by_side(self) -> None:
        canvas = np.zeros((60, 140, 3), dtype=np.uint8)
        canvas[...] = PAPER
        # 列0：单层黑线
        canvas[5:55, 5:35] = (0, 0, 0)
        # 列1：双层（浅灰包络 + 中灰实心）
        canvas[5:55, 45:85] = (229, 229, 229)
        canvas[5:55, 45:65] = (182, 182, 182)
        # 列2：单层灰
        canvas[5:55, 95:125] = (167, 167, 167)
        edges = [5, 40, 90, 130]
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=edges)

        assert _coverage(solid, (5, 55, 5, 35)) == pytest.approx(1.0), "单层黑列"
        assert _coverage(solid, (5, 55, 45, 65)) == pytest.approx(1.0), "双层列的实心"
        assert _coverage(solid, (5, 55, 65, 85)) == pytest.approx(0.0), (
            "双层列的包络不得漏入")
        assert _coverage(solid, (5, 55, 95, 125)) == pytest.approx(1.0), "单层灰列"

    def test_envelope_crossing_into_neighbour_band(self) -> None:
        """包络越出所属列（上一轮失败的根因）。

        包络画得比实心宽、跨到邻列带。单层列不参与淡档判定，因此跨界包络
        落在单层列内时会被算成该列的墨 —— 这是**有意的取舍**：单层列里
        不存在"比本列最淡峰更亮的墨层"，无法区分"跨界包络"与"本列淡墨"。
        本测试钉住的是：**双层列自身的包络仍必须被排除**。
        """
        canvas = np.zeros((60, 160, 3), dtype=np.uint8)
        canvas[...] = PAPER
        canvas[5:55, 10:90] = (229, 229, 229)   # 包络跨到列1 的边界右侧
        canvas[5:55, 10:40] = (182, 182, 182)   # 实心只在列0 左段
        edges = [10, 60, 110, 150]
        solid, _shadow = split_by_colour_and_luminance(canvas, column_edges=edges)
        # 列0 内：实心完整、包络被排除
        assert _coverage(solid, (5, 55, 10, 40)) == pytest.approx(1.0)
        assert _coverage(solid, (5, 55, 40, 60)) == pytest.approx(0.0), (
            "列0 自己的包络不得漏入读数")


class TestLayerCounting:
    """层数判定本身（`_luminance_peaks` 的列内结果）。"""

    def test_single_ink_tier_yields_one_peak(self) -> None:
        canvas, _edges = _column_figure([(10, 50, (182, 182, 182))])
        rel = grey_matrix(canvas) / paper_white(canvas)
        peaks = _luminance_peaks(rel, rel < 0.985, 0.985, 0.02)
        assert len(peaks) == 1, f"单层列应只有一个峰，实际 {[round(p * 255) for p in peaks]}"

    def test_two_ink_tiers_yield_two_peaks(self) -> None:
        canvas = np.zeros((60, 60, 3), dtype=np.uint8)
        canvas[...] = PAPER
        canvas[5:55, 10:30] = (182, 182, 182)
        canvas[5:55, 30:50] = (229, 229, 229)
        rel = grey_matrix(canvas) / paper_white(canvas)
        peaks = _luminance_peaks(rel, rel < 0.985, 0.985, 0.02)
        assert len(peaks) == 2, f"双层列应有两个峰，实际 {[round(p * 255) for p in peaks]}"

    def test_pure_black_is_detected(self) -> None:
        """回归钉子：`range(1,256)` 曾漏掉 bin 0（纯黑）。"""
        canvas, _edges = _column_figure([(10, 50, (0, 0, 0))])
        rel = grey_matrix(canvas) / paper_white(canvas)
        peaks = _luminance_peaks(rel, rel < 0.985, 0.985, 0.02)
        assert peaks and peaks[0] == pytest.approx(0.0), (
            "纯黑是最常见的墨色，必须被检出")


class TestWithoutColumnEdges:
    """不传 `column_edges` 时退回图级判据（向后兼容）。"""

    def test_falls_back_to_figure_level(self) -> None:
        canvas, _edges = _column_figure([(10, 50, (182, 182, 182))])
        solid, shadow = split_by_colour_and_luminance(canvas)
        # 图级判据下这个中灰可能被判阴影 —— 不传列边界时不保证单层语义，
        # 但必须**不崩溃**且两掩膜互斥。
        assert not (solid & shadow).any(), "两个掩膜必须互斥"


class TestStandardPathIntegration:
    """`build_foreground` 的 standard 路径必须透传 column_edges。"""

    def test_column_edges_reach_the_splitter(self) -> None:
        canvas, edges = _column_figure([(10, 50, (182, 182, 182))])
        rgba = np.dstack([canvas, np.full(canvas.shape[:2], 255, dtype=np.uint8)])
        fg = build_foreground(rgba, threshold=138.0 * 3,
                              extraction_mode="standard", column_edges=edges)
        assert _coverage(fg, (5, 55, 10, 50)) == pytest.approx(1.0), (
            "build_foreground 必须把 column_edges 传给 split_by_colour_and_luminance；"
            "不透传则按列分支永不生效（这正是灰列 0% 的原因）")
