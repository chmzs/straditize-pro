# -*- coding: utf-8 -*-
"""端到端核对：走真实会话 + 真实 RPC 方法，而不是直接调 image.py。

回答三个问题：
  1. 默认路径（不传 extraction_mode）是否与修复前完全一致（Otsu 138）？
  2. ``solid-over-shadow`` 是否让 15 列全部 >= 95%，且包络 0 像素进入前景？
  3. 列检测 / 清理 / 数字化这些**隐式**重算路径是否仍用用户选的模式，
     而不是偷偷退回 Otsu？
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.image import NEUTRAL_CHROMA_TOL, grey_matrix  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
Y0, Y1 = 245, 855
EDGES = [332, 370, 407, 445, 482, 521, 582, 619, 657,
         694, 906, 1093, 1131, 1193, 1231, 1280]
NAMES = ["Pinus", "Abies", "Picea", "Betula", "QuercusD", "QuercusE",
         "Rosaceae", "Chenopodiaceae", "Hippophae", "Euphorbiaceae",
         "Cyperaceae", "Artemisia", "Poaceae", "Ranunculaceae",
         "Caryophyllaceae"]


def truth_solid(rgb: np.ndarray) -> np.ndarray:
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= NEUTRAL_CHROMA_TOL
    paper = neutral & (lum >= 251.0)
    envelope = neutral & (lum >= 224.0) & ~paper
    return ~paper & ~envelope


def fresh_session(edges=EDGES):
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.abspath(FIG))
    # 用实测的列轴框当列带，供逐列白点使用
    s.columns = [
        {"col_index": i, "name": n, "start": a, "end": b}
        for i, (n, a, b) in enumerate(zip(NAMES, edges[:-1], edges[1:]))
    ]
    return s


def main() -> int:
    arr = np.array(Image.open(FIG).convert("RGB")).astype(float)

    # --- 1. 默认路径不变 ---
    s = fresh_session()
    res = s.extract_foreground()
    default = s.foreground_mask
    print(f"[1] 默认路径（未传 extraction_mode）: threshold={res['threshold']:.1f} "
          f"mode={res['mode']} extraction_mode={res['extraction_mode']}")
    print(f"    foreground={res['foreground_pixels']}  "
          f"(修复前同图实测 227,032)")

    # --- 2. 双层模式 ---
    s2 = fresh_session()
    res2 = s2.extract_foreground(extraction_mode="solid-over-shadow",
                                 column_edges=EDGES)
    print(f"\n[2] solid-over-shadow: threshold={res2['threshold']:.1f} "
          f"solid={res2['solid_pixels']} shadow={res2['shadow_pixels']} "
          f"layers={res2['layers']}")

    print(f"\n{'列':<17}{'真值px':>8}{'命中':>8}{'命中率':>8}{'Otsu命中率':>12}")
    worst = 100.0
    worst_otsu = 100.0
    for name, a, b in zip(NAMES, EDGES[:-1], EDGES[1:]):
        t = truth_solid(arr[Y0:Y1, a + 1:b - 1])
        hit = float((t & s2.foreground_mask[Y0:Y1, a + 1:b - 1]).sum() / max(1, t.sum()) * 100)
        old_ref = grey_matrix(arr[Y0:Y1, a + 1:b - 1]) <= 150.0
        otsu = float((old_ref & default[Y0:Y1, a + 1:b - 1]).sum()
                     / max(1, old_ref.sum()) * 100)
        worst = min(worst, hit)
        worst_otsu = min(worst_otsu, otsu)
        print(f"{name:<17}{int(t.sum()):>8}{int((t & s2.foreground_mask[Y0:Y1, a + 1:b - 1]).sum()):>8}"
              f"{hit:>7.1f}%{otsu:>11.1f}%")
    print(f"\n    最差列：双层 {worst:.1f}%（门槛 95%） / 默认 {worst_otsu:.1f}%")
    leak = int((s2.shadow_mask & s2.foreground_mask).sum())
    print(f"    包络被判入前景 = {leak} px（须为 0）")

    # --- 3. 隐式重算仍用所选模式 ---
    s3 = fresh_session()
    s3.extract_foreground(extraction_mode="solid-over-shadow", column_edges=EDGES)
    before = s3.extraction_mode
    s3.foreground_mask = None
    s3._extract_foreground_from_settings()
    print(f"\n[3] 隐式重算后 extraction_mode={s3.extraction_mode}（之前 {before}），"
          f"与用户选择一致={s3.extraction_mode == before}")

    # --- 4. RPC 层 ---
    from straditize_core.rpc_methods import digitize as rpc_digitize

    class _D:
        def __init__(self):
            self._methods = {}

        def register_method(self, name, fn):
            self._methods[name] = fn

    d = _D()
    s4 = fresh_session()
    rpc_digitize.register(d, s4)
    out = d._methods["core.extractForeground"](extraction_mode="solid-over-shadow")
    print(f"\n[4] RPC core.extractForeground -> {out['extraction_mode']} "
          f"solid={out['solid_pixels']} shadow={out['shadow_pixels']}")
    layer = d._methods["core.getShadowLayer"]()
    print(f"    RPC core.getShadowLayer -> available={layer['available']} "
          f"shadow={layer['shadow_pixels']} png={'yes' if layer['overlay_png'] else 'no'}")
    try:
        d._methods["core.extractForeground"](extraction_mode="not-a-mode")
    except Exception as exc:  # noqa: BLE001
        print(f"    非法模式被拒: {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
