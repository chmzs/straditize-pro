"""issue #13：`roi.update` 的半截坐标参数不许静默忽略。

## 现状（本轮实测，与 issue 原文有出入，先纠正）

- **成对给已经生效**：`roi_update(y0=511, y1=1300)` 会把 `ylim` 改成 `[511, 1300]`；
  `roi_update(x0=315, x1=1946)` 同理。issue 描述的「纵向被忽略」在 v2.0.4 上成立，
  当前 `roi_update`（`roi.py:242-257`）两条路径都在。
- **只给一半仍静默**：`roi_update(y0=511)` 返回 `success: True`，`ylim` 原地不动；
  `x0` 同理。这才是还剩下的缺陷，与 issue 的「接口形状不一致 + 静默忽略」同源。

## 判据

1. 只给 `y0`（或只给 `x0`）→ `-32602`，消息点名要成对给或改用 `ylim`/`xlim`；
2. 拒绝之后 ROI 坐标**一字未变**（不许"报错但仍改了一半"）；
3. 负向对照：成对给 `x0/x1`、`y0/y1`，以及列表形式 `xlim/ylim` 的行为不变。

反向验证：把新增的守卫删掉 → 判据 1 变红（重新变回静默）。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession


@pytest.fixture()
def roi_id() -> str:
    session = StraditizeSession()
    session.width, session.height = 2200, 1500
    created = session.roi_create(name="pollen", x0=100, x1=2000, y0=100, y1=1400)
    roi = created.get("roi") or {}
    return str(roi.get("id") or created.get("id"))


def _fresh_roi():
    session = StraditizeSession()
    session.width, session.height = 2200, 1500
    created = session.roi_create(name="pollen", x0=100, x1=2000, y0=100, y1=1400)
    rid = str((created.get("roi") or {}).get("id") or created.get("id"))
    return session, rid


@pytest.mark.parametrize(
    "kwargs, label",
    [
        ({"y0": 511}, "y0"),
        ({"y1": 1300}, "y1"),
        ({"x0": 315}, "x0"),
        ({"x1": 1946}, "x1"),
    ],
)
def test_partial_pair_is_rejected_and_changes_nothing(kwargs: dict, label: str) -> None:
    session, rid = _fresh_roi()
    before = dict(session._get_roi(rid))

    with pytest.raises(JsonRpcError) as excinfo:
        session.roi_update(roi_id=rid, **kwargs)

    message = str(excinfo.value)
    assert "-32602" in message or "成对" in message, message
    assert "成对" in message, f"只给 {label} 必须说明要成对给：{message}"
    after = session._get_roi(rid)
    assert after["xlim"] == before["xlim"], "报错之后不许把坐标改了一半"
    assert after["ylim"] == before["ylim"], "报错之后不许把坐标改了一半"


def test_full_pairs_still_apply() -> None:
    session, rid = _fresh_roi()

    session.roi_update(roi_id=rid, y0=511, y1=1300)
    assert session._get_roi(rid)["ylim"] == [511.0, 1300.0]

    session.roi_update(roi_id=rid, x0=315, x1=1946)
    assert session._get_roi(rid)["xlim"] == [315.0, 1946.0]


def test_list_form_is_unchanged() -> None:
    session, rid = _fresh_roi()

    session.roi_update(roi_id=rid, xlim=[315.0, 1946.0], ylim=[511.0, 1300.0])

    roi = session._get_roi(rid)
    assert roi["xlim"] == [315.0, 1946.0]
    assert roi["ylim"] == [511.0, 1300.0]
