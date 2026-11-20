# -*- coding: utf-8 -*-
"""sample_grid 分支必须与 Y 读数分支同口径读 ``primary_axis``（#81）。

缺陷现场：`sample_depths_for_model` 有三个来源分支，只有 Y 读数分支检查主轴。当
Y 轴声明为年代（``primary_axis="age"``）且样品来自 ``fromGrid`` 生成的 sample_grid 时，
网格里的 ka 值被直接当成 cm 深度交给年龄模型 —— 定位全错，且 ``meta`` 还把它标成
``primary_axis="depth"``，等于向后端使用者谎报数据来源。

本文件同时锁定修复后的分支 ①／③ 行为，防止为修 ② 而改动其他分支。
"""

from __future__ import annotations

import numpy as np
import pytest

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


class FakeModel:
    """最小年龄模型：depth = age * 10 + 100，与网格值相差一个数量级，走错必红。"""

    depth_unit = "cm"

    def __init__(self) -> None:
        self.called = False
        self.received: list[float] | None = None

    def predict_depth(self, ages):
        self.called = True
        self.received = [float(a) for a in ages]
        return {
            "depth_est": [float(a) * 10.0 + 100.0 for a in ages],
            "extrapolated": [False] * len(ages),
            "observed_age_range": (0.0, 12.0),
        }


class FakeHorizonModel:
    """只提供 ``depths`` 的模型，用于锁定分支 ③（模型自身 horizon 抽样）。"""

    def __init__(self, n: int = 100) -> None:
        self.depths = np.arange(0.0, float(n), 1.0)

    def predict_depth(self, ages):  # pragma: no cover - 该分支不应被调用
        raise AssertionError("branch 3 must not invert the model")


def _session(primary_axis: str = "age") -> StraditizeSession:
    """主轴已声明、已标定，sample_grid 为 fromGrid(step=2) 的 ka 值。"""
    session = StraditizeSession()
    session.primary_axis = primary_axis
    session.is_calibrated = True
    session.y_scale = {"slope": -1.0, "intercept": 1000.0}
    session.depth_grid = [0.0, 2.0, 4.0]
    session.column_points = {}  # 空 → 强制走 sample_grid 分支
    return session


# --------------------------------------------------------------------------- 分支 ②


def test_sample_grid_under_age_axis_is_inverted():
    """Y=年代时网格值是年龄，深度必须来自模型反演，且 meta 如实回显。"""
    session = _session("age")
    model = FakeModel()

    depths, meta = session.sample_depths_for_model(model)

    assert model.called, "sample_grid 分支必须反查模型，不能直通"
    assert model.received == [0.0, 2.0, 4.0]
    assert depths == [100.0, 120.0, 140.0]  # 反演值，而非直通的 [0, 2, 4]
    assert meta["primary_axis"] == "age"
    assert "inverted" in meta["depth_source"]
    assert meta["inverse_extrapolated_count"] == 0


def test_sample_grid_under_age_axis_without_model_raises():
    """声明了年龄轴却没有模型可反查：报 STATE_ERROR，不得退回"当作深度"。"""
    session = _session("age")

    with pytest.raises(JsonRpcError) as ctx:
        session.sample_depths_for_model(None)

    assert ctx.value.code == STATE_ERROR
    assert "no age-depth model" in str(ctx.value)


def test_sample_grid_under_depth_axis_is_unchanged():
    """主轴为 depth 时保持历史行为：直通，不调模型，meta 写 depth。"""
    session = _session("depth")
    model = FakeModel()

    depths, meta = session.sample_depths_for_model(model)

    assert not model.called
    assert depths == [0.0, 2.0, 4.0]
    assert meta == {"primary_axis": "depth", "depth_source": "explicit depth grid"}


def test_sample_grid_under_depth_axis_ignores_missing_model():
    """depth 轴不需要模型，缺模型也不能报错。"""
    session = _session("depth")

    depths, meta = session.sample_depths_for_model(None)

    assert depths == [0.0, 2.0, 4.0]
    assert meta["primary_axis"] == "depth"


# --------------------------------------------------------------------------- 分支 ①


def test_y_readings_under_age_axis_still_invert():
    """分支 ① 回归：Y 读数按年龄反查，y_scale 全量参与。"""
    session = _session("age")
    session.depth_grid = []
    session.column_points = {0: [{"row": 100.0, "x": 10}]}
    model = FakeModel()

    depths, meta = session.sample_depths_for_model(model)

    assert model.called and model.received == [900.0]
    assert depths == [9100.0]
    assert meta["primary_axis"] == "age"
    assert meta["depth_source"] == "Y axis read as age; depths inverted from the model"


def test_y_readings_under_age_axis_without_model_raises():
    """分支 ① 回归：无模型同样报 STATE_ERROR。"""
    session = _session("age")
    session.depth_grid = []
    session.column_points = {0: [{"row": 100.0, "x": 10}]}

    with pytest.raises(JsonRpcError) as ctx:
        session.sample_depths_for_model(None)

    assert ctx.value.code == STATE_ERROR


def test_y_readings_under_depth_axis_still_pass_through():
    """分支 ① 回归：depth 轴时读数即深度。"""
    session = _session("depth")
    session.depth_grid = []
    session.column_points = {0: [{"row": 0.0, "x": 10}, {"row": 25.0, "x": 10}]}
    model = FakeModel()

    depths, meta = session.sample_depths_for_model(model)

    assert not model.called
    assert depths == [1000.0, 975.0]  # slope=-1, intercept=1000
    assert meta == {"primary_axis": "depth", "depth_source": "Y axis read as depth"}


# --------------------------------------------------------------------------- 分支 ③


def test_model_horizons_are_thinned_unchanged():
    """分支 ③ 回归：无 Y 读数、无网格时抽稀模型 horizon，且不做反演。"""
    session = _session("age")
    session.depth_grid = []
    session.column_points = {}
    model = FakeHorizonModel(n=100)

    depths, meta = session.sample_depths_for_model(model)

    # step_stride = 100 // 30 = 3 → 每 3 个取一个
    assert depths == [float(d) for d in range(0, 100, 3)]
    assert meta == {"primary_axis": "depth", "depth_source": "thinned model horizons"}


def test_no_source_returns_empty():
    """无任何来源时返回空表，不编造样品位置。"""
    session = _session("age")
    session.depth_grid = []
    session.column_points = {}

    depths, meta = session.sample_depths_for_model(None)

    assert depths == []
    assert meta == {"primary_axis": "depth", "depth_source": "none"}
