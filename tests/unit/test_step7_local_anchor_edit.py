# -*- coding: utf-8 -*-
"""step7 轮廓线局部编辑：改一个锚点只重写它的邻域，远端保留墨迹曲线。

## 缺陷（用户原话：「step7 轮廓线无法编辑，一编辑就退回拐点」）

`core.digitize` 在真实工程 `.recon_20261117` 上给出 **1521 个逐行点**（稠密轮廓）、
自动拐点 **436 个**。用户拖动/微调一个锚点后，画布调 `column.setControlPoints`，
旧实现把**整列**换成「436 个锚点的分段线性插值」：mean|Δx| = 0.68px、max|Δx| = 47px，
只有锚点所在行 Δ = 0。改一个点 → 整列形状被换掉。

## 判据

1. 局部性：只改中间一个锚点（x +20px）→ 距该锚点行 > 25 的行 |Δx| ≤ 1px；
   窗口内的行必须真的变了（否则用例无判别力）。
2. 幂等：同一批锚点连发两次 → 第二次 `unchanged == True`、`patched_rows == []`、
   `column_points` 逐值不变。
3. 端点：改首/末锚点 → 窗口不越出 `data_ylim`，首段起点 == y0、末段终点 == y1。
4. 重建边界：窗口外的行与编辑前**逐值相等**（不是"相差 ≤1px"，是 `==`）。
5. 旧路径：与旧值完全相同的整份锚点列表 → 不重建（性能 + 不推空撤销项）。

## 反向验证

把 `set_control_points` 退回"整列插值"（即再调一次 `update_control_point` 重写全列）
后，判据 1/4 必须变红。本文件的用例 1 内联了这件事：算一次"整列按锚点线性插值"
与编辑前墨迹曲线的偏差，断言它在远端行 > 5px —— 即旧实现一定会被这组判据抓住，
而不是靠人肉回忆。

## 合成图

`area` 画法的填充剖面：1px 台阶 + 低频正弦，稠密行数 216（[40, 255]）。
锚点集用「每 20 行取一个 + 两个端点」的粗手柄集（前端 `downsampleControlPoints`
推给后端的正是这种粗集，后端稠密点则是逐行墨迹），两者相差最大 50px 以上，
所以"整列插值"与"墨迹曲线"在本图上是可分辨的两条线。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession

W, H = 200, 320
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W  # 16
Y0, Y1 = 40, 255  # 取数区（data_ylim）
INK_Y1 = 265  # 墨迹比对取数区多画几行，避开窗口末端读数
AMPLITUDE, PERIOD = 35.0, 60.0
STAIR_PERIOD, STAIR_AMPLITUDE = 9, 14.0
COARSE_STEP = 20  # 粗手柄集的行间隔
WINDOW = 25  # = digitize.py 的 _ANCHOR_PATCH_WINDOW_ROWS


def _curve_x(row: int) -> float:
    """该行的真值墨迹右缘（像素）。"""
    t = row - Y0
    stair = ((t % STAIR_PERIOD) / STAIR_PERIOD - 0.5) * 2.0
    return (
        ZERO_X
        + 74.0
        + AMPLITUDE * np.sin(2 * np.pi * t / PERIOD)
        + STAIR_AMPLITUDE * stair
    )


def _synthetic_plate(path) -> None:
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0  # 列轴线
    for row in range(Y0, INK_Y1 + 1):
        img[row, ZERO_X : int(round(_curve_x(row))) + 1] = 0  # 填充剖面
    Image.fromarray(img).save(path)


def _session(tmp_path) -> StraditizeSession:
    plate = tmp_path / "step7_local_anchor.png"
    _synthetic_plate(plate)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(plate))
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "curve",
            "species": "curve",
            "roi_id": None,
            "start": float(AXIS_X0),
            "startX": float(AXIS_X0),
            "end": float(W),
            "endX": float(W),
            "plot_type": "area",
            "scale_type": "linear",
            "unit": "%",
            "startValue": 0.0,
            "tickValue": 1.0,
            "tickEndX": float(ZERO_X + 1),
            "axis_stroke_px": AXIS_W,
        }
    ]
    session.rois = {}
    session.roi = None
    session.data_ylim = [float(Y0), float(Y1)]
    session.digitize(0, reader_type="area")
    return session


def _dense(session: StraditizeSession) -> dict[int, float]:
    return {int(p["row"]): float(p["x"]) for p in session.column_points[0]}


def _coarse_anchors(session: StraditizeSession) -> dict[int, float]:
    """前端手柄集：稠密点每 20 行取一个 + 两个端点。

    末行锚点取倒数第二行的墨迹值：取数窗口的最后一行被 `_roi_mask` 的右开区间排除
    （`mask[y0:y1]`），逐行读数恒为列左缘（← 0 点），`_reject_below_zero_point` 会
    拒收那个值。这是读数器既有行为，与本次改动无关；用例只需要一个合法的端点手柄。
    """
    dense = _dense(session)
    rows = sorted(dense)
    picked = rows[::COARSE_STEP]
    if rows[-1] not in picked:
        picked.append(rows[-1])
    anchors = {row: dense[row] for row in picked}
    anchors[rows[-1]] = dense[rows[-2]]
    return anchors


def _payload(anchors: dict[int, float]) -> list[dict[str, float]]:
    return [
        {"row": int(row), "x": float(x), "manual": True}
        for row, x in sorted(anchors.items())
    ]


def test_edit_only_touches_anchor_neighbourhood(tmp_path) -> None:
    """判据 1：改一个锚点，25 行以外的行 |Δx| ≤ 1px；窗口内确实变了。"""
    session = _session(tmp_path)
    before = _dense(session)
    anchors = _coarse_anchors(session)
    # 用户当前的锚点就是这批粗手柄（与墨迹曲线不是同一条折线）
    session.control_points[0] = dict(anchors)

    edit_row = 120
    assert edit_row in anchors, "用例要求被编辑的锚点行在粗手柄集里"
    moved = dict(anchors)
    moved[edit_row] += 20.0

    result = session.set_control_points(0, _payload(moved))
    assert result["unchanged"] is False
    assert result["patched_rows"] == [[edit_row - WINDOW, edit_row + WINDOW]], result[
        "patched_rows"
    ]
    after = _dense(session)
    assert len(after) == len(before), "局部重写不得增删行"
    assert len(result["points"]) == len(before), "points 仍返回全列"

    far_rows = [row for row in before if abs(row - edit_row) > WINDOW]
    assert far_rows
    worst_far = max(abs(after[row] - before[row]) for row in far_rows)
    assert worst_far <= 1.0, f"窗口外的行被改动了：max|Δx| = {worst_far:.3f}px"

    inner_rows = [row for row in before if abs(row - edit_row) <= WINDOW]
    worst_inner = max(abs(after[row] - before[row]) for row in inner_rows)
    assert worst_inner >= 2.0, (
        f"窗口内几乎没变（max|Δx| = {worst_inner:.3f}px）：用例没有判别力"
    )

    # 反向验证（内联自检）：整列按锚点线性插值 = 旧实现，它在远端行偏离墨迹曲线多少。
    # 末 5 行是读数器既有的"窗口末行读成 0"行为（与本次改动无关），排除在外。
    rows = np.array(sorted(before), dtype=float)
    anchor_rows = np.array(sorted(moved), dtype=float)
    anchor_xs = np.array([moved[int(r)] for r in anchor_rows])
    legacy = np.interp(rows, anchor_rows, anchor_xs)
    baseline = np.array([before[int(r)] for r in rows])
    far_mask = (np.abs(rows - edit_row) > WINDOW) & (rows <= Y1 - 5)
    legacy_gap = float(np.max(np.abs(legacy - baseline)[far_mask]))
    assert legacy_gap > 5.0, (
        f"旧实现（整列插值）在远端只偏离 {legacy_gap:.3f}px：这组判据抓不住回归"
    )


def test_same_anchor_batch_twice_is_idempotent(tmp_path) -> None:
    """判据 2：同一批锚点连发两次，第二次不重建、列值逐值不变。"""
    session = _session(tmp_path)
    anchors = {int(row): float(x) for row, x in session.control_points[0].items()}
    middle = sorted(anchors)[len(anchors) // 2]
    anchors[middle] += 10.0

    first = session.set_control_points(0, _payload(anchors))
    assert first["unchanged"] is False
    before = _dense(session)

    second = session.set_control_points(0, _payload(anchors))
    assert second["unchanged"] is True
    assert second["patched_rows"] == []
    assert _dense(session) == before, "重复同步不得改动任何一个点"


def test_window_never_leaves_data_ylim(tmp_path) -> None:
    """判据 3：改首/末锚点时窗口只能向内，不越出被检视的行集 `[y0, y1)`。

    末行用 `y1 - 1` 而不是 `y1`：`y1` 那一行属图框/轴齿，不算层位（issue #60，
    用户 2026-11-18 拍板），行集、插值域、窗口上界一律收在 `y1 - 1`。
    """
    session = _session(tmp_path)
    y0, y1 = int(session.data_ylim[0]), int(session.data_ylim[1])
    anchors = _coarse_anchors(session)
    session.control_points[0] = dict(anchors)

    first_row = min(anchors)
    assert first_row == y0
    moved = dict(anchors)
    moved[first_row] += 15.0
    result = session.set_control_points(0, _payload(moved))
    intervals = result["patched_rows"]
    assert intervals[0][0] == y0, f"首段越出了下界：{intervals}"
    assert all(start >= y0 and end <= y1 for start, end in intervals), intervals

    last_row = max(moved)
    assert last_row == y1 - 1, f"粗手柄集的末行应是 y1-1，实得 {last_row}"
    moved[last_row] -= 15.0
    result = session.set_control_points(0, _payload(moved))
    intervals = result["patched_rows"]
    assert intervals[-1][1] == y1 - 1, f"末段越出了上界：{intervals}"
    assert all(start >= y0 and end <= y1 - 1 for start, end in intervals), intervals


def test_rows_outside_window_are_bit_identical(tmp_path) -> None:
    """判据 4：窗口外的行与编辑前逐值相等（== ，不是"相差 ≤1px"）。"""
    session = _session(tmp_path)
    anchors = _coarse_anchors(session)
    session.control_points[0] = dict(anchors)
    before = _dense(session)

    edit_row = 140
    moved = dict(anchors)
    moved[edit_row] += 20.0
    result = session.set_control_points(0, _payload(moved))
    ((start, end),) = result["patched_rows"]
    assert start == edit_row - WINDOW and end == edit_row + WINDOW

    after = _dense(session)
    outside = [row for row in before if row < start or row > end]
    assert len(outside) == len(before) - (end - start + 1)
    for row in outside:
        assert after[row] == before[row], (
            f"窗口外的 row {row} 被改写：{before[row]!r} -> {after[row]!r}"
        )


def test_identical_anchor_list_does_not_rebuild(tmp_path) -> None:
    """判据 5：收到与旧值完全相同的整份列表 → 不重建。"""
    session = _session(tmp_path)
    before_points = [dict(point) for point in session.column_points[0]]
    identical = _payload(
        {int(row): float(x) for row, x in session.control_points[0].items()}
    )

    result = session.set_control_points(0, identical)
    assert result["unchanged"] is True
    assert result["patched_rows"] == []
    assert session.column_points[0] == before_points, "无变化的同步不得重写稠密点"


def test_empty_anchor_list_is_rejected(tmp_path) -> None:
    """守卫仍在：空列表不能落库（否则这一列没有可插值的曲线）。"""
    from straditize_core.protocol import JsonRpcError

    session = _session(tmp_path)
    with pytest.raises(JsonRpcError):
        session.set_control_points(0, [])
