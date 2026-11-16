# -*- coding: utf-8 -*-
"""画布-导出同源：载荷的 curvePoints 必须就是导出 CSV 读的那条曲线。

## 缺陷本体

画布画控制点折线、导出读 column_points 逐行墨迹，同一行同一列实测差 0.82（5px）；
更糟的是取数状态会被读路径改写，于是「先开画布再导出」与「直接导出」是两张表。

## 判据

T1 10 行 x 4 列：curvePoints 在该行的 x 与导出 CSV 反算的 x 差 <= 1px（主判据）；
T2 不静默降级：清空 column_points 后，载荷**仍必须**产出稠密点（走
   _ensure_export_column_points 当场算出），且前端不得存在控制点折线的回退分支
   （源码级断言：pollenCurves 里不许再出现 buildPath / buildAreaPath）；
T3 编辑闭环：setControlPoints 改一个锚点 -> 导出该行值随之变化，且重建后的
   curvePoints 与导出仍然 <=1px。

## 反向验证

把 pollenCurves 的 dense 分支去掉（前端退回只用控制点）时，前端判据
frontend/test-dense-curve.mjs 变红（本文件的 T1 守的是后端同源，两者分工）。
"""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd

from straditize_core.rpc_methods.system import _payload_column
from straditize_core.session import StraditizeSession

SLOPE = 0.16393442622950818
GROUP_STROKE = 6.0
STARTS = [259.0, 947.0, 1352.0, 1576.0]
ENDS = [947.0, 1352.0, 1576.0, 1808.0]
SAMPLE_ROWS = [400, 420, 440, 460, 480, 500, 520, 540, 560, 580]
DENSE_ROWS = list(range(400, 600))


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "default_group_id": "g1",
            "x_groups": [
                {
                    "id": "g1",
                    "name": "g1",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    "exaggeration_mult": None,
                    "value_per_px": SLOPE,
                    "axis_stroke_px": GROUP_STROKE,
                    "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                }
            ],
            "xlim": [200, 1900],
            "ylim": [300, 700],
        }
    ]
    session.active_roi_id = "roi_1"
    session.primary_roi_id = "roi_1"
    session.columns = [
        {
            "col_index": index,
            "name": name,
            "species": name,
            "roi_id": "roi_1",
            "x_group_id": "g1",
            "startX": start,
            "start": start,
            "endX": end,
            "end": end,
            "axis_stroke_px": None,
            "x_ticks": None,
        }
        for index, (name, start, end) in enumerate(
            zip(["col01", "col02", "col03", "col04"], STARTS, ENDS)
        )
    ]
    session.taxa_names = ["col01", "col02", "col03", "col04"]
    session.is_calibrated = True
    session.y_scale = {"slope": 0.15, "intercept": 100.0}
    session.data_xlim = [200, 1900]
    session.data_ylim = [300, 700]
    session.samples = [
        {"row_px": row, "depth": None, "source": "auto"} for row in SAMPLE_ROWS
    ]
    # 稠密逐行读数（模拟 digitize 的输出）：每列一条平滑但有起伏的曲线。
    session.column_points = {}
    for index, start in enumerate(STARTS):
        zero = start + GROUP_STROKE
        session.column_points[index] = [
            {
                "row": row,
                "x": zero + 40 + 25 * ((row - 400) % 37) / 37.0 + 6 * index,
            }
            for row in DENSE_ROWS
        ]
    session.control_points = {
        index: {row: next(p["x"] for p in pts if p["row"] == row) for row in (400, 500, 599)}
        for index, pts in session.column_points.items()
    }
    return session


def _export_frame(session: StraditizeSession) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(session.export_data("csv")["csv"]))


def _zero_px(session: StraditizeSession, index: int) -> float:
    return float(session.columns[index]["startX"]) + GROUP_STROKE


def _curve_x_at(payload_col: dict, row: int) -> float:
    for point in payload_col["curvePoints"]:
        if point["y"] == row:
            return float(point["x"])
    raise AssertionError(f"row {row} 不在 curvePoints 里")


def test_curve_points_match_exported_csv_within_one_pixel() -> None:
    """T1（主判据）：10 行 x 4 列，载荷 curvePoints 的 x == 导出 CSV 反算 x。"""
    session = _session()
    frame = _export_frame(session)
    payload = [_payload_column(session, column) for column in session.columns]

    for index, column in enumerate(payload):
        assert column["curveError"] is None, column["curveError"]
        name = session.taxa_names[index]
        zero = _zero_px(session, index)
        for row in SAMPLE_ROWS:
            value = float(frame[name].iloc[SAMPLE_ROWS.index(row)])
            exported_x = zero + value / SLOPE
            canvas_x = _curve_x_at(column, row)
            assert abs(canvas_x - exported_x) <= 1.0, (
                f"{name} 行 {row}：画布路径 x={canvas_x:.4f} 与导出反算 "
                f"x={exported_x:.4f} 相差 {abs(canvas_x - exported_x):.4f}px"
            )


def test_missing_dense_points_are_rebuilt_not_degraded() -> None:
    """T2：清空 column_points 后仍必须产出稠密点；前端不得有回退分支。"""
    session = _session()
    session.column_points.clear()

    payload = [_payload_column(session, column) for column in session.columns]
    for column in payload:
        assert column["curvePoints"], "取不到稠密点时不得静默降级：必须当场算出"
        assert column["curveError"] is None, column["curveError"]
        assert len(column["curvePoints"]) >= 2

    # 画布渲染路径数 == 列数（每列一条稠密曲线，没有别的路径）
    assert len(payload) == len(session.columns)

    # 源码级：不得再出现控制点折线的构建调用（回退分支必须真的不存在）
    source = (
        Path(__file__).resolve().parents[2]
        / "frontend/src/components/canvas/pollenCurves.ts"
    ).read_text(encoding="utf-8")
    assert "buildAreaPath(" not in source, "画布仍存在控制点面积回退"
    assert "buildPath(" not in source, "画布仍存在控制点折线回退"
    assert "buildDensePath(" in source, "画布没有走稠密曲线"
    assert "fallbackColumns" not in source, "回退清单不该再存在"


def test_editing_an_anchor_moves_both_canvas_and_export() -> None:
    """T3：改一个锚点 -> 导出该行值变化，重建后的 curvePoints 与导出仍 <=1px。"""
    session = _session()
    before = _export_frame(session)
    row = 500
    index = 1
    name = session.taxa_names[index]
    old_value = float(before[name].iloc[SAMPLE_ROWS.index(row)])

    # 拖动手柄：把该行锚点向右推 30px（= 30 x 0.1639 = 4.918%）
    anchors = [
        {"row": anchor_row, "x": float(x), "manual": True}
        for anchor_row, x in sorted(session.control_points[index].items())
    ]
    for anchor in anchors:
        if anchor["row"] == row:
            anchor["x"] += 30.0
    session.set_control_points(index, anchors)

    after = _export_frame(session)
    new_value = float(after[name].iloc[SAMPLE_ROWS.index(row)])
    assert abs((new_value - old_value) - 30.0 * SLOPE) <= 0.05, (
        f"导出没有跟着锚点走：{old_value:.4f} -> {new_value:.4f}"
    )

    payload = _payload_column(session, session.columns[index])
    assert payload["curvePoints"], "锚点改完后应能按新锚点重建稠密曲线"
    zero = _zero_px(session, index)
    canvas_x = _curve_x_at(payload, row)
    exported_x = zero + new_value / SLOPE
    assert abs(canvas_x - exported_x) <= 1.0, (
        f"编辑后画布与导出不同源：画布 {canvas_x:.3f} 导出 {exported_x:.3f}"
    )


def test_near_zero_rows_are_exactly_zero_never_negative() -> None:
    """负值归 0（用户裁决）：近零行的墨迹落在轴线上，读数必须恰好 0.0。"""
    session = _session()
    index = 2
    zero = _zero_px(session, index)
    # 把某一行压到 0 点左侧 1px（像素量化的真实情形）
    for point in session.column_points[index]:
        if point["row"] == 500:
            point["x"] = zero - 1.0
    for row in (400, 500):
        session.control_points[index][row] = next(
            p["x"] for p in session.column_points[index] if p["row"] == row
        )

    frame = _export_frame(session)
    name = session.taxa_names[index]
    values = [float(v) for v in frame[name].dropna()]
    assert all(v >= 0.0 for v in values), f"表里出现负丰度：{min(values)}"
    value = float(frame[name].iloc[SAMPLE_ROWS.index(500)])
    assert value == 0.0, f"近零行必须是恰好 0.0，实际 {value!r}"
    assert str(value) == "0.0", "不得写出 -0.0"

    payload = _payload_column(session, session.columns[index])
    canvas_x = _curve_x_at(payload, 500)
    assert canvas_x == zero - 1.0, "画布仍按原始像素画（不篡改几何）"


def test_zero_point_is_start_plus_axis_stroke() -> None:
    """0 点 = 列左缘 + 轴粗（列级覆盖 > 组级）；画布与导出同一个基线。"""
    from straditize_core.session_parts.xscale import (
        resolve_axis_stroke,
        resolve_column_scale,
    )

    session = _session()
    group = session.rois[0]["x_groups"][0]
    payload = [_payload_column(session, column) for column in session.columns]
    for index, column in enumerate(payload):
        expected = float(session.columns[index]["startX"]) + resolve_axis_stroke(
            session.columns[index], group
        )
        assert column["scaleCalib"]["originX"] == expected
        assert resolve_column_scale(session, session.columns[index], index).abs_px0 == expected
