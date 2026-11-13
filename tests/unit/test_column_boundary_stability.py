# -*- coding: utf-8 -*-
"""列边界必须与 ROI 的 y 范围**无关**（bench D-05 的判据，2026-11-08 复测）。

## 为什么钉这条

`docs/findings/bench-issues/bench-diatom.md` D-05 记过一次事故：同一张图、只把
`data_ylim` 从 `[1,579]` 收到真数据框 `[78,563]`，5 列起点右移 1–6px，全表 MAE 从
0.156 涨到 0.464。原因是列起点就是**0 值原点**——起点动 6px，该列全部读数整体偏移
6/3.80 = 1.58 个百分点（对量程 6.84 的列是 23% 全量程）。

列面板的左侧竖轴是**固定的物理结构**，不该随「用户把取数框画大一点还是小一点」移动。
判据：同一张图、`data_ylim` 取 4 组（含极窄），任一列起点像素差 ≤ 1px，列数不变。

## 现在的状态（复测）

实测 4 组 ylim 起点**完全一致（0px）**，D-05 的第一步已经修好；但**覆盖范围**仍随
ROI 变化（见第二个用例）：[120,500] 时有 9/20 个层位落在取数区外，导出整行为空。
那是**正确语义**（不在取数区就没有读数），但用户需要被明确告知——已登记 §9。
"""

from __future__ import annotations

import io

import pandas as pd

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png"
XLIM = [70, 1055]
YLIMS = ([1, 579], [70, 565], [78, 563], [120, 500])


def _starts(ylim) -> list[int]:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=XLIM, data_ylim=list(ylim))
    return [round(float(c["start"])) for c in session.columns]


def test_column_left_edges_do_not_move_with_the_roi_y_range() -> None:
    baseline = _starts(YLIMS[0])
    assert len(baseline) == 25, f"基准列数应为 25，实得 {len(baseline)}"

    for ylim in YLIMS[1:]:
        starts = _starts(ylim)
        assert len(starts) == len(baseline), f"{ylim} 的列数变了：{len(starts)} vs {len(baseline)}"
        drift = [abs(a - b) for a, b in zip(baseline, starts)]
        assert max(drift) <= 1, (
            f"{ylim}：列起点相对默认 ROI 漂移 {max(drift)}px（上限 1px）。列起点就是 "
            "0 值原点，漂 6px 等于该列所有读数整体偏移 1.58 个百分点。"
        )


def test_horizons_outside_the_roi_export_as_empty_not_zero() -> None:
    """取数区之外的层位必须整行为空（而不是 0）——与「窗口内缺行=0」是两件事。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    cols = session.detect_columns(data_xlim=XLIM, data_ylim=[120, 500])
    # 导出守卫要求深度标定（export.py 的 CALIBRATION_ERROR）。本用例钉的是
    # 「取数区之外整行为空、而不是 0」，属于导出内容语义，所以先经真实 RPC 做
    # Y 两点标定。端点取 1px = 1 深度单位：本用例下面的 samples 本来就是
    # `depth = row_px`，标定只把「Y 轴读出什么」写成显式声明，不改任何期望值。
    session.calibrate_axes(
        y_marks=[{"pixel": 120.0, "val": 120.0}, {"pixel": 500.0, "val": 500.0}],
        unit="cm",
    )
    for i, c in enumerate(cols):
        left, right = float(c["start"]), float(c["end"])
        session.calibrate_column_xticks(
            i, [{"px": left, "value": 0.0}, {"px": right, "value": (right - left) / 3.80}]
        )
        session.digitize(i)

    # 10 个层位在窗口内、10 个在窗口外（行 40..60 与 520..560）
    session.samples = [
        {"row_px": row, "depth": float(row), "source": "manual"}
        for row in (40, 60, 200, 300, 400, 500, 520, 540, 560, 575)
    ]
    df = pd.read_csv(io.StringIO(session.export_data("csv")["csv"]))

    outside = df[df["depth"] > 500]
    assert len(outside) == 4, f"预期 4 个窗口外层位，实得 {len(outside)}"
    assert outside.iloc[:, 1:].isna().all().all(), (
        "取数区之外的层位必须整行为空——给 0 等于声称这些层位读到了零丰度"
    )
    inside = df[df["depth"] <= 500]
    assert inside.iloc[:, 1:].notna().any().any(), "窗口内的层位必须真的读到数"

