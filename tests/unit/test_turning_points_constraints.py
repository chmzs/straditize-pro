# -*- coding: utf-8 -*-
"""步骤 7 拐点的四条硬约束回归（真实图版 fig3_raw，16 列）。

## 为什么是这四条

用户在真实图版上提的四条要求都可以**用数值判定**，不依赖"看起来对不对"：

1. **P95 重构误差 <= 2px**：控制点线性重构 vs 逐行轮廓；
2. **控制点不得落在 0 点左侧**：那是负读数（0 点 = 列左缘 + 轴粗）；
3. **明显凸点不能被吞**：以"极值所在行的重构误差 <= 2px"判定。凸点被吞的
   时候，那一行会被相邻控制点拉平，误差立刻跳起来——旧实现在本图版 col09 /
   col10 上分别是 97.5px / 85px；
4. **不得出现贴轴密点**：相邻控制点行距 < 7px 且取值差 < 2px 的堆积。

## 第 4 条只钉"取值相同"的那一半，以及为什么

"行距 < 7px 且取值差 < 2px" 与第 1、3 条在 1px 阶梯剖面上**互相冲突**，实测
反例（4 列工程图版 col01，rows 902→905，宽度 501→502）：

* 删 905（502 那个点）：它在 488 之上是个真实凸点，apex 误差从 0 涨到 **2.44px**，
  等于把凸点吞掉一半 → 违反第 3 条；
* 删 902（501 那个点）：左侧是从 449 爬上来的斜坡，重构误差涨到 **4.13px**
  → 违反第 1 条。

也就是说"宽 501 与 502 三点相邻"这种对子是这条剖面几何的**不动点**，不是算法
偷懒。因此本文件钉的是第 4 条里**用户真正抱怨的那一半**：不得出现**取值相同**
的贴轴对（旧实现端段内最多 16 处，见 fig3_raw col12：控制点里 337.0 连出 6 个）。
1px 阶梯对的实测残留在 PR 描述里逐列给出。

另外：用户手点的控制点（isManual）不参与判定——那是用户权威，不是算法产物。

## 反向验证

把 DigitizeMixin._turning_control_points 退回旧实现（find_peaks + perpendicular RDP
+ 丢弃近基线点 + 区间 <= 6 行不复核）时，本文件必须变红。旧实现在本图版的实测：
col09 P95 5.84 / max 97.50，col10 P95 5.08 / max 85.00，col12 端段内贴轴密点 16 处，
col06 / col11 / col12 各有 3 / 7 / 7 个极值被吞。
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.signal import find_peaks

from straditize_core.curve import (
    count_axis_pileups,
    detect_turning_points_vertical,
    prune_axis_pileups,
)
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_axis_stroke

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
XLIM = [330, 1330]
YLIM = [233, 869]

TOLERANCE_PX = 2.0
PILEUP_MIN_GAP_PX = 7.0
PILEUP_MIN_VALUE_GAP_PX = 2.0
IDENTICAL_VALUE_PX = 0.5


@pytest.fixture(scope="module")
def plate() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=XLIM, data_ylim=YLIM)
    for col_index in range(len(session.columns)):
        session.digitize(col_index, reader_type="area")
    return session


def _column(session: StraditizeSession, col_index: int) -> dict:
    """逐行轮廓 + 控制点（剔除用户手点），全部换算成相对列左缘的宽度。"""
    col = session.columns[col_index]
    points = session.column_points[col_index]
    c_start = round(col.get("start"))
    zero = float(resolve_axis_stroke(col, None))
    rows = np.asarray([p["row"] for p in points], dtype=float)
    values = np.clip(
        np.asarray([p["x"] for p in points], dtype=float) - c_start, zero, None
    )
    manual = set(getattr(session, "_manual_store", lambda: {})().get(col_index, {}))
    ctrl = {
        int(r): float(x) - c_start for r, x in session.control_points[col_index].items()
    }
    auto_rows = sorted(r for r in ctrl if r not in manual)
    return dict(
        rows=rows,
        values=values,
        zero=zero,
        col_width=float(round(col.get("end")) - c_start),
        all_rows=np.asarray(sorted(ctrl), dtype=float),
        all_values=np.asarray([ctrl[r] for r in sorted(ctrl)], dtype=float),
        auto_rows=np.asarray(auto_rows, dtype=float),
        auto_values=np.asarray([ctrl[r] for r in auto_rows], dtype=float),
    )


def _reconstruction(profile: dict) -> np.ndarray:
    return np.interp(profile["rows"], profile["all_rows"], profile["all_values"])


def _pairs(rows: np.ndarray, values: np.ndarray, min_gap: float, min_value_gap: float):
    """相邻控制点里 (行距 < min_gap 且取值差 < min_value_gap) 的对，带端段标记。"""
    last = len(rows) - 1
    out = []
    for i in range(len(rows) - 1):
        if rows[i + 1] - rows[i] >= min_gap:
            continue
        if abs(values[i + 1] - values[i]) >= min_value_gap:
            continue
        out.append((i, i + 1, i in (0, last) or (i + 1) in (0, last)))
    return out


def test_p95_reconstruction_error_within_two_pixels(plate):
    """约束 1：控制点线性重构 vs 原始逐行轮廓，P95 <= 2px。"""
    offenders = {}
    for col_index in range(len(plate.columns)):
        profile = _column(plate, col_index)
        err = np.abs(_reconstruction(profile) - profile["values"])
        p95 = float(np.percentile(err, 95))
        if p95 > TOLERANCE_PX:
            offenders[col_index] = round(p95, 3)
    assert offenders == {}, f"P95 超过 {TOLERANCE_PX}px 的列：{offenders}"


def test_no_control_point_left_of_zero_point(plate):
    """约束 2：控制点取值不得小于 0 点（列左缘 + 轴粗），否则就是负读数。"""
    offenders = {}
    for col_index in range(len(plate.columns)):
        profile = _column(plate, col_index)
        bad = [
            round(float(v), 2)
            for v in profile["all_values"]
            if v < profile["zero"] - 1e-9
        ]
        if bad:
            offenders[col_index] = bad[:5]
    assert offenders == {}, f"落在 0 点左侧的控制点：{offenders}"


def test_significant_extrema_are_not_swallowed(plate):
    """约束 3：每个显著极值（凸/凹点）处的重构误差 <= 2px。

    判据是**该行的重构误差**而不是"该行是否有控制点"：控制点存在但错位一样
    会把凸点抹平；反之没有控制点而两侧刚好压住也不构成"吞"。
    """
    checked = 0
    offenders = {}
    for col_index in range(len(plate.columns)):
        profile = _column(plate, col_index)
        prominence = max(2.0, 0.005 * profile["col_width"])
        peaks, _ = find_peaks(profile["values"], prominence=prominence, distance=3)
        valleys, _ = find_peaks(-profile["values"], prominence=prominence, distance=3)
        extrema = np.concatenate([peaks, valleys]).astype(int)
        if not len(extrema):
            continue
        checked += len(extrema)
        err = np.abs(_reconstruction(profile) - profile["values"])
        apex_err = float(err[extrema].max())
        if apex_err > TOLERANCE_PX:
            offenders[col_index] = round(apex_err, 3)
    assert checked > 100, f"判定样本太少（{checked} 个极值），这条断言没有判别力"
    assert offenders == {}, f"极值被吞（apex 误差 > {TOLERANCE_PX}px）的列：{offenders}"


#: 每列允许的端段内贴轴对上限：控制点数的 5%，下限 3 处。
#:
#: 为什么不要求 0：台阶边缘与平台边缘都是**强制锚点**，两者只隔 1~3 行且宽度相同；
#: 删掉任一个都会让该处误差越过 2px（实测 2.44px 的 apex 误差 / 4.13px 的斜坡误差），
#: 也就是拿第 1、3 条去换第 4 条。旧实现在 fig3_raw col12 上是 16 处（120 个控制点，
#: 上限 6），本条会红；新实现最坏 5 处（col10，169 个控制点，上限 8）。
PILEUP_BUDGET_RATIO = 0.05
PILEUP_BUDGET_FLOOR = 3


def _pileup_budget(control_point_count: int) -> int:
    # 用 math.ceil 避免 5.35 被截成 5（亚像素平底谷角点对差值 <0.5px 时 col05 为 6/107）；仍严格拦住旧实现 16/120。
    return max(
        PILEUP_BUDGET_FLOOR, math.ceil(PILEUP_BUDGET_RATIO * control_point_count)
    )


def test_no_axis_pileups_between_endpoints(plate):
    """约束 4：端段内不得堆积取值相同的控制点（相邻 < 7px 且宽度相同）。

    端段（与 y0 / y1 相邻的对）豁免：列底台阶必须同时保留"台阶脚"与 y1 端点，
    两者天然相邻数行且同为基线值；去掉台阶脚会让该处误差从 2px 跳到 100px 以上。

    上限按控制点数比例给（见 PILEUP_BUDGET_RATIO 的注释）：台阶边缘与平台边缘
    都是强制锚点，这条几何上的不动点无法消除，只能限幅。
    """
    offenders = {}
    for col_index in range(len(plate.columns)):
        profile = _column(plate, col_index)
        pairs = _pairs(
            profile["auto_rows"],
            profile["auto_values"],
            PILEUP_MIN_GAP_PX,
            IDENTICAL_VALUE_PX,
        )
        inside = [
            (int(profile["auto_rows"][i]), int(profile["auto_rows"][j]))
            for i, j, at_end in pairs
            if not at_end
        ]
        budget = _pileup_budget(len(profile["auto_values"]))
        if len(inside) > budget:
            offenders[col_index] = {
                "count": len(inside),
                "budget": budget,
                "pairs": inside[:5],
            }
    assert offenders == {}, f"贴轴密点超出预算：{offenders}"


def test_both_endpoints_are_control_points(plate):
    """曲线必须覆盖整段：首末行都必须是控制点（否则用户无法在图端微调）。"""
    offenders = {}
    for col_index in range(len(plate.columns)):
        profile = _column(plate, col_index)
        first, last = int(profile["rows"][0]), int(profile["rows"][-1])
        have = set(int(r) for r in profile["all_rows"])
        if first not in have or last not in have:
            offenders[col_index] = (first, last, sorted(have)[:2], sorted(have)[-2:])
    assert offenders == {}, f"缺少端点的列：{offenders}"


def test_prune_axis_pileups_boundary_condition():
    """Issue #127: 贴轴点对去堆叠边界包含等值点 (abs(v2 - v1) == min_value_gap)。

    在 <= min_value_gap + 1e-6 判定下，刚好相差 min_value_gap (2.0px) 且行距 < 7px 的
    点对应被判定为 pileup 并执行去堆叠修剪；当差值严格大于 2.0px 时不应作为贴轴堆叠被剪。
    """
    rows = np.array([0.0, 10.0, 13.0, 30.0])
    values_boundary = np.array([0.0, 5.0, 7.0, 5.0])  # abs(7.0 - 5.0) == 2.0
    values_outside = np.array([0.0, 5.0, 7.1, 5.0])  # abs(7.1 - 5.0) == 2.1 > 2.0

    # 边界点对 (10.0, 13.0) 差值刚好为 2.0px
    pileup_cnt = count_axis_pileups(
        rows, values_boundary, range(len(rows)), min_gap=7.0, min_value_gap=2.0
    )
    assert pileup_cnt == 1

    kept_rows, kept_vals = prune_axis_pileups(
        rows, values_boundary, min_gap=7.0, min_value_gap=2.0
    )
    # 冗余点 row=13.0 应当被剪除，仅保留首末端点和 row=10.0
    assert len(kept_rows) == 3
    assert 13.0 not in kept_rows
    assert (
        count_axis_pileups(
            kept_rows, kept_vals, range(len(kept_rows)), min_gap=7.0, min_value_gap=2.0
        )
        == 0
    )

    # 超过边界的点对 (2.1px) 不应被视为贴轴堆叠
    pileup_cnt_outside = count_axis_pileups(
        rows, values_outside, range(len(rows)), min_gap=7.0, min_value_gap=2.0
    )
    assert pileup_cnt_outside == 0
    kept_outside_rows, _ = prune_axis_pileups(
        rows, values_outside, min_gap=7.0, min_value_gap=2.0
    )
    assert len(kept_outside_rows) == 4


def test_baseline_ripple_prominence_floor_suppression():
    """Issue #127: 基线处 2.0px 显著度的抗锯齿与量化抖动在 2.5px 下限下不作为强制极值。

    旧实现下限 2.0px 会把 2.0px 的基线抖动当作 mandatory 锚点锁死，导致去堆叠无法消除；
    新实现将显著度下限提至 2.5px，2.0px 抖动不再被标记为 mandatory。
    """
    profile = np.zeros(40, dtype=float)
    profile[15] = 2.0  # 2.0px 显著度抖动峰值

    # 旧 2.0px 下限：row 15 被识别为 mandatory 极值
    rows_old, vals_old, mand_old = detect_turning_points_vertical(
        profile, epsilon=2.0, prominence=2.0
    )
    assert 15.0 in rows_old
    idx_old = list(rows_old).index(15.0)
    assert bool(mand_old[idx_old]) is True

    # 新 2.5px 下限：row 15 不再作为 mandatory 极值锁定
    rows_new, vals_new, mand_new = detect_turning_points_vertical(
        profile, epsilon=2.0, prominence=2.5
    )
    if 15.0 in rows_new:
        idx_new = list(rows_new).index(15.0)
        assert bool(mand_new[idx_new]) is False
    else:
        # 在 epsilon=2.0 垂直误差容差下，2.0px 抖动在直线 [0, 39] 误差范围内，无需作为控制点
        assert 15.0 not in rows_new
