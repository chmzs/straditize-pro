"""Tests for Enhanced WebMCP Server: Visual Slices, Group Calibration, Chronology, and Autopilot."""

from __future__ import annotations

import json
from typing import Any

import pytest

from straditize_core.mcp_server import StraditizeWebMcpServer


@pytest.fixture
def mcp() -> StraditizeWebMcpServer:
    """Provide an in-memory embedded WebMCP server."""
    return StraditizeWebMcpServer(web_rpc_url=None)


def test_mcp_tools_list_complete_catalog(mcp: StraditizeWebMcpServer):
    """Verify that all enhanced and legacy tools are present in tools/list."""
    resp = mcp.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    )
    assert "result" in resp
    tools = resp["result"]["tools"]
    tool_names = {t["name"] for t in tools}

    expected_tools = {
        # Core 8-step workflow
        "straditize_get_status",
        "straditize_load_image",
        "straditize_roi_create",
        "straditize_roi_set_primary",
        "straditize_calibrate_y",
        "straditize_detect_line_candidates",
        "straditize_apply_line_removal",
        "straditize_detect_columns",
        "straditize_rename_column",
        "straditize_snap_labels",
        "straditize_column_update",
        "straditize_calibrate_column",
        "straditize_group_create",
        "straditize_group_update",
        "straditize_group_remove",
        "straditize_calibrate_group",
        "straditize_extract_consensus_horizons",
        "straditize_paste_depths",
        "straditize_qa_summarize",
        "straditize_export_readiness",
        "straditize_export",
        # Multimodal vision feedback slice
        "straditize_get_visual_slice",
        # Chronology / Bacon
        "straditize_agedepth_generate_bacon_script",
        "straditize_agedepth_check_r_env",
        "straditize_agedepth_run_local_bacon",
        "straditize_agedepth_generate_geochronr_script",
        # Autopilot pipeline macro
        "straditize_auto_digitize",
    }
    missing = expected_tools - tool_names
    assert not missing, f"Missing expected WebMCP tools: {missing}"

    # Verify each tool has non-empty description and valid inputSchema
    for tool in tools:
        assert tool["description"]
        assert "inputSchema" in tool
        assert tool["inputSchema"].get("type") == "object"


def test_mcp_visual_slice_tool(mcp: StraditizeWebMcpServer):
    """Test multimodal vision slice extraction tool."""
    # 1. Without image loaded, should return error
    slice_err = mcp.call_tool("straditize_get_visual_slice", {"bbox": [0, 0, 100, 100]})
    assert slice_err["isError"] is True

    # 2. Load built-in sample image
    load_res = mcp.call_tool("straditize_load_image", {"sample_key": "hoya"})
    assert load_res["isError"] is False

    # 3. Request visual slice by explicit bbox
    slice_bbox = mcp.call_tool(
        "straditize_get_visual_slice",
        {"bbox": [50, 50, 200, 200], "max_dim": 300},
    )
    assert slice_bbox["isError"] is False
    data = json.loads(slice_bbox["content"][0]["text"])
    assert data["format"] == "png"
    assert "base64" in data and len(data["base64"]) > 50
    assert data["data_url"].startswith("data:image/png;base64,")
    assert data["bbox"] == [50, 50, 200, 200]
    assert data["width"] == 150
    assert data["height"] == 150

    # 4. Request visual slice with overlay enabled
    slice_overlay = mcp.call_tool(
        "straditize_get_visual_slice",
        {"bbox": [10, 10, 80, 80], "include_overlays": True},
    )
    assert slice_overlay["isError"] is False
    overlay_data = json.loads(slice_overlay["content"][0]["text"])
    assert len(overlay_data["base64"]) > 50


def test_mcp_group_calibration_and_column_update(mcp: StraditizeWebMcpServer):
    """Test modern Step 6 group-level calibration tools."""
    # Load image and create an ROI
    mcp.call_tool("straditize_load_image", {"sample_key": "hoya"})
    roi_call = mcp.call_tool(
        "straditize_roi_create",
        {
            "name": "diatom",
            "x0": 100,
            "x1": 500,
            "y0": 100,
            "y1": 600,
            "composition": True,
        },
    )
    assert roi_call["isError"] is False
    roi_id = json.loads(roi_call["content"][0]["text"])["roi"]["id"]

    # 1. Create a column group
    grp_create = mcp.call_tool(
        "straditize_group_create",
        {
            "roi_id": roi_id,
            "group_name": "exaggerated_pollen",
            "unit": "%",
            "plot_type": "area",
            "exaggeration_mult": 5.0,
        },
    )
    assert grp_create["isError"] is False
    grp_data = json.loads(grp_create["content"][0]["text"])
    group_id = grp_data["group"]["id"]

    # 2. Update group properties
    grp_update = mcp.call_tool(
        "straditize_group_update",
        {
            "roi_id": roi_id,
            "group_id": group_id,
            "updates": {
                "value_per_px": 0.25,
                "axis_stroke_px": 2.0,
            },
        },
    )
    assert grp_update["isError"] is False

    # 3. Calibrate group using convenience tool with px_span & val_span
    calib_grp = mcp.call_tool(
        "straditize_calibrate_group",
        {
            "roi_id": roi_id,
            "group_id": group_id,
            "px_span": 200,
            "val_span": 50,
            "unit": "%",
            "axis_stroke_px": 3.0,
        },
    )
    assert calib_grp["isError"] is False
    res_data = json.loads(calib_grp["content"][0]["text"])
    updated_grp = res_data["group"]
    assert updated_grp["value_per_px"] == pytest.approx(0.25)
    assert updated_grp["axis_stroke_px"] == 3.0


def test_mcp_chronology_tools(mcp: StraditizeWebMcpServer):
    """Test chronology script generation and inspection tools."""
    # 1. Bacon script generation with no dates should fail per architectural invariant
    no_dates_call = mcp.call_tool(
        "straditize_agedepth_generate_bacon_script",
        {"dates": []},
    )
    assert no_dates_call["isError"] is True

    # 2. Bacon script generation with valid dates
    dates = [
        {"depth": 10.0, "age": 1200, "error": 30, "id": "C14_1"},
        {"depth": 50.0, "age": 5500, "error": 45, "id": "C14_2"},
    ]
    valid_bacon = mcp.call_tool(
        "straditize_agedepth_generate_bacon_script",
        {"dates": dates, "core_name": "LakeHoya", "thickness": 2.5},
    )
    assert valid_bacon["isError"] is False
    script_text = json.loads(valid_bacon["content"][0]["text"])
    assert "Bacon(" in script_text or "Bacon" in script_text
    assert "LakeHoya" in script_text

    # 3. Check R environment
    r_env = mcp.call_tool("straditize_agedepth_check_r_env", {})
    assert r_env["isError"] is False
    env_info = json.loads(r_env["content"][0]["text"])
    assert "has_r" in env_info
    assert "has_rbacon" in env_info

    # 4. Generate GeoChronR script
    geochron_res = mcp.call_tool(
        "straditize_agedepth_generate_geochronr_script",
        {"lipd_file_name": "HoyaPollen.lpd", "site_name": "Hoya"},
    )
    assert geochron_res["isError"] is False
    geo_script = json.loads(geochron_res["content"][0]["text"])
    assert "geoChronR" in geo_script or "HoyaPollen.lpd" in geo_script


def test_mcp_autopilot_macro(mcp: StraditizeWebMcpServer):
    """Test end-to-end autopilot macro execution."""
    result = mcp.call_tool(
        "straditize_auto_digitize",
        {
            "sample_key": "hoya",
            "y_marks": [{"px": 100, "val": 0.0}, {"px": 600, "val": 50.0}],
            "roi": {
                "name": "pollen_main",
                "x0": 50,
                "y0": 100,
                "x1": 600,
                "y1": 550,
                "composition": True,
            },
            "group_calib": {
                "value_per_px": 0.2,
                "axis_stroke_px": 2.0,
                "unit": "%",
            },
            "tolerance_px": 3.0,
        },
    )
    assert result["isError"] is False
    data = json.loads(result["content"][0]["text"])
    assert data["status"] == "completed"
    assert "load_image" in data["steps_completed"]
    assert "calibrate_y" in data["steps_completed"]
    assert "create_roi" in data["steps_completed"]
    assert "detect_columns" in data["steps_completed"]
    assert "digitize" in data["steps_completed"]
    assert "qa_summarize" in data["steps_completed"]
    assert "qa_summary" in data
    assert isinstance(data["columns_count"], int)
    assert isinstance(data["horizons_count"], int)
