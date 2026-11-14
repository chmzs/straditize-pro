# -*- coding: utf-8 -*-
"""步骤 4 的清理编辑必须进撤销栈，且**一次用户动作 = 一格**。

## 缺陷本体

`_snapshot_editable_state()` 只快照 columns / control_points / data_xlim /
data_ylim / taxa_names / samples，**不含** `line_candidates` /
`exclusion_regions` / `line_strokes`；`cleanup.py` 的六个入口一次都不调
`_record_history`。两层同时缺，结果是 Ctrl+Z 对步骤 4 完全无效：

* 栈里根本没有格子（没有 `_record_history`）；
* 就算补上记录，快照里也没有那三个键，撤销后候选原样不动。

用户误确认一条干扰线（= 把这一列的部分墨迹从取数里永久扣掉）后只能"清空全部
重来"——而"清空全部"本身也不可撤销。

## 为什么"一次动作一格"

与 `test_samples_undo.py` 同一口径：一次粘贴 158 条层位记一格，因为它是一个用户
动作。步骤 4 同理——"确认 20 条干扰线"是用户点一次全选再点一次确认，等于一格；
"添加一个排除区"一格；"重跑检测"一格。若为每个元素各记一格，撤销 20 次才能退回
一次操作，用户会以为自己点错了。

## 判据设计要点（避免假绿）

* 撤销后必须**重新按 id 查找**：`_restore_editable_state` 会 deepcopy，测试里
  持有的旧对象引用会变成孤儿，直接断言旧对象等于自证。
* 除 `status` 之外还断言 `grid_line_mask` 的那一位被恢复：状态字段对了但掩膜
  没重建，等于"列表上写着未确认，取数照样把墨迹扣掉"——这是本项目最典型的
  静默错（见 `test_digitize_refuses_erased_column.py`）。
* 负向判据 ①（只读接口不产生历史）与 ②（连做两次动作、撤销一次只回退一格）
  各自独立成条：只验"撤销有效"无法区分"每次操作记了 N 格"这种实现。
"""

from __future__ import annotations

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------


def _session() -> tuple[StraditizeSession, str]:
    """真实图片 + 真实 ROI + 真实分列：与步骤 4 的真实前置状态一致。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    roi_id = session.rois[0]["id"]
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=roi_id)
    assert session.columns, "前置：hoya 应切出列"
    return session, roi_id


def _by_id(session: StraditizeSession, candidate_id: str) -> dict:
    matches = [c for c in session.line_candidates if str(c.get("id")) == candidate_id]
    assert len(matches) == 1, f"候选 {candidate_id} 应唯一存在，实测 {len(matches)} 条"
    return matches[0]


def _pixel_of(candidate: dict) -> tuple[int, int]:
    """候选矩形中心的一个像素（行, 列）。"""
    geom = candidate["geometry"]
    return (
        (int(geom["y0"]) + int(geom["y1"])) // 2,
        (int(geom["x0"]) + int(geom["x1"])) // 2,
    )


def _mask_at(session: StraditizeSession, row: int, col: int) -> bool:
    """`grid_line_mask` 在 (row, col) 处是否为真；掩膜还没合成过时视为未剔除。"""
    mask = getattr(session, "grid_line_mask", None)
    if mask is None:
        return False
    return bool(mask[row, col])


def _inked_candidate(session: StraditizeSession, roi_id: str) -> dict:
    """取一条中心像素真有墨迹的候选（掩膜判据需要它）。

    不挑轴向：hoya 上列轴已被 `_is_column_axis` 抑制，现存的自动候选是横向区带
    线（实测 3 条，y=818/1128/1306）。
    """
    candidates = session.detect_line_candidates(roi_id)["candidates"]
    assert candidates, "前置：hoya 应检出干扰线候选"
    ink = session.foreground_mask
    for cand in candidates:
        row, col = _pixel_of(cand)
        if 0 <= row < ink.shape[0] and 0 <= col < ink.shape[1] and ink[row, col]:
            return cand
    pytest.fail("前置：未找到中心有墨迹的候选，检测口径变了，先核对再改判据")


# ----------------------------------------------------------------------
# 红行：确认一条干扰线 → 撤销 → 回到确认之前
# ----------------------------------------------------------------------


def test_undo_restores_a_confirmed_line_and_its_mask() -> None:
    """确认删除一条干扰线后撤销，候选状态与掩膜都必须回到确认之前。

    修前必红：栈深度不变的断言在第二段就先炸——`set_line_geometry_status`
    一次都不调 `_record_history`。
    """
    session, roi_id = _session()
    target = _inked_candidate(session, roi_id)
    candidate_id = str(target["id"])
    row, col = _pixel_of(target)
    ink = session.foreground_mask
    assert ink[row, col], "前置：候选中心必须有墨迹，否则掩膜判据无判别力"
    assert not _mask_at(session, row, col), "前置：确认之前这条线不该被剔除"
    depth_before = len(session.undo_stack)

    session.set_line_geometry_status(candidate_id, "removed", roi_id=roi_id)

    assert len(session.undo_stack) == depth_before + 1, (
        f"确认一条干扰线必须只记一格历史：栈深 {depth_before} → "
        f"{len(session.undo_stack)}"
    )
    confirmed = _by_id(session, candidate_id)
    assert confirmed["status"] == "removed"
    assert _mask_at(session, row, col), "前置：确认后该像素应被剔除"

    result = session.history_undo()

    assert result.get("success") is True
    restored = _by_id(session, candidate_id)
    assert restored["status"] == "candidate", (
        "撤销后这条线必须回到待确认。修前实测仍是 'removed'："
        "快照里没有 line_candidates，撤销把 columns 回填了，清理状态原样不动。"
    )
    assert not _mask_at(session, row, col), (
        "撤销后掩膜必须同步重建：状态回到 candidate 但 grid_line_mask 仍扣着这块"
        "墨迹，等于界面上写着'未确认'、取数却照样把像素去掉"
    )


# ----------------------------------------------------------------------
# 三个入口都要各记一格（含批量确认）
# ----------------------------------------------------------------------


def test_each_cleanup_entry_records_exactly_one_snapshot() -> None:
    """六个入口每个都只记一格，且都能被撤销回到改前。"""
    session, roi_id = _session()
    assert session.detect_line_candidates(roi_id)["candidates"]

    depth = len(session.undo_stack)
    # 1. 重跑检测：一次动作一格
    session.detect_line_candidates(roi_id)
    assert len(session.undo_stack) == depth + 1, "重跑检测应记一格"
    depth = len(session.undo_stack)

    # 重跑会给候选重新铸 id，后续步骤必须用新 id
    ids = [str(c["id"]) for c in session.line_candidates]
    assert len(ids) >= 3, "前置：重跑后应仍有至少 3 条候选"

    # 2. 批量确认：一次动作一格（不是每条一格）
    session.apply_line_removal(roi_id=roi_id, selected_ids=ids[:2])
    assert len(session.undo_stack) == depth + 1, (
        f"批量确认 2 条只应记一格，实测栈深 {depth} → {len(session.undo_stack)}"
    )
    depth = len(session.undo_stack)

    # 3. 单条状态切换
    session.set_line_geometry_status(ids[0], "candidate", roi_id=roi_id)
    assert len(session.undo_stack) == depth + 1, "单条状态切换应记一格"
    depth = len(session.undo_stack)

    # 4. 手工绘制一条
    session.upsert_line_geometry(
        roi_id=roi_id, geometry={"x0": 400, "y0": 600, "x1": 402, "y1": 900}, axis="v"
    )
    assert len(session.undo_stack) == depth + 1, "手工添加几何应记一格"
    depth = len(session.undo_stack)

    # 5. 删除一条
    session.delete_line_geometry(ids[-1], roi_id=roi_id)
    assert len(session.undo_stack) == depth + 1, "删除几何应记一格"
    depth = len(session.undo_stack)

    # 6. 清空本 ROI 的编辑
    session.clear_cleanup_edits(roi_id=roi_id)
    assert len(session.undo_stack) == depth + 1, "清空清理编辑应记一格"


def test_delete_geometry_is_undoable() -> None:
    """删掉一条候选后撤销，它必须带着**同一个 id** 回来。"""
    session, roi_id = _session()
    candidate_id = str(_inked_candidate(session, roi_id)["id"])

    session.delete_line_geometry(candidate_id, roi_id=roi_id)
    assert all(str(c.get("id")) != candidate_id for c in session.line_candidates)

    session.history_undo()

    restored = _by_id(session, candidate_id)
    assert restored["status"] == "candidate"


def test_clear_cleanup_edits_is_undoable() -> None:
    """清空全部是本步唯一的"重来"手段，它自己必须能撤回。"""
    session, roi_id = _session()
    target = _inked_candidate(session, roi_id)
    candidate_id = str(target["id"])
    before_count = len(session.line_candidates)

    session.clear_cleanup_edits(roi_id=roi_id)
    assert session.line_candidates == []

    session.history_undo()

    assert len(session.line_candidates) == before_count
    _by_id(session, candidate_id)


# ----------------------------------------------------------------------
# 负向判据 ①：只读接口不得产生历史
# ----------------------------------------------------------------------


def test_read_only_calls_push_no_history() -> None:
    """`straditize.getDiagramData` 与 `algorithm.measureRuler` 只读，必不记历史。"""
    session, roi_id = _session()
    session.detect_line_candidates(roi_id)
    dispatcher = create_rpc_dispatcher(session)
    depth = len(session.undo_stack)
    redo_depth = len(session.redo_stack)

    dispatcher._methods["straditize.getDiagramData"]()
    dispatcher._methods["algorithm.measureRuler"](roi_id=roi_id)

    assert len(session.undo_stack) == depth, (
        f"只读接口写了撤销栈：{depth} → {len(session.undo_stack)}"
    )
    assert len(session.redo_stack) == redo_depth
    assert [c.get("status") for c in session.line_candidates] == [
        "candidate" for _ in session.line_candidates
    ]


# ----------------------------------------------------------------------
# 负向判据 ②：撤销一次只回退一格
# ----------------------------------------------------------------------


def test_one_undo_reverts_only_the_last_action() -> None:
    """连做两次动作，撤销一次后第一次动作的结果必须还在。"""
    session, roi_id = _session()
    candidates = session.detect_line_candidates(roi_id)["candidates"]
    assert len(candidates) >= 2, "前置：需要至少 2 条候选"
    first_id, second_id = str(candidates[0]["id"]), str(candidates[1]["id"])

    session.set_line_geometry_status(first_id, "removed", roi_id=roi_id)
    session.set_line_geometry_status(second_id, "removed", roi_id=roi_id)
    assert _by_id(session, first_id)["status"] == "removed"
    assert _by_id(session, second_id)["status"] == "removed"

    session.history_undo()

    assert _by_id(session, second_id)["status"] == "candidate", (
        "撤销一次应回退最后一个动作（第二条的确认）"
    )
    assert _by_id(session, first_id)["status"] == "removed", (
        "第一个动作的结果被一起回退了 —— 一次动作记了多格，或撤销回退了多格"
    )


# ----------------------------------------------------------------------
# 负向判据 ③：恢复后的候选 id 与原来逐个相同，且不撞号
# ----------------------------------------------------------------------


def test_restored_candidate_ids_are_identical_and_do_not_collide() -> None:
    """深拷贝恢复必须保持 id 不变；之后的 reseed 也不得复用旧 id。"""
    session, roi_id = _session()
    session.detect_line_candidates(roi_id)
    ids_before = [str(c["id"]) for c in session.line_candidates]
    assert ids_before, "前置：应有候选"

    session.apply_line_removal(roi_id=roi_id, selected_ids=ids_before)
    session.history_undo()

    ids_after = [str(c["id"]) for c in session.line_candidates]
    assert ids_after == ids_before, (
        f"撤销后候选 id 必须逐个相同：{ids_before} ≠ {ids_after}。"
        "id 一旦被重建，前端选中的几何、确认状态都指向不存在的对象"
    )

    # 撤销之后继续动作：新铸的 id 不得与恢复出来的 id 相同（`_candidate_seq`
    # 不随快照回退，正是为了这一条）。
    session.upsert_line_geometry(
        roi_id=roi_id, geometry={"x0": 500, "y0": 700, "x1": 502, "y1": 1000}, axis="v"
    )
    ids_now = [str(c["id"]) for c in session.line_candidates]
    assert len(ids_now) == len(set(ids_now)), f"id 撞号：{ids_now}"
