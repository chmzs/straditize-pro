# -*- coding: utf-8 -*-
"""探针 P6：`project_new(clear_image=False)` 不清清理状态（line_candidates /
exclusion_regions / line_strokes）——用户可见后果到底有没有？

三条路径分别验证：
  N1. `project.new` 之后 `line_candidates` 是否残留（读后端真值）。
  N2. 残留几何是否真的**参与**数字化（即污染数据），而不是仅存在于列表里。
  N3. 上传新图（`core.loadImage`）是否清 —— 这是最常见的用户路径。

    pixi run python scripts/zero_flow_probes/probe_p6_project_new.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def counts(r: Rpc) -> dict:
    d = r.call("straditize.getDiagramData")
    return {
        "imageSrc": d.get("imageSrc"),
        "columns": len(d.get("columns") or []),
        "rois": len(d.get("rois") or []),
        "line_candidates": len(d.get("line_candidates") or []),
        "exclusion_regions": len(d.get("exclusion_regions") or []),
        "line_strokes": len(d.get("line_strokes") or []),
        "cleanup_stats": d.get("cleanup", {}).get("stats"),
    }


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)

    print("=" * 72)
    print("N1. 造一批清理编辑 → project.new → 看残留")
    print("=" * 72)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    roi = d.get("activeRoiId")
    scan = r.call("algorithm.detectLineCandidates", {"roi_id": roi})
    print(f"  检出候选几何 {len(scan['candidates'])} 条")
    # 确认一条 + 加一笔笔迹，确保三类状态都非空
    first = scan["candidates"][0]["id"]
    r.call("algorithm.setGeometryStatus", {"candidate_id": first, "status": "removed"})
    r.call(
        "algorithm.applyLineRemoval",
        {
            "roi_id": roi,
            "strokes": [
                {"id": "s1", "mode": "erase", "radius": 6, "points": [[400, 800], [700, 800]]}
            ],
        },
    )
    before = counts(r)
    print("  project.new 之前：", json.dumps(before, ensure_ascii=False))

    r.call("project.new", {})
    after = counts(r)
    print("  project.new 之后：", json.dumps(after, ensure_ascii=False))
    leaked = bool(after["line_candidates"] or after["exclusion_regions"] or after["line_strokes"])
    print(f"  >>> 清理状态残留？ {'是（缺陷）' if leaked else '否'}")

    print("\n" + "=" * 72)
    print("N2. 残留几何是否真的参与数字化（污染数据），而非仅躺在列表里")
    print("=" * 72)
    # 重新建一个干净会话，然后：project.new 残留 → 载入新图 → 重新分列 → 提取
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    roi = d.get("activeRoiId")
    scan = r.call("algorithm.detectLineCandidates", {"roi_id": roi})
    widths = sorted(c.get("width") for c in scan["candidates"])
    print(f"  ROI 内候选几何 {len(scan['candidates'])} 条，厚度集合 = {widths}")
    if scan["candidates"]:
        c0 = max(scan["candidates"], key=lambda c: c.get("width") or 0)
        print(f"  取最厚一条做「确认」实验：id={c0['id']} axis={c0.get('axis')} at={c0.get('at')} width={c0.get('width')}")
        base = r.call("algorithm.applyLineRemoval", {"roi_id": roi})
        px_off = (base.get("stats") or {}).get("geometry_removed_pixels")
        r.call("algorithm.setGeometryStatus", {"candidate_id": c0["id"], "status": "removed"})
        on = r.call("algorithm.applyLineRemoval", {"roi_id": roi})
        px_on = (on.get("stats") or {}).get("geometry_removed_pixels")
        print(f"  未确认时 geometry_removed_pixels = {px_off}")
        print(f"  确认该条后 geometry_removed_pixels = {px_on}")
        print(f"  >>> 几何确实参与掩膜？ {'是' if (px_on or 0) > (px_off or 0) else '否（该条厚度/形态不构成有效线）'}")
        # 直接看读取结果：digitize 前后是否相同
        if px_on and px_on > 0:
            pts_on = r.call("core.digitize", {"col_index": 0})
            r.call("algorithm.setGeometryStatus", {"candidate_id": c0["id"], "status": "candidate"})
            r.call("algorithm.applyLineRemoval", {"roi_id": roi})
            pts_off = r.call("core.digitize", {"col_index": 0})
            def total_px(res):
                n = 0
                if isinstance(res, list):
                    for it in res:
                        n += len(it.get("points") or [])
                elif isinstance(res, dict):
                    n += len(res.get("points") or [])
                return n
            print(f"  确认该几何时 col0 控制点 = {total_px(pts_on)}；撤回后 = {total_px(pts_off)}")
            print(f"  >>> 几何影响读数？ {'是' if total_px(pts_on) != total_px(pts_off) else '否'}")

    print("\n" + "=" * 72)
    print("N3. 用户最常见的路径：上传/切换新图（core.loadImage）是否清清理状态")
    print("=" * 72)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    roi = d.get("activeRoiId")
    scan = r.call("algorithm.detectLineCandidates", {"roi_id": roi})
    if scan["candidates"]:
        r.call(
            "algorithm.setGeometryStatus",
            {"candidate_id": scan["candidates"][0]["id"], "status": "removed"},
        )
    withEdits = counts(r)
    print("  载图 + 清理编辑后：", json.dumps(withEdits, ensure_ascii=False))
    r.call("core.loadImage", {"sample_key": "beginner"})
    afterReload = counts(r)
    print("  切到另一张范例图后：", json.dumps(afterReload, ensure_ascii=False))
    leaked2 = bool(afterReload["line_candidates"] or afterReload["exclusion_regions"])
    print(f"  >>> 切图后清理状态残留？ {'是（缺陷）' if leaked2 else '否'}")
    if leaked2:
        print("  >>> 残留几何的 roi_id 与新图 ROI id 对比：")
        new_roi = afterReload.get("rois") and r.call("straditize.getDiagramData").get("rois")
        print("      新图 rois =", [x["id"] for x in (new_roi or [])])


if __name__ == "__main__":
    main()
