# -*- coding: utf-8 -*-
"""`resolve_column_scale` 的逐字段基线（重构前）。

## 为什么需要它

这个函数是**所有换算路径的唯一事实源**（CSV/Parquet、XLSX/LiPD/TAR 导出、深度网格、QA、
图谱载荷都走它）。它按六种来源返回 `ColumnScale`：`group`（组布局 x_values）、
`group_slope`（点齿标定的组斜率）、`x_ticks`、`x_scales`、`legacy`、`default`。
任何一个分支的优先级或取像素算错，读数就整体偏——但界面上看起来完全正常。

## 钉的是什么

每种来源各一条，外加三处容易改错的边角：log 标度的默认起点是 1.0 不是 0、
`tickEndX` 与起点重合时的兜底、组缺失时回落到活跃 ROI 的第一个组；
以及夸张倍数的三个来源（现代键 / 历史键 `has_exaggeration` + multiplier / 组级）。

## 重新生成

    UPDATE_COLUMN_SCALE_GOLDEN=1 pixi run python -m pytest tests/unit/test_column_scale_golden.py
"""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

GOLDEN = Path(__file__).parent / "fixtures" / "column_scale_golden.json"


def _session(**attrs) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    for key, value in attrs.items():
        setattr(session, key, value)
    return session


def _group(**overrides) -> dict:
    base = {
        "id": "g1",
        "name": "组1",
        "unit": "%",
        "plot_type": "area",
        "scale_type": "linear",
        "exaggeration_mult": None,
        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
    }
    base.update(overrides)
    return base


def _scale(session, col, col_index=None) -> dict:
    scale = resolve_column_scale(session, col, col_index)
    return {k: (round(v, 6) if isinstance(v, float) else v)
            for k, v in dataclasses.asdict(scale).items()}


def _collect() -> dict:
    out: dict = {}

    roi = {"id": "roi_1", "default_group_id": "g1", "x_groups": [_group()]}

    # 1. group：组 tick_layout + 列 x_values（组管位置，列管数值）
    out["group"] = _scale(
        _session(rois=[roi], active_roi_id="roi_1", primary_roi_id="roi_1"),
        {"startX": 100.0, "endX": 200.0, "x_values": [0.0, 40.0],
         "roi_id": "roi_1", "x_group_id": "g1"},
        0,
    )

    # 2. group_slope：点齿标定（0 点 = 列左缘 + 轴线粗）
    slope_roi = {
        "id": "roi_1",
        "default_group_id": "g1",
        "x_groups": [_group(value_per_px=0.5, axis_stroke_px=6)],
    }
    out["group_slope"] = _scale(
        _session(rois=[slope_roi], active_roi_id="roi_1"),
        {"startX": 100.0, "endX": 200.0, "roi_id": "roi_1", "x_group_id": "g1"},
        1,
    )

    # 3. x_ticks：显式两点
    out["x_ticks"] = _scale(
        _session(),
        {"startX": 100.0, "endX": 200.0,
         "x_ticks": [{"px": 110.0, "value": 5.0}, {"px": 190.0, "value": 45.0}]},
        2,
    )

    # 4. x_scales：无 legacy 且已标定
    out["x_scales"] = _scale(
        _session(is_calibrated=True, x_scales={3: {"slope": 2.0, "intercept": -3.0}}),
        {"startX": 100.0, "endX": 200.0},
        3,
    )

    # 5. legacy：三件套；同时验历史夸张键
    out["legacy"] = _scale(
        _session(),
        {"startX": 100.0, "endX": 200.0, "startValue": 2.5, "tickValue": 22.5,
         "tickEndX": 180.0, "has_exaggeration": True, "exaggeration_multiplier": 3.0},
        4,
    )

    # 6. default：什么都没有
    out["default"] = _scale(_session(), {"startX": 10.0, "endX": 60.0}, 5)

    # 7. log 默认：起点必须是 1.0
    out["default_log"] = _scale(_session(), {"startX": 10.0, "endX": 60.0, "scale_type": "log"}, 6)

    # 8. tickEndX 与起点重合 → 兜底到列右缘
    out["degenerate_tick_end"] = _scale(
        _session(),
        {"startX": 100.0, "endX": 200.0, "startValue": 0.0, "tickValue": 100.0,
         "tickEndX": 100.0},
        7,
    )

    # 9. 列没有 roi_id → 回落到活跃 ROI；组没有指定 → 回落到第一个组
    fallback_roi = {
        "id": "roi_9",
        "default_group_id": "g_missing",
        "x_groups": [_group(id="g_first", unit="‰", plot_type="bar")],
    }
    out["roi_group_fallback"] = _scale(
        _session(rois=[{"id": "roi_0", "x_groups": []}, fallback_roi],
                 active_roi_id="roi_9", primary_roi_id="roi_0"),
        {"startX": 20.0, "endX": 120.0, "x_values": [1.0, 9.0]},
        8,
    )

    # 10. 组级夸张倍数
    exag_roi = {"id": "roi_1", "default_group_id": "g1",
                "x_groups": [_group(exaggeration_mult=2.5)]}
    out["group_exaggeration"] = _scale(
        _session(rois=[exag_roi], active_roi_id="roi_1"),
        {"startX": 0.0, "endX": 100.0, "roi_id": "roi_1", "x_group_id": "g1"},
        9,
    )

    # 11. 现代键夸张（<=1 视为未夸张）
    out["no_exaggeration_when_le_one"] = _scale(
        _session(), {"startX": 0.0, "endX": 100.0, "exaggeration_mult": 1.0}, 10
    )
    return out


def test_column_scale_snapshot_is_stable() -> None:
    snapshot = _collect()

    if os.environ.get("UPDATE_COLUMN_SCALE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_COLUMN_SCALE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)}"
        )
