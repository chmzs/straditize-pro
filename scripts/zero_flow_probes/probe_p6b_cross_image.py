# -*- coding: utf-8 -*-
"""探针 P6b：切图后残留的「已确认(removed)」几何是否真的删掉了新图上的墨迹。

P6 证明 `core.loadImage` 保留 `line_candidates`（旧图的几何）。残留几何的 `roi_id`
恰好与新图的 `roi_1` 相同，因此 `_geometry_mask` 的 roi 过滤挡不住它。
本探针量化：同一 ROI 矩形下，先删掉全部残留、再恢复，`final_removed_pixels` 与
`digitize` 读数各是多少。

    pixi run python scripts/zero_flow_probes/probe_p6b_cross_image.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def stat(r: Rpc, roi: str, key: str):
    res = r.call("algorithm.applyLineRemoval", {"roi_id": roi})
    return (res.get("stats") or {}).get(key)


def ctrl_count(r: Rpc, col: int = 0) -> int:
    res = r.call("core.digitize", {"col_index": col})
    pts = res.get("points") if isinstance(res, dict) else res
    return len(pts or [])


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)

    print("① 在 hoya 上做清理编辑（确认一条最厚的几何）")
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    roi = d.get("activeRoiId")
    cands = r.call("algorithm.detectLineCandidates", {"roi_id": roi})["candidates"]
    thick = max(cands, key=lambda c: c.get("width") or 0)
    r.call("algorithm.setGeometryStatus", {"candidate_id": thick["id"], "status": "removed"})
    s_before = r.call("algorithm.applyLineRemoval", {"roi_id": roi})["stats"]
    print(f"   hoya: 确认 {thick['id']}(width={thick['width']}) 后 final_removed_pixels = {s_before['final_removed_pixels']}")
    n_before = ctrl_count(r)

    print("\n② 切换到另一张图（beginner），残留几何的 roi_id 仍是 roi_1")
    r.call("core.loadImage", {"sample_key": "beginner"})
    d2 = r.call("straditize.getDiagramData")
    roi2 = d2.get("activeRoiId")
    leftover = d2.get("line_candidates") or []
    removed_left = [c for c in leftover if c.get("status") == "removed"]
    print(f"   新图尺寸 = {d2.get('imageWidth')}x{d2.get('imageHeight')} | rois = {[x['id'] for x in d2.get('rois') or []]}")
    print(f"   残留几何 = {len(leftover)} 条，其中 status=removed = {len(removed_left)} 条")
    print(f"   removed 条目：{json.dumps([{k: c.get(k) for k in ('id','axis','at','width','roi_id','status')} for c in removed_left], ensure_ascii=False)}")

    print("\n③ 在新图上量测：残留几何是否真的剔除了墨迹")
    r.call("core.detectColumns", {"data_xlim": [100, 1800], "data_ylim": [200, 1600]})
    s_with = r.call("algorithm.applyLineRemoval", {"roi_id": roi2})["stats"]
    print(f"   带残留几何: final_removed_pixels = {s_with['final_removed_pixels']}"
          f" | geometry_removed_pixels = {s_with['geometry_removed_pixels']}")

    r.call("algorithm.clearCleanupEdits", {"roi_id": roi2})
    s_without = r.call("algorithm.applyLineRemoval", {"roi_id": roi2})["stats"]
    print(f"   清空后    : final_removed_pixels = {s_without['final_removed_pixels']}"
          f" | geometry_removed_pixels = {s_without['geometry_removed_pixels']}")

    delta = (s_with["final_removed_pixels"] or 0) - (s_without["final_removed_pixels"] or 0)
    print(f"   >>> 残留几何在新图上多剔除了 {delta} 个墨迹像素")

    print("\n④ 对读数的实际影响（同一列、同一 ROI）")
    n_without = ctrl_count(r)
    print(f"   清空后 col0 控制点数 = {n_without}")
    print(f"   （hoya 上作对照：清理前 {n_before}）")


if __name__ == "__main__":
    main()
