# -*- coding: utf-8 -*-
"""无横轴列的标定来源：一格宽列 / 共用刻距折算。

## 依据来自生成器源码，不是猜

`rioja::strat.plot`（v1.0.7）第 148–158 与 288–310 行：

```r
colM <- apply(d, 2, max, na.rm = TRUE)
colM <- floor((colM + 5)/5) * 5        # 每列满量程，取整到 5 的倍数
colM[colM < min.width] <- min.width    # 不足 min.width（默认 5）抬到 5
xlabb <- seq(0, colM[i], by = x.pc.inc[i])   # x.pc.inc 默认 10
if (x.axis[i]) axis(side=1, at=xlabb, labels=xlabbt, ...)
```

由此得到两个可判定的情形：

1. **一格宽列**：`colM = 5` 而刻度增量 10 → `seq(0,5,by=10)` 只有 `[0]`，
   画不出第二个齿，视觉上只剩一根短竖线。列宽 `inc2 = inc × colM` 与该列满量程
   成正比，所以**列宽对应的是满量程 5，不是 10**。
2. **完全没画横轴的列**（`x.axis=FALSE`）：`inc` 是全图统一量
   （`inc = 可用宽度 / sum(colM)`），所以 px/单位 与同图其他列相同，
   可按共用刻距折算满量程 = 列宽 / 共用刻距。
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from straditize_core.session import StraditizeSession

FIGURES = Path(__file__).resolve().parent.parent / "data/figures/benchmark_types"


def _measure(name: str):
    session = StraditizeSession()
    session.load_image(image_path=str(FIGURES / name))
    session.detect_columns()
    return session.measure_ruler_geometry()


def test_every_column_gets_a_spacing_on_pollen() -> None:
    """pollen 图上 21 列必须**全部**能拿到 spacing_px（否则用户无法标定该列）。"""
    geo = _measure("Pollen_riojaPlotTestData.png")
    missing = [c["col_index"] for c in geo["per_column"] if c.get("spacing_px") is None]
    assert not missing, f"这些列仍无刻距可用：{missing}"
    assert len(geo["per_column"]) == 21


def test_single_tick_columns_use_column_width_and_flag_it() -> None:
    """一格宽列：spacing 必须等于列宽，且标 `column_width_as_unit`。

    它们的满量程是 rioja 的 `min.width`（默认 5），**不是**刻度增量 10 ——
    用户在这一列要填的「每根齿单位数」是 5。
    """
    geo = _measure("Pollen_riojaPlotTestData.png")
    single = [c for c in geo["per_column"] if c.get("source") == "column_width_as_unit"]
    assert len(single) >= 5, f"一格宽列应有若干（实测 7），得到 {len(single)}"
    for c in single:
        assert c["spacing_px"] == pytest.approx(c["column_width"], abs=0.6)
        assert c["n_cells"] == 1
        assert "min.width" in (c.get("note") or "")


def test_axis_less_columns_use_shared_spacing_on_diatom() -> None:
    """完全没有横轴的列：沿用同图共用刻距，并给出满量程格数。

    判据用独立算出的 px/单位反验：diatom 25 面板共用 3.80 px/单位
    （bench-diatom 由 10 个带印刷数字的面板实测），故任一列的满量程应为
    列宽 / 3.80；而本接口给出的 cells_estimate = 列宽 / 共用刻距，
    两者之比应等于"每格 10 单位"。
    """
    geo = _measure("Diatom_riojaPlotTestData.png")
    missing = [c["col_index"] for c in geo["per_column"] if c.get("spacing_px") is None]
    assert not missing, f"diatom 上仍有列无刻距：{missing}"
    shared = [c for c in geo["per_column"] if c.get("source") == "shared_scale"]
    assert len(shared) >= 15, f"无横轴列应有 19 个左右，得到 {len(shared)}"
    median = geo["median_spacing_px"]
    for c in shared:
        assert c["spacing_px"] == pytest.approx(median, abs=0.01)
        expected_cells = c["column_width"] / median
        assert c["cells_estimate"] == pytest.approx(expected_cells, abs=0.02)
    # 交叉验证：共用刻距 / 每格单位数 应等于独立实测的 px/单位
    assert median / 10 == pytest.approx(3.80, abs=0.15)


def test_shared_scale_requires_majority_agreement() -> None:
    """「同图共用」的判定不能被单个伪刻线拉爆。

    diatom 实测 spacings=[39.0,38.5,38.0,39.0,22.5,38.0]，CV=16.7% ——
    若用 CV<5% 判定，19 个无轴列会全部拿不到刻距（用户无法标定）。
    """
    geo = _measure("Diatom_riojaPlotTestData.png")
    spacings = [c["spacing_px"] for c in geo["per_column"] if c.get("spacing_px")]
    arr = np.asarray(spacings, dtype=float)
    assert arr.std() / arr.mean() > 0.05, "该图确实存在离群刻距，此测试才有意义"
    assert any(c.get("source") == "shared_scale" for c in geo["per_column"]), (
        "离群值存在时仍应判定为共用刻度"
    )
