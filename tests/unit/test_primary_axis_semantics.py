# -*- coding: utf-8 -*-
"""Y 轴语义：主轴是深度还是年代，必须由用户声明，且两条路径产出不同的深度。

背景：花粉图谱的 Y 轴通常测深度，但有些文献直接按年代作图。此时 Y 读数是年龄，
样品深度只能由年代-深度模型反查。若把年龄读数当成深度使用，整根岩芯的样品会被
放到"看起来合理但错误"的位置，且没有任何报错可察觉 —— 所以主轴必须声明，不能由
单位字符串猜测（`cm`/`cal BP` 只覆盖常规写法）。

本文件的判据都是**两值差异显著**的形式：反查值与被误用值相差一个数量级，任何
一侧走错都会立刻变红，不存在"看起来差不多"的假绿。
"""
from __future__ import annotations

import unittest

import numpy as np

from straditize_core.age_depth import AgeDepthModel
from straditize_core.protocol import INVALID_PARAMS, JsonRpcError
from straditize_core.session import StraditizeSession


def _linear_model() -> AgeDepthModel:
    """depth 0..100 cm, age = depth * 10 → 0..1000 yr，严格线性便于精确反查。"""
    depths = np.arange(0.0, 101.0, 10.0)
    ages = depths * 10.0
    return AgeDepthModel(
        depths=depths,
        ages=ages,
        age_min=ages - 20.0,
        age_max=ages + 20.0,
    )


class TestPrimaryAxisCalibration(unittest.TestCase):
    def _session(self) -> StraditizeSession:
        session = StraditizeSession()
        # y_scale: reading = pixel * 1 + 0，于是"Y 读数"就等于我们给的 row 值。
        session.calibrate_axes([{"pixel": 0.0, "val": 0.0}, {"pixel": 1000.0, "val": 1000.0}])
        # 4 个样品层位，Row 值即 Y 轴读数（下面按主轴语义分别解释）。
        session.column_points = {0: [{"row": r, "x": 10} for r in (0.0, 250.0, 500.0, 750.0)]}
        session.age_depth_model = _linear_model()
        return session

    def test_default_axis_is_depth_and_unchanged(self):
        """默认（depth）时 Y 读数即深度，与历史行为一致。"""
        session = self._session()
        self.assertEqual(session.primary_axis, "depth")
        depths, provenance = session.sample_depths_for_model(session.age_depth_model)
        self.assertEqual(depths, [0.0, 250.0, 500.0, 750.0])
        self.assertEqual(provenance["primary_axis"], "depth")

    def test_age_axis_inverts_the_model_for_depths(self):
        """Y=年代时，深度必须是反查值（age/10），不是读数本身。

        被误用时会得到 [0, 250, 500, 750]，正确值为 [0, 25, 50, 75]——相差 10 倍，
        不存在混淆空间。
        """
        session = self._session()
        session.calibrate_axes(
            [{"pixel": 0.0, "val": 0.0}, {"pixel": 1000.0, "val": 1000.0}],
            primary_axis="age",
        )
        self.assertEqual(session.primary_axis, "age")
        depths, provenance = session.sample_depths_for_model(session.age_depth_model)
        np.testing.assert_allclose(depths, [0.0, 25.0, 50.0, 75.0], atol=0.5)
        self.assertEqual(provenance["primary_axis"], "age")
        # 4 个点全落在模型实测年龄范围内，不应有外推
        self.assertEqual(provenance["inverse_extrapolated_count"], 0)
        self.assertEqual(provenance["observed_age_range"], [0.0, 1000.0])

    def test_age_axis_flags_out_of_range_samples(self):
        """超出实测年龄范围的样品必须被计数，而不是悄悄给出外推深度。"""
        session = self._session()
        session.calibrate_axes(
            [{"pixel": 0.0, "val": 0.0}, {"pixel": 1000.0, "val": 1000.0}],
            primary_axis="age",
        )
        # 2000 与 3000 都超出模型年龄上限 1000
        session.column_points = {0: [{"row": 100.0, "x": 10}, {"row": 2000.0, "x": 10}]}
        _depths, provenance = session.sample_depths_for_model(session.age_depth_model)
        self.assertEqual(provenance["inverse_extrapolated_count"], 1)

    def test_axis_choice_is_echoed_by_the_backend(self):
        """回显的是后端生效值，调用方据此确认请求真的被接受。"""
        session = StraditizeSession()
        res = session.calibrate_axes(
            [{"pixel": 0.0, "val": 0.0}, {"pixel": 10.0, "val": 100.0}],
            primary_axis="age",
        )
        self.assertEqual(res["primary_axis"], "age")
        res2 = session.calibrate_axes(
            [{"pixel": 0.0, "val": 0.0}, {"pixel": 10.0, "val": 100.0}]
        )
        # 省略参数时保持上一次的语义，而不是静默回落到 depth
        self.assertEqual(res2["primary_axis"], "age")

    def test_invalid_axis_is_refused(self):
        """非法主轴必须报错，不接受"猜一个"的回退。"""
        session = StraditizeSession()
        with self.assertRaises(JsonRpcError) as ctx:
            session.calibrate_axes(
                [{"pixel": 0.0, "val": 0.0}, {"pixel": 10.0, "val": 100.0}],
                primary_axis="depth_or_age",
            )
        self.assertEqual(ctx.exception.code, INVALID_PARAMS)
        self.assertIn("primary_axis", str(ctx.exception))

    def test_age_axis_without_model_is_refused(self):
        """声明了 Y=年代却没有 A/D 模型可反查时，必须报错而非返回读数。"""
        session = self._session()
        session.calibrate_axes(
            [{"pixel": 0.0, "val": 0.0}, {"pixel": 1000.0, "val": 1000.0}],
            primary_axis="age",
        )
        with self.assertRaises(JsonRpcError):
            session.sample_depths_for_model(None)


if __name__ == "__main__":
    unittest.main()
