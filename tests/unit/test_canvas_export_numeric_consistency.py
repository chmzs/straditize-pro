
# -*- coding: utf-8 -*-
"""同一列同一行：**画布口径 == 导出 CSV**，且负丰度必须显式告警（不静默变 0）。

## 缺陷本体（用户实测，2026-11-16）

1. 画布与导出走**两套曲线**：画布画的是控制点折线（前端
   SplineInterpolator.interpolatePercentAtY 线性插值），导出取的是
   column_points（逐行墨迹）。同一行同一列实测差到 0.82（5px）。
2. 更糟的是**调用顺序改变结果**：getDiagramData 是只读 RPC，却在
   rpc_methods/system.py 里无条件 session.digitize()，把 column_points 填成
   稠密曲线。于是"先开画布再导出"得到 68.6885，"直接导出"得到 68.65。
3. 负丰度：近零行的墨迹落在轴线上（x = 0 点 - 1px），几何上算出 -0.16；
   px_to_value 静默 max(0.0, val) 把它写成 0.0，与"真实零"无法区分。

## 判据

T1 画布口径 == 导出值（每列 × 每行，差 ≤0.05 = 0.3px）；
T2 几何负值 → 表里 0.0 **且** 结果里带 NEGATIVE_ABUNDANCE warning；
T3 0 点 == 列左缘 + 轴粗，且载荷 originX 与导出基线是同一个数（单一事实源）。

## 反向验证（已实测会变红）

- 把 _scale_from_group_slope 的 _zero 改回 c_start（0 点退回列左缘）→ T1 红；
- 把 system.py 的 digitize 守卫去掉（恢复无条件数字化）→ T1 红；
- 把 _negative_abundance_warnings 的返回值改成 [] → T2 红；
- 把列级 axis_stroke_px 换成组级值（轴粗强行加到所有列）→ T1/T3 红。
"""

from __future__ import annotations

import io
import json

import pandas as pd

from straditize_core.rpc_methods.system import _payload_column
from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import (
    resolve_axis_stroke,
    resolve_column_scale,
)

#: 组斜率（%/px），与用户工程包同量级。
SLOPE = 0.16393442622950818
#: 组级轴粗初值；col01 有列级覆盖（与用户包同型：4px 实测轴线）。
GROUP_STROKE = 6.0
COL01_STROKE = 4.0
COL01_START = 259.0
COL02_START = 947.0
SAMPLE_ROWS = (400, 420, 440)


def _column(index: int, name: str, start: float, end: float, stroke=None) -> dict:
    return {
        "col_index": index,
        "name": name,
        "species": name,
        "roi_id": "roi_1",
        "x_group_id": "g1",
        "startX": start,
        "start": start,
        "endX": end,
        "end": end,
        "axis_stroke_px": stroke,
        "x_ticks": None,
    }


def _session(negatives: bool = False) -> StraditizeSession:
    """两列同组：col01 有列级轴粗覆盖，col02 跟随组值。"""
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
                    "name": "组1",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    "exaggeration_mult": None,
                    "value_per_px": SLOPE,
                    "axis_stroke_px": GROUP_STROKE,
                    "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                }
            ],
            "xlim": [200, 1400],
            "ylim": [300, 600],
        }
    ]
    session.active_roi_id = "roi_1"
    session.primary_roi_id = "roi_1"
    session.columns = [
        _column(0, "col01", COL01_START, COL02_START, COL01_STROKE),
        _column(1, "col02", COL02_START, 1352.0, None),
    ]
    session.taxa_names = ["col01", "col02"]
    session.is_calibrated = True
    session.y_scale = {"slope": 0.15, "intercept": 100.0}
    session.samples = [
        {"row_px": row, "depth": None, "source": "auto"} for row in SAMPLE_ROWS
    ]
    # 控制点：画布画的就是这条折线（前端对它线性插值）。
    session.control_points = {
        0: {400: 320.0, 420: 500.0, 440: 420.0},
        1: {400: 990.0, 420: 1050.0, 440: 1010.0},
    }
    session.column_points = {}
    if negatives:
        # 近零行：墨迹就压在轴线上，x 比 0 点（947 + 6 = 953）小 1px。
        session.control_points[1][430] = 952.0
        session.samples.append({"row_px": 430, "depth": None, "source": "auto"})
    return session


def _rpc(session: StraditizeSession, method: str, params: dict | None = None):
    dispatcher = create_rpc_dispatcher(session)
    raw = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    )
    payload = json.loads(dispatcher.handle_text(raw))
    assert "error" not in payload, payload.get("error")
    return payload["result"]


def _export(session: StraditizeSession) -> dict:
    """走 export_data（出表的那一层）：它同时给出 csv 与 warnings。"""
    return session.export_data("csv")


def _csv_frame(session: StraditizeSession) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(_export(session)["csv"]))


def _canvas_value(column: dict, group: dict, row: int) -> float:
    """画布口径：控制点折线线性插值 → (x - 0 点) × 斜率。

    与前端逐字对应：SplineInterpolator.interpolatePercentAtY（端点 clamp + 线性）
    + CoordinateSystem.imageXToValue（originX 来自后端，这里按同一规则重算以
    证明两边算的是同一个 0 点）。
    """
    points = sorted(column["controlPoints"], key=lambda item: item["y"])
    if row <= points[0]["y"]:
        x_px = points[0]["x"]
    elif row >= points[-1]["y"]:
        x_px = points[-1]["x"]
    else:
        index = 0
        while index < len(points) - 1 and points[index + 1]["y"] < row:
            index += 1
        left, right = points[index], points[index + 1]
        span = right["y"] - left["y"]
        t = 0.0 if span == 0 else (row - left["y"]) / span
        t = max(0.0, min(1.0, t))
        x_px = left["x"] + (right["x"] - left["x"]) * t

    zero_px = float(column["startX"]) + resolve_axis_stroke(column, group)
    return max(0.0, (x_px - zero_px) * SLOPE)


def _payload(session: StraditizeSession) -> dict:
    """逐列载荷（与 getDiagramData 同一个构建函数）。

    直接调 _payload_column 而不是 getDiagramData：后者在无图会话里返回零状态，
    而本测试要验的正是这个构建函数**不得改写取数状态**。
    """
    return {"columns": [_payload_column(session, column) for column in session.columns]}


def test_canvas_percent_equals_exported_csv_cell() -> None:
    """T1：同一列同一行，画布百分比 == 导出 CSV（≤0.05，即 ≤0.3px）。"""
    session = _session()
    before = _csv_frame(session)
    payload = _payload(session)
    after = _csv_frame(session)
    group = session.rois[0]["x_groups"][0]
    frame = after

    # 只读载荷不得改变导出的数（否则"先开画布再导出"与"直接导出"是两张表）。
    pd.testing.assert_frame_equal(before, after)

    assert len(frame) == len(SAMPLE_ROWS)
    for column in payload["columns"]:
        name = column["name"]
        for row_index, row in enumerate(SAMPLE_ROWS):
            canvas = _canvas_value(column, group, row)
            exported = float(frame[name].iloc[row_index])
            assert abs(canvas - exported) <= 0.05, (
                f"{name} 行 {row}：画布 {canvas:.4f} != 导出 {exported:.4f}"
                "（0 点或插值口径不一致）"
            )


def test_negative_geometry_is_reported_not_silently_zeroed() -> None:
    """T2：几何负值 → 表里 0.0，且结果带 NEGATIVE_ABUNDANCE warning。"""
    session = _session(negatives=True)
    result = _export(session)
    frame = pd.read_csv(io.StringIO(result["csv"]))

    row_index = [item["row_px"] for item in session.samples].index(430)
    assert float(frame["col02"].iloc[row_index]) == 0.0, "物理丰度不得出现负值"

    warnings = result.get("warnings")
    assert warnings, "负值被截成 0 却没有告警：用户无法区分'测到 0'与'0 点画偏'"
    codes = {item["code"] for item in warnings}
    assert "NEGATIVE_ABUNDANCE" in codes, codes
    entry = next(item for item in warnings if item["code"] == "NEGATIVE_ABUNDANCE")
    assert "col02" in entry["columns"], entry
    assert entry["columns"]["col02"]["min"] < 0, entry
    assert 430 in entry["columns"]["col02"]["rows"], entry


def test_zero_point_is_shared_by_payload_and_export() -> None:
    """T3：0 点 = 列左缘 + 轴粗（列级覆盖 > 组级），载荷与导出同一个数。"""
    session = _session()
    payload = _payload(session)
    group = session.rois[0]["x_groups"][0]

    for index, column in enumerate(payload["columns"]):
        col_def = session.columns[index]
        expected_zero = float(col_def["startX"]) + resolve_axis_stroke(col_def, group)
        assert column["scaleCalib"]["originX"] == expected_zero, (
            f"{column['name']}：载荷 originX {column['scaleCalib']['originX']} "
            f"!= 列左缘+轴粗 {expected_zero}"
        )
        assert resolve_column_scale(session, col_def, index).abs_px0 == expected_zero

    # 列级覆盖必须压过组级（col01 实测轴线 4px，组值 6px）
    assert payload["columns"][0]["scaleCalib"]["originX"] == COL01_START + COL01_STROKE
    assert payload["columns"][1]["scaleCalib"]["originX"] == COL02_START + GROUP_STROKE
