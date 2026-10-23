# -*- coding: utf-8 -*-
"""G-01 补充 B：定位 detect_xticks_rpc 在真实扫描件上「一个齿都检不出」的边界。

已知真值（g01_xticks_probe.py T3a 独立像素实测）：
    ROI x∈[330,1290] 内共有 46 个真实刻度齿，
    齿间隔集中在 25px（26 处）、13px（9 处）、12px（5 处）。

本探针扫一组 ROI 底边 y1，看「检出的齿数」随 y1 如何变化，
从而判定失败是"算法认不出齿"还是"搜索窗口根本没覆盖到齿"。
"""
from __future__ import annotations

import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"

# 真实刻度齿的纵向位置（独立实测：y=870..875 是齿干，876..881 是空白，882..897 是数字）
TICK_STEM_BOTTOM = 875


def probe(y1: float) -> dict[str, object]:
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.join(U.ROOT, FIG))
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(
        name=f"y1_{int(y1)}", x0=330, x1=1330, y0=233, y1=y1, composition=True
    )["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cols = s.detect_columns(roi_id=rid)
    xt = s.detect_xticks_rpc(roi_id=rid)
    per = xt.get("per_column") or []
    with_ticks = [p for p in per if (p.get("ticks") or [])]
    return {
        "roi_y1": y1,
        "search_window_top_range": [int(y1) - 4, int(y1) + 15],
        "n_cols": len(cols),
        "band": xt.get("band"),
        "n_per_column": len(per),
        "n_cols_with_ticks": len(with_ticks),
        "total_ticks": sum(len(p["ticks"]) for p in with_ticks),
    }


def main() -> int:
    U.hash_banner("G-01 xticks ROI-bottom sweep")
    print(f"\n独立实测：真实刻度齿干位于 y=870..{TICK_STEM_BOTTOM}")
    print("搜索窗口 = [y1-4, y1+15)，band 高度 6/7/8\n")
    rows = []
    for y1 in (861, 870, 875, 876, 880, 882, 890, 900):
        r = probe(float(y1))
        rows.append(r)
        print(f"  y1={y1:4d}  window={r['search_window_top_range']}  "
              f"cols={r['n_cols']:2d}  band={r['band']}  "
              f"cols_with_ticks={r['n_cols_with_ticks']:2d}  total_ticks={r['total_ticks']}")
    ok = [r for r in rows if r["total_ticks"] > 0]
    print(f"\n有齿输出的 y1 取值: {[r['roi_y1'] for r in ok]}")
    print(f"无齿输出的 y1 取值: {[r['roi_y1'] for r in rows if r['total_ticks'] == 0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
