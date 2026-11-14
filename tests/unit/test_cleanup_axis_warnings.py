# -*- coding: utf-8 -*-
"""步骤 4 的编辑把某一列的**轴线**抹掉时，必须显式报出来。

## 缺陷本体

面积图的 0 点画在列的轴线（左缘那条竖线）上，而 `_extraction_mask()` 是
`foreground_mask & ~grid_line_mask & roi_mask` —— 排除区与已确认的几何都会
从这里把墨迹减掉。轴线一旦被减掉：

* 图上没有任何变化（overlay 只标红被删的像素，不标"这一列的 0 点没了"）；
* `digitize()` 照常返回 801 个点，只是整列都退化成同一个 x（= 列左缘），
  也就是一列全 0 —— 与"这一列真是 0"完全无法区分。

实测（`hoya-del-castillo.png`，col09 [1065,1097)）：把整列圈进排除区后，
`ink left in window = 0`，`digitize` 返回 801 个点、`distinct x = [1065.0]`、
`control_points = 2`，RPC 响应里没有任何警告字段。

实测第二条（同一张图，自动检测）：21 条候选里 18 条是竖线，其中 **17 条正好落在
列边界上**（即列轴本身）。确认它们会让 col02/col15/col22 分别有 101/294/255 行
的读数整体位移 1px。

## 判据

`apply_line_removal` / `set_line_geometry_status` / `upsert_line_geometry` 的返回里
必须带 `warnings`，明确点名被抹掉轴线的列；未覆盖轴线的编辑不得产生警告
（否则这条警告会在正常使用中变成噪音，最后被忽略）。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession


def _session_with_column() -> tuple[StraditizeSession, str, dict]:
    """40x120 的图：一列 [10,30)，轴线在 x=10，下半段有一点填充。"""
    mask = np.zeros((120, 40), dtype=bool)
    mask[:, 10] = True  # 轴线（0 点）
    # 填充只占 25% 高度：超过 `line_fraction_v`(0.30) 的填充会和轴线连成一个
    # 宽 cluster，被"太厚"滤掉 —— 这里要的是"孤立的竖轴"。
    mask[90:, 10:30] = True

    session = StraditizeSession()
    session.image = Image.fromarray((~mask).astype(np.uint8) * 255)
    session.width, session.height = 40, 120
    session.foreground_mask = mask
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=0, x1=40, y0=0, y1=120)["roi"]
    column = {
        "col_index": 0,
        "name": "col01",
        "species": "col01",
        "roi_id": roi["id"],
        "start": 10.0,
        "end": 30.0,
        "startValue": 0.0,
        "tickValue": 100.0,
        "tickEndX": 30.0,
        "scale_type": "linear",
        "x_ticks": None,
    }
    session.columns = [column]
    return session, roi["id"], column


def _rect(x0: int, x1: int, y0: int, y1: int) -> dict:
    return {
        "kind": "rect",
        "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    }


def test_exclusion_covering_a_column_axis_is_reported() -> None:
    session, roi_id, column = _session_with_column()

    result = session.apply_line_removal(
        roi_id=roi_id,
        exclusion_regions=[_rect(int(column["start"]), int(column["end"]), 0, 120)],
    )

    warnings = result.get("warnings")
    assert warnings, (
        "排除区盖住了 col01 的整列（含 x=10 的轴线），返回里没有任何警告 —— "
        "this is the silent path: the column now digitises as a flat 0 with no hint"
    )
    kinds = {w.get("kind") for w in warnings}
    assert "exclusion_covers_column_axis" in kinds, (
        f"警告种类不对：{kinds}；必须显式说明是哪一列的轴线被抹掉"
    )
    named = {w.get("column_name") for w in warnings}
    assert "col01" in named, f"警告没有点名列：{warnings}"


def test_exclusion_away_from_the_axis_is_not_reported() -> None:
    """金丝雀：没盖到轴线的排除区不得报警 —— 否则这条警告会变成噪音。"""
    session, roi_id, _column = _session_with_column()

    result = session.apply_line_removal(
        roi_id=roi_id,
        exclusion_regions=[_rect(20, 30, 0, 120)],
    )

    assert not result.get("warnings"), (
        f"排除区只盖到 x=20..30（轴线在 x=10），却报了警告：{result.get('warnings')}"
    )


def test_confirmed_vertical_geometry_on_the_axis_is_reported() -> None:
    """用户把一条竖线拖到列轴上并确认去除，同样要报。

    ## 场景来源变了，判据没变

    这条用例原来靠"自动检测提出的竖线正好是列轴"来搭现场。那个现场现在是**缺陷
    本身**：列轴按结构判据不再被提为候选（见 `test_line_candidates_column_axis.py`），
    否则用户"检测 → 逐条确认"就是在删各列的 0 点。

    但"确认的竖线压在列轴上"这条路仍然可达，而且更常见：用户想把轴旁边多出来的
    竖边去掉时，`drawLineV` 拖出来的就是一条 x = 列左缘的几何。所以现场改由
    `upsert_line_geometry`（手动几何的落库入口）搭建，告警判据一字未改。
    """
    session, roi_id, column = _session_with_column()
    axis_x = int(column["start"])

    candidates = session.detect_line_candidates(
        roi_id, line_fraction_h=0.7, line_fraction_v=0.3, line_width_max=2
    )["candidates"]
    assert not [
        c
        for c in candidates
        if c["axis"] == "v" and abs(c["at"] - axis_x) <= 2
    ], (
        "前置：自动检测不得再提出列轴 —— 否则本用例会在任务① 的回归上继续变绿，"
        f"掩盖「检测→全选→删除」整条危险路径（候选：{[(c['axis'], c['at']) for c in candidates]}）"
    )

    result = session.upsert_line_geometry(
        roi_id=roi_id,
        geometry={"x0": axis_x, "y0": 0, "x1": axis_x, "y1": 119},
        axis="v",
        status="removed",
    )

    warnings = result.get("warnings") or []
    assert any(w.get("kind") == "confirmed_line_covers_column_axis" for w in warnings), (
        f"确认了落在 col01 轴线上的竖线（x={axis_x}），返回里没有警告：{warnings}"
    )
