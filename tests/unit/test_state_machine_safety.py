"""Regression tests for C-group (#156 samples_epoch, #180 draft_epoch)."""

from __future__ import annotations

import pytest

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def test_samples_set_rejects_stale_epoch() -> None:
    """#156: stale expected_epoch must be rejected instead of overwriting newer samples."""
    session = StraditizeSession()
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    session.depth_calib = {
        "top_px": 0.0,
        "top_cm": 0.0,
        "bottom_px": 100.0,
        "bottom_cm": 100.0,
        "unit": "cm",
    }

    res1 = session.samples_set([{"row_px": 10, "depth": 10.0, "source": "manual"}])
    stale_epoch = res1["samples_epoch"]

    res2 = session.samples_from_depth_grid(step=20.0)
    assert res2["count"] == 6
    assert res2["samples_epoch"] > stale_epoch

    with pytest.raises(JsonRpcError) as exc_info:
        session.samples_set(
            [{"row_px": 10, "depth": 10.0, "source": "manual", "locked": True}],
            expected_epoch=stale_epoch,
        )
    assert exc_info.value.code == STATE_ERROR
    assert len(session.samples_list()["samples"]) == 6


def test_project_load_skips_stale_draft_epoch() -> None:
    """#180: project.load with draft_epoch < session_epoch must not roll back backend."""
    session = StraditizeSession()
    session.columns = [{"id": "col_1", "name": "NEW_NAME", "species": "NEW_NAME"}]
    session.session_epoch = 2

    res = session.project_load(
        {
            "schema_version": "2.0",
            "draft_epoch": 1,
            "columns": [{"id": "col_1", "name": "OLD_NAME", "species": "OLD_NAME"}],
        }
    )
    assert res["success"] is True
    assert res["stale_draft_skipped"] is True
    assert session.columns[0]["name"] == "NEW_NAME"
