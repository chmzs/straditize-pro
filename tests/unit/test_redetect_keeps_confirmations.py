# -*- coding: utf-8 -*-
"""重跑「检测干扰线」不得静默作废用户已确认的擦除。

## 缺陷本体

`detect_line_candidates` 每次都 mint 全新 id（`_next_candidate_id`），然后把本 ROI
的候选整体替换掉：

```python
self.line_candidates = [c for c in self.line_candidates if c.get("roi_id") != roi_id] + candidates
```

于是**几何是幂等的、状态不是幂等的**：同一张图连续检测两次，`at`/`geometry` 逐个
相同（实测 hoya 21 条，两次完全一致），但用户确认过的 `status="removed"` 全部退回
`candidate` —— `_geometry_mask(..., statuses={REMOVED})` 随即变空，`grid_line_mask`
不再扣这些像素，取数结果悄悄改了，而界面上只会显示"检测完成"。

这正是"用户唯一的劳动被一次重新检测抹掉"的形态，与 `manual_points`
（`digitize.py` 里手工控制点跨重分列存活）是同一类不变量，只是这里漏了。

## 判据

* 几何完全相同的候选：重检后必须保持原来的 `status`；
* 没被确认过的：重检后仍是 `candidate`（不得凭空变成 `removed`）。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession


def _session_with_crossed_artifacts() -> tuple[StraditizeSession, str]:
    mask = np.zeros((60, 80), dtype=bool)
    mask[20, 5:75] = True  # 横线（Kind A）
    mask[5:55, 40] = True  # 竖线（Kind B）
    mask[5:55, 60] = True  # 第二条竖线，用来验证"没确认的不能变成已确认"

    session = StraditizeSession()
    session.image = Image.fromarray((~mask).astype(np.uint8) * 255)
    session.width, session.height = 80, 60
    session.foreground_mask = mask
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=0, x1=80, y0=0, y1=60)["roi"]
    return session, roi["id"]


def _detect(session: StraditizeSession, roi_id: str) -> list[dict]:
    return session.detect_line_candidates(
        roi_id,
        line_fraction_h=0.7,
        line_fraction_v=0.7,
        line_width_min=1,
        line_width_max=2,
    )["candidates"]


def test_redetection_keeps_confirmed_erasures() -> None:
    session, roi_id = _session_with_crossed_artifacts()
    first = _detect(session, roi_id)
    vertical = next(c for c in first if c["axis"] == "v")
    session.set_line_geometry_status(vertical["id"], "removed", roi_id=roi_id)
    assert session.grid_line_mask[10, vertical["at"]], "前置条件：确认后该列像素应被扣掉"

    second = _detect(session, roi_id)
    same = [
        c
        for c in second
        if c["axis"] == "v" and c["geometry"] == vertical["geometry"]
    ]
    assert same, "重检没检回同一条竖线（几何应当幂等）"
    assert same[0]["status"] == "removed", (
        "重跑检测把用户确认过的擦除退回了 candidate —— "
        "geomtry 完全相同的候选必须保留 status，否则重新检测会静默改掉取数结果"
    )
    # 重检不重算 mask（那是 `_recompose` 的唯一职责），这里显式合成一次，
    # 验证"保留的 status"真的落到了取数用的 mask 上。
    session.apply_line_removal(roi_id=roi_id)
    assert session.grid_line_mask[10, vertical["at"]], (
        "重检 + 重新合成之后 grid_line_mask 不再扣这条竖线：确认状态事实上被作废了"
    )


def test_redetection_does_not_promote_unconfirmed_candidates() -> None:
    """金丝雀：没确认过的候选不得因为重检而变成已删除。"""
    session, roi_id = _session_with_crossed_artifacts()
    _detect(session, roi_id)

    second = _detect(session, roi_id)

    assert second, "重检没有产出候选"
    assert all(c["status"] == "candidate" for c in second), (
        f"重检把未确认的候选标成了已删除："
        f"{[(c['id'], c['status']) for c in second if c['status'] != 'candidate']}"
    )
