# -*- coding: utf-8 -*-
"""sample_grid 在 age 轴下必须反演，两个非 extraction 调用点也不例外（#81 补修）。

`sample_depths_for_model` 修好之后，另有两处直接把 `self.depth_grid` 当深度使用：

* `generate_age_ensemble()`（session 方法）的 ``elif self.depth_grid`` 分支；
* `run_local_bacon()` 的 ``if self.depth_grid`` 分支（并写死 ``primary_axis="depth"``）。

两处都是同一个错：age 轴下网格存的是年代，喂给年龄模型前必须先反演。本文件同时锁住
"depth 轴完全不变"与"ensemble 仍覆盖全量 horizon（不经抽稀分支）"。

判据用 10 倍差异：正确反演得 [0, 2, 4]，误用得 [0, 20, 40]，不存在混淆空间。
"""
from __future__ import annotations

import numpy as np
import pytest

from straditize_core.age_depth import AgeDepthModel
from straditize_core.session import StraditizeSession

#: 模型 depth 0..100 cm，age = depth * 10 → 0..1000，严格线性便于精确反查。
MODEL_DEPTHS = [float(d) for d in range(0, 101, 10)]
MODEL_AGES = [d * 10.0 for d in MODEL_DEPTHS]


def _linear_model() -> AgeDepthModel:
    ages = np.asarray(MODEL_AGES, dtype=float)
    return AgeDepthModel(
        depths=np.asarray(MODEL_DEPTHS, dtype=float),
        ages=ages,
        age_min=ages - 20.0,
        age_max=ages + 20.0,
    )


def _session(primary_axis: str, depth_grid: list[float]) -> StraditizeSession:
    session = StraditizeSession()
    session.primary_axis = primary_axis
    session.is_calibrated = True
    session.y_scale = {"slope": -1.0, "intercept": 1000.0}
    session.column_points = {}
    session.depth_grid = list(depth_grid)
    session.age_depth_model = _linear_model()
    return session


class _RecordingEnsemble:
    """替换 ``AgeDepthModel.generate_age_ensemble``：只记录收到的 horizon。

    以实例形式挂到类属性上，不做 descriptor 绑定，所以签名与调用点一样是纯关键字。
    记录的是原始对象而非拷贝，便于断言"原样传入"。
    """

    def __init__(self) -> None:
        self.sample_depths = None

    def __call__(self, *args, **kwargs):
        self.sample_depths = kwargs.get(
            "sample_depths", args[0] if args else None
        )
        return {
            "name": kwargs.get("name") or "Age_Ensemble",
            "columns": ["depth", "age", "age_min", "age_max", "rate"],
            "data": [],
        }


@pytest.fixture()
def recording_ensemble(monkeypatch):
    recorder = _RecordingEnsemble()
    monkeypatch.setattr(AgeDepthModel, "generate_age_ensemble", recorder)
    return recorder


# ------------------------------------------------------- session.generate_age_ensemble


def test_ensemble_grid_under_age_axis_is_inverted(recording_ensemble):
    """age 轴：网格值（年代）必须先反演成深度再交给 ensemble。"""
    session = _session("age", [0.0, 20.0, 40.0])

    session.generate_age_ensemble(n_ensembles=10)

    assert recording_ensemble.sample_depths == pytest.approx([0.0, 2.0, 4.0])


def test_ensemble_grid_under_depth_axis_is_unchanged(recording_ensemble):
    """depth 轴：网格原样传入，不做任何换算。"""
    grid = [0.0, 20.0, 40.0]
    session = _session("depth", grid)

    session.generate_age_ensemble(n_ensembles=10)

    assert recording_ensemble.sample_depths == grid


def test_ensemble_fallback_still_covers_every_horizon(recording_ensemble):
    """无 Y 读数、无网格时仍取模型全部 horizon（不得退化成抽稀分支）。"""
    session = _session("age", [])
    session.depth_grid = []

    session.generate_age_ensemble(n_ensembles=10)

    assert recording_ensemble.sample_depths == MODEL_DEPTHS


# ------------------------------------------------------------------ run_local_bacon


def _fake_bacon(**_kwargs):
    return {
        "success": True,
        "depths": list(MODEL_DEPTHS),
        "ages": list(MODEL_AGES),
        "age_min": [a - 20.0 for a in MODEL_AGES],
        "age_max": [a + 20.0 for a in MODEL_AGES],
    }


@pytest.fixture()
def stub_bacon(monkeypatch):
    monkeypatch.setattr(
        "straditize_core.session_parts.agedepth.run_local_bacon_func", _fake_bacon
    )


def test_bacon_grid_under_age_axis_is_inverted_and_honest(stub_bacon, recording_ensemble):
    """age 轴：Bacon 路径同样反演，并把 primary_axis 如实写成 age。

    predict_age(反演深度) 回到 [0, 20, 40]；若误把网格当深度会得到 [0, 200, 400]。
    """
    session = _session("age", [0.0, 20.0, 40.0])

    res = session.run_local_bacon(dates=[{"depth": 10.0, "age": 100.0}])

    provenance = res["mapped_samples"]["depth_provenance"]
    assert provenance["primary_axis"] == "age"
    assert "inverted" in provenance["depth_source"]
    assert res["mapped_samples"]["age_est"] == pytest.approx([0.0, 20.0, 40.0])
    assert recording_ensemble.sample_depths == pytest.approx([0.0, 2.0, 4.0])


def test_bacon_grid_under_depth_axis_is_unchanged(stub_bacon, recording_ensemble):
    """depth 轴：网格直通，provenance 与历史字符串逐字一致。"""
    session = _session("depth", [0.0, 20.0, 40.0])

    res = session.run_local_bacon(dates=[{"depth": 10.0, "age": 100.0}])

    assert res["mapped_samples"]["depth_provenance"] == {
        "primary_axis": "depth",
        "depth_source": "explicit depth grid",
    }
    assert res["mapped_samples"]["age_est"] == pytest.approx([0.0, 200.0, 400.0])
    assert recording_ensemble.sample_depths == [0.0, 20.0, 40.0]


def test_bacon_without_grid_or_points_keeps_empty_provenance(
    stub_bacon, recording_ensemble
):
    """无网格、无 Y 读数时不编造样品位置，provenance 仍写 none。"""
    session = _session("age", [])
    session.depth_grid = []

    res = session.run_local_bacon(dates=[{"depth": 10.0, "age": 100.0}])

    assert res["mapped_samples"] is None
    assert res["success"] is True
    assert recording_ensemble.sample_depths is None
