# -*- coding: utf-8 -*-
"""自动识别「实心 + 夸张包络」双层图。

## 为什么需要它

`standard`（全局 Otsu）对双层图的失败是**结构性的**，不是调参能救的：

* 全局 Otsu 在整幅图上只找一个分割点。实测 Han et al. 2026 Fig.3 得 138，
  而中灰列的真值只有 **0.3%** 落在 138 以下 —— 不是"差一点"，是整列在阈值
  的另一侧。
* 逐列看，同一个阈值也不成立：黑填充列的局部 Otsu 是 114，中灰列是 207，
  跨度 93 个灰阶。

所以默认路径的正确修法不是换阈值，而是**换判据**：问"这个像素是不是与
所在列的纸面同阶"，而不是"这个像素够不够暗"。

## 自动判据（两层同时成立才切）

1. **该列存在与纸同阶的中性层**：非纸中性像素中，明度 ≥ 0.94×该列白点
   的那部分占 ≥ `SHADOW_SHARE_MIN`。这是"淡色包络"的客观形状特征；
   纯黑白线图的灰阶只有纸与墨两极，中间几乎没有像素。
2. **该列中部确实被这层覆盖**：包络像素在整幅高度的中间一半里至少占
   `SHADOW_MID_ROW_MIN` 的行。实心填充只覆盖各列的一小段（信封形状），
   包络才是一整片。

两条都不依赖直方图形状、不依赖调参。判据不成立时返回 `False`，
调用方继续走原来的全局 Otsu —— 内建教程图的行为因此完全不变。
"""
from __future__ import annotations

from typing import Any, Sequence

import numpy as np

#: 判为「与纸同阶的中性层」的明度上限（相对该列白点）。
SAME_TIER_RATIO = 0.93
#: 该层至少要占该列非纸中性像素的多少比例。
#:
#: 实测（Han Fig.3 逐列）：包络占该列非纸中性像素 2–42%（Euphorbiaceae 1%、
#: Caryophyllaceae 42%），没有一条"多数"分界可用。取 0.02 是"确实存在"的
#: 下限，不是"占多数"的判据 —— 真正区分双层图的是下面那条行覆盖率。
SHADOW_SHARE_MIN = 0.02
#: 该层至少要覆盖整幅高度中间多少比例的行。
#:
#: 这是唯一能区分"包络"与"实心信封"的判据：实心柱只在各列的一段上出现，
#: 包络则贯穿全高。实测中灰列 mid_cover = 0.27（最低）、黑填充列 0.39–0.86。
SHADOW_MID_ROW_MIN = 0.20
#: 同层像素在 3×3 邻域内至少要有几个同样像素才算"成片"。
#: 描边的抗锯齿白边是 1 px 薄的稀薄边缘，成不了片；填充与包络成片。
MIN_PACK = 6
#: 判为「中性」允许的通道极差。
NEUTRAL_CHROMA_TOL = 32.0


def band_is_two_layer(
    lum: np.ndarray,
    chroma: np.ndarray,
    white_point: float,
    *,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
    same_tier_ratio: float = SAME_TIER_RATIO,
    min_share: float = SHADOW_SHARE_MIN,
    min_mid_rows: float = SHADOW_MID_ROW_MIN,
    min_pack: int = MIN_PACK,
) -> bool:
    """True when one column band looks like a solid fill plus a pale envelope."""
    if white_point <= 0:
        return False
    neutral = chroma <= neutral_chroma_tol
    paper = float(white_point) * 0.985
    content = neutral & (lum < paper)
    total = int(content.sum())
    if total < 200:
        return False
    same_tier = content & (lum >= float(white_point) * same_tier_ratio)
    # 抗锯齿白边也要排除：它们同样"与纸同阶"，但只出现在描边两侧、不足以
    # 覆盖整列。用"该像素成片"（3×3 邻域内同层像素 ≥ 6）把稀薄的边缘滤掉，
    # 保留真正的填充/包络。
    # 注意累加器必须是整数：若用 np.zeros_like(bool)，`packed += (...) > 0`
    # 是布尔或，最大值恒为 1，`>= 6` 永远不成立（实测：5.7 万像素被判 0）。
    packed = np.zeros(same_tier.shape, dtype=np.int16)
    padded = np.pad(same_tier.astype(np.int16), 1)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            packed += padded[dy:dy + same_tier.shape[0], dx:dx + same_tier.shape[1]]
    same_tier &= packed >= min_pack
    if same_tier.sum() < min_share * total:
        return False

    rows = np.count_nonzero(same_tier, axis=1)
    height = lum.shape[0]
    if height < 8:
        return False
    mid = rows[height // 4: height - height // 4]
    mid_cover = float((mid > 0).mean()) if mid.size else 0.0
    return mid_cover >= min_mid_rows


def detect_two_layer_columns(
    rgb: np.ndarray,
    column_edges: Sequence[int] | None,
    white_points: Any = None,
    **kwargs: Any,
) -> list[bool]:
    """Per-column verdict; empty list when there are no column bands."""
    if not column_edges:
        return []
    edges = [int(e) for e in column_edges]
    if len(edges) < 2:
        return []
    arr = np.asarray(rgb, dtype=float)[..., :3]
    lum = (arr[..., 0] * 299.0 + arr[..., 1] * 587.0 + arr[..., 2] * 114.0) / 1000.0
    chroma = arr.max(axis=-1) - arr.min(axis=-1)

    wps = list(white_points) if white_points is not None else [255.0] * (len(edges) - 1)
    out: list[bool] = []
    for k, (a, b) in enumerate(zip(edges[:-1], edges[1:])):
        a, b = max(0, a), min(lum.shape[1], b)
        if b - a < 8:
            out.append(False)
            continue
        wp = wps[k] if k < len(wps) else 255.0
        out.append(band_is_two_layer(lum[:, a:b], chroma[:, a:b], float(wp), **kwargs))
    return out
