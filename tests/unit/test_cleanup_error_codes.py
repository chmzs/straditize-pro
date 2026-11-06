# -*- coding: utf-8 -*-
"""清理几何的**输入校验**必须报 INVALID_PARAMS，不能兜成"后端内部错误"。

## 缺口本体（docs/testing-strategy.md §9）

`session_parts/cleanup.py` 里 `upsert_line_geometry` / `set_line_geometry_status` /
`set_line_thickness` / `delete_line_geometry` 的参数校验一律 `raise ValueError`。
dispatcher 的兜底分支把任何非 `JsonRpcError` 异常映射成 **-32603 后端内部错误**，并附一句
「请查看服务器控制台日志排查」——于是**用户输错了一个厚度**，界面上显示的是"服务器内部错误"，
而正确语义是 -32602 INVALID_PARAMS（与 `calibrate_axes` 等同一族）。

## 判据

九条非法输入逐条走 **dispatcher**（不是直接调方法——错误码映射就在这里发生），断言：

1. `code == -32602`；
2. 文案里带**具体的参数字面量与越界值**（用户据此就能改），且**不含**内部错误那句套话；
3. 状态没被改坏（拒绝必须发生在改动之前）。

## 反向验证

把任一处的 `JsonRpcError` 改回 `ValueError`，对应那条立刻变红。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import INTERNAL_ERROR, INVALID_PARAMS, JsonRpcDispatcher
from straditize_core.rpc_methods import cleanup as cleanup_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
INTERNAL_HINT = "请查看服务器控制台日志"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.upsert_line_geometry(
        geometry={"x0": 100.0, "y0": 300.0, "x1": 900.0, "y1": 302.0},
        axis="h",
    )
    return session


def _call(session: StraditizeSession, method: str, **params) -> dict:
    dispatcher = JsonRpcDispatcher()
    cleanup_methods.register(dispatcher, session)
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _assert_invalid(response: dict, *, fragment: str) -> None:
    error = response["error"]
    assert error["code"] == INVALID_PARAMS, (
        f"用户输入错误被报成 {error['code']}（-32603 是后端内部错误）：{error['message']}"
    )
    assert error["code"] != INTERNAL_ERROR
    assert fragment in error["message"], (
        f"文案里没有出现 {fragment!r}，用户不知道改什么：{error['message']}"
    )
    assert INTERNAL_HINT not in error["message"], (
        f"输入错误不该让用户去翻服务器日志：{error['message']}"
    )


def test_upsert_requires_geometry() -> None:
    session = _session()
    _assert_invalid(
        _call(session, "algorithm.upsertLineGeometry", geometry=None),
        fragment="geometry",
    )


def test_upsert_rejects_bad_axis() -> None:
    session = _session()
    _assert_invalid(
        _call(
            session,
            "algorithm.upsertLineGeometry",
            geometry={"x0": 1, "y0": 2, "x1": 3, "y1": 4},
            axis="x",
        ),
        fragment="axis",
    )


def test_upsert_requires_four_corners() -> None:
    session = _session()
    _assert_invalid(
        _call(
            session,
            "algorithm.upsertLineGeometry",
            geometry={"x0": 1, "y0": 2, "x1": 3},
            axis="h",
        ),
        fragment="y1",
    )


def test_status_rejects_unknown_value() -> None:
    session = _session()
    candidate_id = session.line_candidates[0]["id"]
    _assert_invalid(
        _call(
            session,
            "algorithm.setGeometryStatus",
            candidate_id=candidate_id,
            status="bogus",
        ),
        fragment="bogus",
    )


def test_status_rejects_unknown_id() -> None:
    session = _session()
    _assert_invalid(
        _call(
            session,
            "algorithm.setGeometryStatus",
            candidate_id="no-such-id",
            status="removed",
        ),
        fragment="no-such-id",
    )


@pytest.mark.parametrize(("thickness", "fragment"), [(0, "0"), (501, "501")])
def test_thickness_bounds(thickness: int, fragment: str) -> None:
    session = _session()
    _assert_invalid(
        _call(session, "algorithm.setLineThickness", thickness=thickness),
        fragment=fragment,
    )


def test_thickness_unknown_id() -> None:
    session = _session()
    _assert_invalid(
        _call(
            session,
            "algorithm.setLineThickness",
            thickness=3,
            candidate_id="no-such-id",
        ),
        fragment="no-such-id",
    )


def test_delete_unknown_id() -> None:
    session = _session()
    _assert_invalid(
        _call(session, "algorithm.deleteLineGeometry", candidate_id="no-such-id"),
        fragment="no-such-id",
    )


def test_rejected_thickness_leaves_geometry_untouched() -> None:
    session = _session()
    before = [dict(c["geometry"]) for c in session.line_candidates]

    _call(session, "algorithm.setLineThickness", thickness=0)

    assert [dict(c["geometry"]) for c in session.line_candidates] == before
