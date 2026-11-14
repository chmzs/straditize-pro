# -*- coding: utf-8 -*-
"""`axis_row_outside_roi`：轴行在有效区之外时的实测行号（步骤 6 可诊断性）。

## 缺陷本体

齿的搜索带来自 ROI 的 `ylim`：`find_axis_row` 只在
`[max(0.70·h, y0), min(h, y1))` 内找下轴线（`straditize_core/ruler.py`）。用户框选
时若不把**印刷轴行**框进来，整段齿搜索带就落在轴行之上。实测 hoya：把分区框成
`(0,0)–(1900,1300)` 后，29 列里 26 列 `axis_row=null`、3 列各检出 1 条孤齿，
`median_spacing_px=null` —— 面板此时只能报"未找到刻度尺"，用户无从知道该改哪里。

`axis_row_outside_roi` 就是补上那个缺失的实测值：ROI 下边界之下那一小段里，
**确实是刻度尺横轴**的行号。

## 字段语义（两条，各有一组判据）

| 值 | 含义 | 界面必须怎么说话 |
| --- | --- | --- |
| `int` | 轴行存在，但在 ROI 下边界之下 | 报出这个 y，让用户把下边界下移到它以下 |
| `null` | 窗口内**确实找不到**轴行 | 退回"未找到刻度尺"，**不得**编一个 y |

## 为什么窗口取图高比例而不是固定像素

窗口要覆盖的是"ROI 下边界到印刷轴行之间那段空白"，它随分辨率放大。实测：

* hoya（图高 1654）：框到 1300，轴行 1306/1307 → 只需 **7px**；
* beginner（图高 1796）：框到 1600，轴行 1661–1664 → 需要 **61px**。

而 hoya 的整幅外框下边在 y=1375，距它自己的下边界（1311）只有 **64px** ——
任何 `≥64px` 的固定窗口都会把外框吞进来（实测 W=64 时 hoya 基线返回 1374）。
所以窗口取图高的 10%（hoya 165px / beginner 180px），**外框的排除不靠窗口大小**，
而靠两条结构判据：

1. **不是整幅外框**：该行在 ROI 横向**之外**仍然暗的比例 < 0.40。
   实测轴行 0.013/0.219，外框 0.489/0.664（threshold 落在中间）；
2. **下面挂着窄齿**：正下方 `TICK_SEARCH_BELOW` 窗口内，窄笔（≤4px）占暗游程的
   比例 ≥ 0.90 且至少 8 条。实测真轴行 1.00、内部分隔线 0.57、外框 0.00。

这两条都不随窗口大小变化，所以"窗口够不够"只影响**能否够到**轴行，
不会影响"够到的是不是轴行"。
"""

from __future__ import annotations

import numpy as np
import pytest

import straditize_core.ruler as ruler
from straditize_core.session import StraditizeSession

#: hoya 的取数区（图版数据区，**不含**整幅外框下边 y=1375）。
HOYA_X, HOYA_Y = [315, 1946], [511, 1311]
#: 复现缺陷用的截断框：下边界 1300 恰好在印刷轴行（1306/1307）之上。
CLIPPED_Y = [0, 1300]


def _session(sample_key: str, xlim: list[int], ylim: list[int]) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key=sample_key)
    session.detect_columns(xlim, ylim, roi_id=session.rois[0]["id"])
    return session


def _outside_values(per_column: list[dict]) -> list[int | None]:
    return [c["axis_row_outside_roi"] for c in per_column]


class TestAxisRowOutsideRoi:
    """正向：框没盖住轴行时，必须报出实测行号（且是轴行，不是外框/分隔线）。"""

    def test_reports_measured_axis_row_below_clipped_roi(self) -> None:
        result = _session("hoya", [0, 1900], CLIPPED_Y).measure_ruler_geometry()
        per_column = result["per_column"]
        outside = [v for v in _outside_values(per_column) if v is not None]

        assert outside, (
            "26/29 列在区内测不到轴线时，axis_row_outside_roi 必须给出实测行号；"
            f"实得全为 null（axis_row={sorted({c['axis_row'] for c in per_column}, key=str)}）"
        )
        # 真值：hoya 各列下轴 1306/1307（实测 ROI 放全时 find_axis_row 返回 1307）。
        assert set(outside) == {1307}, (
            f"实测轴行必须是 1307，实得 {sorted(set(outside))} —— "
            "1307 之外的值意味着选中了内部分隔线（1130）或整幅外框（1375）"
        )
        # 多数列都能测到（个别边缘列在图上没有横轴，允许为 None）。
        assert len(outside) >= 20, f"实测只有 {len(outside)} 列测到，过于稀疏"

    def test_never_returns_the_printing_frame(self) -> None:
        """外框下边 y=1374/1375 比任何列的下轴都靠下，绝不能当成轴行。"""
        result = _session("hoya", [0, 1900], CLIPPED_Y).measure_ruler_geometry()
        assert 1374 not in _outside_values(result["per_column"])
        assert 1375 not in _outside_values(result["per_column"])

    def test_matches_axis_row_measured_with_full_roi(self) -> None:
        """与"框够大时区内测到的轴行"逐个对账 —— 同一根轴，两条路径必须同号。"""
        full = _session("hoya", HOYA_X, HOYA_Y).measure_ruler_geometry()["per_column"]
        clipped = _session("hoya", [0, 1900], CLIPPED_Y).measure_ruler_geometry()["per_column"]
        inside_by_index = {c["col_index"]: c["axis_row"] for c in full}
        compared = 0
        for col in clipped:
            outside = col["axis_row_outside_roi"]
            inside = inside_by_index.get(col["col_index"])
            if outside is None or inside is None:
                continue
            assert outside == inside, (
                f"col {col['col_index']}：区内实测 {inside} vs 区外实测 {outside} —— "
                "同一根印刷轴不该有两个行号"
            )
            compared += 1
        assert compared >= 20, f"只对账了 {compared} 列，样本太少"

    def test_beginner_window_reaches_axis_61px_below(self) -> None:
        """窗口必须够到 61px 之下的轴行 —— 固定 64px 会在 hoya 上吞外框，故用比例。"""
        session = _session("beginner", [259, 1803], [0, 1600])
        per_column = session.measure_ruler_geometry()["per_column"]
        outside = [v for v in _outside_values(per_column) if v is not None]

        assert outside, (
            "beginner 框到 1600 时轴行在 1661–1664（61–64px 之下），"
            "窗口必须够到它；全为 null 说明窗口按固定像素取且太小"
        )
        assert set(outside) == {1664}, f"beginner 实测轴行应为 1664，实得 {sorted(set(outside))}"


class TestAxisRowOutsideRoiIsNull:
    """负向对照：确实找不到轴行时必须给 null（界面据此退回"未找到刻度尺"）。"""

    def test_null_when_axis_row_inside_roi(self) -> None:
        """框已盖住轴行 ⇒ 区内就有轴线，不该再报"区外轴行"。"""
        result = _session("hoya", HOYA_X, HOYA_Y).measure_ruler_geometry()
        assert _outside_values(result["per_column"]) == [None] * len(result["per_column"]), (
            "轴行在有效区内（区内 axis_row=1307）时，axis_row_outside_roi 必须全为 null"
        )

    def test_null_when_nothing_like_an_axis_below(self) -> None:
        """框下边界之下没有轴行（框到图底）⇒ null，不得编一个 y。"""
        session = _session("hoya", [0, 1900], [0, 1300])
        gray = np.asarray(session.image.convert("L"))
        assert (
            ruler.find_axis_row_below_roi(
                gray, 319, 497, roi_x=(0, 1900), y_bottom=1375
            )
            is None
        ), "从外框下边（1375）往下找，窗口内没有任何轴行 ⇒ 必须 None"

    def test_null_when_roi_bottom_is_at_image_bottom(self) -> None:
        """下边界贴着图底 ⇒ 窗口为空 ⇒ None（不能回绕到图上方去）。"""
        session = _session("hoya", [0, 1900], [0, 1300])
        gray = np.asarray(session.image.convert("L"))
        height = int(gray.shape[0])
        assert (
            ruler.find_axis_row_below_roi(
                gray, 319, 497, roi_x=(0, 1900), y_bottom=height
            )
            is None
        )


class TestWindowIsProportional:
    """窗口取图高比例的依据：固定像素在两档内置图上无法同时满足"够到"与"不吞外框"。"""

    def test_fixed_64px_would_swallow_the_frame(self) -> None:
        """反证：W=64 时 hoya 基线（y1=1311）会选中外框 1374。"""
        session = _session("hoya", HOYA_X, HOYA_Y)
        gray = np.asarray(session.image.convert("L"))
        # 用现有 find_axis_row 复刻"固定窗口"的实现（不带结构判据）。
        from straditize_core.ruler import find_axis_row

        naive = find_axis_row(gray, 319, 497, y0=HOYA_Y[1], y1=HOYA_Y[1] + 64)
        assert naive == 1374, (
            f"反证失败：固定 64px 窗口在 hoya 上取到 {naive}（期望外框 1374）；"
            "若它不再取外框，说明图的形态变了，本文件的比例窗口依据需重测"
        )
        # 带结构判据的实现，从**真实的截断点**（1300）往下找的是轴行 1307 ——
        # 外框被排除、内部分隔线（1130）也不会被选中。
        assert (
            ruler.find_axis_row_below_roi(
                gray, 319, 497, roi_x=(0, 1900), y_bottom=CLIPPED_Y[1]
            )
            == 1307
        ), "结构判据必须把外框排除、取到真正的轴行 1307"

    def test_window_size_is_ten_percent_of_height_with_floor(self) -> None:
        assert ruler.AXIS_ROW_OUTSIDE_SEARCH_FRAC == pytest.approx(0.10)
        assert ruler.AXIS_ROW_OUTSIDE_SEARCH_MIN_PX == 24
