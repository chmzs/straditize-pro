# -*- coding: utf-8 -*-
"""所有「像素 -> 数值」入口的 origin 必须等于 0 点（列左缘 + 轴粗）。

## 为什么需要这条机械判据

0 点的定义只有一条（ARCHITECTURE 6.4）：startX + resolve_axis_stroke(col, group)，
也就是画布上的绿线。历史上同一个概念在前后端各有兜底，任一处退回 startX 都会让
每列读数系统性偏大 轴粗x斜率（本仓实测 6px x 0.16667 = +1.0%）。人工 review 抓不住，
所以这里把"入口 -> origin"逐条钉住。

## 覆盖的入口

1. xscale.resolve_column_scale 的组斜率分支（当前主路径）；
2. export 取值：缺行基线取 scale.abs_px0（export.py:121），这里用
   read_column_values(scale, [abs_px0]) == 0 行为化验证；
3. qa 上限：qa.py:197 同一个 scale.abs_px0，同一条行为断言覆盖；
4. samples 取值：走 read_column_values，同一条行为断言覆盖。

## 反向验证

把组斜率分支的 _zero = c_start + _stroke 改回 _zero = c_start，本文件必须变红
（第一组断言与第二组行为断言同时红）。
"""
from __future__ import annotations

import pytest

from straditize_core.session_parts.xscale import (
    read_column_values,
    resolve_axis_stroke,
    resolve_column_scale,
)

START = 1576.0
END = 1808.0
STROKE = 6.0
SLOPE = 0.16666666666666666


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


def _group(**over):
    group = {"id": "roi_1_grp1", "value_per_px": SLOPE, "axis_stroke_px": STROKE, "unit": "%"}
    group.update(over)
    return group


class _SessionStub:
    """resolve_column_scale 的第一参是 session（组信息从 rois 里取）。"""

    def __init__(self):
        self.rois = [{"id": "roi_1", "x_groups": [_group()]}]


SESSION = _SessionStub()


def test_group_slope_branch_uses_start_plus_axis_stroke():
    col = _col()
    scale = resolve_column_scale(SESSION, col, 3)
    expected = START + resolve_axis_stroke(col, _group())
    assert scale.abs_px0 == pytest.approx(expected), (
        "0 点必须是 startX + 轴粗，实得 %r（startX=%r）" % (scale.abs_px0, START)
    )
    assert abs(scale.abs_px0 - START) > 1e-6, "0 点不得等于列左缘"


def test_group_stroke_overrides_column_stroke():
    """列级 axis_stroke_px 优先于组级：两个入口都必须把"生效的那一个"加到 startX 上。"""
    col = _col(axis_stroke_px=9.0)
    scale = resolve_column_scale(SESSION, col, 3)
    assert resolve_axis_stroke(col, _group()) == pytest.approx(9.0)
    assert scale.abs_px0 == pytest.approx(START + 9.0)


def test_value_at_zero_point_is_zero_and_at_left_edge_is_not():
    """export / qa / samples 都用 read_column_values(scale, px)：0 点必须读 0，
    列左缘必须读成 -轴粗x斜率（这就是"用左缘当 0 点"会多算的那 1.0%）。"""
    col = _col()
    scale = resolve_column_scale(SESSION, col, 3)
    at_zero = read_column_values(scale, [scale.abs_px0], col_name="col04")
    assert at_zero[0] == pytest.approx(0.0, abs=1e-9), "0 点处读数必须是 0"

    # 读数有"不得为负"的钳位（负读数一律给 0），所以用**中段像素**看偏移量：
    # 把 origin 退回列左缘，等价于把每个像素整体右移轴粗，读数整体 +轴粗x斜率。
    mid = START + 300.0
    normal = read_column_values(scale, [mid], col_name="col04")[0]
    shifted = read_column_values(scale, [mid + STROKE], col_name="col04")[0]
    assert shifted - normal == pytest.approx(STROKE * SLOPE, rel=1e-9), (
        "原点退回列左缘会让读数整体偏大 轴粗x斜率 = %.4f，实测差 %.4f"
        % (STROKE * SLOPE, shifted - normal)
    )
