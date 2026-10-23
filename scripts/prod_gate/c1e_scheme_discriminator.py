# -*- coding: utf-8 -*-
"""C1e 方案判别：四种候选修复方案在「载入包后换一张不同的图」时能否正确失效。

Lead 要在四个方案里选：
  A 包里记路径（restore image_path from package）
  B 图像指纹（sha256 of pixels）
  C pack_id（包的唯一 id，几何记 pack_id）
  D 载入时重写 scope（把当前 scope 强行写回几何）
Lead 倾向 B 或 C，不倾向 D（认为 D 是掩盖失配）。

## 判别性实验设计

方案的有效性必须同时满足**两条相反的要求**，任何一条单独满足都是错的：

  R1（不能误杀）载入工程包后，包里已经确认过的清理几何**必须继续生效**
       —— 这是 C1e 要修的东西。
  R2（不能放行）载入包之后**换一张不同的图**（哪怕同尺寸、同文件名），
       旧几何**必须失效** —— 这是 B-03 立的规矩，不能被 C1e 的修复破坏。

```
实验矩阵（三个场景，每个方案都要过）：
  S1  空会话载入包 P_A          -> 几何应生效          （R1）
  S2  载入包 P_A，然后载入包 P_B（同尺寸不同图）-> P_B 上几何应失效（R2）
  S3  载入包 P_A，然后 loadImage(另一张同尺寸图)  -> 几何应失效（R2）
```

后两个场景是判别性的：**只测 S1 的方案看起来"修好了"，但可能把 R2 一起破坏**。
这正是 Lead 担心"重写 scope 是掩盖失配"的原因——它能让 S1 绿，但 S2/S3 也绿
（因为 scope 被强行改写了），等于把跨图防御关掉。

## 做法

不修改任何产品源码。用**现有产品行为**直接观测：
对每个场景，读 `session.line_candidates` 里每条几何的 `image_scope`，
以及 `_geometry_in_scope()` 的真实返回值。再叠加"几何是否真的剔除了墨迹"
（`_geometry_mask` 的像素数）作为用户可见后果。

候选方案 A/C/D 通过**手工构造对应形态的工程包**来模拟（不改产品代码）：
  A：包内 image_path 字段存在且与当前一致
  C：几何里带 pack_id
  D：几何的 scope 被写入当前 scope
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate/c1e"
W, H = 1200, 800


# ---------------------------------------------------------------------------
# 造两张**同尺寸、不同内容**的图，各带 3 条 / 1 条贯穿横线
# ---------------------------------------------------------------------------
def make_image(n_hlines: int, tag: str) -> Image.Image:
    im = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    for i in range(n_hlines):
        y = int(H * (i + 1) / (n_hlines + 1))
        d.line([(0, y), (W, y)], fill=(0, 0, 0), width=2)
    for x in range(80, W - 80, 150):
        d.line([(x, 60), (x, H - 60)], fill=(0, 0, 0), width=1)
    d.text((10, 10), tag, fill=(0, 0, 0))
    return im


def img_fp(im: Image.Image) -> str:
    """完整 sha256（64 hex）。

    不能用截断值：产品 `_geometry_in_scope` 对 fingerprint 做**精确字符串相等**比较，
    截断成 16 字符会永远不等于完整值，从而把"指纹方案失效"这个假象造出来。
    （这正是本团队反复踩的"代理指标"——我曾用截断值当指纹。）
    """
    return hashlib.sha256(im.convert("RGBA").tobytes()).hexdigest()


def b64png(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_pkg(path: str, im: Image.Image, *, image_path: str | None = None,
              pack_id: str | None = None, force_scope: dict | None = None) -> None:
    """造工程包。force_scope 用于模拟方案 D（几何 scope 被重写成当前值）。"""
    payload = {
        "version": "3.0.0", "schema_version": "3.0",
        "image": {"path": "image/original.png", "width": im.size[0],
                  "height": im.size[1], "base64": b64png(im)},
        "depth_calibration": {"is_calibrated": False, "unit": "cm"},
        "roi": {"x0": 0, "x1": im.size[0], "y0": 0, "y1": im.size[1]},
        "rois": [{"id": "roi_1", "name": "pkg", "name_source": "user",
                  "composition": True, "visible": True,
                  "xlim": [0, im.size[0]], "ylim": [0, im.size[1]]}],
        "primary_roi_id": "roi_1", "active_roi_id": "roi_1",
        "columns": [], "samples": [],
    }
    if image_path is not None:
        payload["image"]["image_path"] = image_path
        payload["image_path"] = image_path
    if pack_id is not None:
        payload["pack_id"] = pack_id
        for c in payload.get("line_candidates", []):
            c["pack_id"] = pack_id
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def mk_geometry_pkg(src_pkg: str, dst_pkg: str, *, with_pack_id: str | None,
                    with_scope: dict | None, with_image_path: str | None) -> None:
    """把 src 包里的几何改造成"已确认"形态，并注入方案特定的字段。"""
    d = json.loads(open(src_pkg, encoding="utf-8").read())
    cands = []
    for i, y in enumerate((200, 400, 600), start=1):
        c = {
            "id": f"line_h_{i}",
            "roi_id": "roi_1",
            "kind": "A",
            "geometry": {"type": "rect", "x0": 0, "y0": y, "x1": W - 1, "y1": y},
            "status": "removed",
        }
        if with_pack_id is not None:
            c["pack_id"] = with_pack_id
        if with_scope is not None:
            c["image_scope"] = with_scope
        cands.append(c)
    d["line_candidates"] = cands
    d["selected_candidate_ids"] = [c["id"] for c in cands]
    if with_image_path is not None:
        d.setdefault("image", {})["image_path"] = with_image_path
        d["image_path"] = with_image_path
    with open(dst_pkg, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 观测：几何在"当前这张图"上到底生效了没有
# ---------------------------------------------------------------------------
def observe(s, label: str) -> dict:
    cands = getattr(s, "line_candidates", []) or []
    in_scope = []
    for c in cands:
        try:
            ok = s._geometry_in_scope(c)
        except Exception as exc:
            ok = f"ERR:{type(exc).__name__}"
        in_scope.append({"id": c.get("id"), "status": c.get("status"), "in_scope": ok})
    n_effective = sum(1 for x in in_scope if x["in_scope"] is True and x["status"] == "removed")
    scope = s._geometry_scope() if hasattr(s, "_geometry_scope") else None
    # 用户可见后果：几何真的剔掉多少墨迹
    erased = None
    try:
        s.extract_foreground()
        rid = (s.rois or [{}])[0].get("id")
        m = s._geometry_mask(s.foreground_mask, rid, statuses={"removed"})
        erased = int(np.asarray(m).sum())
    except Exception as exc:
        erased = f"ERR:{type(exc).__name__}"
    return {
        "label": label,
        "img_fp": img_fp(s.image) if getattr(s, "image", None) is not None else None,
        "scope": scope,
        "n_candidates": len(cands),
        "n_effective_removed": n_effective,
        "pixels_erased": erased,
        "per_candidate": in_scope[:6],
    }


def scenario(name: str, pkgA: str, pkgB: str, steps: list[tuple[str, str]]) -> dict:
    """按 steps 顺序执行（'load_pkg', path）或（'load_img', path），逐步观测。"""
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    obs = []
    for kind, arg in steps:
        try:
            if kind == "load_pkg":
                s.project_load(arg)
            else:
                s.load_image(arg)
        except Exception as exc:
            obs.append({"step": kind, "error": f"{type(exc).__name__}: {exc}"})
            continue
        obs.append({"step": kind, "arg": os.path.basename(arg), **observe(s, f"{kind}")})
    return {"scenario": name, "steps": obs}


def main() -> int:
    U.hash_banner("C1e 方案判别：载入包后换图是否仍正确失效")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    d = os.path.join(U.ROOT, OUT_DIR)

    imgA = make_image(3, "A")
    imgB = make_image(1, "B")
    fpA, fpB = img_fp(imgA), img_fp(imgB)
    print(f"\n  图 A: {imgA.size} fp={fpA}  (3 条贯穿横线)")
    print(f"  图 B: {imgB.size} fp={fpB[:16]}…  (1 条贯穿横线)")
    print(f"  同尺寸不同内容 = {imgA.size == imgB.size and fpA != fpB}")

    # 单页 PDF（用于 load_image 路径需要真实文件）
    pdfA = os.path.join(d, "imgA.pdf")
    pdfB = os.path.join(d, "imgB.pdf")
    imgA.save(pdfA, format="PDF", resolution=W / 8.5)
    imgB.save(pdfB, format="PDF", resolution=W / 8.5)
    # 也存 png
    pngA = os.path.join(d, "imgA.png")
    pngB = os.path.join(d, "imgB.png")
    imgA.save(pngA)
    imgB.save(pngB)

    # ---- 基础包：只带图，几何由 mk_geometry_pkg 注入 ----
    baseA = os.path.join(d, "baseA.json")
    baseB = os.path.join(d, "baseB.json")
    build_pkg(baseA, imgA)
    build_pkg(baseB, imgB)

    # ---- 四种方案对应的包形态 ----
    variants = {}
    # 当前产品行为（新格式：几何不带 scope 或带指纹 scope）
    p_now = os.path.join(d, "pkg_now_A.json")
    mk_geometry_pkg(baseA, p_now, with_pack_id=None, with_scope=None, with_image_path=None)
    variants["当前(无scope几何)"] = p_now

    # 方案 A：包里记路径，几何带旧格式 scope(image_path)
    p_A = os.path.join(d, "pkg_A_path.json")
    mk_geometry_pkg(baseA, p_A, with_pack_id=None,
                    with_scope={"image_path": pngA, "width": W, "height": H},
                    with_image_path=pngA)
    variants["A_包里记路径"] = p_A

    # 方案 B：几何带内容指纹 scope（= 产品当前新格式）
    p_B = os.path.join(d, "pkg_B_fingerprint.json")
    mk_geometry_pkg(baseA, p_B, with_pack_id=None,
                    with_scope={"fingerprint": fpA, "width": W, "height": H},
                    with_image_path=None)
    variants["B_图像指纹"] = p_B

    # 方案 C：几何带 pack_id（产品不认识，必然被当"无 scope"）
    p_C = os.path.join(d, "pkg_C_packid.json")
    mk_geometry_pkg(baseA, p_C, with_pack_id="pack-aaa", with_scope=None,
                    with_image_path=None)
    variants["C_pack_id"] = p_C

    # 方案 D：载入时把 scope 重写成"当前"（模拟强行对齐）
    from straditize_core.session import StraditizeSession

    tmp = StraditizeSession(); tmp._init_cleanup(); tmp.load_image(pngA)
    cur_scope_A = tmp._geometry_scope()
    p_D = os.path.join(d, "pkg_D_rewrite.json")
    mk_geometry_pkg(baseA, p_D, with_pack_id=None, with_scope=cur_scope_A,
                    with_image_path=None)
    variants["D_重写scope"] = p_D
    print(f"\n  当前会话（载入 imgA 后）的 scope = {json.dumps(cur_scope_A, ensure_ascii=False)[:160]}")

    # ---- 三个场景 × 每个方案的形态 ----
    results = []
    for vname, pkg in variants.items():
        for sname, steps in (
            ("S1 只载入包（应生效）", [("load_pkg", pkg)]),
            ("S2 载包A后载包B同尺寸异图（应失效）", [("load_pkg", pkg), ("load_pkg", baseB)]),
            ("S3 载包A后loadImage异图（应失效）", [("load_pkg", pkg), ("load_img", pdfB)]),
        ):
            r = scenario(sname, pkg, baseB, steps)
            r["variant"] = vname
            results.append(r)

    # ---- 汇总 ----
    print("\n" + "=" * 100)
    print("判定矩阵（几何是否真的生效：1=生效剔墨，0=失效）")
    print("=" * 100)
    print(f"{'方案':<22} {'S1(应=1)':<26} {'S2(应=0)':<26} {'S3(应=0)':<26}")
    verdicts = {}
    for vname in variants:
        row = []
        for sname in ("S1", "S2", "S3"):
            r = next(x for x in results
                     if x["variant"] == vname and x["scenario"].startswith(sname))
            last = r["steps"][-1]
            eff = last.get("n_effective_removed")
            px = last.get("pixels_erased")
            row.append(f"eff={eff} px={px}")
        print(f"{vname:<22} {row[0]:<26} {row[1]:<26} {row[2]:<26}")
        verdicts[vname] = row

    print("\n" + "=" * 100)
    print("解读")
    print("=" * 100)
    print("  S1 应生效（R1 不能误杀）；S2/S3 应失效（R2 不能放行）。")
    print("  只有 S1=生效 且 S2=S3=失效 的方案才是合格方案。")
    print("  若某方案 S1 生效、但 S2/S3 也生效 -> 它把跨图防御破坏了。")
    print("  若某方案 S1 失效 -> 它没修好 C1e。")

    out = os.path.join(d, "c1e_matrix.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"variants": variants, "results": results,
                   "fpA": fpA, "fpB": fpB, "cur_scope_A": cur_scope_A}, fh,
                  ensure_ascii=False, indent=2)
    print(f"\n  明细已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
