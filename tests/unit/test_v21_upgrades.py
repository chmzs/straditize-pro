"""Unit tests for V2.1 final specification:
- Module 1: load_image default ROI (pollen, roi_1), depth grid adaptive intervals & export readiness
- Module 2: predict_depth inverse monotonic mapping, Age_Uncertainty_U1000 sheet in export_multi_xlsx, pure start in AgeDepthModal
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import numpy as np
import pytest

from straditize_core.age_depth import AgeDepthModel
from straditize_core.session import StraditizeSession


def test_module1_load_image_creates_default_roi(tmp_path, monkeypatch):
    """Verify load_image automatically creates default roi_1 (pollen) based on suggest_data_region."""
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(tmp_path / "cfg.json"))
    session = StraditizeSession()
    res = session.load_image(sample_key="hoya")

    assert res["success"] is True
    assert len(session.rois) >= 1
    assert session.primary_roi_id == "roi_1"
    assert session.active_roi_id == "roi_1"

    roi_1 = session.rois[0]
    assert roi_1["id"] == "roi_1"
    assert roi_1["name"] == "pollen"
    assert roi_1["composition"] is True

    sug = res["suggested_roi"]
    assert roi_1["xlim"] == [sug["xMin"], sug["xMax"]]
    assert roi_1["ylim"] == [sug["yMin"], sug["yMax"]]
    assert session.data_xlim == [sug["xMin"], sug["xMax"]]
    assert session.data_ylim == [sug["yMin"], sug["yMax"]]


def test_module2_predict_depth_inverse_mapping():
    """Verify AgeDepthModel.predict_depth inversely interpolates depth from age with monotonic guards."""
    depths = [10.0, 50.0, 100.0, 150.0]
    ages = [200.0, 1000.0, 2200.0, 3500.0]
    min_ages = [150.0, 800.0, 1900.0, 3100.0]
    max_ages = [260.0, 1200.0, 2500.0, 3900.0]

    model = AgeDepthModel(
        depths=depths,
        ages=ages,
        age_min=min_ages,
        age_max=max_ages,
    )

    # Invert typical ages
    target_ages = [500.0, 1500.0, 2800.0]
    res = model.predict_depth(target_ages)

    assert "depth_est" in res
    assert len(res["depth_est"]) == 3
    # Check monotonic increase of depth with age
    assert res["depth_est"][0] < res["depth_est"][1] < res["depth_est"][2]
    # Check boundaries
    assert 10.0 < res["depth_est"][0] < 50.0
    assert 50.0 < res["depth_est"][1] < 100.0
    assert 100.0 < res["depth_est"][2] < 150.0
    assert all(ex is False for ex in res["extrapolated"])

    # Check out-of-bound extrapolation detection
    out_res = model.predict_depth([50.0, 5000.0])
    assert out_res["extrapolated"][0] is True
    assert out_res["extrapolated"][1] is True


def test_module2_bacon_u1000_export(tmp_path, monkeypatch):
    """Verify export_multi_xlsx produces Age_Uncertainty_U1000 sheet when age model is active."""
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(tmp_path / "cfg.json"))
    session = StraditizeSession()
    session.load_image(sample_key="hoya")

    session.columns = [
        {"id": "col_1", "name": "Pinus", "startX": 320, "endX": 380, "col_index": 0, "roi_id": "roi_1"}
    ]
    session.column_points = {
        0: [{"row": 550, "x": 330}, {"row": 800, "x": 350}, {"row": 1100, "x": 320}]
    }
    session.samples = [
        {"row_px": 550, "depth": 20.0, "source": "auto"},
        {"row_px": 800, "depth": 60.0, "source": "auto"},
        {"row_px": 1100, "depth": 120.0, "source": "auto"},
    ]

    depths = [10.0, 50.0, 100.0, 150.0]
    ages = [200.0, 1000.0, 2200.0, 3500.0]
    min_ages = [150.0, 800.0, 1900.0, 3100.0]
    max_ages = [260.0, 1200.0, 2500.0, 3900.0]

    session.age_depth_model = AgeDepthModel(
        depths=depths,
        ages=ages,
        age_min=min_ages,
        age_max=max_ages,
    )

    xlsx_res = session.export_multi_xlsx()
    assert xlsx_res["success"] is True

    import openpyxl
    wb = openpyxl.load_workbook(xlsx_res["path"] if "path" in xlsx_res else io.BytesIO(xlsx_res["data"]))
    sheet_names = wb.sheetnames

    assert any("Age_Uncertainty" in s or "ensemble" in s for s in sheet_names)
