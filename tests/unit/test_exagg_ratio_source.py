# -*- coding: utf-8 -*-
"""#99：`FLAG_EXAGG_RATIO` 的数据源（内线 / 外线成对读数）真的来自像素。

## 缺陷背景

`compute_qa_flags` 早就有 `ratio = (outer−z0)/(inner−z0) ∉ [3.0, 5.5]` 的判据，但
`columns_info` 里从来没有人给 `inner_xs_px` / `outer_xs_px`，于是整列恒为
`skipped(no_paired_inner_outer_readings)`。而 `_compensate_broken_inner_rows` 判
"外线断开"时**本来就量过**这两条线的右缘，用完即弃。

## 本文件钉的契约

| 案例 | 断言 |
| --- | --- |
| `pairs_per_row` | 两段墨迹的行 → 点字典带 `inner_xs_px` / `outer_xs_px`，值 = 两条线的右缘绝对像素 |
| `no_key_without_pair` | 只有内线一段的行 → **两个键都不存在**（不是 0、不是 None），断线行也照样没有 |
| `single_layer_no_mult` | 列上没有倍率 → 一个键都不写（点字典与 #99 之前逐字节相同） |
| `flag_from_pixels` | `qa_summarize` 真的从这对读数算出 ratio：5.0 → 零告警；改成 2.0 → 报该行 |
| `old_project_skips` | 点字典没有这对键（旧工程 / 未重新数字化）→ 整列 `skipped`，**不是 ratio=0** |
| `no_reading_is_not_zero` | 只有内线一段的列（外线整列断裂）→ `skipped`，零告警不等于"没有异常" |
| `readings_untouched` | 跑完旗标后 `px_to_value` 输出与 `column_points` **逐字节相同** |
| `guard` | `store_layer_pair` 拒绝 outer ≤ inner（只有一段墨迹的行不该送进来） |

## 反向验证

1. 删掉 `_compensate_broken_inner_rows` 里的 `store_layer_pair(...)` → `pairs_per_row` /
   `flag_from_pixels` 变红（后者退回 `skipped`）。
2. 把缺省值改成写 0（`point.setdefault("inner_xs_px", 0.0)`）→ `no_key_without_pair` /
   `no_reading_is_not_zero` 变红（0 会让断线行算出 `ratio=0`，即一条假告警）。
3. 让 `session_parts/qa.py` 无条件写这两个键（全 None 数组）→ `old_project_skips`
   变红：`_flag_block` 会把"没有读数"判成"算过了、零告警"。
"""

from __future__ import annotations

import json

import numpy as np
import pytest
from PIL import Image

from straditize_core.qa import FLAG_EXAGG_RATIO
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.layers import (
    INNER_XS_KEY,
    OUTER_XS_KEY,
    store_layer_pair,
)
from straditize_core.session_parts.xscale import resolve_column_scale

W, H = 140, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W          # 16 —— 0 点（轴线右缘，也是 x_ticks 的 0 点）
INNER_DIST = 10                    # 内线右缘距 0 点 10px
OUTER_DIST = 50                    # 外线距 0 点 50px → ratio = 5.0
Y0, Y1 = 40, 160
ASSERTED_ROWS = range(Y0, Y1)      # 取样窗口最后一行不参与断言（见既有测试同款说明）
SLOPE = 1.0                        # %/px
MULT = 5.0


def _draw_plate(path, *, outer_rows=None) -> None:
    """轴(6px) + 通高内线填充 + 外线（只画在 `outer_rows` 的行上，1px 宽细线）。"""
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0
    img[Y0 : Y1 + 1, ZERO_X : ZERO_X + INNER_DIST + 1] = 0
    outer_x = ZERO_X + OUTER_DIST
    for row in outer_rows or set():
        img[row, outer_x] = 0
    Image.fromarray(img).save(path)


def _session(tmp_path, *, outer_rows=None, mult=MULT):
    plate = tmp_path / f"layer_plate_{len(outer_rows or ())}_{mult}.png"
    _draw_plate(plate, outer_rows=outer_rows)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(plate))
    group = {
        "id": "roi_1_grp1",
        "name": "默认组",
        "unit": "%",
        "plot_type": "area",
        "scale_type": "linear",
        "exaggeration_mult": None,
        "axis_stroke_px": AXIS_W,
    }
    roi = {
        "id": "roi_1",
        "name": "pollen",
        "xlim": [0.0, float(W)],
        "ylim": [float(Y0), float(Y1)],
        "x_groups": [group],
        "default_group_id": group["id"],
    }
    session.rois = [roi]
    session.roi = roi
    session.primary_roi_id = roi["id"]
    session.active_roi_id = roi["id"]
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "Picea",
            "species": "Picea",
            "roi_id": "roi_1",
            "x_group_id": group["id"],
            "start": float(AXIS_X0),
            "startX": float(AXIS_X0),
            "end": float(W),
            "endX": float(W),
            "plot_type": "area",
            "scale_type": "linear",
            "unit": "%",
            "axis_stroke_px": AXIS_W,
            "exaggeration_mult": mult,
            "x_ticks": [
                {"px": float(ZERO_X), "value": 0.0},
                {"px": float(ZERO_X + 1), "value": SLOPE},
            ],
        }
    ]
    session.data_ylim = [float(Y0), float(Y1)]
    return session


def _scale(session):
    return resolve_column_scale(session, session.columns[0], 0)


def _points(session) -> dict[int, dict]:
    return {int(p["row"]): p for p in session.column_points[0]}


# --------------------------------------------------------------- 落库（点字典）


def test_pairs_are_written_for_rows_with_two_ink_runs(tmp_path) -> None:
    """两段墨迹的行：两个键都在，且等于两条线各自的右缘绝对像素。"""
    session = _session(tmp_path, outer_rows=set(range(Y0, Y1 + 1)))
    session.digitize(0, reader_type="area")
    points = _points(session)
    expected_inner = float(ZERO_X + INNER_DIST)
    expected_outer = float(ZERO_X + OUTER_DIST)
    for row in ASSERTED_ROWS:
        point = points[row]
        assert point[INNER_XS_KEY] == pytest.approx(expected_inner)
        assert point[OUTER_XS_KEY] == pytest.approx(expected_outer)
        # 与读数口径无关：成对读数是"这一行两条线各自的右缘"，`x` 取哪一条由读取器
        # 决定（本图外线是独立细线，连通域判据可能把它排除），两件事互不影响。


def test_rows_without_outer_line_have_no_keys(tmp_path) -> None:
    """只有内线一段的行：两个键**都不存在**（不写 0、不写 None）。"""
    broken = set(range(Y0 + 40, Y0 + 50))
    session = _session(
        tmp_path, outer_rows=set(range(Y0, Y1 + 1)) - broken
    )
    session.digitize(0, reader_type="area")
    points = _points(session)
    for row in broken:
        assert INNER_XS_KEY not in points[row], f"row {row}: 断线行不该有内线读数键"
        assert OUTER_XS_KEY not in points[row], f"row {row}: 断线行不该有外线读数键"
    # 断线行确实被补偿过（读数不是真值的 1/5），补偿与"落库"是两件事
    assert points[min(broken)]["source"] == "broken_inner"
    # 有外线的行仍然成对
    assert INNER_XS_KEY in points[Y0 + 1]
    assert OUTER_XS_KEY in points[Y0 + 1]
    # 任何一行都不允许出现 0 值读数（0 会让 ratio = 0，变成假告警）
    for point in points.values():
        for key in (INNER_XS_KEY, OUTER_XS_KEY):
            assert point.get(key, 1.0) != 0.0, f"row {point['row']}: {key} 被写成 0"


def test_single_layer_column_writes_no_keys(tmp_path) -> None:
    """列上没有倍率 → 整条逻辑不启动，点字典里一个键都没有（与 #99 之前逐字节同形）。"""
    session = _session(tmp_path, outer_rows=set(range(Y0, Y1 + 1)), mult=None)
    session.digitize(0, reader_type="area")
    for point in _points(session).values():
        assert INNER_XS_KEY not in point
        assert OUTER_XS_KEY not in point
        assert "source" not in point


def test_store_layer_pair_rejects_outer_inside_inner() -> None:
    """只有一段墨迹的行送进来时必须报错，不能静默丢弃（那会变成静默缺口）。"""
    point = {"row": 1, "x": 10.0}
    with pytest.raises(ValueError):
        store_layer_pair(point, inner_x=20.0, outer_x=20.0)
    assert INNER_XS_KEY not in point and OUTER_XS_KEY not in point


# ----------------------------------------------------------------- 旗标接线


def _exagg_block(session) -> dict:
    return session.qa_summarize()["flags"][FLAG_EXAGG_RATIO]


def test_flag_is_computed_from_the_stored_pixels(tmp_path) -> None:
    """5× 列：ratio 恰为 5.0（区间内）→ 零告警；把某行外线改成 2× → 报该行。"""
    session = _session(tmp_path, outer_rows=set(range(Y0, Y1 + 1)))
    session.digitize(0, reader_type="area")
    block = _exagg_block(session)
    assert block["status"] == "computed", block
    assert block["count"] == 0, f"ratio 5.0 落在 [3.0, 5.5] 内，不该报：{block['rows']}"
    assert block["by_column"] == {}

    # 只改这一个点的外线读数，旗标必须跟着变（说明它读的是落库的像素，不是常量）
    target_row = Y0 + 3
    point = _points(session)[target_row]
    point[OUTER_XS_KEY] = float(ZERO_X + 2 * INNER_DIST)  # ratio = 2.0
    block = _exagg_block(session)
    assert block["status"] == "computed"
    assert [row["row_px"] for row in block["rows"]] == [target_row]
    assert block["rows"][0]["ratio"] == pytest.approx(2.0)
    assert block["rows"][0]["inner_span_px"] == pytest.approx(float(INNER_DIST))


def test_old_project_without_keys_skips_the_column(tmp_path) -> None:
    """点字典没有这对键（旧工程刚载入 / 未重新数字化）→ skipped，**不是 ratio=0**。"""
    session = _session(tmp_path, outer_rows=set(range(Y0, Y1 + 1)))
    # 手工铺逐行点：只有 row/x，没有 #99 的两个键
    session.column_points = {
        0: [{"row": row, "x": float(ZERO_X + OUTER_DIST), "y": float(row)}
            for row in range(Y0, Y1 + 1)]
    }
    block = _exagg_block(session)
    assert block["status"] == "skipped"
    assert block["reason"] == "no_paired_inner_outer_readings"
    assert block["count"] == 0
    assert block["rows"] == []
    assert block["skipped_columns"] == [
        {"column": "Picea", "reason": "no_paired_inner_outer_readings"}
    ]


def test_column_without_any_pair_is_skipped_not_zero(tmp_path) -> None:
    """外线整列断裂：每行只有内线一段 → 没有成对读数 → skipped，不是「算过、零告警」。"""
    session = _session(tmp_path, outer_rows=None)
    session.digitize(0, reader_type="area")
    points = _points(session)
    assert all(INNER_XS_KEY not in p for p in points.values())
    block = _exagg_block(session)
    assert block["status"] == "skipped"
    assert block["count"] == 0
    assert block["columns_evaluated"] == 0
    assert block["skipped_columns"] == [
        {"column": "Picea", "reason": "no_paired_inner_outer_readings"}
    ]


# ------------------------------------------------- 判据 3：旗标不改任何读数


def test_flags_do_not_change_any_reading(tmp_path) -> None:
    """跑 `qa_summarize` 前后：`px_to_value` 输出与 `column_points` 逐字节相同。"""
    session = _session(tmp_path, outer_rows=set(range(Y0, Y1 + 1)))
    session.digitize(0, reader_type="area")
    scale = _scale(session)

    def snapshot() -> tuple[str, str]:
        points = session.column_points[0]
        values = [
            scale.px_to_value(
                float(p["x"]),
                baseline_px=scale.abs_px0,
                require_calibrated=False,
                ndigits=None,
            )
            for p in points
        ]
        points_bytes = json.dumps(points, sort_keys=True).encode("utf-8")
        values_bytes = json.dumps(values, sort_keys=True).encode("utf-8")
        return points_bytes.hex(), values_bytes.hex()

    before = snapshot()
    block = session.qa_summarize()["flags"][FLAG_EXAGG_RATIO]
    assert block["status"] == "computed"
    after = snapshot()
    assert before[1] == after[1], "加旗标后 px_to_value 输出变了（旗标不该改读数）"
    assert before[0] == after[0], "加旗标后 column_points 变了（旗标是只读后处理）"
