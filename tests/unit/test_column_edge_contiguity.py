# -*- coding: utf-8 -*-
"""**前提钉子**：列右缘与下一列左缘同址——"现有左缘规则已覆盖右缘"的前提。

## 这条判据判定的是什么（不是功能保证）

`lines.py` 的 `_is_column_axis` 只按 `columns[].start` 排除竖线候选，**没有**
按 `columns[].end` 做过任何抑制。这样够用的唯一理由是：`detect_columns` 产出的
列是**首尾相接**的，`end[i] == start[i+1]`，于是每个内部右缘与下一列左轴是同一个
x，右缘自动被左缘规则覆盖。

这条断言钉的就是这个前提本身。它**不保证**任何功能，只保证：
**一旦分列开始产出间隙列（`end[i] < start[i+1]`），右缘就变成一个既不被左缘规则
覆盖、也不在任何采样窗口内的位置，必须重新决策要不要抑制右缘。**

## 为什么不用"右缘候选条数 == 0"当门禁

实测（2026-11-14，hoya 29 列 / beginner 4 列）：落在列右缘 ±2px 且不与任何
`start ±2` 重合的自动候选 = **0 条**。这条断言现在恒绿——无论抑制逻辑在不在，
它都绿，**零判别力**；拿它当门禁等于没有门禁（判据层第 ④⑦ 问）。

判别力对照（**已实测**，2026-11-14 hoya）：屏蔽 `_is_column_axis`（恒返回 False，
即左缘规则失效）后竖线候选 0 → **19 条**，而"仅右缘 ±2（不与任何 start ±2 重合）"
仍然是 **0 条**——右缘候选与左缘共址，被"不与 start 重合"这半句挡掉了，所以
"右缘候选条数 == 0"这条**不变红**，确认零判别力；
而本文件这条结构断言与抑制逻辑无关，只在列结构真的变化时变红——那才是它要守的
边界。

## 实测数据（支撑本判据的取值口径）

| 图 | 列数 | `start[i+1] − end[i]` | 原始竖线候选（`columns=None`） | 其中 at == end | 其中 at == start+1 |
|---|---|---|---|---|---|
| hoya | 29 | 28/28 全为 0 | 14 条 | 6 条 → 相邻两列 0/808 行变化 | 8 条 → 本列 264–415 行有 1px 位移 |
| beginner | 4 | 3/3 全为 0 | 0 条 | — | — |

"删掉右缘线不改读数"的机制：`_digitize_column_window` 的窗口是
`[start, end−1]`，右缘那 1px 本就在窗口外；擦掉窗口内的 `start` 后，"无墨迹 →
回落到 start"的兜底给出同一个值，故 0 行变化。真正会伤读数的是带覆盖 `start+1`
的那 8 条——它们全是**左轴**，这正是左缘规则必须存在的原因。

## 已知未覆盖情形（不宣称）

若用户把 ROI 右端拉得明显超出最后一列右缘，最后一列右缘不再落在 `lines.py` 的
`edge_margin` 里、可能被检出。该情形**未造用例、未实测**，本文件不对它作任何
断言，也不外推"删掉它无害"的结论。
"""

from __future__ import annotations

import pytest

from straditize_core.session import StraditizeSession

#: "同址"的容差：与 `lines.COLUMN_AXIS_TOLERANCE_PX` / `cleanup.AXIS_BAND_PX` 同口径。
CONTIGUITY_TOLERANCE_PX = 2


def _session(sample_key: str, bounds: tuple[list[int], list[int]] | None) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key=sample_key)
    roi_id = session.rois[0]["id"]
    if bounds is None:
        session.detect_columns(roi_id=roi_id)
    else:
        session.detect_columns(bounds[0], bounds[1], roi_id=roi_id)
    assert session.columns, f"前置：{sample_key} 应切出列"
    return session


@pytest.mark.parametrize(
    ("sample_key", "bounds", "expected_columns"),
    [
        ("hoya", None, 29),
        ("beginner", None, 4),
    ],
)
def test_columns_are_contiguous_so_the_left_axis_rule_covers_the_right_edge(
    sample_key: str, bounds, expected_columns: int
) -> None:
    """前提钉子：相邻列必须首尾相接（`end[i] ≈ start[i+1]`）。

    这不是功能保证，是"右缘不需要单独抑制"这一决定的**成立条件**。红了的含义
    = 分列开始产出间隙列 = 右缘不再是任何列的左轴 = 必须重新决策右缘抑制。
    """
    session = _session(sample_key, bounds)
    cols = session.columns
    assert len(cols) == expected_columns, (
        f"前置：{sample_key} 应切出 {expected_columns} 列，实测 {len(cols)} —— "
        "分列口径变了，本判据的坐标前提也要跟着复核"
    )

    gaps = [
        (i, round(float(cols[i]["end"])) - round(float(cols[i + 1]["start"])))
        for i in range(len(cols) - 1)
    ]
    offenders = [
        (i, gap) for i, gap in gaps if abs(gap) > CONTIGUITY_TOLERANCE_PX
    ]

    assert offenders == [], (
        f"{sample_key} 的列不再首尾相接：{offenders}（列号, end[i]-start[i+1]）。"
        "右缘与下一列左缘不再同址，`_is_column_axis` 只按 start 排除就盖不住右缘了"
        "——必须重新决策：要么按 end 也做抑制，要么证明间隙右缘的候选删掉不改读数"
    )
