# -*- coding: utf-8 -*-
"""ROI id 唯一性：载入工程包后新建 ROI 不得与既有 ROI 撞 id。

## 缺陷（2026-11-10 上机实测，Edge）

载入用户工程包（内含 `roi_1 / pollen`）后点「+ 新建 ROI」：

```
rois = [{id:"roi_1", name:"pollen", xlim:[258,1803], ylim:[403,1649]},
        {id:"roi_1", name:"roi_1",  xlim:[0,0],       ylim:[0,0]}]
```

两个 ROI 同 id 的后果不止是"看着别扭"：

* 界面两张卡片都显示「主区」；空 ROI 也声称「(4列)」——它按 `col.roi_id === r.id`
  数出来的，而那 4 列的归属无法判定；
* `roi_remove` 的级联按 `roi_id` 匹配列（`roi.py:281-291`），删任一个都会把
  **另一方的列一起删掉**（用户手工数字化成果）；
* `_reindex_columns` 随后按 col_index 重排点存储，被误删列的 `column_points` /
  `control_points` 一并消失。

## 根因

`roi_create` 用 `roi_id = f"roi_{self._roi_counter}"`（`roi.py:82`），而
`_roi_counter` 只在 `_init_rois` 里置 0（`roi.py:29`）；`project_load` 直接替换
`self.rois` 却不恢复计数器 ⇒ 载入含 `roi_1` 的包后计数器仍是 0，下一次创建
`counter=1` ⇒ 又生成 `roi_1`。名字唯一性检查拦不住：既有 ROI 的名字是 `pollen`。

## 钉的判据

1. 新建 ROI 的 id 不与任何既有 id 相同；`len({id}) == len(rois)`；
2. 新建（空区域）ROI 不拥有任何既有列；
3. **承重后果**：删掉「无列」的 ROI，不得减少任何其他 ROI 的列数（撞 id 时必丢）；
4. 连续建 3 个：id、name 互不相同，`primary_roi_id` / `active_roi_id` 始终指向存在的 id；
5. 安全语义：删**有列**的 ROI 未显式 `confirm_drop_columns=True` → `-32002` 且零变化；
   显式确认后真删；删**空** ROI 不需要确认。

## 判别力证据（谁证明这些断言真的会红）

* `test_new_roi_after_load_gets_unique_id`：预修复实现（把 `existing_ids` 临时换成
  `set()`）下红在「id 与既有 ROI 撞号：'roi_1'（rois=['roi_1','roi_1']）」。**已实测**。
* `test_deleting_empty_roi_does_not_shrink_other_roi_columns`：判别力证据来自
  **canary2**（同时禁用 id 去重与确认闸，即预修复实现）——红在**后果断言**上：
  `删除空 ROI 后列数从 28 变成 0：把别家的列删掉了`，**不是**任何前置断言。
  （早期版本曾用"新 ROI 必须 0 列"做前置，撞 id 时它会先炸并掩盖后果，已移除；
  该语义由第 2 条判据单独覆盖。）
* `test_remove_roi_with_columns_requires_explicit_confirmation`：把确认闸注掉
  （`and False`）后红在「未确认也静默成功」，返回里带着被删的 `removed_column_ids`。
* `test_removing_empty_roi_needs_no_confirmation`：**守卫**（防止把删除改成永远拒绝），
  它本身不证明"有列时会被拦"——那条由上一个用例证明。

## 修法取向

在 `roi_create` 里对候选 id 做**与既有 id 集合去重**的循环（与 name 去重同一处），
而不是去恢复 `_roi_counter`——后者要求改 `project.py::_restore_rois`（另一会话在改，
且只覆盖"载入"这一条入口，覆盖不到任何其它让计数器与 rois 脱节的路径）。
"""

from __future__ import annotations

import json
import tarfile
from pathlib import Path
from typing import Any

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

ROI_XLIM = [315, 1946]
ROI_YLIM = [511, 1311]


def _rpc(dispatcher, method: str, **params) -> dict:
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> Any:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _session() -> tuple[StraditizeSession, Any]:
    """载图 → 建 1 个 ROI → 分列（列都挂在这个 ROI 上）。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session._init_rois()
    session.roi_create(
        name="pollen", x0=ROI_XLIM[0], x1=ROI_XLIM[1], y0=ROI_YLIM[0], y1=ROI_YLIM[1]
    )
    session.detect_columns(data_xlim=list(ROI_XLIM), data_ylim=list(ROI_YLIM))
    assert session.columns, "前置：必须分列出列"
    return session, create_rpc_dispatcher(session)


def _roundtrip_through_pack(session: StraditizeSession, dispatcher, pack: Path) -> None:
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack), format="tar"), "保存工程包")
    with tarfile.open(pack) as tf:
        payload = json.loads(tf.extractfile("straditize.json").read().decode("utf-8"))
    assert [r["id"] for r in payload["rois"]] == ["roi_1"], (
        f"前置：包内应只有 roi_1，实际 {[r['id'] for r in payload['rois']]}"
    )
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack)), "载入工程包")
    assert [r["id"] for r in session.rois] == ["roi_1"], "前置：载入后应只有 roi_1"


def test_new_roi_after_load_gets_unique_id(tmp_path: Path) -> None:
    """承重：载入含 roi_1 的包后新建 ROI，id 必须唯一。"""
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    existing_id = session.rois[0]["id"]
    existing_columns = [c for c in session.columns if c.get("roi_id") == existing_id]
    assert existing_columns, "前置：原 ROI 必须拥有列"

    created = _ok(_rpc(dispatcher, "roi.create", x0=0, x1=0, y0=0, y1=0), "新建 ROI")
    new_id = created["roi"]["id"]

    ids = [r["id"] for r in session.rois]
    assert new_id != existing_id, (
        f"新建 ROI 的 id 与既有 ROI 撞号：{new_id!r}（rois={ids}）"
    )
    assert len(set(ids)) == len(ids), f"ROI id 必须互不相同，实际 {ids}"

    # 新建的是空区域：不得声称拥有既有列
    owned = [c for c in session.columns if c.get("roi_id") == new_id]
    assert owned == [], f"空 ROI 不得拥有列，实际 {[c.get('id') for c in owned]}"
    still_owned = [c for c in session.columns if c.get("roi_id") == existing_id]
    assert len(still_owned) == len(existing_columns), "原 ROI 的列不得被新 ROI 抢走"


def test_removing_one_roi_keeps_the_other_rois_columns(tmp_path: Path) -> None:
    """承重后果：删掉一个 ROI，另一个 ROI 与它的列必须仍在（撞 id 时会被级联删光）。"""
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    existing_id = session.rois[0]["id"]
    columns_before = len(session.columns)
    assert columns_before > 0

    _ok(_rpc(dispatcher, "roi.create", x0=0, x1=0, y0=0, y1=0), "新建 ROI")
    new_id = session.rois[-1]["id"]
    assert new_id != existing_id, "前置：本条判据以「id 已唯一」为前提"

    _ok(_rpc(dispatcher, "roi.remove", roi_id=new_id), "删除新建 ROI")

    assert [r["id"] for r in session.rois] == [existing_id], (
        f"删除新建 ROI 后应只剩原 ROI，实际 {[r['id'] for r in session.rois]}"
    )
    kept = [c for c in session.columns if c.get("roi_id") == existing_id]
    assert len(kept) == columns_before, (
        f"原 ROI 的 {columns_before} 列被连带删掉（剩 {len(kept)}）——撞 id 的数据损失"
    )


def test_three_consecutive_creates_are_all_distinct(tmp_path: Path) -> None:
    """连续建 3 个：id/name 互不相同，primary/active 始终指向存在的 id。"""
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    for i in range(3):
        _ok(_rpc(dispatcher, "roi.create", x0=0, x1=0, y0=0, y1=0), f"第 {i + 1} 次新建")
        ids = [r["id"] for r in session.rois]
        names = [r["name"] for r in session.rois]
        assert len(set(ids)) == len(ids), f"第 {i + 1} 次新建后 ROI id 重复：{ids}"
        assert len(set(names)) == len(names), f"第 {i + 1} 次新建后 ROI 名字重复：{names}"
        assert session.primary_roi_id in ids, (
            f"primary_roi_id={session.primary_roi_id!r} 不指向任何存在的 ROI：{ids}"
        )
        assert session.active_roi_id in ids, (
            f"active_roi_id={session.active_roi_id!r} 不指向任何存在的 ROI：{ids}"
        )


def _column_counts_by_roi(session: StraditizeSession) -> dict[str, int]:
    counts: dict[str, int] = {}
    for col in session.columns:
        rid = str(col.get("roi_id"))
        counts[rid] = counts.get(rid, 0) + 1
    return counts


def test_deleting_empty_roi_does_not_shrink_other_roi_columns(tmp_path: Path) -> None:
    """承重②′（上机实测的后果）：删掉「无列」的 ROI，不得减少任何其他 ROI 的列数。

    预修复实现下这里必红：撞 id 时 `roi_remove` 的级联按 `roi_id` 匹配列
    （`roi.py:281-291`），删掉那个空 ROI 会把真 ROI 的 4 列一起删光（用户实测 4→0）。
    """
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    empty = _ok(_rpc(dispatcher, "roi.create", x0=0, x1=0, y0=0, y1=0), "新建空 ROI")["roi"]
    before = _column_counts_by_roi(session)
    total_before = len(session.columns)
    # 这里**刻意不**断言"新 ROI 拥有 0 列"：撞 id 时 `empty["id"]` 就是原 ROI 的 id，
    # 那条前置会先炸，反而看不到真正的后果。空 ROI 不拥有列这件事由
    # `test_new_roi_after_load_gets_unique_id` 钉住；本条只钉"删空的，别家列不许少"。
    assert total_before > 0, "前置：原 ROI 必须有列"

    _ok(_rpc(dispatcher, "roi.remove", roi_id=empty["id"]), "删除空 ROI")

    after = _column_counts_by_roi(session)
    assert len(session.columns) == total_before, (
        f"删除空 ROI 后列数从 {total_before} 变成 {len(session.columns)}：把别家的列删掉了"
    )
    for rid, n in before.items():
        if rid == empty["id"]:
            continue
        assert after.get(rid, 0) == n, (
            f"ROI {rid} 的列数从 {n} 变成 {after.get(rid, 0)}：删除空 ROI 波及了它"
        )


def test_remove_roi_with_columns_requires_explicit_confirmation(tmp_path: Path) -> None:
    """安全语义：删除**有列**的 ROI 必须显式确认，否则报错且零变化。"""
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    self_id = session.rois[0]["id"]
    n_cols = _column_counts_by_roi(session)[self_id]
    assert n_cols > 0

    resp = _rpc(dispatcher, "roi.remove", roi_id=self_id)
    assert "error" in resp, "删除有列的 ROI 未确认时必须报错，实际静默成功"
    err = resp["error"]
    assert err.get("code") == -32002, f"错误码应为 -32002（需要确认），实际 {err.get('code')}"
    message = err.get("message") or ""
    assert str(n_cols) in message, f"错误文案必须说清会删掉几列，实际：{message!r}"
    assert "confirm_drop_columns" in message, (
        f"错误文案必须告诉用户怎么确认，实际：{message!r}"
    )

    # 零变化：ROI 与列都还在
    assert [r["id"] for r in session.rois] == [self_id], "报错后 ROI 不得被删"
    assert _column_counts_by_roi(session)[self_id] == n_cols, "报错后列不得被删"

    # 反向判据：显式确认后必须真的删掉（不许把删除改成永远拒绝）
    confirmed = _ok(
        _rpc(dispatcher, "roi.remove", roi_id=self_id, confirm_drop_columns=True),
        "确认删除有列的 ROI",
    )
    assert confirmed["success"] is True
    assert session.rois == [], "确认后 ROI 应被删除"
    assert len(session.columns) == 0, "确认后该 ROI 的列应被级联删除"


def test_removing_empty_roi_needs_no_confirmation(tmp_path: Path) -> None:
    """反向判据：空 ROI 不该被这道确认拦住（否则每次删空分区都要多一步）。"""
    session, dispatcher = _session()
    _roundtrip_through_pack(session, dispatcher, tmp_path / "one-roi.tar")

    empty = _ok(_rpc(dispatcher, "roi.create", x0=0, x1=0, y0=0, y1=0), "新建空 ROI")["roi"]
    _ok(_rpc(dispatcher, "roi.remove", roi_id=empty["id"]), "删除空 ROI（无需确认）")
    assert [r["id"] for r in session.rois] != [], "原 ROI 必须还在"
    assert len(session.columns) > 0, "原 ROI 的列必须还在"
