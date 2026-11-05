# -*- coding: utf-8 -*-
"""`detect_columns` 的输出快照（重构前的行为基线）。

## 为什么需要它

这个函数 397 行，是分列主流程：解析 ROI → 夹取边界 → 掩膜/灰度准备 → 检测列边界 →
构造 detected_cols → 与已有列合并。现有的精度类测试（aber_accuracy / benchmark_morphologies）
断言的是「偏差在容差内」，重构时一处边界条件的等价改写就能让某列边界挪 1~2 px 而全部绿。

所以这里钉**逐列几何**：同一张真实图版 + 同一组 bounds，列数、每列 name / startX / endX /
roi_id / visible 必须完全相同（round 6 位）。

重新生成（仅在有意义地改分列算法时）：

    UPDATE_DETECT_GOLDEN=1 .pixi/envs/default/python.exe -m pytest \
        tests/unit/test_detect_columns_golden.py
"""

import json
import os
from pathlib import Path

import pytest

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
GOLDEN = Path(__file__).parent / "fixtures" / "detect_columns_golden.json"

CASES: dict[str, dict[str, list[int]]] = {
    "roi_full": {"xlim": [330, 1330], "ylim": [233, 869]},
    "narrow": {"xlim": [400, 1200], "ylim": [300, 800]},
}


def _snapshot(xlim: list[int], ylim: list[int]) -> dict:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session._init_rois()
    session.roi_create(
        name="pollen", x0=xlim[0], x1=xlim[1], y0=ylim[0], y1=ylim[1], composition=True
    )
    cols = session.detect_columns(data_xlim=list(xlim), data_ylim=list(ylim))
    return {
        "count": len(cols),
        "data_xlim": [round(float(v), 6) for v in session.data_xlim],
        "data_ylim": [round(float(v), 6) for v in session.data_ylim],
        # 注意键名是 start / end：startX / endX 是 RPC 载荷层的映射，
        # 在会话内部对象上读取它们会全部落进默认值 0.0，基线就成了空的。
        "columns": [
            {
                "id": c.get("id"),
                "col_index": c.get("col_index"),
                "start": round(float(c.get("start", 0.0)), 6),
                "end": round(float(c.get("end", 0.0)), 6),
                "tickEndX": round(float(c.get("tickEndX", 0.0)), 6),
                "zero_point_measurable": bool(c.get("zero_point_measurable", False)),
                "roi_id": c.get("roi_id"),
                "scale_type": c.get("scale_type"),
                "tickValue": c.get("tickValue"),
            }
            for c in cols
        ],
    }


def test_detect_columns_snapshot_is_stable() -> None:
    """同图同 bounds → 列数与每列几何逐项不变。"""
    snapshot = {
        name: _snapshot(case["xlim"], case["ylim"]) for name, case in CASES.items()
    }

    if os.environ.get("UPDATE_DETECT_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_DETECT_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys()
    for case in expected:
        assert snapshot[case]["count"] == expected[case]["count"], (
            f"{case} 的列数变了：{snapshot[case]['count']} vs {expected[case]['count']}"
        )
        assert snapshot[case]["data_xlim"] == expected[case]["data_xlim"], (
            f"{case} 的 data_xlim 变了"
        )
        assert snapshot[case]["data_ylim"] == expected[case]["data_ylim"], (
            f"{case} 的 data_ylim 变了"
        )
        assert snapshot[case]["columns"] == expected[case]["columns"], (
            f"{case} 的列几何变了：\n{snapshot[case]['columns']}\nvs\n{expected[case]['columns']}"
        )
