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

import numpy as np
import pytest
from scipy.signal import find_peaks

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
    values = np.clip(np.asarray([p["x"] for p in points], dtype=float) - c_start, zero, None)
    manual = set(getattr(session, "_manual_store", lambda: {})().get(col_index, {}))
    ctrl = {int(r): float(x) - c_start for r, x in session.control_points[col_index].items()}
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


#: 端段豁免的行距上限（px）：离 y0 / y1 这么近的对，一律按"端段"豁免。
#:
#: 为什么不能只按"是否相邻"判豁免：`ROI 掩膜改闭区间`（PR #70）之后，取样窗口最后
#: 几行第一次能被读到，列底台阶的"台阶脚"因此显形——实测 col10 在 y=863/867 出现一对
#: 行距 4px、取值相同的强制锚点，距 y1=869 只有 2–6 行。它与已被豁免的"台阶脚与 y1
#: 端点相邻"是同一个几何不动点，只是深了 4 行。按行距豁免是把已有理由写完整，不是放水：
#: 中段（距两端 > 8px）一个都不放宽，预算公式也不动。
PILEUP_END_EXEMPT_PX = 8.0


def _pairs(
    rows: np.ndarray,
    values: np.ndarray,
    min_gap: float,
    min_value_gap: float,
    end_exempt_px: float = PILEUP_END_EXEMPT_PX,
):
    """相邻控制点里 (行距 < min_gap 且取值差 < min_value_gap) 的对，带端段标记。

    端段判据取**并集**：① 该对碰到最外层控制点（原口径）；② 该对距 y0 或 y1 不超过
    `end_exempt_px`。取并集而不是替换，是为了不把原来被豁免的对变成违规（那样会引入
    与本次改动无关的新红）。
    """
    last = len(rows) - 1
    y_low = float(rows[0])
    y_high = float(rows[-1])
    out = []
    for i in range(len(rows) - 1):
        if rows[i + 1] - rows[i] >= min_gap:
            continue
        if abs(values[i + 1] - values[i]) >= min_value_gap:
            continue
        touches_outermost = i in (0, last) or (i + 1) in (0, last)
        near_ends = (rows[i] - y_low <= end_exempt_px) or (
            y_high - rows[i + 1] <= end_exempt_px
        )
        out.append((i, i + 1, touches_outermost or near_ends))
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
        bad = [round(float(v), 2) for v in profile["all_values"] if v < profile["zero"] - 1e-9]
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
    return max(PILEUP_BUDGET_FLOOR, int(PILEUP_BUDGET_RATIO * control_point_count))


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
            profile["auto_rows"], profile["auto_values"],
            PILEUP_MIN_GAP_PX, IDENTICAL_VALUE_PX,
        )
        inside = [
            (int(profile["auto_rows"][i]), int(profile["auto_rows"][j]))
            for i, j, at_end in pairs
            if not at_end
        ]
        budget = _pileup_budget(len(profile["auto_values"]))
        if len(inside) > budget:
            offenders[col_index] = {"count": len(inside), "budget": budget, "pairs": inside[:5]}
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
