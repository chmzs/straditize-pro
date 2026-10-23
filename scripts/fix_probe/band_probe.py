# -*- coding: utf-8 -*-
"""为什么「默认路径 = 全局 Otsu」在双层图上无法被局部阈值救回来。

这是对 Lead 建议（standard 分支在有 column_edges 时改走逐带局部 Otsu）
的**反证**，全部数据来自真实图版
`output/han2026_ngamring/fig3_raw.jpeg` 的实测。

三个角度：
  1. 全局阈值 138.5 对各列都落在同一侧；中灰列真值只有 0.3% 在阈值以下。
  2. 逐列局部阈值**更差**：实心峰与网线峰高度接近，谷偏向上，4/15 列掉分。
  3. 中灰列的非纸像素总共只有 220 个，"双峰"是 164–182 与 198–200，
     分离 34 级，比值 0.03 —— 任何基于"存在双峰"的自动判据都极不稳定。

结论：默认路径的正确修法不是换阈值，而是**换判据**（按列白点区分
"与纸同阶的包络"与"更暗的实心"），它不依赖任何直方图形状假设。

用法：
    pixi run python scripts/fix_probe/band_probe.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core import image as im  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
GLOBAL_OTSUS = 138.5
E = [332, 370, 407, 445, 482, 521, 582, 619, 657, 694, 906, 1093, 1131,
     1193, 1231, 1280]
N = ["Pinus", "Abies", "Picea", "Betula", "QuercusD", "QuercusE", "Rosaceae",
     "Chenopodiaceae", "Hippophae", "Euphorbiaceae", "Cyperaceae", "Artemisia",
     "Poaceae", "Ranunculaceae", "Caryophyllaceae"]


def truth(a: np.ndarray) -> np.ndarray:
    """图注声明的实心层：不是纸，也不是"与纸同阶的中性淡层"。"""
    lum = im.grey_matrix(a)
    ch = a.max(axis=-1) - a.min(axis=-1)
    return ~((ch <= 32) & (lum >= 224))


def otsu(values: np.ndarray) -> float:
    """Standard Otsu over a 0-255 sample."""
    hist, edges = np.histogram(values, bins=256, range=(0, 256))
    centres = (edges[:-1] + edges[1:]) / 2.0
    total = float(hist.sum())
    w_bg = np.cumsum(hist).astype(float)
    w_fg = total - w_bg
    sum_total = float(np.dot(centres, hist))
    sum_bg = np.cumsum(centres * hist)
    with np.errstate(divide="ignore", invalid="ignore"):
        between = w_bg * w_fg * ((sum_bg / w_bg) - ((sum_total - sum_bg) / w_fg)) ** 2
    return float(centres[int(np.nan_to_num(between, nan=0.0).argmax())])


def main() -> int:
    a = np.array(Image.open(FIG).convert("RGB")).astype(float)
    lum = im.grey_matrix(a)
    ch = a.max(axis=-1) - a.min(axis=-1)
    T = truth(a)

    print("== 角度 1：全局阈值 138.5 下，中灰列的真值几乎全部在阈值以上 ==")
    print(f"{'列':<17}{'真值px':>8}{'<=138.5':>10}{'占比':>8}")
    for n, x0, x1 in zip(N, E[:-1], E[1:]):
        reg = np.s_[245:855, x0 + 1:x1 - 1]
        t = T[reg]
        hit = int((t & (lum[reg] <= GLOBAL_OTSUS)).sum())
        print(f"{n:<17}{int(t.sum()):>8}{hit:>10}{hit / max(1, t.sum()) * 100:>7.1f}%")

    print("\n== 角度 2：逐列局部 Otsu 会掉分（不是救星）==")
    print(f"{'列':<17}{'局部Otsu':>9}{'全局138.5':>10}{'变化':>10}")
    worse = 0
    for n, x0, x1 in zip(N, E[:-1], E[1:]):
        reg = np.s_[245:855, x0 + 1:x1 - 1]
        t = T[reg]
        band = lum[reg]
        neutral = ch[reg] <= 32
        samples = band.reshape(-1)[neutral.reshape(-1)]
        samples = samples[samples < 250]
        if samples.size < 64:
            continue
        local = otsu(samples)
        local_hit = float((t & (band < local)).sum() / max(1, t.sum()) * 100)
        global_hit = float((t & (band <= GLOBAL_OTSUS)).sum() / max(1, t.sum()) * 100)
        delta = local_hit - global_hit
        if delta < -0.05:
            worse += 1
        print(f"{n:<17}{local:>9.1f}{global_hit:>9.1f}%{delta:>+9.1f}pp")
    print(f"\n局部阈值更差的列：{worse}/15")

    print("\n== 角度 3：中灰列的非纸像素总量与双峰形态 ==")
    for n, x0, x1 in zip(N, E[:-1], E[1:]):
        if n not in ("Caryophyllaceae", "Ranunculaceae", "Pinus"):
            continue
        reg = np.s_[245:855, x0 + 1:x1 - 1]
        band = lum[reg][(ch[reg] <= 32) & (lum[reg] < 240)]
        hist, edges = np.histogram(band, bins=64, range=(0, 256))
        top = sorted(((int(v), int(edges[i])) for i, v in enumerate(hist) if v),
                     reverse=True)[:4]
        print(f"  {n:<17} 非纸中性 {band.size:>5} px，最高的 4 个灰阶桶: {top}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
