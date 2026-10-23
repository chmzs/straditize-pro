# -*- coding: utf-8 -*-
"""跨图**非几何**状态残留的回归钉子（B-11 及其同族）。

## 为什么与 `test_cross_image_cleanup.py` 分开放

那份文件钉的是**清理几何**（B-03：`line_candidates` / `exclusion_regions` /
`line_strokes`）。B-03 修完之后，同一份"换图重置清单"里还漏着**别的**项，
其中 `samples` 会直接改写导出数值，性质比几何残留更重：

    hoya 上写入 samples depth=5.0/15.0
      → load_image(beginner)
      → columns 29→4（清了），samples 2→2（**没清**）
      → export_csv() 的 depth 列出现 5.0 / 15.0，即 hoya 的采样层位
        被当成 beginner 的系统输出

根因不是"某一项忘了清"，而是**两个入口各维护一份手写清单**：
`project_new()`（`session_parts/project.py`）与 `load_image()`
（`session_parts/core.py`）各自 `self.x = ...` 一遍，漂移不可避免。

## 本文件钉的四类

1. `samples`：污染导出数值（P1，本文件的主钉）；
2. 按 `col_index` 存的派生状态（`x_scales` / `reader_types`）：列重建后旧索引
   指向别的列，`resolve_column_scale` 的 legacy 分支会拿旧斜率换算新列；
3. 上一张图的像素产物（`shadow_mask` / `solid_layers` / `foreground_column_edges`
   / `tick_band`）：旧 `shadow_mask` 与新图尺寸不同，`mask_overlay_data_url`
   直接 ValueError；
4. 撤销栈：存的是旧图的 columns/control_points/data_ylim 快照，换图后仍可
   `history.undo()` 把旧图的列复活到新图上。

**反方向同样要钉**：`age_depth_model` / `paper_metadata` 这类与当前图像素无关的
状态**必须存活**——它们是用户几分钟 MCMC 的成果或论文元数据，换图不该毁掉。
只钉"该清的清了"会让实现退化成"换图就全清"，那是另一种数据破坏。
"""
from __future__ import annotations

import base64
import io

import pypdf
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]
BEGINNER_X, BEGINNER_Y = [200, 1700], [200, 1600]


def _session_on_hoya_with_samples() -> StraditizeSession:
    """hoya 会话 + 两条手工采样层位（深度值明显不属于 beginner）。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=session.rois[0]["id"])
    session.samples = [
        {"row_px": 200, "depth": 5.0, "source": "manual"},
        {"row_px": 400, "depth": 15.0, "source": "manual"},
    ]
    return session


def _three_page_pdf_data_url() -> str:
    """三页纯白 PDF 的 data URL（与 `test_error_guidance_and_pdf.py` 同构造法）。"""
    out_bio = io.BytesIO()
    writer = pypdf.PdfWriter()
    for _ in range(3):
        page_bio = io.BytesIO()
        Image.new("RGB", (300, 200), (255, 255, 255)).save(page_bio, format="PDF")
        page_bio.seek(0)
        writer.add_page(pypdf.PdfReader(page_bio).pages[0])
    writer.write(out_bio)
    return "data:application/pdf;base64," + base64.b64encode(
        out_bio.getvalue()
    ).decode("ascii")


class TestLoadImageClearsSamples:
    """B-11 主钉：`samples` 必须跟着图走。"""

    def test_load_image_clears_samples(self) -> None:
        session = _session_on_hoya_with_samples()
        assert len(session.samples) == 2, "前置：hoya 上应有两条采样层位"

        session.load_image(sample_key="beginner")

        assert session.samples == [], (
            "换图后 samples 未清 —— export_data 会把上一张图的采样深度"
            "当成新图的输出网格（B-11）"
        )

    def test_export_csv_after_image_switch_has_no_stale_samples(self) -> None:
        """用户可见后果：换图后导出的 depth 列不得含上一张图的采样深度。"""
        session = _session_on_hoya_with_samples()
        stale_depths = {5.0, 15.0}

        session.load_image(sample_key="beginner")
        session.detect_columns(BEGINNER_X, BEGINNER_Y, roi_id=session.rois[0]["id"])
        csv_text = session.export_csv()

        rows = [line for line in csv_text.splitlines() if line.strip()]
        assert rows, "前置：导出应有内容"
        assert rows[0].split(",")[0] == "depth"
        exported_depths = {float(row.split(",")[0]) for row in rows[1:]}
        leaked = exported_depths & stale_depths
        assert not leaked, (
            f"换图后导出的 depth 列仍含上一张图的采样深度 {sorted(leaked)}（B-11）"
        )

    def test_switch_pdf_page_clears_samples(self) -> None:
        """PDF 换页内部就是 `load_image`，同一缺陷必须一起覆盖。"""
        session = StraditizeSession()
        session._init_cleanup()
        pdf_data = _three_page_pdf_data_url()
        session.load_image(image_data=pdf_data, page_number=1)
        session.samples = [{"row_px": 50, "depth": 7.0, "source": "manual"}]

        session.switch_pdf_page(2)

        assert session.samples == [], "PDF 换页后 samples 未清（B-11，走 load_image 同一路径）"
        assert session.pdf_info == {"total_pages": 3, "current_page": 2}


class TestLoadImageClearsColumnDerivedState:
    """按 `col_index` 存的派生状态：列重建后旧索引指向的是别的列。"""

    def test_load_image_clears_x_scales_and_reader_types(self) -> None:
        session = _session_on_hoya_with_samples()
        session.x_scales = {0: {"slope": 0.5, "intercept": -100.0}}
        session.reader_types = {0: "line"}

        session.load_image(sample_key="beginner")

        assert session.x_scales == {}, "换图后 x_scales 未清（旧斜率会换算新列）"
        assert session.reader_types == {}, "换图后 reader_types 未清"

    def test_load_image_clears_image_pixel_products(self) -> None:
        """两层提取与刻度带都是上一张图的像素产物。"""
        session = _session_on_hoya_with_samples()
        session.extract_foreground(extraction_mode="solid-over-shadow")
        assert session.shadow_mask is not None, "前置：hoya 上应产出阴影包络"
        session.foreground_column_edges = [0, 100, 200]
        session.tick_band = [900, 909]

        session.load_image(sample_key="beginner")

        assert session.shadow_mask is None, (
            "换图后 shadow_mask 未清 —— 旧尺寸的包络与新图叠加会直接 ValueError"
        )
        assert session.solid_layers is None, (
            "换图后 solid_layers 未清 —— 旧图的像素计数会被当成本图的统计量"
        )
        assert session.foreground_column_edges is None
        assert session.tick_band is None

    def test_load_image_clears_undo_and_redo_stacks(self) -> None:
        """撤销栈存的是旧图快照，留着就能把旧图的列复活到新图上。

        判据不能写成"栈必须为空"：`load_image` 在清栈之后仍会 `roi_create()`
        创建新图 ROI，那一步自己会压一条**属于新图**的历史。真正的判据是
        "栈里不存在任何一张旧图快照"。
        """
        session = _session_on_hoya_with_samples()
        stale_snapshot_count = len(session.undo_stack)
        assert stale_snapshot_count, "前置：detect_columns 应压过历史"
        old_col_count = len(session.columns)

        session.load_image(sample_key="beginner")

        surviving_from_old = [
            snap for snap in session.undo_stack if len(snap.get("columns") or []) == old_col_count
        ]
        assert not surviving_from_old, (
            f"换图后仍有 {len(surviving_from_old)} 条旧图快照留在撤销栈里"
            f"（旧图 {old_col_count} 列），撤销即可跨图复活旧列"
        )
        assert session.redo_stack == [], "换图后 redo_stack 未清"


class TestLoadImageKeepsImageIndependentState:
    """反方向：与当前图像素无关的状态必须存活。"""

    def test_load_image_keeps_paper_metadata(self) -> None:
        session = _session_on_hoya_with_samples()
        session.paper_metadata["publication"]["doi"] = "10.1234/example"

        session.load_image(sample_key="beginner")

        assert session.paper_metadata["publication"]["doi"] == "10.1234/example", (
            "换图后论文元数据被清 —— 它描述论文而非图，换图仍然成立"
        )

    def test_load_image_keeps_age_depth_model_and_ensemble(self) -> None:
        """年代学按**深度值**对齐，与图谱像素无关；Bacon MCMC 可能跑几分钟。"""
        session = _session_on_hoya_with_samples()
        session.age_depth_model = object()
        session.ensemble_tables = [{"name": "Age_Uncertainty_U1000", "data": []}]

        session.load_image(sample_key="beginner")

        assert session.age_depth_model is not None, "换图后年代学模型被清"
        assert session.ensemble_tables, "换图后年龄集合表被清"

    def test_project_new_still_clears_age_depth_state(self) -> None:
        """对照：`project_new` 是"新项目"，年代学状态应当清（语义不同）。"""
        session = _session_on_hoya_with_samples()
        session.age_depth_model = object()
        session.ensemble_tables = [{"name": "t", "data": []}]

        session.project_new(clear_image=False)

        assert session.age_depth_model is None
        assert session.ensemble_tables == {}


class TestGeneratedHistoryIsPerImage:
    """换图后新建的历史必须只含新图的列（防止"看似清了、其实半清"）。"""

    def test_undo_after_switch_does_not_resurrect_old_columns(self) -> None:
        session = _session_on_hoya_with_samples()
        old_col_count = len(session.columns)
        assert old_col_count > 10, "前置：hoya 上应分列出多列"

        session.load_image(sample_key="beginner")
        session.detect_columns(BEGINNER_X, BEGINNER_Y, roi_id=session.rois[0]["id"])
        new_col_count = len(session.columns)
        assert 0 < new_col_count < old_col_count, "前置：两张图的列数应不同"

        # 栈底快照是 `detect_columns` 之前的空列状态，不含 hoya 的列。
        while session.undo_stack:
            session.history_undo()
        assert len(session.columns) <= new_col_count, (
            "撤销到了换图之前的旧图列 —— 跨图快照未被隔离"
        )
