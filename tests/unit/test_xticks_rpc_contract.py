"""X-ticks 契约回归门禁（步骤 6）。

背景（e2e 探针实测，见 ``docs/plans/2026-09-29-per-step-usage-audit.md`` §4 第 10、20 条）：
``x_ticks`` 曾是**只写不读**字段——``column.calibrateXTicks`` 写得进去，但
``getDiagramData`` 的列载荷白名单把它剥掉，于是前端 ``hasTicks`` 恒为 false：
面板永远显示「未标定」、标尺叠加层画不出来、``#btn-clear-col-ticks`` 永不渲染。
而 ``#btn-save-manual-ticks`` 更是**一个 RPC 都没发**，标定值只活在浏览器内存里，
任何一次重取（切步骤/重分列/载入）即丢。

这组门禁盯住「存储 → 载荷 → 工程往返」三段，任一段再断就变红。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import JsonRpcDispatcher, JsonRpcError
from straditize_core.rpc_methods import system as system_methods
from straditize_core.rpc_methods import xticks as xticks_methods
from straditize_core.session import StraditizeSession

TICKS = [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 50.0}]


def _session_with_one_column() -> StraditizeSession:
    from PIL import Image

    session = StraditizeSession()
    # 载荷函数在 image is None 时直接返回零态（columns: []），所以要给一张真图；
    # 同时预置 column_points，让载荷跳过 digitize（本组门禁测的是序列化，不是追踪算法）。
    session.image = Image.new("L", (300, 300), 255)
    session.width, session.height = 300, 300
    session.column_points = {0: [{"row": 10, "x": 150.0}]}
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col01",
            "name": "col01",
            "species": "col01",
            "startX": 100.0,
            "endX": 250.0,
            "start": 100.0,
            "end": 250.0,
            "roi_id": "roi_1",
        }
    ]
    session.taxa_names = ["col01"]
    session.control_points = {0: {}}
    return session


def _dispatcher(session: StraditizeSession) -> JsonRpcDispatcher:
    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    xticks_methods.register(dispatcher, session)
    return dispatcher


def _column_payload(dispatcher: JsonRpcDispatcher) -> dict:
    return dispatcher._methods["straditize.getDiagramData"]()["columns"][0]


def test_diagram_payload_carries_x_ticks_after_calibration() -> None:
    """存储 → 载荷：标定后必须读得回来（载荷剥字段是本缺陷的第二个断点）。"""
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)

    # 未标定 = 显式的 null，而不是「字段不存在」。前端靠 null 判定未标定。
    before = _column_payload(dispatcher)
    assert "x_ticks" in before, "getDiagramData 的列载荷丢掉了 x_ticks 字段"
    assert before["x_ticks"] is None

    dispatcher._methods["column.calibrateXTicks"](col_index=0, ticks=TICKS, unit="%")

    after = _column_payload(dispatcher)
    assert after["x_ticks"] == TICKS, (
        "标定成功但 getDiagramData 里读不回来 —— 前端 hasTicks 会恒为 false"
    )


def test_clear_xticks_is_registered_and_removes_calibration() -> None:
    """清空链路：``column.clearXTicks`` 必须真的存在（此前后端根本没有这个方法）。"""
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)
    dispatcher._methods["column.calibrateXTicks"](col_index=0, ticks=TICKS)

    res = dispatcher._methods["column.clearXTicks"](col_index=0)

    assert res == {"col_index": 0, "x_ticks": None, "cleared": True}
    assert "x_ticks" not in session.columns[0]
    assert _column_payload(dispatcher)["x_ticks"] is None


def test_clear_xticks_out_of_range_column_raises_state_error() -> None:
    """越界列索引给干净的 -32001，而不是 -32603 内部错误。"""
    dispatcher = _dispatcher(_session_with_one_column())

    with pytest.raises(JsonRpcError) as exc_info:
        dispatcher._methods["column.clearXTicks"](col_index=9)

    assert exc_info.value.code == -32001


def test_clear_xticks_on_uncalibrated_column_plants_no_undo_entry() -> None:
    """对未标定列点【清空】不该产生撤销条目（幻影撤销）。"""
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)
    depth = len(session.undo_stack)

    res = dispatcher._methods["column.clearXTicks"](col_index=0)

    assert res["cleared"] is False
    assert len(session.undo_stack) == depth, "无操作也压栈 = 幻影撤销条目"


def test_project_json_round_trips_x_ticks() -> None:
    """工程往返：存盘 → 载入后标定必须还在（此前 project_save 白名单没有它）。"""
    session = _session_with_one_column()
    session.calibrate_column_xticks(0, TICKS)

    saved = session.project_save(format="json")["data"]
    assert saved["columns"][0]["x_ticks"] == TICKS, "工程包序列化丢掉了 x_ticks"

    restored = StraditizeSession()
    restored.project_load(saved)
    assert restored.columns[0]["x_ticks"] == TICKS, "工程载入丢掉了 x_ticks"


def test_project_load_without_x_ticks_stays_uncalibrated() -> None:
    """旧工程包（只有 legacy 三件套）载入后仍为未标定，绝不反推一个假标度。"""
    legacy_only = {
        "columns": [
            {
                "id": "col_0",
                "name": "col01",
                "species": "col01",
                "startX": 100.0,
                "endX": 250.0,
                "startValue": 0.0,
                "tickValue": 100.0,
                "tickEndX": 250.0,
            }
        ]
    }
    session = StraditizeSession()
    session.project_load(legacy_only)

    assert session.columns[0].get("x_ticks") is None


def test_payload_carries_col_index_for_addressing() -> None:
    """前端要用后端自己的列序号寻址，所以载荷必须给出 col_index。"""
    dispatcher = _dispatcher(_session_with_one_column())

    assert _column_payload(dispatcher)["col_index"] == 0


def test_column_id_and_numeric_index_are_interchangeable() -> None:
    """两种寻址等价：按列 id 标定和按序号标定必须落到同一列。"""
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)

    res = dispatcher._methods["column.calibrateXTicks"](
        col_index="roi_1_col01", ticks=TICKS
    )
    assert res["col_index"] == 0
    assert session.columns[0]["x_ticks"] == TICKS

    cleared = dispatcher._methods["column.clearXTicks"](col_index="roi_1_col01")
    assert cleared == {"col_index": 0, "x_ticks": None, "cleared": True}


def test_unknown_column_id_is_a_param_error_not_a_crash() -> None:
    """未知列 id 给干净的 -32602，而不是被 dispatcher 兜成 -32603 内部错误。"""
    dispatcher = _dispatcher(_session_with_one_column())

    with pytest.raises(JsonRpcError) as exc_info:
        dispatcher._methods["column.calibrateXTicks"](
            col_index="roi_9_col99", ticks=TICKS
        )

    assert exc_info.value.code == -32602


def test_calibrating_keeps_untouched_scale_fields() -> None:
    """标定只写「刻度」，不得顺手把该列其它标度字段重置成默认值。

    步骤 6 实测回归：面板只发 ``col_index/ticks/unit``，而
    ``calibrate_column_xticks`` 的 ``plot_type/scale_type/exaggeration_mult``
    形参默认值会**无条件覆盖**既有值 —— 于是用户先在左栏设好的
    plot_type（area/bar）、scale_type（linear/log）、放大倍数，
    只要点一次【保存】就被静默清掉。未传 = 保持原值，不是 = 恢复默认。
    """
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)
    col = session.columns[0]
    col["unit"] = "粒"
    col["plot_type"] = "bar"
    col["scale_type"] = "log"
    col["exaggeration_mult"] = 5.0
    col["mult_source"] = "user"

    dispatcher._methods["column.calibrateXTicks"](col_index=0, ticks=TICKS)

    assert col["x_ticks"] == TICKS
    assert col["unit"] == "粒", "标定把用户设定的单位重置了"
    assert col["plot_type"] == "bar", "标定把用户的 plot_type 重置成默认 area 了"
    assert col["scale_type"] == "log", "标定把用户的 scale_type 重置成默认 linear 了"
    assert col["exaggeration_mult"] == 5.0, "标定把用户的放大倍数清空了"
    assert col["mult_source"] == "user", "标定把放大倍数来源标记清空了"


def test_calibrating_writes_explicitly_passed_scale_fields() -> None:
    """显式传参仍须生效——「未传保持」不能退化成「永不写入」。"""
    session = _session_with_one_column()
    dispatcher = _dispatcher(session)

    dispatcher._methods["column.calibrateXTicks"](
        col_index=0,
        ticks=TICKS,
        unit="粒",
        plot_type="bar",
        scale_type="log",
        exaggeration_mult=5.0,
    )

    col = session.columns[0]
    assert col["unit"] == "粒"
    assert col["plot_type"] == "bar"
    assert col["scale_type"] == "log"
    assert col["exaggeration_mult"] == 5.0
    assert col["mult_source"] == "user"
