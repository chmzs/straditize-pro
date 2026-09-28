"""Regression tests for the unified Step 4 cleanup mask pipeline."""

from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession


def _session_with_crossed_artifacts() -> tuple[StraditizeSession, str]:
    mask = np.zeros((60, 80), dtype=bool)
    mask[20, 5:75] = True
    mask[5:55, 40] = True

    session = StraditizeSession()
    session.image = Image.fromarray((~mask).astype(np.uint8) * 255)
    session.width, session.height = 80, 60
    session.foreground_mask = mask
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=0, x1=80, y0=0, y1=60)["roi"]
    return session, roi["id"]


def test_auto_and_candidate_masks_are_composed_and_can_be_cleared_independently() -> None:
    """Automatic horizontal removal must not erase a selected candidate mask."""
    session, roi_id = _session_with_crossed_artifacts()
    candidates = session.detect_line_candidates(
        roi_id,
        line_fraction_h=0.7,
        line_fraction_v=0.7,
        line_width_min=1,
        line_width_max=2,
    )["candidates"]
    vertical = next(candidate for candidate in candidates if candidate["axis"] == "v")

    candidate_result = session.apply_line_removal(
        roi_id=roi_id,
        selected_ids=[vertical["id"]],
    )
    assert candidate_result["stats"]["selected_count"] == 1
    assert session.grid_line_mask[10, 40]
    assert not session.grid_line_mask[20, 10]
    encoded = candidate_result["overlay_png"].split(",", 1)[1]
    preview = np.asarray(Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA"))
    assert tuple(preview[20, 10])[:3] == (245, 158, 11)
    assert tuple(preview[10, 40])[:3] == (239, 68, 68)
    assert candidate_result["overlay_legend"]["candidate"] == "#f59e0b"

    auto_result = session.algorithm_degrid(
        strength="medium",
        corrections=[],
        remove_vertical=False,
    )
    assert auto_result["horizontal_rows"]
    assert session.grid_line_mask[20, 10]
    assert session.grid_line_mask[10, 40]

    session.algorithm_degrid(strength="off", corrections=[], remove_vertical=False)
    assert not session.grid_line_mask[20, 10]
    assert session.grid_line_mask[10, 40]


def test_cleanup_geometry_survives_a_diagram_data_refresh() -> None:
    """Geometry must survive ``getDiagramData``.

    Regression: ``getDiagramData`` used to serialize only
    ``lineRemoval: {strength, remove_vertical, corrections}``. The frontend then
    resolved ``data.line_candidates ?? []`` to ``[]`` on every refresh, so all
    geometry silently vanished from the canvas the moment the user entered step 4
    or nudged the ROI.
    """
    from straditize_core.protocol import JsonRpcDispatcher
    from straditize_core.rpc_methods import system as system_methods

    session, roi_id = _session_with_crossed_artifacts()
    candidates = session.detect_line_candidates(
        roi_id,
        line_fraction_h=0.7,
        line_fraction_v=0.7,
        line_width_min=1,
        line_width_max=2,
    )["candidates"]
    assert candidates, "detection produced no candidates to round-trip"

    horizontal = next(c for c in candidates if c["axis"] == "h")
    session.set_line_geometry_status(horizontal["id"], "removed", roi_id=roi_id)

    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    payload = dispatcher._methods["straditize.getDiagramData"]()

    # 1. The flat arrays the canvas overlay reads must be populated.
    assert payload["line_candidates"], "getDiagramData dropped line_candidates"
    assert payload["selected_candidate_ids"], "getDiagramData dropped selected_candidate_ids"
    assert horizontal["id"] in payload["selected_candidate_ids"]

    by_id = {c["id"]: c for c in payload["line_candidates"]}
    serialized = by_id[horizontal["id"]]
    assert serialized["status"] == "removed"
    assert serialized["geometry"]["type"] == "rect"
    # 2. Every geometry must carry a real rect, not a stripped-down stub.
    for candidate in payload["line_candidates"]:
        geometry = candidate["geometry"]
        assert geometry["x1"] > geometry["x0"] or geometry["y1"] > geometry["y0"]

    # 3. The composed mask/stat block must come along too.
    assert payload["cleanup"]["stats"]["removed_count"] >= 1
    assert payload["cleanup"]["legend"]["candidate"] == "#f59e0b"
