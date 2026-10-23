# -*- coding: utf-8 -*-
"""跨图清理状态残留的回归钉子（B-03）。

## 缺陷本体

`load_image()` 与 `project_new()` 的清理清单里**从未**包含
`line_candidates` / `exclusion_regions` / `line_strokes`。而 `_init_rois()`
会把 ROI 计数器归零、让新图 ROI 又叫 `roi_1` —— 与旧几何的 `roi_id` 同名，
于是 `_geometry_mask()` 里按 roi_id 的过滤完全失效。后果：
旧图确认过的几何在**新图**上继续剔除墨迹（实测 24 条残留 → 13454 px），用户无从得知。

## 两层防御，本文件各钉一遍

1. **主动清理**：两个入口都把三项清空（`test_load_image_clears_*`、`test_project_new_clears_*`）；
2. **纵深防御**：`_geometry_scope` 给几何打"属于哪张图"的标记，即使清理漏了，
   跨图几何也**不可用**而非**有害**（`test_defence_in_depth_survives_bypassed_cleanup`）。

第 2 层比第 1 层重要：只靠"记得清理"是脆弱的，任何新增字段都可能再次漏清。
"""
from __future__ import annotations

import pytest

from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]
BEGINNER_X, BEGINNER_Y = [200, 1700], [200, 1600]


def _session_on_hoya_with_geometry() -> StraditizeSession:
    """Return a session on ``hoya`` with one *confirmed* (removed) geometry."""
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.detect_columns(HOYA_X, HOYA_Y, roi_id=s.rois[0]["id"])
    roi_id = s.rois[0]["id"]
    s.upsert_line_geometry(
        roi_id=roi_id,
        axis="h",
        geometry={"type": "rect", "x0": 320, "y0": 700, "x1": 1900, "y1": 702},
        status="removed",
    )
    s.upsert_line_geometry(
        roi_id=roi_id,
        axis="v",
        geometry={"type": "rect", "x0": 900, "y0": 520, "x1": 902, "y1": 1300},
        status="removed",
    )
    return s


class TestLoadImageClearsCleanupState:
    """换图必须把属于上一张图的清理状态清空。"""

    def test_load_image_clears_line_candidates(self) -> None:
        s = _session_on_hoya_with_geometry()
        assert s.line_candidates, "前置：hoya 上应已有几何"
        s.load_image(sample_key="beginner")
        assert s.line_candidates == [], (
            f"换图后 line_candidates 仍有 {len(s.line_candidates)} 条 —— "
            "它们会在新图上继续剔除墨迹（B-03）"
        )

    def test_load_image_clears_exclusion_regions(self) -> None:
        s = _session_on_hoya_with_geometry()
        s.exclusion_regions.append({"id": "ex_1", "roi_id": s.rois[0]["id"], "points": []})
        assert s.exclusion_regions
        s.load_image(sample_key="beginner")
        assert s.exclusion_regions == []

    def test_load_image_clears_line_strokes(self) -> None:
        s = _session_on_hoya_with_geometry()
        s.line_strokes.append({"id": "s_1", "roi_id": s.rois[0]["id"], "points": []})
        assert s.line_strokes
        s.load_image(sample_key="beginner")
        assert s.line_strokes == []

    def test_load_image_clears_selected_ids(self) -> None:
        s = _session_on_hoya_with_geometry()
        s.selected_candidate_ids = {"a", "b"}
        s.load_image(sample_key="beginner")
        assert s.selected_candidate_ids == set()


class TestProjectNewClearsCleanupState:
    """新建项目同样必须清空（原缺陷只在 load_image 上被注意过）。"""

    def test_project_new_clears_all_three(self) -> None:
        s = _session_on_hoya_with_geometry()
        s.exclusion_regions.append({"id": "ex_1", "roi_id": s.rois[0]["id"], "points": []})
        s.line_strokes.append({"id": "s_1", "roi_id": s.rois[0]["id"], "points": []})
        assert s.line_candidates and s.exclusion_regions and s.line_strokes

        s.project_new(clear_image=False)

        assert s.line_candidates == [], "project_new 后 line_candidates 未清"
        assert s.exclusion_regions == [], "project_new 后 exclusion_regions 未清"
        assert s.line_strokes == [], "project_new 后 line_strokes 未清"


class TestDefenceInDepth:
    """即使清理被绕过，跨图几何也必须**不可用**而非**有害**。"""

    def test_defence_in_depth_survives_bypassed_cleanup(self) -> None:
        s = _session_on_hoya_with_geometry()
        stale = [dict(g) for g in s.line_candidates if g.get("status") == "removed"]
        assert stale, "前置：应有一条已确认几何"

        s.load_image(sample_key="beginner")
        s.detect_columns(BEGINNER_X, BEGINNER_Y, roi_id=s.rois[0]["id"])
        new_roi = s.rois[0]["id"]

        # 模拟「清理漏了」：把旧图几何强行塞回，并改成新图的 roi_id，
        # 让按 roi_id 的过滤完全失效（这正是原缺陷成立的机制）。
        for g in stale:
            g["roi_id"] = new_roi
        s.line_candidates = list(stale)

        stats = s.apply_line_removal(roi_id=new_roi)["stats"]
        assert stats["geometry_removed_pixels"] == 0, (
            "旧图几何在新图上仍剔除了 "
            f"{stats['geometry_removed_pixels']} px —— "
            "_geometry_scope 的纵深防御失效；只靠 roi_id 过滤挡不住跨图几何（B-03）"
        )

    def test_geometry_from_same_image_still_works(self) -> None:
        """反方向：同一张图上的几何必须照常生效，别把防御做成了禁止。"""
        s = _session_on_hoya_with_geometry()
        roi_id = s.rois[0]["id"]
        stats = s.apply_line_removal(roi_id=roi_id)["stats"]
        assert stats["geometry_removed_pixels"] > 0, (
            "同一张图上已确认的几何应真的剔除墨迹；若为 0 说明防御过度"
        )
