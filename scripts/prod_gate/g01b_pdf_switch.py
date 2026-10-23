# -*- coding: utf-8 -*-
"""G-01(b)：switchPdfPage 换页后的状态残留 —— 本任务最关键的一条。

为什么专门验这条（Lead 的怀疑，我用实验判定真伪）：
  B-03 的修法是两半——① load_image/project_new 显式清空几何；
  ② cleanup._geometry_scope() 做纵深防御，绑定 image_path + width + height。
  PDF 换页时 image_path **完全不变**，`_decode_diagram_source` 返回的
  resolved_path 仍是同一个 PDF 路径。于是纵深防御只剩 width/height 两维。
  若两页的内嵌位图尺寸相同，_geometry_scope() 无法区分两页。

本探针分三组：
  E1  真实 PDF：第 5 页做完整操作 → switch_pdf_page(7) → 看什么被清了、什么没清。
  E2  真实 PDF：第 5 页做完整操作 → switch 到纯矢量页（第 6 页，必抛错）
      → 看抛错后会话处于什么状态（旧图还在？标定还在？）。
  E3  构造同尺寸 PDF（两页各嵌一张同样 2132x928 的图，内容不同）：
      在 A 页做清理几何 + 标定 → switch 到 B 页 → 检查几何与 x_ticks 是否残留。
      这是 §b 怀疑的**判别性实验**：若 E3 出错而 E1 不错，说明只因尺寸恰好不同而侥幸。
"""
from __future__ import annotations

import hashlib
import io
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate"


def snapshot(s, label: str) -> dict[str, object]:
    """把"换页后该不该活着"的全部状态拍一张快照。"""
    cols = getattr(s, "columns", []) or []
    snap = {
        "label": label,
        "image_path": getattr(s, "image_path", None),
        "size": (getattr(s, "width", None), getattr(s, "height", None)),
        "format": getattr(s, "format", None),
        "pdf_current_page": (getattr(s, "pdf_info", None) or {}).get("current_page"),
        "n_rois": len(getattr(s, "rois", []) or []),
        "roi_ids": [r["id"] for r in (getattr(s, "rois", []) or [])],
        "roi_xlim": [r["xlim"] for r in (getattr(s, "rois", []) or [])],
        "n_columns": len(cols),
        "col_ids": [c["id"] for c in cols][:20],
        "cols_with_x_ticks": [c["id"] for c in cols if c.get("x_ticks")],
        "x_ticks_sample": [
            {"id": c["id"], "x_ticks": c["x_ticks"]} for c in cols if c.get("x_ticks")
        ][:3],
        "is_calibrated": getattr(s, "is_calibrated", None),
        "y_scale": getattr(s, "y_scale", None),
        "n_line_candidates": len(getattr(s, "line_candidates", []) or []),
        "line_cand_ids": [c.get("id") for c in (getattr(s, "line_candidates", []) or [])][:20],
        "line_cand_status": [
            (c.get("id"), c.get("status")) for c in (getattr(s, "line_candidates", []) or [])
        ][:20],
        "line_cand_scopes": [
            (c.get("id"), c.get("scope")) for c in (getattr(s, "line_candidates", []) or [])
        ][:3],
        "n_selected_candidate_ids": len(getattr(s, "selected_candidate_ids", set()) or set()),
        "n_exclusion_regions": len(getattr(s, "exclusion_regions", []) or []),
        "n_line_strokes": len(getattr(s, "line_strokes", []) or []),
        "n_column_points": len(getattr(s, "column_points", {}) or {}),
        "n_samples": len(getattr(s, "samples", []) or []),
        "n_depth_grid": len(getattr(s, "depth_grid", []) or []),
        "foreground_mask": (
            "None" if getattr(s, "foreground_mask", None) is None
            else f"<array {getattr(s.foreground_mask, 'shape', '?')}>"
        ),
        "candidate_line_mask": (
            "None" if getattr(s, "candidate_line_mask", None) is None
            else f"<array {getattr(s.candidate_line_mask, 'shape', '?')}>"
        ),
        "cached_pdf_path": getattr(s, "cached_pdf_path", None),
        "geometry_scope": (
            s._geometry_scope() if hasattr(s, "_geometry_scope") else "<no _geometry_scope>"
        ),
    }
    return snap


def build_state_on_page5(s):
    """在第 5 页做：ROI → 清理几何（确认 4 条横线）→ 分列 → 标定两列 → Y 轴。"""
    info = s.load_image(os.path.abspath(PDF), page_number=5)
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="p5", x0=330, x1=1330, y0=233, y1=861, composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cands = s.detect_line_candidates(roi_id=rid)["candidates"]
    h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
    s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
    cols = s.detect_columns(roi_id=rid)
    s.calibrate_column_xticks(
        cols[9]["id"], ticks=[{"px": 742.0, "value": 20.0}, {"px": 883.0, "value": 80.0}], unit="%"
    )
    s.calibrate_column_xticks(
        cols[10]["id"], ticks=[{"px": 954.0, "value": 20.0}, {"px": 1047.0, "value": 60.0}], unit="%"
    )
    s.calibrate_axes(
        y_marks=[{"pixel": 232.0, "val": 0.0}, {"pixel": 862.0, "val": 787.0}], unit="cm"
    )
    return info, rid, cols, h_ids


def e1_real_page_switch() -> None:
    from straditize_core.session import StraditizeSession

    print("\n" + "#" * 78)
    print("# E1  真实 PDF: 第 5 页做完整操作 -> switch_pdf_page(7)")
    print("#" * 78)
    s = StraditizeSession()
    s._init_cleanup()
    info, rid, cols, h_ids = build_state_on_page5(s)
    before = snapshot(s, "before_switch (page5)")
    U.jprint(before)

    print("\n>>> switch_pdf_page(7)")
    try:
        res = s.switch_pdf_page(7)
        after = snapshot(s, "after_switch (page7)")
        U.jprint(after)
        print("\n--- E1 判定：换页后哪些状态活了下来 ---")
        for key in (
            "n_columns", "cols_with_x_ticks", "is_calibrated", "y_scale",
            "n_line_candidates", "n_selected_candidate_ids", "n_column_points",
            "roi_ids", "roi_xlim", "geometry_scope", "pdf_current_page", "size",
        ):
            b, a = before.get(key), after.get(key)
            flag = "残留!" if (a not in (None, 0, [], {}, set(), "None") and b not in (None, 0, [], {}, set())) else ""
            print(f"    {key:26s} before={b!r:40.40s} after={a!r:40.40s} {flag}")
    except Exception as exc:
        print(f"    switch FAILED: {type(exc).__name__}: {exc}")
        U.jprint(snapshot(s, "after_failed_switch"))
        return

    # B 页（page 7）上真实读一次数：看残留几何/x_ticks 是否影响读数
    print("\n>>> 在 page7 上抽一列读数，看是否被 page5 的残留影响")
    try:
        cols7 = s.detect_columns()
        print(f"    page7 detect_columns -> {len(cols7)} 列")
        if cols7:
            r = s.digitize(0)
            pts = r.get("points") or []
            print(f"    page7 col0 digitize -> {len(pts)} 点")
            print(f"    page7 col0 x_ticks = {cols7[0].get('x_ticks')}")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")


def e2_switch_to_vector_page() -> None:
    from straditize_core.session import StraditizeSession

    print("\n" + "#" * 78)
    print("# E2  真实 PDF: 第 5 页做操作 -> switch_pdf_page(6)（纯矢量页，必抛错）")
    print("#" * 78)
    s = StraditizeSession()
    s._init_cleanup()
    info, rid, cols, h_ids = build_state_on_page5(s)
    before = snapshot(s, "before_switch (page5)")
    print(f"    before: page={before['pdf_current_page']} cols={before['n_columns']} "
          f"x_ticks列={len(before['cols_with_x_ticks'])} y_scale={before['y_scale']}")

    print("\n>>> switch_pdf_page(6)")
    exc_msg = None
    try:
        s.switch_pdf_page(6)
    except Exception as exc:
        exc_msg = f"{type(exc).__name__}: {exc}"
    after = snapshot(s, "after_failed_switch")
    print(f"    抛出: {exc_msg}")
    print(f"    after : page={after['pdf_current_page']} size={after['size']} "
          f"cols={after['n_columns']} x_ticks列={len(after['cols_with_x_ticks'])} "
          f"y_scale={after['y_scale']} line_cands={after['n_line_candidates']}")
    print("\n--- E2 判定：换页失败后，会话是「完好停在原页」还是「半残」 ---")
    consistent = (
        after["pdf_current_page"] == 5
        and after["size"] == before["size"]
        and after["n_columns"] == before["n_columns"]
        and after["y_scale"] == before["y_scale"]
    )
    print(f"    会话与失败前是否一致: {consistent}")
    if not consistent:
        for k in ("pdf_current_page", "size", "n_columns", "is_calibrated", "y_scale",
                  "n_line_candidates", "roi_ids", "cols_with_x_ticks"):
            if before.get(k) != after.get(k):
                print(f"      DIFF {k}: before={before.get(k)!r} after={after.get(k)!r}")

    # 失败后再读一次：后端还能不能正常算
    print("\n>>> 失败后在同一会话继续尝试 digitize（检验是否处于半完成态）")
    try:
        r = s.digitize(0)
        print(f"    digitize(0) -> {len(r.get('points') or [])} 点")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")


def make_same_size_pdf(path: str) -> str:
    """构造两页尺寸相同的 PDF：page1=A 图，page2=B 图（内容不同、尺寸同为 2132x928）。

    用 PIL 直接写多页 PDF，再用 pypdf 复验每页内嵌位图的真实像素尺寸
    （PIL 会按 resolution 重采样，所以不能假设存进去就是 2132x928）。
    """
    from PIL import Image, ImageDraw

    W, H = 2132, 928
    pages = []
    for tag in ("A", "B"):
        im = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(im)
        if tag == "A":
            # A 页：4 条贯穿横线（模拟分区线）+ 若干竖线（模拟列分界）
            for y in (100, 300, 500, 700):
                d.line([(0, y), (W, y)], fill=(0, 0, 0), width=2)
            for x in range(100, W - 100, 120):
                d.line([(x, 60), (x, H - 60)], fill=(0, 0, 0), width=1)
        else:
            # B 页：只有一个矩形框，没有任何贯穿横线。
            # 若 A 页的横线几何残留过来，B 页会凭空少掉 4 条横带宽度的墨迹。
            d.rectangle([100, 60, 400, H - 60], outline=(0, 0, 0), width=2)
            d.line([(100, H - 60), (400, H - 60)], fill=(0, 0, 0), width=2)
        pages.append(im)

    pages[0].save(path, format="PDF", save_all=True, append_images=pages[1:], resolution=W / 8.5)
    return path


def e3_same_size_two_pages() -> None:
    from straditize_core.session import StraditizeSession

    print("\n" + "#" * 78)
    print("# E3  构造两页同尺寸 PDF（A/B 均含一张位图，内容不同）-> 验证 _geometry_scope 失效")
    print("#" * 78)
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    pdf_path = os.path.join(U.ROOT, OUT_DIR, "same_size_two_pages.pdf")
    make_same_size_pdf(pdf_path)
    print(f"    构造: {pdf_path}  {os.path.getsize(pdf_path)} B")

    # 先用 pypdf 确认每页位图尺寸
    from pypdf import PdfReader

    rd = PdfReader(pdf_path)
    for i, p in enumerate(rd.pages, start=1):
        sizes = []
        for im in p.images:
            im.image.load()
            sizes.append(f"{im.image.size[0]}x{im.image.size[1]}")
        print(f"    page {i}: n_images={len(sizes)} sizes={sizes}")

    s = StraditizeSession()
    s._init_cleanup()
    info = s.load_image(pdf_path, page_number=1)
    print(f"\n    load page1 -> {info['width']}x{info['height']} format={info['format']} "
          f"pdf_info={info['pdf_info']}")
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="A", x0=0, x1=2132, y0=0, y1=928, composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cands = s.detect_line_candidates(roi_id=rid)["candidates"]
    print(f"    A 页 line candidates = {len(cands)}")
    for c in cands:
        g = c.get("geometry", {})
        print(f"      {c['id']:12s} kind={c.get('kind')} y0={g.get('y0')} x0={g.get('x0')}")
    h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
    res = s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
    print(f"    A 页选中 {len(h_ids)} 条横线并应用清理")
    cols = s.detect_columns(roi_id=rid)
    print(f"    A 页 detect_columns -> {len(cols)} 列")
    if cols:
        c0 = cols[0]
        print(f"    A 页 col0 边界 = [{c0['start']}, {c0['end']}]")
        # 刻度点必须落在列物理范围内（后端有守卫），按列宽取内缩的两个点
        lo = c0["start"] + (c0["end"] - c0["start"]) * 0.2
        hi = c0["start"] + (c0["end"] - c0["start"]) * 0.8
        s.calibrate_column_xticks(
            c0["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 40.0}], unit="%"
        )
        print(f"    A 页 col0 x_ticks = {s.columns[0].get('x_ticks')}")
    s.calibrate_axes(y_marks=[{"pixel": 60.0, "val": 0.0}, {"pixel": 868.0, "val": 500.0}], unit="cm")
    before = snapshot(s, "before_switch (A page)")
    U.jprint({k: before[k] for k in (
        "size", "pdf_current_page", "n_columns", "cols_with_x_ticks", "y_scale",
        "n_line_candidates", "line_cand_status", "geometry_scope", "image_path")})

    print("\n>>> switch_pdf_page(2)  —— 两页同尺寸、同 image_path")
    try:
        s.switch_pdf_page(2)
    except Exception as exc:
        print(f"    FAILED {type(exc).__name__}: {exc}")
        return
    after = snapshot(s, "after_switch (B page)")
    U.jprint({k: after[k] for k in (
        "size", "pdf_current_page", "n_columns", "cols_with_x_ticks", "y_scale",
        "n_line_candidates", "line_cand_status", "geometry_scope", "image_path",
        "is_calibrated", "roi_ids", "roi_xlim")})

    print("\n--- E3 判定 ---")
    print(f"    B 页残留 line_candidates : {after['n_line_candidates']}")
    print(f"    B 页残留 x_ticks 的列     : {after['cols_with_x_ticks']}")
    print(f"    B 页 y_scale             : {after['y_scale']}")
    print(f"    A/B 的 _geometry_scope 是否相同: {before['geometry_scope'] == after['geometry_scope']}")

    print("\n>>> 在 B 页真跑一次清理候选，检验旧几何是否被当成 B 页的")
    try:
        candsB = s.detect_line_candidates(roi_id=(s.active_roi_id or s.rois[0]["id"]))["candidates"]
        print(f"    B 页 line candidates = {len(candsB)}")
        for c in candsB:
            g = c.get("geometry", {})
            print(f"      {c['id']:12s} kind={c.get('kind')} y0={g.get('y0')} status={c.get('status')}")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")


def main() -> int:
    U.hash_banner("G-01(b) switchPdfPage residue")
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "e1"):
        e1_real_page_switch()
    if which in ("all", "e2"):
        e2_switch_to_vector_page()
    if which in ("all", "e3"):
        e3_same_size_two_pages()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
