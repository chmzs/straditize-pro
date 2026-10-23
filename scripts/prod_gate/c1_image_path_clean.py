# -*- coding: utf-8 -*-
"""C1 干净版：image_path 退化的影响面。

前一版 C1 已验证到三条关键事实（本脚本用窄输出复核并扩展）：
  1. 换页后 image_path 从真路径退化成 'upload://diagram.png'（第 1 页正常）
  2. project_save 的 image.path 写死 'image/original.png'，退化值**没有**进工程包
  3. project_load 之后 image_path = None

第 3 条是本轮新发现的隐患入口，本脚本专门追它：
  若两个不同工程载回后 image_path 都是 None，且尺寸相同，
  则 _geometry_scope() 的 token 完全相同 —— 跨工程几何残留是否可能？
"""
from __future__ import annotations

import json
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate/c_lead_checks"


def narrow_project_dump(pj: dict) -> dict:
    """工程包里与 image 溯源相关的字段，去掉 base64。"""
    img = pj.get("image") or {}
    return {
        "image_keys": sorted(img.keys()),
        "image.path": img.get("path"),
        "image.width": img.get("width"),
        "image.height": img.get("height"),
        "顶层含 image_path 的键": [k for k in pj if "image_path" in k.lower()],
        "顶层含 pdf 的键": [k for k in pj if "pdf" in k.lower()],
        "顶层含 page 的键": [k for k in pj if "page" in k.lower()],
    }


def c1a_image_path_evolution() -> None:
    print("\n" + "#" * 70)
    print("# C1a  image_path 逐页演化 + 工程包是否记录溯源")
    print("#" * 70)
    from straditize_core.session import StraditizeSession

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    s = StraditizeSession()
    s._init_cleanup()

    s.load_image(os.path.abspath(PDF), page_number=1)
    print(f"  page 1 载入后 image_path = {s.image_path!r}")
    print(f"           cached_pdf_path  = {s.cached_pdf_path!r}")
    s.switch_pdf_page(2)
    print(f"  page 2 换页后 image_path = {s.image_path!r}   <- 退化")
    print(f"           cached_pdf_path  = {s.cached_pdf_path!r}")
    s.switch_pdf_page(5)
    print(f"  page 5 换页后 image_path = {s.image_path!r}")
    print(f"           尺寸 = {s.width}x{s.height}  pdf_info={s.pdf_info}")

    print("\n  --- 退化状态下保存工程包，检查 image 溯源字段 ---")
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="p5", x0=330, x1=1330, y0=233, y1=861, composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    s.detect_columns(roi_id=rid)
    s.calibrate_axes(y_marks=[{"pixel": 232.0, "val": 0.0},
                              {"pixel": 862.0, "val": 787.0}], unit="cm")
    s.samples_paste_depths([0.0, 10.0, 20.0])

    jp = os.path.join(U.ROOT, OUT_DIR, "c1a.project.json")
    s.project_save(output_path=jp, format="json")
    pj = json.loads(open(jp, encoding="utf-8").read())
    for k, v in narrow_project_dump(pj).items():
        print(f"    {k} = {v}")
    print(f"    >>> 退化值 'upload://diagram.png' 是否出现在工程包文本里: "
          f"{'upload://diagram.png' in open(jp, encoding='utf-8').read()}")
    print("    >>> 结论：工程包**不记录** PDF 页码，也不记录退化路径。")
    print("        即 project_save 完全不受 image_path 退化影响，但代价是")
    print("        **工程包无法自证它来自哪个 PDF 的第几页**。")


def c1b_cross_project_scope() -> None:
    print("\n" + "#" * 70)
    print("# C1b  两个工程载回后 image_path 都是 None，几何 scope 是否会混淆")
    print("#" * 70)
    from straditize_core.session import StraditizeSession

    # 造两个**同尺寸不同内容**的工程包
    from PIL import Image, ImageDraw

    W, H = 1200, 800
    pdf_path = os.path.join(U.ROOT, OUT_DIR, "c1b_two_pages.pdf")
    pages = []
    for tag in ("A", "B"):
        im = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(im)
        if tag == "A":
            for y in (150, 350, 550, 750):
                d.line([(0, y), (W, y)], fill=(0, 0, 0), width=2)
            for x in range(80, W - 80, 100):
                d.line([(x, 60), (x, H - 60)], fill=(0, 0, 0), width=1)
        else:
            d.rectangle([80, 60, 300, H - 60], outline=(0, 0, 0), width=2)
            d.line([(80, H - 60), (300, H - 60)], fill=(0, 0, 0), width=2)
        pages.append(im)
    pages[0].save(pdf_path, format="PDF", save_all=True,
                  append_images=pages[1:], resolution=W / 8.5)

    # 分别在两页上建工程包
    saved = {}
    for page, tag in ((1, "A"), (2, "B")):
        s = StraditizeSession()
        s._init_cleanup()
        s.load_image(pdf_path, page_number=page)
        for r in list(s.rois):
            s.roi_remove(r["id"])
        rid = s.roi_create(name=f"{tag}", x0=0, x1=W, y0=0, y1=H,
                           composition=True)["roi"]["id"]
        s.roi_set_primary(rid)
        s.roi_set_active(rid)
        s.extract_foreground()
        cands = s.detect_line_candidates(roi_id=rid)["candidates"]
        h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
        if h_ids:
            s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
        s.detect_columns(roi_id=rid)
        p = os.path.join(U.ROOT, OUT_DIR, f"c1b_{tag}.project.json")
        s.project_save(output_path=p, format="json")
        saved[tag] = {"path": p, "size": (s.width, s.height),
                      "n_cands": len(cands), "n_h": len(h_ids),
                      "n_cols": len(s.columns)}
        print(f"  工程 {tag}: 尺寸={s.width}x{s.height} 候选={len(cands)} "
              f"横线={len(h_ids)} 列={len(s.columns)}")

    # 载回 A，做清理几何；再载回 B，看 A 的几何是否还活着
    print("\n  --- 载入 A -> 建几何 -> 载入 B -> 检查残留 ---")
    s = StraditizeSession()
    s._init_cleanup()
    s.project_load(saved["A"]["path"])
    print(f"    载入 A 后 image_path = {s.image_path!r}   尺寸={s.width}x{s.height}")
    print(f"    A 载入后 line_candidates = {len(getattr(s, 'line_candidates', []) or [])}")
    rid_a = (s.rois or [{}])[0].get("id")
    s.extract_foreground()
    candsA = s.detect_line_candidates(roi_id=rid_a)["candidates"]
    hA = [c["id"] for c in candsA if c.get("kind") == "A"]
    if hA:
        s.apply_line_removal(roi_id=rid_a, selected_ids=hA)
    print(f"    A 上检出 {len(candsA)} 候选，选中 {len(hA)} 条横线")
    scopeA = s._geometry_scope() if hasattr(s, "_geometry_scope") else None
    print(f"    A 的 geometry_scope = {scopeA}")

    s.project_load(saved["B"]["path"])
    print(f"\n    载入 B 后 image_path = {s.image_path!r}   尺寸={s.width}x{s.height}")
    print(f"    B 载入后 line_candidates = {len(getattr(s, 'line_candidates', []) or [])}")
    scopeB = s._geometry_scope() if hasattr(s, "_geometry_scope") else None
    print(f"    B 的 geometry_scope = {scopeB}")
    print(f"    >>> A 与 B 的 scope 是否相同: {scopeA == scopeB}")
    print(f"        （相同 = 防线在这条路径上失效）")

    print("\n  --- 在 B 上重跑候选检测，看会不会把 A 的选中状态当自己的 ---")
    rid_b = (s.rois or [{}])[0].get("id")
    s.extract_foreground()
    candsB = s.detect_line_candidates(roi_id=rid_b)["candidates"]
    print(f"    B 上检出 {len(candsB)} 候选")
    for c in candsB:
        print(f"      {c['id']:12s} kind={c.get('kind')} status={c.get('status')} "
              f"y0={(c.get('geometry') or {}).get('y0')}")


def c1c_save_after_load() -> None:
    print("\n" + "#" * 70)
    print("# C1c  project_load 后重存：image_path=None 会不会被写进新工程包")
    print("#" * 70)
    from straditize_core.session import StraditizeSession

    src = os.path.join(U.ROOT, OUT_DIR, "c1a.project.json")
    if not os.path.exists(src):
        print("  缺 c1a 产物，跳过")
        return
    s = StraditizeSession()
    s._init_cleanup()
    s.project_load(src)
    print(f"  载入后 image_path = {s.image_path!r}")
    out = os.path.join(U.ROOT, OUT_DIR, "c1a_resaved.project.json")
    s.project_save(output_path=out, format="json")
    pj = json.loads(open(out, encoding="utf-8").read())
    for k, v in narrow_project_dump(pj).items():
        print(f"    {k} = {v}")
    txt = open(out, encoding="utf-8").read()
    print(f"    'None' 是否被当作 image_path 写进文本: {'\"image_path\": null' in txt}")
    print("    >>> 载入-重存往返后，image 溯源依旧只有 path/width/height，无页码。")


def main() -> int:
    U.hash_banner("C1 干净版：image_path 退化影响面")
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "a"):
        c1a_image_path_evolution()
    if which in ("all", "b"):
        c1b_cross_project_scope()
    if which in ("all", "c"):
        c1c_save_after_load()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
