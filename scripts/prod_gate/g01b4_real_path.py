# -*- coding: utf-8 -*-
"""G-01(b4)：贴近真实用户路径的 stale-samples 复现。

b3 用的是 samples_set 人工写 samples（row_px 默认 0），会被质疑"你自己构造的"。
本探针走**真实用户路径**：在 page5 上完整走到 apply_depth_grid，
让 samples 由后端自己生成（带真实 row_px），再 switch 到 page9 继续做，
看 page9 的导出是不是被 page5 的 samples 劫持。

对照组：全新会话直接在 page9 做同样的事。

判据：
  - 若 A 组导出的深度列 == page5 的深度序列、且数值全 0 → 真缺陷（静默产出错数据）
  - 若 A、B 完全一致 → 无污染
"""
from __future__ import annotations

import hashlib
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate"

# page5（2132x928）与 page9（1305x1946）都用「贴住数据区」的 ROI
P5 = dict(x0=330, x1=1330, y0=233, y1=861)
P9 = dict(x0=100, x1=1200, y0=200, y1=1700)


def do_full_chain(s, roi_def: dict[str, int], depth_max: float, tag: str) -> dict[str, object]:
    """在当前已载入的页面上走 detect→clean→columns→calibrate→digitize→depth_grid。"""
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(
        name=tag, x0=roi_def["x0"], x1=roi_def["x1"],
        y0=roi_def["y0"], y1=roi_def["y1"], composition=True,
    )["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cands = s.detect_line_candidates(roi_id=rid)["candidates"]
    h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
    if h_ids:
        s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
    cols = s.detect_columns(roi_id=rid)
    if not cols:
        return {"error": "no columns"}
    c0 = cols[0]
    lo = c0["start"] + (c0["end"] - c0["start"]) * 0.2
    hi = c0["start"] + (c0["end"] - c0["start"]) * 0.8
    s.calibrate_column_xticks(
        c0["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 40.0}], unit="%"
    )
    y_top, y_bot = roi_def["y0"], roi_def["y1"] - 8
    s.calibrate_axes(
        y_marks=[{"pixel": float(y_top), "val": 0.0}, {"pixel": float(y_bot), "val": depth_max}],
        unit="cm",
    )
    for i in range(len(cols)):
        try:
            s.digitize(i)
        except Exception as exc:
            print(f"      digitize col{i} FAIL: {exc}")
    grid = s.apply_depth_grid(start_depth=0.0, end_depth=depth_max, step=5.0)
    samples = getattr(s, "samples", []) or []
    return {
        "n_candidates_h": len(h_ids),
        "n_columns": len(cols),
        "n_grid": grid.get("count"),
        "n_samples": len(samples),
        "samples_head": samples[:3],
        "samples_rowpx": [s_.get("row_px") for s_ in samples[:5]],
    }


def paste_depths_on_current_page(s, depth_max: float) -> dict[str, object]:
    """真实用户动作：在【步骤 7 层位】粘贴一串真实深度。

    走 samples_paste_depths（它要求已有 Y 轴标定，会把深度反算成 row_px）。
    """
    depths = [float(i) * 5.0 for i in range(0, int(depth_max // 5) + 1)]
    try:
        r = s.samples_paste_depths(depths)
        samples = getattr(s, "samples", []) or []
        return {
            "ok": True,
            "pasted_depths": len(depths),
            "n_samples": len(samples),
            "rowpx_head": [x.get("row_px") for x in samples[:5]],
            "depth_head": [x.get("depth") for x in samples[:5]],
        }
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def digest(path: str):
    if not os.path.exists(path):
        return None
    data = open(path, "rb").read()
    return len(data), hashlib.sha1(data).hexdigest()


def read_csv(path: str, n: int = 6):
    if not os.path.exists(path):
        return None, None
    lines = open(path, encoding="utf-8").read().splitlines()
    return lines[:n], len(lines)


def main() -> int:
    U.hash_banner("G-01(b4) real-path stale samples")
    from straditize_core.session import StraditizeSession

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)

    # ================= 组 A：page5 走完整链路 + 粘贴深度 → switch page9 → 完整链路 → 导出 =================
    print("\n=== 组 A：page5 完整链路 + 粘贴深度 -> switch_pdf_page(9) -> page9 完整链路 ===")
    sa = StraditizeSession()
    sa._init_cleanup()
    sa.load_image(os.path.abspath(PDF), page_number=5)
    a5 = do_full_chain(sa, P5, 787.0, "p5")
    print(f"    page5 链路: { {k: v for k, v in a5.items() if k != 'samples_head'} }")
    paste5 = paste_depths_on_current_page(sa, 787.0)
    print(f"    page5 粘贴深度: {paste5}")

    print("\n    >>> switch_pdf_page(9)")
    sa.switch_pdf_page(9)
    n_samples_after = len(getattr(sa, "samples", []) or [])
    print(f"    switch 后: page={(sa.pdf_info or {}).get('current_page')} "
          f"size={sa.width}x{sa.height} n_samples={n_samples_after}")
    live = getattr(sa, "samples", None) or []
    print(f"    switch 后 samples.row_px[:5] = {[x.get('row_px') for x in live[:5]]}")
    print(f"    switch 后 samples.depth[:5]  = {[x.get('depth') for x in live[:5]]}")
    print(f"    switch 后 y_scale = {getattr(sa, 'y_scale', None)}")
    print(f"    switch 后 is_calibrated = {getattr(sa, 'is_calibrated', None)}")

    a9 = do_full_chain(sa, P9, 500.0, "p9")
    print(f"    page9 链路: { {k: v for k, v in a9.items() if k != 'samples_head'} }")
    n_after_p9 = len(getattr(sa, "samples", []) or [])
    print(f"    page9 走完链路后 n_samples = {n_after_p9}  (若仍 >0 说明残留未被新页清掉)")
    live9 = getattr(sa, "samples", None) or []
    print(f"    page9 samples.row_px[:5] = {[x.get('row_px') for x in live9[:5]]}")

    a_csv = os.path.join(U.ROOT, OUT_DIR, "g01b4_A_stale.csv")
    ea = sa.export_data(format="csv", output_path=a_csv)
    print(f"    A 导出: rows={ea.get('rows_count')} cols={ea.get('columns_count')}")

    # ================= 组 B：全新会话直接 page9 =================
    print("\n=== 组 B（对照）：全新会话直接 page9 完整链路 ===")
    sb = StraditizeSession()
    sb._init_cleanup()
    sb.load_image(os.path.abspath(PDF), page_number=9)
    b9 = do_full_chain(sb, P9, 500.0, "p9")
    print(f"    page9 链路: { {k: v for k, v in b9.items() if k != 'samples_head'} }")
    print(f"    B 组 n_samples = {len(getattr(sb, 'samples', []) or [])}")
    b_csv = os.path.join(U.ROOT, OUT_DIR, "g01b4_B_clean.csv")
    eb = sb.export_data(format="csv", output_path=b_csv)
    print(f"    B 导出: rows={eb.get('rows_count')} cols={eb.get('columns_count')}")

    # ================= 对账 =================
    print("\n=== A vs B 对账 ===")
    da, db = digest(a_csv), digest(b_csv)
    print(f"    A: {da}")
    print(f"    B: {db}")
    print(f"    完全一致: {da == db}")
    ha, na = read_csv(a_csv)
    hb, nb = read_csv(b_csv)
    print(f"    A 前 6 行 (含表头) / 总行数 {na}:")
    for ln in ha or []:
        print(f"      {ln[:150]}")
    print(f"    B 前 6 行 (含表头) / 总行数 {nb}:")
    for ln in hb or []:
        print(f"      {ln[:150]}")

    if ha and hb:
        print(f"    表头一致: {ha[0] == hb[0]}")

    def nonzero_count(path: str) -> tuple[int, int]:
        if not os.path.exists(path):
            return 0, 0
        lines = open(path, encoding="utf-8").read().splitlines()[1:]
        nz = 0
        tot = 0
        for ln in lines:
            for p in ln.split(",")[1:]:
                tot += 1
                try:
                    if float(p) != 0.0:
                        nz += 1
                except ValueError:
                    pass
        return nz, tot

    nzA, totA = nonzero_count(a_csv)
    nzB, totB = nonzero_count(b_csv)
    print(f"\n    A 组数值格: 非零 {nzA} / 总 {totA}")
    print(f"    B 组数值格: 非零 {nzB} / 总 {totB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
