"""Comprehensive tests for multi-ROI management, isolation, and RPC extension point (W2 / T01)."""

from __future__ import annotations

import copy
import hashlib
from pathlib import Path
from typing import Any

import pytest

from straditize_core.protocol import JsonRpcDispatcher, JsonRpcError
from straditize_core.rpc_methods import register_all
from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_PATH = Path("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png")
HOYA_SHA256 = "f94196e6a81666c61c72ea7a2c731ee5d29dfe914414a2f35628d3ed5ed91c1f"


def get_hoya_session() -> StraditizeSession:
    """Helper to load Hoya figure with sha256 assertion."""
    assert HOYA_PATH.exists(), f"Hoya figure missing at {HOYA_PATH}"
    actual_sha = hashlib.sha256(HOYA_PATH.read_bytes()).hexdigest()
    assert actual_sha == HOYA_SHA256, f"Hoya sha256 mismatch: {actual_sha} != {HOYA_SHA256}"
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))
    return session


def test_mro_contains_all_eight_mixins():
    """StraditizeSession.__mro__ must contain all 8 mixins specified in contract v1.3 §8.1.2."""
    mro_names = [c.__name__ for c in StraditizeSession.__mro__]
    required = [
        "CoreMixin",
        "RoiMixin",
        "CleanupMixin",
        "XTicksMixin",
        "SamplesMixin",
        "LayersMixin",
        "QaMixin",
        "ExportMixin",
    ]
    for mixin in required:
        assert mixin in mro_names, f"Mixin {mixin} missing in StraditizeSession MRO"


def test_roi_create_name_validation():
    """Names must match ^[\\w\\u4e00-\\u9fa5-]{1,31}$ and be unique; violations raise -32602."""
    session = get_hoya_session()

    # Valid creations
    r1 = session.roi_create(name="charcoal", x0=315, x1=500, y0=511, y1=1311)
    assert r1["roi"]["name"] == "charcoal"
    assert r1["roi"]["name_source"] == "user"

    r_cn = session.roi_create(name="花粉主区-1", x0=500, x1=1200, y0=511, y1=1311)
    assert r_cn["roi"]["name"] == "花粉主区-1"

    # Duplicate name raises -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="charcoal", x0=100, x1=200, y0=100, y1=200)
    assert exc_info.value.code == -32602
    assert "already exists" in exc_info.value.message

    # Name containing slash '/' raises -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="pollen/spores", x0=100, x1=200, y0=100, y1=200)
    assert exc_info.value.code == -32602

    # Name exceeding 31 characters raises -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="a" * 32, x0=100, x1=200, y0=100, y1=200)
    assert exc_info.value.code == -32602

    # Empty name raises -32602 or auto-assigns default
    # If explicit empty string is passed, pattern fails -> -32602
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="", x0=100, x1=200, y0=100, y1=200)
    assert exc_info.value.code == -32602


def test_multi_roi_column_detection_isolation():
    """Detecting columns for one ROI modifies only its columns; other ROIs' columns remain unchanged field-by-field."""
    session = get_hoya_session()
    # Initial load creates default pollen ROI
    session.rois.clear()
    session.columns.clear()
    session.column_points.clear()
    session.control_points.clear()

    # Create 3 distinct ROIs
    r_char = session.roi_create(name="charcoal", x0=315, x1=485, y0=511, y1=1311)["roi"]
    r_pollen = session.roi_create(name="pollen", x0=485, x1=1200, y0=511, y1=1311)["roi"]
    r_conc = session.roi_create(name="concentration", x0=1200, x1=1600, y0=511, y1=1311)["roi"]

    # Detect columns for charcoal
    cols_char = session.detect_columns(roi_id=r_char["id"])
    assert len(cols_char) > 0
    assert all(c["roi_id"] == r_char["id"] for c in cols_char)

    # Detect columns for concentration
    cols_conc = session.detect_columns(roi_id=r_conc["id"])
    assert len(cols_conc) > 0
    assert all(c["roi_id"] == r_conc["id"] for c in cols_conc)

    # Snapshot charcoal and concentration columns before detecting pollen
    char_snapshot = [copy.deepcopy(c) for c in session.columns if c["roi_id"] == r_char["id"]]
    conc_snapshot = [copy.deepcopy(c) for c in session.columns if c["roi_id"] == r_conc["id"]]

    # Now detect columns for pollen
    cols_pollen = session.detect_columns(roi_id=r_pollen["id"])
    assert len(cols_pollen) > 0
    assert all(c["roi_id"] == r_pollen["id"] for c in cols_pollen)

    # Verify that charcoal and concentration columns were NOT changed (except global col_index renumbering)
    char_after = [c for c in session.columns if c["roi_id"] == r_char["id"]]
    conc_after = [c for c in session.columns if c["roi_id"] == r_conc["id"]]

    assert len(char_after) == len(char_snapshot)
    for c_orig, c_now in zip(char_snapshot, char_after):
        for k in c_orig:
            if k != "col_index":
                assert c_orig[k] == c_now[k], f"Field {k} altered in charcoal column: {c_orig[k]} != {c_now[k]}"

    assert len(conc_after) == len(conc_snapshot)
    for c_orig, c_now in zip(conc_snapshot, conc_after):
        for k in c_orig:
            if k != "col_index":
                assert c_orig[k] == c_now[k], f"Field {k} altered in concentration column: {c_orig[k]} != {c_now[k]}"


def test_apply_form_defaults_no_inheritance():
    """applyFormDefaults writes values and diffs, but establishes no dynamic inheritance."""
    session = get_hoya_session()
    session.rois.clear()
    session.columns.clear()

    roi = session.roi_create(name="pollen", x0=315, x1=800, y0=511, y1=1311)["roi"]
    cols = session.detect_columns(roi_id=roi["id"])
    assert len(cols) >= 2

    # Set form_defaults on the ROI
    form_v1: dict[str, Any] = {
        "plotType": "bar",
        "scaleType": "log",
        "unit": "permille",
        "exaggerationMult": 10.0,
        "startValue": 5.0,
        "step": 25.0,
    }
    session.roi_update(roi_id=roi["id"], form_defaults=form_v1)

    # Apply defaults
    res = session.roi_apply_form_defaults(roi_id=roi["id"])
    assert res["count"] > 0
    assert len(res["changed"]) == res["count"]

    # Verify columns have received the values
    for c in session.columns:
        if c["roi_id"] == roi["id"]:
            assert c["plot_type"] == "bar"
            assert c["scale_type"] == "log"
            assert c["unit"] == "permille"
            assert c["exaggeration_mult"] == 10.0
            assert c["startValue"] == 5.0
            assert c["tickValue"] == 25.0

    # Modify form_defaults to form_v2 WITHOUT calling applyFormDefaults
    form_v2: dict[str, Any] = {
        "plotType": "line",
        "scaleType": "linear",
        "unit": "%",
        "exaggerationMult": None,
        "startValue": 0.0,
        "step": 50.0,
    }
    session.roi_update(roi_id=roi["id"], form_defaults=form_v2)

    # Assert columns STILL have form_v1 values (proves ZERO inheritance)
    for c in session.columns:
        if c["roi_id"] == roi["id"]:
            assert c["plot_type"] == "bar", "Dynamic inheritance occurred! Column value changed with form update"
            assert c["unit"] == "permille"


def test_roi_remove_cascades_columns_only():
    """Removing an ROI cascade-deletes its columns, leaving other ROIs untouched."""
    session = get_hoya_session()
    session.rois.clear()
    session.columns.clear()

    r1 = session.roi_create(name="roi_1", x0=315, x1=500, y0=511, y1=1311)["roi"]
    r2 = session.roi_create(name="roi_2", x0=500, x1=900, y0=511, y1=1311)["roi"]

    session.detect_columns(roi_id=r1["id"])
    session.detect_columns(roi_id=r2["id"])

    r1_cols = [c for c in session.columns if c["roi_id"] == r1["id"]]
    r2_cols = [c for c in session.columns if c["roi_id"] == r2["id"]]
    assert len(r1_cols) > 0
    assert len(r2_cols) > 0

    rem_res = session.roi_remove(r1["id"])
    assert rem_res["success"] is True
    assert len(rem_res["removed_column_ids"]) == len(r1_cols)

    # r1 columns gone
    assert not any(c["roi_id"] == r1["id"] for c in session.columns)
    # r2 columns remain intact
    r2_cols_after = [c for c in session.columns if c["roi_id"] == r2["id"]]
    assert len(r2_cols_after) == len(r2_cols)


def test_depth_calibration_invariant_under_roi_ops():
    """Y axis depth calibration must remain bit-for-bit unchanged across all roi.* calls."""
    session = get_hoya_session()

    # Perform a 2-point Y axis calibration
    session.calibrate_axes(
        y_marks=[
            {"px": 524, "val": 1500},
            {"px": 1327, "val": 4500},
        ],
        unit="cal yr BP",
    )
    assert session.is_calibrated is True
    assert session.depth_calib is not None
    calib_snapshot = copy.deepcopy(session.depth_calib)

    # Perform sequence of roi operations
    ra = session.roi_create(name="test_roi_a", x0=350, x1=550, y0=520, y1=1300)["roi"]
    assert session.depth_calib == calib_snapshot

    rb = session.roi_create(name="test_roi_b", x0=600, x1=900, y0=520, y1=1300)["roi"]
    assert session.depth_calib == calib_snapshot

    session.roi_update(roi_id=ra["id"], x0=360, x1=560)
    assert session.depth_calib == calib_snapshot

    session.roi_set_active(rb["id"])
    assert session.depth_calib == calib_snapshot

    session.roi_set_primary(rb["id"])
    assert session.depth_calib == calib_snapshot

    session.roi_remove(ra["id"])
    assert session.depth_calib == calib_snapshot


def test_columns_stale_is_per_roi():
    """Modifying ROI A's boundaries marks only ROI A stale; ROI B remains unstale."""
    session = get_hoya_session()
    session.rois.clear()

    r_a = session.roi_create(name="roi_a", x0=315, x1=500, y0=511, y1=1311)["roi"]
    r_b = session.roi_create(name="roi_b", x0=500, x1=800, y0=511, y1=1311)["roi"]

    assert r_a["columns_stale"] is False
    assert r_b["columns_stale"] is False

    # Update ROI A's coordinates
    session.roi_update(roi_id=r_a["id"], x0=320, x1=510)

    # Check updated objects
    roi_a_curr = session._get_roi(r_a["id"])
    roi_b_curr = session._get_roi(r_b["id"])

    assert roi_a_curr["columns_stale"] is True, "ROI A must be marked columns_stale"
    assert roi_b_curr["columns_stale"] is False, "ROI B must NOT be infected with columns_stale"


def test_rpc_extension_point_auto_discovery(monkeypatch):
    """Dynamic registration auto-discovers methods from rpc_methods modules without touching rpc_server.py."""
    dispatcher = create_rpc_dispatcher()
    assert "roi.create" in dispatcher._methods
    assert "core.loadImage" in dispatcher._methods

    # Simulate adding a new module in rpc_methods via monkeypatching register_all
    custom_called = False

    class FakeModule:
        @staticmethod
        def register(disp, sess):
            nonlocal custom_called
            disp.register_method("custom.testFeature", lambda: {"ok": True})
            custom_called = True

    import straditize_core.rpc_methods as rpc_pkg

    orig_iter = rpc_pkg.pkgutil.iter_modules

    def fake_iter(path):
        for item in orig_iter(path):
            yield item
        # Yield a synthetic module info
        from collections import namedtuple
        ModInfo = namedtuple("ModInfo", ["module_finder", "name", "ispkg"])
        yield ModInfo(None, "custom_plugin", False)

    monkeypatch.setattr(rpc_pkg.pkgutil, "iter_modules", fake_iter)

    import sys
    monkeypatch.setitem(sys.modules, "straditize_core.rpc_methods.custom_plugin", FakeModule)

    new_disp = JsonRpcDispatcher()
    registered = register_all(new_disp, StraditizeSession())

    assert "custom_plugin" in registered
    assert custom_called is True
    assert "custom.testFeature" in new_disp._methods


def test_l3_hoya_three_rois():
    """L3 real data check: create three ROIs on Hoya and verify column counts."""
    session = get_hoya_session()
    session.rois.clear()
    session.columns.clear()

    # Three realistic ROIs on Hoya:
    # 1) Charcoal / Low-value left zone (x: 315-460)
    # 2) Main Pollen percentages (x: 460-1250)
    # 3) Minor taxa / right zone (x: 1250-1946)
    r1 = session.roi_create(name="charcoal", x0=315, x1=460, y0=511, y1=1311)["roi"]
    r2 = session.roi_create(name="main_pollen", x0=460, x1=1250, y0=511, y1=1311)["roi"]
    r3 = session.roi_create(name="minor_taxa", x0=1250, x1=1946, y0=511, y1=1311)["roi"]

    cols1 = session.detect_columns(roi_id=r1["id"])
    cols2 = session.detect_columns(roi_id=r2["id"])
    cols3 = session.detect_columns(roi_id=r3["id"])

    print(f"\n[L3 Hoya] charcoal cols: {len(cols1)}, main_pollen cols: {len(cols2)}, minor_taxa cols: {len(cols3)}")
    assert len(cols1) > 0
    assert len(cols2) > 0
    assert len(cols3) > 0
    assert len(session.columns) == len(cols1) + len(cols2) + len(cols3)
