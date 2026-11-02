# -*- coding: utf-8 -*-
"""标签带定位回归钉子（OCR 默认 bbox 的 y0 计算）。

## 这条测试钉的是哪个缺陷

`session_parts/ocr.py` 旧实现：

    y0 = max(0, int(self.data_ylim[0] - 320))

在真实论文图版上 `data_ylim[0] = 233` → `233 - 320 = -87` → `max(0, -87) = 0`，
即**默认 bbox 从图像最顶端开始**，把标签区上方的图例文字也扫进来。

后果不是"多一个标签"这么轻：`ocr/engine.py` 的 `can_pair` 要求
`len(labels) == len(columns)`，多一个假标签就让**全部**正确配对整体否决
（实测 17 标签 / 16 列 → `associated_column_id` 全 None）。

## 判据

从数据区上边界向上扫，把暗像素密集行切成连续段，取**最靠近数据区且高度
≥ 20 行**的那一段作为标签带。细线（数据区顶边线，高度 1 行）被高度下限
排除；上方图例区因不与数据区相邻而不被选中。

**没有魔法数**：不假设标签带离数据区多少像素，也不假设它的高度；只依赖
"文字带比边线厚"这个物理事实。

## 为什么要用合成图而不是只依赖真实图版

真实图版 `tests/data/figures/real_plates/fig3_raw.jpeg` 被 .gitignore，CI 上不存在。
所以这里用**合成的"顶边线 + 文字带 + 图例区"三层结构**，把判据本身钉死；
真实图版那一条在文件存在时才跑（skip 时打印原因）。
"""

from __future__ import annotations

import os

import pytest
from PIL import Image, ImageDraw

from straditize_core.session import StraditizeSession


def _make_layered_plate(tmp_path, *, data_top=300, label_top=120, label_bottom=260):
    """造一张三层结构的图：数据区顶边线 / 文字带 / 上方图例区。

    模拟真实图版的物理布局：
      - y = data_top-1        ：1px 细线（数据区顶边）
      - y = label_top..bottom ：密集文字带
      - y = 20..60            ：稀疏图例区
    """
    width, height = 600, 700
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)

    # 数据区：顶边线 + 内部一些内容
    draw.line([(50, data_top - 1), (550, data_top - 1)], fill=0, width=1)
    for x in range(60, 550, 40):
        draw.rectangle([x, data_top + 5, x + 20, height - 20], fill=180)

    # 密集文字带：每 10px 一根竖线，模拟旋转属种名
    for x in range(60, 550, 10):
        draw.line([(x, label_top), (x, label_bottom)], fill=0, width=2)

    # 上方图例区：稀疏短线
    for x in range(60, 550, 60):
        draw.line([(x, 20), (x, 60)], fill=0, width=2)

    path = tmp_path / "layered_plate.png"
    image.save(path)
    return str(path), data_top, label_top, label_bottom


def _session_with_roi(image_path, x0, x1, y0, y1):
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=image_path)
    session._init_rois()
    session.roi_create(name="pollen", x0=x0, x1=x1, y0=y0, y1=y1, composition=True)
    session.detect_columns(data_xlim=[x0, x1], data_ylim=[y0, y1])
    return session


class TestLabelBandTop:
    """标签带上边界必须落在文字带内，不能退到图像顶端。"""

    def test_band_top_lands_inside_text_band(self, tmp_path) -> None:
        path, data_top, label_top, label_bottom = _make_layered_plate(tmp_path)
        session = _session_with_roi(path, 50, 550, data_top, 650)

        band_top = session._detect_label_band_top(50, 550, data_top)

        assert band_top != 0, "不得退到图像最顶端（旧缺陷症状）"
        assert label_top <= band_top <= label_bottom, (
            f"标签带上边界 {band_top} 应落在文字带 [{label_top}, {label_bottom}] 内"
        )

    def test_band_top_skips_thin_data_edge_line(self, tmp_path) -> None:
        """数据区顶边线只有 1 行，必须被高度下限排除，不能当选标签带。"""
        path, data_top, _label_top, _label_bottom = _make_layered_plate(tmp_path)
        session = _session_with_roi(path, 50, 550, data_top, 650)

        band_top = session._detect_label_band_top(50, 550, data_top)

        assert band_top <= data_top - 10, (
            f"标签带上边界 {band_top} 紧贴数据区顶边 {data_top}，说明选中的是 1px 边线"
        )

    def test_legend_region_not_selected(self, tmp_path) -> None:
        """上方稀疏图例区（y=20..60）不得被当成标签带。"""
        path, data_top, label_top, _label_bottom = _make_layered_plate(tmp_path)
        session = _session_with_roi(path, 50, 550, data_top, 650)

        band_top = session._detect_label_band_top(50, 550, data_top)

        assert band_top >= label_top, (
            f"标签带上边界 {band_top} 越过了文字带顶 {label_top}，可能选中了图例区"
        )

    def test_no_text_band_falls_back_without_crossing_data_top(self, tmp_path) -> None:
        """图上完全没有文字带时，退回保守跨度且不得越过数据区。"""
        path = tmp_path / "blank_plate.png"
        Image.new("L", (600, 700), 255).save(path)
        session = _session_with_roi(str(path), 50, 550, 300, 650)

        band_top = session._detect_label_band_top(50, 550, 300)

        assert 0 <= band_top < 300, f"回退值 {band_top} 必须落在 [0, data_top) 内"


REAL_PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
REAL_PDF = (
    "F:/Zotero/storage/HV4FXL63/"
    "Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
)


@pytest.mark.skipif(
    not os.path.exists(REAL_PDF),
    reason=(
        "真实论文 PDF 不在本机（位于 Zotero 存储目录，不入库）。"
        "此用例钉的是「默认调用应得与列数相等的标签且全部配对」，需真实图版才能验。"
    ),
)
class TestRealPlatePairing:
    """真实图版上，默认调用必须让全部列拿到属种名。"""

    def test_default_call_pairs_every_column(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(image_path=REAL_PDF, page_number=5)
        session._init_rois()
        session.roi_create(name="pollen", x0=330, x1=1330, y0=233, y1=869, composition=True)
        session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])

        n_columns = len(session.columns)
        result = session.ocr_recognize_labels()
        payload = result.get("data") or {}
        labels = payload.get("labels") or []
        reconciliation = payload.get("reconciliation") or {}
        assigned = [lb for lb in labels if lb.get("associated_column_id")]

        assert len(labels) == n_columns, (
            f"默认调用的标签数 {len(labels)} 应等于列数 {n_columns}；"
            "不等说明默认 bbox 又扫进了图例文字"
        )
        assert reconciliation.get("matched") is True, "can_pair 应当成立"
        assert len(assigned) == n_columns, (
            f"只有 {len(assigned)}/{n_columns} 列拿到属种名"
        )
