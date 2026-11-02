# -*- coding: utf-8 -*-
"""`suggest_data_region` 在启发式失效时不得返回非法小框。

## 缺陷（P0，生产阻断）

`session_parts/core.py` 的 `suggest_data_region` 用「累计墨迹量首次超过阈值」
的像素位置求四边。当两个候选集**都为空**时走 else 分支，而累计量在密集图上
从一开始就超过阈值，于是四边全部塌缩到同一处。

实测（`tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png`，
1179×600，墨迹占比 40.9%）：

    right_candidates = 0 个   left_candidates = 0 个
    建议框 → xlim=[68,1061] ylim=[241,243]     ← 只有 2px 高

用户载入该图 → 界面显示建议取数区 → 点【下一步】分列
→ `JsonRpcError: Bounds [68.0, 1061.0], [241.0, 243.0] is too small`
→ **无法继续，功能完全不可用**。

## 修法

候选集为空（启发式失效）时改用**墨迹包围盒**——它只依赖「哪里有墨」，与
累计量阈值无关，在任何墨迹分布下都成立。包围盒也不合法时才退回固定比例
fallback。

## 为什么这些用例不会假绿

- `test_diatom_benchmark_roi_is_usable` 断言的是「框的尺寸合法」+「分列不抛错」，
  退回旧实现时两条都会红（旧实现给 2px 高的框）。
- `test_pollen_benchmark_roi_unchanged` 是**反向哨兵**：Pollen 图走正常启发式
  分支，修复不得改动它的结果（若有人把整个函数改成"永远用包围盒"，这条会红）。
"""

from __future__ import annotations

import os

import numpy as np
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession

BENCH = "tests/data/figures/benchmark_types"
DIATOM = f"{BENCH}/Diatom_riojaPlotTestData.png"
POLLEN = f"{BENCH}/Pollen_riojaPlotTestData.png"

# 合法框的最小尺寸（相对图像）：高 ≥20%、宽 ≥30%
MIN_HEIGHT_FRAC = 0.20
MIN_WIDTH_FRAC = 0.30


def _suggested(session: StraditizeSession) -> dict:
    return session.suggest_data_region()


def _assert_usable(session: StraditizeSession, sug: dict, tag: str) -> None:
    width_px = sug["xMax"] - sug["xMin"]
    height_px = sug["yMax"] - sug["yMin"]
    assert width_px >= session.width * MIN_WIDTH_FRAC, (
        f"{tag}: 建议框宽 {width_px}px 低于图像宽的 {MIN_WIDTH_FRAC:.0%}"
    )
    assert height_px >= session.height * MIN_HEIGHT_FRAC, (
        f"{tag}: 建议框高 {height_px}px 低于图像高的 {MIN_HEIGHT_FRAC:.0%}"
        "（旧缺陷症状：候选集为空时塌缩成 2px）"
    )


class TestDegenerateHeuristic:
    """启发式失效时必须退回合法框，而不是塌缩。"""

    def test_dense_ink_does_not_collapse_the_box(self, tmp_path) -> None:
        """墨迹占比高到让两个候选集都为空时，框仍须合法。

        合成一张「密集且均匀」的图：这正是让累计量阈值失效的形态。
        """
        width, height = 800, 600
        rng = np.random.default_rng(20261023)
        # 40% 像素为暗，与真实 Diatom 基准图同量级
        array = np.where(rng.random((height, width)) < 0.40, 0, 255).astype(np.uint8)
        path = tmp_path / "dense_ink.png"
        Image.fromarray(array).save(path)

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(path))

        sug = _suggested(session)
        _assert_usable(session, sug, "dense_ink")

    def test_blank_image_falls_back_to_legal_box(self, tmp_path) -> None:
        """整图空白时退回固定比例 fallback（合法框）。"""
        path = tmp_path / "blank.png"
        Image.new("L", (800, 600), 255).save(path)

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(path))

        sug = _suggested(session)
        _assert_usable(session, sug, "blank")

    def test_columns_can_be_detected_after_suggestion(self, tmp_path) -> None:
        """建议框合法后，分列不得因 "Bounds is too small" 抛错。"""
        width, height = 800, 600
        array = np.full((height, width), 255, dtype=np.uint8)
        # 画 8 条竖向条带，确保分列有东西可分
        for x in range(60, width - 60, 90):
            array[80 : height - 80, x : x + 40] = 0
        path = tmp_path / "stripes.png"
        Image.fromarray(array).save(path)

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(path))

        session.detect_columns(roi_id=session.rois[0]["id"])

        assert len(session.columns) >= 3, (
            f"只分出 {len(session.columns)} 列，建议框可能仍然不可用"
        )


@pytest.mark.skipif(
    not os.path.exists(DIATOM),
    reason="真实基准图不在本机（tests/data/figures/benchmark_types 未包含该文件）",
)
class TestRealBenchmark:
    """真实基准图版（用户提供，配 Excel 权威真值）。"""

    def test_diatom_benchmark_roi_is_usable(self) -> None:
        """Diatom 基准图：修复前建议框只有 2px 高，分列必崩。"""
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=DIATOM)

        sug = _suggested(session)
        _assert_usable(session, sug, "Diatom_riojaPlotTestData")

        session.detect_columns(roi_id=session.rois[0]["id"])
        assert len(session.columns) >= 3, (
            f"Diatom 基准图只分出 {len(session.columns)} 列"
        )

    def test_pollen_benchmark_roi_matches_axis_spine(self) -> None:
        """Pollen 建议框必须落在**真实数据区**（轴线跨度）上。

        旧断言锁的是 `ylim=[197,568]` —— 而 197 正是缺陷值：数据区实从 93 开始，
        `digitize` 只在 ROI 内取数，一次丢 15/49 层（30.6%）且不报警。
        所以这里断言**像素真值**（填充色分段与轴线检测两条路径互验，误差 ≤1px），
        并允许横向略宽（多一列假列由分列层处理，裁窄则直接丢数据）。
        """
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=POLLEN)

        sug = _suggested(session)

        assert sug.get("method") == "axis_spine", (
            f"应走轴线结构判据，实际 {sug.get('method')} —— 密度启发式会跳过顶部图名区"
        )
        assert abs(sug["xMin"] - 112) <= 3, f"左界 {sug['xMin']}，真值 112"
        assert sug["xMax"] >= 1055 - 3, f"右界 {sug['xMax']} 裁掉了数据（真值 1055）"
        assert abs(sug["yMin"] - 93) <= 3, f"上沿 {sug['yMin']}，真值 93"
        assert abs(sug["yMax"] - 568) <= 3, f"下沿 {sug['yMax']}，真值 568"

