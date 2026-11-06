# -*- coding: utf-8 -*-
"""`algorithm.degrid` 是对外接口：这条判据钉住"它还活着、且不是结构性 0"。

## 为什么单独立一条

S2「去线灵敏度」面板下线后，`algorithm.degrid` 在前端**零调用**（清理几何改走
`applyLineRemoval` + `lineCandidates`）。§9 因此登记过两个判断：

1. 「改它或删它，当前测试**不会红**」——**过时**：`tests/integration/test_rpc.py:1105`
   已经按 RPC 名调它并断言 strength / max_thickness / overlay_png 等返回体；
2. 「`stats.degrid_removed_pixels` 是结构性常量 0」——**也不成立**：该值是
   `(raw_ink & self.degrid_line_mask).sum()`，而掩膜由 `algorithm_degrid` 写入
   （`core.py:2020`）。它在界面上恒 0 只是因为没人调它，不是因为算不出来。

这条判据把第 2 点钉成**可证伪的性质**：经 RPC 调一次 degrid，掩膜必须非空、
`cleanup_stats["degrid_removed_pixels"]` 必须 > 0。把 `core.py` 里那句赋值摘掉
（"反正前端不调"的顺手清理），这条立刻变红。

## 反向验证

临时把 `self.degrid_line_mask = auto` 改成 `= None` → 两条断言同时红。
"""

from __future__ import annotations

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import cleanup as cleanup_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def _dispatch(session: StraditizeSession, method: str, **params) -> dict:
    dispatcher = JsonRpcDispatcher()
    cleanup_methods.register(dispatcher, session)
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def test_degrid_rpc_still_works_and_populates_the_stat() -> None:
    session = _session()

    response = _dispatch(session, "algorithm.degrid", strength="medium")

    result = response["result"]
    assert result["strength"] == "medium"
    assert result["max_thickness"] >= 1
    assert result["overlay_png"].startswith("data:image/png;base64,"), (
        "QC 叠加图是对外接口的返回值之一，前端面板下线不代表它可以不发"
    )
    assert session.degrid_line_mask is not None, (
        "掩膜没写回会话：这正是有人以『前端不调』为由删掉赋值时会发生的事"
    )

    stats = _dispatch(session, "algorithm.applyLineRemoval")["result"]["stats"]

    assert stats["degrid_removed_pixels"] > 0, (
        f"degrid_removed_pixels={stats['degrid_removed_pixels']}：它不是结构性常量 0，"
        "而应反映 degrid 掩膜与墨迹的交集"
    )


def test_degrid_off_clears_the_mask_and_the_stat() -> None:
    session = _session()
    _dispatch(session, "algorithm.degrid", strength="medium")
    assert session.degrid_line_mask is not None

    _dispatch(session, "algorithm.degrid", strength="off")
    assert session.degrid_line_mask is None

    stats = _dispatch(session, "algorithm.applyLineRemoval")["result"]["stats"]
    assert stats["degrid_removed_pixels"] == 0
