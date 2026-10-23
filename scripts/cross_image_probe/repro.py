# -*- coding: utf-8 -*-
"""换图 / 新建项目后清理状态残留的最小复现（修前/修后通用）。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from straditize_core.session import StraditizeSession  # noqa: E402

X_BOUNDS = [315, 1946]
Y_BOUNDS = [511, 1311]


def build(session: StraditizeSession, sample: str = "hoya") -> str:
    session.load_image(sample_key=sample)
    session.detect_columns(X_BOUNDS, Y_BOUNDS)
    roi_id = session.rois[0]["id"]
    session.detect_line_candidates(roi_id=roi_id)
    cands = [c for c in session.line_candidates if c.get("roi_id") == roi_id]
    widest = max(cands, key=lambda c: c.get("width", 0))
    session.set_line_geometry_status(
        candidate_id=widest["id"], status="removed", roi_id=roi_id
    )
    return roi_id


def counts(session: StraditizeSession) -> dict:
    return {
        "line_candidates": len(session.line_candidates or []),
        "exclusion_regions": len(session.exclusion_regions or []),
        "line_strokes": len(session.line_strokes or []),
    }


def main() -> None:
    s = StraditizeSession()
    s._init_cleanup()
    old_roi = build(s)
    before = counts(s)
    old_ids = sorted(c["id"] for c in s.line_candidates)
    print(f"旧图 ROI id = {old_roi}")
    print(f"换图前几何 = {before}")
    print(f"换图前候选 id 样例 = {old_ids[:3]} ... 共 {len(old_ids)}")

    s.load_image(sample_key="beginner")
    new_roi = s.rois[0]["id"]
    after_load = counts(s)
    print(f"新图 ROI id = {new_roi}")
    print(f"换图后几何 = {after_load}")
    print(f"ROI id 是否撞名: {old_roi == new_roi}")
    b03 = [c for c in s.line_candidates if c["id"] in old_ids]
    print(f"旧候选仍在: {len(b03)} 条，其中 1 条 removed = {sum(1 for c in b03 if c.get('status') == 'removed')}")

    # 再走一次 project_new(clear_image=False)
    s.project_new(clear_image=False)
    print(f"project_new(clear_image=False) 后几何 = {counts(s)}")

    # project_new(clear_image=True)
    s2 = StraditizeSession()
    s2._init_cleanup()
    build(s2)
    print(f"[独立会话] 建几何后 = {counts(s2)}")
    s2.project_new(clear_image=True)
    print(f"[独立会话] project_new(clear_image=True) 后 = {counts(s2)}")


if __name__ == "__main__":
    main()
