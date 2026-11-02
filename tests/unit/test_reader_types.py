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


def test_bar_reader_is_not_mean_of_column() -> None:
    """`bar` 必须读柱右缘，不得与 `line`（柱心均值）逐点相同。"""
    bar = _column_points("bar")
    line = _column_points("line")
    assert bar, "基准图上应能读出点"
    assert bar.keys() == line.keys()
    differing = [row for row in bar if bar[row] != line[row]]
    assert differing, (
        "bar 与 line 逐点完全相同 —— bar 已退化为柱内均值（P-04 复发）"
    )
    # 柱状图上柱右缘一定在柱心右侧（除非该行无墨，两者都取基线）。
    right_of_center = [row for row in differing if bar[row] > line[row]]
    assert len(right_of_center) > 0.8 * len(differing), (
        "bar 应读柱右缘（大于柱心），实测多数点并不在右侧"
    )


def test_unknown_reader_type_is_rejected() -> None:
    """未知读取方式必须报错，不能静默退化成均值。"""
    session = StraditizeSession()
    session.load_image(image_path=str(BARS))
    session.detect_columns()
    with pytest.raises(Exception) as err:
        session.digitize(0, "definitely-not-a-reader")
    assert "读取方式" in str(err.value) or "reader" in str(err.value).lower()
