"""拐点控制点不得出现负数（<0%）的取值。

## 缺陷背景

曲线墨迹可能落在轴线内（x < 列左缘 c_start）：那是一段轴线描边，不是「负百分比」。
旧实现把 `p["x"] - c_start` 原样当曲线宽度，于是控制点会出现负值 —— 图上/导出里
就出现小于 0% 的点。用户口径：**图上不该存在 <0% 的点**。

本文件钉两条：
① 曲线宽度被钳到 ≥ 0（含端点）；
② 任何控制点的取值都 ≥ 列左缘。
"""
from __future__ import annotations

from straditize_core.session_parts.digitize import DigitizeMixin


def _profile_with_negative_head() -> list[dict[str, float]]:
    c_start = 100.0
    xs = []
    for i in range(30):
        if i < 3:
            xs.append(c_start - 6.0 + i)  # 落在轴线内 → 负宽度
        elif i < 12:
            xs.append(c_start + (i - 2) * 12.0)  # 上升
        else:
            xs.append(c_start + 120.0 - (i - 12) * 9.0)  # 回落
    return [{"x": x, "y": float(200 + i)} for i, x in enumerate(xs)]


def test_control_points_are_never_negative():
    c_start = 100
    points = _profile_with_negative_head()
    rows_to_x, ctrl_pts = DigitizeMixin._turning_control_points(  # type: ignore[misc]
        None,
        points=points,
        c_start=c_start,
        y0=200,
        y1=229,
        col_index=0,
        col_width=700.0,
        zero_offset=6.0,
    )
    assert ctrl_pts, "该曲线有真实拐点，控制点不应为空"
    offenders = {p["y"]: p["x"] for p in ctrl_pts if p["x"] < c_start + 6.0}
    assert offenders == {}, f"控制点落在 0 点（绿线）左侧，等于负读数：{offenders}"
    assert all(v >= c_start + 6.0 for v in rows_to_x.values()), "行→x 表里出现 0 点左侧的取值"
