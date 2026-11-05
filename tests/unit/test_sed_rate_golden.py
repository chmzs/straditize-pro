# -*- coding: utf-8 -*-
"""`estimate_sedimentation_rate` 返回值的逐字段基线（重构前）。

## 为什么需要它

这个函数是**纯算术 + 一串状态码**：窗口厚度搜索、OLS 斜率、包络误差、单位换算（ka 与 a 差
1000 倍）、以及"算不出来就给 None + 理由"的 status。现有没有任何测试逐字段钉住它——
`test_metric_sanity` 之类只断言量级合理，容差内的改写能让整列速率悄悄变一倍
（`age_scale_inferred` 判错就正好差 1000 倍）而无人报警。

## 钉的是什么

两个模型 × 两条调用路径：

| 案例 | 模型 | 调用 | 期望走到的分支 |
| :--- | :--- | :--- | :--- |
| `wide_auto` | 宽包络 | `window=None` | 搜索**跑满**仍不达标 → 退到厚度上限 |
| `wide_fixed` | 宽包络 | `window=15.0` | 固定厚度 |
| `tight_auto` | 窄包络 | `window=None` | 搜索**首步即达标** → 停在下限 |
| `tight_fixed` | 窄包络 | `window=15.0` | 固定厚度 |

两个模型缺一个，搜索循环就有一半没被钉住：只用宽包络时上限/下限恰好相等，搜索恒等于常数；
只用窄包络时 `while/else` 的兜底分支永远走不到。层位刻意做成
「2cm 间距 × 100cm 跨度」，使 `min_thickness = 3*中位间距 = 6` 与
`max_thickness = 20% 跨度 = 20` 确实不同。

## 重新生成

    UPDATE_SED_RATE_GOLDEN=1 pixi run python -m pytest tests/unit/test_sed_rate_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from straditize_core.age_depth_model import AgeDepthModel

GOLDEN = Path(__file__).parent / "fixtures" / "sed_rate_golden.json"

DEPTHS = [float(d) for d in range(0, 101, 2)]
AGES = [round(0.0004 * d**2 + 6.5 * d, 4) for d in DEPTHS]
TARGETS = [10.0, 30.0, 50.0, 70.0, 90.0]

MODELS = {
    "wide": [35.0 + 0.6 * d for d in DEPTHS],
    "tight": [1.0 for _ in DEPTHS],
}


def _model(half: list[float]) -> AgeDepthModel:
    return AgeDepthModel(
        depths=DEPTHS,
        ages=AGES,
        age_min=[a - h for a, h in zip(AGES, half)],
        age_max=[a + h for a, h in zip(AGES, half)],
        curve_type="median",
        envelope_type="95_hpd",
        depth_unit="cm",
        age_unit="cal BP",
        cal_curve="IntCal20",
        notes="",
    )


def _snapshot() -> dict:
    out = {}
    for name, half in MODELS.items():
        out[f"{name}_auto"] = _model(half).estimate_sedimentation_rate(TARGETS)
        out[f"{name}_fixed"] = _model(half).estimate_sedimentation_rate(
            TARGETS, window=15.0
        )
    return out


def _normalise(value):
    if isinstance(value, dict):
        return {k: _normalise(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [_normalise(v) for v in value]
    if isinstance(value, float):
        return round(value, 10)
    return value


def test_sedimentation_rate_snapshot_is_stable() -> None:
    snapshot = _normalise(_snapshot())

    if os.environ.get("UPDATE_SED_RATE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_SED_RATE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        for key in expected[case]:
            assert snapshot[case][key] == expected[case][key], (
                f"[{case}] {key} 变了：\nactual   = "
                f"{json.dumps(snapshot[case][key], ensure_ascii=False)}\n"
                f"expected = {json.dumps(expected[case][key], ensure_ascii=False)}"
            )
