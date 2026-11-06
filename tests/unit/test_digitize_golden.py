# -*- coding: utf-8 -*-
"""`digitize` 的输出与写回状态快照（重构前基线）。

## 为什么需要它

这一步把掩膜变成**读数**：逐行取墨迹特征（area 读本列墨迹右缘、line 读曲线中心或填充顶边、
bar 读柱子右缘），再过横线插值、抽拐点、补端点，最后把 points / control_points /
reader_types 三样写回会话。现有测试都是**精度口径**（R²、MAE、锚点误差）——容差内的改写
（比如把某列的取像素偏 1px、拐点阈值动一点）能让读数整体偏移而精度测试仍然全绿。

## 钉的是什么

真实图版分 16 列后，取第 0/3/8/15 列 × 三种读取方式共 12 条：逐条钉点数、x 序列摘要、
首末点、拐点数与每行控制点；再钉写回会话的三个结构。另外钉三条失败路径：
`col_index` 越界、未知读取方式、没有列就调用。

该图版 `detect_columns` 会填出 `hline_rows`（6 条），所以横线插值分支是**真被执行**的。

第二张图是扫描件（宽墨块）：实测 area 与 bar 的读数差到 78px，而上面那张图版的曲线只有
1~2px、三种读取器逐行完全相同——只用它对 reader 语义没有判别力。

## 重新生成

    UPDATE_DIGITIZE_GOLDEN=1 pixi run python -m pytest tests/unit/test_digitize_golden.py
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "digitize_golden.json"

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
XLIM = [330, 1330]
YLIM = [233, 869]
COLUMNS = [0, 3, 8, 15]
READERS = ["area", "line", "bar"]
# 宽墨块图（扫描件）：三种读取器在这里才分离，用来钉 reader 语义本身。
SCANNED = "tests/data/corpus/raw/01_chinese_scanned_hlines.png"
# col3：area 与 bar 差 78px（宽墨块 → 右缘 vs 柱内差异最大）；col23：area 与 line 差 9.5px
# （填充型画法 → 顶边 vs 中心的区别在这里才显出来）。两列合起来才覆盖三种读取器的语义差别。
SCANNED_COLUMNS = [3, 23]


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=XLIM, data_ylim=YLIM)
    return session


def _round(value) -> float:
    return round(float(value), 6)


def _digest(values) -> str:
    payload = [_round(v) for v in values]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]


def _case(session: StraditizeSession, col_index: int, reader: str) -> dict:
    result = session.digitize(col_index, reader_type=reader)
    points = result["points"]
    return {
        "col_index": result["col_index"],
        "reader_type": result["reader_type"],
        "point_count": len(points),
        "x_digest": _digest([p["x"] for p in points]),
        "first_point": {k: _round(points[0][k]) for k in ("row", "x", "y")},
        "last_point": {k: _round(points[-1][k]) for k in ("row", "x", "y")},
        "control_point_count": result["control_points_count"],
        "control_points": {
            str(k): _round(v) for k, v in sorted(session.control_points[col_index].items())
        },
        "ctrl_ids": [pt["id"] for pt in result["control_points"]],
        "ctrl_types": [pt["type"] for pt in result["control_points"]],
    }


def _collect() -> dict:
    out: dict = {}
    session = _session()
    for col_index in COLUMNS:
        for reader in READERS:
            out[f"col{col_index}_{reader}"] = _case(session, col_index, reader)
    out["session_state"] = {
        "column_point_keys": sorted(session.column_points),
        "reader_types": {str(k): v for k, v in sorted(session.reader_types.items())},
        "control_point_keys": sorted(session.control_points),
        "hline_rows": list(getattr(session, "hline_rows", [])),
    }

    # 第二种图：扫描件里墨迹是**宽块**，三种读取器才真的分开（实测 area 与 bar 差 78px）。
    # 上面那张图版曲线只有 1~2px，三种读取器逐行相同——只钉它等于没钉 reader 的区分。
    scanned = StraditizeSession()
    scanned._init_cleanup()
    scanned.load_image(image_path=SCANNED)
    scanned.detect_columns()
    for col_index in SCANNED_COLUMNS:
        for reader in READERS:
            out[f"scan_col{col_index}_{reader}"] = _case(scanned, col_index, reader)

    errors = {}
    try:
        session.digitize(99)
    except JsonRpcError as error:
        errors["col_index_out_of_range"] = {
            "code": error.code,
            "message": str(error.message),
        }
    try:
        session.digitize(0, reader_type="mean")
    except JsonRpcError as error:
        errors["unknown_reader_type"] = {
            "code": error.code,
            "message": str(error.message),
        }
    empty = StraditizeSession()
    empty._init_cleanup()
    try:
        empty.digitize(0)
    except JsonRpcError as error:
        errors["no_columns"] = {"code": error.code, "message": str(error.message)}
    out["errors"] = errors
    return out


def test_digitize_snapshot_is_stable() -> None:
    snapshot = _collect()

    if os.environ.get("UPDATE_DIGITIZE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_DIGITIZE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:1500]}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:1500]}"
        )
