# -*- coding: utf-8 -*-
"""G-01(a) 补充：把 detect_xticks 的 band 扫描单独拿出来跑，定位"一个齿都检不出"的机制。

不读代码推断，直接调用 straditize_core.xticks._strokes_in_band / _find_tick_band，
喂真实位图，打印每个 band 高度的实际命中情况。

同时回答 U-05 的第二问：「分区线会不会被当刻度齿」——
构造一个把横线放进搜索窗口的 ROI，看 _strokes_in_band 是否把横线当成齿。
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.xticks import (  # noqa: E402
    TICK_MAX_RUN,
    _col_run_through,
    _find_tick_band,
    _strokes_in_band,
)

FIG = "output/han2026_ngamring/fig3_raw.jpeg"


def main() -> int:
    U.hash_banner("G-01(a) xticks band mechanics on real figure")
    a = np.array(Image.open(os.path.join(U.ROOT, FIG)).convert("L")).astype(int)
    print(f"\nimage = {a.shape[1]}x{a.shape[0]}")

    # ---------- 1. 真实刻度尺位置：逐 band 打印 ----------
    print("\n--- 1. 真实刻度尺区（y=870..881）逐 band 命中情况 ---")
    print("    _strokes_in_band 的判据：band 内每列 col_fill > 0.95（即整段 band 都要暗）")
    for top in (868, 869, 870, 871, 872, 873, 874, 875, 876):
        for bh in (6, 7, 8):
            ticks, cols = _strokes_in_band(a, (top, min(top + bh, a.shape[0])), dark_threshold=160)
            x_in_range = [t for t in ticks if 330 <= t <= 1290]
            print(f"    top={top} bh={bh} band=[{top},{top + bh}) -> "
                  f"全图齿={len(ticks):3d}  ROI内齿={len(x_in_range):3d}"
                  f"{'   <== 命中' if len(x_in_range) >= 3 else ''}")

    # ---------- 2. 为什么整条刻度尺过不了 ----------
    print("\n--- 2. 齿干的真实高度（决定 6/7/8px band 能否成立）---")
    dark = a < 160
    # 取几个已知齿位，量它们的纵向连续暗长
    for x in (332, 357, 370, 407, 445, 954, 1001, 1047):
        # 从 y=869 往下找
        run = 0
        y = 869
        while y < a.shape[0] and dark[y, x]:
            run += 1
            y += 1
        print(f"    x={x:5d}: 自 y=869 起连续暗 {run} px   "
              f"(_col_run_through 上限 TICK_MAX_RUN={TICK_MAX_RUN})")

    # ---------- 3. _find_tick_band 全图自己找 ----------
    print("\n--- 3. _find_tick_band 在真实位图上自动找刻度带 ---")
    for bh in (6, 7, 8):
        got = _find_tick_band(a, band_height=bh, dark_threshold=160)
        print(f"    band_height={bh} -> {got}")

    # ---------- 4. 分区线会不会被当齿 ----------
    print("\n--- 4. 【U-05 第二问】分区线是否被当刻度齿 ---")
    print("    把 band 精确套在真实分区线上（图版实测：y=266/359/594-595/742-743，1-2px）")
    for y_line in (266, 359, 594, 743):
        for top in (y_line - 3, y_line, y_line + 1):
            for bh in (6, 7):
                if top < 0 or top + bh > a.shape[0]:
                    continue
                ticks, cols = _strokes_in_band(
                    a, (top, top + bh), dark_threshold=160
                )
                print(f"    线 y={y_line} top={top} bh={bh} -> 齿数={len(ticks)}"
                      f"{'  <== 误判!' if len(ticks) > 0 else '  （未误判）'}")

    print("\n    再检验：分区线高度（1-2px）远小于 band 高度（6-8px），")
    print("    因此 band 内该列 fill 只会是 1/6~2/6，达不到 0.95 阈值 -> 不会被当成齿。")

    # ---------- 5. 结论性计数 ----------
    print("\n--- 5. 定量结论 ---")
    stem_heights = []
    for x in range(330, 1291):
        run = 0
        y = 869
        while y < a.shape[0] and dark[y, x]:
            run += 1
            y += 1
        if run > 0:
            stem_heights.append(run)
    if stem_heights:
        print(f"    ROI 内 x=330..1290 上「自 y=869 起的暗游程」分布: "
              f"min={min(stem_heights)} max={max(stem_heights)} "
              f"中位={sorted(stem_heights)[len(stem_heights) // 2]}")
        from collections import Counter
        print(f"    频次: {dict(sorted(Counter(stem_heights).items()))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
