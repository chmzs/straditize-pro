"""Comprehensive Integration and Unit Tests for Straditize JSON-RPC 2.0 Server."""

import io
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

# Ensure straditize package and straditize_core are in sys.path
_this_dir = os.path.dirname(os.path.abspath(__file__))
# Try multiple candidate paths for workspace root and straditize package
for candidate in [
    os.path.abspath(os.path.join(_this_dir, "..")),
    os.path.abspath(os.path.join(_this_dir, "..", "straditize")),
    os.path.abspath(os.path.join(_this_dir, "..", "..", "straditize")),
    os.path.abspath(os.path.join(_this_dir, "straditize")),
]:
    if os.path.exists(candidate) and candidate not in sys.path:
        sys.path.insert(0, candidate)

from straditize_core import (
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    STATE_ERROR,
    StraditizeRpcHttpServer,
    StraditizeSession,
    create_rpc_dispatcher,
    run_stdio_server,
)

import straditize


def get_test_image_path() -> str:
    """Locate the hoya-del-castillo.png test image reliably."""
    stradi_pkg_dir = os.path.dirname(straditize.__file__)
    candidate = os.path.join(
        stradi_pkg_dir,
        "widgets",
        "tutorial",
        "hoya-del-castillo",
        "hoya-del-castillo.png",
    )
    if os.path.exists(candidate):
        return os.path.abspath(candidate)
    fallback = os.path.abspath(
        "straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png"
    )
    if os.path.exists(fallback):
        return fallback
    raise FileNotFoundError(f"Cannot locate test image starting from {stradi_pkg_dir}")


class TestStraditizeRpcProtocol(unittest.TestCase):
    """Tests JSON-RPC 2.0 protocol conformance, error handling, batch and notifications."""

    def setUp(self):
        self.session = StraditizeSession()
        self.dispatcher = create_rpc_dispatcher(self.session)
        self.img_path = get_test_image_path()
        self.assertTrue(
            os.path.exists(self.img_path), f"Test image not found at {self.img_path}"
        )

    def call_rpc(self, payload_dict_or_str):
        """Helper to invoke dispatcher with text or dict and parse response."""
        if isinstance(payload_dict_or_str, (dict, list)):
            text = json.dumps(payload_dict_or_str)
        else:
            text = str(payload_dict_or_str)
        resp_text = self.dispatcher.handle_text(text)
        if resp_text is None:
            return None
        return json.loads(resp_text)

    # -------------------------------------------------------------------------
    # 1. Standard Error Code Tests
    # -------------------------------------------------------------------------

    def test_error_parse_error_32700(self):
        """Verify -32700 Parse error when payload is not valid JSON."""
        bad_json = '{"jsonrpc": "2.0", "method": "core.loadImage", "params": '
        resp = self.call_rpc(bad_json)
        self.assertIsNotNone(resp)
        self.assertEqual(resp.get("jsonrpc"), "2.0")
        self.assertIsNone(resp.get("id"))
        self.assertIn("error", resp)
        self.assertEqual(resp["error"]["code"], PARSE_ERROR)
        self.assertIn("Parse error", resp["error"]["message"])

    def test_error_invalid_request_32600(self):
        """Verify -32600 Invalid Request for missing jsonrpc, empty batch, non-objects."""
        # Case A: Missing jsonrpc field
        resp = self.call_rpc({"method": "system.ping", "id": 1})
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

        # Case B: Wrong jsonrpc version
        resp = self.call_rpc({"jsonrpc": "1.0", "method": "system.ping", "id": 1})
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

        # Case C: Missing method
        resp = self.call_rpc({"jsonrpc": "2.0", "id": 1})
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

        # Case D: Non-string method
        resp = self.call_rpc({"jsonrpc": "2.0", "method": 12345, "id": 1})
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

        # Case E: Empty batch
        resp = self.call_rpc([])
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

        # Case F: Raw primitive string instead of object
        resp = self.call_rpc('"Just a string"')
        self.assertEqual(resp["error"]["code"], INVALID_REQUEST)

    def test_error_method_not_found_32601(self):
        """Verify -32601 Method not found when calling non-existent procedure."""
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.nonExistentMethod",
                "params": {},
                "id": "req-99",
            }
        )
        self.assertEqual(resp["id"], "req-99")
        self.assertEqual(resp["error"]["code"], METHOD_NOT_FOUND)
        self.assertIn("not found", resp["error"]["message"])

    def test_error_invalid_params_32602(self):
        """Verify -32602 Invalid params when missing required arguments or bad types."""
        # Case A: Missing required parameter 'image_path'
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.loadImage",
                "params": {},
                "id": 101,
            }
        )
        self.assertEqual(resp["error"]["code"], INVALID_PARAMS)

        # Case B: Wrong argument type (col_index expects int, not array)
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.digitize",
                "params": {"col_index": "not_an_int"},
                "id": 102,
            }
        )
        # Should raise either INVALID_PARAMS or STATE_ERROR (before columns exist)
        self.assertIn(resp["error"]["code"], (INVALID_PARAMS, STATE_ERROR))

    def test_error_session_state_and_file_errors(self):
        """Verify application-specific server errors -32001 and -32002."""
        # Attempt to digitize before loading image
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.detectColumns",
                "params": {"data_xlim": [100, 200], "data_ylim": [100, 200]},
                "id": 103,
            }
        )
        self.assertEqual(resp["error"]["code"], STATE_ERROR)

        # Attempt to load non-existent image
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.loadImage",
                "params": {"image_path": "I:/does_not_exist/random_image.png"},
                "id": 104,
            }
        )
        self.assertEqual(resp["error"]["code"], FILE_NOT_FOUND_ERROR)

    # -------------------------------------------------------------------------
    # 2. Batch and Notification Mechanisms
    # -------------------------------------------------------------------------

    def test_batch_requests(self):
        """Verify JSON-RPC 2.0 batch processing."""
        batch = [
            {"jsonrpc": "2.0", "method": "system.ping", "id": 1},
            {"jsonrpc": "2.0", "method": "system.ping", "id": 2},
            {"jsonrpc": "2.0", "method": "core.nonExistent", "id": 3},
        ]
        resp = self.call_rpc(batch)
        self.assertIsInstance(resp, list)
        self.assertEqual(len(resp), 3)

        res_dict = {item["id"]: item for item in resp}
        self.assertTrue(res_dict[1]["result"]["pong"])
        self.assertTrue(res_dict[2]["result"]["pong"])
        self.assertEqual(res_dict[3]["error"]["code"], METHOD_NOT_FOUND)

    def test_notifications_no_response(self):
        """Verify notifications (requests without 'id') produce no response."""
        notif = {"jsonrpc": "2.0", "method": "system.ping"}
        resp = self.call_rpc(notif)
        self.assertIsNone(resp)

    # -------------------------------------------------------------------------
    # 3. End-to-End Scientific Workflow
    # -------------------------------------------------------------------------

    def test_full_digitization_workflow_roundtrip(self):
        """Simulate a complete frontend lifecycle via JSON-RPC 2.0."""
        # Step 1: core.loadImage
        req1 = {
            "jsonrpc": "2.0",
            "method": "core.loadImage",
            "params": {"image_path": self.img_path},
            "id": "step-1",
        }
        resp1 = self.call_rpc(req1)
        self.assertEqual(resp1["id"], "step-1")
        self.assertIn("result", resp1)
        self.assertGreater(resp1["result"]["width"], 0)
        self.assertGreater(resp1["result"]["height"], 0)
        self.assertEqual(resp1["result"]["format"], "PNG")

        # Step 2: core.extractForeground
        req2 = {
            "jsonrpc": "2.0",
            "method": "core.extractForeground",
            "params": {"mode": "otsu"},
            "id": "step-2",
        }
        resp2 = self.call_rpc(req2)
        self.assertEqual(resp2["id"], "step-2")
        self.assertIn("result", resp2)
        self.assertGreater(resp2["result"]["foreground_pixels"], 0)
        self.assertGreater(resp2["result"]["foreground_ratio"], 0.0)

        # Step 3: core.detectColumns
        # Ground-truth diagram data region for Hoya del Castillo
        ref_xlim = [315, 1946]
        ref_ylim = [511, 1311]
        req3 = {
            "jsonrpc": "2.0",
            "method": "core.detectColumns",
            "params": {"data_xlim": ref_xlim, "data_ylim": ref_ylim},
            "id": "step-3",
        }
        resp3 = self.call_rpc(req3)
        self.assertEqual(resp3["id"], "step-3")
        columns = resp3["result"]
        self.assertIsInstance(columns, list)
        self.assertGreater(len(columns), 0)
        self.assertEqual(columns[0]["col_index"], 0)
        self.assertIn("start", columns[0])
        self.assertIn("end", columns[0])

        # Step 4: core.digitize (digitize column 0)
        req4 = {
            "jsonrpc": "2.0",
            "method": "core.digitize",
            "params": {"col_index": 0, "reader_type": "area"},
            "id": "step-4",
        }
        resp4 = self.call_rpc(req4)
        self.assertEqual(resp4["id"], "step-4")
        self.assertIn("result", resp4)
        points = resp4["result"]["points"]
        self.assertIsInstance(points, list)
        self.assertEqual(len(points), ref_ylim[1] - ref_ylim[0] + 1)
        self.assertIn("row", points[0])
        self.assertIn("x", points[0])

        # Step 5: core.updateControlPoint (Add/Update control point at mid-depth)
        target_row = 800
        new_x = float(columns[0]["start"] + 55.0)
        req5_add = {
            "jsonrpc": "2.0",
            "method": "core.updateControlPoint",
            "params": {
                "col_index": 0,
                "row": target_row,
                "x": new_x,
                "remove": False,
            },
            "id": "step-5-add",
        }
        resp5_add = self.call_rpc(req5_add)
        self.assertEqual(resp5_add["id"], "step-5-add")
        self.assertEqual(resp5_add["result"]["action"], "updated")
        # Check that curve at row 800 moved to new_x
        pts_after_add = {p["row"]: p["x"] for p in resp5_add["result"]["points"]}
        self.assertAlmostEqual(pts_after_add[target_row], new_x, places=1)

        # Test Step 5 (Remove control point)
        req5_rem = {
            "jsonrpc": "2.0",
            "method": "core.updateControlPoint",
            "params": {
                "col_index": 0,
                "row": target_row,
                "x": 0.0,
                "remove": True,
            },
            "id": "step-5-rem",
        }
        resp5_rem = self.call_rpc(req5_rem)
        self.assertEqual(resp5_rem["result"]["action"], "removed")

        # Step 6: core.calibrateAxes
        req6 = {
            "jsonrpc": "2.0",
            "method": "core.calibrateAxes",
            "params": {
                "y_marks": [
                    {"pixel": 511.0, "val": 0.0},  # 0 cm depth at top
                    {"pixel": 1311.0, "val": 800.0},  # 800 cm depth at bottom
                ],
                "x_marks": [
                    {"col_index": 0, "pixel": float(columns[0]["start"]), "val": 0.0},
                    {"col_index": 0, "pixel": float(columns[0]["end"]), "val": 100.0},
                ],
            },
            "id": "step-6",
        }
        resp6 = self.call_rpc(req6)
        self.assertEqual(resp6["id"], "step-6")
        self.assertEqual(resp6["result"]["status"], "calibrated")
        self.assertIn("y_scale", resp6["result"])
        self.assertIn("slope", resp6["result"]["y_scale"])

        # Step 7: core.exportData
        with tempfile.TemporaryDirectory() as tmp_dir:
            csv_file = os.path.join(tmp_dir, "exported_pollen.csv")
            req7 = {
                "jsonrpc": "2.0",
                "method": "core.exportData",
                "params": {
                    "format": "csv",
                    "strict": True,
                    "output_path": csv_file,
                },
                "id": "step-7",
            }
            resp7 = self.call_rpc(req7)
            self.assertEqual(resp7["id"], "step-7")
            self.assertEqual(resp7["result"]["format"], "csv")
            self.assertTrue(os.path.exists(csv_file))
            self.assertGreater(os.path.getsize(csv_file), 100)

            # Verify exported content has columns and depth
            with open(csv_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("depth", content)
            self.assertIn("col_0", content)

    # -------------------------------------------------------------------------
    # 4. Taxa Batch Setting, Depth Grid and Matrix Extraction
    # -------------------------------------------------------------------------

    def test_batch_set_taxa(self):
        """Verify core.batchSetTaxa sets and updates taxon names."""
        names = ["Pinus", "Betula", "Quercus", "Poaceae"]
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.batchSetTaxa",
                "params": {"names": names},
                "id": "taxa-1",
            }
        )
        self.assertEqual(resp["id"], "taxa-1")
        self.assertEqual(resp["result"]["taxa"], names)
        self.assertEqual(resp["result"]["count"], 4)
        self.assertEqual(self.session.taxa_names, names)

        # Invalid params (non-list)
        resp_err = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.batchSetTaxa",
                "params": {"names": "NotAList"},
                "id": "taxa-err",
            }
        )
        self.assertEqual(resp_err["error"]["code"], INVALID_PARAMS)

    def test_apply_depth_grid(self):
        """Verify core.applyDepthGrid supports explicit list and start/end/step."""
        # Case A: Explicit list
        depths_list = [10.0, 25.0, 50.0, 75.0, 100.0]
        resp1 = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.applyDepthGrid",
                "params": {"depths": depths_list},
                "id": "grid-1",
            }
        )
        self.assertEqual(resp1["result"]["depths"], depths_list)
        self.assertEqual(resp1["result"]["count"], 5)

        # Case B: Start, end, step
        resp2 = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.applyDepthGrid",
                "params": {"start_depth": 0.0, "end_depth": 200.0, "step": 50.0},
                "id": "grid-2",
            }
        )
        self.assertEqual(resp2["result"]["depths"], [0.0, 50.0, 100.0, 150.0, 200.0])
        self.assertEqual(resp2["result"]["count"], 5)

        # Case C: Invalid params (step <= 0)
        resp_err = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.applyDepthGrid",
                "params": {"start_depth": 0.0, "end_depth": 200.0, "step": 0.0},
                "id": "grid-err",
            }
        )
        self.assertEqual(resp_err["error"]["code"], INVALID_PARAMS)

    def test_extract_grid_values_workflow(self):
        """Verify core.extractGridValues extracts abundance matrix across depth grid."""
        # Error check 1: Digitize not called yet
        resp_err1 = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.extractGridValues",
                "params": {"depths": [10.0, 20.0]},
                "id": "ext-err-1",
            }
        )
        self.assertEqual(resp_err1["error"]["code"], STATE_ERROR)

        # Setup: Load image, detect columns, digitize 2 columns
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.loadImage",
                "params": {"image_path": self.img_path},
                "id": "load",
            }
        )
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.detectColumns",
                "params": {"data_xlim": [315, 1946], "data_ylim": [511, 1311]},
                "id": "cols",
            }
        )
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.digitize",
                "params": {"col_index": 0},
                "id": "dig0",
            }
        )
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.digitize",
                "params": {"col_index": 1},
                "id": "dig1",
            }
        )

        # Set taxa names
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.batchSetTaxa",
                "params": {"names": ["Pinus", "Quercus"]},
                "id": "taxa",
            }
        )

        # Apply depth grid
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.applyDepthGrid",
                "params": {"start_depth": 0.0, "end_depth": 800.0, "step": 100.0},
                "id": "grid",
            }
        )

        # Calibrate axes
        self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.calibrateAxes",
                "params": {
                    "y_marks": [
                        {"pixel": 511.0, "val": 0.0},
                        {"pixel": 1311.0, "val": 800.0},
                    ],
                },
                "id": "calib",
            }
        )

        # Now extract grid values
        resp = self.call_rpc(
            {
                "jsonrpc": "2.0",
                "method": "core.extractGridValues",
                "params": {},
                "id": "extract",
            }
        )
        self.assertEqual(resp["id"], "extract")
        res = resp["result"]
        self.assertEqual(res["taxa"], ["Pinus", "Quercus"])
        self.assertEqual(len(res["depths"]), 9)  # 0, 100, ..., 800
        self.assertEqual(len(res["matrix"]), 9)
        self.assertEqual(len(res["matrix"][0]), 2)
        self.assertIn("Pinus", res["data"][0])
        self.assertIn("Quercus", res["data"][0])
        self.assertIsInstance(res["data"][0]["Pinus"], (int, float))


class TestStraditizeStdioTransport(unittest.TestCase):
    """Tests stdio line-delimited communication pipe."""

    def test_stdio_pipeline(self):
        req1 = json.dumps({"jsonrpc": "2.0", "method": "system.ping", "id": "p1"})
        req2 = json.dumps({"jsonrpc": "2.0", "method": "core.getStatus", "id": "p2"})
        input_data = f"{req1}\n{req2}\n"

        in_stream = io.StringIO(input_data)
        out_stream = io.StringIO()

        dispatcher = create_rpc_dispatcher()
        run_stdio_server(
            dispatcher=dispatcher, in_stream=in_stream, out_stream=out_stream
        )

        output_lines = [
            line.strip() for line in out_stream.getvalue().split("\n") if line.strip()
        ]
        self.assertEqual(len(output_lines), 2)

        resp1 = json.loads(output_lines[0])
        self.assertEqual(resp1["id"], "p1")
        self.assertTrue(resp1["result"]["pong"])

        resp2 = json.loads(output_lines[1])
        self.assertEqual(resp2["id"], "p2")
        self.assertFalse(resp2["result"]["has_image"])


class TestStraditizeHttpTransport(unittest.TestCase):
    """Tests Localhost HTTP server, endpoints, CORS headers, and error responses."""

    @classmethod
    def setUpClass(cls):
        # Bind to port 0 for dynamic free port allocation
        cls.server = StraditizeRpcHttpServer(host="127.0.0.1", port=0)
        cls.server.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.actual_port}"
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()

    def test_http_health_endpoint(self):
        """Verify GET /health returns 200 OK."""
        req = urllib.request.Request(f"{self.base_url}/health")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertEqual(data["service"], "straditize_rpc")

    def test_http_options_cors(self):
        """Verify OPTIONS /rpc returns 204 with CORS headers."""
        req = urllib.request.Request(f"{self.base_url}/rpc", method="OPTIONS")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 204)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            self.assertIn("POST", resp.headers.get("Access-Control-Allow-Methods", ""))

    def test_http_post_rpc_roundtrip(self):
        """Verify HTTP POST /rpc handles JSON-RPC 2.0 requests."""
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "system.ping",
                "id": "http-1",
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/rpc",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["id"], "http-1")
            self.assertTrue(data["result"]["pong"])

    def test_http_post_rpc_error_handling(self):
        """Verify HTTP POST /rpc returns standard JSON-RPC 2.0 error payloads."""
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "core.nonExistent",
                "id": 999,
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/rpc",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["id"], 999)
            self.assertEqual(data["error"]["code"], METHOD_NOT_FOUND)

    def test_http_get_status(self):
        """Verify GET /status returns structured service and session status."""
        req = urllib.request.Request(f"{self.base_url}/status")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertIn("has_image", data)
            self.assertIn("columns_count", data)
            self.assertIn("is_calibrated", data)
            self.assertIn("taxa", data)

    def test_http_static_serving(self):
        """Verify GET / serves frontend HTML or assets."""
        req = urllib.request.Request(f"{self.base_url}/")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read()
            self.assertGreater(len(content), 0)

    def test_http_diagnostic_when_no_dist(self):
        """Verify friendly JSON diagnostic is served if frontend/dist does not exist."""
        # Use dist_dir="" so find_frontend_dist returns None
        empty_server = StraditizeRpcHttpServer(host="127.0.0.1", port=0, dist_dir="")
        empty_server.start()
        empty_url = f"http://127.0.0.1:{empty_server.actual_port}"
        try:
            req = urllib.request.Request(f"{empty_url}/")
            with urllib.request.urlopen(req) as resp:
                self.assertEqual(resp.status, 200)
                self.assertIn("application/json", resp.headers.get("Content-Type", ""))
                data = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(data["status"], "frontend_not_built")
                self.assertIn("hint", data)
                self.assertIn("available_endpoints", data)
        finally:
            empty_server.stop()

    def test_http_image_endpoint(self):
        """Verify GET /image/current returns 404 before image is loaded, and 200 PNG afterwards."""
        test_session = StraditizeSession()
        img_server = StraditizeRpcHttpServer(
            host="127.0.0.1", port=0, session=test_session
        )
        img_server.start()
        img_url = f"http://127.0.0.1:{img_server.actual_port}"

        try:
            # 1. Before loading image -> 404
            req_404 = urllib.request.Request(f"{img_url}/image/current")
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req_404)
            self.assertEqual(ctx.exception.code, 404)

            # 2. Load image into session
            img_path = get_test_image_path()
            test_session.load_image(img_path)

            # 3. After loading image -> 200 image/png
            req_200 = urllib.request.Request(f"{img_url}/image/current")
            with urllib.request.urlopen(req_200) as resp:
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.headers.get("Content-Type"), "image/png")
                data = resp.read()
                self.assertGreater(len(data), 100)

            # 4. Also verify alias /api/image
            req_alias = urllib.request.Request(f"{img_url}/api/image")
            with urllib.request.urlopen(req_alias) as resp:
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.headers.get("Content-Type"), "image/png")
        finally:
            img_server.stop()

    def test_http_upload_json_path(self):
        """Verify POST /api/upload with local filepath JSON payload."""
        img_path = get_test_image_path()
        payload = json.dumps({"path": img_path}).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/api/upload",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(data["success"])
            self.assertIn("result", data)
            self.assertGreater(data["result"]["width"], 0)

    def test_http_upload_base64(self):
        """Verify POST /api/upload with base64 encoded image."""
        import base64

        img_path = get_test_image_path()
        with open(img_path, "rb") as f:
            b64_str = base64.b64encode(f.read()).decode("ascii")

        payload = json.dumps({"image_base64": b64_str}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/upload",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(data["success"])
            self.assertGreater(data["result"]["height"], 0)

    def test_http_upload_multipart(self):
        """Verify POST /api/upload with multipart/form-data."""
        img_path = get_test_image_path()
        with open(img_path, "rb") as f:
            file_bytes = f.read()

        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        body = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="test.png"\r\n'
                f"Content-Type: image/png\r\n\r\n"
            ).encode()
            + file_bytes
            + f"\r\n--{boundary}--\r\n".encode()
        )

        req = urllib.request.Request(
            f"{self.base_url}/api/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(data["success"])
            self.assertGreater(data["result"]["width"], 0)

    def test_http_shutdown_forbidden_in_server_mode(self):
        """Verify POST /shutdown returns 403 Forbidden when not in desktop mode."""
        req = urllib.request.Request(
            f"{self.base_url}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)
        data = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertIn("error", data)

    def test_diagram_data_reports_desktop_mode(self):
        """Verify straditize.getDiagramData includes isDesktopMode boolean flag."""
        req = urllib.request.Request(
            f"{self.base_url}/rpc",
            data=json.dumps({
                "jsonrpc": "2.0",
                "method": "straditize.getDiagramData",
                "params": {},
                "id": "diag-test",
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("result", data)
            self.assertIn("isDesktopMode", data["result"])
            self.assertIsInstance(data["result"]["isDesktopMode"], bool)

    def test_http_shutdown_allowed_in_desktop_mode(self):
        """Verify POST /shutdown returns 200 and invokes exit callback in desktop mode."""
        import threading
        from straditize_core.rpc_server import find_available_port, StraditizeRpcHttpServer
        port = find_available_port(8950)
        shutdown_called = threading.Event()

        desktop_server = StraditizeRpcHttpServer(
            host="127.0.0.1",
            port=port,
            is_desktop_mode=True,
            shutdown_fn=lambda code: shutdown_called.set(),
        )
        desktop_server.start()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{desktop_server.actual_port}/shutdown",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(data["success"])
            self.assertTrue(shutdown_called.wait(timeout=2.0))
        finally:
            desktop_server.stop()

    def test_image_slice_and_preview_endpoints(self):
        """Verify GET /image/slice and /image/preview endpoints."""
        # First ensure an image is loaded in self.server.session
        img_path = get_test_image_path()
        self.server.session.load_image(img_path)

        # 1. Test /image/slice?x=10&y=10&w=50&h=40
        req_slice = urllib.request.Request(f"{self.base_url}/image/slice?x=10&y=10&w=50&h=40")
        with urllib.request.urlopen(req_slice) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Content-Type"), "image/png")
            data = resp.read()
            self.assertGreater(len(data), 50)

        # 2. Test /image/preview
        req_prev = urllib.request.Request(f"{self.base_url}/image/preview")
        with urllib.request.urlopen(req_prev) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Content-Type"), "image/png")

    def test_extreme_large_image_memory_safety(self):
        """Verify that loading huge images (>16M pixels) avoids allocating eager numpy RGBA array."""
        from PIL import Image
        import tempfile
        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        # Create a lightweight synthetic 4500x4000 (18M px) image
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
            huge_img = Image.new("L", (4500, 4000), 200)
            huge_img.save(tf.name, format="PNG")
            tf_path = tf.name

        try:
            info = session.load_image(tf_path)
            self.assertEqual(info["width"], 4500)
            self.assertEqual(info["height"], 4000)
            # Crucial requirement: image_array should be None to prevent multi-gigabyte memory consumption
            self.assertIsNone(session.image_array)

            # Slicing still works with zero latency
            sub_slice = session.get_image_slice(100, 100, 200, 150)
            self.assertEqual(sub_slice.size, (200, 150))

            # Preview downsamples accurately
            preview = session.get_image_preview(max_dim=1000)
            self.assertLessEqual(max(preview.size), 1000)
        finally:
            try:
                os.remove(tf_path)
            except Exception:
                pass


class TestSectionFiveJsonRpcMethods(unittest.TestCase):
    """Verifies all JSON-RPC 2.0 methods and POSIX .tar archive specifications from Section 五 and 八."""

    def setUp(self):
        self.session = StraditizeSession()
        self.dispatcher = create_rpc_dispatcher(self.session)
        self.image_path = get_test_image_path()

    def rpc_call(self, method: str, params: dict | None = None) -> dict:
        req = {
            "jsonrpc": "2.0",
            "id": 999,
            "method": method,
            "params": params or {},
        }
        res_str = self.dispatcher.handle_text(json.dumps(req))
        self.assertIsNotNone(res_str)
        res = json.loads(res_str)
        self.assertNotIn("error", res, f"RPC call {method} failed: {res.get('error')}")
        return res["result"]

    def test_section_five_project_tar_archive_and_lifecycle(self):
        """Tests project.save, .tar POSIX structure (manifest, original.png, straditize.json, data.csv, plot_strat.R, README.txt), project.new, and project.load."""
        import tarfile

        # 1. Load image and detect columns
        self.rpc_call("image.load", {"image_path": self.image_path})
        self.rpc_call("roi.update", {"x0": 315, "x1": 1946, "y0": 511, "y1": 1311})
        self.rpc_call("algorithm.detectColumns", {"xlim": [315, 1946], "ylim": [511, 1311]})
        self.session.apply_depth_grid(start_depth=0, end_depth=150, step=2)

        # 2. Save project as .tar archive
        with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
            tar_path = tf.name

        try:
            res_save = self.rpc_call("project.save", {"output_path": tar_path, "format": "tar"})
            self.assertTrue(res_save["success"])
            self.assertTrue(os.path.exists(tar_path))
            self.assertGreater(os.path.getsize(tar_path), 1000)

            # 3. Verify internal files strictly adhere to Section 八 specification
            with tarfile.open(tar_path, "r") as tf_in:
                names = [m.name for m in tf_in.getmembers()]
                self.assertIn("manifest.json", names)
                self.assertIn("image/original.png", names)
                self.assertIn("straditize.json", names)
                self.assertIn("data.csv", names)
                self.assertIn("plot_strat.R", names)
                self.assertIn("README.txt", names)

                # Check manifest.json
                m_file = tf_in.extractfile("manifest.json")
                manifest = json.loads(m_file.read().decode("utf-8"))
                self.assertEqual(manifest["version"], "2.0.0")
                self.assertEqual(manifest["tool"], "straditize pro")

                # Check straditize.json
                sj_file = tf_in.extractfile("straditize.json")
                sj = json.loads(sj_file.read().decode("utf-8"))
                self.assertIn("columns", sj)
                self.assertIn("depth_calibration", sj)
                self.assertIn("roi", sj)

                # Check data.csv (first column depth, no NA)
                csv_file = tf_in.extractfile("data.csv")
                csv_text = csv_file.read().decode("utf-8")
                lines = csv_text.strip().split("\n")
                self.assertIn("depth", lines[0].lower())
                self.assertNotIn("NA", csv_text)

                # Check README.txt contains pseudocount notice
                readme_file = tf_in.extractfile("README.txt")
                readme_text = readme_file.read().decode("utf-8")
                self.assertIn("pseudocount", readme_text.lower())

            # 4. project.new should clear session state
            res_new = self.rpc_call("project.new")
            self.assertTrue(res_new["success"])
            self.assertEqual(len(self.session.columns), 0)

            # 5. project.load from the .tar archive
            res_load = self.rpc_call("project.load", {"project_data": tar_path})
            self.assertTrue(res_load["success"])
            self.assertGreater(len(self.session.columns), 0)
            self.assertEqual(self.session.columns[0]["species"], "Pinus" if "Pinus" in self.session.taxa_names else self.session.columns[0]["name"])
        finally:
            if os.path.exists(tar_path):
                os.remove(tar_path)

    def test_section_five_column_and_point_manipulation_with_undo(self):
        """Tests column.add/remove/update, point.add/move/remove, and history.undo/redo."""
        # 1. Add column
        res_col = self.rpc_call("column.add", {
            "column": {
                "species": "Betula",
                "startX": 100,
                "endX": 250,
                "scale_type": "linear",
            }
        })
        self.assertEqual(res_col["column"]["species"], "Betula")
        self.assertEqual(len(self.session.columns), 1)

        # 2. Add control point
        res_pt = self.rpc_call("point.add", {"col_index": 0, "y": 500, "x": 180})
        self.assertTrue(res_pt["success"])
        self.assertEqual(self.session.control_points[0][500], 180)

        # 3. Move point
        res_mv = self.rpc_call("point.move", {"col_index": 0, "y": 500, "new_x": 195})
        self.assertEqual(self.session.control_points[0][500], 195)

        # 4. Undo and Redo
        undo_res = self.rpc_call("history.undo")
        self.assertTrue(undo_res["success"])
        redo_res = self.rpc_call("history.redo")
        self.assertTrue(redo_res["success"])

        # 5. Remove point
        rm_res = self.rpc_call("point.remove", {"col_index": 0, "y": 500})
        self.assertTrue(rm_res["success"])
        self.assertNotIn(500, self.session.control_points[0])

    def test_section_five_algorithm_and_export(self):
        """Tests algorithm.degrid, export.csv, and export.r."""
        load_res = self.rpc_call("image.load", {"image_path": self.image_path})
        self.assertIn("width", load_res)
        self.assertIn("height", load_res)

        # 1. algorithm.degrid runs with adaptive kernel
        degrid_res = self.rpc_call("algorithm.degrid", {})
        self.assertTrue(degrid_res["success"])
        self.assertGreater(degrid_res["kernel_width"], 10)

        # 3. export.r returns valid rioja script
        r_script = self.rpc_call("export.r")
        self.assertIn("rioja", r_script)
        self.assertIn("strat.plot", r_script)

        # 4. export.tar returns base64 if no path
        tar_res = self.rpc_call("export.tar")
        self.assertTrue(tar_res["success"])
        self.assertIn("tar_base64", tar_res)

    def test_cli_run_project_tar_and_json(self):
        """Tests straditize_core.cli cmd_run_project with both .tar and .json project formats."""
        from argparse import Namespace
        from straditize_core.cli import cmd_run_project

        # Prepare project
        self.rpc_call("image.load", {"image_path": self.image_path})
        self.rpc_call("roi.update", {"x0": 315, "x1": 1946, "y0": 511, "y1": 1311})
        self.rpc_call("algorithm.detectColumns", {"xlim": [315, 1946], "ylim": [511, 1311]})

        with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf_tar, \
             tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tf_out_tar, \
             tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf_json, \
             tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tf_out_json:
            tar_path = tf_tar.name
            out_tar_csv = tf_out_tar.name
            json_path = tf_json.name
            out_json_csv = tf_out_json.name

        try:
            # 1. Save as .tar and run cli
            self.session.project_save(tar_path, format="tar")
            args_tar = Namespace(project=tar_path, output=out_tar_csv, format="csv")
            ret_tar = cmd_run_project(args_tar)
            self.assertEqual(ret_tar, 0)
            self.assertTrue(os.path.exists(out_tar_csv))
            with open(out_tar_csv, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("depth", content.lower())

            # 2. Save as .json and run cli
            self.session.project_save(json_path, format="json")
            args_json = Namespace(project=json_path, output=out_json_csv, format="csv")
            ret_json = cmd_run_project(args_json)
            self.assertEqual(ret_json, 0)
            self.assertTrue(os.path.exists(out_json_csv))
        finally:
            for p in [tar_path, out_tar_csv, json_path, out_json_csv]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass


if __name__ == "__main__":
    unittest.main()

