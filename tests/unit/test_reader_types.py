# -*- coding: utf-8 -*-
"""读取器类型（area / line / bar）的回归钉子。

P-04 是一次实测事故：session 层只认复数 `"bars"`，而底层 `digitize_column`
与前端都用单数 `"bar"`，于是 `bar` 静默落到 else 分支走**柱内均值** ——
柱状图读数系统性只有真值一半（Betula@430cm 真值 73.91 → 36.44），
返回结果里的 `reader_type` 却仍回显 `"bar"`（元数据说谎）。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from straditize_core.session import StraditizeSession

BARS = (
    Path(__file__).resolve().parent.parent
    / "data/figures/benchmark_types/Pollen_BarStyle_riojaPlotTestData.png"
)


def _column_points(reader: str) -> dict[int, float]:
    session = StraditizeSession()
    session.load_image(image_path=str(BARS))
    session.detect_columns()
    session.roi_update(y0=82.0, y1=563.0)
    session.detect_columns()
    return {int(p["row"]): float(p["x"]) for p in session.digitize(0, reader)["points"]}


def test_bar_reader_agrees_with_area_not_half_of_it() -> None:
    """柱状图上 `bar` 与 `area` 都读填充顶边，比值应 ≈1；退化到柱内均值时 ≈0.5。

    判据演进史（前两版都是判据本身的错，产品是对的）：
    1. 「bar 与 line 逐点不同」—— D-08 把 line 修成"填充读顶边"后两者本就同值，代理失效；
    2. 「bar 等于该行最右墨迹」—— 用的是 `session.foreground_mask`，而 `digitize`
       内部还叠了 `~grid_line_mask & roi_mask`，两份 mask 不同（实测只 26/113 行相等）。
    最终用**同源参照**：area 与 bar 出自同一个 digitize，P-04 时 bar=柱心≈area 的一半，
    修好后两者同值。这个比值能可靠区分 0.5 与 1.0，且不依赖我猜 mask 的构成。
    """
    session = StraditizeSession()
    session.load_image(image_path=str(BARS))
    session.detect_columns()
    session.roi_update(y0=82.0, y1=563.0)
    session.detect_columns()

    bar = {int(p["row"]): float(p["x"]) for p in session.digitize(0, "bar")["points"]}
    area = {int(p["row"]): float(p["x"]) for p in session.digitize(0, "area")["points"]}

    baseline = float(session.columns[0]["start"])
    ratios = []
    for row in sorted(bar):
        height = area[row] - baseline
        if height < 10:  # 只比"真有柱高"的行，避免基线附近的除零噪声
            continue
        ratios.append((bar[row] - baseline) / height)
    assert len(ratios) > 50, f"可比行太少（{len(ratios)}）"
    ratios.sort()
    median = ratios[len(ratios) // 2]
    assert 0.9 <= median <= 1.1, (
        f"bar/area 比值中位数 {median:.3f}（期望 ≈1.0）。"
        f"≈0.5 说明 bar 退化成柱内均值（P-04 复发）"
    )


def test_unknown_reader_type_is_rejected() -> None:
    """未知读取方式必须报错，不能静默退化成均值。"""
    session = StraditizeSession()
    session.load_image(image_path=str(BARS))
    session.detect_columns()
    with pytest.raises(Exception) as err:
        session.digitize(0, "definitely-not-a-reader")
    assert "读取方式" in str(err.value) or "reader" in str(err.value).lower()


def test_reader_types_are_single_named_and_aliases_normalized() -> None:
    """读取器类型只有一套单数名；`bars` 是别名，必须在入口被消解。

    这条守的是"命名不许分叉"：别名一旦散进分支判断，就会出现
    `bar` 走一条路、`bars` 走另一条路，而 `plot_type` 与底层
    `digitize_column` 只会用其中一种（P-04 的成因）。
    """
    from straditize_core.session_parts.digitize import (
        READER_TYPES,
        normalize_reader_type,
    )

    assert READER_TYPES == ("area", "line", "bar")
    for alias in ("bars", "BARS", " Bar "):
        assert normalize_reader_type(alias) == "bar"
    for canonical in READER_TYPES:
        assert normalize_reader_type(canonical) == canonical
