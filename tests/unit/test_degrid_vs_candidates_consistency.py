# -*- coding: utf-8 -*-
"""issue #110：两套横线检测器跨入口一致性与差集规则验证。

## 规范背景 (docs/ARCHITECTURE.md §4.8)
- `algorithm.degrid` 属于外部 RPC / WebMCP 兼容接口，底层走 `image.py::detect_grid_lines`，
  基于形态学开运算（`morphological_continuous`），只检出无空洞的连续强实线；
- `algorithm.detectLineCandidates` 属于现代清理管线，底层走 `lines.py::detect_line_candidates`，
  基于行投影贯穿率模型（`line_fraction_h`），支持具有浅灰/空洞特征的真实区带横线；
- 两者的差异必须完全落在可解释的差集规则内，杜绝无人解释的黑箱状态。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from straditize_core.lines import detect_line_candidates
from straditize_core.session import StraditizeSession


def _create_synthetic_plate_with_lines(tmp_path) -> str:
    """生成包含一条连续实线（y=100）和一条断续浅灰线（y=200，空洞占比约 30%）的测试图。"""
    w, h = 800, 400
    arr = np.full((h, w), 255, dtype=np.uint8)

    # 1. y=100: 满幅连续黑线（厚度 2px）
    arr[100:102, :] = 0

    # 2. y=200: 贯穿率约 55% 的断续线（每隔 10px 仅 5.5px 有墨迹，小于 medium 的 span_frac=0.65）
    for x in range(w):
        if (x % 20) < 11:
            arr[200:202, x] = 0

    img_path = str(tmp_path / "test_lines_plate.png")
    Image.fromarray(arr).save(img_path)
    return img_path


def test_continuous_solid_line_detected_by_both(tmp_path) -> None:
    """对连续实线，两套检测器均应成功检出。"""
    plate_path = _create_synthetic_plate_with_lines(tmp_path)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=plate_path)
    session.detect_columns(data_xlim=[0, 800], data_ylim=[0, 400])

    # 1. 调 algorithm.degrid
    degrid_res = session.algorithm_degrid(strength="medium")
    assert degrid_res["success"] is True
    assert degrid_res["detection_model"] == "morphological_continuous"
    assert "disclaimer" in degrid_res
    # 连续实线 y=100 必须被检出
    assert any(abs(r - 100) <= 2 for r in degrid_res["horizontal_rows"])

    # 2. 调 detect_line_candidates
    candidates = session.detect_line_candidates(include_vertical=False)["candidates"]
    c_rows = [c["at"] for c in candidates if c["axis"] == "h"]
    assert any(abs(r - 100) <= 2 for r in c_rows)


def test_intermittent_void_line_differential_rule(tmp_path) -> None:
    """对带空洞的断续线，degrid 判定为 0（因连续段 < run_length），而 candidates 成功召回。"""
    plate_path = _create_synthetic_plate_with_lines(tmp_path)
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=plate_path)
    session.detect_columns(data_xlim=[0, 800], data_ylim=[0, 400])

    # 1. degrid(medium) 要求 span_frac=0.65，55% 的覆盖率无法检出
    degrid_res = session.algorithm_degrid(strength="medium")
    assert not any(abs(r - 200) <= 2 for r in degrid_res["horizontal_rows"])

    # 2. 但在更灵敏的 strong 模式下（span_frac=0.45），degrid 能够捕获该线
    degrid_strong = session.algorithm_degrid(strength="strong")
    assert any(abs(r - 200) <= 2 for r in degrid_strong["horizontal_rows"])

    # 3. detect_line_candidates 传 line_fraction_h=0.50 时成功召回 y=200 的断续区带线
    candidates = session.detect_line_candidates(
        include_vertical=False, line_fraction_h=0.50
    )["candidates"]
    c_rows = [c["at"] for c in candidates if c["axis"] == "h"]
    assert any(abs(r - 200) <= 2 for r in c_rows)
