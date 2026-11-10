# -*- coding: utf-8 -*-
"""手工控制点（`isManual`）的保存/载入/重算保护。

## 为什么需要它

用户手工在图上补/改的控制点是他唯一无法重做的劳动：重新分列/重新提取只能产出
**算法的**拐点，手工点一旦丢失就只能肉眼重找。2026-11-10 上机实测（用户真实包）：

```
载入包 → 4 列控制点 46/36/33/40 都在，页脚却显示「锚点: 0 手动 / 46 总计」
点「检测分列」重跑 → type 33→34、Chenopodiaceae 40→42（两列被整体重算）
```

根因有两条，都在后端：

1. **不落盘**：`project_save` 写控制点时只写 `{x,y,value,kind,valid_segment}`，没有
   `isManual`；`project_load` 只做 `ctrls[y]=x`，也没有 `isManual`；载荷层更直接
   把它硬编码成 `False`（`rpc_methods/system.py:268`）。所以"手工"这件事在会话里
   根本没有存储位置。
2. **重建覆盖**：`digitize` 每次都用算法结果**整体替换** `control_points[c]`，
   于是即便记住了"哪些点是手工的"，重分列/重提取仍会把它们算掉。

## 钉的是什么

* 正向（承重）：`point.add` 加的手工点，`project_save` 落盘带 `isManual: true`，
  `project.new` + `project.load` 之后仍是手工；`core.detectColumns` 重跑后**该点仍在、
  x 不被改写**。
* 负向对照：非手工点**允许**被重建替换——包里带一个落在 ROI 之外的非手工点，
  重跑分列后它必须消失（否则说明修复把"重建"整个冻住了，等于把算法结果也钉死）。
* 向后兼容：老包没有 `isManual` 字段时按 `false` 处理，行为与今天一致。

## 为什么用真 session + 真 dispatcher

`isManual` 的丢失发生在"RPC 载荷 → 序列化 → 反序列化 → 会话"这条链上，
绕开 dispatcher 直接改字典就测不到参数绑定与载荷映射，等于测了个假的东西。
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path
from typing import Any

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

ROI_XLIM = [315, 1946]
ROI_YLIM = [511, 1311]

COLUMN = 0
# 手工点的行：落在一列的中段、且刻意避开已有控制点，保证"新增"而不是"改已有"
MANUAL_ROW_OFFSET = 7


def _rpc(dispatcher, method: str, **params) -> dict:
    """走真 dispatcher：参数绑定、方法注册、错误映射都按生产路径发生。"""
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> Any:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _points(page_payload: dict, col_index: int) -> list[dict]:
    return page_payload["columns"][col_index]["controlPoints"]


def _find_point(points: list[dict], row: int) -> dict | None:
    return next((p for p in points if int(p["y"]) == int(row)), None)


def _read_tar_json(path: Path) -> dict:
    with tarfile.open(path, "r") as tf:
        member = tf.extractfile("straditize.json")
        assert member is not None
        return json.loads(member.read().decode("utf-8"))


def _write_tar_with_payload(src: Path, dst: Path, payload: dict) -> Path:
    """把 `src` 包里的 straditize.json 换成 payload，其余成员原样搬运。

    用"改写文件"而不是改会话对象：本用例要验证的正是**载入路径**会怎么解释包里的字段。
    """
    with tarfile.open(src, "r") as tf:
        members = [
            (m.name, tf.extractfile(m).read()) for m in tf.getmembers() if m.isfile()
        ]
    with tarfile.open(dst, "w") as tf:
        for name, data in members:
            if name == "straditize.json":
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return dst


def _session() -> tuple[StraditizeSession, Any]:
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=list(ROI_XLIM), data_ylim=list(ROI_YLIM))
    assert session.columns, "前置：必须分列出列"
    dispatcher = create_rpc_dispatcher(session)
    # 分列只给列边界，控制点要数字化才产生（`core.digitize` 是前端"识别"走的同一入口）
    _ok(_rpc(dispatcher, "core.digitize", col_index=COLUMN), "数字化首列")
    assert session.control_points.get(COLUMN), "前置：第 0 列必须有控制点"
    return session, dispatcher


def _manual_row(session: StraditizeSession) -> int:
    """挑一个不在现有控制点里的行，避免"新增"变成"覆盖"。"""
    rows = sorted(int(r) for r in session.control_points[COLUMN])
    start = rows[len(rows) // 2]
    row = start + MANUAL_ROW_OFFSET
    while row in session.control_points[COLUMN]:
        row += 1
    assert row <= ROI_YLIM[1], "前置：手工点必须落在 ROI 内"
    return row


def _manual_x(session: StraditizeSession, row: int) -> float:
    """取该行的数字化 x 再偏 3px：既合理又明显"不是算法会给的值"。"""
    profile = {int(p["row"]): float(p["x"]) for p in session.column_points[COLUMN]}
    base = profile.get(row)
    if base is None:
        nearest = min(profile, key=lambda r: abs(r - row))
        base = profile[nearest]
    return base + 3.0


def test_manual_point_roundtrip_and_rebuild_protection(tmp_path: Path) -> None:
    """承重：手工点必须落盘、必须活过 project.new/load、必须活过重分列。"""
    session, dispatcher = _session()
    row = _manual_row(session)
    x_val = _manual_x(session, row)

    _ok(
        _rpc(dispatcher, "point.add", col_index=COLUMN, y=row, x=x_val, kind="manual"),
        "新增手工点",
    )

    # ① 载荷必须当场承认它是手工点（现状：system.py 硬编码 False）
    payload = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "读取载荷")
    point = _find_point(_points(payload, COLUMN), row)
    assert point is not None, "point.add 之后载荷里应出现该行"
    assert point["isManual"] is True, "刚加的手工点在载荷里必须 isManual=true"

    # ② 工程包必须把它写进去（现状：project_save 不写 isManual）
    pack = tmp_path / "manual.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack), format="tar"), "保存工程包")
    saved_payload = _read_tar_json(pack)
    saved_pts = saved_payload["columns"][COLUMN]["points"]
    saved_point = _find_point(
        [dict(p, y=p.get("y")) for p in saved_pts], row
    )
    assert saved_point is not None, "包里的列段应包含该行控制点"
    assert saved_point.get("isManual") is True, "包里的手工点必须带 isManual: true"
    assert saved_point.get("kind") == "manual", "kind 也必须落盘（前端靠它区分形状）"

    # ③ project.new + project.load 之后仍然是手工点（现状：载入只写 x）
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack)), "载入工程包")
    payload2 = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "载入后读取载荷")
    point2 = _find_point(_points(payload2, COLUMN), row)
    assert point2 is not None, "载入后该行控制点应存在"
    assert point2["isManual"] is True, "载入后手工点必须仍是 isManual=true"
    assert float(point2["x"]) == pytest.approx(x_val, abs=1e-9), "手工点的 x 不得被载入改写"

    # ④ 承重：重跑分列后手工点仍在、x 不变（现状：digitize 整体替换控制点）
    _ok(
        _rpc(
            dispatcher,
            "core.detectColumns",
            data_xlim=list(ROI_XLIM),
            data_ylim=list(ROI_YLIM),
        ),
        "重跑分列",
    )
    payload3 = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "重分列后读取载荷")
    point3 = _find_point(_points(payload3, COLUMN), row)
    assert point3 is not None, "重跑分列不得删掉手工点（用户劳动不可重建）"
    assert float(point3["x"]) == pytest.approx(x_val, abs=1e-9), "重跑分列不得移动手工点"
    assert point3["isManual"] is True, "重跑分列后手工点必须仍标记为手工"


def test_non_manual_points_are_still_rebuilt(tmp_path: Path) -> None:
    """负向对照：非手工点必须仍由算法决定，不能被"保护手工点"顺带冻住。

    做法：往包里塞一个**落在 ROI 之外**的非手工点。重建只产出 ROI 窗口内的行
    （`_turning_control_points` 的行号来自 `y0 + r_rel`），所以这个点在任何一次真实
    重建里都无法被重新算出来——它必须消失。
    """
    session, dispatcher = _session()
    row = _manual_row(session)
    x_val = _manual_x(session, row)
    _ok(
        _rpc(dispatcher, "point.add", col_index=COLUMN, y=row, x=x_val, kind="manual"),
        "新增手工点",
    )
    pack = tmp_path / "manual2.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack), format="tar"), "保存工程包")

    payload = _read_tar_json(pack)
    stale_row = int(ROI_YLIM[0]) - 5  # ROI 之外，重建不可能产出
    payload["columns"][COLUMN]["points"].append(
        {
            "x": float(payload["columns"][COLUMN]["start"]) + 10.0,
            "y": stale_row,
            "value": 0.0,
            "kind": "peak",
            "valid_segment": True,
            "isManual": False,
        }
    )
    pack2 = _write_tar_with_payload(pack, tmp_path / "manual2-stale.tar", payload)

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack2)), "载入带陈旧点的包")
    _ok(
        _rpc(
            dispatcher,
            "core.detectColumns",
            data_xlim=list(ROI_XLIM),
            data_ylim=list(ROI_YLIM),
        ),
        "重跑分列",
    )
    after = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "重分列后读取载荷")
    rows_after = {int(p["y"]) for p in _points(after, COLUMN)}
    assert stale_row not in rows_after, (
        "ROI 之外的非手工点必须被重建清掉——否则说明修复把整个重建冻住了"
    )
    assert row in rows_after, "同一次重建里手工点仍须保留（两者的差别只有 isManual）"


def test_legacy_pack_without_is_manual_defaults_to_false(tmp_path: Path) -> None:
    """向后兼容：老包没有 `isManual` 字段 → 按 false 处理，且保存时显式写 false。"""
    session, dispatcher = _session()
    pack = tmp_path / "legacy.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack), format="tar"), "保存工程包")

    payload = _read_tar_json(pack)
    for col in payload["columns"]:
        for pt in col["points"]:
            pt.pop("isManual", None)
    legacy = _write_tar_with_payload(pack, tmp_path / "legacy-old.tar", payload)

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(legacy)), "载入老包")
    after = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "载入后读取载荷")
    assert _points(after, COLUMN), "老包的控制点必须照常载入"
    assert all(p["isManual"] is False for p in _points(after, COLUMN)), (
        "没有 isManual 的老包必须一律按 false 处理"
    )

    reassaved = _ok(
        _rpc(dispatcher, "project.save", output_path=str(tmp_path / "legacy2.tar"), format="tar"),
        "再次保存",
    )
    assert reassaved["success"] is True
    pts = _read_tar_json(tmp_path / "legacy2.tar")["columns"][COLUMN]["points"]
    assert all(pt.get("isManual") is False for pt in pts), "再保存时也必须显式写 false"
