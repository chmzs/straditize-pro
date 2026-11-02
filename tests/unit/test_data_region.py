# -*- coding: utf-8 -*-
"""自动数据区（`suggest_data_region`）的纵向判据。

一次真实事故的钉子：rioja pollen 图顶部约 100px 是标题 + 斜排属种名（墨迹稀疏），
旧的「墨迹密度 70%」启发式直接跳过它，把 yMin 判到 188–197，而数据区实从 82–93
开始。`digitize` 只在 ROI 内取数，于是**一次丢掉 15/49 层（30.6%）且不报警**
（见 docs/findings/bench-issues/bench-pollen.md P-03）。

判据用物理结构：数据区上沿 = 面板竖直轴线的顶端。三张 pollen 图 + 硅藻图的真值
由像素独立测得（填充色分段与轴线检测两条路径互验，误差 ≤1px）。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from straditize_core.session import StraditizeSession

FIGURES = Path(__file__).resolve().parent.parent / "data/figures/benchmark_types"

# (文件名, 数据区上沿, 下沿) —— 真值来自填充色分段，与轴线检测互验
BENCHMARKS = [
    ("Pollen_riojaPlotTestData.png", 93, 568),
    ("Pollen_BarStyle_riojaPlotTestData.png", 82, 568),
    ("Pollen_CruveStyle_riojaPlotTestData.png", 82, 568),
    ("Diatom_riojaPlotTestData.png", 78, 568),
]


@pytest.mark.parametrize(("filename", "y_top", "y_bottom"), BENCHMARKS)
def test_vertical_span_matches_axis_spine(filename: str, y_top: int, y_bottom: int) -> None:
    session = StraditizeSession()
    info = session.load_image(image_path=str(FIGURES / filename))
    roi = info["suggested_roi"]
    assert roi["method"] == "axis_spine", (
        f"{filename}: 应走轴线结构判据，实际 {roi.get('method')} —— "
        "密度启发式会跳过顶部图名区，丢数据且不报警"
    )
    assert abs(roi["yMin"] - y_top) <= 3, (
        f"{filename}: 数据区上沿 {roi['yMin']:.0f}，真值 {y_top}"
    )
    assert abs(roi["yMax"] - y_bottom) <= 3, (
        f"{filename}: 数据区下沿 {roi['yMax']:.0f}，真值 {y_bottom}"
    )


def test_beginner_roi_unchanged() -> None:
    """内置范例的自动数据区不得因本次改动漂移（零回归）。"""
    session = StraditizeSession()
    roi = session.load_image(sample_key="beginner")["suggested_roi"]
    assert (round(roi["xMin"]), round(roi["xMax"])) == (258, 1803)
    assert (round(roi["yMin"]), round(roi["yMax"])) == (375, 1666)
