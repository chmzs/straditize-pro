# -*- coding: utf-8 -*-
"""G-01 补充：刻度齿检测在真实扫描件上的行为（直接回答 U-05 的两条担忧）。

U-05 原文担忧：
  a) "数千 px 图下自动提取是否命中过多列"
  b) "6px 粗分区线是否被当刻度"

本探针分三段：
  T1  用「贴住数据区的 ROI」——真实用户默认会这么框。看 detect_xticks_rpc 给出什么。
  T2  把 ROI 向下扩到包含刻度尺（y1=882），看是否能检出、检出了多少、有没有把
      横线当齿。
  T3  独立像素真值：直接在位图上数出真实的刻度齿位置与间隔，作为 T1/T2 的对照真值。
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"


def truth_ticks() -> dict[str, object]:
    """独立数出真实刻度齿：在 y=871..875（齿干）上找各类宽内 1-2px 的孤立竖线。"""
    a = np.array(Image.open(os.path.join(U.ROOT, FIG)).convert("L")).astype(int)
    band = a[871:876, :]  # 齿干所在行（实测 y=870..875 有短齿）
    dark = (band < 160).all(axis=0)  # 这 5 行都暗 = 竖齿
    xs = np.where(dark)[0]
    merged: list[int] = []
    for x in xs:
        if merged and x - merged[-1] <= 2:
            merged[-1] = int(round((merged[-1] + x) / 2))
        else:
            merged.append(int(x))
    ticks = [x for x in merged if 330 <= x <= 1290]
    gaps = np.diff(ticks) if len(ticks) > 1 else np.array([])
    return {
        "n_ticks_in_330_1290": len(ticks),
        "first_20": ticks[:20],
        "gap_values": sorted({int(g) for g in gaps}),
        "gap_hist": {int(g): int((gaps == g).sum()) for g in sorted(set(gaps.tolist()))}
        if gaps.size
        else {},
    }


def thickness_truth() -> dict[str, object]:
    """独立量出横线/竖线的真实粗细，检验「6px 粗分区线」这个前提。"""
    a = np.array(Image.open(os.path.join(U.ROOT, FIG)).convert("L")).astype(int)
    sub = a[230:875, 330:1330]
    nonwhite = (sub < 250).mean(axis=1)
    rows = [(y + 230, float(nonwhite[y])) for y in range(len(nonwhite)) if nonwhite[y] > 0.97]
    groups: list[list[tuple[int, float]]] = []
    for y, f in rows:
        if groups and y - groups[-1][-1][0] <= 1:
            groups[-1].append((y, f))
        else:
            groups.append([(y, f)])
    hlines = [
        {"y0": g[0][0], "y1": g[-1][0], "thickness": len(g), "coverage": round(max(f for _, f in g), 4)}
        for g in groups
    ]
    # 竖线：在 y=845..858（数据区下方、框线之上）量
    vband = a[845:858, :].mean(axis=0)
    vrows = [(x, float(vband[x])) for x in range(180, 1500) if vband[x] < 240]
    vgroups: list[list[tuple[int, float]]] = []
    for x, v in vrows:
        if vgroups and x - vgroups[-1][-1][0] <= 1:
            vgroups[-1].append((x, v))
        else:
            vgroups.append([(x, v)])
    vlines = [
        {"x0": g[0][0], "x1": g[-1][0], "thickness": len(g)}
        for g in vgroups
        if len(g) <= 20  # 只报细线，宽的暗块是数据本身
    ]
    return {"full_width_horizontal_lines": hlines, "thin_vertical_lines_y845_858": vlines}


def run_xticks(label: str, y1: float) -> dict[str, object]:
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.join(U.ROOT, FIG))
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(
        name=f"probe_{label}", x0=330, x1=1330, y0=233, y1=y1, composition=True
    )["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cols = s.detect_columns(roi_id=rid)
    xt = s.detect_xticks_rpc(roi_id=rid)
    per = xt.get("per_column") or []
    detail = []
    for p in per:
        ticks = p.get("ticks") or []
        if ticks:
            detail.append(
                {
                    "col": p.get("col_id") or p.get("index"),
                    "n": len(ticks),
                    "ticks": [round(float(t), 1) for t in ticks],
                }
            )
    return {
        "roi_ylim": [233.0, y1],
        "n_columns": len(cols),
        "band": xt.get("band"),
        "n_per_column": len(per),
        "cols_with_ticks": len(detail),
        "total_ticks": sum(d["n"] for d in detail),
        "detail": detail,
    }


def main() -> int:
    U.hash_banner("G-01 U-05 probes")
    print("\n--- T3a 真实刻度齿（独立像素计数） ---")
    U.jprint(truth_ticks())
    print("\n--- T3b 线条粗细真值（检验「6px 粗分区线」前提） ---")
    U.jprint(thickness_truth())
    print("\n--- T1 ROI 贴住数据区 (y1=861) ---")
    U.jprint(run_xticks("tight", 861.0))
    print("\n--- T2 ROI 扩到含刻度尺 (y1=882) ---")
    U.jprint(run_xticks("with_ticks", 882.0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
