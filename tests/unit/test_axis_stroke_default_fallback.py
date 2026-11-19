# -*- coding: utf-8 -*-
"""轴粗兜底值（`DEFAULT_AXIS_STROKE_PX`）与"显式设置不受影响"。

## 背景

`resolve_axis_stroke` 的优先级是「列级覆盖 > 组级初值 > 兜底」。兜底原本是 **5**，
2026-11-19 改为 **2**：这条兜底真正回答的是"0 点该放在列左缘右边几个像素"，
而实测轴线核心只有 1~4px。实测 `output/zhou_2024_gahai`（列级与组级都没写轴粗）：
兜底 5 把 0 点推到 `startX+5`，真实放大原点在 `startX+1`，于是 `inner_dist` 被压到
1~2px，`(outer−z0)/(inner−z0)` 的 p50 从 4.18 涨到 12.5，`FLAG_EXAGG_RATIO`
483 行里 449 行误报。

## 本文件钉两件事

1. 兜底就是 2.0（改回去会立刻红）；
2. **显式设置过的列/组完全不受兜底影响** —— 改兜底是全局变更，不能顺手改掉
   用户手填的值。第 2 条用"把兜底换成一个离谱的数，再看解析结果"来验，
   空跑一遍是测不出这条的。
"""

from __future__ import annotations

import pytest

from straditize_core.session_parts import xscale
from straditize_core.session_parts.xscale import (
    DEFAULT_AXIS_STROKE_PX,
    resolve_axis_stroke,
)


def test_default_fallback_is_two_pixels() -> None:
    assert DEFAULT_AXIS_STROKE_PX == pytest.approx(2.0)


def test_unset_everywhere_returns_the_fallback() -> None:
    assert resolve_axis_stroke({}, {}) == pytest.approx(2.0)
    assert resolve_axis_stroke({"axis_stroke_px": None}, {"axis_stroke_px": None}) == pytest.approx(2.0)
    assert resolve_axis_stroke(None, None) == pytest.approx(2.0)


def test_column_override_wins_over_group_and_fallback() -> None:
    assert resolve_axis_stroke({"axis_stroke_px": 7}, {"axis_stroke_px": 3}) == pytest.approx(7.0)


def test_group_value_wins_over_fallback() -> None:
    assert resolve_axis_stroke({}, {"axis_stroke_px": 6}) == pytest.approx(6.0)


def test_zero_is_a_legal_override() -> None:
    """0 点落在列左缘是合法选择（绿线与红线重合），不得被当成"未设置"。"""
    assert resolve_axis_stroke({"axis_stroke_px": 0}, {"axis_stroke_px": 3}) == pytest.approx(0.0)


@pytest.mark.parametrize("bad", [-1, -0.5, "abc", "", object()])
def test_invalid_column_value_falls_back_to_group(bad: object) -> None:
    assert resolve_axis_stroke({"axis_stroke_px": bad}, {"axis_stroke_px": 4}) == pytest.approx(4.0)


@pytest.mark.parametrize("bad", [-2, "x", object()])
def test_invalid_group_value_falls_back_to_default(bad: object) -> None:
    assert resolve_axis_stroke({}, {"axis_stroke_px": bad}) == pytest.approx(2.0)


def test_explicit_values_are_immune_to_the_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """把兜底换成一个离谱的值，显式设置过的列/组必须一动不动。

    这是"改兜底不会改动用户手填值"的判别力所在：只断言 `== 旧值` 无法区分
    "没用到兜底"和"兜底恰好等于旧值"。
    """
    col = {"axis_stroke_px": 3}
    group_only_col: dict = {}
    group = {"axis_stroke_px": 4}
    monkeypatch.setattr(xscale, "DEFAULT_AXIS_STROKE_PX", 99.0)

    assert resolve_axis_stroke(col, group) == pytest.approx(3.0)
    assert resolve_axis_stroke(group_only_col, group) == pytest.approx(4.0)
    # 三处都没设的列才会跟着兜底走
    assert resolve_axis_stroke({}, {}) == pytest.approx(99.0)


def test_zero_point_of_explicit_columns_is_stable_across_fallback_change() -> None:
    """0 点 = 列左缘 + 轴粗：显式列的 0 点与兜底取值无关。"""
    start = 939.0
    for stroke in (0, 1, 2, 4, 6):
        col = {"axis_stroke_px": stroke}
        resolved = resolve_axis_stroke(col, {})
        assert start + resolved == pytest.approx(start + stroke)
