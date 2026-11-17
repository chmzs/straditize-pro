# -*- coding: utf-8 -*-
"""夸大列：外线断开的那几行，读数必须从内线补回来（内线 × 倍率）。

## 缺陷背景（现场图 `.recon_20261117`，用户已确认的物理事实）

Picea/Pinus/Betula/Quercus 四列把同一组数据画了**两层**：贴轴的填充/曲线（**内线** =
真值，实测宽 4–8px）与外侧放大曲线（**外线** = 真值 × `exaggeration_mult`，本图 5×），
两层在若干行相接、构成**同一个连通域**（读数口径"本行最右墨迹"因此读到外线）。
`px_to_value` 再除以倍率得真值。

外线在部分行**印刷断裂**（实测 Quercus y=1212–1221 连续 10 行、Picea 30 行）。这些行的
最右墨迹退化成内线，除倍率后只有真值的 1/5 —— 图上因此出现并不存在的低谷。

## 判据（合成图，几何完全可控）

轴 6px（x 10..15）、0 点 x=16、内线右缘 x=26（距 0 点 **10px**）、外线 x=66
（距 0 点 **50px**）、斜率 1.0 %/px、倍率 5。于是真值 = 10.0，读数 = 外线距/5 = 10.0。

| 用例 | 画法 | 期望 |
|:--|:--|:--|
| 1 有外线 | 每行都有外线 | 读数 **10.0**、`source="read"`、`broken_rows == []` |
| 2 外线缺失 | 整列不画外线 | 读数 **10.0**（不是 2.0）、`source="broken_inner"`、该行进 `broken_rows` |
| 3 无倍率 | 单层填充，列上没有倍率 | x **逐行等于改动前的墨迹右缘 26.0**、无 `source` 字段、`broken_rows == []` |
| 3b 无倍率 + 两层 | 有外线但列上没有倍率 | x **= 外线 66.0**（检测根本不启动）、无 `source` 字段 |
| 4 连续断裂 | 外线在第 10–19 行不画 | 这 10 行全部进 `broken_rows`、读数都在 10.0±1；两侧有外线的行仍是 10.0 |

用例 1/2/4 各跑两遍：倍率写在**列**上、写在**组**上（`x_groups[i]["exaggeration_mult"]`）。
两处都得给出同一个读数——解析优先级（列 > 组 > 历史键）属于 `xscale.py` 的事，
这里只钉"补偿用的是解析后的那个倍率"。

## 取样窗口的最后一行（`Y1`）不参与断言

既有行为：连通域标注比取样窗口少一行，`Y1` 的读数恒回落 `c_start`（同一现象在
`tests/unit/test_solid_block_frame_line.py` 里已登记）。它与本缺陷无关，因此价值断言与
`broken_rows` 的期望都取 `Y0..Y1-1`。

## 反向验证

1. 把 `_compensate_broken_inner_rows` 里的补偿行删掉（或改成只标 `source` 不改 `x`）→
   用例 2 / 4 读到 (26−16)×1.0/5 = **2.0** → 本文件变红。
2. 把倍率解析改成直接读 `col["exaggeration_mult"]` → 组级那一遍读到 2.0 → 变红。
3. `broken_rows` 的期望按行号整段比较（equality，不是"非空"）：漏判任何一行都红。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

W, H = 120, 200
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W               # 16 —— 0 点（轴线右缘）
INNER_X1 = ZERO_X + 10                  # 26 —— 内线右缘，距 0 点 10px
OUTER_X = ZERO_X + 50                   # 66 —— 外线，距 0 点 50px
Y0, Y1 = 40, 160
#: 参与断言的行（去掉取样窗口最后一行，见模块 docstring）。
ASSERTED_ROWS = range(Y0, Y1)
SLOPE = 1.0                             # %/px
MULT = 5.0
TRUE_VALUE = 10.0                       # = (INNER_X1 - ZERO_X) × SLOPE
SAMPLE_ROWS = (Y0, Y0 + 1, (Y0 + Y1) // 2, Y1 - 1)


def _draw_plate(
    path,
    *,
    outer_rows: set[int] | None = None,
    connector_rows: set[int] | None = None,
) -> None:
    """轴(6px) + 通高内线填充 + 可选外线（`outer_rows` 内的行）。

    `connector_rows` 是"外线与填充相接"的行：现场图里两层是**同一个连通域**（外线在若干
    行与填充相碰），`_own_run_last_offset` 因此才会把"本行最右墨迹"判给外线。少了这几行
    桥接，外线会变成独立连通域，读数退回内线 —— 那就不是现场图的画法了。
    """
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0
    img[Y0 : Y1 + 1, ZERO_X : INNER_X1 + 1] = 0
    for row in outer_rows or set():
        img[row, OUTER_X] = 0
    for row in connector_rows or set():
        img[row, ZERO_X : OUTER_X + 1] = 0
    Image.fromarray(img).save(path)


def _session(
    tmp_path, *, outer_rows=None, connector_rows=None, mult=None, mult_on="column"
):
    plate = tmp_path / f"plate_{mult_on}_{'outer' if outer_rows else 'plain'}.png"
    _draw_plate(plate, outer_rows=outer_rows, connector_rows=connector_rows)
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
    if mult is not None and mult_on == "group":
        group["exaggeration_mult"] = mult
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
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "taxon",
            "species": "taxon",
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
            # 两点刻度：0 点在轴线右缘（x=16），1px = 1.0 个单位。
            "x_ticks": [
                {"px": float(ZERO_X), "value": 0.0},
                {"px": float(ZERO_X + 1), "value": SLOPE},
            ],
        }
    ]
    if mult is not None and mult_on == "column":
        session.columns[0]["exaggeration_mult"] = mult
    session.data_ylim = [float(Y0), float(Y1)]
    return session


def _read_rows(session):
    """返回 (逐行读数, broken_rows, 逐行点字典)。"""
    result = session.digitize(0, reader_type="area")
    scale = resolve_column_scale(session, session.columns[0], 0)
    points = {int(p["row"]): p for p in result["points"]}
    values = {
        row: scale.px_to_value(
            float(p["x"]), baseline_px=scale.abs_px0, require_calibrated=False
        )
        for row, p in points.items()
    }
    return values, list(result["broken_rows"]), points


MULT_LOCATIONS = ["column", "group"]


@pytest.mark.parametrize("mult_on", MULT_LOCATIONS)
def test_outer_line_present_reads_the_outer_line(tmp_path, mult_on):
    """有外线的行：读数 = 外线距/倍率 = 10.0，不该被当断线补。"""
    session = _session(
        tmp_path,
        outer_rows=set(range(Y0, Y1 + 1)),
        connector_rows={Y0},
        mult=MULT,
        mult_on=mult_on,
    )
    values, broken_rows, points = _read_rows(session)
    assert broken_rows == [], f"有外线的列不该有断线行，实际 {broken_rows}"
    for row in SAMPLE_ROWS:
        assert abs(values[row] - TRUE_VALUE) <= 1.0 * SLOPE, (
            f"row {row}: 读数 {values[row]} 期望 {TRUE_VALUE}（读到的 x={points[row]['x']}）"
        )
    sources = {points[row].get("source") for row in ASSERTED_ROWS}
    assert sources == {"read"}, "有外线且带倍率的列，每行都标 read"


@pytest.mark.parametrize("mult_on", MULT_LOCATIONS)
def test_missing_outer_line_falls_back_to_inner_times_multiplier(tmp_path, mult_on):
    """整列没有外线：读数必须 10.0（内线 × 倍率），而不是 2.0（内线 / 倍率）。"""
    session = _session(tmp_path, outer_rows=None, mult=MULT, mult_on=mult_on)
    values, broken_rows, points = _read_rows(session)
    assert broken_rows == list(ASSERTED_ROWS), "整列没画外线 → 每一行都是断线"
    for row in SAMPLE_ROWS:
        assert abs(values[row] - TRUE_VALUE) <= 1.0 * SLOPE, (
            f"row {row}: 读数 {values[row]} 期望 {TRUE_VALUE}（补偿缺失时是 2.0）"
        )
        assert points[row]["source"] == "broken_inner"
        assert points[row]["x"] == pytest.approx(
            float(ZERO_X + 10 * MULT)
        ), "x 必须等于外线该在的位置 z0 + (x_in − z0) × mult"


@pytest.mark.parametrize("mult_on", MULT_LOCATIONS)
def test_continuous_break_span_is_fully_compensated(tmp_path, mult_on):
    """外线在第 10–19 行不画：这 10 行全进 broken_rows，读数仍是 10.0。"""
    break_rows = set(range(Y0 + 10, Y0 + 20))
    session = _session(
        tmp_path,
        outer_rows=set(range(Y0, Y1 + 1)) - break_rows,
        connector_rows={Y0, Y1 - 5},  # 断口两侧都接到填充，外线仍是同一连通域
        mult=MULT,
        mult_on=mult_on,
    )
    values, broken_rows, points = _read_rows(session)
    assert broken_rows == sorted(break_rows), f"断裂段行号不符：{broken_rows}"
    for row in sorted(break_rows):
        assert abs(values[row] - TRUE_VALUE) <= 1.0 * SLOPE, (
            f"row {row}: 读数 {values[row]} 期望 {TRUE_VALUE}（补偿缺失时是 2.0）"
        )
        assert points[row]["source"] == "broken_inner"
    for row in (Y0 + 5, Y0 + 9, Y0 + 20, Y0 + 25):
        assert abs(values[row] - TRUE_VALUE) <= 1.0 * SLOPE, (
            f"row {row}: 断口两侧有外线的行读数 {values[row]} 期望 {TRUE_VALUE}"
        )
        assert points[row]["source"] == "read"


def test_column_without_multiplier_keeps_every_reading_unchanged(tmp_path):
    """零回归：没有倍率的普通单层列，x 逐行等于墨迹右缘，且点里不许多出字段。"""
    session = _session(tmp_path, outer_rows=None, mult=None)
    values, broken_rows, points = _read_rows(session)
    assert broken_rows == [], "没有倍率就不存在'外线缺失'，不许产生断线行"
    for row in ASSERTED_ROWS:
        assert points[row]["x"] == float(INNER_X1), "读数必须还是改动前的墨迹右缘"
        assert "source" not in points[row], "普通列的点字典必须与改动前逐字节相同"
    assert abs(values[Y0] - TRUE_VALUE) <= 1.0 * SLOPE


def test_two_layer_column_without_multiplier_keeps_reading_the_outer_line(tmp_path):
    """零回归：有两层结构但没有倍率时，检测根本不启动，读数还是最右墨迹（外线）。"""
    session = _session(
        tmp_path, outer_rows=set(range(Y0, Y1 + 1)), connector_rows={Y0}, mult=None
    )
    values, broken_rows, points = _read_rows(session)
    assert broken_rows == []
    for row in ASSERTED_ROWS:
        assert points[row]["x"] == float(OUTER_X), "没有倍率 → 不做任何补偿"
        assert "source" not in points[row]
    assert abs(values[Y0] - (OUTER_X - ZERO_X) * SLOPE) <= 1.0 * SLOPE
