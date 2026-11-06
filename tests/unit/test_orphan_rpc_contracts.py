# -*- coding: utf-8 -*-
"""两条"孤儿 RPC"的契约判据：先证明**能调、返回什么**，再谈删不删。

## 为什么先写判据而不是先删

按调用量删接口是伪科学（见 docs/rpc-call-evidence.json 的 11 条孤儿）。正确顺序是：
**先把契约钉住**——能调通、返回形状对、失败码对——然后再判断"没人调"到底是
"没用了"还是"没入口"。两条判据写不出来，才说明连它做什么都说不清。

## 覆盖的两条

| RPC | 是什么 | 之前的状态 |
| --- | --- | --- |
| `algorithm.extractTurningPoints` | 自动提取每列的峰/谷写入控制点（保留手工点） | 有实现、无 UI、无测试、spec 无文档 |
| `core.getShadowLayer` | 放大包络（pale shadow）的显示层，**不得当数据用** | 有实现、无 UI、无测试 |

判据写出来的结论已经写在各用例里——两条都**能调通且行为具体**，所以它们是
"有能力、没入口"，不是死代码。
"""

from __future__ import annotations

import numpy as np

from straditize_core.protocol import STATE_ERROR, JsonRpcDispatcher
from straditize_core.rpc_methods import digitize as digitize_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session(with_image: bool = True) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    if with_image:
        session.load_image(image_path=PLATE)
        session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def _call(session: StraditizeSession, method: str, **params) -> dict:
    dispatcher = JsonRpcDispatcher()
    digitize_methods.register(dispatcher, session)
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def test_extract_turning_points_is_callable_and_writes_control_points() -> None:
    session = _session()
    assert 0 not in session.control_points, "起点不该已有 0 号列控制点"

    response = _call(session, "algorithm.extractTurningPoints", col_index=0)

    assert "error" not in response, response.get("error")
    result = response["result"]
    assert result["success"] is True
    assert result["columns_updated"] == [0]
    assert session.control_points.get(0), (
        "峰谷提取必须真的写进 control_points——否则它对画布毫无影响"
    )


def test_extract_turning_points_preserves_manual_points() -> None:
    session = _session()
    session.column_points.setdefault(0, [])
    session.control_points[0] = {123: 456.0}

    _call(session, "algorithm.extractTurningPoints", col_index=0)

    assert session.control_points[0].get(123) == 456.0, (
        "手工点在自动提取后必须保留——这才是它能作为\"辅助\"被用起来的前提"
    )


def test_get_shadow_layer_requires_an_image() -> None:
    session = _session(with_image=False)

    response = _call(session, "core.getShadowLayer")

    assert response["error"]["code"] == STATE_ERROR


def test_get_shadow_layer_reports_shape_without_shadow() -> None:
    session = _session()
    session._extract_foreground_from_settings()

    response = _call(session, "core.getShadowLayer")

    result = response["result"]
    assert result["available"] is False, "基线图没有放大包络，必须如实说没有"
    assert result["overlay_png"] is None
    assert result["shadow_pixels"] == 0
    assert result["solid_pixels"] >= 0
    assert "extraction_mode" in result
