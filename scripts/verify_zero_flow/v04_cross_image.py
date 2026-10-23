# -*- coding: utf-8 -*-
"""独立复核 D：F-03 / probes F-2 / probes F-5 —— 清理几何跨图 / 跨项目残留。

三份报告都指向 `project_new` 与 `load_image` 不清 `line_candidates` /
`exclusion_regions` / `line_strokes`，但剂量差别很大：
- static F-03：一次"用户确认全部 24 条几何"→ 新图多剔 13454 px
- probes F-2：确认**一条**最厚几何 → 新图多剔 2400 px
- probes F-5：`project.new` 之后 line_candidates 仍 24 条、笔迹 1 笔

我的复现刻意分四档剂量，并各配一个"全新会话"空白对照，避免把
"图 B 自身的线掩膜"算到残留头上。

运行：
    pixi run python scripts/verify_zero_flow/v04_cross_image.py
"""
from __future__ import annotations

from vcommon import banner, isolate_config, new_session, pretty  # noqa: E402

CFG = isolate_config()


def fresh_hoya(s=None):
    from vcommon import hoya

    return hoya(s or new_session())


def rem_px(s):
    st = s._recompose(s.active_roi_id)
    return st["stats"]


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    # ------------------------------------------------------------------
    banner("D1. 空白对照：全新会话直接载入 beginner（无任何残留）")
    s_ctrl = new_session()
    s_ctrl.load_image(sample_key="beginner")
    s_ctrl.detect_columns([200, 1700], [200, 1600])
    st = rem_px(s_ctrl)
    print(f"  新会话 beginner: 尺寸={s_ctrl.width}x{s_ctrl.height} "
          f"rois={[r['id'] for r in s_ctrl.rois]}")
    print(f"  line_candidates={len(s_ctrl.line_candidates)}  removed_px={st.get('removed_line_pixels')}")

    # ------------------------------------------------------------------
    banner("D2. 剂量-1：只确认 1 条几何，然后换图 beginner")
    s = fresh_hoya()
    cands = s.detect_line_candidates()["candidates"]
    # 选厚度最大的一条（与 probes F-2 同思路，但由我自己的脚本选）
    thick = max(cands, key=lambda c: c.get("width", 0))
    s.set_line_geometry_status(thick["id"], "removed")
    a_stats = rem_px(s)
    print(f"  hoya 上确认 {thick['id']} (width={thick.get('width')}) "
          f"-> removed_px={a_stats.get('removed_line_pixels')}")
    s.load_image(sample_key="beginner")
    s.detect_columns([200, 1700], [200, 1600])
    st = rem_px(s)
    removed = [c for c in s.line_candidates if c.get("status") == "removed"]
    print(f"  切到 beginner: 尺寸={s.width}x{s.height} "
          f"rois={[r['id'] for r in s.rois]}")
    print(f"  残留 line_candidates = {len(s.line_candidates)}  "
          f"其中 status=removed = {len(removed)}")
    print(f"  残留 removed 的 roi_id = {[c.get('roi_id') for c in removed]}")
    print(f"  beginner 上 removed_line_pixels = {st.get('removed_line_pixels')}  "
          f"（空白对照是 {rem_px(s_ctrl).get('removed_line_pixels')}）")

    # ------------------------------------------------------------------
    banner("D3. 剂量-2：确认全部几何（static F-03 的剂量）")
    s2 = fresh_hoya()
    cands2 = s2.detect_line_candidates()["candidates"]
    for c in cands2:
        s2.set_line_geometry_status(c["id"], "removed")
    a2 = rem_px(s2)
    print(f"  hoya 上确认 {len(cands2)} 条 -> removed_px={a2.get('removed_line_pixels')}")
    s2.load_image(sample_key="beginner")
    s2.detect_columns([200, 1700], [200, 1600])
    b2 = rem_px(s2)
    print(f"  beginner 上 removed_px={b2.get('removed_line_pixels')}  "
          f"残留={len(s2.line_candidates)} 条")

    # ------------------------------------------------------------------
    banner("D4. 逐列影响：残留 vs 空白对照，同一批列同一批行")
    s3 = fresh_hoya()
    cands3 = s3.detect_line_candidates()["candidates"]
    for c in cands3:
        s3.set_line_geometry_status(c["id"], "removed")
    s3.load_image(sample_key="beginner")
    s3.detect_columns([200, 1700], [200, 1600])

    s4 = new_session()
    s4.load_image(sample_key="beginner")
    s4.detect_columns([200, 1700], [200, 1600])

    print(f"  残留列数={len(s3.columns)}  对照列数={len(s4.columns)}")
    total_diff = 0
    for k in range(min(len(s3.columns), len(s4.columns))):
        p3 = s3.digitize(k, "area") if hasattr(s3, "digitize") else None
        p4 = s4.digitize(k, "area") if hasattr(s4, "digitize") else None
        d3 = s3.column_points.get(k, [])
        d4 = s4.column_points.get(k, [])
        m3 = {p["row"]: p["x"] for p in d3}
        m4 = {p["row"]: p["x"] for p in d4}
        common = set(m3) & set(m4)
        ndiff = sum(1 for r in common if abs(m3[r] - m4[r]) > 1e-9)
        total_diff += ndiff
        if ndiff:
            ex = next(r for r in sorted(common) if abs(m3[r] - m4[r]) > 1e-9)
            print(
                f"    列{k}: {ndiff}/{len(common)} 行不同  例 row={ex} "
                f"残留x={m3[ex]:.1f} 对照x={m4[ex]:.1f}"
            )
    print(f"  受影响行合计 = {total_diff}")

    # ------------------------------------------------------------------
    banner("D5. probes F-5：project.new 之后清理状态残留")
    s5 = fresh_hoya()
    c5 = s5.detect_line_candidates()["candidates"]
    s5.set_line_geometry_status(c5[0]["id"], "removed")
    s5.apply_line_removal(strokes=[{"id": "st1", "mode": "erase", "radius": 6,
                                    "points": [[100, 200], [120, 220]]}])
    before = {
        "columns": len(s5.columns),
        "rois": len(s5.rois),
        "line_candidates": len(s5.line_candidates),
        "exclusion_regions": len(getattr(s5, "exclusion_regions", []) or []),
        "line_strokes": len(getattr(s5, "line_strokes", []) or []),
        "cleanup_stats": bool(getattr(s5, "cleanup_stats", {})),
    }
    s5.project_new(clear_image=False)
    after = {
        "columns": len(s5.columns),
        "rois": len(s5.rois),
        "line_candidates": len(s5.line_candidates),
        "exclusion_regions": len(getattr(s5, "exclusion_regions", []) or []),
        "line_strokes": len(getattr(s5, "line_strokes", []) or []),
        "cleanup_stats": bool(getattr(s5, "cleanup_stats", {})),
    }
    print(f"  project.new 之前: {pretty(before)}")
    print(f"  project.new 之后: {pretty(after)}")
    leaked = (
        after["line_candidates"] > 0
        or after["exclusion_regions"] > 0
        or after["line_strokes"] > 0
    )
    print(f"  >>> 清理状态残留？ {'是（缺陷）' if leaked else '否'}")

    # ------------------------------------------------------------------
    banner("D6. 归因：残留几何的 roi_id 与新图 ROI id 是否同名")
    print(f"  hoya 上几何 roi_id = {sorted({c.get('roi_id') for c in s2.line_candidates})}")
    print(f"  beginner 新 ROI id = {[r['id'] for r in s2.rois]}")
    print("  （同名则 cleanup.py 的 `if cand.get('roi_id') != roi_id: continue` 无法拦截）")


if __name__ == "__main__":
    main()
