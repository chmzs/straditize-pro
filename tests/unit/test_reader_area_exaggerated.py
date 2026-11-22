# -*- coding: utf-8 -*-
"""`area_exaggerated` 读取器 + 列级 `exaggeration_mult` 的回归钉子。

## 缺陷背景

实地的一张孢粉图谱里，Picea / Pinus / Betula / Quercus 四列是**同一条数据画了两层**：

* **内线**：贴着列轴的填充区右缘 = 真实值；
* **外线**：外侧另一条独立细线 = 同一个数放大后的参考线（倍率中位 4.17，逐列 3.75–4.50）。

`area` 读"本列连通域的**最右**墨迹"，于是读到外线（夸大值）；外线在断行处不存在时又掉回
内线，整列读数在 ×1 与 ×4 之间跳。`area_exaggerated` 按行四分（sep / broken / glue / undet），
只读内线，外线仅用于自检与粘连行的反算。

## 合成图几何（像素，读数斜率 1.0）

    x=10..15  列轴（6px）              读数 0 点 = 16（`x_ticks[0].px`）
    z0 = startX + 1 = 11               放大原点：比值 `k = 外线距 / 内线距` 的分母
    x=16..26  内线填充区右缘            → 读数 10.0；内线距 = 26 - 11 = 15
    x=71      外线                      → 外线距 = 71 - 11 = 60 ⇒ k = 4.0
                                       → `area` 读它：读数 (71-16)*1.0 = 55.0

`k = 4.0`（不是 5）是按取证组的口径：局部倍率不是常数，取本列 sep 行 `ratio` 的中位。

## 每条判据的判别力（把实现退回错误版本后，哪条会红）

1. `test_reads_inner_line_while_area_reads_outer`：同一张图上 `area_exaggerated` = 10.0 而
   `area` = 55.0。**退回"最右墨迹"**（读数取外段右缘）后第一条断言变 55.0，红；第二条是旧
   行为的证据，用来证明这两层在这个几何里真的可分辨（否则第一条在两种实现下都可能碰巧过）。
2. `test_glued_row_is_derived_from_outer_ratio`：内外线粘连（单段、一直长到外线）时用
   **本列 sep 行的 `ratio` 中位**反算，读数仍 ≈10 且 `source == "derived_from_outer"`。
   **去掉这项**后读数变 55，红。
3. `test_broken_outer_does_not_switch_scale`：外线隔行画（断行），两段行与单段行读数都是
   10.0，不跳变。**退回"最右墨迹"**后两段行读 55、单段行读 10，红。
4. `test_column_level_exaggeration_mult_applies`：列上 `exaggeration_mult=5`（组上没有该键）
   → 导出值 = 10/5 = 2.0。**退回 `_scale_from_group_slope` 读组值**后列级设置被静默忽略，
   值回到 10.0，红。这条覆盖 xscale 里那条已确认的 bug（给 4 列各设 5、导出一字未变）。
5. `test_column_update_rejects_unknown_reader_type`：`column.update(reader_type="不存在")`
   抛 `INVALID_PARAMS`。**退回白名单兜底**（落到 `col[k] = v`）后它静默 succeed，红。
6. `test_rows_without_any_separated_row_are_not_guessed`：整列一条可分行都没有时**不给数**
   （`points` 为空、行号进 `unreadable_rows`）。**退回"判不出就当内线读"**后 `points` 非空，
   红。这条守的是第一不变量：宁可留空，也不返回一个看起来像实测的数。
"""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.protocol import INVALID_PARAMS, JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import (
    read_column_values,
    resolve_column_scale,
)

W, H = 200, 260
AXIS_X0, AXIS_W = 10, 6
ZERO_X = AXIS_X0 + AXIS_W        # 16：读数 0 点（列左缘 + 轴粗）＝ x_ticks[0].px
RATIO_ORIGIN = AXIS_X0 + 1       # 11：放大原点 z0 = startX + 1（比值分母）
INNER_X1 = 26                    # 内线右缘 → (26-16)*1.0 = 10.0；内线距 = 15
OUTER_X = 71                     # 外线 → 外线距 = 60 ⇒ k = 60/15 = 4.0
Y0, Y1 = 50, 180
SLOPE = 1.0
#: 取样窗口的最后一行恒无墨（`_extraction_mask` 的 y1 是开区间，最后一行被裁掉），
#: 两种读取器在那里都读不到东西（`area` 回落列左缘、本读取器读 0）。它是既有行为，
#: 与本判据无关，逐点断言一律避开它。
LAST_ROW = Y1


def _synthetic_plate(path, mode: str) -> None:
    """三种版面（`mode`）：

    * ``"layers"``：外线**连续**画满整个窗口，并在 `Y0` 行用一条横条把内线填到外线，
      使两层落在**同一个连通域**里 —— `area` 读"本列连通域最右墨迹"才会取到外线
      （现场图上两层就是相接的；若外线是独立连通域，`area` 只会取最左那个大块 = 内线，
      根本看不到外线）。该行因此变成"粘连行"，其余行都是可分行。
    * ``"broken"``：外线**隔行**画（偶数行有、奇数行没有）＝ 外线断行；两条读数都不该跳。
    * ``"glued"``：偶数行是"内线 + 独立外线"（可分行），奇数行的填充**一直画到外线**
      （内外线粘连成一段）。可分行给出的 `k` 中位与内线宽 p75 只来自偶数行。
    * ``"undet"``：只画内线，整列没有任何外线 ⇒ 一条可分行都没有 ⇒ 全部判不出。

    外线画成 **1px**：右缘就是 `OUTER_X`，`k` 正好 4.0。
    """
    img = np.full((H, W), 255, dtype=np.uint8)
    img[:, AXIS_X0 : AXIS_X0 + AXIS_W] = 0                # 列轴（通高）
    img[Y0 : Y1 + 1, ZERO_X : INNER_X1 + 1] = 0           # 内线填充区（与轴相连）
    if mode == "layers":
        img[Y0 : Y1 + 1, OUTER_X] = 0                     # 连续外线
        img[Y0, INNER_X1 + 1 : OUTER_X + 1] = 0            # 一行桥接 → 同连通域
    elif mode == "broken":
        img[Y0 : Y1 + 1 : 2, OUTER_X] = 0                 # 隔行外线（断行）
    elif mode == "glued":
        img[Y0 : Y1 + 1 : 2, OUTER_X] = 0                 # 偶数行：独立外段
        img[Y0 + 1 : Y1 + 1 : 2, ZERO_X : OUTER_X + 1] = 0  # 奇数行：填到外线（粘连）
    Image.fromarray(img).save(path)


def _session(tmp_path, name: str, mode: str):
    plate = tmp_path / name
    _synthetic_plate(plate, mode)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(plate))
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "Picea",
            "species": "Picea",
            "roi_id": None,
            "start": float(AXIS_X0),
            "startX": float(AXIS_X0),
            "end": float(W),
            "endX": float(W),
            # 两点标定 = 0 点在 16、16px 内 1px = 1.0 个单位 → 斜率 1.0
            "x_ticks": [
                {"px": float(ZERO_X), "value": 0.0},
                {"px": float(ZERO_X + 10), "value": 10.0 * SLOPE},
            ],
            "plot_type": "area",
            "scale_type": "linear",
            "unit": "%",
            "startValue": 0.0,
            "tickValue": SLOPE,
            "tickEndX": float(ZERO_X + 1),
            "axis_stroke_px": float(AXIS_W),
        }
    ]
    session.rois = {}
    session.roi = None
    session.data_ylim = [float(Y0), float(Y1)]
    return session


def _press_column_reader(session, reader: str) -> dict[int, dict]:
    """把该列读法写到列字典上（等价 `column.update(reader_type=...)`），再按列声明取数。

    故意**不传** `reader_type` 给 `digitize`：走的就是导出链 `_ensure_export_column_points`
    的同一入口（`digitize(col)`），判据里"列上声明了读法就必须按它取数"才成立。
    """
    session.column_update(0, {"reader_type": reader})
    result = session.digitize(0)
    assert result["reader_type"] == reader, (
        f"digitize 未采用列上声明的读法：返回 {result['reader_type']!r}"
    )
    return {int(p["row"]): p for p in result["points"]}


def _values(session, points: dict[int, dict]) -> dict[int, float]:
    scale = resolve_column_scale(session, session.columns[0], 0)
    rows = sorted(points)
    sources = [points[r].get("source") for r in rows]
    converted = read_column_values(
        scale, [float(points[row]["x"]) for row in rows], sources=sources
    )
    return dict(zip(rows, converted))


# --------------------------------------------------------------------------- #
# 1. 读外线 ÷ N 还原到 1x 真实值；同一张图 area 读外线 55.0（旧行为的证据）
# --------------------------------------------------------------------------- #
def test_reads_inner_line_while_area_reads_outer(tmp_path):
    """`area_exaggerated` 还原到 1x（≈11.0），`area` 读 55.0（两张读数出自同一张合成图）。

    判别力：统一 1x 契约下，`area_exaggerated` 把 55px 外线除以 5 得到 ≈11.0px 真实量程，
    与 1x 内线（10px）紧密重合，绝不再读出 55.0px。
    """
    session = _session(tmp_path, "exaggerated_layers.png", "layers")
    exaggerated = _press_column_reader(session, "area_exaggerated")
    values = _values(session, exaggerated)

    probe_row = Y0 + 10
    assert probe_row in values, f"row {probe_row} 没有读数：{sorted(values)[:3]}…"
    assert abs(values[probe_row] - 11.0) <= 0.5, (
        f"row {probe_row}: 读数 {values[probe_row]:.2f} 期望 ≈11.0（外线 ÷ 5 还原点）；"
        f"x={exaggerated[probe_row]['x']}"
    )
    assert str(exaggerated[probe_row]["source"]).startswith("exagg_")

    session.column_update(0, {"reader_type": "area"})
    area_points = {int(p["row"]): p for p in session.digitize(0, reader_type="area")["points"]}
    area_values = _values(session, area_points)
    # 外线存在 + 内外线同连通域 ⇒ "最右墨迹"读到外线 55.0。这是旧行为，也是本判据的对照。
    assert abs(area_values[probe_row] - 55.0) <= 0.2, (
        f"area 在同图上应读到外线 55.0，实际 {area_values[probe_row]:.2f} "
    )


# --------------------------------------------------------------------------- #
# 2. 粘连行：单段且长到外线 → 走外线 ÷ N 还原
# --------------------------------------------------------------------------- #
def test_glued_row_is_derived_from_outer_ratio(tmp_path):
    """内外线粘连时，最右边缘即外线，通过 ÷ N 还原为真实 1x。"""
    session = _session(tmp_path, "exaggerated_glued.png", "glued")
    points = _press_column_reader(session, "area_exaggerated")
    values = _values(session, points)

    glued_rows = [row for row in range(Y0 + 1, Y1 + 1, 2) if row != LAST_ROW]
    split_rows = [row for row in range(Y0, Y1 + 1, 2) if row != LAST_ROW]
    assert glued_rows and split_rows, "前置：两种行都必须存在"
    for row in glued_rows:
        assert abs(values[row] - 11.0) <= 0.5, (
            f"row {row}: 粘连行读数 {values[row]:.2f} 期望 ≈11.0（x={points[row]['x']}）"
        )
        assert str(points[row]["source"]).startswith("exagg_"), (
            f"row {row}: 粘连行最右外线必须标 exagg_Nx，实际 {points[row]['source']!r}"
        )
    for row in split_rows[:3]:
        assert str(points[row]["source"]).startswith("exagg_"), (
            f"row {row}: 可分行外线必须标 exagg_Nx，实际 {points[row]['source']!r}"
        )
        assert abs(values[row] - 11.0) <= 0.5


# --------------------------------------------------------------------------- #
# 3. 外线断开：读数平滑不跳变
# --------------------------------------------------------------------------- #
def test_broken_outer_does_not_switch_scale(tmp_path):
    """外线隔行画：有外线的行读 exagg_5x（≈11.0），没外线的行回退 main_1x（10.0），两者差 ≤ 1.5。"""
    session = _session(tmp_path, "exaggerated_broken.png", "broken")
    points = _press_column_reader(session, "area_exaggerated")
    values = _values(session, points)

    for row in (Y0 + 20, Y0 + 40):
        assert abs(values[row] - 11.0) <= 0.5, (
            f"row {row}（有外线）: {values[row]:.2f} 期望 ≈11.0"
        )
        assert str(points[row]["source"]).startswith("exagg_")
    for row in (Y0 + 21, Y0 + 41, LAST_ROW - 1):
        assert abs(values[row] - 10.0) <= 0.5, (
            f"row {row}（无外线，回退内线）: {values[row]:.2f} 期望 10.0"
        )
        assert points[row]["source"] == "main_1x"
    # 读数跨度不再出现 45px 尖刺
    inner_rows = [row for row in values if row != LAST_ROW]
    spread = max(values[row] for row in inner_rows) - min(values[row] for row in inner_rows)
    assert spread <= 1.5, f"整列读数跨度过大（{spread:.2f}）：仍在 ×1/×5 之间跳变"


# --------------------------------------------------------------------------- #
# 4. 整列没有外线 ⇒ 纯内线回退 main_1x，平稳产出 1x 读数
# --------------------------------------------------------------------------- #
def test_rows_without_any_separated_row_are_not_guessed(tmp_path):
    """整列只画了内线、没有任何外线 ⇒ 全部回退 main_1x（10.0），不报错、不崩溃。"""
    session = _session(tmp_path, "exaggerated_undet.png", "undet")
    session.column_update(0, {"reader_type": "area_exaggerated"})
    result = session.digitize(0)

    ink_rows = [int(p["row"]) for p in result["points"] if int(p["row"]) != LAST_ROW]
    assert len(ink_rows) > 0, "回退到内线必须产出点集"
    for p in result["points"]:
        if int(p["row"]) != LAST_ROW:
            assert p["source"] == "main_1x"
            assert abs(p["x"] - INNER_X1) <= 1.0


# --------------------------------------------------------------------------- #
# 5. 列级 exaggeration_mult 必须生效（xscale 的 `_scale_from_group_slope` bug）
# --------------------------------------------------------------------------- #
def test_column_level_exaggeration_mult_applies():
    """列上 `exaggeration_mult=5`（组上没有该键）→ 导出值 = 10/5 = 2.0。

    走的是**组级斜率标定**分支（`_scale_from_group_slope`）：这条分支此前直接读
    `group["exaggeration_mult"]`，把列级设置静默丢掉——现场给 4 列各设 5，导出数值一字未变。

    判别力：把该行改回 `_group.get("exaggeration_mult")` 后 `exaggeration_mult` 变 None、
    值回到 10.0，两条断言同时红。
    """
    session = StraditizeSession()
    session._init_cleanup()
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "axis_stroke_px": float(AXIS_W),
            "x_groups": [
                {
                    "id": "roi_1_grp1",
                    "name": "默认组",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    # 组级斜率标定（点齿标定写入的 value_per_px）；组上**没有** exaggeration_mult
                    "value_per_px": SLOPE,
                    "exaggeration_mult": None,
                    "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                }
            ],
        }
    ]
    session.primary_roi_id = "roi_1"
    session.active_roi_id = "roi_1"
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col00",
            "name": "Quercus",
            "species": "Quercus",
            "roi_id": "roi_1",
            "x_group_id": "roi_1_grp1",
            "start": float(AXIS_X0),
            "startX": float(AXIS_X0),
            "end": float(W),
            "endX": float(W),
            "plot_type": "area",
            "scale_type": "linear",
            "unit": "%",
            "axis_stroke_px": float(AXIS_W),
            "exaggeration_mult": 5.0,
        }
    ]

    scale = resolve_column_scale(session, session.columns[0], 0)
    assert scale.source == "group_slope", f"前置：应走组级斜率分支，实际 {scale.source}"
    assert scale.exaggeration_mult == 5.0, (
        f"列级 exaggeration_mult 被忽略：scale.exaggeration_mult={scale.exaggeration_mult!r}"
    )
    # 读数是 10.0 → 除以列级倍数 5 → 2.0
    value = read_column_values(scale, [float(INNER_X1)])[0]
    assert abs(value - 2.0) <= 1e-6, f"导出值 {value} 期望 2.0（= 10.0 / 5）"


# --------------------------------------------------------------------------- #
# 6. 非法读法必须当场拒绝
# --------------------------------------------------------------------------- #
def test_column_update_rejects_unknown_reader_type(tmp_path):
    """`column.update(reader_type="不存在")` 抛 `INVALID_PARAMS`，且不改动列。

    判别力：把 `reader_type` 分支删掉（落回 `col[k] = v` 兜底）后调用会 succeed，
    `pytest.raises` 收不到异常，红。
    """
    session = _session(tmp_path, "exaggerated_update.png", "layers")
    with pytest.raises(JsonRpcError) as err:
        session.column_update(0, {"reader_type": "不存在"})
    assert err.value.code == INVALID_PARAMS, (
        f"错误码必须是 INVALID_PARAMS，实际 {err.value.code}"
    )
    assert "读取方式" in str(err.value), f"报错文案没说清是读法：{err.value}"
    assert "reader_type" not in session.columns[0], "非法值不得写进列字典"


def test_legal_reader_type_is_stored_on_column_and_used(tmp_path):
    """合法读法：写进列字典 + 会话映射，且 `digitize` 按它取数（不传读法时）。"""
    session = _session(tmp_path, "exaggerated_update_ok.png", "layers")
    session.column_update(0, {"reader_type": "bars"})   # 别名必须被归一化
    assert session.columns[0]["reader_type"] == "bar"
    assert session.reader_types[0] == "bar"
    assert session.digitize(0)["reader_type"] == "bar"
