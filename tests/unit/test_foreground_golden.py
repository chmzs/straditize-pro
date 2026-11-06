# -*- coding: utf-8 -*-
"""`extract_foreground` 的结果与副作用快照（重构前基线）。

## 为什么需要它

这个函数决定**什么算墨**——后面所有读数都建在这张掩膜上。它的分支由两个独立维度交叉：
`mode` 决定阈值怎么取（otsu / binary / adaptive），
`extraction_mode` 决定什么算墨（standard / 三种单层彩色 / 双层 solid-over-shadow）。
现有测试要么只测合成图上的 `build_foreground`（绕过了本函数的接线），
要么只断言掩膜"尺寸对"——历史上正是因为测试绕过接线，
`colour_path` 常量写错导致双层路径**一次都没被调用过**而无人发现。

所以这里钉**真实图版上的输出**：四个模式组合 + 三个 extraction_mode + 带/不带 column_edges，
钉返回字典、掩膜摘要、阈值、以及写回会话的那五个字段（含 shadow_mask / solid_layers /
two_layer_report）。

## 重新生成

    UPDATE_FOREGROUND_GOLDEN=1 pixi run python -m pytest tests/unit/test_foreground_golden.py
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "foreground_golden.json"

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
COLUMN_EDGES = [400, 700, 1000, 1300]

CASES = {
    "otsu_standard": {"mode": "otsu", "extraction_mode": "standard"},
    "binary_120_standard": {"mode": "binary", "threshold": 120.0},
    "adaptive_standard": {"mode": "adaptive", "extraction_mode": "standard"},
    "otsu_light_overlay_white": {
        "mode": "otsu",
        "extraction_mode": "light-overlay-white",
    },
    "otsu_dark_ink_light": {"mode": "otsu", "extraction_mode": "dark-ink-light"},
    "otsu_standard_with_edges": {
        "mode": "otsu",
        "extraction_mode": "standard",
        "column_edges": COLUMN_EDGES,
    },
    "otsu_solid_over_shadow": {
        "mode": "otsu",
        "extraction_mode": "solid-over-shadow",
        "column_edges": COLUMN_EDGES,
    },
}


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    return session


def _digest(mask) -> str | None:
    if mask is None:
        return None
    return hashlib.sha256(np.asarray(mask, dtype=bool).tobytes()).hexdigest()[:16]


def _case_snapshot(options: dict) -> dict:
    session = _session()
    try:
        result = session.extract_foreground(**options)
    except JsonRpcError as error:
        # 拒绝产出掩膜本身就是要钉的行为（双层分离不可信时宁可报错）。
        return {"raised": {"code": error.code, "message": str(error.message)}}
    shadow = getattr(session, "shadow_mask", None)
    report = getattr(session, "two_layer_report", None)
    return {
        "result": {
            key: (round(value, 6) if isinstance(value, float) else value)
            for key, value in sorted(result.items())
        },
        "state": {
            "threshold": round(float(session.threshold), 6),
            "segmentation_mode": session.segmentation_mode,
            "extraction_mode": session.extraction_mode,
            "foreground_column_edges": session.foreground_column_edges,
            "foreground_mask_digest": _digest(session.foreground_mask),
            "foreground_mask_pixels": int(np.sum(session.foreground_mask)),
            "shadow_mask_pixels": int(shadow.sum()) if shadow is not None else None,
            "solid_layers": getattr(session, "solid_layers", None),
            "two_layer_report": report,
        },
    }


def _collect() -> dict:
    return {name: _case_snapshot(options) for name, options in CASES.items()}


def test_foreground_snapshot_is_stable() -> None:
    snapshot = _collect()

    if os.environ.get("UPDATE_FOREGROUND_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_FOREGROUND_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        # 整个案例一起比对：有的案例是「正常产出」（result/state），
        # 有的是「拒绝产出」（raised），按组比对会漏掉后者。
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:1800]}\n"
            f"expected = "
            f"{json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:1800]}"
        )
