"""`samples.fromDepthGrid`：等距网格层位（S4）。

## 要解决什么

`samples_extract_consensus` 的行集是「多列拐点聚类」，点密度由拐点数决定：同一张图，
数字化从稀疏控制点换成稠密逐行曲线后点数 203 → 355（实测，
`docs/findings/recon-20261117.md` §5）。用户要的「按钻孔采样间隔出数」是另一种行集。
本文件钉住它的三条语义：**深度严格等距**、**行落在 ROI 内**、**该报错时报错**。

## 判据

1. 生成的层位深度差恒等于 `step`（±1e-6），行数与 `floor((end-start)/step)+1` 相等；
   `source` 全为 `grid`，且 `depth_grid` 与 `samples` 是同一批数（两条导出行集同源）。
   反向：任何"取共识点再等分"的实现都会让深度差抖动，判据 1 红。
2. 导出（`export_data('csv')`）的行数 = 层位数 —— 网格是**真的**变成了导出行集，
   不是只写了个字段。
3. 越界与过细步长必须抛 `INVALID_PARAMS` 并说明真实区间 / 分辨率，不许静默外推、
   不许静默去重。
"""

from __future__ import annotations

import math

import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
YLIM = [233, 869]
Y_MARKS = [
    {"pixel": 233.0, "val": 0.0},
    {"pixel": 869.0, "val": 100.0},
]


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=list(YLIM))
    session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm")
    return session


def test_grid_horizons_are_exactly_equally_spaced() -> None:
    session = _session()
    result = session.samples_from_depth_grid(step=1.0)

    samples = session.samples
    assert result["count"] == len(samples) == 101, "0..100 每 1cm ⇒ 101 层"
    depths = [float(s["depth"]) for s in samples]
    gaps = [b - a for a, b in zip(depths, depths[1:])]
    assert max(abs(gap - 1.0) for gap in gaps) < 1e-6, f"深度不等距：{gaps[:6]}"
    assert {s["source"] for s in samples} == {"grid"}
    assert len(session.depth_grid) == len(samples), "depth_grid 与 samples 必须同源"
    assert [float(d) for d in session.depth_grid] == depths

    rows = [int(s["row_px"]) for s in samples]
    assert rows == sorted(rows), "行号必须单调递增"
    assert all(YLIM[0] <= row <= YLIM[1] for row in rows), "层位必须落在 ROI 内"
    # 行距允许 ±1px：像素是整数，1cm 在该标定下是 6.36px。
    row_gaps = {b - a for a, b in zip(rows, rows[1:])}
    assert max(row_gaps) - min(row_gaps) <= 1, f"行距抖动过长：{sorted(row_gaps)}"


def test_grid_rowset_becomes_the_exported_rows() -> None:
    session = _session()
    session.samples_from_depth_grid(step=2.0)
    expected = len(session.samples)

    result = session.export_data("csv")
    text = result.get("csv") or result.get("csv_content") or ""
    rows = [line for line in text.strip().splitlines()[1:] if line.strip()]
    assert len(rows) == expected, f"导出 {len(rows)} 行 ≠ 层位 {expected} 个"


def test_grid_rejects_interval_outside_calibration() -> None:
    session = _session()
    with pytest.raises(JsonRpcError) as exc:
        session.samples_from_depth_grid(step=1.0, start_depth=-5.0, end_depth=50.0)
    message = str(exc.value)
    assert "标定区间" in message and "0.0" in message and "100.0" in message


def test_grid_rejects_step_finer_than_pixel_resolution() -> None:
    """0.1cm 在该标定下只有 0.636px：多个深度会落到同一行 ⇒ 必须报错而不是静默去重。"""
    session = _session()
    with pytest.raises(JsonRpcError) as exc:
        session.samples_from_depth_grid(step=0.1)
    assert "行分辨率" in str(exc.value)
    assert session.samples == [], "报错时不得留下半成品层位"


def test_grid_requires_calibration() -> None:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    with pytest.raises(JsonRpcError) as exc:
        session.samples_from_depth_grid(step=1.0)
    assert "Y 轴标定" in str(exc.value)


def test_grid_count_matches_formula_for_odd_span() -> None:
    """区间不能被步长整除时，行数按 floor(span/step)+1（不偷偷补一行到上界）。"""
    session = _session()
    step = 3.0
    result = session.samples_from_depth_grid(step=step)
    expected = int(math.floor(100.0 / step)) + 1
    assert result["count"] == expected
