# -*- coding: utf-8 -*-
"""采样层位必须可撤销（B-06b / task-12）。

## 缺陷本体（与 B-06 同源，但性质不同）

B-06 是"记录时机错了"（先改后记），本缺陷是"**快照覆盖面不足**"：

1. `_snapshot_editable_state()` 原本只快照 columns / control_points /
   data_xlim / data_ylim / taxa_names，**不含 samples**；
2. `samples_set()` 虽然调了 `_record_history`，但记录时机也在赋值之后。

两层都要补：只补第一层，存进快照的是新值；只补第二层，快照里没有这个键。

Lead 观察到"设 samples 后栈深仍是 1、撤销后 samples 不变"，是因为直接赋值
`s.samples = [...]` 绕过了 `samples_set()`；走真实写入路径（`samples_set` /
`samples_paste_depths`）栈深会加一格，但撤销仍无效——原因是上面第 1 条。

## 判断：samples **应当**参与撤销

层位是用户在步骤 7 显式输入（粘贴深度 / 手工添加 / 自动共识后人工确认），与
columns 同为可编辑实体。粘错一批却撤不回来，用户会以为撤销生效而继续往下走，
比"不支持撤销"更糟。

批量粒度（一次粘贴 158 条只记一格）不构成反对理由：一次粘贴本是**一个用户动作**，
应当一次撤整批，与文本编辑器里"一次 Ctrl+Z 撤掉整段粘贴"同义。

## 判据为什么这样设计

(c) 要求"再 undo 仍为之前状态"——只测一次 undo 会假绿（prod-gate 的教训：
浅拷贝在单次 undo 下也能看起来正确）。这条钉深拷贝。

(d) 是反向哨兵：samples 未变时，撤销其它操作不得影响 samples。
"""
from __future__ import annotations

import copy

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=session.rois[0]["id"])
    return session


def _samples(count: int, *, base_depth: float = 0.0) -> list[dict]:
    return [
        {"row_px": 200 + index, "depth": base_depth + index, "source": "manual"}
        for index in range(count)
    ]


class TestSamplesAreInTheSnapshot:
    """机制性判据：快照里必须有 samples，且与实时状态无对象共享。"""

    def test_snapshot_contains_samples(self) -> None:
        session = _session()
        session.samples = _samples(3)

        snapshot = session._snapshot_editable_state()

        assert "samples" in snapshot, (
            "快照结构里没有 samples —— 撤销栈存不到层位，撤销必然无效"
        )
        assert len(snapshot["samples"]) == 3

    def test_snapshot_samples_are_deep_copied(self) -> None:
        session = _session()
        session.samples = _samples(2)
        live_entry = session.samples[0]

        snapshot = session._snapshot_editable_state()

        assert snapshot["samples"] is not session.samples
        assert snapshot["samples"][0] is not live_entry, (
            "快照与实时共享同一条层位字典 —— 浅拷贝，原地改会污染历史"
        )
        live_entry["depth"] = 999.0
        assert snapshot["samples"][0]["depth"] != 999.0


class TestSamplesUndoRoundTrip:
    """(a)(b)(c)：撤销 → 重做 → 再撤销。"""

    def test_set_then_undo_restores_empty(self) -> None:
        session = _session()
        assert session.samples == [], "前置：初始无层位"

        session.samples_set(_samples(2))
        assert len(session.samples) == 2

        session.history_undo()

        assert session.samples == [], "撤销后层位没被撤回 —— samples 未参与撤销"

    def test_redo_restores_the_pasted_samples(self) -> None:
        session = _session()
        session.samples_set(_samples(2))
        session.history_undo()

        session.history_redo()

        assert len(session.samples) == 2, "重做后没有回到粘贴后的状态"

    def test_second_undo_still_restores_empty(self) -> None:
        """(c) 钉深拷贝：如果快照与实时共享对象，这一步会带回被污染的值。"""
        session = _session()
        session.samples_set(_samples(2))

        session.history_undo()
        session.history_redo()
        session.history_undo()

        assert session.samples == [], (
            "第二次撤销没有回到空状态 —— 快照与实时状态互相污染"
        )

    def test_undo_restores_previous_values_not_empty(self) -> None:
        """从"已有 2 条"再改成"3 条"，撤销应回到那 2 条，而不是清空。"""
        session = _session()
        session.samples_set(_samples(2, base_depth=10.0))
        previous_depths = [entry["depth"] for entry in session.samples]

        session.samples_set(_samples(3, base_depth=50.0))
        session.history_undo()

        assert [entry["depth"] for entry in session.samples] == previous_depths, (
            "撤销回到的是空状态而非发送前的那 2 条 —— 快照粒度错了"
        )

    def test_paste_depths_path_is_undoable_too(self) -> None:
        """另一条写入路径（粘贴真实深度）最终也走 `samples_set`，须同样可撤销。"""
        session = _session()
        session.is_calibrated = True
        session.y_scale = {"slope": 2.0, "intercept": 0.0}

        session.samples_paste_depths([100.0, 200.0])
        assert len(session.samples) == 2

        session.history_undo()

        assert session.samples == [], "粘贴深度这条路径撤销无效"


class TestBulkPasteIsOneUndoStep:
    """批量粘贴是一**个**用户动作，应一次撤整批。"""

    def test_158_samples_undone_in_one_step(self) -> None:
        session = _session()
        depth_before = len(session.undo_stack)

        session.samples_set(_samples(158))
        assert len(session.samples) == 158
        assert len(session.undo_stack) == depth_before + 1, (
            "一次批量粘贴压了多格撤销栈 —— 用户要按很多次 Ctrl+Z 才能撤掉一批"
        )

        session.history_undo()

        assert session.samples == []


class TestReverseSentinel:
    """(d) samples 未变时，撤销其它操作不得影响它。"""

    def test_undoing_a_rename_does_not_touch_samples(self) -> None:
        session = _session()
        session.samples_set(_samples(2))
        depths_before = [entry["depth"] for entry in session.samples]

        dispatcher = create_rpc_dispatcher(session)
        response = dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "naming.renameColumn",
                "params": {"col_index": 0, "name": "RENAMED_FOR_TEST"},
            }
        )
        assert "result" in response, response

        dispatcher.handle_object(
            {"jsonrpc": "2.0", "id": 2, "method": "history.undo", "params": {}}
        )

        assert [entry["depth"] for entry in session.samples] == depths_before, (
            "撤销一次列改名却动了层位 —— 快照恢复把不相关的状态也覆盖了"
        )

    def test_renaming_is_undoable_and_samples_survive(self) -> None:
        """同时钉 renameColumn 的 B-06 修复：改名必须可撤销。"""
        session = _session()
        session.samples_set(_samples(2))
        original_name = session.columns[0]["name"]

        dispatcher = create_rpc_dispatcher(session)
        dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "naming.renameColumn",
                "params": {"col_index": 0, "name": "RENAMED_FOR_TEST"},
            }
        )
        assert session.columns[0]["name"] == "RENAMED_FOR_TEST"

        dispatcher.handle_object(
            {"jsonrpc": "2.0", "id": 2, "method": "history.undo", "params": {}}
        )

        assert session.columns[0]["name"] == original_name, (
            "撤销列改名无效 —— naming.renameColumn 仍是先改后记"
        )
        assert len(session.samples) == 2, "撤销改名时层位被误伤"


class TestSnapshotCost:
    """快照体积：158 条 samples 的开销要实测并交代。"""

    def test_snapshot_with_158_samples_is_still_cheap(self) -> None:
        import time

        session = _session()
        for index in range(len(session.columns)):
            session.digitize(index, "area")
        session.samples = _samples(158)

        started = time.perf_counter()
        for _ in range(20):
            session._snapshot_editable_state()
        per_call_ms = (time.perf_counter() - started) * 1000 / 20

        assert per_call_ms < 10.0, (
            f"含 158 条层位的快照 {per_call_ms:.1f}ms/次 —— 撤销栈 500 格会拖慢操作"
        )


class TestRestoreToleratesLegacySnapshot:
    """兼容：缺 `samples` 键的旧快照不得清空用户层位。"""

    def test_snapshot_without_samples_key_leaves_samples_untouched(self) -> None:
        session = _session()
        session.samples = _samples(2)
        legacy_snapshot = {
            "columns": copy.deepcopy(session.columns),
            "control_points": {},
            "data_xlim": None,
            "data_ylim": None,
            "taxa_names": [],
        }

        session._restore_editable_state(legacy_snapshot)

        assert len(session.samples) == 2, (
            "回填缺 samples 的旧快照时把用户层位清空了 —— 缺键应保持现状"
        )
