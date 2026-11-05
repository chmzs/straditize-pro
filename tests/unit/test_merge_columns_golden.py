# -*- coding: utf-8 -*-
"""`_merge_with_existing_columns` 的合并结果基线（重构前）。

## 为什么需要它

`detect_columns` 的主流程已经拆成四段，但**合并**这一段 251 行还在：它同时管
「切分定位」「逐列命名」「状态继承（含 x 刻度越界守卫）」「轴线粗组写入」「色块标记」「收尾拼接」。
`test_detect_columns_golden` 只覆盖"新会话第一次分列"（没有既有列、没有既有标定），
而这里的**全部复杂度都来自既有列**：保留哪些状态、丢标定时丢在哪、组参数写不写。

## 钉的是什么

同一张真实图版、同一 ROI，分三步：

1. `first_pass`：空会话分列 → 记下几何；
2. `preserve_state`：往既有列注入状态（在带内 x_ticks / 越界 x_ticks / unit+plot_type+
   scale_type+superelevation），再用**同样 bounds** 重分列（列数不变 → preserve_state 分支）；
3. `layout_changed`：用**更窄的 bounds** 重分列（列数变化 → 另一分支，标定必须记为
   `column_layout_changed` 而不是静默消失）。

每个案例都逐列钉 id / name / start / end / x_group_id / x_values / x_ticks /
x_ticks_dropped / suspect_block / unit / plot_type / scale_type，外加 taxa_names 与
默认组的 `axis_stroke_px`。

## 重新生成

    UPDATE_MERGE_COLUMNS_GOLDEN=1 pixi run python -m pytest \
        tests/unit/test_merge_columns_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
GOLDEN = Path(__file__).parent / "fixtures" / "merge_columns_golden.json"

FULL = {"xlim": [330, 1330], "ylim": [233, 869]}
NARROW = {"xlim": [420, 1180], "ylim": [233, 869]}


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (set, frozenset)):
        return sorted(_jsonable(v) for v in value)
    if isinstance(value, float):
        return round(float(value), 6)
    return value


def _column_row(col: dict) -> dict:
    keys = [
        "col_index",
        "id",
        "name",
        "species",
        "roi_id",
        "x_group_id",
        "x_values",
        "start",
        "end",
        "unit",
        "plot_type",
        "scale_type",
        "exaggeration_mult",
        "has_exaggeration",
        "x_ticks",
        "x_ticks_dropped",
        "suspect_block",
    ]
    return {key: _jsonable(col.get(key)) for key in keys}


def _group_state(session: StraditizeSession) -> dict:
    out = {}
    for roi in getattr(session, "rois", []) or []:
        for group in roi.get("x_groups", []) or []:
            out[f"{roi.get('id')}/{group.get('id')}"] = {
                "axis_stroke_px": group.get("axis_stroke_px"),
                "ref_span_px": group.get("ref_span_px"),
            }
    return out


def _snapshot(session: StraditizeSession) -> dict:
    return {
        "column_count": len(session.columns),
        "columns": [_column_row(c) for c in session.columns],
        "taxa_names": _jsonable(list(session.taxa_names)),
        "groups": _group_state(session),
        "data_xlim": _jsonable(session.data_xlim),
        "data_ylim": _jsonable(session.data_ylim),
    }


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session._init_rois()
    session.roi_create(
        name="pollen",
        x0=FULL["xlim"][0],
        x1=FULL["xlim"][1],
        y0=FULL["ylim"][0],
        y1=FULL["ylim"][1],
        composition=True,
    )
    return session


def _inject_state(session: StraditizeSession) -> None:
    """往既有列注入"用户在步骤 5/6 里会做出来的状态"。"""
    columns = session.columns
    assert len(columns) >= 3, f"前置：应有至少 3 列，实际 {len(columns)}"

    first = columns[0]
    first["x_ticks"] = [
        {"px": first["start"] + 2, "value": 0.0},
        {"px": first["end"] - 2, "value": 100.0},
    ]
    first["x_values"] = [0.0, 100.0]

    second = columns[1]
    # 越界：整对标定被平移到列带左侧 300px，必须被守卫拒绝并留痕
    second["x_ticks"] = [
        {"px": second["start"] - 300, "value": 0.0},
        {"px": second["end"] - 300, "value": 100.0},
    ]

    third = columns[2]
    third["unit"] = "cm"
    third["plot_type"] = "line"
    third["scale_type"] = "log"
    third["exaggeration_mult"] = 2.0


def _build_snapshots() -> dict:
    session = _session()
    session.detect_columns(data_xlim=FULL["xlim"], data_ylim=FULL["ylim"])
    out: dict[str, Any] = {"first_pass": _snapshot(session)}

    _inject_state(session)
    session.detect_columns(data_xlim=FULL["xlim"], data_ylim=FULL["ylim"])
    out["preserve_state"] = _snapshot(session)

    session.detect_columns(data_xlim=NARROW["xlim"], data_ylim=NARROW["ylim"])
    out["layout_changed"] = _snapshot(session)

    return out


def test_merge_with_existing_columns_snapshot_is_stable() -> None:
    snapshot = _build_snapshots()

    if os.environ.get("UPDATE_MERGE_COLUMNS_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_MERGE_COLUMNS_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys()
    for case in expected:
        assert snapshot[case]["column_count"] == expected[case]["column_count"], (
            f"[{case}] 列数变了：{snapshot[case]['column_count']} vs "
            f"{expected[case]['column_count']}"
        )
        assert snapshot[case]["columns"] == expected[case]["columns"], (
            f"[{case}] 列内容变了（逐列比对）"
        )
        for key in ("taxa_names", "groups", "data_xlim", "data_ylim"):
            assert snapshot[case][key] == expected[case][key], f"[{case}] {key} 变了"
