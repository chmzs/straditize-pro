# -*- coding: utf-8 -*-
"""`straditize.getDiagramData` 的整份载荷基线（重构前）。

## 为什么需要它

这是**前端唯一的数据源**：画布、面板、导出就绪清单全读它。它的键名与嵌套形状就是契约
（前端 `TaxaColumn` / `DiagramData` 按名字取值），少一个键前端读到 `undefined` 就
静默退化成默认值——本仓库历史上 `x_ticks`、`x_group_id`、`axis_stroke_px`、
`suspect_block` 都因为"载荷没带"而让界面说谎，每一条都在源码注释里留了案底。

现有测试只抽查个别键（`line_candidates` 不丢、`isDesktopMode` 存在），没有一处把整份
载荷逐字段钉住。

## 钉的是什么

三案例：

1. `zero_state`：没载图时的零状态载荷——它和正常载荷**共用** `cleanup_payload()` 的键，
   历史上正是因为两条分支各写一份，零状态少了五个键、步骤 4 面板在载图前结构性不同；
2. `loaded_full`：真实图版 + 16 列 + 深度标定 + 组级斜率 + 控制点 + 清理几何，
   逐字段钉整份载荷（列内 `scale_provenance` / `scaleCalib` / `x_ticks_dropped` 等都在内）；
3. `with_dropped_and_suspect`：手工注入 `x_ticks_dropped` 与 `suspect_block`，
   钉"原样透传"（压成布尔或重建容器都会红）。

## 重新生成

    UPDATE_DIAGRAM_PAYLOAD_GOLDEN=1 pixi run python -m pytest \
        tests/unit/test_diagram_payload_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "diagram_payload_golden.json"
PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _payload(session: StraditizeSession) -> dict:
    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    return dispatcher._methods["straditize.getDiagramData"]()


def _blank() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    return session


def _loaded() -> StraditizeSession:
    session = _blank()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.is_calibrated = True
    session.depth_unit = "cm"
    session.depth_calib = {
        "top_px": 233.0,
        "bottom_px": 869.0,
        "top_cm": 0.0,
        "bottom_cm": 320.0,
        "unit": "cm",
        "primary_axis": "depth",
    }
    roi = session.rois[0]
    group = roi["x_groups"][0]
    group["value_per_px"] = 0.5
    group["axis_stroke_px"] = 6
    roi["default_group_id"] = group["id"]
    for column in session.columns:
        column["x_group_id"] = group["id"]
    session.control_points[0] = {300: 120.0, 400: 140.0}
    session.digitize(0, "area")
    session.line_candidates = [
        {"id": "cand_a", "axis": "h", "x": 10.0, "status": "removed", "roi_id": roi["id"]}
    ]
    session.selected_candidate_ids = {"cand_a"}
    session.exclusion_regions = [{"id": "region_a", "x0": 1.0, "x1": 2.0, "y0": 3.0, "y1": 4.0}]
    session.line_strokes = [{"id": "stroke_a", "mode": "erase", "points": [[1, 2], [3, 4]]}]
    session.cleanup_stats = {"removed_pixels": 3}
    return session


def _with_dropped_and_suspect() -> StraditizeSession:
    session = _loaded()
    first = session.columns[0]
    first["x_ticks_dropped"] = {
        "reason": "out_of_band",
        "px": (1.0, 2.0),
        "band": (0.0, 100.0),
    }
    first["suspect_block"] = {
        "reason": "filled_column",
        "cv": 0.007,
        "fill_ratio": 0.99,
        "mean_ink_width": 120.0,
        "column_width": 121.0,
    }
    return session


def _collect() -> dict:
    return {
        "zero_state": _payload(_blank()),
        "loaded_full": _payload(_loaded()),
        "with_dropped_and_suspect": _payload(_with_dropped_and_suspect()),
    }


def test_diagram_payload_snapshot_is_stable() -> None:
    # 载荷是**线格式**：先过一遍 JSON，让元组/整型键与文件里的形状一致。
    # 否则 `x_ticks_dropped` 里的 tuple 与 fixture 的 list 会让基线永远红。
    snapshot = json.loads(json.dumps(_collect()))

    if os.environ.get("UPDATE_DIAGRAM_PAYLOAD_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_DIAGRAM_PAYLOAD_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 载荷变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:2500]}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:2500]}"
        )
