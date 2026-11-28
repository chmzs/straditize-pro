# -*- coding: utf-8 -*-
"""回归钉子（#208B）：`e2e.reset` 与会话复位必须清理隐藏状态，防止跨用例污染。

实测故障链（`contract.spec.ts` → `qa.spec.ts`）：
1. `contract` 第 2 步调 `getDiagramData` 触发 `digitize(0)`；
2. `detectLineCandidates` + `applyLineRemoval` 调 `_invalidate_digitized_points`
   写下 `_points_invalidated = {0..27}`；
3. 再次 `getDiagramData` 经 `_fill_missing_column_points` → `_points_from_controls`
   把 `0` 写入 `control_point_columns`；
4. 旧版 `e2e.reset` / `project_new` 未清 `control_point_columns`、`_points_invalidated`、
   `_gray_cache`，导致 `qa.spec.ts` 新建 `col_index=0` 时继承 `control_point_columns={0}`，
   `row=475` 被当成控制点合成列 clamp 到 `row=474` 读数，`n_horizons_empty` 从 2 掉成 1。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from support.serve_e2e_backend import _load_baseline, _reset  # noqa: E402


def _rpc(dispatcher, method: str, params: dict | None = None) -> dict:
    raw = dispatcher.handle_text(
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    )
    resp = json.loads(raw)
    assert "error" not in resp, f"RPC {method} failed: {resp.get('error')}"
    return resp["result"]


def test_e2e_reset_clears_hidden_state_after_contract_cleanup() -> None:
    """`contract` 清理链路后再 `e2e.reset`，`qa` 必须稳定得到 2 个空层位（148.0 / 150.0）。"""
    session = StraditizeSession()
    _load_baseline(session)
    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("e2e.reset", lambda: _reset(session))

    _rpc(dispatcher, "e2e.reset")
    _rpc(dispatcher, "straditize.getDiagramData")
    _rpc(
        dispatcher,
        "algorithm.detectLineCandidates",
        {"roi_id": "roi_1", "include_horizontal": True, "include_vertical": True},
    )
    _rpc(dispatcher, "algorithm.applyLineRemoval", {"roi_id": "roi_1"})
    _rpc(dispatcher, "straditize.getDiagramData")

    _rpc(dispatcher, "e2e.reset")

    assert not getattr(session, "control_point_columns", None), (
        "e2e.reset 后 control_point_columns 必须为空"
    )
    assert not getattr(session, "_points_invalidated", None), (
        "e2e.reset 后 _points_invalidated 必须为空"
    )
    assert "_gray_cache" not in session.__dict__, (
        "e2e.reset 后 _gray_cache 必须已作废"
    )

    # 复现 qa.spec.ts 的受控图谱构建流程
    for roi in _rpc(dispatcher, "roi.list")["rois"]:
        _rpc(dispatcher, "roi.remove", {"roi_id": roi["id"], "confirm_drop_columns": True})

    roi_id = _rpc(
        dispatcher,
        "roi.create",
        {"name": "pollen", "x0": 100, "x1": 210, "y0": 100, "y1": 475, "composition": True},
    )["roi"]["id"]
    _rpc(dispatcher, "column.add", {"column": {"name": "Pinus", "startX": 100, "endX": 210}})
    _rpc(dispatcher, "column.update", {"col_index": 0, "updates": {"axis_stroke_px": 0}})
    _rpc(
        dispatcher,
        "column.update",
        {
            "col_index": 0,
            "updates": {
                "roi_id": roi_id,
                "scale_type": "linear",
                "startValue": 0,
                "tickValue": 100,
                "x_ticks": [{"px": 100, "value": 0}, {"px": 200, "value": 100}],
            },
        },
    )
    _rpc(dispatcher, "core.digitize", {"col_index": 0})
    target_sums = [96] * 72 + [92, 103.2, 0, 0]
    for idx, val in enumerate(target_sums):
        _rpc(
            dispatcher,
            "core.updateControlPoint",
            {"col_index": 0, "row": 100 + idx * 5, "x": 100 + val},
        )
    _rpc(
        dispatcher,
        "samples.set",
        {
            "samples": [
                {"row_px": 100 + idx * 5, "depth": idx * 2, "source": "auto"}
                for idx in range(len(target_sums))
            ]
        },
    )

    summary = _rpc(dispatcher, "qa.summarize", {"tolerance": 2, "roi_id": roi_id})
    assert summary["n_horizons"] == 76
    assert summary["n_horizons_empty"] == 2
    assert [h["depth"] for h in summary["empty_horizons"]] == [148.0, 150.0]
    assert summary["sum"]["max"] == 103.2


def test_project_new_and_load_image_clear_derived_point_state() -> None:
    """`project_new(clear_image=True)` 与 `load_image` 必须清理派生点集状态与灰度缓存。"""
    session = StraditizeSession()
    _load_baseline(session)
    _ = session._get_gray_image()
    session.control_point_columns = {0, 2}
    session._points_invalidated = {0, 1}

    session.project_new(clear_image=True)
    assert session.control_point_columns == set()
    assert "_points_invalidated" not in session.__dict__
    assert "_gray_cache" not in session.__dict__

    _load_baseline(session)
    _ = session._get_gray_image()
    session.control_point_columns = {0}
    session._points_invalidated = {0}
    session.load_image(sample_key="beginner")
    assert session.control_point_columns == set()
    assert "_points_invalidated" not in session.__dict__
    assert "_gray_cache" not in session.__dict__


def test_project_new_preserves_project_name_when_keeping_image() -> None:
    """`project_new(clear_image=False)`（重置全部操作）应保留 `project_name`，`clear_image=True` 才清空。"""
    session = StraditizeSession()
    _load_baseline(session)
    session.set_project_name("Gahai_Lake_2024")
    session.project_new(clear_image=False)
    assert session.project_name == "Gahai_Lake_2024"

    session.project_new(clear_image=True)
    assert session.project_name is None


def test_digitize_clears_control_point_column_flag() -> None:
    """重新真实数字化某列后，必须将该列移出 `control_point_columns`。"""
    session = StraditizeSession()
    _load_baseline(session)
    session.control_point_columns = {0}
    session.digitize(0)
    assert 0 not in session.control_point_columns
