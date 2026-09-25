"""Tests for sample horizons, consensus extraction, and depth calibration invariants (T08)."""

from __future__ import annotations

import hashlib
from pathlib import Path
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

HOYA_PATH = Path("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png")
HOYA_SHA256 = "f94196e6a81666c61c72ea7a2c731ee5d29dfe914414a2f35628d3ed5ed91c1f"


def get_hoya_session() -> StraditizeSession:
    assert HOYA_PATH.exists()
    assert hashlib.sha256(HOYA_PATH.read_bytes()).hexdigest() == HOYA_SHA256
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))
    session.detect_columns([315, 1946], [511, 1311])
    return session


def test_sample_horizon_uncalibrated_depth_is_null():
    """Uncalibrated session must keep depth === None, never fabricating 0 or default values."""
    session = StraditizeSession()
    assert session.is_calibrated is False

    # Set a manual sample horizon
    res = session.samples_set([{"row_px": 350}])
    assert len(res["samples"]) == 1
    sample = res["samples"][0]
    assert sample["row_px"] == 350
    assert sample["depth"] is None
    assert sample["source"] == "manual"


def test_sample_horizon_calibrated_calculates_depth():
    """Calibrated session calculates exact real depth for each row_px."""
    session = StraditizeSession()
    session.calibrate_axes(
        y_marks=[{"px": 100.0, "val": 0.0}, {"px": 500.0, "val": 40.0}],
        unit="cm",
    )
    assert session.is_calibrated is True

    # slope = 40 / 400 = 0.1 cm/px, intercept = -10
    res = session.samples_set([{"row_px": 200}, {"row_px": 400}])
    assert len(res["samples"]) == 2
    # row 200 -> 0.1 * 200 - 10 = 10.0 cm
    # row 400 -> 0.1 * 400 - 10 = 30.0 cm
    assert res["samples"][0]["depth"] == 10.0
    assert res["samples"][1]["depth"] == 30.0


def test_sample_horizon_paste_depths():
    """Pasting real depths maps back to pixel rows using calibration slope and intercept."""
    session = StraditizeSession()

    # Uncalibrated paste must raise -32001 (STATE_ERROR)
    with pytest.raises(JsonRpcError) as exc_info:
        session.samples_paste_depths([10.0, 20.0, 30.0])
    assert exc_info.value.code == -32001
    assert "Y" in exc_info.value.message or "标定" in exc_info.value.message

    # Calibrate
    session.calibrate_axes(
        y_marks=[{"px": 100.0, "val": 10.0}, {"px": 300.0, "val": 30.0}],
        unit="cm",
    )
    # slope = 0.1 cm/px, intercept = 0
    res = session.samples_paste_depths([15.0, 25.0])
    assert len(res["samples"]) == 2
    assert res["samples"][0]["row_px"] == 150
    assert res["samples"][0]["depth"] == 15.0
    assert res["samples"][0]["source"] == "paste"

    assert res["samples"][1]["row_px"] == 250
    assert res["samples"][1]["depth"] == 25.0
    assert res["samples"][1]["source"] == "paste"


def test_consensus_extraction_workflow():
    """Consensus extraction discovers sample horizons from multi-taxa turning point curvature extrema."""
    session = get_hoya_session()
    # Digitize columns so turning points exist
    for col in session.columns[:5]:
        session.digitize(col["col_index"])

    res = session.samples_extract_consensus(tolerance_px=3.0, min_taxa_support=1)
    assert res["count"] > 0
    assert all(s["source"] == "auto" for s in res["samples"])

    # Clear samples
    clear_res = session.samples_clear()
    assert clear_res["success"] is True
    assert len(session.samples) == 0
