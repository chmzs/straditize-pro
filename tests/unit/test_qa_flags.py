# -*- coding: utf-8 -*-
"""逐行诊断旗标的判据（issue #91 / #92）。

## 为什么单独一个文件

`test_qa_summary.py` 钉的是"读数与门限对不对"，`test_qa_payload_golden.py` 钉的是
接线。这里钉的是**旗标判据本身**：每条判据的边界值、跳过条件、以及 #92 的降级规则。
全部用合成数据（无图片、无 digitize），所以能在一次 pytest 里跑完并把边界写死。

## 钉的判据

| 案例 | 断言 |
| --- | --- |
| `axis_blind` | `0 ≤ span ≤ 轴宽` 报，`span > 轴宽` 不报，`span < 0`（无墨迹）**不**报 |
| `axis_width_unset` | 列与组都没写 `axis_stroke_px` → 整列 skipped，不拿兜底值（2.0）判 |
| `axis_origin_suspect` | 0 点落进轴线带（`origin_suspect`）→ 不判盲区（span 整体偏一个轴宽） |
| `truncated` | 触边（`span ≥ full−1`）+ 相邻两行 |Δ| ≤ 2 → 报 |
| `collision` | 触边但相邻行全都离得远（孤立单行突刺）→ 报，且不进 truncated |
| `edge_tolerance` | `span == full−2` → 不报（容差恰为 1 个像素量化单位） |
| `bar_downgrade` | 柱状列（`plot_type=bar` + 逐行等宽占比 ≥ 0.5）+ 柱内 → 降级不报 |
| `bar_first_row` | 柱体首行另一侧接着上一根柱，仍须降级（否则每根柱漏一条误报） |
| `bar_wrong_plot_type` | 同形状但 `plot_type=area` → 不降级（整段平台报 truncated） |
| `bar_not_stepwise` | `plot_type=bar` 但逐行渐变（等宽占比 < 0.5）→ 不降级（照报） |
| `narrow_column` | 15px 窄列里触边的柱仍降级（不要百分比满量程门） |
| `control_point` | 插值合成列 → 整列 skipped，不给结论 |
| `exagg_ratio` | 无内外线成对读数 → skipped 且列明缺什么；给了配对数才判 [3.0, 5.5] |
| `wiring` | `qa_summarize` 真的把 0 点/列右端/轴宽/逐行像素传到旗标层 |
"""

from __future__ import annotations

from straditize_core.qa import (
    FLAG_AXIS_BLIND,
    FLAG_COLLISION,
    FLAG_EXAGG_RATIO,
    FLAG_TRUNCATED,
    compute_qa_flags,
)
from straditize_core.session import StraditizeSession

#: 合成列：0 点 105px、列右端 200px（绘图区宽 95px）、轴宽 5px、面积图。
ZERO_PX = 105.0
RIGHT_PX = 200.0
FULL_SPAN_PX = RIGHT_PX - ZERO_PX  # 95.0
AXIS_PX = 5.0


def _column(**overrides) -> dict:
    """一列的最小几何；`rows` 用 `(row, x_px)` 元组给。"""
    rows = overrides.pop("rows", [])
    base = {
        "name": "Quercus",
        "zero_px": ZERO_PX,
        "right_px": RIGHT_PX,
        "axis_px": AXIS_PX,
        "plot_type": "area",
        "points_provenance": "measured",
        "anchor_edited": False,
        "rows_px": [row for row, _ in rows],
        "xs_px": [x for _, x in rows],
    }
    base.update(overrides)
    return base


def _flags(columns) -> dict:
    return compute_qa_flags(columns)


# --------------------------------------------------------------------------- #91


def test_axis_blind_boundary_inclusive_and_skips_inkless_rows() -> None:
    """`0 ≤ span ≤ 轴宽` 报；`span > 轴宽` 不报；`span < 0`（该行无墨迹）不报。"""
    flags = _flags(
        [
            _column(
                rows=[
                    (10, ZERO_PX),  # span 0  -> 报（贴 0 点）
                    (11, ZERO_PX + AXIS_PX),  # span 5 == 轴宽 -> 报（闭区间）
                    (12, ZERO_PX + AXIS_PX + 1.0),  # span 6 -> 不报
                    (13, ZERO_PX - AXIS_PX),  # span -5：无墨迹，归 empty_horizons
                ]
            )
        ]
    )
    block = flags[FLAG_AXIS_BLIND]
    assert block["status"] == "computed"
    assert [row["row_px"] for row in block["rows"]] == [10, 11]
    assert block["count"] == 2
    assert block["by_column"] == {"Quercus": 2}


def test_axis_blind_skipped_when_axis_width_unset() -> None:
    """两处都没写轴宽 -> 不判、不拿 `resolve_axis_stroke` 的 5.0 默认值顶替。"""
    flags = _flags(
        [_column(axis_px=None, rows=[(10, ZERO_PX), (11, ZERO_PX + 1.0)])]
    )
    block = flags[FLAG_AXIS_BLIND]
    assert block["status"] == "skipped"
    assert block["count"] == 0
    assert block["skipped_columns"] == [
        {"column": "Quercus", "reason": "axis_width_unset"}
    ]


def test_axis_blind_skipped_when_zero_point_is_suspect() -> None:
    """0 点被写偏（落进轴线带）-> 不判盲区：span 会整体少一个轴宽，等于假告警工厂。"""
    flags = _flags(
        [
            _column(
                origin_suspect=True,
                rows=[(10, ZERO_PX), (11, ZERO_PX + 1.0)],
            )
        ]
    )
    block = flags[FLAG_AXIS_BLIND]
    assert block["status"] == "skipped"
    assert block["count"] == 0
    assert block["skipped_columns"] == [
        {"column": "Quercus", "reason": "zero_point_suspect"}
    ]


def test_truncated_requires_plateau_and_collision_requires_spike() -> None:
    """触边后的两种形态：≥2 行的平台 -> TRUNCATED；孤立单行突刺 -> COLLISION。"""
    flags = _flags(
        [
            _column(
                plot_type="area",
                rows=[
                    (10, ZERO_PX + 15.0),
                    (11, RIGHT_PX - 1.0),  # 平台首行：与行 12 同高 -> 平台
                    (12, RIGHT_PX - 1.0),
                    (13, RIGHT_PX - 1.0),
                    (14, RIGHT_PX - 1.0),
                    (15, ZERO_PX + 15.0),
                    (20, ZERO_PX + 15.0),
                    (21, RIGHT_PX - 1.0),  # 孤立一行触边（上下都差 79px）-> 突刺
                    (22, ZERO_PX + 15.0),
                ],
            )
        ]
    )
    truncated = flags[FLAG_TRUNCATED]
    collision = flags[FLAG_COLLISION]
    assert [row["row_px"] for row in truncated["rows"]] == [11, 12, 13, 14]
    assert [row["row_px"] for row in collision["rows"]] == [21]
    # 触边判定用的是"≥ full_span − 1px"，故 span 要写成 94.0（= 95 − 1）
    assert truncated["rows"][0]["span_px"] == 94.0
    assert truncated["rows"][0]["full_span_px"] == 95.0


def test_edge_tolerance_is_one_pixel_quantisation_unit() -> None:
    """`span == full−2` 不判触边：容差 1px 正好是列窗右开造成的量化单位。"""
    flags = _flags(
        [
            _column(
                rows=[
                    (10, RIGHT_PX - 2.0),
                    (11, RIGHT_PX - 2.0),
                    (12, RIGHT_PX - 2.0),
                ]
            )
        ]
    )
    assert flags[FLAG_TRUNCATED]["count"] == 0
    assert flags[FLAG_COLLISION]["count"] == 0


# --------------------------------------------------------------------------- #92


def _bar_rows(x_px: float, rows: range) -> list[tuple[int, float]]:
    return [(row, x_px) for row in rows]


def test_full_scale_bar_row_is_downgraded_not_reported() -> None:
    """柱状列 + 逐行等宽 + 柱内 -> 降级，既不报 collision 也不报 truncated。"""
    rows: list[tuple[int, float]] = []
    rows += _bar_rows(ZERO_PX + 10.0, range(10, 15))  # 第一根柱（短）
    rows += _bar_rows(RIGHT_PX - 1.0, range(15, 20))  # 第二根柱（触边）
    flags = _flags([_column(plot_type="bar", rows=rows)])

    truncated = flags[FLAG_TRUNCATED]
    collision = flags[FLAG_COLLISION]
    assert truncated["count"] == 0
    assert collision["count"] == 0
    # 9 个相邻行对里 8 个 Δx==0 -> 0.889
    assert truncated["downgraded_low_priority"] == 5
    assert collision["downgraded_low_priority"] == 5
    assert truncated["structure"] == [
        {
            "column": "Quercus",
            "plot_type": "bar",
            "zero_step_fraction": 0.889,
            "bar_structure": True,
            "anchor_edited": False,
            "full_span_px": 95.0,
        }
    ]


def test_bar_first_row_of_each_bar_is_also_downgraded() -> None:
    """柱体首行的另一侧是上一根柱（Δx 很大）——它仍属柱内，必须一起降级。

    这是 #92 的核心：若要求"两侧相邻行都等宽"，每根柱子都会在首行漏出一条误报。
    """
    rows: list[tuple[int, float]] = []
    rows += _bar_rows(ZERO_PX + 10.0, range(10, 15))
    rows += _bar_rows(RIGHT_PX - 1.0, range(15, 20))
    collision = _flags([_column(plot_type="bar", rows=rows)])[FLAG_COLLISION]
    assert 15 not in [row["row_px"] for row in collision["rows"]]


def test_same_shape_with_area_plot_type_is_reported() -> None:
    """同一形状但 `plot_type=area` -> 不降级：整段平台逐行报 truncated。"""
    rows: list[tuple[int, float]] = []
    rows += _bar_rows(ZERO_PX + 10.0, range(10, 15))
    rows += _bar_rows(RIGHT_PX - 1.0, range(15, 20))
    flags = _flags([_column(plot_type="area", rows=rows)])
    assert [row["row_px"] for row in flags[FLAG_TRUNCATED]["rows"]] == [15, 16, 17, 18, 19]
    assert flags[FLAG_COLLISION]["count"] == 0
    assert flags[FLAG_COLLISION]["downgraded_low_priority"] == 0


def test_bar_plot_type_without_step_structure_is_reported() -> None:
    """标成 bar 但逐行渐变（等宽占比 < 0.5）-> 结构条件不成立，照报。"""
    rows = [(row, ZERO_PX + 10.0 + row) for row in range(10, 20)]
    rows += _bar_rows(RIGHT_PX - 1.0, range(20, 23))
    flags = _flags([_column(plot_type="bar", rows=rows)])
    assert flags[FLAG_TRUNCATED]["structure"][0]["bar_structure"] is False
    assert [row["row_px"] for row in flags[FLAG_TRUNCATED]["rows"]] == [20, 21, 22]
    assert flags[FLAG_TRUNCATED]["downgraded_low_priority"] == 0


def test_narrow_column_bar_is_still_downgraded() -> None:
    """窄列（绘图区 15px）里触边行只到 93% 量程，仍须降级。

    这条钉的是"不要重新引入百分比满量程门"：15px 宽的列里 1px = 6.7% 量程，
    `span ≥ 0.95 × full_span` 会把合法满量程柱误判成碰撞。
    """
    narrow_right = ZERO_PX + 15.0
    rows = _bar_rows(ZERO_PX + 2.0, range(10, 13))  # 短柱
    rows += _bar_rows(narrow_right - 1.0, range(13, 16))  # 触边柱：span 14 / 15 = 93.3%
    flags = _flags([_column(plot_type="bar", right_px=narrow_right, rows=rows)])
    assert flags[FLAG_TRUNCATED]["count"] == 0
    assert flags[FLAG_COLLISION]["count"] == 0
    assert flags[FLAG_COLLISION]["downgraded_low_priority"] == 3


# ------------------------------------------------------------------- 数据不足 / 跳过


def test_control_point_synthesised_column_is_skipped() -> None:
    """插值合成列的 x 不是读数 -> 整列 skipped，不下结论。"""
    flags = _flags(
        [
            _column(
                points_provenance="control_point",
                rows=[(10, ZERO_PX), (11, RIGHT_PX - 1.0)],
            )
        ]
    )
    expected = [
        {"column": "Quercus", "reason": "points_synthesized_from_control_points"}
    ]
    assert flags[FLAG_AXIS_BLIND]["skipped_columns"] == expected
    assert flags[FLAG_TRUNCATED]["skipped_columns"] == expected
    assert flags[FLAG_TRUNCATED]["count"] == 0


def test_missing_geometry_skips_the_column() -> None:
    """没有 0 点 / 列右端 -> 整列 skipped，不按列宽兜底。"""
    flags = _flags([_column(zero_px=None, rows=[(10, ZERO_PX)])])
    assert flags[FLAG_AXIS_BLIND]["skipped_columns"] == [
        {"column": "Quercus", "reason": "column_geometry_missing"}
    ]


def test_exagg_ratio_reports_what_is_missing() -> None:
    """没有内外线成对读数 -> skipped，并列出缺哪两个字段。"""
    flags = _flags([_column(rows=[(10, ZERO_PX + 10.0)], exaggeration_mult=5.0)])
    block = flags[FLAG_EXAGG_RATIO]
    assert block["status"] == "skipped"
    assert block["reason"] == "no_paired_inner_outer_readings"
    assert block["missing"] == [
        "per-row inner-line x (inner_xs_px)",
        "per-row outer-line x (outer_xs_px)",
    ]
    assert block["skipped_columns"] == [
        {"column": "Quercus", "reason": "no_paired_inner_outer_readings"}
    ]


def test_exagg_ratio_range_when_paired_readings_exist() -> None:
    """给上内外线成对读数时才判 [3.0, 5.5]（当前无生产数据源，这里钉公式本身）。"""
    flags = _flags(
        [
            _column(
                rows=[(10, ZERO_PX + 5.0), (11, ZERO_PX + 5.0), (12, ZERO_PX + 5.0)],
                inner_xs_px=[ZERO_PX + 2.0, ZERO_PX + 4.0, ZERO_PX + 2.0],
                outer_xs_px=[
                    ZERO_PX + 10.0,  # ratio 5.0 -> 区间内，不报
                    ZERO_PX + 4.0,  # ratio 1.0 -> 区间外，报
                    ZERO_PX + 33.0,  # ratio 16.5 -> 区间外，报
                ],
            )
        ]
    )
    block = flags[FLAG_EXAGG_RATIO]
    assert block["status"] == "computed"
    assert [row["row_px"] for row in block["rows"]] == [11, 12]
    assert [row["ratio"] for row in block["rows"]] == [1.0, 16.5]


def test_empty_column_list_keeps_the_same_key_set() -> None:
    """一个列都没有时，四块旗标仍然都在（键集恒定，前端不分支）。"""
    flags = _flags([])
    assert set(flags) == {
        FLAG_AXIS_BLIND,
        FLAG_TRUNCATED,
        FLAG_COLLISION,
        FLAG_EXAGG_RATIO,
    }
    for block in flags.values():
        assert block["status"] == "skipped"
        assert block["reason"] == "roi_has_no_columns"
        assert block["rows"] == []


# ------------------------------------------------------------------------ 接线


def test_qa_summarize_wires_row_geometry_into_flags() -> None:
    """`qa_summarize` 真的把 0 点 / 列右端 / 轴宽 / 逐行像素传到旗标层。

    这测的是接线而不是公式：列上只写 `startX`/`endX`/`axis_stroke_px`/`x_ticks`，
    旗标必须自己从 `resolve_column_scale` 与列字典里取到同一组几何。
    """
    session = StraditizeSession()
    roi = session.roi_create(name="pollen", composition=True)["roi"]
    session.columns = [
        {
            "col_index": 0,
            "name": "Quercus",
            "roi_id": roi["id"],
            "startX": 100.0,
            "endX": 200.0,
            "axis_stroke_px": 5.0,
            "plot_type": "area",
            "x_ticks": [
                {"px": ZERO_PX, "value": 0.0},
                {"px": RIGHT_PX, "value": 100.0},
            ],
        }
    ]
    session.column_points = {
        0: [
            {"row": 10, "x": ZERO_PX},  # span 0 -> 盲区
            {"row": 11, "x": ZERO_PX + 15.0},
            {"row": 12, "x": RIGHT_PX - 1.0},  # 触边，与上行差 79px -> 碰撞
            {"row": 13, "x": ZERO_PX + 15.0},
        ]
    }
    session.samples = []

    summary = session.qa_summarize(roi_id=roi["id"])

    flags = summary["flags"]
    assert flags[FLAG_AXIS_BLIND]["rows"] == [
        {
            "flag": FLAG_AXIS_BLIND,
            "column": "Quercus",
            "row_px": 10,
            "span_px": 0.0,
            "axis_px": 5.0,
        }
    ]
    assert [row["row_px"] for row in flags[FLAG_COLLISION]["rows"]] == [12]
    assert flags[FLAG_TRUNCATED]["count"] == 0
    assert flags[FLAG_EXAGG_RATIO]["status"] == "skipped"
