# -*- coding: utf-8 -*-
"""G-01(a) 关键结论：detect_xticks_rpc 的 band 自动搜索是**恒为死代码**（数学证明 + 实测）。

逐字复刻 straditize_core/session_parts/xticks.py 的扫描循环：

    lo_search = max(0, round(y_top_roi))
    hi_search = min(img_h, round(y_bottom))          # y_bottom = roi.ylim[1]
    for top in range(int(y_bottom) - 4, int(y_bottom) + 16):
        for bh in (6, 7, 8):
            if top < lo_search or top + bh > hi_search:
                continue                              # <- 越出 ROI：跳过

取 top 的最小值 y_bottom-4、bh 的最小值 6：
    top + bh = y_bottom + 2
    hi_search = y_bottom
    => top + bh > hi_search  恒成立
    => 60 个 (top,bh) 组合**全部**被 continue 掉，一个都不会被测。

结论：只要 hi_search 跟随 roi.ylim[1]（当前实现就是），这段自动搜索**永远不会**
产生 resolved_band。它不依赖图像内容，因此对本仓库所有图片、所有 ROI 都成立。

本探针做三件事：
  1. 对大量 y_bottom 取值做同一复刻，确认 skipped 恒为 60/60；
  2. 端到端确认 detect_xticks_rpc 在真实图上永远返回 band=None；
  3. 给出"若夹取条件放宽"的对照，证明真实尺子本可检出（说明这是回归，不是能力缺失）。
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.xticks import _strokes_in_band  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
HOYA = None  # 内置范例通过 sample_key 载入


def clamp_stats(y_bottom: float, y_top_roi: float, img_h: int) -> tuple[int, int]:
    """返回 (被夹掉数, 实际测试数)，逐字复刻产品循环的夹取逻辑。"""
    lo_search = max(0, int(round(y_top_roi)))
    hi_search = min(img_h, int(round(y_bottom)))
    skipped = tested = 0
    for top in range(int(y_bottom) - 4, int(y_bottom) + 16):
        for bh in (6, 7, 8):
            if top < lo_search or top + bh > hi_search:
                skipped += 1
            else:
                tested += 1
    return skipped, tested


def main() -> int:
    U.hash_banner("G-01(a) band auto-search is dead code")

    gray = np.array(Image.open(os.path.join(U.ROOT, FIG)).convert("L")).astype(int)
    img_h = int(gray.shape[0])

    print("\n=== 1. 纯数学：对任意 y_bottom，夹取都吃掉全部 60 个组合 ===")
    print("    top ∈ [y_bottom-4, y_bottom+15], bh ∈ {6,7,8}, hi_search = y_bottom")
    print("    最小 top+bh = (y_bottom-4)+6 = y_bottom+2 > y_bottom = hi_search\n")
    all_dead = True
    for yb in (60, 100, 200, 233, 400, 500, 700, 861, 862, 869, 900, 927, 928, 2000):
        skipped, tested = clamp_stats(float(yb), 0.0, max(img_h, yb + 1))
        flag = "全部夹掉" if tested == 0 else f"有 {tested} 个被测"
        if tested != 0:
            all_dead = False
        print(f"    y_bottom={yb:5d}  skipped={skipped:2d}/60  tested={tested:2d}  {flag}")
    print(f"\n    结论：自动 band 搜索是否会产出 band 恒为 False == {all_dead}")
    print("    （不依赖图像内容，也不依赖 ROI 的 y_top，只依赖 hi_search = y_bottom）")

    print("\n=== 2. 唯一能救活它的例外：roi.ylim[1] 远大于真实数据底边 ===")
    print("    即：如果用户把 ROI 底边框到刻度尺**下方**，hi_search 变大，就有救。")
    for yb in (861, 870, 876, 882, 890):
        skipped, tested = clamp_stats(float(yb), 0.0, img_h)
        # 注意此时 hi_search = y_bottom，所以仍为 0；真正的区别在于能否覆盖 top=869
        can_reach = (869 + 6) <= int(round(yb))
        print(f"    ROI y1={yb:5d}: tested={tested:2d}  "
              f"能否覆盖真实齿带 top=869,bh=6 -> {can_reach}")
    print("    说明：即便 tested>0，band 也只能落在 ROI 内部；而真实刻度尺在 ROI *下方*。")
    print("    这正是 production-readiness.md §4.1 那次修复的副作用——")

    print("\n=== 3. 端到端复核：真实 PDF 图版上 detect_xticks_rpc 永远 band=None ===")
    from straditize_core.session import StraditizeSession

    for y1 in (861, 870, 876, 882):
        s = StraditizeSession()
        s._init_cleanup()
        s.load_image(os.path.join(U.ROOT, FIG))
        for r in list(s.rois):
            s.roi_remove(r["id"])
        rid = s.roi_create(name="p", x0=330, x1=1330, y0=233, y1=float(y1),
                           composition=True)["roi"]["id"]
        s.roi_set_primary(rid)
        s.roi_set_active(rid)
        s.extract_foreground()
        s.detect_columns(roi_id=rid)
        xt = s.detect_xticks_rpc(roi_id=rid)
        per = xt.get("per_column") or []
        n_ticks = sum(len(p.get("ticks") or []) for p in per)
        print(f"    ROI y1={y1}: band={xt.get('band')} per_column={len(per)} 总齿={n_ticks}")

    print("\n=== 4. 对照：显式给 band=(869,875) 时，同一图能检出多少齿 ===")
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.join(U.ROOT, FIG))
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="p", x0=330, x1=1330, y0=233, y1=861,
                       composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    s.detect_columns(roi_id=rid)
    xt2 = s.detect_xticks_rpc(roi_id=rid, band=(869, 875))
    per2 = xt2.get("per_column") or []
    with_t = [p for p in per2 if (p.get("ticks") or [])]
    print(f"    band=(869,875) -> band={xt2.get('band')} per_column={len(per2)} "
          f"有齿列={len(with_t)} 总齿={sum(len(p['ticks']) for p in with_t)}")
    print("    => 算法本身完全够用；挡住它的是上面那条恒成立的夹取条件。")

    print("\n=== 5. 回归未破：hoya（真值 has_tick_ruler=false）仍为 0 齿 ===")
    s3 = StraditizeSession()
    s3._init_cleanup()
    s3.load_image(sample_key="hoya")
    s3.extract_foreground()
    s3.detect_columns()
    xt3 = s3.detect_xticks_rpc()
    print(f"    hoya: band={xt3.get('band')} "
          f"per_column={len(xt3.get('per_column') or [])} "
          f"总齿={sum(len(p.get('ticks') or []) for p in (xt3.get('per_column') or []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
