# -*- coding: utf-8 -*-
"""G-01 前置：独立复验 PDF 家底（不照抄 Lead 的数字）。

逐页枚举内嵌位图的尺寸，并与后端 load_image 的真实行为对照：
  - 哪些页有 0 张位图（应报错）
  - 哪些页有多张位图（后端静默选哪张？）

用法: pixi run python scripts/prod_gate/g01_pdf_inventory.py
"""
from __future__ import annotations

import hashlib
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"


def raw_inventory() -> list[dict[str, object]]:
    """不经后端，直接用 pypdf 逐页数位图，作为独立真值。

    关键：必须用 ``page.images``（它按 content stream 实际绘制顺序枚举，
    含内联图与 Form XObject 递归），不能用 ``/Resources/XObject`` 手挖——
    后者对本 PDF 的第 2/5/7/9 页全部报 0 张，是**代理指标**而非真值。
    """
    out: list[dict[str, object]] = []
    from pypdf import PdfReader

    reader = PdfReader(PDF)
    for i, page in enumerate(reader.pages, start=1):
        sizes = []
        try:
            imgs = list(page.images)
        except Exception as exc:
            out.append({"page": i, "n_images": "ERR", "sizes": [str(exc)]})
            continue
        for im in imgs:
            try:
                im.image.load()
                sizes.append(f"{im.image.size[0]}x{im.image.size[1]}")
            except Exception as exc:
                sizes.append(f"<load fail {exc}>")
        out.append({"page": i, "n_images": len(sizes), "sizes": sizes})
    return out


def backend_probe() -> list[dict[str, object]]:
    """逐页跑后端 load_image，记录真实返回/异常。"""
    from straditize_core.session import StraditizeSession

    out = []
    for pno in range(1, 14):
        s = StraditizeSession()
        s._init_cleanup()
        try:
            info = s.load_image(os.path.abspath(PDF), page_number=pno)
            out.append(
                {
                    "page": pno,
                    "ok": True,
                    "width": info.get("width"),
                    "height": info.get("height"),
                    "format": info.get("format"),
                    "pdf_info": info.get("pdf_info"),
                }
            )
        except Exception as exc:
            out.append(
                {
                    "page": pno,
                    "ok": False,
                    "exc_type": type(exc).__name__,
                    "message": str(exc),
                }
            )
    return out


def main() -> int:
    U.hash_banner("G-01 PDF inventory")
    print(f"\nPDF: {PDF}")
    print(f"size: {os.path.getsize(PDF)} B")
    h = hashlib.sha256()
    with open(PDF, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    print(f"sha256: {h.hexdigest()}")

    print("\n--- 独立真值：逐页内嵌位图（PyMuPDF，不经后端） ---")
    inv = raw_inventory()
    for row in inv:
        print(f"  page {row.get('page')}: n_images={row.get('n_images')} sizes={row.get('sizes')}")
    multi = [r for r in inv if isinstance(r.get("n_images"), int) and r["n_images"] > 1]
    zero = [r for r in inv if isinstance(r.get("n_images"), int) and r["n_images"] == 0]
    print(f"\n  多图页: {[r['page'] for r in multi]}")
    print(f"  零图页: {[r['page'] for r in zero]}")

    print("\n--- 后端 load_image 逐页真实行为 ---")
    for row in backend_probe():
        if row.get("ok"):
            print(
                f"  page {row['page']:2d}: OK  {row['width']}x{row['height']}  "
                f"format={row['format']}  pdf_info={row['pdf_info']}"
            )
        else:
            print(f"  page {row['page']:2d}: {row['exc_type']}: {row['message']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
