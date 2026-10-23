# -*- coding: utf-8 -*-
"""修复后度量：逐列「实心」命中率。

参考真值不依赖被测算法：图注声明图里有两层（实心 + 5× 包络），所以真值层
就是**扣除纸面与包络之后剩下的内容像素**。这里用独立写的规则算它：

    真值实心 = 不是纸、也不是"与纸同阶的中性淡层"

并与 Lead 原报告口径（明度 <= 150）逐列对照，避免口径不同导致误读。
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.image import (  # noqa: E402
    NEUTRAL_CHROMA_TOL,
    build_foreground,
    grey_matrix,
    shadow_layers,
    two_layer_split,
)

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 245, 855
# 实测的 15 列轴框（x0 = 本列轴线 / 上一列右轴；x1 = 下一根轴线）
EDGES = [332, 370, 407, 445, 482, 521, 582, 619, 657,
         694, 906, 1093, 1131, 1193, 1231, 1280]
NAMES = ["Pinus", "Abies", "Picea", "Betula", "QuercusD", "QuercusE",
         "Rosaceae", "Chenopodiaceae", "Hippophae", "Euphorbiaceae",
         "Cyperaceae", "Artemisia", "Poaceae", "Ranunculaceae",
         "Caryophyllaceae"]


def truth_solid(rgb: np.ndarray) -> np.ndarray:
    """(not paper) and (not a neutral pale envelope) — computed independently."""
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= NEUTRAL_CHROMA_TOL
    paper = neutral & (lum >= 251.0)
    envelope = neutral & (lum >= 224.0) & ~paper
    return ~paper & ~envelope


def main() -> int:
    if not os.path.exists(FIG):
        print(f"缺少图版：{FIG}")
        return 1
    arr = np.array(Image.open(FIG).convert("RGBA"))
    rgb = arr[..., :3].astype(float)

    parts = two_layer_split(rgb, column_edges=EDGES)
    mask = build_foreground(arr, extraction_mode='solid-over-shadow',
                            column_edges=EDGES)
    otsu_mask = build_foreground(arr, extraction_mode='standard',
                                 threshold=138.0 * 3)

    print(f"solid={int(parts['solid'].sum())}  shadow={int(parts['shadow'].sum())}  "
          f"background={int(parts['background'].sum())}  "
          f"total={parts['solid'].size}")
    print(f"覆蓋率校验: {int(sum(parts[k].sum() for k in ('solid', 'shadow', 'background')))}"
          f" == {parts['solid'].size}")
    print(f"solid ∩ shadow = {int((parts['solid'] & parts['shadow']).sum())} px（须为 0）")
    print()

    print(f"{'列':<17}{'真值px':>8}{'新命中':>8}{'新%':>7}"
          f"{'旧<150':>8}{'旧%':>7}{'旧Otsu%':>9}")
    worst = 100.0
    for name, a, b in zip(NAMES, EDGES[:-1], EDGES[1:]):
        t = truth_solid(rgb[Y0:Y1, a + 1:b - 1])
        fg = mask[Y0:Y1, a + 1:b - 1]
        ofg = otsu_mask[Y0:Y1, a + 1:b - 1]
        old_ref = grey_matrix(rgb[Y0:Y1, a + 1:b - 1]) <= 150.0
        hit_new = float((t & fg).sum() / max(1, t.sum()) * 100)
        hit_old = float((old_ref & fg).sum() / max(1, old_ref.sum()) * 100)
        hit_otsu = float((old_ref & ofg).sum() / max(1, old_ref.sum()) * 100)
        worst = min(worst, hit_new)
        print(f"{name:<17}{int(t.sum()):>8}{int((t & fg).sum()):>8}{hit_new:>7.1f}"
              f"{int(old_ref.sum()):>8}{hit_old:>7.1f}{hit_otsu:>9.1f}")
    print()
    print(f"新算法最差列命中率 = {worst:.1f}%（门槛 95%）")

    false_shadow = int((parts['shadow'] & mask).sum())
    print(f"阴影被判入前景 = {false_shadow} px（须为 0）")

    lay = shadow_layers(rgb, column_edges=EDGES)
    print("可分层导出：" + ", ".join(f"{k}={int(v.sum())}" for k, v in lay.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
