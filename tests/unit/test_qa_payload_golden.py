# -*- coding: utf-8 -*-
"""`qa_summarize` 的输出基线（重构前）。

## 为什么需要它

`test_qa_summary.py` 已经把**五个判据**钉得很死（组成和门限、非组成模式、declared_max 只由
x_ticks 推导、空 ROI、容差），但它测的是"结果对不对"，不是"接线有没有接错"：ROI 解析的三条
分支、列归属过滤、以及横向层位从 `samples` 还是从 `column_points` 并集来，都没有逐字段判据。

这里补的就是接线：同一份输出，在不同输入形态下逐字段比对。

## 钉的是什么

| 案例 | 走的接线 |
| --- | --- |
| `empty_roi` | 没有列 → 完整空结构（不能抛，也不能编数） |
| `samples_based` | 有 `samples` → 层位与深度都取自采样层，且给的是**用户填的深度** |
| `column_points_based` | 没有 `samples` → 层位取各列逐行点的并集，深度走 `_depth_for_row_px` |
| `multi_roi` | 两个 ROI，列分属两边 → 只统计目标 ROI 的列 |
| `unknown_roi` | 指定不存在的 ROI → 报错，不静默回落到第一个 |

## 重新生成

    UPDATE_QA_SUMMARY_GOLDEN=1 pixi run python -m pytest tests/unit/test_qa_payload_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "qa_summary_golden.json"
PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session(columns: int = 3) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.columns = session.columns[:columns]
    for column in session.columns:
        column["x_ticks"] = [
            {"px": float(column["start"]), "value": 0.0},
            {"px": float(column["end"]), "value": 100.0},
        ]
        session.digitize(column["col_index"])
    return session


def _case(fn) -> dict:
    try:
        return {"ok": fn()}
    except JsonRpcError as error:
        return {"raised": {"code": error.code, "message": str(error.message)}}


def _collect() -> dict:
    out: dict = {}

    empty = StraditizeSession()
    empty._init_cleanup()
    empty.columns = []
    out["empty_roi"] = _case(empty.qa_summarize)

    samples = _session()
    samples.samples = [
        {"row_px": 300, "depth": 10.0},
        {"row_px": 500, "depth": 150.0},
        {"row_px": 700, "depth": 210.0},
    ]
    out["samples_based"] = _case(samples.qa_summarize)

    points = _session()
    points.samples = []
    out["column_points_based"] = _case(points.qa_summarize)

    multi = _session(columns=4)
    second_roi = multi.roi_create(name="second", x0=900, x1=1300, y0=233, y1=869)["roi"]
    multi.columns[2]["roi_id"] = second_roi["id"]
    multi.columns[3]["roi_id"] = second_roi["id"]
    out["multi_roi"] = {
        "primary": _case(multi.qa_summarize),
        "second": _case(lambda: multi.qa_summarize(roi_id=second_roi["id"])),
    }

    out["unknown_roi"] = _case(lambda: _session().qa_summarize(roi_id="roi_nope"))
    return out


def test_qa_summary_snapshot_is_stable() -> None:
    snapshot = json.loads(json.dumps(_collect()))

    if os.environ.get("UPDATE_QA_SUMMARY_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_QA_SUMMARY_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:1800]}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:1800]}"
        )
