# -*- coding: utf-8 -*-
"""issue #120：`FLAG_EXAGG_RATIO` 与列级 `exaggeration_mult` 挂钩并对零点偏移解耦。

## 缺陷本体
此前写死 `EXAGG_RATIO_RANGE = (3.0, 5.5)`：
- 当用户图版倍率为 10x 时，正常 10x 被 100% 误报为异常；
- 当真实钻孔（如 Gahai）零点微小偏移 1~2px 时，比值 p50 抬高到 6.6，导致 77.9% 假告警。

## 治理后判据
1. 声明 `exaggeration_mult=10.0` 时，比值 9.5 落在 `[5.5, 14.5]` 正常带内，不告警；比值 4.0 准确告警；
2. 声明 `exaggeration_mult=5.0` 时，零点轻微偏移产生的 ratio=6.6 落在 `[2.75, 7.25]` 正常带内，消除 77.9% 假告警；
3. 真倍率错误（声明 5.0，实际 1.0 或 16.5）准确捕获；
4. 未声明倍率时回退至默认区间 `[3.0, 5.5]`，保持零回归。
"""

from __future__ import annotations

from straditize_core.qa import FLAG_EXAGG_RATIO, compute_qa_flags

ZERO_PX = 100.0


def _build_col(inner_x: float, outer_x: float, mult: float | None = None) -> dict:
    col = {
        "name": "Pinus",
        "zero_px": ZERO_PX,
        "right_px": 300.0,
        "axis_px": 2.0,
        "plot_type": "area",
        "points_provenance": "measured",
        "anchor_edited": False,
        "rows_px": [10],
        "xs_px": [inner_x],
        "inner_xs_px": [inner_x],
        "outer_xs_px": [outer_x],
    }
    if mult is not None:
        col["exaggeration_mult"] = mult
    return col


def test_custom_mult_10x_accepted_without_false_alarm() -> None:
    """声明 10x 时，比值 9.5 绝不报红；比值 4.0 报红。"""
    # 1. 正常 10x：inner=10px, outer=95px -> ratio = 9.5
    col_ok = _build_col(ZERO_PX + 10.0, ZERO_PX + 95.0, mult=10.0)
    flags_ok = compute_qa_flags([col_ok])
    assert flags_ok[FLAG_EXAGG_RATIO]["status"] == "computed"
    assert flags_ok[FLAG_EXAGG_RATIO]["rows"] == []

    # 2. 异常值：inner=10px, outer=40px -> ratio = 4.0 (远低于 10x 门槛 5.5)
    col_err = _build_col(ZERO_PX + 10.0, ZERO_PX + 40.0, mult=10.0)
    flags_err = compute_qa_flags([col_err])
    assert flags_err[FLAG_EXAGG_RATIO]["status"] == "computed"
    assert len(flags_err[FLAG_EXAGG_RATIO]["rows"]) == 1
    assert flags_err[FLAG_EXAGG_RATIO]["rows"][0]["ratio"] == 4.0


def test_gahai_zero_point_drift_tolerance() -> None:
    """Gahai 现场：5x 声明下，零点轻微漂移产生的 ratio=6.6 落在容许带内。"""
    # 模拟 inner 真实 3px，受 2px 偏移影响测得 5px；outer 测得 33px -> ratio = 6.6
    col = _build_col(ZERO_PX + 5.0, ZERO_PX + 33.0, mult=5.0)
    flags = compute_qa_flags([col])
    assert flags[FLAG_EXAGG_RATIO]["status"] == "computed"
    # 自适应区间 [5.0 * 0.55, 5.0 * 1.45] = [2.75, 7.25]，6.60 落在带内，不误报
    assert flags[FLAG_EXAGG_RATIO]["rows"] == []


def test_genuine_mult_error_still_caught() -> None:
    """真正倍率严重失真（如 1.0 或 16.5）仍被 100% 截获。"""
    col1 = _build_col(ZERO_PX + 10.0, ZERO_PX + 10.0, mult=5.0)  # ratio = 1.0
    flags1 = compute_qa_flags([col1])
    assert len(flags1[FLAG_EXAGG_RATIO]["rows"]) == 1

    col2 = _build_col(ZERO_PX + 2.0, ZERO_PX + 33.0, mult=5.0)  # ratio = 16.5
    flags2 = compute_qa_flags([col2])
    assert len(flags2[FLAG_EXAGG_RATIO]["rows"]) == 1


def test_fallback_to_default_range_when_no_mult() -> None:
    """未指定倍率时回退至 [3.0, 5.5]。"""
    col_ok = _build_col(ZERO_PX + 10.0, ZERO_PX + 50.0)  # ratio = 5.0
    flags_ok = compute_qa_flags([col_ok])
    assert flags_ok[FLAG_EXAGG_RATIO]["rows"] == []

    col_out = _build_col(ZERO_PX + 10.0, ZERO_PX + 60.0)  # ratio = 6.0 (超 5.5)
    flags_out = compute_qa_flags([col_out])
    assert len(flags_out[FLAG_EXAGG_RATIO]["rows"]) == 1
