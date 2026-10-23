# -*- coding: utf-8 -*-
"""C1d 真实 UI 场景：用户已载入一张图，再打开工程包 —— 底图会不会换？

前端 ProjectManager.ts:641-651（.tar）与 :678-682（.json）的真实调用顺序是：
    （会话里通常已经有一张图）
    parsed.image.base64 = <工程包内的底图>
    await rpcClient.call('project.load', { project_data: parsed })

后端 project.py:434-443 的守卫条件是：
    if isinstance(img_meta, dict) and img_meta.get("base64") \
       and getattr(self, "image", None) is None:
        ... 解 base64 覆盖 self.image ...

注意第三个条件 `self.image is None`：**会话里已有图时，工程包的底图被完全忽略**。
本脚本用真实会话复现这条路径，并用「独立像素统计」判断会话里到底是哪张图。
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

OUT_DIR = "output/prod_gate/c_lead_checks"


def make_pkg_with_image(path: str, w: int, h: int, n_hlines: int) -> None:
    """造一个工程包：内嵌一张有 n_hlines 条贯穿横线的底图。"""
    im = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(im)
    for i in range(n_hlines):
        y = int(h * (i + 1) / (n_hlines + 1))
        d.line([(0, y), (w, y)], fill=(0, 0, 0), width=2)
    for x in range(80, w - 80, 120):
        d.line([(x, 60), (x, h - 60)], fill=(0, 0, 0), width=1)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    payload = {
        "version": "3.0.0",
        "schema_version": "3.0",
        "image": {
            "path": "image/original.png",
            "width": w,
            "height": h,
            "base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        },
        "depth_calibration": {"is_calibrated": False, "unit": "cm"},
        "roi": {"x0": 0, "x1": w, "y0": 0, "y1": h},
        "rois": [{"id": "roi_1", "name": "pkg", "name_source": "user",
                  "composition": True, "visible": True,
                  "xlim": [0, w], "ylim": [0, h]}],
        "primary_roi_id": "roi_1",
        "active_roi_id": "roi_1",
        "columns": [],
        "samples": [],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def session_pixel_facts(s) -> dict:
    img = getattr(s, "image", None)
    if img is None:
        return {"image": None}
    g = np.array(img.convert("L"))
    dark = g < 128
    frac = dark.mean(axis=1)
    hlines = [int(y) for y in range(len(frac)) if frac[y] > 0.75]
    return {
        "size": img.size,
        "pixel_sha16": hashlib.sha256(np.array(img.convert("RGB")).tobytes()).hexdigest()[:16],
        "n_full_width_dark_rows": len(hlines),
        "first_hlines": hlines[:8],
    }


def main() -> int:
    U.hash_banner("C1d 真实 UI 路径：已有图时打开工程包，底图是否被替换")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    from straditize_core.session import StraditizeSession

    pkg = os.path.join(U.ROOT, OUT_DIR, "c1d_pkg_1920x1000_3lines.project.json")
    make_pkg_with_image(pkg, 1920, 1000, 3)
    print(f"\n  工程包: {os.path.basename(pkg)}  底图 1920x1000，含 3 条贯穿横线")
    print(f"  工程包内底图 sha16 = {session_pixel_facts(type('X', (), {'image': Image.open(io.BytesIO(base64.b64decode(json.load(open(pkg,encoding='utf-8'))['image']['base64'])))}))['pixel_sha16']}")

    # ---------- 场景 1：空白会话载入工程包（基線，应成功） ----------
    print("\n  === 场景 1（基线）：空白会话 project_load 工程包 ===")
    s1 = StraditizeSession()
    s1._init_cleanup()
    r = s1.project_load(pkg)
    f = session_pixel_facts(s1)
    print(f"    project_load -> columns={r.get('columns_count')}")
    print(f"    会话图像 = {f['size']}  sha16={f['pixel_sha16']}  "
          f"贯穿横线={f['n_full_width_dark_rows']} at {f['first_hlines']}")

    # ---------- 场景 2：已载图后再载入工程包（真实 UI 路径） ----------
    print("\n  === 场景 2（真实 UI）：先载入 hoya，再 project_load 同一工程包 ===")
    s2 = StraditizeSession()
    s2._init_cleanup()
    s2.load_image(sample_key="hoya")
    before = session_pixel_facts(s2)
    print(f"    载入 hoya 后：{before['size']}  sha16={before['pixel_sha16']}  "
          f"贯穿横线={before['n_full_width_dark_rows']}")
    r2 = s2.project_load(pkg)
    after = session_pixel_facts(s2)
    print(f"    project_load 后：{after['size']}  sha16={after['pixel_sha16']}  "
          f"贯穿横线={after['n_full_width_dark_rows']} at {after['first_hlines']}")
    print(f"    期望：1920x1000 且 3 条横线")
    print(f"    实际：{after['size']} 且 {after['n_full_width_dark_rows']} 条横线")
    switched = after["size"] == (1920, 1000)
    print(f"    >>> 底图是否被替换: {switched}")

    print("\n  --- 场景 2 的进一步检查：几何/标定有没有混用两张图 ---")
    rid = (s2.rois or [{}])[0].get("id")
    print(f"    载回后的 ROI id = {rid}  xlim={[(x.get('xlim')) for x in (s2.rois or [])]}")
    s2.extract_foreground()
    try:
        cands = s2.detect_line_candidates(roi_id=rid)["candidates"]
        h = [c for c in cands if c.get("kind") == "A"]
        print(f"    在当前会话（hoya 像素）上检测：{len(cands)} 候选，kind=A {len(h)}")
        print(f"    （工程包声明的是 3 条横线；hoya 是另一张图）")
    except Exception as exc:
        print(f"    detect_line_candidates -> {type(exc).__name__}: {exc}")

    # ---------- 场景 3：.tar 路径（前端也塞 base64） ----------
    print("\n  === 场景 3：.tar 路径 —— 前端也会把底图塞进 payload ===")
    tar = os.path.join(U.ROOT, OUT_DIR, "c1d_pkg.tar")
    if os.path.exists(tar):
        os.remove(tar)
    s3 = StraditizeSession()
    s3._init_cleanup()
    s3.load_image(sample_key="beginner")
    b3 = session_pixel_facts(s3)
    print(f"    载入 beginner 后：{b3['size']}  sha16={b3['pixel_sha16']}")
    print("    （.tar 路径在 project_load 内部会直接 self.image = img_obj，")
    print("      因为它在进入 project_load(parsed) 之前先解了 img_member —— 见 project.py:219）")

    print("\n  --- 判定 ---")
    print(f"    场景 1（空会话）底图替换是否成功: {f['size'] == (1920, 1000)}")
    print(f"    场景 2（已有图）底图替换是否成功: {switched}")
    if not switched:
        print("    => 真缺陷：已有图时，project.load 的 image.base64 被静默忽略。")
        print("       前端 ProjectManager.ts:641-651 / :678-682 明确塞了底图期待替换，")
        print("       但后端 project.py:436 的 `and getattr(self,'image',None) is None` 把它挡掉。")
        print("       用户看到：工程包载入后列与标定都变了，底图却还是上一张。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
