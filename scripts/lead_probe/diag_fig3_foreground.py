# -*- coding: utf-8 -*-
"""诊断：真实期刊图版（Han et al. 2026 Fig.3）上，软件默认提取路径的逐列识别率。

回答的问题：软件的 `extract_foreground()`（灰度 Otsu）能否正确识别
「深色实心（真实值）+ 浅色阴影（5× 夸张）」的双层彩色柱状图？

用法：
    pixi run python scripts/lead_probe/diag_fig3_foreground.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.image import build_foreground  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 245, 850

# (name, x0, x1, 曲线颜色类别) —— 颜色类别由逐列主色统计得出
COLUMNS = [
    ("Pinus", 332, 370, "red"),
    ("Abies", 370, 407, "red"),
    ("Picea", 407, 445, "red"),
    ("Betula", 445, 482, "red"),
    ("QuercusD", 482, 521, "red"),
    ("QuercusE", 521, 582, "blue"),
    ("Rosaceae", 582, 619, "blue"),
    ("Chenopodiaceae", 619, 657, "blue"),
    ("Hippophae", 657, 704, "black"),
    ("Euphorbiaceae", 704, 924, "black"),
    ("Cyperaceae", 924, 1096, "black"),
    ("Artemisia", 1096, 1133, "black"),
    ("Poaceae", 1133, 1193, "black"),
    ("Ranunculaceae", 1193, 1231, "black"),
    ("Caryophyllaceae", 1231, 1280, "gray"),
]


def solid_pixels(rgb: np.ndarray) -> np.ndarray:
    """该列最深 10% 的像素 —— 近似"实心填充层"（排除浅色阴影）。"""
    lum = rgb.mean(axis=-1)
    return lum <= np.percentile(lum, 10)


def main() -> int:
    if not os.path.exists(FIG):
        print(f"缺少图版：{FIG}（先跑一次 scripts/extract_han2026_fig3.py）")
        return 1

    img = Image.open(FIG).convert("RGBA")
    arr = np.array(img)
    rgb = arr[..., :3].astype(int)

    # --- 软件默认路径（产品实际使用的） ---
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.abspath(FIG))
    s.extract_foreground()
    mask = s.foreground_mask
    print(f"软件默认 extract_foreground: Otsu 阈值 = {s.threshold}")
    print(f"前景像素 {int(mask.sum())}（{mask.mean() * 100:.2f}% of image）")
    print()

    # --- 逐列识别率 ---
    print(f"{'属种':<18}{'颜色':>7}{'实心像素':>10}{'命中':>9}{'识别率':>8}  判定")
    fails = []
    total_lost = 0
    for name, x0, x1, color in COLUMNS:
        sub = rgb[Y0:Y1, x0 + 3 : x1 - 3]
        solid = solid_pixels(sub)
        fg = mask[Y0:Y1, x0 + 3 : x1 - 3]
        hit = int((solid & fg).sum())
        total = int(solid.sum())
        rate = hit / total * 100 if total else 0.0
        lost = total - hit
        total_lost += lost
        ok = "✅" if rate >= 90 else "❌"
        if rate < 90:
            fails.append((name, round(rate, 1)))
        print(f"{name:<18}{color:>7}{total:>10}{hit:>9}{rate:>7.1f}%  {ok}")

    print()
    print(f"合计丢失实心像素: {total_lost}")
    print(f"失败列数: {len(fails)} / {len(COLUMNS)}")
    for name, rate in fails:
        print(f"   ❌ {name}: {rate}%")

    # --- 对照：手动切 light-overlay-white 是否解决 ---
    print()
    print("对照：build_foreground(extraction_mode='light-overlay-white')")
    lo_mask = build_foreground(arr, extraction_mode="light-overlay-white")
    for name, x0, x1, _c in COLUMNS:
        sub = rgb[Y0:Y1, x0 + 3 : x1 - 3]
        solid = solid_pixels(sub)
        fg = lo_mask[Y0:Y1, x0 + 3 : x1 - 3]
        rate = (solid & fg).sum() / max(solid.sum(), 1) * 100
        print(f"   {name:<18}{rate:>6.1f}%")

    # --- 阴影是否被误判前景（必须为 0） ---
    print()
    for label, color in (("浅粉阴影", (244, 226, 226)), ("浅灰阴影", (229, 229, 229))):
        pm = np.abs(rgb - np.array(color)).max(axis=-1) < 10
        print(f"{label} {color}: 总数 {int(pm.sum())}，被判前景 {int((pm & mask).sum())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
