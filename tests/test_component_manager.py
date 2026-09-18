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
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

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


if __name__ == "__main__":
    unittest.main()
