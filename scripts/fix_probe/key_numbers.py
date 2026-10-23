# -*- coding: utf-8 -*-
"""Lead 要的三条数字：真实图版、15 列、**走默认路径**。

默认路径 = `extract_foreground()` 不传 extraction_mode（= standard / 全局 Otsu），
这正是产品链路在用户没动任何旋钮时走的那条路。

参考基准（Lead 指定）：该列内 ``lum <= 150`` 的像素 = 实心填充的客观代理。
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.image import grey_matrix  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 245, 855
E = [332, 370, 407, 445, 482, 521, 582, 619, 657, 694, 906, 1093, 1131,
     1193, 1231, 1280]
N = ["Pinus", "Abies", "Picea", "Betula", "QuercusD", "QuercusE", "Rosaceae",
     "Chenopodiaceae", "Hippophae", "Euphorbiaceae", "Cyperaceae", "Artemisia",
     "Poaceae", "Ranunculaceae", "Caryophyllaceae"]

PALE_SHADOW = (np.array([244, 226, 226]), np.array([218, 226, 237]),
               np.array([229, 229, 229]))


def shadow_reference(rgb: np.ndarray) -> np.ndarray:
    """5× 包络像素：三种观测到的包络色各 ±6 个灰阶以内。"""
    out = np.zeros(rgb.shape[:2], dtype=bool)
    for base in PALE_SHADOW:
        out |= (np.abs(rgb - base) <= 6).all(axis=-1)
    return out


def coverage(mask: np.ndarray, ref: np.ndarray) -> float:
    return float((ref & mask).sum() / max(1, ref.sum()) * 100)


def main() -> int:
    arr = np.array(Image.open(FIG).convert("RGBA"))
    rgb = arr[..., :3].astype(float)

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.abspath(FIG))
    s.columns = [{"col_index": i, "name": n, "start": a, "end": b}
                 for i, (n, a, b) in enumerate(zip(N, E[:-1], E[1:]))]

    # ---- 默认路径 ----
    res = s.extract_foreground()
    default_mask = s.foreground_mask
    print(f"[默认路径] extraction_mode={res['extraction_mode']} "
          f"threshold={res['threshold']:.1f} mode={res['mode']}")

    rows = []
    for name, a, b in zip(N, E[:-1], E[1:]):
        reg = np.s_[Y0:Y1, a + 1:b - 1]
        ref = grey_matrix(rgb[reg]) <= 150.0
        rows.append((name, coverage(default_mask[reg], ref), int(ref.sum())))

    print(f"\n{'列':<17}{'实心像素':>9}{'默认路径覆盖率':>14}")
    for name, cov, n in rows:
        flag = "  <-- 缺陷" if cov < 95 else ""
        print(f"{name:<17}{n:>9}{cov:>13.1f}%{flag}")

    caryo = next(c for c in rows if c[0] == "Caryophyllaceae")
    others = [c for c in rows if c[0] != "Caryophyllaceae"]
    print(f"\nCaryophyllaceae 覆盖率 = {caryo[1]:.1f}%   (基线 1.4%)")
    print(f"其余 14 列最低覆盖率 = {min(c[1] for c in others):.1f}%   (基线 92.1%)")

    shadow_ref = shadow_reference(rgb)
    fp = int((shadow_ref & default_mask).sum())
    print(f"浅色阴影误判前景像素 = {fp}   (基线 0)")

    # ---- 双层模式（供对照） ----
    s2 = StraditizeSession()
    s2._init_cleanup()
    s2.load_image(os.path.abspath(FIG))
    s2.columns = s.columns
    try:
        r2 = s2.extract_foreground(extraction_mode="solid-over-shadow")
    except Exception as exc:  # noqa: BLE001
        print("[solid-over-shadow 模式] 已显式拒绝（不再静默给出错误掩膜）：")
        print("  " + str(exc).splitlines()[0])
        print("  " + [ln for ln in str(exc).splitlines() if ln.strip()][2][:200])
        return 0
    solid = s2.foreground_mask
    c2 = coverage(solid[Y0:Y1, 1232:1279], grey_matrix(rgb[Y0:Y1, 1232:1279]) <= 150.0)
    o2 = min(coverage(solid[Y0:Y1, a + 1:b - 1], grey_matrix(rgb[Y0:Y1, a + 1:b - 1]) <= 150.0)
             for a, b in zip(E[:-1], E[1:]) if (a, b) != (1231, 1280))
    fp2 = int((shadow_ref & solid).sum())
    leak = int((s2.shadow_mask & solid).sum())
    print(f"\n[solid-over-shadow 模式] threshold={r2['threshold']:.1f} "
          f"solid={r2['solid_pixels']} shadow={r2['shadow_pixels']}")
    print(f"Caryophyllaceae 覆盖率 = {c2:.1f}%")
    print(f"其余 14 列最低覆盖率 = {o2:.1f}%")
    print(f"浅色阴影误判前景像素 = {fp2}   包络∩前景 = {leak}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
