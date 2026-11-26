"""Regression tests for B-group: single row-value exit (#157, #186, #150, #175)."""

from __future__ import annotations

import io
import pandas as pd
import pytest

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def _calibrated_session_with_points() -> StraditizeSession:
    session = StraditizeSession()
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    session.depth_calib = {"top_px": 0.0, "top_cm": 0.0, "bottom_px": 20.0, "bottom_cm": 20.0}
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "xlim": [0, 300],
            "ylim": [0, 20],
            "x_groups": [
                {
                    "id": "roi_1_grp1",
                    "name": "组 1",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    "exaggeration_mult": None,
                }
            ],
            "default_group_id": "roi_1_grp1",
        }
    ]
    session.active_roi_id = "roi_1"
    session.primary_roi_id = "roi_1"
    session.columns = [
        {
            "id": "col_1",
            "col_index": 0,
            "name": "Pinus",
            "roi_id": "roi_1",
            "x_group_id": "roi_1_grp1",
            "start": 0.0,
            "end": 100.0,
            "axis_stroke_px": 0.0,
            "x_ticks": [{"px": 0.0, "val": 0.0}, {"px": 100.0, "val": 100.0}],
        },
        {
            "id": "col_2",
            "col_index": 1,
            "name": "Betula",
            "roi_id": "roi_1",
            "x_group_id": "roi_1_grp1",
            "start": 100.0,
            "end": 200.0,
            "axis_stroke_px": 0.0,
            "x_ticks": [{"px": 100.0, "val": 0.0}, {"px": 200.0, "val": 100.0}],
        },
    ]
    session.control_points = {
        0: {0: 60.0, 20: 80.0},
        1: {0: 150.0, 20: 170.0},
    }
    session.control_point_columns = {0, 1}
    session.column_points = {
        0: [{"row": 0, "x": 60.0}, {"row": 20, "x": 80.0}],
        1: [{"row": 0, "x": 150.0}, {"row": 20, "x": 170.0}],
    }
    session.samples = [
        {"horizon_id": "H1", "row_px": 0, "depth": 0.0},
        {"horizon_id": "H2", "row_px": 10, "depth": 10.0},
        {"horizon_id": "H3", "row_px": 20, "depth": 20.0},
    ]
    return session


def test_all_five_export_channels_enforce_no_data_gate() -> None:
    """#186: when export.csv raises -32001, XLSX/tar/LiPD/R must also raise -32001."""
    session = StraditizeSession()
    session.columns = [
        {
            "id": "col_1",
            "col_index": 0,
            "name": "col01",
            "roi_id": "roi_1",
            "start": 0.0,
            "end": 100.0,
            "x_ticks": None,
        }
    ]

    for fn in (
        session.export_csv,
        session.export_multi_xlsx,
        session.export_multi_tar,
        session.export_multi_lipd,
        session.export_r,
    ):
        with pytest.raises(JsonRpcError) as exc_info:
            fn()
        assert exc_info.value.code == STATE_ERROR


def test_qa_matches_export_with_interpolated_control_points() -> None:
    """#157: qa.summarize row sums must match export.csv row sums (< 0.5pp)."""
    session = _calibrated_session_with_points()
    csv_text = session.export_csv()
    df = pd.read_csv(io.StringIO(csv_text))
    export_sums = (df["Pinus"] + df["Betula"]).tolist()

    qa = session.qa_summarize(tolerance=2.0)
    assert qa["n_horizons"] == len(export_sums) == 3
    assert len(qa["violations_over"]) == len([s for s in export_sums if s > 102.0])
    assert abs(qa["sum"]["p50"] - round(float(pd.Series(export_sums).median()), 1)) < 0.5


def test_group_exaggeration_scales_without_redigitize() -> None:
    """#150/#175: changing group exaggeration_mult scales readings cleanly and is reversible."""
    session = _calibrated_session_with_points()
    df1 = pd.read_csv(io.StringIO(session.export_csv()))
    peak1 = float(df1["Pinus"].max())

    session.roi_group_update("roi_1", "roi_1_grp1", {"exaggeration_mult": 5})
    df5 = pd.read_csv(io.StringIO(session.export_csv()))
    peak5 = float(df5["Pinus"].max())
    assert abs(peak1 / 5.0 - peak5) < 1e-3

    session.roi_group_update("roi_1", "roi_1_grp1", {"exaggeration_mult": 10})
    df10 = pd.read_csv(io.StringIO(session.export_csv()))
    peak10 = float(df10["Pinus"].max())
    assert abs(peak1 / 10.0 - peak10) < 1e-3

    session.roi_group_update("roi_1", "roi_1_grp1", {"exaggeration_mult": 5})
    df5_back = pd.read_csv(io.StringIO(session.export_csv()))
    assert df5_back["Pinus"].tolist() == df5["Pinus"].tolist()
