"""Unit tests verifying error classification, human remediation guidance, and single-page PDF support."""

from __future__ import annotations

import base64
import io
from pathlib import Path
from PIL import Image
import pytest

from straditize_core.protocol import (
    ALGORITHM_ERROR,
    CONFLICT_ERROR,
    FILE_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)
from straditize_core.session import StraditizeSession


def test_error_classification_and_remediation_guidance():
    """Verify distinct error codes and presence of human remediation guidance."""
    session = StraditizeSession()

    # 1. STATE_ERROR (-32001): Prerequisite state missing (call before loading image)
    with pytest.raises(JsonRpcError) as exc_info:
        session.detect_columns([100, 200], [100, 200])
    err = exc_info.value
    assert err.code == STATE_ERROR
    assert (
        "步骤" in err.message or "载入" in err.message or "image" in err.message.lower()
    )

    # 2. FILE_ERROR (-32004): File not found
    with pytest.raises(JsonRpcError) as exc_info:
        session.load_image(image_path="non_existent_file_path_12345.png")
    err = exc_info.value
    assert err.code == FILE_ERROR
    assert "未找到" in err.message or "not found" in err.message.lower()

    # Load image for subsequent tests
    session.load_image(sample_key="hoya")

    # 3. CONFLICT_ERROR (-32002): Duplicate naming in same project / ROI
    # load_image 已自动建了一个叫 "pollen" 的默认 ROI，会让第一次创建就撞冲突，
    # 从而测不到"重复命名"这条规则本身；先清空，从零 ROI 状态开始。
    session._init_rois()
    session.roi_create(name="pollen", composition=True)
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="pollen", composition=True)
    err = exc_info.value
    assert err.code == CONFLICT_ERROR
    assert "冲突" in err.message or "已存在" in err.message

    # 4. INVALID_PARAMS (-32602): Syntax / format error (name with slash)
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_create(name="bad/slash/name")
    err = exc_info.value
    assert err.code == INVALID_PARAMS
    assert (
        "不合法" in err.message
        or "不合规" in err.message
        or "invalid" in err.message.lower()
    )


def test_png_base64_upload_loading():
    """Verify loading custom PNG via base64 data URL."""
    session = StraditizeSession()
    im = Image.new("RGB", (200, 150), color="blue")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b64_str = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(
        "ascii"
    )

    res = session.load_image(image_data=b64_str, file_name="uploaded_core.png")
    assert res["success"] is True
    assert res["width"] == 200
    assert res["height"] == 150
    assert res["format"] == "PNG"
    assert session.image is not None


def test_single_page_pdf_support():
    """Verify loading single-page PDF containing a diagram plate."""
    session = StraditizeSession()

    # Create a single-page PDF containing a high-resolution plate image
    im = Image.new("RGB", (300, 240), color="purple")
    pdf_buf = io.BytesIO()
    im.save(pdf_buf, format="PDF")
    pdf_bytes = pdf_buf.getvalue()
    b64_pdf = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode(
        "ascii"
    )

    # 1. Test Base64 PDF data URL
    res = session.load_image(image_data=b64_pdf, file_name="nature_paper_fig3.pdf")
    assert res["success"] is True
    assert res["width"] == 300
    assert res["height"] == 240
    assert res["format"] == "PDF_IMAGE"
    assert session.image is not None

    # 2. Test local file PDF path
    tmp_pdf = Path("test_temp_plate.pdf")
    try:
        tmp_pdf.write_bytes(pdf_bytes)
        res_file = session.load_image(image_path=str(tmp_pdf))
        assert res_file["success"] is True
        assert res_file["width"] == 300
        assert res_file["height"] == 240
    finally:
        if tmp_pdf.exists():
            tmp_pdf.unlink()


def test_multi_page_pdf_page_selection():
    """Verify selecting specific page in a multi-page PDF."""
    import pypdf

    # Create a 3-page PDF: Page 1=red (100x80), Page 2=green (120x90), Page 3=blue (140x100)
    writer = pypdf.PdfWriter()
    sizes = [(100, 80, "red"), (120, 90, "green"), (140, 100, "blue")]
    for w, h, col in sizes:
        sub_im = Image.new("RGB", (w, h), color=col)
        sub_bio = io.BytesIO()
        sub_im.save(sub_bio, format="PDF")
        r = pypdf.PdfReader(sub_bio)
        writer.add_page(r.pages[0])

    out_bio = io.BytesIO()
    writer.write(out_bio)
    pdf_bytes = out_bio.getvalue()
    b64_pdf = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")

    session = StraditizeSession()

    # 1. Load Page 2 directly (should be 120x90)
    res_p2 = session.load_image(image_data=b64_pdf, page_number=2)
    assert res_p2["width"] == 120
    assert res_p2["height"] == 90
    assert res_p2["pdf_info"] == {"total_pages": 3, "current_page": 2}

    # 2. Out of bounds page raises INVALID_PARAMS (-32602) with clear range guidance
    with pytest.raises(JsonRpcError) as exc_info:
        session.load_image(image_data=b64_pdf, page_number=5)
    assert exc_info.value.code == INVALID_PARAMS
    assert "共有 3 页" in exc_info.value.message

