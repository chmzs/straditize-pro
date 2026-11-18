"""Layers session mixin (exaggeration curves, issue #99).

# 双层读数（内线 / 外线）的键契约

夸大列把同一组数据画了两层：贴轴的填充或曲线（**内线** = 真值）与外侧放大曲线
（**外线** = 真值 × `exaggeration_mult`）。`FLAG_EXAGG_RATIO` 要判的正是"这条外线
真的画在倍率该在的位置吗"，因此它需要**同一行上两条线各自的右缘像素**。

这两个数在 `DigitizeSessionMixin._compensate_broken_inner_rows` 里本来就被量过
（判"外线断开"必须知道内线右缘与外线右缘），此前用完即弃。现在按下面的契约落库：

## 落库位置：`column_points[col_index]` 的**逐行点字典**

每个点原本是 `{"row", "x", "y"}`，落库后可能多出两个键：

| 键 | 值 | 含义 |
| --- | --- | --- |
| `inner_xs_px` | `float` | 内线右缘的**绝对列坐标**（与 `x` 同一坐标系，不是相对列宽的宽度） |
| `outer_xs_px` | `float` | 外线右缘的绝对列坐标 |

选 `column_points` 而不是 `columns_info` 的理由：

1. **这两条读数是逐行事实，不是列的属性**。`row` 是它的第一坐标，跟着行走才谈得上
   "这一行两条线间距对不对"；塞进列字典就得再配一份与 `rows_px` 对齐的平行数组，
   行集一变（重数字化、掩膜重建、窗口编辑）两处就会各说各话。
2. **稀疏天然**：点字典按行存在，没有成对读数的行**不写这两个键**（不是写 0、不是写
   None）。`columns_info` 里的平行数组没有"这一项不存在"的表示，只能填 None 占位，
   而那正是"缺省不写键"想避免的东西。
3. **零格式成本**：工程包存的是**控制点**（`project._build_columns_export` 的
   `points`），稠密 `column_points` 从不入库。所以这两个键既不进工程包、也不进 RPC
   payload，旧包与旧前端都不受影响（见下"旧工程读入"）。

## 哪些列 / 哪些行的点会带这两个键

- **列**：只有 `resolve_column_scale(...).exaggeration_mult > 1` 的列。没有倍率就没有
  "两层"这件事，`_compensate_broken_inner_rows` 在解析不到倍率时直接返回，一个键都不写
  ——单层列的点字典与 #99 之前逐字节相同。
- **行**：该行墨迹里**同时看到内线段与外线段**——即列窗内至少两段连续墨迹，第一段贴轴
  （段起点 ≤ 列左缘 + 5px，与断线判据同一个容差），且末段右缘严格在首段右缘外侧。
  外线整行断裂的行**只有内线一段**，没有外线可测，因此**不成对**：这些行的 x 由
  `_compensate_broken_inner_rows` 按"内线 × 倍率"补出来，那个位置是**算**出来的，
  拿它当外线读数去算 `ratio` 必然恒等于倍率，是自证循环，不是证据。
- 由控制点插值重建的列（`_rebuild_column_points_from_anchors`）会丢掉这两个键：它的点
  本来就是插值出来的，不是读数。`set_control_points` 的**窗口内**补点同样会丢掉窗口那
  几行的键（窗口外逐值保留，键也保留）——于是成对读数只会出现在"这一行既是实测、读数
  又没有被人为插值替换"的行上，这正是旗标该判的集合。

## 旧工程读入：键缺失是**正常状态**

工程包里没有稠密点，载入后 `column_points` 为空、重新数字化之前没有任何逐行读数。
因此"某列的点没有 `inner_xs_px`"有四种正常来路：旧包刚载入、单层列、外线整列断裂、
控制点插值列。`qa.py` 对这四种一视同仁：整列标 `skipped`，理由写在
`skipped_columns[].reason` 里，**不填 0、不拿列宽或倍率顶替**。
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

#: 内线（贴轴填充/曲线）右缘的绝对像素 x。逐行点字典上的键名，唯一出现处。
INNER_XS_KEY = "inner_xs_px"

#: 外线（放大曲线）右缘的绝对像素 x。逐行点字典上的键名，唯一出现处。
OUTER_XS_KEY = "outer_xs_px"


def store_layer_pair(
    point: dict[str, Any],
    *,
    inner_x: float,
    outer_x: float,
) -> None:
    """把一行的内线 / 外线右缘写进点字典（就地）。**两个键要么一起写、要么都不写。**

    只接受实测值：调用方必须已经在本行墨迹里分别看到两条线段。`outer_x` 不大于
    `inner_x` 时直接报错而不是静默丢弃——那说明调用方把"只有一段墨迹"的行也送进来了，
    是上游判据坏了，吞掉它会变成一条永远算不出旗标的静默缺口。
    """
    inner_val = float(inner_x)
    outer_val = float(outer_x)
    if not (math.isfinite(inner_val) and math.isfinite(outer_val)):
        raise ValueError(
            f"内外线右缘必须是有限数：inner={inner_x!r}, outer={outer_x!r}"
        )
    if outer_val <= inner_val:
        raise ValueError(
            "外线右缘必须在内外侧："
            f"收到 inner={inner_val!r}, outer={outer_val!r}"
            "（只有一段墨迹的行没有外线读数，不应成对落库）"
        )
    point[INNER_XS_KEY] = inner_val
    point[OUTER_XS_KEY] = outer_val


def _pair_value(point: dict[str, Any], key: str) -> float | None:
    """取一个成对读数；缺失、None、bool、NaN/inf 一律当"这一行没有读数"。"""
    raw = point.get(key)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    return value if math.isfinite(value) else None


def paired_layer_xs(
    points: Sequence[dict[str, Any]] | Iterable[dict[str, Any]],
) -> tuple[list[float | None], list[float | None]]:
    """把逐行点字典里的成对读数摊成两个**与 `points` 等长、逐位对齐**的列表。

    没有成对读数的行在两侧都放 `None`——它只表示"这一行没有这条读数"，不是 0。
    调用方（`session_parts/qa.py`）据此判断整列有没有任何成对读数：一个都没有时**不写
    这两个键**，让旗标层标 `skipped` 而不是给出一份"算过了、零告警"的假结论。
    """
    inner_xs: list[float | None] = []
    outer_xs: list[float | None] = []
    for point in points or ():
        inner = _pair_value(point, INNER_XS_KEY)
        outer = _pair_value(point, OUTER_XS_KEY)
        if inner is None or outer is None:
            inner_xs.append(None)
            outer_xs.append(None)
            continue
        inner_xs.append(inner)
        outer_xs.append(outer)
    return inner_xs, outer_xs


class LayersMixin:
    """Session mixin for dual-layer exaggeration curve separation."""

    def _init_layers(self) -> None:
        """Initialize layers state."""
        pass
