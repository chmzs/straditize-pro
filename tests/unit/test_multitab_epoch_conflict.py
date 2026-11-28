# -*- coding: utf-8 -*-
"""双标签乐观并发控制与 session_epoch 递增回归测试（#183）。"""

from __future__ import annotations

from straditize_core.protocol import CONFLICT_ERROR, JsonRpcDispatcher
from straditize_core.rpc_methods import register_all
from straditize_core.session import StraditizeSession


def _make_session_and_dispatcher() -> tuple[StraditizeSession, JsonRpcDispatcher]:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=[315, 1946], data_ylim=[511, 1311])
    dispatcher = JsonRpcDispatcher()
    register_all(dispatcher, session)
    return session, dispatcher


def _rpc(dispatcher: JsonRpcDispatcher, method: str, params: dict) -> dict:
    resp = dispatcher.handle_object(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    )
    assert isinstance(resp, dict)
    return resp


def test_stale_tab_write_is_rejected_without_overwriting_newer_edit() -> None:
    """复现 #183：A 改名后 epoch 递增；B 基于旧 epoch 改名必须被 CONFLICT_ERROR 拦截，不得静默覆盖 A。"""
    session, dispatcher = _make_session_and_dispatcher()

    tab_a_epoch = int(_rpc(dispatcher, "straditize.getDiagramData", {})["result"]["session_epoch"])
    tab_b_epoch = int(_rpc(dispatcher, "straditize.getDiagramData", {})["result"]["session_epoch"])
    assert tab_a_epoch == tab_b_epoch

    # A 基于当前 epoch 成功把列 0 改名为 A_NEW
    res_a = _rpc(
        dispatcher,
        "column.update",
        {"col_index": 0, "updates": {"name": "A_NEW"}, "_expected_epoch": tab_a_epoch},
    )
    assert "result" in res_a
    assert session.columns[0]["name"] == "A_NEW"

    new_epoch = int(_rpc(dispatcher, "straditize.getDiagramData", {})["result"]["session_epoch"])
    assert new_epoch == tab_a_epoch + 1

    # B 仍持旧 epoch 尝试覆盖为 B_NEW -> 必须被拒绝
    res_b_stale = _rpc(
        dispatcher,
        "column.update",
        {"col_index": 0, "updates": {"name": "B_NEW"}, "_expected_epoch": tab_b_epoch},
    )
    assert "error" in res_b_stale
    assert res_b_stale["error"]["code"] == CONFLICT_ERROR
    assert res_b_stale["error"]["data"]["kind"] == "epoch_conflict"
    assert res_b_stale["error"]["data"]["current_epoch"] == new_epoch
    assert session.columns[0]["name"] == "A_NEW", "陈旧写请求绝不能静默覆盖 A 的写入"

    # B 同步到最新 epoch 后再次改名 -> 正常成功
    res_b_fresh = _rpc(
        dispatcher,
        "column.update",
        {"col_index": 0, "updates": {"name": "B_NEW"}, "_expected_epoch": new_epoch},
    )
    assert "result" in res_b_fresh
    assert session.columns[0]["name"] == "B_NEW"


def test_legacy_calls_without_expected_epoch_still_succeed_and_bump_epoch() -> None:
    """不传 _expected_epoch 的调用方仍可正常执行，且一样会递增 session_epoch 触发冲突检测。"""
    session, dispatcher = _make_session_and_dispatcher()
    epoch0 = int(getattr(session, "session_epoch", 0))

    res = _rpc(
        dispatcher,
        "roi.update",
        {"roi_id": session.rois[0]["id"], "name": "renamed_by_script"},
    )
    assert "result" in res
    assert int(session.session_epoch) == epoch0 + 1

    stale = _rpc(
        dispatcher,
        "column.update",
        {"col_index": 0, "updates": {"name": "STALE"}, "_expected_epoch": epoch0},
    )
    assert stale["error"]["code"] == CONFLICT_ERROR
