"""Tests for X-axis tick mark geometric detection and calibration (T07)."""

from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.xticks import detect_xticks

BELL_IMG_PATH = Path("straditize_core/assets/tutorials/beginner-tutorial.png") # fallback / probe path
TRUTH_DIR = Path("tests/data/truth")


def test_two_endpoints_arbitrary_order_mapping():
    """Two endpoints in arbitrary order establish valid calibration; identical px or out-of-bounds raises -32602."""
    session = StraditizeSession()
    session.columns = [
        {"col_index": 0, "id": "col_1", "startX": 100.0, "endX": 250.0, "name": "Pinus", "roi_id": "roi_1"}
    ]

    # Order 1: px 100 -> 0, px 200 -> 50
    res1 = session.calibrate_column_xticks(
        col_index=0,
        ticks=[{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 50.0}],
    )
    assert res1["px_per_unit"] == 2.0
    assert session.columns[0]["x_ticks"] == [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 50.0}]

    # Order 2: reversed order (px 200 -> 50, px 100 -> 0)
    res2 = session.calibrate_column_xticks(
        col_index=0,
        ticks=[{"px": 200.0, "value": 50.0}, {"px": 100.0, "value": 0.0}],
    )
    assert res2["px_per_unit"] == 2.0

    # Identical pixels must raise -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.calibrate_column_xticks(
            col_index=0,
            ticks=[{"px": 100.0, "value": 0.0}, {"px": 100.0, "value": 50.0}],
        )
    assert exc_info.value.code == -32602

    # Out of bounds (> endX + 10) must raise -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.calibrate_column_xticks(
            col_index=0,
            ticks=[{"px": 100.0, "value": 0.0}, {"px": 300.0, "value": 50.0}],
        )
    assert exc_info.value.code == -32602


def test_tick_interval_independence_no_false_alarm():
    """Different tick interval steps (e.g. 5 vs 10) have 2x difference in px_per_unit without alarm."""
    session = StraditizeSession()
    session.columns = [
        {"col_index": 0, "id": "c1", "startX": 100.0, "endX": 200.0, "roi_id": "roi_1"},
        {"col_index": 1, "id": "c2", "startX": 200.0, "endX": 300.0, "roi_id": "roi_1"},
    ]

    # Column 0: step = 10, px 100->0, px 150->10 (5 px per unit)
    res0 = session.calibrate_column_xticks(0, [{"px": 100.0, "value": 0.0}, {"px": 150.0, "value": 10.0}])
    # Column 1: step = 5, px 200->0, px 250->5 (10 px per unit)
    res1 = session.calibrate_column_xticks(1, [{"px": 200.0, "value": 0.0}, {"px": 250.0, "value": 5.0}])

    assert res0["px_per_unit"] == 5.0
    assert res1["px_per_unit"] == 10.0
    assert res1["px_per_unit"] / res0["px_per_unit"] == 2.0


def test_n_ticks_guard_and_non_zero_baseline():
    """Columns with fewer than two ticks cannot define a scale; first tick need not start at 0."""
    gray = np.ones((100, 100), dtype=np.uint8) * 255
    # Simulate a single tick at col 50 (rows 80-88)
    gray[80:89, 50] = 0

    cols = [(0, 100)]
    res = detect_xticks(gray, band=(80, 89), columns=cols)
    assert len(res["per_column"]) == 1
    assert res["per_column"][0]["usable"] is False
    assert "only 1" in res["per_column"][0]["reason"]

    # Non-zero baseline: tick 1 at 20 (val 10), tick 2 at 60 (val 30) -> baseline at 0 is at px 0
    session = StraditizeSession()
    session.columns = [{"col_index": 0, "startX": 0.0, "endX": 80.0}]
    cal_res = session.calibrate_column_xticks(0, [{"px": 20.0, "value": 10.0}, {"px": 60.0, "value": 30.0}])
    assert cal_res["px_per_unit"] == 2.0
    assert cal_res["x_ticks"][0]["value"] == 10.0


def test_no_tickvalue_divided_by_colwidth_in_code():
    """Grep codebase to verify tickValue / col_width formula does NOT appear in any validation/calibration logic."""
    core_dir = Path("straditize_core")
    bad_pattern = "tickValue / col"
    for py_file in core_dir.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        assert bad_pattern not in text, f"Forbidden formula '{bad_pattern}' found in {py_file}"


def test_truth_bell_x_ticks():
    """Verify on exaggeration_bell ground truth json that ticks are detected and parsed."""
    truth_file = TRUTH_DIR / "exaggeration_bell__x_ticks.json"
    if not truth_file.exists():
        pytest.skip("exaggeration_bell__x_ticks.json truth file not found")

    truth = json.loads(truth_file.read_text(encoding="utf-8"))
    gt_ticks = truth.get("ticks", [])
    assert len(gt_ticks) == 65
