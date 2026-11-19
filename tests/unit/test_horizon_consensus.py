import inspect
import pytest
import numpy as np
from straditize_core.session import StraditizeSession
from straditize_core.protocol import JsonRpcError, INVALID_PARAMS


def test_extract_horizon_consensus_on_synthetic_curves():
    sess = StraditizeSession()
    sess.columns = [
        {"id": "col_0", "col_index": 0, "start": 10.0, "end": 100.0, "name": "Taxa_A"},
        {"id": "col_1", "col_index": 1, "start": 120.0, "end": 200.0, "name": "Taxa_B"},
    ]
    # Both taxa have sharp turning points at rows 50, 120, 200
    rows = np.arange(0, 300)
    pts_a = [
        {
            "row": int(r),
            "x": 10.0
            + 20.0 * np.exp(-(((r - 50) / 10) ** 2))
            + 30.0 * np.exp(-(((r - 200) / 15) ** 2)),
        }
        for r in rows
    ]
    pts_b = [
        {
            "row": int(r),
            "x": 120.0
            + 15.0 * np.exp(-(((r - 50) / 8) ** 2))
            + 25.0 * np.exp(-(((r - 120) / 12) ** 2)),
        }
        for r in rows
    ]
    sess.column_points = {0: pts_a, 1: pts_b}

    res = sess.extract_horizon_consensus(tolerance_px=3.0, min_taxa_support=1)
    assert res["horizons_count"] >= 3
    found_rows = res["pixel_y"]
    assert any(abs(r - 50) <= 2 for r in found_rows)
    assert any(abs(r - 120) <= 2 for r in found_rows)
    assert any(abs(r - 200) <= 2 for r in found_rows)


def test_extract_horizon_consensus_defaults_to_dual_and_adaptive():
    """Requirement R1: Calling extract_horizon_consensus() without arguments must default to mode='dual' and adaptive_window=True."""
    sig = inspect.signature(StraditizeSession.extract_horizon_consensus)
    assert sig.parameters["mode"].default == "dual"
    assert sig.parameters["adaptive_window"].default is True
    assert sig.parameters["tolerance_px"].default == 2.5
    assert sig.parameters["min_taxa_support"].default == 1

    # Verify behavioral execution with zero arguments
    rows = np.arange(0, 200)
    xs_0 = 10.0 + 30.0 * np.exp(-(((rows - 100.0) / 4.0) ** 2))
    xs_1 = 40.0 - 30.0 * np.exp(-(((rows - 103.0) / 4.0) ** 2))
    pts_0 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_0, strict=True)]
    pts_1 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_1, strict=True)]

    sess = StraditizeSession()
    sess.columns = [
        {"id": "c0", "col_index": 0, "start": 0.0, "end": 50.0, "name": "Taxa_0"},
        {"id": "c1", "col_index": 1, "start": 50.0, "end": 100.0, "name": "Taxa_1"},
    ]
    sess.column_points = {0: pts_0, 1: pts_1}

    # Call with completely empty arguments
    res = sess.extract_horizon_consensus()
    # In dual mode with adaptive window, the peak at 100 and valley at 103 remain separated
    assert res["horizons_count"] == 2, res
    polarities = {h["row_px"]: h["polarity"] for h in res["horizons"]}
    assert polarities[100] == "peak"
    assert polarities[103] == "valley"


def test_extract_horizon_consensus_invalid_mode_rejected():
    """Requirement R1: Disallowed modes must be rejected without silent fallbacks."""
    sess = StraditizeSession()
    sess.columns = [
        {"id": "c0", "col_index": 0, "start": 0.0, "end": 50.0, "name": "Taxa_0"}
    ]
    sess.column_points = {0: [{"row": 10, "x": 10.0}]}

    with pytest.raises(JsonRpcError) as exc_info:
        sess.extract_horizon_consensus(mode="invalid_fallback")
    assert exc_info.value.code == INVALID_PARAMS
    assert "Invalid mode" in exc_info.value.message
