# -*- coding: utf-8 -*-
"""G-01(b3)：残留 samples 会不会真的污染新页的导出数值 —— 判别性实验。

b2 已证明：page5 写入的 20 条 samples 在 switch 到 page9 后仍然存活，
并被写进 page9 的工程包。但"字段存活"不等于"数值被污染"。
本探针做**对照实验**，只有当两者导出数值不同，才能把残留定级为数据缺陷：

  组 A（污染路径）：page5 写 samples(20 条, row_px=0, 5cm 步长)
                     -> switch page9 -> 分列/标定/数字化 -> apply_depth_grid -> export
  组 B（干净路径）：直接 load page9 -> 分列/标定/数字化 -> apply_depth_grid -> export

若 A 与 B 的导出完全一致，说明 apply_depth_grid 会覆盖残留 samples，
残留只是"脏状态"，不是"错数值"。若不一致，则是真缺陷。
"""
from __future__ import annotations

import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate"

# page 9 的真图版是 1305x1946（独立实测，见 g01_pdf_inventory.py）
P9_X0, P9_X1, P9_Y0, P9_Y1 = 100, 1200, 200, 1700


def build(s, page: int, preset_samples: bool) -> dict[str, object]:
    s.load_image(os.path.abspath(PDF), page_number=page)
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(
        name=f"p{page}", x0=P9_X0, x1=P9_X1, y0=P9_Y0, y1=P9_Y1, composition=True
    )["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cols = s.detect_columns(roi_id=rid)
    if not cols:
        return {"error": "detect_columns 无可列入"}
    c0 = cols[0]
    lo = c0["start"] + (c0["end"] - c0["start"]) * 0.2
    hi = c0["start"] + (c0["end"] - c0["start"]) * 0.8
    s.calibrate_column_xticks(
        c0["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 40.0}], unit="%"
    )
    s.calibrate_axes(
        y_marks=[{"pixel": float(P9_Y0), "val": 0.0}, {"pixel": float(P9_Y1 - 8), "val": 500.0}],
        unit="cm",
    )
    for i in range(len(cols)):
        try:
            s.digitize(i)
        except Exception:
            pass
    grid = s.apply_depth_grid(start_depth=0.0, end_depth=500.0, step=5.0)
    return {
        "n_columns": len(cols),
        "n_grid": grid.get("count"),
        "n_samples_after_grid": len(getattr(s, "samples", []) or []),
        "samples_head": (getattr(s, "samples", []) or [])[:3],
    }


def main() -> int:
    U.hash_banner("G-01(b3) stale samples vs export values")
    from straditize_core.session import StraditizeSession

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)

    # ---------- 组 A：先在第 5 页写 samples，再换到第 9 页 ----------
    print("\n=== 组 A：page5 写 20 条 samples -> switch_pdf_page(9) -> 建状态 -> 导出 ===")
    sa = StraditizeSession()
    sa._init_cleanup()
    sa.load_image(os.path.abspath(PDF), page_number=5)
    sa.samples_set([{"depth": float(i) * 5.0, "label": f"{i * 5}cm"} for i in range(20)])
    print(f"    page5 写入 samples = {len(sa.samples)} 条 (5cm 步长 0..95)")
    sa.switch_pdf_page(9)
    print(f"    switch 后 samples = {len(sa.samples)} 条  page={(sa.pdf_info or {}).get('current_page')}")
    a_info = build(sa, 9, preset_samples=True) if False else None
    # build() 内部会重新 load page9，这会把 samples 保留吗？——这本身就是要测的
    a_info = build(sa, 9, preset_samples=True)
    U.jprint(a_info)
    print(f"    A 组 samples 头三条 = {(getattr(sa,'samples',[]) or [])[:3]}")
    a_csv = os.path.join(U.ROOT, OUT_DIR, "g01b3_A.csv")
    try:
        ea = sa.export_data(format="csv", output_path=a_csv)
        print(f"    A 导出: rows={ea.get('rows_count')} cols={ea.get('columns_count')}")
    except Exception as exc:
        print(f"    A 导出失败 {type(exc).__name__}: {exc}")
        ea = None

    # ---------- 组 B：全新会话直接 page9 ----------
    print("\n=== 组 B（对照）：全新会话直接 page9 -> 建状态 -> 导出 ===")
    sb = StraditizeSession()
    sb._init_cleanup()
    b_info = build(sb, 9, preset_samples=False)
    U.jprint(b_info)
    print(f"    B 组 samples 头三条 = {(getattr(sb,'samples',[]) or [])[:3]}")
    b_csv = os.path.join(U.ROOT, OUT_DIR, "g01b3_B.csv")
    try:
        eb = sb.export_data(format="csv", output_path=b_csv)
        print(f"    B 导出: rows={eb.get('rows_count')} cols={eb.get('columns_count')}")
    except Exception as exc:
        print(f"    B 导出失败 {type(exc).__name__}: {exc}")
        eb = None

    # ---------- 对账 ----------
    print("\n=== A vs B 逐字节对比 ===")
    import hashlib

    def digest(p: str):
        if not os.path.exists(p):
            return None
        data = open(p, "rb").read()
        return len(data), hashlib.sha1(data).hexdigest()

    da, db = digest(a_csv), digest(b_csv)
    print(f"    A: {da}")
    print(f"    B: {db}")
    if da and db:
        same = da == db
        print(f"    完全一致: {same}")
        if not same:
            la = open(a_csv, encoding="utf-8").read().splitlines()
            lb = open(b_csv, encoding="utf-8").read().splitlines()
            print(f"    行数 A={len(la)} B={len(lb)}")
            diff = 0
            for i, (x, y) in enumerate(zip(la, lb)):
                if x != y:
                    diff += 1
                    if diff <= 5:
                        print(f"      行{i}: A={x[:120]}")
                        print(f"              B={y[:120]}")
            print(f"    不同的行数 = {diff}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
