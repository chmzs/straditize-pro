# -*- coding: utf-8 -*-
"""legacy（组 tick_layout）分支的 0 点必须也是 列左缘 + 轴粗；x_ticks 的 0 点要可判可疑。

## 缺陷

_scale_from_group_layout 原来用 abs_px0 = c_start + rel0 x (c_end - c_start)，
rel0 = 0 时 abs_px0 = c_start —— 比真 0 点少一个轴粗。影响：每行读数偏大
轴粗 x 斜率（本仓实测 stroke 6 + 0.16667 %/px = +1.0%；量程 100% / cell 60px 的列
= +10%）。rel 的语义是**绘图区内**的相对位置（写入端 project.py:662/744、roi.py:105
写的是 0.0/1.0 这类整框比例，从不包含轴粗），所以绘图区 = [c_start + 轴粗, c_end]。

## 判据

同一列同一行：legacy 分支与组斜率分支算出的值差 <= 0.2。
反向验证：把 legacy 分支改回 abs_px0 = c_start + rel0 x (c_end - c_start)，
第一条断言必须红。
"""
from __future__ import annotations

import pytest

from straditize_core.session_parts.xscale import resolve_column_scale, resolve_axis_stroke

START = 1576.0
END = 1808.0
STROKE = 6.0
SLOPE = 100.0 / (END - START - STROKE)   # 量程 100% 张满绘图区


class _SessionStub:
    def __init__(self, group):
        self.rois = [{"id": "roi_1", "x_groups": [group]}]


def _col(**over):
    col = {
        "col_index": 3,
        "id": "roi_1_col04",
        "name": "col04",
        "start": START,
        "end": END,
        "roi_id": "roi_1",
        "x_group_id": "roi_1_grp1",
        "unit": "%",
        "plot_type": "area",
        "scale_type": "linear",
        "axis_stroke_px": STROKE,
    }
    col.update(over)
    return col


def _legacy_group():
    return {
        "id": "roi_1_grp1",
        "unit": "%",
        "axis_stroke_px": STROKE,
        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
    }


def _slope_group():
    return {"id": "roi_1_grp1", "unit": "%", "axis_stroke_px": STROKE, "value_per_px": SLOPE}


def test_legacy_layout_origin_is_start_plus_axis_stroke():
    col = _col(x_values=[0.0, 100.0])
    scale = resolve_column_scale(_SessionStub(_legacy_group()), col, 3)
    expected = START + STROKE
    assert scale.abs_px0 == pytest.approx(expected), (
        "legacy 分支的 0 点必须是 列左缘 + 轴粗 = %.1f，实得 %.1f" % (expected, scale.abs_px0)
    )
    assert resolve_axis_stroke(col, _legacy_group()) == pytest.approx(STROKE)
    # 另一端仍在列右界（rel = 1 ⇒ 绘图区右端 = c_end）
    assert scale.abs_px1 == pytest.approx(END)


def test_legacy_and_group_slope_agree_within_tolerance():
    col_legacy = _col(x_values=[0.0, 100.0])
    col_slope = _col()
    legacy = resolve_column_scale(_SessionStub(_legacy_group()), col_legacy, 3)
    slope = resolve_column_scale(_SessionStub(_slope_group()), col_slope, 3)
    for x in (START + 40.0, START + 120.0, END - 1.0):
        v_legacy = legacy.px_to_value(x, baseline_px=legacy.abs_px0)
        v_slope = slope.px_to_value(x, baseline_px=slope.abs_px0)
        assert abs(v_legacy - v_slope) <= 0.2, (
            "同一像素 x=%.1f 两分支差 %.3f > 0.2（legacy=%.3f slope=%.3f）"
            % (x, abs(v_legacy - v_slope), v_legacy, v_slope)
        )


def test_xticks_origin_at_left_edge_is_flagged_suspect():
    """写入方若把列左缘写进 x_ticks[0].px，必须打 origin_suspect（不静默偏大）。"""
    col_ok = _col(x_ticks=[{"px": START + STROKE, "value": 0}, {"px": END, "value": 100}])
    col_bad = _col(x_ticks=[{"px": START, "value": 0}, {"px": END, "value": 100}])
    # 组斜率优先于 x_ticks，所以这条用例用"只有组轴粗、没有组斜率"的组，才会走 x_ticks 分支。
    plain_group = {"id": "roi_1_grp1", "unit": "%", "axis_stroke_px": STROKE}
    ok = resolve_column_scale(_SessionStub(plain_group), col_ok, 3)
    bad = resolve_column_scale(_SessionStub(plain_group), col_bad, 3)
    assert ok.source == "x_ticks" and bad.source == "x_ticks", "必须走 x_ticks 分支"
    assert ok.origin_suspect is False, "0 点正确时不应报可疑"
    assert bad.origin_suspect is True, "0 点落在列左缘时必须报可疑"
