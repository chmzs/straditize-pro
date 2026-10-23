# -*- coding: utf-8 -*-
"""C1b 判别性对照：project_load 载入第二个工程时，图像真的换了吗？

上一版 c1b 观察到：载入 A -> 载入 B -> detect_line_candidates 检出的是 **A 的 4 条横线**
（y0=149/349/549/749），而 B 只有一条 18% 宽的矩形边、不该被当成 kind=A。

这可能是两种完全不同的原因，必须用对照区分：
  H1（产品缺陷）：project_load 不替换 session.image，第二个工程沿用第一个工程的像素
  H2（我的测试错）：B 的图里确实有 4 条贯穿横线，或 detect 的判据比我以为的松

判别方法：**只载入 B** 的新会话作为基准。
  只载入 B -> 检出 N_B
  A 然后 B  -> 检出 N_AB
若 N_AB != N_B，则 H1 成立（前面那次加载的像素影响到了后面）。
若 N_AB == N_B，则 H2 成立，需要重新审视 B 的图内容。
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate/c_lead_checks"
W, H = 1200, 800


def build_two_packages() -> dict[str, str]:
    """构造 A（4 条贯穿横线 + 12 条竖线）与 B（只有一条窄矩形）两个工程包。"""
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    pdf_path = os.path.join(U.ROOT, OUT_DIR, "c1b2_two_pages.pdf")
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
            # B：只有一个 220px 宽的矩形框，没有任何贯穿横线
            d.rectangle([80, 60, 300, H - 60], outline=(0, 0, 0), width=2)
        pages.append(im)
    pages[0].save(pdf_path, format="PDF", save_all=True,
                  append_images=pages[1:], resolution=W / 8.5)

    from straditize_core.session import StraditizeSession

    paths = {}
    for page, tag in ((1, "A"), (2, "B")):
        s = StraditizeSession()
        s._init_cleanup()
        s.load_image(pdf_path, page_number=page)
        for r in list(s.rois):
            s.roi_remove(r["id"])
        rid = s.roi_create(name=tag, x0=0, x1=W, y0=0, y1=H,
                           composition=True)["roi"]["id"]
        s.roi_set_primary(rid)
        s.roi_set_active(rid)
        s.extract_foreground()
        p = os.path.join(U.ROOT, OUT_DIR, f"c1b2_{tag}.project.json")
        s.project_save(output_path=p, format="json")
        paths[tag] = p
    return paths


def pkg_image_sha(path: str) -> str:
    import base64

    d = json.loads(open(path, encoding="utf-8").read())
    b64 = (d.get("image") or {}).get("base64") or ""
    return hashlib.sha256(base64.b64decode(b64)).hexdigest()[:16] if b64 else "<none>"


def probe(paths: list[str], tag: str) -> dict:
    """依次载入 paths，然后报告会话像素与候选。"""
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    for p in paths:
        r = s.project_load(p)
        print(f"      project_load({os.path.basename(p)}) -> columns={r.get('columns_count')}")
        img = getattr(s, "image", None)
        if img is not None:
            arr = np.array(img.convert("RGB"))
            print(f"        载入后会话像素 sha256_16 = "
                  f"{hashlib.sha256(arr.tobytes()).hexdigest()[:16]}  size={img.size}")
            # 直接数贯穿横线（独立于产品算法）
            g = np.array(img.convert("L"))
            dark = g < 128
            frac = dark.mean(axis=1)
            rows = [y for y in range(len(frac)) if frac[y] > 0.75]
            print(f"        独立统计：>75% 宽的暗行数 = {len(rows)}  at {rows[:10]}")
        rid = (s.rois or [{}])[0].get("id")
        s.extract_foreground()
        cands = s.detect_line_candidates(roi_id=rid)["candidates"]
        h = [c for c in cands if c.get("kind") == "A"]
        print(f"        detect_line_candidates -> 总 {len(cands)}，kind=A {len(h)}")
        for c in h[:6]:
            print(f"          {c['id']:12s} y0={(c.get('geometry') or {}).get('y0')}")
    return {}


def main() -> int:
    U.hash_banner("C1b2 project_load 是否真的换图（判别性对照）")
    paths = build_two_packages()
    print(f"\n  工程 A 图像 sha16 = {pkg_image_sha(paths['A'])}")
    print(f"  工程 B 图像 sha16 = {pkg_image_sha(paths['B'])}")
    print(f"  两者是否不同 = {pkg_image_sha(paths['A']) != pkg_image_sha(paths['B'])}")

    print("\n  === 基准：只载入 B ===")
    probe([paths["B"]], "B_only")

    print("\n  === 对照：先载入 A，再载入 B ===")
    probe([paths["A"], paths["B"]], "A_then_B")

    print("\n  === 反向：先载入 B，再载入 A ===")
    probe([paths["B"], paths["A"]], "B_then_A")

    print("\n  --- 判定 ---")
    print("    若 '只载入 B' 与 'A 然后 B' 的候选数/像素 sha 不同 -> project_load 未替换像素（真缺陷）")
    print("    若两者相同 -> 上一版观察是 B 图内容导致（我的测试问题）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
