"""`straditize.getDiagramData` 对 ROI 主/活动标识必须**两种拼写都给且相等**。

缺陷背景：同一概念在载荷里曾只有 camel（`primaryRoiId` / `activeRoiId`），而
`roi.list` 返回的是 snake（`primary_roi_id`）。外部读者各读一种，读到不存在的那个
就得到 `undefined`，于是把"没变"当成缺陷——本轮已因此产生两次假警报：
一次是前端 e2e（我写的），一次是独立黑盒核验（explorer 报"设为主未生效"）。

权威拼写仍是 camel；snake 为兼容别名。两者必须同步，见
`docs/JSON_RPC_SPECIFICATION.md` §4B。
"""

from __future__ import annotations

from pathlib import Path

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession


def _payload(session: StraditizeSession) -> dict:
    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    return dispatcher._methods["straditize.getDiagramData"]()


def test_zero_state_emits_both_spellings_as_none() -> None:
    session = StraditizeSession()
    session._init_cleanup()
    payload = _payload(session)

    for camel, snake in (("primaryRoiId", "primary_roi_id"), ("activeRoiId", "active_roi_id")):
        assert camel in payload, f"缺少 {camel}"
        assert snake in payload, f"缺少兼容别名 {snake}"
        assert payload[camel] is None and payload[snake] is None


_IMAGE = Path(__file__).resolve().parents[2] / "straditize_core" / "assets" / "tutorials" / "hoya-del-castillo.png"


def test_primary_and_active_reflected_in_both_spellings() -> None:
    # 有图才会走"实时载荷"分支（无图时 get_diagram_data 直接返回零状态结构）
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(_IMAGE))
    session.primary_roi_id = "roi_9"
    session.active_roi_id = "roi_9"

    payload = _payload(session)

    assert payload["primaryRoiId"] == payload["primary_roi_id"] == "roi_9"
    assert payload["activeRoiId"] == payload["active_roi_id"] == "roi_9"
    # 值是同一个来源，不允许两个键各自演化成不同值
    assert payload["primaryRoiId"] == payload["primary_roi_id"]
    assert payload["activeRoiId"] == payload["active_roi_id"]
