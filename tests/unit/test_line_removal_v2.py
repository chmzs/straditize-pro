"""Tests for Line Removal v2: four-kind criteria, candidates, and absolute exclusions (T05)."""

from __future__ import annotations

import hashlib
from pathlib import Path
import numpy as np

from straditize_core.lines import detect_line_candidates
from straditize_core.session import StraditizeSession

HOYA_PATH = Path("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png")
HOYA_SHA256 = "f94196e6a81666c61c72ea7a2c731ee5d29dfe914414a2f35628d3ed5ed91c1f"


def get_hoya_session() -> StraditizeSession:
    assert HOYA_PATH.exists()
    assert hashlib.sha256(HOYA_PATH.read_bytes()).hexdigest() == HOYA_SHA256
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))
    return session


def test_synthetic_candidate_classification():
    """Synthetic test pattern must be classified accurately into kinds A, B, and C."""
    # 200 x 200 blank canvas
    ink = np.zeros((200, 200), dtype=bool)

    # Kind A: 1 horizontal line across 80% of width at row 50 (width 1)
    ink[50, 10:190] = True

    # Kind B: 1 vertical line across 60% of height at col 100 (width 1)
    ink[20:180, 100] = True

    # 1 thick shape that should NOT be counted as thin line (e.g. filled circle or 10px bar)
    ink[110:140, 120:150] = True

    # Synthetic column structure for Kind C test
    columns = [
        {"startX": 10, "endX": 80, "roi_id": "roi_1"},
        {"startX": 80, "endX": 190, "roi_id": "roi_1"},
    ]
    # Kind C: inside col 0 (x: 10-80), add a vertical line of height 40 (20% of sub_h)
    ink[60:100, 30] = True

    roi = {"xlim": [0, 200], "ylim": [0, 200]}
    cands = detect_line_candidates(ink, roi, columns=columns, line_fraction_h=0.75, line_fraction_v=0.30, line_width_min=1, line_width_max=2)

    kinds = [c["kind"] for c in cands]
    assert kinds.count("A") == 1
    assert kinds.count("B") == 1
    assert kinds.count("C") == 1


def test_line_width_max_filter():
    """Lines exceeding line_width_max must not enter candidates."""
    ink = np.zeros((100, 100), dtype=bool)
    # 3px vertical line
    ink[10:90, 48:51] = True

    roi = {"xlim": [0, 100], "ylim": [0, 100]}
    # With max=2, 3px line must be excluded
    cands_filtered = detect_line_candidates(ink, roi, line_fraction_v=0.30, line_width_min=1, line_width_max=2)
    assert len(cands_filtered) == 0

    # With max=None, it enters
    cands_all = detect_line_candidates(ink, roi, line_fraction_v=0.30, line_width_min=1, line_width_max=None)
    assert len(cands_all) == 1
    assert cands_all[0]["width"] == 3


def test_adaptive_width_max_scales_with_roi_resolution():
    """线宽判据必须随分辨率自适应，否则真实扫描件一条线都检测不到。

    Regression（实测事故）：一张 6126×3477 的扫描图，其 ROI 内肉眼可见 3 条
    zone 横线（覆盖率 93–98%，原图厚度约 6px）。默认 `line_width_max=2` 时
    `algorithm.detectLineCandidates` 返回 **0 条**——固定像素阈值是为小尺寸教程图
    调的，在大扫描件上把真实区带线全部判为"太厚"。
    """
    from straditize_core.lines import resolve_width_max

    # 分辨率越高，允许的线宽越大
    assert resolve_width_max((800, 4855), None) > resolve_width_max((800, 1600), None)
    # 有下限，避免抗锯齿边缘被当成结构线
    assert resolve_width_max((50, 50), None) >= 3
    # 显式传值必须原样生效（调用方始终能钉死行为）
    assert resolve_width_max((800, 4855), 2) == 2

    # 同一条 6px 线：小图默认判太厚，大图默认应能检出
    def build(scale: int) -> np.ndarray:
        ink = np.zeros((scale, scale), dtype=bool)
        ink[scale // 2 : scale // 2 + 6, 10 : scale - 10] = True
        return ink

    small = build(400)
    big = build(4000)

    # 小图（长边 400 -> 自适应上限 3）：6px 线超限
    assert len(detect_line_candidates(small, {"xlim": [0, 400], "ylim": [0, 400]},
                                      line_fraction_h=0.5, line_width_max=2)) == 0
    # 大图（长边 4000 -> 自适应上限 16）：同样的 6px 线必须被检出
    big_cands = detect_line_candidates(big, {"xlim": [0, 4000], "ylim": [0, 4000]},
                                       line_fraction_h=0.5, line_width_max=None)
    assert [c["kind"] for c in big_cands].count("A") == 1


def test_exclusion_absolute_priority():
    """Exclusion region is absolute: restore strokes inside exclusion are completely ineffective."""
    session = StraditizeSession()
    # 100 x 100 ink
    ink = np.zeros((100, 100), dtype=bool)
    # A candidate line at row 50
    ink[50, 10:90] = True
    session.foreground_mask = ink
    session.image = object() # mock loaded
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=0, x1=100, y0=0, y1=100)["roi"]

    # Detect candidates
    session.detect_line_candidates(roi["id"], line_fraction_h=0.70)
    assert len(session.line_candidates) == 1
    cand_id = session.line_candidates[0]["id"]

    # Cover row 50 with an exclusion box
    exclusion = [{
        "id": "ex_1",
        "roi_id": roi["id"],
        "kind": "rect",
        "points": [[20, 45], [60, 45], [60, 55], [20, 55]],
    }]

    # Also try to draw a restore stroke in the exact same area
    restore_stroke = [{
        "id": "stroke_1",
        "mode": "restore",
        "radius": 5,
        "points": [[30, 50], [40, 50]],
    }]

    res = session.apply_line_removal(
        roi_id=roi["id"],
        selected_ids=[cand_id],
        strokes=restore_stroke,
        exclusion_regions=exclusion,
    )

    # In session.grid_line_mask, the exclusion region MUST be marked as removed / masked
    # Check that in the exclusion box, pixels are removed
    assert session.grid_line_mask[50, 30] == True
    assert session.grid_line_mask[50, 40] == True
    assert res["stats"]["exclusion_pixels"] > 0


def test_columns_stale_local_to_roi():
    """apply_line_removal marks only its own ROI's columns_stale = True."""
    session = StraditizeSession()
    session.foreground_mask = np.zeros((100, 100), dtype=bool)
    session.image = object()
    session._init_rois()

    r1 = session.roi_create(name="roi_1", x0=0, x1=50, y0=0, y1=100)["roi"]
    r2 = session.roi_create(name="roi_2", x0=50, x1=100, y0=0, y1=100)["roi"]

    session.apply_line_removal(roi_id=r1["id"], selected_ids=[])

    r1_curr = session._get_roi(r1["id"])
    r2_curr = session._get_roi(r2["id"])

    assert r1_curr["columns_stale"] is True
    assert r2_curr["columns_stale"] is False


def test_hoya_real_regression():
    """Real Hoya figure regression: zone lines are detected without erasing Pinus."""
    session = get_hoya_session()
    # Hoya data region
    # get_hoya_session() 走 load_image，已自动建了一个名为 "pollen" 的建议取数区；
    # 这里要钉死 Hoya 的实测边界，先清掉默认 ROI 再按精确坐标重建。
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=315, x1=1946, y0=511, y1=1311)["roi"]

    # Detect line candidates
    cands_res = session.detect_line_candidates(
        roi["id"],
        line_fraction_h=0.75,
        line_fraction_v=0.30,
        line_width_min=1,
        line_width_max=2,
    )
    cands = cands_res["candidates"]
    kinds = [c["kind"] for c in cands]

    # Hoya contains three interrupted-but-wide zone separators. They must be
    # detected by the coverage-aware horizontal pass.
    #
    # 断言 3 而非 2：Hoya 的 zone 行实测为 y=818/819、1129/1130、1306/1307 三条。
    # 旧断言 2 锁的是一个 edge_margin 缺陷——第三条距 ROI 底(y1=1311)仅 4px，
    # 而保护带曾是 `2 * line_width_max` = 4px，`at_local >= sub_h - 1 - 4` 恰好把它
    # 当成 ROI 边框丢掉。保护带已改为只与边框粗细有关（上限 4px），不再随线宽膨胀。
    assert kinds.count("A") == 3

    # Apply all detected vertical line candidates
    selected_ids = [c["id"] for c in cands]
    res = session.apply_line_removal(roi_id=roi["id"], selected_ids=selected_ids)

    # Pinus column spans approximately x: 500-650 in Hoya
    pinus_ink_before = session.foreground_mask[511:1311, 500:650].sum()
    pinus_removed = (session.foreground_mask[511:1311, 500:650] & session.grid_line_mask[511:1311, 500:650]).sum()

    removed_ratio = pinus_removed / max(1, pinus_ink_before)
    print(f"\nHoya Pinus ink removal ratio: {removed_ratio * 100:.2f}% (removed {pinus_removed} / {pinus_ink_before})")
    assert removed_ratio < 0.01, f"Pinus removal ratio {removed_ratio:.4f} exceeded 1%!"
