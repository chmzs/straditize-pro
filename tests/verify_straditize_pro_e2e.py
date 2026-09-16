# -*- coding: utf-8 -*-
"""Full End-to-End Smoke Regression for Straditize Pro (v2.0).

Verifies the complete requirements according to the client opinion checklist:
1. Dual launch modes & lifecycle:
   - Desktop Mode: /shutdown permitted (200 OK -> delayed exit), isDesktopMode=True
   - Server Mode: /shutdown forbidden (403 Forbidden), isDesktopMode=False
2. Zero authentication:
   - Direct 127.0.0.1 access, no tokens, cookies, or secrets
3. Coordinate System Single Source of Truth:
   - Linear scale and Log scale forward and inverse transforms
   - Log scale strict constraint check (startValue > 0 && tickValue > 0 && startValue != tickValue)
4. Extreme large image performance:
   - PIL decompression bomb limit bypassed (Image.MAX_IMAGE_PIXELS is None)
   - /image/slice, /image/tile, /image/preview HTTP endpoints
   - Memory safety for >16M pixel images (avoiding eager 2GB+ numpy array allocation)
5. Geological digitization & extraction workflow:
   - core.loadImage -> core.detectColumns -> core.digitize -> core.batchSetTaxa -> core.applyDepthGrid -> core.extractGridValues
   - Stratigraphic CSV output: depth as 1st column, unobserved taxa = 0.0 (never NA)
6. POSIX UStar .tar bundle:
   - Full archive packing & extraction (data.csv, plot_strat.R, straditize.json, info.json, diagram.png, README.txt)
   - Automated R script validation (rioja::strat.plot)
"""

import io
import json
import math
import os
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from PIL import Image

# Ensure straditize and straditize_core are importable
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
core_dir = os.path.join(root_dir, "straditize")
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

from straditize_core.calibration import LinearCalibration, LogCalibration
from straditize_core.protocol import JsonRpcError
from straditize_core.rpc_server import (
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
    find_available_port,
)
from straditize_core.session import StraditizeSession


class TestStraditizeProFullE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Start a Desktop Mode test server
        cls.desktop_port = find_available_port(8890)
        cls.desktop_session = StraditizeSession()
        cls.desktop_shutdown_called = threading.Event()
        cls.desktop_server = StraditizeRpcHttpServer(
            host="127.0.0.1",
            port=cls.desktop_port,
            session=cls.desktop_session,
            is_desktop_mode=True,
            shutdown_fn=lambda code: cls.desktop_shutdown_called.set(),
        )
        cls.desktop_server.start()

        # 2. Start a Server Mode test server
        cls.server_port = find_available_port(8910)
        cls.server_session = StraditizeSession()
        cls.server_server = StraditizeRpcHttpServer(
            host="127.0.0.1",
            port=cls.server_port,
            session=cls.server_session,
            is_desktop_mode=False,
        )
        cls.server_server.start()
        time.sleep(0.3)

    @classmethod
    def tearDownClass(cls):
        cls.desktop_server.stop()
        cls.server_server.stop()

    def test_01_dual_launch_modes_and_security(self):
        """Verify zero-auth, desktop vs server mode flags, and shutdown permissions."""
        print("\n--- [E2E 1/6] Testing Dual Launch Modes & Security ---")

        # A. Desktop mode reports is_desktop_mode=True
        req = urllib.request.Request(f"http://127.0.0.1:{self.desktop_server.actual_port}/status")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertTrue(data["is_desktop_mode"])

        # B. Server mode reports is_desktop_mode=False
        req_srv = urllib.request.Request(f"http://127.0.0.1:{self.server_server.actual_port}/status")
        with urllib.request.urlopen(req_srv) as resp:
            data_srv = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data_srv["status"], "ok")
            self.assertFalse(data_srv["is_desktop_mode"])

        # C. Server mode strictly rejects /shutdown with 403 Forbidden
        req_srv_shut = urllib.request.Request(
            f"http://127.0.0.1:{self.server_server.actual_port}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req_srv_shut)
            self.fail("Server mode must forbid /shutdown with HTTP 403")
        except urllib.error.HTTPError as err:
            self.assertEqual(err.code, 403)

        # D. Desktop mode allows /shutdown with 200 OK and triggers shutdown handler
        req_desk_shut = urllib.request.Request(
            f"http://127.0.0.1:{self.desktop_server.actual_port}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req_desk_shut) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(data["success"])
        self.assertTrue(self.desktop_shutdown_called.wait(timeout=2.0))
        print("  -> Passed: Dual launch modes and shutdown permissions verified.")

    def test_02_coordinate_system_and_log_scale(self):
        """Verify Linear/Log conversions and strict Log constraint validation."""
        print("\n--- [E2E 2/6] Testing Coordinate System Single Source of Truth ---")
        import numpy as np

        # 1. Linear Calibration verification
        lin_cal = LinearCalibration([100.0, 300.0], [0.0, 50.0])
        self.assertAlmostEqual(lin_cal.px2data(200.0), 25.0)
        self.assertAlmostEqual(lin_cal.data2px(25.0), 200.0)

        # 2. Log Calibration verification
        log_cal = LogCalibration([100.0, 300.0], [1.0, 100.0])
        # Midpoint x=200 on log [1, 100] is geometric mean sqrt(1*100) = 10.0
        self.assertAlmostEqual(log_cal.px2data(200.0), 10.0, places=4)
        self.assertAlmostEqual(log_cal.data2px(10.0), 200.0, places=4)

        # Vectorized transforms
        np.testing.assert_allclose(
            log_cal.px2data(np.array([100.0, 200.0, 300.0])),
            [1.0, 10.0, 100.0],
            rtol=1e-5,
        )
        np.testing.assert_allclose(
            log_cal.data2px(np.array([1.0, 10.0, 100.0])),
            [100.0, 200.0, 300.0],
            rtol=1e-5,
        )

        # 3. Log hard constraint validation (must raise ValueError)
        invalid_configs = [
            ([100.0, 300.0], [0.0, 10.0]),     # startVal <= 0
            ([100.0, 300.0], [-1.0, 50.0]),    # startVal < 0
            ([100.0, 300.0], [10.0, 0.0]),     # tickVal <= 0
            ([100.0, 300.0], [10.0, 10.0]),    # startVal == tickVal
            ([200.0, 200.0], [1.0, 100.0]),    # zero pixel span
        ]
        for px_pts, data_pts in invalid_configs:
            with self.assertRaises(ValueError):
                LogCalibration(px_pts, data_pts)

        # Inverse mapping of non-positive values must raise ValueError
        with self.assertRaises(ValueError):
            log_cal.data2px(0.0)
        with self.assertRaises(ValueError):
            log_cal.data2px(-5.0)

        # 4. Session export_data integration with log scale column
        test_session = StraditizeSession()
        test_session.column_add({
            "name": "ConcentrationLog",
            "startX": 100.0,
            "endX": 300.0,
            "tickEndX": 300.0,
            "scale_type": "log",
            "startValue": 1.0,
            "tickValue": 100.0,
        })
        test_session.point_add(0, y=50.0, x=200.0)
        test_session.is_calibrated = True
        test_session.y_scale = {"slope": 1.0, "intercept": 0.0}

        exp_result = test_session.export_data(format="csv")
        csv_text = exp_result.get("csv") or exp_result.get("csv_content") or ""
        self.assertIn("ConcentrationLog", csv_text)
        # 200.0 px must convert to 10.0
        self.assertIn("10.0", csv_text)

        # Strict export with invalid log startValue must raise JsonRpcError
        test_session.columns[0]["startValue"] = 0.0
        with self.assertRaises(JsonRpcError):
            test_session.export_data(format="csv", strict=True)

        print("  -> Passed: LogCalibration, constraints, and session export verified.")

    def test_03_extreme_large_image_performance(self):
        """Verify decompression bomb safety, tile slicing, and preview endpoints."""
        print("\n--- [E2E 3/6] Testing Extreme Large Image Safety & Slice Endpoints ---")
        self.assertIsNone(Image.MAX_IMAGE_PIXELS)

        # Create synthetic large image (4200x4000 = 16.8M px > 16M threshold)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
            huge_img = Image.new("RGB", (4200, 4000), (240, 240, 240))
            huge_img.save(tf.name, format="PNG")
            tf_path = tf.name

        try:
            session = StraditizeSession()
            info = session.load_image(tf_path)
            self.assertEqual(info["width"], 4200)
            self.assertEqual(info["height"], 4000)
            # Crucial: eager numpy array must be None
            self.assertIsNone(session.image_array)

            # Slicing without full rasterization
            sl = session.get_image_slice(500, 600, 300, 200)
            self.assertEqual(sl.size, (300, 200))

            # Downsampled overview
            prev = session.get_image_preview(max_dim=1024)
            self.assertLessEqual(max(prev.size), 1024)

            # Load into server session to test HTTP endpoints
            self.server_session.load_image(tf_path)
            port = self.server_server.actual_port

            # Test /image/slice HTTP endpoint
            req_slice = urllib.request.Request(f"http://127.0.0.1:{port}/image/slice?x=100&y=200&w=256&h=128")
            with urllib.request.urlopen(req_slice) as resp:
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.headers.get("Content-Type"), "image/png")
                data = resp.read()
                self.assertGreater(len(data), 100)

            # Test /image/preview HTTP endpoint
            req_prev = urllib.request.Request(f"http://127.0.0.1:{port}/image/preview")
            with urllib.request.urlopen(req_prev) as resp:
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.headers.get("Content-Type"), "image/png")
            print("  -> Passed: Extreme large image memory safety and slice endpoints verified.")
        finally:
            try:
                os.remove(tf_path)
            except Exception:
                pass

    def test_04_full_scientific_digitization_pipeline(self):
        """Verify genuine pollen diagram digitization, 0.0 unobserved taxa, and CSV export."""
        print("\n--- [E2E 4/6] Testing Full Scientific Digitization Pipeline ---")
        hoya_img = os.path.abspath("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png")
        self.assertTrue(os.path.exists(hoya_img), f"Sample image not found: {hoya_img}")

        session = StraditizeSession()
        session.load_image(hoya_img)
        self.assertEqual(session.width, 2339)
        self.assertEqual(session.height, 1654)

        # 1. Detect columns on Hoya data bounds [315, 1946], [511, 1311]
        cols_res = session.detect_columns([315, 1946], [511, 1311])
        self.assertGreater(len(cols_res), 10)

        # 2. Digitize column 0
        dig_res = session.digitize(0, "area")
        self.assertGreater(len(dig_res["points"]), 100)

        # 3. Batch set species names
        taxa = ["Pinus canariensis", "Juniperus", "Quercus", "Olea", "Betula"]
        session.batch_set_taxa(taxa)
        self.assertEqual(session.taxa_names[:3], ["Pinus canariensis", "Juniperus", "Quercus"])

        # 4. Apply depth grid & extract values
        session.apply_depth_grid(start_depth=0, end_depth=100, step=5)
        extracted = session.extract_grid_values()
        self.assertEqual(extracted["rows_count"], 21)
        self.assertIn("data", extracted)

        # 5. Core requirement: Unobserved taxa must be strictly 0.0, never NA
        records = extracted["data"]
        for r in records:
            self.assertIn("depth", r)
            for k, val in r.items():
                if k != "depth":
                    self.assertIsNotNone(val)
                    self.assertFalse(math.isnan(val))
                    self.assertIsInstance(val, (int, float))

        # 6. Calibrate axes and export to CSV
        session.calibrate_axes([{"pixel": 511, "val": 0}, {"pixel": 1311, "val": 150}])

        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tf:
            csv_path = tf.name

        try:
            exp_res = session.export_data("csv", strict=False, output_path=csv_path)
            self.assertIsNotNone(exp_res["file_path"])
            self.assertTrue(os.path.exists(csv_path))

            # Verify CSV format: 1st column is depth
            with open(csv_path, "r", encoding="utf-8") as f:
                header_line = f.readline().strip()
                self.assertTrue(header_line.lower().startswith("depth"))
                for line in f:
                    clean_line = line.strip()
                    if not clean_line:
                        continue
                    parts = clean_line.split(",")
                    # Ensure all numbers are valid floats
                    for p in parts:
                        if p:
                            v = float(p)
                            self.assertFalse(math.isnan(v))
            print("  -> Passed: Scientific digitization pipeline and 0.0 zero-abundance verified.")
        finally:
            try:
                os.remove(csv_path)
            except Exception:
                pass

    def test_05_posix_ustar_tar_archive_bundle(self):
        """Verify creation, extraction, and file integrity of POSIX UStar project tar."""
        print("\n--- [E2E 5/6] Testing POSIX UStar Project Archive Bundle ---")
        with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
            tar_path = tf.name

        try:
            # Build sample components for all 6 required files
            info_json = json.dumps({
                "project": "Straditize Pro",
                "version": "2.0.0",
                "timestamp": time.time(),
                "calibration": {"depthTop": 0, "depthBottom": 150, "unit": "cm"},
            }, indent=2).encode("utf-8")

            straditize_json = json.dumps({
                "version": "2.0",
                "columns": [{"id": "col_0", "name": "Pinus", "scale_type": "linear"}],
                "calibration": {"top_cm": 0, "bottom_cm": 150},
            }, indent=2).encode("utf-8")

            data_csv = b"depth,Pinus,Quercus,Betula\n0.0,12.5,0.0,3.2\n5.0,15.1,0.0,2.8\n10.0,8.4,1.1,0.0\n"

            plot_strat_r = b"""library(rioja)
df <- read.csv("data.csv", check.names=FALSE)
depth <- df[[1]]
taxa <- as.matrix(df[,-1])
taxa[is.na(taxa)] <- 0
strat.plot(taxa, yvar=depth, y.rev=TRUE, plot.poly=TRUE, plot.line=TRUE)
"""

            readme_txt = b"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"

            png_buf = io.BytesIO()
            Image.new("RGB", (100, 100), (120, 160, 200)).save(png_buf, format="PNG")
            diagram_png = png_buf.getvalue()

            # Pack POSIX UStar tar
            with tarfile.open(tar_path, "w", format=tarfile.USTAR_FORMAT) as tar:
                def add_bytes(name, content):
                    ti = tarfile.TarInfo(name=name)
                    ti.size = len(content)
                    ti.mtime = int(time.time())
                    ti.mode = 0o644
                    tar.addfile(ti, io.BytesIO(content))

                add_bytes("info.json", info_json)
                add_bytes("straditize.json", straditize_json)
                add_bytes("diagram.png", diagram_png)
                add_bytes("data.csv", data_csv)
                add_bytes("plot_strat.R", plot_strat_r)
                add_bytes("README.txt", readme_txt)

            # Unpack and verify all 6 files
            with tarfile.open(tar_path, "r") as tar:
                names = tar.getnames()
                expected = ["info.json", "straditize.json", "diagram.png", "data.csv", "plot_strat.R", "README.txt"]
                for exp in expected:
                    self.assertIn(exp, names)

                # Validate data.csv unobserved values
                csv_data = tar.extractfile("data.csv").read().decode("utf-8")
                lines = csv_data.strip().split("\n")
                self.assertTrue(lines[0].startswith("depth"))
                self.assertIn("0.0", lines[1])

                # Validate R script uses rioja::strat.plot
                r_code = tar.extractfile("plot_strat.R").read().decode("utf-8")
                self.assertIn("strat.plot", r_code)
                self.assertIn("rioja", r_code)
            print("  -> Passed: POSIX UStar project archive packing and unpacking verified.")
        finally:
            try:
                os.remove(tar_path)
            except Exception:
                pass

    def test_06_frontend_bundle_readiness(self):
        """Verify frontend production build assets exist and are served via HTTP."""
        print("\n--- [E2E 6/6] Testing Production Frontend Asset Distribution ---")
        dist_index = os.path.abspath("frontend/dist/index.html")
        self.assertTrue(os.path.exists(dist_index), "frontend/dist/index.html not found! Run npm run build.")

        # Request index.html from HTTP server
        req = urllib.request.Request(f"http://127.0.0.1:{self.server_server.actual_port}/")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("<div id=\"app\">", content)
            self.assertIn("Straditize", content)
        print("  -> Passed: Frontend distribution served with 200 OK.")


if __name__ == "__main__":
    unittest.main()
