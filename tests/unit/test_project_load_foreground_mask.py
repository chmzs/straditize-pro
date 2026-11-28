# -*- coding: utf-8 -*-
"""回归钉子（#177）：`project.load` 跨图载入 `.tar` 工程包后必须重置前景掩膜。

原故障链：
1. 先载入 320×260 图并提取前景 / 数字化 → `foreground_mask` 尺寸为 (260, 320)；
2. 再 `project.load` 载入含 600×400 底图的 `.tar` 工程包；
   `_extract_tar_members` 替换了 `self.image`/`width`/`height`，但
   `_reset_loaded_state` 未清空 `foreground_mask`（仅 `_restore_embedded_image`
   的 base64 分支清过）；
3. 随后 `redigitize_all_columns()` 看到 `foreground_mask is not None` 跳过重提，
   `_extraction_mask()` 在按位运算时抛 `ValueError: operands could not be broadcast together`。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def _make_diagram_png(path, size: tuple[int, int], col_rect: tuple[int, int, int, int]) -> None:
    img = Image.new("RGB", size, (255, 255, 255))
    draw = ImageDraw.Draw(img)
    x0, y0, x1, y1 = col_rect
    # 画一条简单轴线与曲线墨迹，确保数字化能读到前景
    draw.rectangle([x0, y0, x0 + 2, y1], fill=(0, 0, 0))
    draw.polygon([(x0 + 3, y0 + 20), (x0 + 40, (y0 + y1) // 2), (x0 + 3, y1 - 20)], fill=(0, 0, 0))
    img.save(path, format="PNG")


def test_project_load_tar_after_different_image_resets_foreground_mask_and_redigitizes(tmp_path) -> None:
    """先载入 320×260 图再载入 600×400 的 .tar 工程包，`redigitize_all_columns` 必须成功且不报广播错。"""
    small_png = tmp_path / "small.png"
    large_png = tmp_path / "large.png"
    tar_path = tmp_path / "large_proj.tar"
    _make_diagram_png(small_png, (320, 260), (40, 30, 140, 220))
    _make_diagram_png(large_png, (600, 400), (80, 40, 220, 340))

    # 构造并保存一份 600×400 的 .tar 工程包
    builder = StraditizeSession()
    builder.load_image(image_path=str(large_png))
    builder.roi_update(builder.active_roi_id, xlim=[80, 240], ylim=[40, 340])
    builder.column_add({"name": "Pinus", "startX": 80, "endX": 220})
    builder.calibrate_axes(
        y_marks=[{"pixel": 40.0, "val": 0.0}, {"pixel": 340.0, "val": 100.0}],
        unit="cm",
    )
    builder.digitize(0)
    builder.project_save(output_path=str(tar_path), format="tar")

    # 在同一会话上先载入 320×260 小图并提取前景掩膜，再载入 600×400 .tar 包
    session = StraditizeSession()
    session.load_image(image_path=str(small_png))
    session.extract_foreground()
    assert session.foreground_mask is not None
    assert session.foreground_mask.shape == (260, 320)

    session.project_load(str(tar_path))
    assert (session.width, session.height) == (600, 400)
    assert session.foreground_mask is None, "project.load 换图后必须清空旧 foreground_mask"

    res = session.redigitize_all_columns()
    assert res["success"] is True
    assert session.foreground_mask is not None
    assert session.foreground_mask.shape == (400, 600)
    assert len(session.column_points.get(0, [])) > 0


def test_extraction_mask_rejects_mismatched_foreground_shape() -> None:
    """纵深防御：若外部强制写入错尺寸掩膜，`_extraction_mask` 必须显式报 STATE_ERROR。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.foreground_mask = np.zeros((260, 320), dtype=bool)

    with pytest.raises(JsonRpcError) as exc_info:
        session._extraction_mask()
    assert exc_info.value.code == STATE_ERROR
