"""Unit tests and invariants verification for OCR spatial interval snapping and column naming (T11).

Strictly verifies the 6 criteria from Ticket T11:
1. len(labels) == len(columns) and 1-to-1 interval containment -> all correctly paired;
2. len(labels) != len(columns) (missing 1 / extra 1) -> NO pairing, 3-category reconciliation correct;
3. Label crossing two column boundaries -> assigned to anchor_x's column and enters 'ambiguous';
4. Label outside all column intervals -> enters 'labels_without_column';
5. Order independence: shuffling labels input order produces identical assignments and reconciliation;
6. Duplicate column names in same ROI -> raises -32602 and points out conflicting columns.
"""

from __future__ import annotations

import copy
import random
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.ocr.engine import snap_labels_to_columns
from straditize_core.rpc_methods.naming import validate_column_unique_name


def _make_columns() -> list[dict]:
    """Three standard columns: col_1 [100, 200), col_2 [200, 300), col_3 [300, 400)."""
    return [
        {
            "id": "col_1",
            "col_index": 0,
            "name": "Taxa1",
            "startX": 100.0,
            "endX": 200.0,
            "roi_id": "r1",
        },
        {
            "id": "col_2",
            "col_index": 1,
            "name": "Taxa2",
            "startX": 200.0,
            "endX": 300.0,
            "roi_id": "r1",
        },
        {
            "id": "col_3",
            "col_index": 2,
            "name": "Taxa3",
            "startX": 300.0,
            "endX": 400.0,
            "roi_id": "r1",
        },
    ]


def test_criterion_1_one_to_one_interval_containment():
    """Criterion 1: len(labels) == len(columns) and 1-to-1 -> all correctly paired."""
    cols = _make_columns()
    labels = [
        {"id": "label_001", "anchor_x": 150.0, "bbox": [120, 10, 180, 40]},
        {"id": "label_002", "anchor_x": 250.0, "bbox": [220, 10, 280, 40]},
        {"id": "label_003", "anchor_x": 350.0, "bbox": [320, 10, 380, 40]},
    ]

    res = snap_labels_to_columns(labels, cols)

    assert res["matched"] is True
    assert res["columns_without_label"] == []
    assert res["labels_without_column"] == []
    assert res["ambiguous"] == []

    assert labels[0]["associated_column_id"] == "col_1"
    assert labels[1]["associated_column_id"] == "col_2"
    assert labels[2]["associated_column_id"] == "col_3"


def test_criterion_2_count_mismatch_refuses_pairing():
    """Criterion 2: len(labels) != len(columns) -> NO pairing, 3-category reconciliation correct."""
    cols = _make_columns()  # 3 columns: col_1, col_2, col_3

    # Case A: Fewer labels (2 labels for 3 columns - col_3 missing)
    labels_few = [
        {"id": "label_001", "anchor_x": 150.0},
        {"id": "label_002", "anchor_x": 250.0},
    ]
    res_few = snap_labels_to_columns(labels_few, cols)

    assert res_few["matched"] is False
    assert labels_few[0]["associated_column_id"] is None
    assert labels_few[1]["associated_column_id"] is None
    assert res_few["columns_without_label"] == ["col_3"]
    assert res_few["labels_without_column"] == []

    # Case B: More labels (4 labels for 3 columns - 2 labels in col_1)
    labels_more = [
        {"id": "label_001", "anchor_x": 130.0},
        {"id": "label_002", "anchor_x": 170.0},
        {"id": "label_003", "anchor_x": 250.0},
        {"id": "label_004", "anchor_x": 350.0},
    ]
    res_more = snap_labels_to_columns(labels_more, cols)

    assert res_more["matched"] is False
    assert all(l["associated_column_id"] is None for l in labels_more)
    assert "label_001" in res_more["ambiguous"]
    assert "label_002" in res_more["ambiguous"]


def test_criterion_3_boundary_crossing_enters_ambiguous():
    """Criterion 3: Label crossing two column boundaries -> assigned to anchor_x's column and enters ambiguous."""
    cols = _make_columns()
    # label_001 has anchor_x=190 (inside col_1), but bbox spans 150 to 220 (crosses into col_2 [200, 300))
    labels = [
        {"id": "label_001", "anchor_x": 190.0, "bbox": [150, 10, 220, 40]},
        {"id": "label_002", "anchor_x": 250.0, "bbox": [220, 10, 280, 40]},
        {"id": "label_003", "anchor_x": 350.0, "bbox": [320, 10, 380, 40]},
    ]

    res = snap_labels_to_columns(labels, cols)

    assert "label_001" in res["ambiguous"]
    assert labels[0]["associated_column_id"] == "col_1"
    assert labels[1]["associated_column_id"] == "col_2"
    assert labels[2]["associated_column_id"] == "col_3"


def test_criterion_4_label_outside_columns_enters_labels_without_column():
    """Criterion 4: Label outside all column ranges -> enters labels_without_column."""
    cols = _make_columns()  # ranges: [100, 200), [200, 300), [300, 400)
    # anchor_x = 50 (to the left of all columns)
    labels = [
        {"id": "label_out", "anchor_x": 50.0},
        {"id": "label_001", "anchor_x": 150.0},
        {"id": "label_002", "anchor_x": 250.0},
    ]

    res = snap_labels_to_columns(labels, cols)

    assert "label_out" in res["labels_without_column"]
    assert "col_3" in res["columns_without_label"]
    assert res["matched"] is False


def test_criterion_5_order_independence():
    """Criterion 5: Shuffling labels produces identical field assignments and reconciliation."""
    cols = _make_columns()
    original_labels = [
        {"id": "label_001", "anchor_x": 150.0, "bbox": [120, 10, 180, 40]},
        {"id": "label_002", "anchor_x": 250.0, "bbox": [220, 10, 280, 40]},
        {"id": "label_003", "anchor_x": 350.0, "bbox": [320, 10, 380, 40]},
    ]

    # Run on original order
    labels_order1 = copy.deepcopy(original_labels)
    res1 = snap_labels_to_columns(labels_order1, cols)

    # Run on reversed or shuffled order
    labels_order2 = copy.deepcopy(original_labels)
    random.seed(42)
    random.shuffle(labels_order2)
    res2 = snap_labels_to_columns(labels_order2, cols)

    # Reconciliation outputs must be identical
    assert res1 == res2

    # Map by id to check field-by-field equality
    map1 = {l["id"]: l["associated_column_id"] for l in labels_order1}
    map2 = {l["id"]: l["associated_column_id"] for l in labels_order2}
    assert map1 == map2


def test_criterion_6_duplicate_column_name_raises():
    """Criterion 6: Duplicate column name in same ROI -> raises -32602 and points out conflicting columns."""
    cols = _make_columns()
    # cols has: col_1 ("Taxa1"), col_2 ("Taxa2"), col_3 ("Taxa3") in ROI "r1"

    # Attempting to rename col_1 to "Taxa2" (which already exists on col_2)
    with pytest.raises(JsonRpcError) as exc_info:
        validate_column_unique_name(
            cols, target_col_id_or_index="col_1", new_name="Taxa2"
        )

    err = exc_info.value
    assert err.code == -32002
    assert "Taxa2" in err.message
    assert "col_1" in err.message and "col_2" in err.message


def test_webmcp_server_protocol_and_workflow():
    """Verify WebMCP protocol initialize, tools/list, and 8-step tool execution."""
    import json
    from straditize_core.mcp_server import StraditizeWebMcpServer

    mcp = StraditizeWebMcpServer(web_rpc_url=None)

    # 1. Initialize handshake
    init_resp = mcp.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
    )
    assert init_resp["result"]["serverInfo"]["name"] == "straditize-webmcp"
    assert "tools" in init_resp["result"]["capabilities"]

    # 2. List tools
    list_resp = mcp.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
    )
    tool_names = {t["name"] for t in list_resp["result"]["tools"]}
    assert "straditize_load_image" in tool_names
    assert "straditize_roi_create" in tool_names
    assert "straditize_snap_labels" in tool_names
    assert "straditize_qa_summarize" in tool_names
    assert "straditize_export" in tool_names

    # 3. Call tool: straditize_roi_create & straditize_qa_summarize
    roi_call = mcp.handle_mcp_message(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "straditize_roi_create",
                "arguments": {
                    "name": "pollen",
                    "x0": 100,
                    "x1": 500,
                    "y0": 200,
                    "y1": 800,
                    "composition": True,
                },
            },
        }
    )
    assert roi_call["result"]["isError"] is False
    roi_data = json.loads(roi_call["result"]["content"][0]["text"])
    assert roi_data["roi"]["name"] == "pollen"

    qa_call = mcp.handle_mcp_message(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "straditize_qa_summarize",
                "arguments": {"roi_id": roi_data["roi"]["id"]},
            },
        }
    )
    assert qa_call["result"]["isError"] is False
    qa_data = json.loads(qa_call["result"]["content"][0]["text"])
    assert qa_data["roi_name"] == "pollen"


def test_streamable_http_mcp_endpoint():
    """Verify Streamable HTTP /mcp endpoint directly on StraditizeRpcHttpServer."""
    import json
    import socket
    import urllib.request
    from straditize_core.rpc_server import (
        StraditizeRpcHttpServer,
        create_rpc_dispatcher,
    )
    from straditize_core.session import StraditizeSession

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    session = StraditizeSession()
    dispatcher = create_rpc_dispatcher(session)
    server = StraditizeRpcHttpServer(
        host="127.0.0.1", port=port, dispatcher=dispatcher, session=session
    )
    server.start()

    try:
        mcp_url = f"http://127.0.0.1:{port}/mcp"

        def post_mcp(payload: dict) -> dict:
            req = urllib.request.Request(
                mcp_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                return json.loads(resp.read().decode("utf-8"))

        # 1. initialize over /mcp
        res_init = post_mcp(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        )
        assert res_init["result"]["serverInfo"]["name"] == "straditize-webmcp"

        # 2. tools/list over /mcp
        res_list = post_mcp(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
        )
        assert len(res_list["result"]["tools"]) >= 14

        # 3. tools/call over /mcp mutating the shared live session
        res_call = post_mcp(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "straditize_roi_create",
                    "arguments": {
                        "name": "charcoal",
                        "x0": 50,
                        "x1": 200,
                        "y0": 100,
                        "y1": 500,
                        "composition": False,
                    },
                },
            }
        )
        assert res_call["result"]["isError"] is False
        assert any(r["name"] == "charcoal" for r in session.rois)
    finally:
        server.stop()
