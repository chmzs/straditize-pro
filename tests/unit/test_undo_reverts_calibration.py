# -*- coding: utf-8 -*-
"""撤销必须真的能撤回标定（B-06）：记录时机 + 快照独立性。

## 两个根因，缺一不可

1. **先改后记**：`calibrate_column_xticks` 先写 `col["x_ticks"]`、之后才
   `_record_history()`。而 `_record_history` 记录的是**调用那一刻**的状态，
   于是栈顶存的就是"标定后"的值 —— Ctrl+Z 只是把新值再回填一次，用户看到
   状态毫无变化却白耗一格撤销栈。`clear_column_xticks` 同型。
2. **浅拷贝**：`_record_history` 用 `[dict(c) for c in columns]`，只复制第一层。
   `x_ticks` 是 `list[dict]`，快照与实时列**共享同一个对象**：把实时值原地改成
   777.0，栈里所有旧快照跟着变，撤销/重做回填的都是被污染的值。

## P4 的测法很关键（prod-gate 踩过的坑）

整体替换 `col["x_ticks"] = [新 list]` **测不出**共享引用——那条路径不触及原对象。
必须**原地改** `live_ticks[0]["value"] = 777.0`。见
`test_inplace_edit_does_not_leak_into_snapshots`。

## 为什么深拷贝而不是把嵌套字段 tuple 化

`x_ticks`/`x_values`/`control_points` 都可能被别处原地修改，逐个 tuple 化要改遍
所有写入点，漏一个就复发。深拷贝是**机制性**修法：快照天然只读，不依赖谁记得
按规矩写。代价实测（hoya 28 列 + 727 控制点）：浅拷贝 0.02ms → 深拷贝 ~1.04ms/次，
撤销栈上限 500 格，可接受。
"""
from __future__ import annotations

import copy

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _calibrated_session() -> tuple[StraditizeSession, int, int]:
    """hoya 会话：已分列，返回 (session, 首列起点, 首列终点)，尚未标定。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=session.rois[0]["id"])
    first = session.columns[0]
    return session, int(first["start"]), int(first["end"])


def _ticks(band_start: int, band_end: int, top_value: float = 100.0) -> list[dict]:
    return [
        {"px": band_start + 20, "value": 0.0},
        {"px": band_end - 20, "value": top_value},
    ]


class TestUndoReallyRevertsCalibration:
    """P1 / P5：撤销必须真的回到"未标定"，重做必须回到标定值。"""

    def test_first_undo_returns_to_uncalibrated(self) -> None:
        session, band_start, band_end = _calibrated_session()
        assert session.columns[0].get("x_ticks") is None, "前置：尚未标定"

        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")
        assert session.columns[0].get("x_ticks"), "前置：应已标定"

        session.history_undo()

        assert session.columns[0].get("x_ticks") is None, (
            "撤销后标定仍在 —— 撤销栈里存的是标定**之后**的状态（先改后记，B-06）"
        )

    def test_redo_restores_the_calibration(self) -> None:
        session, band_start, band_end = _calibrated_session()
        calibrated = _ticks(band_start, band_end)
        session.calibrate_column_xticks(0, ticks=calibrated, unit="%")

        session.history_undo()
        session.history_redo()

        assert session.columns[0].get("x_ticks") == [
            {"px": tick["px"], "value": tick["value"]} for tick in calibrated
        ], "重做后没有回到标定值"

    def test_undo_redo_undo_round_trip(self) -> None:
        """再撤销一次仍为 None —— 证明中途的快照没被污染。"""
        session, band_start, band_end = _calibrated_session()
        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")

        session.history_undo()
        session.history_redo()
        session.history_undo()

        assert session.columns[0].get("x_ticks") is None

    def test_clear_xticks_can_be_undone(self) -> None:
        session, band_start, band_end = _calibrated_session()
        calibrated = _ticks(band_start, band_end)
        session.calibrate_column_xticks(0, ticks=calibrated, unit="%")

        session.clear_column_xticks(0)
        assert session.columns[0].get("x_ticks") is None

        session.history_undo()

        assert session.columns[0].get("x_ticks") == [
            {"px": tick["px"], "value": tick["value"]} for tick in calibrated
        ], "清除标定之后撤销不回来 —— clear_column_xticks 也是先改后记"

    def test_noop_clear_plants_no_undo_entry(self) -> None:
        """反方向：本来就没标定，清除操作不该压栈（幻影撤销条目）。"""
        session, _band_start, _band_end = _calibrated_session()
        depth_before = len(session.undo_stack)

        session.clear_column_xticks(0)

        assert len(session.undo_stack) == depth_before, "无操作也压栈 = 幻影撤销条目"


class TestSnapshotIndependence:
    """P3 / P4：快照与实时状态必须是两个独立对象。"""

    def test_top_snapshot_does_not_share_x_ticks_object(self) -> None:
        """栈顶快照记的是**标定前**（x_ticks=None），故不能与实时共享对象。

        这条同时是 P1 的机制性版本：修好顺序之后，栈顶快照里根本没有 x_ticks
        可供共享。若哪天有人把顺序改回去，栈顶会重新出现 x_ticks 且与实时同
        一对象，下面两处断言会一起变红。
        """
        session, band_start, band_end = _calibrated_session()
        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")

        live_ticks = session.columns[0]["x_ticks"]
        snapshot_ticks = session.undo_stack[-1]["columns"][0].get("x_ticks")

        assert snapshot_ticks is None, (
            "栈顶快照里还带着 x_ticks —— 那是标定**之后**的值（先改后记，B-06）"
        )
        assert live_ticks is not snapshot_ticks

    def test_inplace_edit_does_not_leak_into_snapshots(self) -> None:
        """快照与实时状态之间**不得存在对象共享**——这条测的是机制，不是历史动作。

        ## 为什么这条必须直接构造共享场景

        我先试过"标定两次 → 原地改实时 → 看栈顶快照变没变"。用**浅拷贝**重跑
        同一测试，它**依然绿**：因为两次标定是两次**整体替换**
        （`col["x_ticks"] = [...]`），栈顶快照持有第一次标定的 list，实时列是
        第二次新建的另一个 list，两者天然不共享。也就是说那条测法在当前产品
        路径下没有判别力，绿了也不说明任何事。

        这里改成直接检验机制本身：`_snapshot_editable_state()` 产出的快照里，
        任何嵌套容器都不得与实时的同一对象。浅拷贝会立刻被这条抓到
        （已验证：把实现换成 `[dict(c)]` 后本测试变红）。
        """
        session, band_start, band_end = _calibrated_session()
        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")
        session.digitize(0, "area")

        live_column = session.columns[0]
        live_ticks = live_column["x_ticks"]
        live_values = live_column.get("x_values")
        live_points = session.control_points[0]

        snapshot = session._snapshot_editable_state()
        snapshot_column = snapshot["columns"][0]

        assert snapshot_column is not live_column
        assert snapshot_column["x_ticks"] is not live_ticks, (
            "快照与实时列共享同一个 x_ticks 对象 —— 浅拷贝，"
            "后续任何原地改写会同时改掉历史"
        )
        if live_values is not None:
            assert snapshot_column.get("x_values") is not live_values, (
                "快照与实时列共享同一个 x_values 对象"
            )
        assert snapshot["control_points"][0] is not live_points, (
            "快照与实时共享同一个控制点 dict"
        )

        # 反向确认：改实时不影响快照
        live_ticks[0]["value"] = 777.0
        assert snapshot_column["x_ticks"][0]["value"] != 777.0, (
            "原地改实时标定后快照跟着变"
        )

    def test_restore_does_not_alias_the_snapshot(self) -> None:
        """撤销回填后，实时列不能与快照共享对象，否则下一步编辑会改掉历史。"""
        session, band_start, band_end = _calibrated_session()
        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")
        session.history_undo()  # 回到未标定
        session.history_redo()  # 回到标定

        restored = session.columns[0]["x_ticks"]
        restored[0]["value"] = 555.0

        for index, snapshot in enumerate(session.undo_stack):
            ticks = snapshot["columns"][0].get("x_ticks") if snapshot["columns"] else None
            if ticks:
                assert ticks[0]["value"] != 555.0, (
                    f"undo_stack[{index}] 的快照被回填后的实时编辑改掉了"
                )

    def test_all_snapshots_are_mutually_independent(self) -> None:
        session, band_start, band_end = _calibrated_session()
        session.calibrate_column_xticks(0, ticks=_ticks(band_start, band_end), unit="%")
        session.calibrate_column_xticks(
            0, ticks=_ticks(band_start, band_end, top_value=40.0), unit="%"
        )
        session.calibrate_column_xticks(
            0, ticks=_ticks(band_start, band_end, top_value=60.0), unit="%"
        )

        seen: list[int] = []
        for snapshot in session.undo_stack:
            if snapshot["columns"]:
                ticks = snapshot["columns"][0].get("x_ticks")
                if ticks:
                    seen.append(id(ticks))
        assert len(seen) == len(set(seen)), (
            "多个快照共享同一个 x_ticks 对象 —— 历史记录之间互相污染"
        )

    def test_control_points_survive_as_independent_copies(self) -> None:
        """控制点也是嵌套 dict，同样必须独立。"""
        session, band_start, band_end = _calibrated_session()
        session.digitize(0, "area")
        assert session.control_points.get(0), "前置：应有控制点"

        snapshot_points = session.undo_stack[-1].get("control_points", {}).get(0)
        live_points = session.control_points[0]
        if snapshot_points:
            assert snapshot_points is not live_points
            first_row = next(iter(live_points))
            live_points[first_row] = 12345.0
            assert snapshot_points.get(first_row) != 12345.0, (
                "原地修改实时控制点后快照跟着变 —— control_points 共享引用"
            )


class TestOrderGuardRespectsValidation:
    """越界报错时不得留下撤销条目（顺序修正要放在校验之后）。"""

    def test_out_of_band_calibration_leaves_no_undo_entry(self) -> None:
        session, band_start, band_end = _calibrated_session()
        depth_before = len(session.undo_stack)

        with pytest.raises(Exception):  # noqa: B017 - JsonRpcError
            session.calibrate_column_xticks(
                0,
                ticks=[
                    {"px": band_start - 500, "value": 0.0},
                    {"px": band_end + 500, "value": 100.0},
                ],
            )

        assert len(session.undo_stack) == depth_before, (
            "越界校验抛错却压了一格撤销栈 —— 用户会得到一次'什么都不做'的历史"
        )


class TestRpcPath:
    """走真实 RPC 入口，确保面板按 Ctrl+Z 时看到的是同一结果。"""

    def test_rpc_isolation_is_complete(self) -> None:
        session, _band_start, _band_end = _calibrated_session()
        dispatcher = create_rpc_dispatcher(session)
        session.digitize(0, "area")

        first = session.columns[0]
        response = dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "column.calibrateXTicks",
                "params": {
                    "col_index": 0,
                    "ticks": _ticks(int(first["start"]), int(first["end"])),
                    "unit": "%",
                },
            }
        )
        assert "result" in response, response
        assert session.columns[0].get("x_ticks")

        undo = dispatcher.handle_object(
            {"jsonrpc": "2.0", "id": 2, "method": "history.undo", "params": {}}
        )
        assert undo["result"]["success"] is True
        assert session.columns[0].get("x_ticks") is None

        redo = dispatcher.handle_object(
            {"jsonrpc": "2.0", "id": 3, "method": "history.redo", "params": {}}
        )
        assert redo["result"]["success"] is True
        assert session.columns[0].get("x_ticks")


class TestSnapshotHelperIsDeep:
    """机制性判据：快照辅助函数必须真的深拷贝，而不只是第一层 dict。"""

    def test_snapshot_helper_deep_copies_nested_values(self) -> None:
        session, _band_start, _band_end = _calibrated_session()
        session.columns[0]["x_ticks"] = [{"px": 1.0, "value": 0.0}, {"px": 2.0, "value": 9.0}]
        session.columns[0]["x_values"] = [0.0, 9.0]

        snapshot = session._snapshot_editable_state()
        assert snapshot["columns"][0] is not session.columns[0]
        assert snapshot["columns"][0]["x_ticks"] is not session.columns[0]["x_ticks"]
        assert snapshot["columns"][0]["x_values"] is not session.columns[0]["x_values"]

    def test_snapshot_helper_is_cheap_enough(self) -> None:
        """性能兜底：500 格栈 × 每次操作一次快照，必须在毫秒级。"""
        import time

        session, _band_start, _band_end = _calibrated_session()
        for index in range(len(session.columns)):
            session.digitize(index, "area")

        started = time.perf_counter()
        for _ in range(20):
            session._snapshot_editable_state()
        per_call_ms = (time.perf_counter() - started) * 1000 / 20

        assert per_call_ms < 10.0, (
            f"快照耗时 {per_call_ms:.1f}ms/次 —— 深拷贝代价过高，"
            "需要改用更细粒度（只深拷贝嵌套字段）"
        )
