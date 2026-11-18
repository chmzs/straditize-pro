# -*- coding: utf-8 -*-
"""轴宽实测：墨芯锚点 + 半高宽（#46）。

## 缺陷本体

`measure_axis_stroke` 在 S1 上把轴宽量成 **1px**，真值（图中刻度标签区的孤立
轴线，无数据覆盖）**3~4px**。根因是锚点取"`base+0` 第一个合格列"——那是轴线
左缘的**抗锯齿过渡列**（实测 S1 col1：`start` 处灰度 168，右侧墨芯 13）。过渡
列同样满足 `std ≤ 30` 与 `paper - mean ≥ 25` 两道门，于是 `level` 被取成 168；
向右第一列就是墨芯，跳变 155 > `level_tol` 立即断开。

0 点 = `start + 轴宽`，量成 1 就比轴线右缘左偏 2px（S1 `value_per_px`=0.2381
⇒ 每列 +0.48%）。

## 本文件守的三件事

1. **正向**：抗锯齿左缘不得把轴宽压回 1px；
2. **反向哨兵**：beginner 那种"黑轴线 + 灰填充（155）"不得被半深判据吞进填充；
3. **"测不出"仍要返回 0**：实心块、无轴两种情形下调用方必须被告知量不了。
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from straditize_core.columns import measure_axis_stroke

REAL_PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
S1_IMAGE = ".recon_20261117/image/original.png"


def _band(levels: list[float], *, height: int = 200,
          noisy: dict[int, float] | None = None,
          paper_cols: int = 6) -> np.ndarray:
    """按列灰度造一张假图；`noisy` 指定的列加起伏（模拟数据曲线那一列）。

    末尾补 `paper_cols` 列纸白：`measure_axis_stroke` 的 `paper` 取整幅中位数，
    假图若以墨色列为主，中位数会落到墨色上，判据就整体失效了。
    """
    columns = list(levels) + [255.0] * paper_cols
    band = np.empty((height, len(columns)), dtype=np.uint8)
    for x, level in enumerate(columns):
        amp = (noisy or {}).get(x, 0.0)
        if amp <= 0:
            band[:, x] = int(round(level))
            continue
        # 一半行是纸白 255、其余行是 level —— 模拟"该列只有部分行有墨迹"
        half = height // 2
        col = np.full(height, 255.0)
        col[:half] = level
        rng = np.random.default_rng(7)
        col = np.clip(col + rng.normal(0.0, amp, height), 0, 255)
        band[:, x] = col.astype(np.uint8)
    return band


class TestAntialiasedEdge:
    """正向：轴线左缘带抗锯齿过渡列时，轴宽不得塌成 1px。"""

    def test_width_spans_core_and_antialias_ramp(self) -> None:
        """S1 col1 的实测灰度剖面：过渡列 168 → 墨芯 13 → AA 19/34 → 跳层 69。"""
        band = _band([252, 168, 35, 13, 19, 34, 69, 109, 126])
        widths = measure_axis_stroke(band, [1])
        # 墨芯在 +2（13），半深 121 ⇒ 右缘落在灰度 69 那一列（+6）；
        # 宽度 = 右缘 − start = 6 − 1 = 5。
        assert widths == [5], (
            f"抗锯齿左缘不得把轴宽压回 1px（旧实现返回 [1]）；实得 {widths}"
        )

    def test_data_column_terminates_the_run_at_axis_edge(self) -> None:
        """墨芯右侧紧跟数据列（S1 实测：+3 那列 90% 有墨、10% 纸白）⇒ 轴止于墨芯。"""
        band = _band([252, 168, 35, 13, 19], noisy={4: 80.0})
        widths = measure_axis_stroke(band, [1])
        # 墨芯在 +3（13），+4 沿 y 不再均匀 ⇒ 停止；宽度 = 3 − 1 + 1 = 3
        assert widths == [3], f"实得 {widths}"


class TestGreyFillIsNotSwallowed:
    """反向哨兵：黑轴线 + 灰填充，半深判据不得把填充算进轴宽。"""

    def test_black_axis_before_grey_fill(self) -> None:
        """beginner 实测：轴线 0.2（4px）、AA 82、灰色填充 155（std 27）。"""
        band = _band([0.2, 0.2, 0.2, 0.2, 82, 155, 155, 155], noisy={5: 27.0, 6: 27.0, 7: 27.0})
        widths = measure_axis_stroke(band, [0])
        assert widths == [4], (
            f"灰色填充（155）不是轴线的一部分，轴宽应为 4；实得 {widths}"
        )

    def test_six_pixel_axis_stays_six(self) -> None:
        band = _band([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 115, 155, 155], noisy={7: 27.0, 8: 27.0})
        assert measure_axis_stroke(band, [0]) == [6]


class TestUnmeasurableReturnsZero:
    """测不出必须返回 0——调用方据此提示"请手填"，不得静默编一个数。"""

    def test_solid_block_returns_zero(self) -> None:
        band = _band([20.0] * 30)
        assert measure_axis_stroke(band, [0]) == [0]

    def test_no_axis_near_start_returns_zero(self) -> None:
        band = _band([252, 251, 250, 249, 248, 247])
        assert measure_axis_stroke(band, [0]) == [0]

    def test_empty_input_is_safe(self) -> None:
        assert measure_axis_stroke(np.zeros((0, 0), dtype=np.uint8), []) == []
        assert measure_axis_stroke(np.zeros((5, 0), dtype=np.uint8), [0]) == [0]


@pytest.mark.skipif(
    not os.path.exists(REAL_PLATE),
    reason=f"真实图版不在本机：{REAL_PLATE}",
)
class TestFig3RealPlate:
    """fig3：图版轴线核心实测 1px、连带 AA 共 2px，逐列只允许 1~2。"""

    def _widths(self) -> tuple[list[int], list[tuple[int, int]]]:
        from pathlib import Path

        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(Path(REAL_PLATE)))
        if not getattr(session, "rois", None):
            session._init_rois()
            session.roi_create(name="probe", x0=0.0, x1=float(session.width),
                               y0=0.0, y1=float(session.height))
        _, _, _, _, gray, _mask, bounds = session._prepare_detection_masks(
            330, 1330, 233, 869
        )
        widths = measure_axis_stroke(gray, [int(s) for s, _ in bounds])
        return widths, [(int(s), int(e)) for s, e in bounds]

    def test_every_column_measures_one_or_two(self) -> None:
        widths, bounds = self._widths()
        assert len(widths) == 16, f"fig3 应检出 16 列，实得 {len(widths)}"
        assert set(widths) <= {1, 2}, (
            "fig3 的轴线是 1px 核心 + 1px 抗锯齿，轴宽只允许 1~2；"
            f"实得 {widths}"
        )

    def test_coverage_is_total(self) -> None:
        """16 列全部测得出——组值取中位数，缺列会把中位数拉偏。"""
        widths, _ = self._widths()
        assert [w for w in widths if w > 0] != []
        assert len([w for w in widths if w > 0]) == len(widths)


@pytest.mark.skipif(
    not os.path.exists(S1_IMAGE),
    reason=f"S1 工程图不在本机（.recon_20261117/ 不入库）：{S1_IMAGE}",
)
class TestS1RealPlate:
    """S1：轴线真值 3~4px（刻度标签区的孤立轴线实测），旧实现一律 1px。"""

    def _widths(self) -> list[int]:
        from pathlib import Path

        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(Path(S1_IMAGE)))
        if not getattr(session, "rois", None):
            session._init_rois()
            session.roi_create(name="probe", x0=0.0, x1=float(session.width),
                               y0=0.0, y1=float(session.height))
        _, _, _, _, gray, _mask, bounds = session._prepare_detection_masks(
            934, 3030, 316, 1836
        )
        return measure_axis_stroke(gray, [int(s) for s, _ in bounds])

    def test_median_is_no_longer_one_pixel(self) -> None:
        widths = self._widths()
        positive = [w for w in widths if w > 0]
        median = float(np.median(positive))
        assert 3.0 <= median <= 5.0, (
            "S1 轴宽中位数必须落在 3~5（孤立轴线真值 3~4）；"
            f"实得 {median}，逐列 {widths}"
        )

    def test_first_three_columns_span_the_ink_core(self) -> None:
        widths = self._widths()
        assert widths[:3] == [3, 5, 5], (
            "Picea/Pinus/Betula 的轴宽必须过墨芯（旧实现三列都是 1）；"
            f"实得 {widths[:3]}"
        )
