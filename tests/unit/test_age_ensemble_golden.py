# -*- coding: utf-8 -*-
"""`generate_age_ensemble` 的输出快照（重构前行为基线）。

## 为什么需要它

`test_age_ensemble.py` 的九条测试钉的是**性质**：单调、中位数跟随、包络量级、对重采样步长
不变、相关长度真被施加……这些容差内的判据恰好容忍"一次看起来等价的改写"让整条曲线挪几百
年——重构时它们会全绿，而用户拿到的是另一套年代。

## 钉的是什么

固定种子（42）与固定算力参数，两个模型形状各跑一次，输出必须**逐个数字相同**：

1. `linear_100`：等宽包络的线性序列，拟合选中 L=2.5（`span/40` 这条比例候选）；
2. `long_300`：300 深度单位、宽包络，拟合选中 L=15.0（`span/20`）。

**已实测的判别力边界（写在这里，免得下一个人误以为覆盖了更多）**：两个形状的最优点都落在
「比例候选」上，所以把梯度里的 `seed * 0.4` 改成 `seed * 0.45`，本基线**照样绿**——
`infer_correlation_length` 与种子派生候选这一段**没有**被本文件判别。要覆盖它需要造一个
最优解落在 seed 派生候选上的模型形状（本轮试过 n_fit_members=40 时会选到 L=24，
但换成基线用的 60 就回到 15.0），属于另一条独立任务。

矩阵本身存摘要（64×N 塞进 fixture 不划算），另单独钉诊断块：相关长度、包络失配、
共享偏移、反转率、速率分位——这些是参数拟合的产物，比矩阵更容易被悄悄改掉。

## 重新生成

    UPDATE_ENSEMBLE_GOLDEN=1 pixi run python -m pytest tests/unit/test_age_ensemble_golden.py
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from straditize_core.age_depth_model import AgeDepthModel

GOLDEN = Path(__file__).parent / "fixtures" / "age_ensemble_golden.json"

SAMPLE_DEPTHS = [10.0, 30.0, 50.0, 70.0, 90.0]
ENSEMBLE_OPTIONS = {
    "n_ensembles": 64,
    "n_fit_members": 60,
    "fit_iterations": 3,
    "name": "Age_Ensemble_64",
}

CASES = {
    "linear_100": {
        "depths": [0.0, 20.0, 40.0, 60.0, 80.0, 100.0],
        "ages": [0.0, 180.0, 400.0, 640.0, 820.0, 1000.0],
        "halfwidth": [60.0] * 6,
        "sample_depths": SAMPLE_DEPTHS,
    },
    "long_300": {
        "depths": [0.0, 50.0, 100.0, 150.0, 200.0, 250.0, 300.0],
        "ages": [0.0, 400.0, 900.0, 1500.0, 2100.0, 2600.0, 3100.0],
        "halfwidth": [120.0] * 7,
        "sample_depths": [30.0, 90.0, 150.0, 210.0, 270.0],
    },
}


def _model(case: dict) -> AgeDepthModel:
    ages = case["ages"]
    half = case["halfwidth"]
    return AgeDepthModel(
        depths=case["depths"],
        ages=ages,
        age_min=[a - h for a, h in zip(ages, half)],
        age_max=[a + h for a, h in zip(ages, half)],
        curve_type="median",
        envelope_type="95_hpd",
        depth_unit="cm",
        age_unit="cal BP",
        cal_curve="IntCal20",
        notes="",
    )


def _digest(payload) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]


def _case_snapshot(case: dict) -> dict:
    result = _model(case).generate_age_ensemble(
        case["sample_depths"], return_diagnostics=True, **ENSEMBLE_OPTIONS
    )
    rows = result["data"]
    matrix = [row[1:] for row in rows]
    return {
        "columns": result["columns"],
        "row_count": len(rows),
        "member_count": len(result["columns"]) - 1,
        "depths_first_col": [row[0] for row in rows],
        "matrix_digest": _digest(matrix),
        "matrix_head": matrix[0][:4],
        "matrix_tail": matrix[-1][-4:],
        "diagnostics": result["diagnostics"],
    }


def _snapshot() -> dict:
    return {name: _case_snapshot(case) for name, case in CASES.items()}


def test_age_ensemble_snapshot_is_stable() -> None:
    snapshot = _snapshot()

    if os.environ.get("UPDATE_ENSEMBLE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_ENSEMBLE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        actual, want = snapshot[case], expected[case]
        for key in ("columns", "row_count", "member_count", "depths_first_col"):
            assert actual[key] == want[key], f"[{case}] {key} 变了"
        assert actual["matrix_digest"] == want["matrix_digest"], (
            f"[{case}] 集成矩阵变了（逐数字不等）。诊断：\nactual   = "
            f"{json.dumps(actual['diagnostics'], ensure_ascii=False, sort_keys=True)}\n"
            f"expected = {json.dumps(want['diagnostics'], ensure_ascii=False, sort_keys=True)}"
        )
        assert actual["diagnostics"] == want["diagnostics"], f"[{case}] 诊断块变了"
