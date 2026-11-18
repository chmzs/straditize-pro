"""Quality Assurance (QA) and Geological Diagnostics Core (T09).

Strictly adheres to Frozen Contracts v1.3 §2.7 (QaSummary) and §4 (Derived Quantities).

## 逐行诊断旗标（#91 / #92）

`compute_qa_flags` 是本模块的第二块产出：**纯后处理**，只读调用方已经算好的逐行像素
序列，不改任何一个读数，也不改 `px_to_value` / `read_column_values` 的任何输入。

| 旗标 | 判据 | 需要的数据 |
| --- | --- | --- |
| `FLAG_AXIS_BLIND` | `0 ≤ raw_span_px ≤ axis_stroke_px` | 逐行 x、0 点、轴宽 |
| `FLAG_TRUNCATED` | 触列右端 **且** 相邻行 |Δspan| ≤ 2px（平台，≥2 行） | 逐行 x、列右端 |
| `FLAG_COLLISION` | 触列右端 **且** 相邻行 |Δspan| 全部 > 2px（孤立单行突刺） | 同上 |
| `FLAG_EXAGG_RATIO` | `(outer−z0)/(inner−z0) ∉ [3.0, 5.5]` | 内线/外线成对读数（`inner_xs_px` / `outer_xs_px`） |

`FLAG_COLLISION` 的降级规则见 `_is_full_scale_bar_row`：满量程横柱触边是合法几何，
必须用「该列是否逐行等宽（柱状）」+「该行是否满量程」两个结构条件放行，否则每一根
100% 的柱子都会变成永久误报。

## 逐行序列的来历

`columns_info[i]` 的 `rows_px` / `xs_px` / `inner_xs_px` / `outer_xs_px` 由
`session_parts/qa.py::_qa_column_values` 从 `column_points` 原样搬来。**由控制点插值
合成**的列（`control_point_columns`）拿不到实测像素，这些列的旗标一律标 `skipped`
（reason=`points_synthesized_from_control_points`），不给"看起来正常"的结论——插值
出来的 x 不是读数。

`inner_xs_px` / `outer_xs_px` 是 **#99 之前不存在的数据源**，落库键契约见
`session_parts/layers.py` 的模块 docstring：只有 `exaggeration_mult > 1` 的列、且只有
同一行墨迹里**两条线都在**的行才有这对读数。因此下列情况都是**正常的"没有读数"**，
整列标 `skipped`，绝不补 0：

- 单层列（没有倍率 → 没有"两层"这件事）；
- 外线整列断裂（每一行都只剩内线，外线位置是算出来的，不是测出来的）；
- 旧工程载入后还没重新数字化（工程包存控制点，稠密点不入库）；
- 控制点插值合成的列。

补 0 会得到 `ratio = 0`（或 `0/0`），把"没有读数"伪装成一条 `FLAG_EXAGG_RATIO` 假告警；
全 None 的数组则会伪装成"已判定、零告警"。两种都是把缺失当结论，故一律不写键。
"""

from __future__ import annotations

import math
from typing import Any, Sequence
import numpy as np

#: 旗标名。前端按名字分发，后端只在这里定名（`frontend/src/types/pollen.ts::QaFlagName`）。
FLAG_AXIS_BLIND = "FLAG_AXIS_BLIND"
FLAG_TRUNCATED = "FLAG_TRUNCATED"
FLAG_COLLISION = "FLAG_COLLISION"
FLAG_EXAGG_RATIO = "FLAG_EXAGG_RATIO"

FLAG_NAMES: tuple[str, ...] = (
    FLAG_AXIS_BLIND,
    FLAG_TRUNCATED,
    FLAG_COLLISION,
    FLAG_EXAGG_RATIO,
)

#: 每块旗标最多带回的逐行明细条数（完整计数在 `count` / `by_column` 里，不受此限）。
#: 一列可有上千行，10 列就是上万条字典；口径是"给人看前 N 条 + 完整计数"。
FLAG_ROWS_CAP = 50

#: 触边判定容差（px）。读数的 x 是列窗内最右墨迹的**索引**，取值域是
#: `[c_start, c_end - 1]`（列窗右开），所以"墨迹顶到列右端"在像素上恰是
#: `x == c_end - 1`，即 `span == full_span - 1`。容差取 1.0 正好覆盖这一个量化单位：
#: 再大一点就会把"离右端 3px 的正常峰"也判成触边。
EDGE_TOL_PX = 1.0

#: 相邻行"平坦"的容差（px）。issue #91 的原始口径是 |Δ| ≤ 2px：一像素宽的量化抖动
#: 不算变化，超过 2px 的相邻落差说明这是一个尖峰，不是被削平的平台。
FLAT_DELTA_PX = 2.0

#: 柱状列的结构判据：相邻行 x 完全相等的行对数占比 ≥ 该阈值。
#: 物理依据：柱状/条带画法把每个采样层画成一根横柱，柱内各行宽度**逐像素相同**
#: （digitize 的 `bar` 读取器读柱子右缘，同一根柱子里 x 是常数），实测这类列
#: 大多数相邻行对 Δx == 0；而面积图/曲线逐行渐变（Δx 中位数 ≥ 1px）。
#: 0.5 是"过半"这条最弱的多数判据：它只要求该列**主要是**阶梯结构，
#: 不要求整列严格等宽——真实剖面里柱与柱之间必然有跳变。
BAR_ZERO_STEP_FRACTION = 0.5

#: 柱状列的满量程**不由百分比阈值表达**：读数的 x 落在列窗右开的 `[c_start, c_end-1]`，
#: 所以"触边"本身就是"span = full_span − 1px"，在正常列宽下等价于 ≥ 98% 列宽。
#: 早期草案里写过 `span ≥ 0.95 × full_span` 的满量程门，实测它**永远为真**（被触边覆盖），
#: 而在窄列（full_span < 20px）上反而会误拒——15px 宽的列里 1px 就是 6.7% 量程，
#: 触边行只到 93%，于是合法满量程柱被当成碰撞。故删除该门，满量程语义由"触边"承载。

#: 柱状画法的 `plot_type` 取值（`session_parts/digitize.py` 的 `bar` / 历史别名 `bars`）。
BAR_PLOT_TYPES: tuple[str, ...] = ("bar", "bars")

#: 夸大倍率的可信区间（issue #91 实测：S1 图内 93.5% 的行落在其中，6.5% 在外）。
EXAGG_RATIO_RANGE: tuple[float, float] = (3.0, 5.5)


def _is_number(value: Any) -> bool:
    """有限的数值（排除 bool / None / NaN / inf）。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))


def _flag_block(
    flag: str,
    criterion: str,
    *,
    rows: Sequence[dict[str, Any]] = (),
    skipped: Sequence[dict[str, Any]] = (),
    structure: Sequence[dict[str, Any]] = (),
    downgraded: int = 0,
    n_columns: int = 0,
    reason: str = "",
    missing: Sequence[str] = (),
) -> dict[str, Any]:
    """一块旗标的统一结构。四块旗标**字段完全相同**，前端不需要按块分支。"""
    all_rows = list(rows)
    by_column: dict[str, int] = {}
    for row in all_rows:
        key = str(row.get("column", ""))
        by_column[key] = by_column.get(key, 0) + 1
    kept = all_rows[:FLAG_ROWS_CAP]
    evaluated = n_columns - len(skipped)
    if n_columns <= 0:
        status, reason = "skipped", "roi_has_no_columns"
    elif evaluated <= 0:
        status, reason = "skipped", reason or "no_evaluable_column"
    else:
        status = "computed"
    return {
        "flag": flag,
        "status": status,
        "criterion": criterion,
        "count": len(all_rows),
        "by_column": by_column,
        "rows": kept,
        "rows_omitted": len(all_rows) - len(kept),
        "skipped_columns": list(skipped),
        "structure": list(structure),
        "downgraded_low_priority": int(downgraded),
        "columns_evaluated": max(0, evaluated),
        "reason": reason,
        "missing": list(missing),
    }


def _column_series(col: dict[str, Any]) -> list[tuple[int, float]] | None:
    """把 `rows_px` / `xs_px` 配成按行号升序的 `(row, x_px)` 序列；缺一即 None。"""
    rows = col.get("rows_px")
    xs = col.get("xs_px")
    if not rows or not xs or len(rows) != len(xs):
        return None
    try:
        series = [(int(r), float(x)) for r, x in zip(rows, xs)]
    except (TypeError, ValueError):
        return None
    series.sort(key=lambda pair: pair[0])
    return series


def compute_qa_flags(columns_info: Sequence[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """逐行诊断旗标。**只读**：不改读数，不改 `columns_info`。

    每个列字典需要的键（其余键忽略）：

    - `name`：列名（旗标归属）；
    - `rows_px` / `xs_px`：该列逐行行号与**原始像素 x**（绝对坐标，与 `column_points` 同源）；
    - `zero_px`：0 点绝对像素（= `ColumnScale.abs_px0`，列左缘 + 轴粗）；
    - `right_px`：列右端绝对像素（= 列 `end`，绘图区右界）；
    - `axis_px`：轴宽像素（`axis_stroke_px`）；**None 表示两处都没写**，此时不做
      `FLAG_AXIS_BLIND` 判定 —— `resolve_axis_stroke` 的 5.0 默认值不是实测值，
      拿它算出来的"盲区"是编的；
    - `plot_type`：`bar` / `bars` / `area` …（柱状结构判定）；
    - `points_provenance`：`measured` | `control_point`（插值列不判定）；
    - `anchor_edited`：该列有没有被锚点编辑过（只进 `structure` 明细，供人复核）；
    - `origin_suspect`：0 点是否被写偏（`ColumnScale.origin_suspect`）。真则**不做**
      `FLAG_AXIS_BLIND`：0 点不可信时，`span = x − 0点` 整个偏一个轴宽，
      真实工程与 baseline 图上都会变成"几乎每行都落在轴线里"的假告警；
    - `inner_xs_px` / `outer_xs_px`：内线 / 外线**同一行各自的右缘绝对像素**，与
      `rows_px` 逐位对齐，没有成对读数的行该位置是 `None`。**整列没有这对键就是
      "没有读数"**（单层列 / 外线整列断裂 / 旧工程未重新数字化），整列标 `skipped`；
      键在但一行数值都没有，同样按 `skipped` 处理——不拿 `None`/0 顶替算出一个
      `ratio`。落库与键契约见 `session_parts/layers.py`。

    缺 `rows_px` / `xs_px` / `zero_px` / `right_px` 的列整列跳过（`skipped_columns`），
    不按 0 或列宽兜底 —— 兜底出来的旗标和兜底出来的读数一样不可信。
    """
    blind_rows: list[dict[str, Any]] = []
    blind_skipped: list[dict[str, Any]] = []
    truncated_rows: list[dict[str, Any]] = []
    collision_rows: list[dict[str, Any]] = []
    edge_skipped: list[dict[str, Any]] = []
    structure: list[dict[str, Any]] = []
    downgraded = 0
    exagg_rows: list[dict[str, Any]] = []
    exagg_skipped: list[dict[str, Any]] = []
    declared_mults: dict[str, float] = {}

    columns = list(columns_info or [])
    for col in columns:
        name = str(col.get("name") or "")
        mult = col.get("exaggeration_mult")
        if _is_number(mult) and float(mult) > 1.0:
            declared_mults[name] = float(mult)

        series = _column_series(col)
        zero_px = col.get("zero_px")
        right_px = col.get("right_px")
        geometry_ok = (
            _is_number(zero_px)
            and _is_number(right_px)
            and float(right_px) > float(zero_px)
        )
        if series is None or not geometry_ok:
            reason = "no_row_series" if series is None else "column_geometry_missing"
            blind_skipped.append({"column": name, "reason": reason})
            edge_skipped.append({"column": name, "reason": reason})
            # 没有逐行序列 / 没有列几何，同样没有内外线成对读数可言：四块旗标的
            # `columns_evaluated` 必须用同一份"能不能判"的口径，否则这块会把"判不了"
            # 的列算成"判过了、零告警"。
            exagg_skipped.append({"column": name, "reason": reason})
            continue
        if str(col.get("points_provenance") or "measured") != "measured":
            reason = "points_synthesized_from_control_points"
            blind_skipped.append({"column": name, "reason": reason})
            edge_skipped.append({"column": name, "reason": reason})
            exagg_skipped.append({"column": name, "reason": reason})
            continue

        zero = float(zero_px)
        full_span = float(right_px) - zero
        by_row = {row: x for row, x in series}

        # --- FLAG_AXIS_BLIND：0 ≤ 原始跨度 ≤ 轴宽 --------------------------------
        axis_px = col.get("axis_px")
        if bool(col.get("origin_suspect", False)):
            # 0 点本身就被人写进了轴线带内（`ColumnScale.origin_suspect`），
            # 于是 span 系统性少一个轴宽 —— 几乎每一行的墨迹都会被算成"落在轴线里"。
            # 这不是数据点的问题，是 0 点的问题：先修标定，再谈盲区。
            blind_skipped.append({"column": name, "reason": "zero_point_suspect"})
        elif not _is_number(axis_px):
            blind_skipped.append({"column": name, "reason": "axis_width_unset"})
        else:
            axis = float(axis_px)
            for row, x_px in series:
                span = x_px - zero
                # span < 0 是"这一行没有墨迹"（digitize 给 c_start），归 empty_horizons 管，
                # 不是盲区微值——把两者混在一起会让每条空行都变成盲区告警。
                if 0.0 <= span <= axis:
                    blind_rows.append(
                        {
                            "flag": FLAG_AXIS_BLIND,
                            "column": name,
                            "row_px": row,
                            "span_px": round(span, 2),
                            "axis_px": round(axis, 2),
                        }
                    )

        # --- 结构判定：这一列是不是"逐行等宽"的柱状列 --------------------------
        plot_type = str(col.get("plot_type") or "")
        # 只统计**行号相邻**（差 1）的行对：中间缺行时两端的差值是跨行的，把它算进
        # "逐行等宽"会同时污染分子与分母（真实工程里缺行 = 那一层没有墨迹）。
        steps = [
            abs(series[i + 1][1] - series[i][1])
            for i in range(len(series) - 1)
            if series[i + 1][0] - series[i][0] == 1
        ]
        zero_step_fraction = (
            sum(1 for step in steps if step <= 1e-9) / len(steps) if steps else 0.0
        )
        bar_structure = (
            plot_type in BAR_PLOT_TYPES
            and zero_step_fraction >= BAR_ZERO_STEP_FRACTION
        )

        # --- FLAG_TRUNCATED / FLAG_COLLISION：触边后的两种形态 ------------------
        edge_hit = False
        for row, x_px in series:
            span = x_px - zero
            if span < full_span - EDGE_TOL_PX:
                continue
            edge_hit = True
            neighbour_deltas = [
                abs(by_row[r] - x_px) for r in (row - 1, row + 1) if r in by_row
            ]
            if _is_full_scale_bar_row(
                neighbour_deltas=neighbour_deltas,
                bar_structure=bar_structure,
            ):
                downgraded += 1
                continue
            record = {
                "column": name,
                "row_px": row,
                "span_px": round(span, 2),
                "full_span_px": round(full_span, 2),
                "neighbour_delta_px": [round(d, 2) for d in neighbour_deltas],
                "plot_type": plot_type,
                "zero_step_fraction": round(zero_step_fraction, 3),
            }
            # 平台与突刺的分界用"**至少一侧**平坦"，而不是"两侧都平坦"：
            # 被削平的平台首/末行，另一侧接着上升或下降的曲线（Δ 很大），
            # 两侧都要求平坦会把同一个物理特征拆成"中间叫截断、边缘叫碰撞"。
            # 用"至少一侧"，平台 = 相邻行中至少一行同高（长度 ≥ 2 行），
            # 孤立突刺 = 相邻行全都离得很远（单行残留横线），两类互斥且各自稳定。
            if any(delta <= FLAT_DELTA_PX for delta in neighbour_deltas):
                record["flag"] = FLAG_TRUNCATED
                truncated_rows.append(record)
            else:
                record["flag"] = FLAG_COLLISION
                collision_rows.append(record)
        if edge_hit:
            structure.append(
                {
                    "column": name,
                    "plot_type": plot_type,
                    "zero_step_fraction": round(zero_step_fraction, 3),
                    "bar_structure": bool(bar_structure),
                    "anchor_edited": bool(col.get("anchor_edited", False)),
                    "full_span_px": round(full_span, 2),
                }
            )

        # --- FLAG_EXAGG_RATIO：内线 / 外线成对读数（#99）------------------------
        # 数据源是 `column_points` 点字典上的 `inner_xs_px` / `outer_xs_px`（键契约与
        # 落库位置见 `session_parts/layers.py`）：只有"同一行墨迹里两条线都在"的行才有
        # 这对读数，没有读数的行**不写键**。因此"缺这对键"与"键在但没有一行带数值"
        # 都表示**没有读数**，整列标 skipped —— 补 0 会得到 ratio = 0 的假告警，
        # 补 None 会得到"已判定、零告警"，两种都是把缺失当结论。
        inner = col.get("inner_xs_px")
        outer = col.get("outer_xs_px")
        rows = col.get("rows_px") or []
        if (
            inner is None
            or outer is None
            or len(inner) != len(outer)
            or len(inner) != len(rows)
        ):
            exagg_skipped.append(
                {"column": name, "reason": "no_paired_inner_outer_readings"}
            )
        else:
            n_pairs = 0
            for row, inner_x, outer_x in zip(rows, inner, outer):
                if not (_is_number(inner_x) and _is_number(outer_x)):
                    continue
                inner_dist = float(inner_x) - zero
                outer_dist = float(outer_x) - zero
                if inner_dist <= 0.0:
                    continue
                n_pairs += 1
                ratio = outer_dist / inner_dist
                if EXAGG_RATIO_RANGE[0] <= ratio <= EXAGG_RATIO_RANGE[1]:
                    continue
                exagg_rows.append(
                    {
                        "flag": FLAG_EXAGG_RATIO,
                        "column": name,
                        "row_px": int(row),
                        "ratio": round(ratio, 3),
                        "inner_span_px": round(inner_dist, 2),
                        "outer_span_px": round(outer_dist, 2),
                    }
                )
            if n_pairs == 0:
                exagg_skipped.append(
                    {"column": name, "reason": "no_paired_inner_outer_readings"}
                )

    n_columns = len(columns)
    return {
        FLAG_AXIS_BLIND: _flag_block(
            FLAG_AXIS_BLIND,
            "0 <= raw_span_px <= axis_stroke_px",
            rows=blind_rows,
            skipped=blind_skipped,
            n_columns=n_columns,
        ),
        FLAG_TRUNCATED: _flag_block(
            FLAG_TRUNCATED,
            "span_px >= full_span_px - 1px AND any neighbour |dx| <= 2px",
            rows=truncated_rows,
            skipped=edge_skipped,
            structure=structure,
            downgraded=downgraded,
            n_columns=n_columns,
        ),
        FLAG_COLLISION: _flag_block(
            FLAG_COLLISION,
            "span_px >= full_span_px - 1px AND all neighbour |dx| > 2px",
            rows=collision_rows,
            skipped=edge_skipped,
            structure=structure,
            downgraded=downgraded,
            n_columns=n_columns,
        ),
        FLAG_EXAGG_RATIO: _flag_block(
            FLAG_EXAGG_RATIO,
            "ratio = (outer_px - z0) / (inner_px - z0) NOT IN [3.0, 5.5]",
            rows=exagg_rows,
            skipped=exagg_skipped,
            n_columns=n_columns,
            reason="no_paired_inner_outer_readings",
            missing=[
                "per-row inner-line x (inner_xs_px)",
                "per-row outer-line x (outer_xs_px)",
            ],
        ),
    }


def _is_full_scale_bar_row(
    *,
    neighbour_deltas: Sequence[float],
    bar_structure: bool,
) -> bool:
    """#92 的降级判据：这一行是不是"合法打到满刻度的横柱"。

    两条同时成立才降级（放行，既不报 `FLAG_COLLISION` 也不报 `FLAG_TRUNCATED`）：

    1. `bar_structure`（**结构条件，唯一真正起判别作用的那条**）：该列
       `plot_type ∈ {bar, bars}`，且相邻行 `|Δx| == 0` 的行对占比 ≥
       `BAR_ZERO_STEP_FRACTION`（0.5）。物理含义就是 issue #92 要的
       "柱状图逐行等宽 vs 面积图渐变"：柱状画法把每个采样层画成一根横柱，
       柱体内部逐像素等宽，实测这类列大多数相邻行对 Δx 恰为 0；面积图/曲线
       逐行渐变（Δx 中位数 ≥ 1px），永远凑不到半数零步进。
    2. **该行至少有一侧相邻行（行号差 1 且都有点）与它等宽**：它落在一根柱体内部。

    这里**不设**百分比满量程门。原因有两条：
    - "触边"在这套数据上已经蕴含满量程：x 的取值域是列窗右开的
      `[c_start, c_end-1]`，触边即 `span = full_span - 1px`，正常列宽下 ≥ 98% 量程，
      任何 `≥95%` 的门都恒为真（写过的草案就是这样一条死条件）；
    - 窄列上它反而会误拒：15px 宽的列里 1px 就是 6.7% 量程，触边行只到 93%，
      合法满量程柱会被当成碰撞。量化单位不该被当成"没打满"。

    ## 为什么是"至少一侧等宽"而不是"两侧都等宽"

    柱体首行（柱子最上面那一行）的另一侧是上一根柱或空白，Δx 必然很大。要求两侧
    都等宽等于**给每一根柱子都造一条误报**——正是 #92 要消灭的那个行为。

    ## 误报/漏报边界

    - **漏报（已知且接受）**：柱状列里真有一根超过刻度的峰（>100%，图上被裁平），
      它的逐行 x 与合法满量程柱完全同形（都贴右端、都等宽），本判据无法区分，
      因此**不报**。用这个漏报换掉"每根满量程柱都永久误报"——后者会让旗标失去信噪比。
    - **误报**：面积图列若被手工标成 `plot_type="bar"`，且恰好有 ≥50% 的相邻行对
      像素级相等（很平的近似平台可以让 Δx==0 反复出现），会放行一次真实碰撞。
      缓解：`structure` 明细把 `zero_step_fraction` / `bar_structure` 摊开给人看，
      且 `anchor_edited` 标注该列被人工编辑过。
    - 只有一行的列（无相邻行）：`neighbour_deltas` 为空 → 不降级，按 `FLAG_COLLISION` 报。
    """
    if not bar_structure:
        return False
    if not neighbour_deltas:
        return False
    return any(delta <= 1e-9 for delta in neighbour_deltas)


def compute_qa_summary(
    roi_id: str,
    roi_name: str,
    composition: bool,
    horizons: Sequence[dict[str, Any]],
    columns_info: Sequence[dict[str, Any]],
    tolerance: float = 2.0,
) -> dict[str, Any]:
    """Compute QaSummary entity according to Frozen Contract v1.3 §2.7.

    Parameters:
    - roi_id: Identifier of the target ROI.
    - roi_name: Display name of the target ROI.
    - composition: If True, enforces abundance sum <= 100% (+ tolerance) gate.
    - horizons: List of horizon dicts, each containing:
        - "depth": float | None (physical depth or None if uncalibrated)
        - "values": Sequence[float] (readings across columns at this horizon)
    - columns_info: List of column info dicts, each containing:
        - "name": str (column name)
        - "declared_max": float (derived strictly from x_ticks, never from stored/defaults)
        - "col_values": Sequence[float] (values for this column across all horizons)
        以下键供逐行旗标使用（`compute_qa_flags`，缺列即该列整列跳过，不兜底）：
        - "rows_px" / "xs_px": 逐行行号与原始像素 x
        - "inner_xs_px" / "outer_xs_px": 内线 / 外线逐行右缘（与 `rows_px` 逐位对齐，
          没有成对读数的行是 None；**整列没有这对键 = 没有读数**，见 `compute_qa_flags`）
        - "zero_px" / "right_px" / "axis_px": 0 点 / 列右端 / 轴宽（绝对像素）
        - "plot_type" / "points_provenance" / "anchor_edited" / "exaggeration_mult"
    - tolerance: Allowed excess percentage for composition gate (default 2.0%).

    `flags` 的键集恒定（四块旗标永远都在，状态用 `status` 表达），空 ROI 与正常
    返回都给同一份结构 —— 前端不需要按"有没有数据"分支。
    """
    n_horizons = len(horizons)

    # 总和门只累加**百分比列**：`include_in_sum` 由调用方按列单位给出（`is_percent_unit`）。
    # 不设这个掩码时，一张同时含 `%` 与 `粒/g` 的剖面会把浓度（量级 1e4）加进"百分比总和"，
    # 于是本该是"超过 100% 的严肃告警"恒为假阳性（现场实测最大总和 87135.2%），
    # 用户会永久忽略这条告警。缺键时默认 True —— 老调用方与"全 % 工程"行为不变。
    sum_mask = [
        bool(col.get("include_in_sum", True)) for col in list(columns_info or [])
    ]
    excluded_columns = [
        str(col.get("name", ""))
        for col in list(columns_info or [])
        if not bool(col.get("include_in_sum", True))
    ]

    # Empty ROI / zero horizons case: return complete structure with 0 counts without error
    if n_horizons == 0:
        return {
            "roi_id": roi_id,
            "roi_name": roi_name,
            "composition": bool(composition),
            "n_horizons": 0,
            "n_horizons_with_data": 0,
            "n_horizons_empty": 0,
            "empty_horizons": [],
            "sum": {"min": 0.0, "p50": 0.0, "max": 0.0, "mean": 0.0},
            "tolerance": float(tolerance),
            "violations_over": [],
            "shortfall": {"min": 0.0, "max": 0.0, "mean": 0.0},
            "per_column_max": [],
            "sum_excluded_columns": excluded_columns,
            "flags": compute_qa_flags(columns_info),
        }

    empty_horizons: list[dict[str, Any]] = []
    sums: list[float] = []

    for h in horizons:
        vals = h.get("values", [])
        if vals and len(sum_mask) == len(vals):
            row_sum = float(sum(v for v, keep in zip(vals, sum_mask) if keep))
        else:
            row_sum = float(sum(vals)) if vals else 0.0
        sums.append(row_sum)

        # Check for empty horizon (all zero / no ink read)
        is_empty = len(vals) == 0 or all(abs(v) < 1e-9 for v in vals)
        if is_empty:
            empty_horizons.append(
                {
                    "depth": h.get("depth"),
                    "reason": "no ink read",
                }
            )

    n_horizons_empty = len(empty_horizons)
    n_horizons_with_data = n_horizons - n_horizons_empty

    # Sum statistics MUST include all-zero horizons
    sum_min = float(np.min(sums))
    sum_p50 = float(np.percentile(sums, 50))
    sum_max = float(np.max(sums))
    sum_mean = float(np.mean(sums))

    sum_dict = {
        "min": round(sum_min, 1),
        "p50": round(sum_p50, 1),
        "max": round(sum_max, 1),
        "mean": round(sum_mean, 1),
    }

    # Composition gate violations (only checked when composition == True)
    violations_over: list[dict[str, Any]] = []
    if composition:
        threshold = 100.0 + float(tolerance)
        for h, s in zip(horizons, sums):
            if s > threshold:
                violations_over.append(
                    {
                        "depth": h.get("depth"),
                        "sum": round(s, 1),
                    }
                )

    # Shortfall statistics: 100 - sum for horizons with data (excess horizons have 0 shortfall)
    if composition:
        data_sums = [s for s in sums if s > 1e-9]
        if data_sums:
            shortfalls = [max(0.0, 100.0 - s) for s in data_sums]
            shortfall_min = float(np.min(shortfalls))
            shortfall_max = float(np.max(shortfalls))
            shortfall_mean = float(np.mean(shortfalls))
            shortfall_dict = {
                "min": round(shortfall_min, 1),
                "max": round(shortfall_max, 1),
                "mean": round(shortfall_mean, 1),
            }
        else:
            shortfall_dict = {"min": 0.0, "max": 0.0, "mean": 0.0}
    else:
        shortfall_dict = {"min": 0.0, "max": 0.0, "mean": 0.0}

    # Per-column peak vs declared scale max
    per_column_max: list[dict[str, Any]] = []
    uncalibrated_columns: list[str] = []
    for col in columns_info:
        c_name = col.get("name", "")
        declared_max = float(col.get("declared_max", 0.0))
        c_vals = col.get("col_values", [])
        peak = float(np.max(c_vals)) if len(c_vals) > 0 else 0.0
        calibrated = bool(col.get("calibrated", declared_max > 0.0))
        if not calibrated:
            uncalibrated_columns.append(c_name)
        over = bool(calibrated and declared_max > 0.0 and peak > declared_max)
        per_column_max.append(
            {
                "name": c_name,
                "peak": round(peak, 1),
                "declared_max": round(declared_max, 1),
                "over": over,
                "calibrated": calibrated,
            }
        )

    return {
        "roi_id": roi_id,
        "roi_name": roi_name,
        "composition": bool(composition),
        "n_horizons": n_horizons,
        "n_horizons_with_data": n_horizons_with_data,
        "n_horizons_empty": n_horizons_empty,
        "empty_horizons": empty_horizons,
        "sum": sum_dict,
        "tolerance": float(tolerance),
        "violations_over": violations_over,
        "shortfall": shortfall_dict,
        "per_column_max": per_column_max,
        "n_uncalibrated": len(uncalibrated_columns),
        "uncalibrated_columns": uncalibrated_columns,
        "sum_excluded_columns": excluded_columns,
        "flags": compute_qa_flags(columns_info),
    }
