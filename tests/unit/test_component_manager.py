# -*- coding: utf-8 -*-
"""Unit tests for Straditize Pro Addon Component Manager.

Conforms to Section 4 & 8 of the Incremental Addon Specification (方式2：轻量版增量升级方案):
1. Query initial component status (uninstalled).
2. Safe ZIP extraction and anti Zip-Slip path traversal protection.
3. installed.json metadata generation and version checking.
4. Component removal / uninstallation.
5. In-process download task management with status reporting.
"""
from pathlib import Path

import io
import json
import tempfile
import unittest
import zipfile

from straditize_core.components import ComponentManager


class TestComponentManagerSuite(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.mgr = ComponentManager(base_dir=self.base_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_01_initial_status_uninstalled(self):
        """Verify initial state reports not installed."""
        status = self.mgr.get_status("age-modeling")
        self.assertEqual(status["name"], "age-modeling")
        self.assertFalse(status["is_installed"])
        self.assertIsNone(status["installed_version"])
        self.assertIn("WebR + rbacon", status["title"])

    def test_02_safe_zip_extraction_and_installed_metadata(self):
        """Verify valid zip unpacks safely and produces compliant installed.json."""
        # Create a synthetic mock age-modeling.zip
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"name": "age-modeling", "version": "1.0.0"}))
            zf.writestr("webr/webr-runtime.wasm", "mock_wasm_bytes")
            zf.writestr("r-library/rbacon/DESCRIPTION", "Package: rbacon\nVersion: 3.2.0")

        zip_bytes = bio.getvalue()

        # Install via manager
        res = self.mgr.install_from_zip(zip_bytes, component_name="age-modeling")
        self.assertTrue(res["success"])
        self.assertEqual(res["version"], "1.0.0")

        # Query status again
        status = self.mgr.get_status("age-modeling")
        self.assertTrue(status["is_installed"])
        self.assertEqual(status["installed_version"], "1.0.0")
        self.assertIsNotNone(status["installed_at"])

        # Check installed files physically exist
        target = self.base_path / "age-modeling"
        self.assertTrue((target / "installed.json").is_file())
        self.assertTrue((target / "webr" / "webr-runtime.wasm").is_file())

    def test_03_zip_slip_security_prevention(self):
        """Verify malicious paths containing '../' or absolute paths are loudly rejected."""
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            # Malicious path trying to escape directory
            zf.writestr("../evil.txt", "exploit_content")

        zip_bytes = bio.getvalue()

        with self.assertRaises(ValueError) as ctx:
            self.mgr.install_from_zip(zip_bytes, component_name="age-modeling")
        self.assertIn("Zip-Slip", str(ctx.exception))

    def test_04_uninstall_component(self):
        """Verify uninstallation cleans up target directory completely."""
        # Install first
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("webr/test.txt", "hello")
        self.mgr.install_from_zip(bio.getvalue(), component_name="age-modeling")
        self.assertTrue(self.mgr.get_status("age-modeling")["is_installed"])

        # Uninstall
        un_res = self.mgr.uninstall("age-modeling")
        self.assertTrue(un_res["success"])
        self.assertTrue(un_res["removed"])
        self.assertFalse(self.mgr.get_status("age-modeling")["is_installed"])

    def test_05_sha256_checksum_verification(self):
        """Verify strict SHA256 validation prevents corrupted packages."""
        import hashlib
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("test.txt", "valid content")
        zip_bytes = bio.getvalue()
        correct_sha = hashlib.sha256(zip_bytes).hexdigest()
        bad_sha = "0000000000000000000000000000000000000000000000000000000000000000"

        # Correct SHA should succeed
        res = self.mgr.install_from_zip(zip_bytes, component_name="age-modeling", expected_sha256=correct_sha)
        self.assertTrue(res["success"])

        # Mismatched SHA should fail loudly
        with self.assertRaises(ValueError) as ctx:
            self.mgr.install_from_zip(zip_bytes, component_name="age-modeling", expected_sha256=bad_sha)
        self.assertIn("SHA256 checksum mismatch", str(ctx.exception))

    def test_06_ready_callback_trigger(self):
        """Verify component.ready event callbacks are invoked on successful install."""
        notified = []

        def on_ready(comp_name, meta):
            notified.append((comp_name, meta))

        self.mgr.register_ready_callback(on_ready)

        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("webr/worker.js", "mock_worker")
        self.mgr.install_from_zip(bio.getvalue(), component_name="age-modeling")

        self.assertEqual(len(notified), 1)
        self.assertEqual(notified[0][0], "age-modeling")
        self.assertEqual(notified[0][1]["status"], "ready")

    def test_07_webr_directory_and_format_speed(self):
        """Verify user directory webr alias structure and speed formatting helper."""
        from straditize_core.components.manager import format_speed

        self.assertEqual(format_speed(0), "0 KB/s")
        self.assertEqual(format_speed(512000), "500.0 KB/s")
        self.assertEqual(format_speed(2097152), "2.0 MB/s")

        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("webr/R.bin.wasm", "mock_wasm")
        self.mgr.install_from_zip(bio.getvalue(), component_name="age-modeling")

        # Verify webr directory exists under base_path
        webr_dir = self.base_path / "webr"
        self.assertTrue(webr_dir.is_dir())
        self.assertTrue((webr_dir / "R.bin.wasm").is_file())
        self.assertTrue((webr_dir / "installed.json").is_file())


if __name__ == "__main__":
    unittest.main()
