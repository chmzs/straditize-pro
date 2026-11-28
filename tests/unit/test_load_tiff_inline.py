# -*- coding: utf-8 -*-
"""TIFF 内联数据载荷解码回归测试（#170）。"""

from __future__ import annotations

import base64
import io

from PIL import Image

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import register_all
from straditize_core.session import StraditizeSession


def test_load_image_decodes_inline_lzw_tiff_payload() -> None:
    """前端将 TIFF 以 data:image/tiff;base64,... 发往后端，后端应正确解码。"""
    img = Image.new("RGB", (64, 48), color=(240, 230, 220))
    buf = io.BytesIO()
    img.save(buf, format="TIFF", compression="tiff_lzw")
    data_url = f"data:image/tiff;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"

    session = StraditizeSession()
    session._init_cleanup()
    dispatcher = JsonRpcDispatcher()
    register_all(dispatcher, session)
    load_fn = dispatcher._methods["core.loadImage"]
    diagram_fn = dispatcher._methods["straditize.getDiagramData"]

    res = load_fn(image_data=data_url, file_name="core_plate.tiff")
    assert res["width"] == 64
    assert res["height"] == 48
    assert res["format"] == "TIFF"

    diagram = diagram_fn()
    assert diagram["imageWidth"] == 64
    assert diagram["imageHeight"] == 48
    assert session.image is not None
    assert session.image.size == (64, 48)
