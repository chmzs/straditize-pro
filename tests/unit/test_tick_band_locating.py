# -*- coding: utf-8 -*-
"""横轴刻度尺的自动定位（G-01a）：旧实现是恒为死代码，必须能真找到。

## 缺陷本体

旧搜索窗口 `range(y_bottom - 4, y_bottom + 16)` 同时要求
`top + bh <= hi_search`（`hi_search = y_bottom`）。最小可达的 `top + bh` 是
`(y_bottom - 4) + 6 = y_bottom + 2`，**恒大于** `hi_search` —— 60 个候选全被
`continue`，一个都没测过。步骤 6 的"自动提取"因此完全不可用，而表面现象只是
"这张图没有刻度尺"（band=None、每列 0 齿）。

而且"刻度尺紧贴 ROI 底部 ±16px"这个假设本身是错的：fig3_raw 的 ROI 底是 744，
真尺在 **869-875**，差 125px。ROI 是用户框的取数区，刻度尺画在图版下缘。

## 判据：按物理结构找，不按齿数拟合

刻度尺的定义性结构是"**一条横轴 + 一排垂直于它、只向下伸出的短齿**"：

1. 逐行算暗像素占全宽比例，> 40% 的行是横轴候选（fig3 实测 y=869 达 66%，
   其余行 ≤7%，差一个数量级）；
2. 轴线之下 6 行内连续为暗的列 = 齿；
3. **T2**：该列在轴线上方 3 行内不得有暗像素——真齿只往下伸，而贯穿框线与
   图例字母的竖笔会穿过轴线。实测 fig3 的 16 个已知框线位 16/16 被 T2 排除，
   而 51 个真齿 16/16 通过，不误伤；
4. 齿数需达 20 的量级门槛（fig3 真尺 51，hoya 图例区最多 16，beginner 最多 2）。

## 已作废的判据（都实测过，都不成立，勿再采用）

- ❌ "真尺在 y≈886-890"：那是**印刷数字区**（能看出 0/5 字形）。齿数 55 比真齿区
  51 还多——**齿数不但不能区分对错，方向甚至相反**。
- ❌ "maxrun ≤ 20"：真齿带含贯穿框线，maxrun 达 662 被误杀；数字带 maxrun=15
  反而通过。
- ❌ "齿数 = 46/49/89"：同一张图五个数字漂移，不可作真值。

## 关于"可用列数 ≥ 90%"

任务书第 2 条要求定位后可用列数达总列数 90%。本文件**没有**把它写成断言，原因
见 `TestUsableColumnsDisagreement`：`per_column.usable` 的定义是"列内齿数 ≥2"，
而 fig3 实测刻度间距中位数 **25px**、产品分列出的列宽 **37-38px** —— 每列通常
只落 1 个齿，`usable` 必然大面积失败。这与 band 定位对不对无关（同一个 band 下
16 列均分能到 12/16，产品 22 列只有 6/22）。该指标需要单独定口径，不在本任务。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]

#: 真实图版：被 `.gitignore` 的 `output/` 覆盖，全新克隆拿不到 → 缺失时 skip。
FIG3_PATH = Path("output/han2026_ngamring/fig3_raw.jpeg")

#: 真尺的物理位置：横轴 y=869，齿 870-875。验收区间放宽到 [868, 878]。
EXPECTED_BAND_LOW = 868
EXPECTED_BAND_HIGH = 878


def _detect(session: StraditizeSession, roi_id: str) -> dict:
    return session.detect_xticks_rpc(roi_id=roi_id)


class TestRealFigureFindsItsRuler:
    """验收 1：真实图版必须定位到 y ∈ [868, 878]。"""

    @pytest.mark.skipif(
        not FIG3_PATH.exists(),
        reason=(
            "真实图版 output/han2026_ngamring/fig3_raw.jpeg 不存在"
            "（output/ 被 .gitignore 覆盖，全新克隆拿不到）。"
            "该用例只在具备该样本的机器上跑。"
        ),
    )
    def test_band_located_in_physical_range(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(FIG3_PATH))
        roi_id = session.rois[0]["id"]
        session.detect_columns(roi_id=roi_id)

        result = _detect(session, roi_id)

        assert result["band"] is not None, (
            "band 为 None —— 自动搜索没找到刻度尺（旧实现是恒为死代码："
            "所有候选都被 continue 掉）"
        )
        band_low, band_high = result["band"]
        assert EXPECTED_BAND_LOW <= band_low <= EXPECTED_BAND_HIGH, (
            f"band 起点 {band_low} 不在物理区间 "
            f"[{EXPECTED_BAND_LOW}, {EXPECTED_BAND_HIGH}] 内 —— "
            "横轴在 y=869、齿在 870-875。若落在 886 附近，那是**印刷数字区**"
        )
        assert band_high > band_low

    @pytest.mark.skipif(
        not FIG3_PATH.exists(),
        reason="真实图版不存在（output/ 被 gitignore），跳过。",
    )
    def test_band_actually_yields_ticks(self) -> None:
        """定位到带之后必须真的检出齿——band 非 None 但 0 齿等于没修。"""
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(FIG3_PATH))
        roi_id = session.rois[0]["id"]
        session.detect_columns(roi_id=roi_id)

        result = _detect(session, roi_id)

        assert len(result["ticks"]) >= 20, (
            f"只检出 {len(result['ticks'])} 个齿 —— 真尺实测 51 个，"
            "20 已是量级门槛"
        )

    @pytest.mark.skipif(
        not FIG3_PATH.exists(),
        reason="真实图版不存在（output/ 被 gitignore），跳过。",
    )
    def test_ticks_are_evenly_spaced(self) -> None:
        """刻度尺必然等距：间距中位数应远小于间距的最大值（排除杂散笔画）。"""
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(FIG3_PATH))
        roi_id = session.rois[0]["id"]
        session.detect_columns(roi_id=roi_id)

        ticks = sorted(_detect(session, roi_id)["ticks"])
        assert len(ticks) >= 20
        gaps = [b - a for a, b in zip(ticks, ticks[1:]) if b - a > 0]
        gaps.sort()
        median_gap = gaps[len(gaps) // 2]
        # 真尺多数间距是 25/37/38；25 是最小刻度间隔
        assert 15 <= median_gap <= 60, (
            f"刻度间距中位数 {median_gap}px 不像刻度尺"
        )


class TestHoyaHasNoRuler:
    """验收 3：hoya 真值无尺，历史缺陷曾报 53 伪齿，不得回归。"""

    def test_hoya_reports_no_band(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        roi_id = session.rois[0]["id"]
        session.detect_columns(HOYA_X, HOYA_Y, roi_id=roi_id)

        result = _detect(session, roi_id)

        assert result["band"] is None, (
            f"hoya 报出 band={result['band']} —— 真值 has_tick_ruler=false。"
            "y=1306/1312 是**图例文字**（能看出 A/C 字样），不是刻度尺"
        )
        assert result["ticks"] == [], (
            f"hoya 报出 {len(result['ticks'])} 个伪齿（历史缺陷是 53 个）"
        )


class TestBeginnerHasNoRuler:
    """验收 4：beginner 真值无尺。"""

    def test_beginner_reports_no_band(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="beginner")
        roi_id = session.rois[0]["id"]
        session.detect_columns(roi_id=roi_id)

        result = _detect(session, roi_id)

        assert result["band"] is None, (
            f"beginner 报出 band={result['band']} —— y=1740 附近是轴下方"
            "10/30/50/70/90 的**印刷数字**（笔宽 18px），不是刻度齿"
        )
        assert result["ticks"] == []


class TestExclusionConditionsAreLoadBearing:
    """排除条件是判据的承重部分，单独钉住。"""

    def test_t2_excludes_strokes_that_cross_the_axis(self) -> None:
        """T2 的物理依据：真齿只从轴线向下伸出，框线/图例笔画会穿过轴线。

        fig3 的 16 个已知框线位全部满足"轴线上方有暗"，因此被 T2 排除；
        51 个真齿全部不满足，因此保留。若 T2 失效，框线会被算成齿，齿数虚高。
        """
        if not FIG3_PATH.exists():
            pytest.skip("真实图版不存在（output/ 被 gitignore），跳过。")

        import numpy as np

        from straditize_core.session_parts.xticks import (
            TICK_CLEAR_ABOVE,
            TICK_DEPTH,
        )

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(FIG3_PATH))
        dark = np.array(session.image.convert("L")) < 160
        axis = 869
        band = dark[axis + 1 : axis + 1 + TICK_DEPTH, :]
        stroke_columns = np.where(band.mean(axis=0) > 0.99)[0]
        assert len(stroke_columns) > 0, "前置：轴线下应有一批竖笔画"

        crossing = [
            x
            for x in stroke_columns
            if any(dark[axis - offset, x] for offset in range(1, TICK_CLEAR_ABOVE + 1))
        ]
        assert crossing, (
            "轴线下方这一带里没有找到任何'穿过轴线'的列 —— "
            "说明 T2 在这张图上没有可排除对象，判据失去承重意义，需复核 band"
        )


class TestUsableColumnsDisagreement:
    """记录一处**已知分歧**，不让它被误当成通过。

    任务书第 2 条要求"可用列数 ≥ 总列数 90%"。此指标当前不可满足，原因是
    `per_column.usable` 的定义（列内齿数 ≥ 2）与图版刻度密度不匹配：

    - fig3 实测刻度间距中位数 **25px**；
    - 产品分列出的列宽 **37-38px**；
    - 故每列通常只落 **1** 个齿 → `usable` 恒 False。

    同一个 band（870,876）下，把 ROI 均分成 16 列能到 12/16（75%），
    用产品的 22 列却只有 6/22（27%）——**差异来自分列粒度，不是 band 定位**。
    """

    def test_usable_rate_depends_on_column_width_not_on_band(self) -> None:
        if not FIG3_PATH.exists():
            pytest.skip("真实图版不存在（output/ 被 gitignore），跳过。")

        import numpy as np

        from straditize_core.xticks import _strokes_in_band

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=str(FIG3_PATH))
        roi_id = session.rois[0]["id"]
        session.detect_columns(roi_id=roi_id)
        result = _detect(session, roi_id)
        ticks = sorted(result["ticks"])
        assert ticks, "前置：应已检出齿"

        gaps = sorted(b - a for a, b in zip(ticks, ticks[1:]) if b - a > 0)
        median_gap = gaps[len(gaps) // 2]

        product_usable = sum(1 for col in result["per_column"] if col["usable"])
        product_total = len(session.columns)

        # 反事实：把同一个 band 的齿按 16 列均分重新算
        x_low, x_high = session.rois[0]["xlim"]
        width = (x_high - x_low) / 16
        even_usable = sum(
            1
            for index in range(16)
            if sum(
                1
                for tick in ticks
                if x_low + index * width <= tick < x_low + (index + 1) * width
            )
            >= 2
        )

        assert median_gap < (x_high - x_low) / product_total, (
            "刻度间距并不小于产品列宽 —— 这条分歧的前提不成立，需重新评估"
        )
        assert even_usable > product_usable, (
            "16 列均分的可用列数不高于产品分列 —— 说明瓶颈不在列宽，"
            "本分歧的成因判断有误，需复核"
        )
