# -*- coding: utf-8 -*-
"""列点编辑必须回写后端：改一个锚点 → 后端 control_points 变 → 导出该行值跟着变。

## 缺陷现场

画布上的拖动 / 删除 / 微调只改前端模型（`GeologyCanvas` + 两个 tool strategy），
`onDataChange` 只写 localStorage 草稿；后端 `control_points` 停在最后一次
`core.digitize` / `project.load`，导出面板与 data.csv 因此对编辑毫无反应。

## 判据

1. 后端：`column.setControlPoints` 整列替换锚点后 `control_points` 变了，导出该层位的
   读数也跟着变（改前 10.0 → 改后 90.0）；
2. 删掉中间的锚点后该层位回到两端锚点的插值（证明导出读的确实是这份 control_points）；
3. 前端三处编辑（拖动结束 ×2 工具、删除锚点、微调去抖）都必须调 `commitControlPoints`，
   `main.ts` 必须把它接到 `rpcClient.setControlPoints`；
4. 导出面板必须有刷新入口，且 `onDataChange` 会触发面板刷新。

## 反向验证（实测过）

把 `GeologyCanvas.commitControlPoints` 里的 `this.callbacks.onControlPointsCommit?.()` 注释掉，
`test_canvas_commit_is_wired_to_backend` 立刻变红（`this.commitControlPoints(col.id)` 仍在，
但回调链断了时 `main.ts` 侧 `rpcClient.setControlPoints` 断言同样会失败）。
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pandas as pd
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

_REPO = Path(__file__).resolve().parents[2]

def _strip_js_comments(source: str) -> str:
    """去掉 JS/TS 的行注释与块注释。

    源码级判据必须只看活代码：把回写那一行 // 注释掉之后子串仍在文件里，
    不剥离的话这条判据就是假的（实测：不剥离时「注释掉回写」依旧 5 passed）。
    """
    without_block = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return "\n".join(line.split("//", 1)[0] for line in without_block.splitlines())


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_export()
    session.columns = [
        {
            "col_index": 0,
            "name": "col01",
            "roi_id": "roi_1",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
        }
    ]
    session.column_points = {0: [{"row": r, "x": 10.0} for r in range(100, 121)]}
    session.control_points = {0: {100: 10.0, 120: 10.0}}
    session.samples = [
        {"row_px": 100, "depth": 100.0},
        {"row_px": 110, "depth": 110.0},
        {"row_px": 120, "depth": 120.0},
    ]
    session.data_ylim = [100, 120]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


def _value_at(session: StraditizeSession, depth: float) -> float:
    frame = pd.read_csv(io.StringIO(session.export_data("csv")["csv"]))
    return float(frame.set_index("depth").loc[depth, "col01"])


def test_set_control_points_changes_export_value() -> None:
    session = _session()
    assert _value_at(session, 110.0) == 10.0, "改之前：两端锚点都是 10px → 该层位 10.0"

    session.set_control_points(
        0,
        [
            {"row": 100, "x": 10.0},
            {"row": 110, "x": 90.0},
            {"row": 120, "x": 10.0},
        ],
    )

    assert session.control_points[0][110] == 90.0, "后端 control_points 必须收到新锚点"
    assert _value_at(session, 110.0) == 90.0, (
        "导出该层位必须跟着变（10.0 → 90.0）；不变说明导出读的不是这份 control_points"
    )


def test_removing_the_middle_anchor_restores_the_interpolated_value() -> None:
    session = _session()
    session.set_control_points(
        0,
        [
            {"row": 100, "x": 10.0},
            {"row": 110, "x": 90.0},
            {"row": 120, "x": 10.0},
        ],
    )
    assert _value_at(session, 110.0) == 90.0

    session.set_control_points(0, [{"row": 100, "x": 10.0}, {"row": 120, "x": 10.0}])

    assert 110 not in session.control_points[0], "删掉的锚点必须从后端消失"
    assert _value_at(session, 110.0) == 10.0, "剩下的两端锚点都是 10px → 回到 10.0"


def test_set_control_points_rejects_empty_list() -> None:
    with pytest.raises(JsonRpcError):
        _session().set_control_points(0, [])


def test_canvas_commit_is_wired_to_backend() -> None:
    """前端三处编辑都必须真的把锚点推出去（浏览器里测不到的那一段）。"""
    src = _REPO / "frontend" / "src"
    canvas = _strip_js_comments(
        (src / "components" / "GeologyCanvas.ts").read_text(encoding="utf-8")
    )
    main_ts = _strip_js_comments((src / "main.ts").read_text(encoding="utf-8"))
    select = _strip_js_comments(
        (src / "core" / "tools" / "SelectToolStrategy.ts").read_text(encoding="utf-8")
    )
    addpoint = _strip_js_comments(
        (src / "core" / "tools" / "AddPointToolStrategy.ts").read_text(encoding="utf-8")
    )

    assert "onControlPointsCommit" in canvas
    assert "this.callbacks.onControlPointsCommit?.(idx, points)" in canvas, (
        "commitControlPoints 必须真的调回调；注释掉它等于回写断了"
    )
    assert "this.commitControlPoints(col.id)" in canvas, "删除锚点 / 微调去抖必须提交"
    assert "ctx.commitControlPoints(col.id)" in select, "拖动结束（选择工具）必须提交"
    assert "ctx.commitControlPoints(col.id)" in addpoint, "拖动结束（加点工具）必须提交"
    assert "await rpcClient.setControlPoints(colIndex, points)" in main_ts, (
        "回调必须真的发 RPC，否则只是一次前端自娱自乐"
    )


def test_export_modal_refreshes_without_reopen() -> None:
    """面板必须能重拉：刷新按钮 + 打开期间的刷新句柄 + onDataChange 触发。"""
    src = _REPO / "frontend" / "src"
    modal = _strip_js_comments(
        (src / "components" / "ExportModal.ts").read_text(encoding="utf-8")
    )
    main_ts = _strip_js_comments((src / "main.ts").read_text(encoding="utf-8"))

    assert "export function refreshOpenExportModal" in modal
    assert "btn-wpd-refresh" in modal, "缺「刷新数据」按钮"
    assert "refreshOpenExportModal()" in main_ts, "onDataChange 必须触发面板刷新"

