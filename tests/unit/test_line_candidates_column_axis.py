# -*- coding: utf-8 -*-
"""自动干扰线检测**不得把列轴本身提成候选**（步骤 4 的核心缺陷）。

## 缺陷本体（实测，`hoya-del-castillo.png`）

`detect_line_candidates()` 的 Kind B（贯穿纵线）用 ``_projection_line_cols``
在 ``fraction=0.30`` 上找纵向贯穿线。面积图的**列轴**（列左缘那条竖线）恰好
满足全部闸门：1–3px 宽（< ``max_thick``）、贯穿 ROI 高度。

反过来，"实线轴 + 填充"会连成一个宽 cluster，被"太厚"滤掉。于是检出的偏好
恰好**反向选中了最不该删的那批**：实测 21 条候选里 18 条是竖线，**18 条全部
落在列左缘 ±2px 内**——就是 29 条列轴中的 18 条。

用户按面板提示"逐条确认"（或未来任何批量确认）时，删掉的是轴线：轴线是这一列
的 0 点，扣掉之后 col02 / col15 / col22 分别有 101 / 294 / 255 行的读数整体
位移 1px，而界面上**没有任何变化**。

## 判据（结构判据，不是阈值）

- 用**真实图片 + 真实 ROI + 真实分列**：落在列左缘 ±2px 的竖线候选数必须为 **0**。
- 判据不能靠调阈值变绿：同一张图、同一组参数，只把 ``columns`` 换成 ``None``
  （即"后端不知道列在哪"），那些竖线必须**仍然全部被提出**。这证明抑制来自
  **列结构**，而不是"把 fraction 调到把干扰线也滤掉"。
- 负向对照各一条：真正的横向干扰线、列内竖直污点，修后仍必须是候选。
"""

from __future__ import annotations

import numpy as np

from straditize_core.lines import detect_line_candidates
from straditize_core.session import StraditizeSession

#: 列左缘重合多少像素以内算"这一列的轴"。与 `cleanup.AXIS_BAND_PX` 同口径。
AXIS_TOLERANCE_PX = 2


def _hoya_session() -> tuple[StraditizeSession, str]:
    """真实图片 + 真实分列：与步骤 4 的真实前置状态一致。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    roi_id = session.rois[0]["id"]
    session.detect_columns(roi_id=roi_id)
    return session, roi_id


def _column_axis_x(session: StraditizeSession) -> list[int]:
    return [int(round(float(col["start"]))) for col in session.columns]


def _on_axis(candidate: dict, axis_x: list[int]) -> bool:
    return candidate.get("axis") == "v" and any(
        abs(int(candidate["at"]) - x) <= AXIS_TOLERANCE_PX for x in axis_x
    )


def test_hoya_automated_candidates_never_sit_on_a_column_axis() -> None:
    """真图判据：自动候选里落在列轴上的竖线数 == 0。

    修前实测 18 条（见文件顶部），因此这条在修前必红。
    """
    session, roi_id = _hoya_session()
    axis_x = _column_axis_x(session)
    assert len(axis_x) == 29, (
        f"前置：hoya 应切出 29 列，实测 {len(axis_x)} —— 分列口径变了，"
        "本判据的坐标不再成立，先核对分列再改断言"
    )

    candidates = session.detect_line_candidates(roi_id)["candidates"]
    offenders = [c for c in candidates if _on_axis(c, axis_x)]

    assert offenders == [], (
        f"自动检测提出了 {len(offenders)} 条正好落在列轴上的竖线候选"
        f"（x={[c['at'] for c in offenders]}，列左缘={axis_x}）—— "
        "确认它们就是删掉这一列的 0 点：读数会静默整体偏移 1px。"
        "列轴必须按**结构判据**（与 columns[].start 重合）排除，不是调 fraction"
    )

    # 反向哨兵：抑制列轴不能顺手把真正的横向区带线一起滤掉。
    horizontals = [c for c in candidates if c.get("axis") == "h"]
    assert len(horizontals) >= 3, (
        f"横向区带线被一并滤掉了（实测 {len(horizontals)} 条，期望 ≥3）—— "
        "抑制列轴只应作用于竖向候选"
    )


def test_same_vertical_lines_still_proposed_when_columns_are_unknown() -> None:
    """金丝雀（判别力）：抑制必须来自**列结构**，不是阈值被调掉了。

    同一张图、同一 ROI、同一组检测参数，只把 ``columns`` 换成 ``None``。
    此时后端不知道列在哪，那些竖线必须照样被提出 —— 且它们确实是列轴位置。
    """
    session, roi_id = _hoya_session()
    axis_x = _column_axis_x(session)
    _rid, roi = session._roi_for(roi_id)

    unknown = detect_line_candidates(
        session.foreground_mask, roi, columns=None, roi_id=roi_id
    )
    verticals = [c["at"] for c in unknown if c.get("axis") == "v"]

    assert len(verticals) >= 10, (
        f"没有列信息时竖向候选只剩 {len(verticals)} 条 —— 说明竖线是被阈值滤掉的，"
        "而不是被列结构判据排除的；后者才是本修复的方式"
    )
    on_axis = [at for at in verticals if any(abs(at - x) <= AXIS_TOLERANCE_PX for x in axis_x)]
    assert len(on_axis) == len(verticals), (
        f"没有列信息时提出的竖线 {verticals} 里有 {len(verticals) - len(on_axis)} 条"
        f"不在列轴上（列左缘={axis_x}）—— 前提变了，本判据需要重新核对"
    )


def test_synthetic_axis_is_suppressed_but_real_strokes_are_kept() -> None:
    """合成负向对照：横线 / 列内竖直污点必须仍是候选，列轴必须不是。

    「列内竖直污点」是 Kind C 的正例：它在列**内部**、不贯穿 ROI，和列轴是
    两类东西；抑制列轴不能顺手把它一起吞掉，否则用户再也没有任何手段处理
    列内的局部竖线（那才是真正要去掉的干扰）。
    """
    ink = np.zeros((400, 400), dtype=bool)
    columns = [{"start": 100, "end": 200, "roi_id": "roi_1"}]

    ink[200, 10:390] = True  # 横向干扰线：y 恒定，贯穿 95% 宽度
    ink[:, 100] = True  # 列轴：贯穿全高、1px 宽 —— 正是被误提的那一类
    ink[150:211, 150] = True  # 列内竖直污点：61px = 15% 高度，不贯穿 ROI

    candidates = detect_line_candidates(
        ink,
        {"xlim": [0, 400], "ylim": [0, 400]},
        columns=columns,
        line_fraction_h=0.75,
        line_fraction_v=0.30,
        line_width_min=1,
        line_width_max=3,
    )
    horizontal = [c for c in candidates if c.get("axis") == "h"]
    vertical = [c for c in candidates if c.get("axis") == "v"]

    assert any(abs(c["at"] - 200) <= 1 for c in horizontal), (
        f"真正的横向干扰线（y=200）没被提出：{[c['at'] for c in horizontal]}"
    )
    assert not any(abs(c["at"] - 100) <= AXIS_TOLERANCE_PX for c in vertical), (
        f"列轴（x=100，columns[0].start）被提成了候选：{[c['at'] for c in vertical]}"
    )
    assert any(abs(c["at"] - 150) <= 1 for c in vertical), (
        f"列内竖直污点（x=150）没被提出：{[c['at'] for c in vertical]}"
    )
