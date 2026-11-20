import numpy as np
import pytest
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.digitize import DigitizeSessionMixin


def test_bar_centers_extraction():
    """Verify that a horizontal bar is extracted as a single center point with correct thickness."""
    pts = [
        {"row": 80, "x": 10.0},
        {"row": 81, "x": 10.0},
        {"row": 82, "x": 45.0},  # Bar 1 top
        {"row": 83, "x": 45.0},  # Bar 1 bottom
        {"row": 84, "x": 10.0},
        {"row": 85, "x": 10.0},
        {"row": 86, "x": 55.0},  # Bar 2 top
        {"row": 87, "x": 56.0},  # Bar 2 mid
        {"row": 88, "x": 55.0},  # Bar 2 bottom
        {"row": 89, "x": 10.0},
    ]
    c_start = 10.0
    centers_map = DigitizeSessionMixin._extract_bar_centers_map(pts, c_start=c_start)
    assert len(centers_map) == 2, (
        f"Expected 2 bars, got {len(centers_map)}: {centers_map}"
    )
    # Bar 1 center row should be round((82+83)/2) = 82 or 83
    assert 82 in centers_map or 83 in centers_map
    if 82 in centers_map:
        assert centers_map[82] == 45.0
    # Bar 2 center row should be 87
    assert 87 in centers_map
    assert centers_map[87] == 56.0


def test_multipoint_y_calibration():
    """Verify piecewise linear depth calibration across multiple non-linear depth ticks."""
    sess = StraditizeSession()
    # Mock calibration with 5 non-linear depth ticks (e.g. Depth on an age-linear plot)
    y_marks = [
        {"pixel": 82.0, "val": 300.0},
        {"pixel": 181.0, "val": 360.0},
        {"pixel": 279.0, "val": 420.0},
        {"pixel": 404.0, "val": 480.0},
        {"pixel": 543.0, "val": 540.0},
    ]
    sess.calibrate_axes(y_marks=y_marks, unit="cm")

    # 1. At every calibrated mark, error must be EXACTLY zero!
    for m in y_marks:
        d = sess._depth_for_row_px(m["pixel"])
        assert d == pytest.approx(m["val"], abs=1e-3), (
            f"Depth at {m['pixel']}px should be {m['val']}, got {d}"
        )

    # 2. Between marks, interpolation must be smooth piecewise linear
    mid_row = (82.0 + 181.0) / 2.0
    mid_depth = sess._depth_for_row_px(mid_row)
    assert mid_depth == pytest.approx(330.0, abs=0.1)

    # 3. Paste depths must invert correctly
    res = sess.samples_paste_depths([300.0, 360.0, 420.0, 480.0, 540.0])
    pasted_samples = res.get("samples", [])
    assert len(pasted_samples) == 5
    for i, m in enumerate(y_marks):
        assert pasted_samples[i]["row_px"] == pytest.approx(m["pixel"], abs=1.0)


def test_bar_consensus_alignment():
    """Verify that consensus extraction on bar columns aligns directly to bar vertical centers."""
    sess = StraditizeSession()
    sess.columns = [
        {
            "col_index": 0,
            "name": "TaxaA",
            "plot_type": "bar",
            "start": 10.0,
            "end": 60.0,
        },
        {
            "col_index": 1,
            "name": "TaxaB",
            "plot_type": "bar",
            "start": 70.0,
            "end": 120.0,
        },
    ]
    # In TaxaA, bar is at rows 100..102 (center = 101)
    pts_a = [{"row": r, "x": 40.0 if 100 <= r <= 102 else 10.0} for r in range(90, 115)]
    # In TaxaB, bar is at rows 100..102 (center = 101)
    pts_b = [{"row": r, "x": 95.0 if 100 <= r <= 102 else 70.0} for r in range(90, 115)]
    sess.column_points = {0: pts_a, 1: pts_b}

    res = sess.extract_horizon_consensus(min_taxa_support=2, mode="peaks")
    horizons = res.get("horizons", [])
    assert len(horizons) == 1, (
        f"Expected 1 consensus horizon at bar center, got {len(horizons)}: {horizons}"
    )
    assert horizons[0]["row_px"] == 101, (
        f"Horizon row should be exactly 101 (center), got {horizons[0]['row_px']}"
    )


def test_bar_like_detection_and_no_baseline_dots():
    """Verify that columns with pulse bars are recognized even if default plot_type is 'area',

    and baseline zero points are never added as control points.
    """
    sess = StraditizeSession()
    sess.columns = [
        {
            "col_index": 0,
            "name": "TaxaPulse",
            "plot_type": "area",  # Deliberately leave as 'area'
            "start": 20.0,
            "end": 100.0,
        }
    ]
    # Construct pulse signal: 80% baseline (x=20.0), two bars at rows 50..52 and 80..82
    pts = []
    for r in range(1, 101):
        if 50 <= r <= 52:
            pts.append({"row": r, "x": 80.0})
        elif 80 <= r <= 82:
            pts.append({"row": r, "x": 65.0})
        else:
            pts.append({"row": r, "x": 20.0})
    sess.column_points = {0: pts}

    res = sess.algorithm_extract_turning_points(col_index=0)
    assert res.get("success") is True
    ctrls = sess.control_points.get(0, {})

    # 1. Must only contain the 2 bar centers (51 and 81)
    assert len(ctrls) == 2, f"Expected exactly 2 control points, got {len(ctrls)}: {ctrls}"
    assert 51 in ctrls, f"Expected bar center at 51, got {ctrls}"
    assert 81 in ctrls, f"Expected bar center at 81, got {ctrls}"

    # 2. No points on the baseline (x <= 22.0)
    for r, x in ctrls.items():
        assert x > 25.0, f"Control point at row {r} is near baseline: x={x}"


def test_group_plot_type_inheritance_and_cleanup_recompose():
    """Verify that columns inherit group plot_type and project load recomposes cleanup masks."""
    sess = StraditizeSession()
    sess.rois = [
        {
            "id": "roi_1",
            "xlim": [10, 200],
            "ylim": [10, 200],
            "x_groups": [
                {
                    "id": "grp_1",
                    "plot_type": "bar",
                }
            ],
        }
    ]
    sess.columns = [
        {
            "col_index": 0,
            "id": "col_1",
            "name": "TaxaInherited",
            "x_group_id": "grp_1",
            "start": 10.0,
            "end": 60.0,
        }
    ]
    # Check inheritance
    assert sess._resolve_col_plot_type(sess.columns[0]) == "bar"

    # Now verify cleanup masks restoration upon project load
    sess.load_image("tests/data/figures/riojaplot/pollen_bars_riojaplot.png")
    cand_res = sess.detect_line_candidates()
    if cand_res.get("candidates"):
        sess.set_line_geometry_status(cand_res["candidates"][0]["id"], "removed")
        proj = sess.project_save()

        sess2 = StraditizeSession()
        sess2.project_load(proj)
        assert len(sess2.line_candidates) > 0
        assert any(c.get("status") == "removed" for c in sess2.line_candidates)
        sess2.apply_line_removal()
        assert sess2.grid_line_mask is not None, "grid_line_mask must be restored"
        assert sess2.grid_line_mask.sum() > 0, "grid_line_mask must contain removed pixels"


def test_project_name_preservation_and_customization():
    """Verify that project_name is extracted from archive filename, preserved on load, and customizable."""
    from straditize_core.session_parts.export import extract_project_name_from_filename

    # 1. Extraction from standard project archive filename
    fn = "pollen_bars_riojaplot_project_20261120_120034.tar"
    assert extract_project_name_from_filename(fn) == "pollen_bars_riojaplot"
    assert extract_project_name_from_filename("pollen_bars_riojaplot_project.tar") == "pollen_bars_riojaplot"
    assert extract_project_name_from_filename("my_lake_core.tar") == "my_lake_core"
    assert extract_project_name_from_filename("straditize_project_20261120_120034.tar") is None

    # 2. Session set_project_name
    sess = StraditizeSession()
    sess.set_project_name("custom_lake_project")
    assert sess.project_name == "custom_lake_project"

    # 3. Project load preserves project_name
    payload = {
        "project_name": "pollen_bars_riojaplot",
        "columns": [],
        "calibration": {},
    }
    sess2 = StraditizeSession()
    sess2.project_load(payload)
    assert sess2.project_name == "pollen_bars_riojaplot"

    # 4. Project save retains project_name
    saved = sess2.project_save()
    assert "pollen_bars_riojaplot_project_" in saved["filename"]


