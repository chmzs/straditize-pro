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

import pathlib

import numpy as np

from straditize_core.protocol import INVALID_PARAMS, STATE_ERROR, JsonRpcDispatcher
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
        '手工点在自动提取后必须保留——这才是它能作为"辅助"被用起来的前提'
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


def test_spec_documents_every_result_key_of_get_shadow_layer() -> None:
    """文档与实现不许各说各话：返回体每个键都必须在 spec §4.2b 里出现。

    这条替代不了形状判据，但能挡住两种漂移：实现加了键却不写文档（外部调用方读不到说明），
    以及文档里的键名与实现不符（`shadow_pixels` vs `shadowPixels` 这种）。
    """
    spec = pathlib.Path("docs/JSON_RPC_SPECIFICATION.md").read_text(encoding="utf-8")
    start = spec.index("### 4.2b")
    end = spec.index("### 4.3", start)
    section = spec[start:end]

    session = _session()
    session._extract_foreground_from_settings()
    result = _call(session, "core.getShadowLayer")["result"]

    undocumented = [key for key in result if f"`{key}`" not in section]
    assert undocumented == [], f"这些返回键没写进 spec §4.2b：{undocumented}"

def _call_system(session: StraditizeSession, method: str, **params) -> dict:
    dispatcher = JsonRpcDispatcher()
    from straditize_core.rpc_methods import agedepth as agedepth_methods
    from straditize_core.rpc_methods import system as system_methods

    system_methods.register(dispatcher, session)
    agedepth_methods.register(dispatcher, session)
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def test_core_reset_wipes_state_and_leaves_the_session_usable() -> None:
    """@@core.reset@@ 是「整个会话重置」，不是「新项目」。

    它与 @@project.new@@ 的差别：后者逐字段清项目状态（保留图像与清理几何的选择），
    前者直接把 @@__init__@@ 再跑一遍——连 image / metadata / age_depth_model 一起回到出厂。
    两者都不碰 @@session.server@@（由 rpc_server 外部挂载），所以重置后同一个会话还能继续用。
    """
    session = _session()
    assert session.columns, "前提：基线必须有列，否则这条判据测不到清空"
    session.paper_metadata["publication"]["title"] = "测试标题"

    response = _call_system(session, "core.reset")

    assert response["result"] == {"reset": True}
    assert session.columns == []
    assert session.image is None
    assert session.paper_metadata["publication"]["title"] == "", (
        "出厂重置必须连元数据一起清掉，否则上一篇文章的 DOI 会跟着新项目导出"
    )

    # 会话仍然可用：能重新载图并继续工作
    session.load_image(image_path=PLATE)
    assert session.image is not None
    assert session.width > 0


def test_ensemble_add_then_list_roundtrip() -> None:
    """@@ensemble.add@@ 是对外导入入口：add 之后 @@ensemble.list@@ 必须能看到，同名覆盖不重复。"""
    session = _session()
    table = [[0.0, 1.0], [10.0, 2.0]]

    added = _call_system(
        session, "ensemble.add", name="bacon_run", columns=["depth", "age"], data=table
    )["result"]

    assert added["success"] is True
    assert added["tables"] == ["bacon_run"]

    listed = _call_system(session, "ensemble.list")["result"]
    assert listed["count"] == 1
    assert listed["tables"][0]["name"] == "bacon_run"

    # 同名再导入 → 覆盖而不是追加（否则导出里会出现两张同名表）
    _call_system(
        session, "ensemble.add", name="bacon_run", columns=["depth", "age"], data=table
    )
    listed_again = _call_system(session, "ensemble.list")["result"]
    assert listed_again["count"] == 1

def _call_component_and_agedepth(session: StraditizeSession, method: str, **params) -> dict:
    dispatcher = JsonRpcDispatcher()
    from straditize_core.rpc_methods import agedepth as agedepth_methods
    from straditize_core.rpc_methods import components as component_methods

    agedepth_methods.register(dispatcher, session)
    component_methods.register(dispatcher, session)
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


DATES = [
    {"id": "1", "age": 1000.0, "error": 50.0, "depth": 10.0, "thickness": 1.0},
    {"id": "2", "age": 2000.0, "error": 60.0, "depth": 40.0, "thickness": 1.0},
]


def test_generate_bacon_script_returns_a_runnable_script() -> None:
    """generateBaconScript 是对外面：给用户一份能在 R 里跑的 rbacon 脚本。"""
    session = _session()

    result = _call_component_and_agedepth(
        session, "agedepth.generateBaconScript", dates=DATES, core_name="TESTCORE"
    )["result"]

    assert isinstance(result, str) and "Bacon(" in result
    assert "rbacon" in result, "脚本必须自己 load rbacon，否则拿到手跑不起来"
    assert "TESTCORE" in result, "岩芯名必须进脚本——多岩芯时靠它区分输出"


def test_generate_bacon_script_rejects_empty_dates() -> None:
    """没有测年就生成 Bacon 脚本 = 产出「纯先验年龄模型」，属于会误导人的产物；

    与占位 CSV 同一条不变量：取不到数据就报错，不返回一个看起来能跑的东西。
    """
    session = _session()

    response = _call_component_and_agedepth(session, "agedepth.generateBaconScript", dates=[])

    assert response["error"]["code"] == INVALID_PARAMS, (
        "空测年必须被拒，否则用户会拿到一个没有任何测年约束的年龄模型"
    )


def test_generate_geochronr_script_returns_a_runnable_script() -> None:
    """generateGeoChronRScript 给的是读 LiPD 容器再跑 runBacon 的下游脚本。"""
    session = _session()

    result = _call_component_and_agedepth(
        session, "agedepth.generateGeoChronRScript", lipd_file_name="core.lpd"
    )["result"]

    assert "geoChronR" in result
    assert "runBacon" in result
    assert "core.lpd" in result, "脚本必须指向调用方给的那个 LiPD 文件"


def test_component_uninstall_rejects_path_traversal() -> None:
    """component.uninstall 会把 base_dir/name 整个 rmtree —— 所以 name 必须校验。

    RPC 面把 name 原样透传给 shutil.rmtree：一个 ../.. 就能删到组件目录之外。
    这条在**动磁盘之前**就该拒绝。
    """
    session = _session()

    for evil in ("../evil", "..", "a/b", "age-modeling/../../x", ""):
        response = _call_component_and_agedepth(session, "component.uninstall", name=evil)
        assert response["error"]["code"] == INVALID_PARAMS, (
            f"name={evil!r} 必须被拒；现在会走到 rmtree"
        )


def test_component_uninstall_is_idempotent_for_a_valid_name() -> None:
    """合法但不存在时返回 removed=False（幂等），不得报错——卸载入口允许被重复点。"""
    session = _session()

    result = _call_component_and_agedepth(session, "component.uninstall", name="definitely-absent")[
        "result"
    ]

    assert result["success"] is True
    assert result["removed"] is False


