"""Unit tests for project archive loading, format validation, and export bundle rejection."""

from __future__ import annotations

import io
import json
import os
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from straditize_core.protocol import INVALID_PARAMS, JsonRpcError
from straditize_core.session import StraditizeSession


def test_load_export_bundle_zip_rejected(tmp_path: Path):
    """Loading a plot bundle zip (e.g. strat_export_*.zip) must raise descriptive JsonRpcError(INVALID_PARAMS)."""
    bundle_path = tmp_path / "strat_export_123456789.zip"
    with zipfile.ZipFile(bundle_path, "w") as zf:
        zf.writestr("data.csv", "sample,depth,taxa1\n1,10.0,25.0\n")
        zf.writestr("plot_strat.R", "# R plot script\n")
        zf.writestr("README.txt", "Export bundle readme\n")

    sess = StraditizeSession()
    with pytest.raises(JsonRpcError) as exc_info:
        sess.load_project(str(bundle_path))

    assert exc_info.value.code == INVALID_PARAMS
    assert (
        "plot bundle" in exc_info.value.message
        or "导出出图包" in exc_info.value.message
    )
    assert "straditize.json" in exc_info.value.message


def test_load_generic_zip_without_straditize_json_rejected(tmp_path: Path):
    """Zip archives without straditize.json must be cleanly rejected with INVALID_PARAMS."""
    zip_path = tmp_path / "custom_archive.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("notes.txt", "hello world")

    sess = StraditizeSession()
    with pytest.raises(JsonRpcError) as exc_info:
        sess.load_project(str(zip_path))

    assert exc_info.value.code == INVALID_PARAMS
    assert "straditize.json" in exc_info.value.message


def test_load_corrupt_binary_file_rejected(tmp_path: Path):
    """Arbitrary binary files must not crash with unhandled UnicodeDecodeError."""
    bin_path = tmp_path / "corrupted_project.bin"
    bin_path.write_bytes(b"\x00\xff\xfe\xed\xaa\xbb\xcc\xdd\x00\x11\x22")

    sess = StraditizeSession()
    with pytest.raises(JsonRpcError) as exc_info:
        sess.load_project(str(bin_path))

    assert exc_info.value.code == INVALID_PARAMS


def test_load_zip_with_valid_project_structure(tmp_path: Path):
    """Zip archives containing straditize.json and image are successfully decoded."""
    zip_path = tmp_path / "valid_project.zip"
    img = Image.new("RGB", (64, 64), color="red")
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")

    project_payload = {
        "version": "3.0",
        "schema_version": "3.0",
        "image": {"path": "image/original.png"},
        "columns": [],
        "samples": [],
    }

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("straditize.json", json.dumps(project_payload))
        zf.writestr("image/original.png", img_buf.getvalue())

    sess = StraditizeSession()
    res = sess.load_project(str(zip_path))
    assert res.get("success") is True
    assert sess.image is not None
    assert sess.width == 64
    assert sess.height == 64


def test_historical_downloads_export_bundle_rejection():
    """Verify rejection on the real strat_export_1795007482.zip in F:\\Downloads if present."""
    bundle_path = r"F:\Downloads\strat_export_1795007482.zip"
    if not os.path.exists(bundle_path):
        pytest.skip(f"Historical file not found: {bundle_path}")

    sess = StraditizeSession()
    with pytest.raises(JsonRpcError) as exc_info:
        sess.load_project(bundle_path)

    assert exc_info.value.code == INVALID_PARAMS
    assert (
        "plot bundle" in exc_info.value.message
        or "导出出图包" in exc_info.value.message
    )
