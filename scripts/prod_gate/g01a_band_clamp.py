# -*- coding: utf-8 -*-
"""G-01(a) 根因定位：为什么真实图版一个刻度齿都检不出。

已实测的两条事实（g01a_xticks_mechanics.py）：
  · 真实刻度尺齿干位于 y=869..875（7px 高），band=(869,875) 时能检出 52 个齿，
    其中 ROI x∈[330,1290] 内 30 个 —— 算法本身认得出齿；
  · 图版数据区底边（框线）在 y=868..869，用户自然框的 ROI 底边 y1≈861。

本探针**逐字复刻** detect_xticks_rpc 里的 band 扫描循环（含它的两个夹取条件），
把「有没有被夹掉」打印出来，从而把失败归因到具体一行，而不是靠读代码下结论。

不修改产品源码：循环体在本文件内重写，只调用产品的 _strokes_in_band。
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.xticks import _strokes_in_band, detect_xticks  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"


def replicate(y_bottom: float, y_top_roi: float, cols: list[tuple[int, int]], gray) -> dict:
    """逐字复刻 detect_xticks_rpc 的 band 扫描（含夹取条件），统计被夹掉的次数。"""
    img_h = int(gray.shape[0])
    lo_search = max(0, int(round(y_top_roi)))
    hi_search = min(img_h, int(round(y_bottom)))
    best_b = None
    best_score = 0
    skipped_out_of_roi = 0
    tested = 0
    hits: list[tuple] = []
    for top in range(int(y_bottom) - 4, int(y_bottom) + 16):
        for bh in (6, 7, 8):
            if top < lo_search or top + bh > hi_search:
                skipped_out_of_roi += 1
                continue
            tested += 1
            b_ticks, _ = _strokes_in_band(gray, (top, top + bh), dark_threshold=160)
            score = sum(1 for t in b_ticks if any(s <= t <= e for s, e in cols))
            if score > 0:
                hits.append((top, top + bh, score))
            if score > best_score:
                best_score = score
                best_b = (top, top + bh)
    return {
        "y_bottom": y_bottom,
        "lo_search": lo_search,
        "hi_search": hi_search,
        "window_tops": [int(y_bottom) - 4, int(y_bottom) + 15],
        "candidates_skipped_by_clamp": skipped_out_of_roi,
        "candidates_actually_tested": tested,
        "band_candidates_with_hits": hits,
        "best_band": best_b,
        "best_score": best_score,
        "would_accept(score>=3)": best_b is not None and best_score >= 3,
    }


def main() -> int:
    U.hash_banner("G-01(a) root cause: band clamp")
    gray = np.array(Image.open(os.path.join(U.ROOT, FIG)).convert("L")).astype(int)

    # 真实列边界（g01_full_chain 实测输出的 16 列）
    cols = [
        (332, 370), (370, 407), (407, 444), (444, 482), (482, 519), (519, 582),
        (582, 619), (619, 656), (656, 694), (694, 906), (906, 1093), (1093, 1130),
        (1130, 1193), (1193, 1231), (1231, 1279), (1279, 1330),
    ]

    print("\n真实刻度尺齿干：y=869..875（7px）。band=(869,875) 能检出 52 齿。")
    print("产品扫描窗口 = [y_bottom-4, y_bottom+15)，band 高度 ∈ {6,7,8}")
    print("夹取条件（逐字）：top < lo_search  或  top + bh > hi_search  -> 跳过\n")

    for y1 in (861.0, 870.0, 876.0, 882.0):
        r = replicate(y1, 233.0, cols, gray)
        print(f"ROI y1={y1:.0f}")
        print(f"    窗口 tops = {r['window_tops']}  lo={r['lo_search']} hi={r['hi_search']}")
        print(f"    被夹掉 {r['candidates_skipped_by_clamp']} / 60 个 (top,bh) 组合，"
              f"真正被测的只有 {r['candidates_actually_tested']} 个")
        print(f"    有命中的 band 候选: {r['band_candidates_with_hits'][:6]}")
        print(f"    best_band={r['best_band']} best_score={r['best_score']} "
              f"是否过 score>=3 门槛: {r['would_accept(score>=3)']}")
        print()

    # 关键对照：若不夹取（即"允许看 ROI 下方 16px"），真实尺子能不能被找到？
    print("=== 对照：去掉 top+bh>hi_search 夹取后（不修改源码，仅在本探针内模拟）===")
    for y1 in (861.0,):
        best_b = None
        best_score = 0
        for top in range(int(y1) - 4, int(y1) + 16):
            for bh in (6, 7, 8):
                b_ticks, _ = _strokes_in_band(gray, (top, top + bh), dark_threshold=160)
                score = sum(1 for t in b_ticks if any(s <= t <= e for s, e in cols))
                if score > best_score:
                    best_score = score
                    best_b = (top, top + bh)
        print(f"    ROI y1={y1:.0f}: best_band={best_b} best_score={best_score} "
              f"-> 会接受: {best_score >= 3}")
        print(f"    即：真实刻度尺就在扫描窗口内（top=869,bh=6），"
              f"真正挡住它的是 `top + bh > hi_search` 这一条夹取。")

    # 端到端复核：产品 detect_xticks 在 band=None 时的兜底
    print("\n=== 产品 detect_xticks(band=None) 的兜底行为 ===")
    res = detect_xticks(gray, band=None, dark_threshold=160, columns=cols)
    print(f"    band={res.get('band')}  per_column={len(res.get('per_column') or [])}")
    res2 = detect_xticks(gray, band=(869, 875), dark_threshold=160, columns=cols)
    per2 = res2.get("per_column") or []
    with_ticks = [p for p in per2 if (p.get("ticks") or [])]
    print(f"    显式给 band=(869,875): band={res2.get('band')} "
          f"per_column={len(per2)} 有齿列={len(with_ticks)} "
          f"总齿={sum(len(p['ticks']) for p in with_ticks)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
