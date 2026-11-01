"""刻度尺几何检测：为 Step 6 提供"刻线间距 + 格数"，替代逐列人工判读。

## 为什么需要它

真实期刊图版（Han et al. 2026 Fig.3）的每个百分比列都有**独立刻度尺**，但：

* 只有 5/15 列在刻度尺下印了数字（`20`、`40`…）；
* 其余 10 列只有刻线、**没有数字**。

Step 6 当前要求用户对每列手工填两个读数（15 列 × 2 = 30 次判读），
对没有数字的列**根本无法完成**。于是用户只能猜，而猜就是编造读数
（违反 `docs/ARCHITECTURE.md` §2）。

本模块不解读数，只回答一个客观问题：**这一列的刻度尺长什么样**——
轴线在哪、刻线在哪、几格、格距多少、哪些刻线下印了数字。
有了它，前端就能：
  ① 显示"共 N 列 / 平均刻距 X px / 格数 [...]"，让用户一眼看出哪些列缺数字；
  ② 用户标定一列后，按**格数比例**给其余列生成**建议值**（必须经人确认才落库）。

## 检测规则（可判定，无魔数调参）

由真实图版实测确定（`output/han2026_ngamring/fig3_raw.jpeg`）：

1. **轴线**：该列横向贯穿的暗行（暗像素占列宽 ≥ 80%），取最靠下的一条；
2. **刻线**：轴线**下方** 3–10 px 区间内，逐列统计暗像素，≥ `min_tick_height` 的列即为一刻线；
3. **合并**：相邻 ≤1 px 的列合并为一个刻线（抗锯齿）。

刻线在轴线**下方**这一点是实测结论：初版按"上方"找，结果全图 0 检出。
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

#: 判定"暗"的灰度阈值。
DARK_THRESHOLD = 170
#: 刻线至少要有几行暗像素（窗口 (1,8) 共 7 行）。
#:
#: 实测：主齿 6–7 行、副齿 **3–4 行**（Cyperaceae 的 944/1019/1043/1068）。
#: 取 3 才能同时抓到主副齿；取 4 会漏掉多数副齿（Cyperaceae 只剩 7 格，真值 14 格）。
MIN_TICK_HEIGHT = 3
#: 轴线下方搜索刻线的区间（相对轴线行号，左闭右开）。
#:
#: 实测（Han et al. 2026 Fig.3）：轴线在 y=869；副齿延伸到 y=872（+1..+4），
#: 主齿延伸到 y=875（+1..+7）。故窗口取 (1, 8) —— 从紧贴轴线的下一行开始，
#: 覆盖到主齿末端。取 (3, 11) 会把副齿的 1–2 行切掉，副齿高度不足而漏检。
TICK_SEARCH_BELOW = (1, 8)
#: 判定某行是"轴线"所需的最低暗像素占比（相对列宽）。
#:
#: 实测取值依据（Han et al. 2026 Fig.3）：窄列的轴线两端有 1–2 px 白色间隙，
#: 覆盖率只有 **71%**（Pinus 列实测 27/38）；宽列可达 95%+。取 0.65 使两档都能命中，
#: 又不至于把"数据柱体"误判为轴线（柱体在轴线之上，且本函数只搜底部 15% 区域）。
AXIS_MIN_COVERAGE = 0.65


def _dark_columns(mask: np.ndarray) -> list[int]:
    """Return x centres of runs of `True` columns, merging gaps ≤1 px."""
    xs = np.where(mask)[0]
    if not len(xs):
        return []
    groups: list[list[int]] = [[int(xs[0])]]
    for x in xs[1:]:
        if x - groups[-1][-1] <= 1:
            groups[-1].append(int(x))
        else:
            groups.append([int(x)])
    return [int(round(sum(g) / len(g))) for g in groups]


def find_axis_row(
    gray: np.ndarray,
    x0: int,
    x1: int,
    *,
    dark_threshold: int = DARK_THRESHOLD,
    min_coverage: float = AXIS_MIN_COVERAGE,
    search_from: float = 0.70,
) -> int | None:
    """Locate the column's bottom axis row (the horizontal line the ruler hangs from).

    Searches the bottom ``1 - search_from`` fraction of the image, and returns the
    **lowest** row that is dark across at least ``min_coverage`` of ``[x0, x1)``.

    ``search_from`` 取 0.70 而非 0.85：柱状图的数据区可以一直画到接近底线，
    若只在最底部 15% 找，遇到"柱体紧贴轴线"的图版（本仓库内置教程图即如此）
    会把最后一根数据柱的顶边误当轴线。70% 起搜仍能排除上方标题区。
    """
    h, w = gray.shape
    lo = int(h * search_from)
    x0c, x1c = max(0, int(x0)), min(w, int(x1))
    if x1c <= x0c:
        return None
    band = gray[lo:h, x0c:x1c] < dark_threshold
    coverage = band.mean(axis=1)
    rows = np.where(coverage >= min_coverage)[0]
    if not len(rows):
        return None
    return int(rows.max()) + lo


def _find_axis_x(
    gray: np.ndarray,
    x0: float,
    x1: float,
    axis_row: int,
    *,
    dark_threshold: int = DARK_THRESHOLD,
    min_frac: float = 0.85,
) -> tuple[float | None, float | None]:
    """该列轴线（spine）的 x，返回 ``(左缘, 右缘)``。

    做法：在轴线上方的绘图主体里按行采样，取**贯穿 ≥min_frac 行数的最左暗列**——
    轴线是唯一满足这一条的竖线（文字标签只是局部暗，填充则起点就在轴线上）。

    **为什么不能直接用 ``col.start``**：列切分给的是列边界，实测它会落在轴线的左侧
    （beginner 图 col0 差 1px）或右侧（col1 差 6px），22 列图上偏差可到 20px。
    面积图的 0 点画在轴线上，所以锚点必须实测。

    右缘 = 左缘 + 描边宽度 - 1；描边宽度按各行「从轴线起的连续暗 run」的**最小值**估计
    （填充最薄那一行只剩描边），并夹到 1–6px。图上轴线描边普遍 1–3px，左/右缘之差
    折算成读数不到半个单位。
    """
    h, w = gray.shape
    top = max(0, int(axis_row * 0.15))
    bottom = max(top + 1, int(axis_row) - 4)
    step = max(1, (bottom - top) // 120)
    rows = list(range(top, bottom, step))
    lo = max(0, int(x0) - 8)
    hi = min(w, int(x1))
    if not rows or hi <= lo:
        return None, None

    counter = np.zeros(w, dtype=int)
    for r in rows:
        counter += (gray[r] < dark_threshold).astype(int)
    need = len(rows) * min_frac

    left: int | None = None
    for x in range(lo, hi):
        if counter[x] >= need:
            left = x
            break
    if left is None:
        return None, None

    run_lengths: list[int] = []
    for r in rows:
        run = 0
        for x in range(left, min(hi, left + 12)):
            if gray[r, x] < dark_threshold:
                run += 1
            else:
                break
        if run > 0:
            run_lengths.append(run)
    stroke = int(np.clip(min(run_lengths) if run_lengths else 1, 1, 6))
    return float(left), float(left + stroke - 1)


def detect_ruler(
    gray: np.ndarray,
    x0: int,
    x1: int,
    *,
    dark_threshold: int = DARK_THRESHOLD,
    min_tick_height: int = MIN_TICK_HEIGHT,
    search_below: tuple[int, int] = TICK_SEARCH_BELOW,
) -> dict[str, Any]:
    """Detect one column's tick ruler geometry.

    Returns a dict (never raises; unfound pieces are ``None`` / empty)::

        {
          "axis_row": int | None,
          "ticks": [int, ...],          # x centres, ascending
          "n_cells": int,               # len(ticks) - 1, 0 when undetectable
          "spacing_px": float | None,   # median gap between ticks
          "regular": bool | None,       # all gaps within 8% of the median
          "column_width": int,
        }
    """
    h, w = gray.shape
    result: dict[str, Any] = {
        "axis_row": None,
        "ticks": [],
        "n_cells": 0,
        "spacing_px": None,
        "regular": None,
        "column_width": int(x1 - x0),
        # 面积/柱状图的 0 点画在轴线（spine）上；`col.start` 只是列切分给的边界代理，
        # 实测可偏离轴线数个像素（22 列图上见过 6px）。故轴线位置单独实测。
        "axis_x": None,
        "axis_x_right": None,
    }

    axis = find_axis_row(gray, x0, x1, dark_threshold=dark_threshold)
    if axis is None:
        return result
    result["axis_row"] = axis

    axis_x, axis_x_right = _find_axis_x(
        gray, x0, x1, axis, dark_threshold=dark_threshold
    )
    result["axis_x"] = axis_x
    result["axis_x_right"] = axis_x_right

    lo = axis + search_below[0]
    hi = min(h, axis + search_below[1])
    if hi <= lo:
        return result

    x0c, x1c = max(0, int(x0)), min(w, int(x1))
    band = gray[lo:hi, x0c:x1c] < dark_threshold
    heights = band.sum(axis=0)
    ticks = [int(t) + x0c for t in _dark_columns(heights >= min_tick_height)]
    result["ticks"] = ticks

    if len(ticks) >= 2:
        gaps = [ticks[i + 1] - ticks[i] for i in range(len(ticks) - 1)]
        med = float(np.median(gaps))
        result["n_cells"] = len(gaps)
        result["spacing_px"] = round(med, 2)
        # 「规则」= 每个间隔都在中位数的 8% 以内（抗锯齿会产生 ±1px）
        result["regular"] = bool(all(abs(g - med) <= max(1.0, 0.08 * med) for g in gaps))
    return result


def detect_ruler_for_columns(
    gray: np.ndarray,
    columns: Sequence[dict[str, Any]],
    *,
    dark_threshold: int = DARK_THRESHOLD,
) -> dict[str, Any]:
    """Run :func:`detect_ruler` over a column list.

    ``columns`` items are the session's column dicts (need ``start``/``end``).
    Returns ``{per_column: [...], median_spacing_px, all_regular}``.
    """
    per_column: list[dict[str, Any]] = []
    spacings: list[float] = []
    for col in columns:
        x0 = float(col.get("start", col.get("startX", 0)))
        x1 = float(col.get("end", col.get("endX", 0)))
        geo = detect_ruler(gray, int(x0), int(x1), dark_threshold=dark_threshold)
        geo["col_index"] = col.get("col_index")
        geo["name"] = col.get("name")
        per_column.append(geo)
        if geo["spacing_px"]:
            spacings.append(float(geo["spacing_px"]))

    return {
        "per_column": per_column,
        "median_spacing_px": round(float(np.median(spacings)), 2) if spacings else None,
        "all_regular": (
            all(g["regular"] for g in per_column if g["regular"] is not None)
            if any(g["regular"] is not None for g in per_column)
            else None
        ),
    }


def suggest_scales(
    per_column: Sequence[dict[str, Any]],
    anchor_col_index: int,
    anchor_full_scale: float,
) -> list[dict[str, Any]]:
    """按「格数比例」外推各列满量程 —— **默认返回不可信标记**。

    ## 为什么要保留一个"不好用"的函数

    这是本项目一次真实的方法论事故，写在这里防止重犯：

    一开始的设想是「同一图版上各列刻度尺规格一致 ⟹ 满量程 ∝ 格数」，
    于是只需用户读一列，其余列全部推导出来。听起来很自然。

    **实测把它推翻了。** 以 Han et al. (2026) Fig.3 的 Cyperaceae（13 格，与论文
    reported max 70.07% 吻合）为锚点外推：

    | 列 | 刻距 | 格数 | 外推 | 论文 max | 误差 |
    | :--- | ---: | ---: | ---: | ---: | ---: |
    | Pinus | 13.0 | 2 | 10.78 | 40.74 | **−74%** |
    | Artemisia | 12.5 | 2 | 10.78 | 67.42 | **−84%** |
    | Poaceae | 13.0 | 3 | 16.17 | 9.21 | **+76%** |
    | Hippophae | 12.0 | 3 | 16.17 | 7.75 | **+109%** |
    | Caryophyllaceae | 19.0 | 2 | 10.78 | 4.29 | **+151%** |
    | Rosaceae | 12.5 | 2 | 10.78 | 12.97 | −17% |
    | Ranunculaceae | 12.5 | 2 | 10.78 | 14.00 | −23% |

    关键反证：`Artemisia` 的**刻距（12.5px）与锚点（13.0px）几乎相同，误差却 −84%**。
    所以「刻距相同」既不能推出「每格数值相同」，也不能当可靠性判据。

    **每格代表多少，是作图书版的设定，图上没有任何信息可以推出来。**
    任何跨列外推都是猜 —— 而猜就是编造读数（`docs/ARCHITECTURE.md` §2）。

    ## 因此本函数只做一件事：把猜测显式标成猜测

    所有条目的 ``suggested_full_scale`` 一律置 `None`，``confidence`` 一律 ``"none"``，
    并给出不用它的理由。**它不产生任何数字**，只把「本列格数」这一客观事实交出去，
    由 UI 展示给用户，让用户自己决定是否采用某个值并**显式署名**
    （见 ``docs/findings/agent-mcp-design.md`` 的 provenance 契约）。

    > 如果将来真的遇到"整张图由同一套刻度设定生成"的图版（例如同一作者的系列图），
    > 应由使用者**显式开启**该外推，并让结果带 `provenance=inferred_from_cells`。
    > 默认绝不开启。
    """
    out: list[dict[str, Any]] = []
    for col in per_column:
        cells = int(col.get("n_cells") or 0)
        out.append({
            "col_index": col.get("col_index"),
            "name": col.get("name"),
            "n_cells": cells,
            "spacing_px": col.get("spacing_px"),
            "suggested_full_scale": None,
            "confidence": "none",
            "reason": (
                "已拒绝按格数外推：实测同一图版上刻距相同的列量程可差 84%，"
                "每格数值无法从图上推得。请在图上读出该列刻度数字，或声明来源。"
            ),
        })
    return out
