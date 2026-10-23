"""Straditize Core Session Facade managing digitization state and scientific calculations."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
from PIL import Image

from .age_depth import AgeDepthModel
from .session_parts import (
    AGE_DEPTH_BASE_COLUMNS,
    AGE_DEPTH_RATE_COLUMNS,
    AgeDepthSessionMixin,
    CleanupMixin,
    CoreMixin,
    DigitizeSessionMixin,
    ExportMixin,
    LayersMixin,
    MetadataSessionMixin,
    OcrSessionMixin,
    ProjectSessionMixin,
    QaMixin,
    RoiMixin,
    SamplesMixin,
    XTicksMixin,
    _decode_diagram_source,
    build_age_depth_frame,
)

Image.MAX_IMAGE_PIXELS = None

logger = logging.getLogger("straditize_rpc")

__all__ = [
    "StraditizeSession",
    "AGE_DEPTH_RATE_COLUMNS",
    "AGE_DEPTH_BASE_COLUMNS",
    "build_age_depth_frame",
    "_decode_diagram_source",
]


class StraditizeSession(
    CoreMixin,
    RoiMixin,
    CleanupMixin,
    XTicksMixin,
    SamplesMixin,
    LayersMixin,
    QaMixin,
    ExportMixin,
    DigitizeSessionMixin,
    AgeDepthSessionMixin,
    ProjectSessionMixin,
    MetadataSessionMixin,
    OcrSessionMixin,
):
    """Encapsulates the state and processing pipeline of a digitization workflow."""

    def __init__(self) -> None:
        self.image_path: str | None = None
        #: 真实存储位，只由 `image` 这一个 property 的 setter 写入。
        self._image: Image.Image | None = None
        self._image_fingerprint_cache: str | None = None
        self.image_array: np.ndarray | None = None
        self.width: int = 0
        self.height: int = 0
        self.format: str = ""
        self.mode: str = ""

        # Multi-ROI state (managed by RoiMixin)
        self._init_rois()

        # Foreground & Segmentation
        self.foreground_mask: np.ndarray | None = None
        self.threshold: float | None = None
        self.segmentation_mode: str | None = None
        #: Which pixels count as ink -- see ``CoreMixin.extract_foreground``.
        #: Sticky: an implicit re-extraction (column detection, cleanup,
        #: digitising) reuses it instead of silently reverting to Otsu.
        self.extraction_mode: str = "standard"
        #: Band grid used for per-column white points in the two-layer mode.
        self.foreground_column_edges: list[int] | None = None
        #: The exaggeration envelope of a two-layer figure. Never read as data.
        self.shadow_mask: np.ndarray | None = None
        #: Which exportable layers the last two-layer extraction produced.
        self.solid_layers: dict[str, bool] | None = None

        # Grid-line removal (separate from the raw mask so column detection keeps
        # seeing the full ink, and so the removal stays inspectable/undoable).
        self.grid_line_mask: np.ndarray | None = None
        self.candidate_line_mask: np.ndarray | None = None
        self.degrid_line_mask: np.ndarray | None = None
        self.exclusion_mask: np.ndarray | None = None
        self.manual_restore_mask: np.ndarray | None = None
        self.manual_erase_mask: np.ndarray | None = None
        self.cleanup_stats: dict[str, Any] = {}
        self.cleanup_overlay_png: str | None = None
        self.degrid_strength: str | None = None
        self.degrid_remove_vertical: bool = True
        self.degrid_info: dict[str, Any] | None = None
        #: User brush strokes that correct the automatic mask; see
        #: :func:`straditize_core.image.rasterize_strokes`.
        self.line_corrections: list[dict[str, Any]] = []

        # Data Region and Columns
        self.data_xlim: list[float] | None = None
        self.data_ylim: list[float] | None = None
        self.columns: list[dict[str, Any]] = []

        # Digitized points & Control Points per column: col_index -> list/dict
        # column_points: col_index -> list[{"row": int, "x": float, "y": float}]
        self.column_points: dict[int, list[dict[str, float]]] = {}
        # control_points: col_index -> dict[row_int, x_float]
        self.control_points: dict[int, dict[int, float]] = {}
        self.reader_types: dict[int, str] = {}

        # Axes Calibration. ``depth_calib`` records the two pixel/value marks the
        # user picked on the Y axis; it is deliberately NOT derived from
        # ``data_ylim`` -- the ROI is a digitising region, not a timescale.
        self.is_calibrated: bool = False
        self.y_scale: dict[str, float] | None = None  # slope, intercept
        self.x_scales: dict[int, dict[str, float]] = {}  # col_index -> slope, intercept
        self.depth_calib: dict[str, Any] | None = None
        self.depth_unit: str = "cm"

        # Taxa names and Depth Grid
        self.taxa_names: list[str] = []
        self.depth_grid: list[float] = []

        # Age-Depth Chronology integration
        self.age_depth_model: AgeDepthModel | None = None
        self.age_depth_is_calendar_year: bool = True
        self.age_depth_rate_columns: list[str] = []
        self.age_depth_image: Image.Image | None = None
        self.age_depth_image_path: str | None = None

        # Paper Metadata & Ensemble Tables (FAIR Data & LiPD v1.3 Integration)
        self.paper_metadata: dict[str, Any] = {
            "publication": {
                "doi": "",
                "title": "",
                "authors": [],
                "journal": "",
                "year": None,
                "funding_agency": "",
                "funding_grant": "",
            },
            "site": {
                "site_name": "",
                "country": "",
                "latitude": "",
                "longitude": "",
                "elevation_m": "",
                "water_depth_m": "",
                "core_length_m": "",
                "archive_type": "lake sediment",
                "collection_date": "",
            },
            "chronology": {
                "age_model": "",
                "age_range": "",
                "dating_method": "14C",
                "cal_curve": "IntCal20",
            },
            "technical": {
                "pollen_extraction_method": "",
                "laboratory": "",
                "investigators": "",
                "digitizer": "",
                "affiliation": "",
                "digitization_date": "",
                "sampling_interval_cm": "",
            },
            "quality": {
                "quality_notes": "",
                "dataset_version": "1.0.0",
                "original_data_url": "",
            },
        }
        self.ensemble_tables: list[dict[str, Any]] = []

        # Command Undo/Redo stack (max 500 steps per Section 七)
        self.undo_stack: list[dict[str, Any]] = []
        self.redo_stack: list[dict[str, Any]] = []
        self.max_history: int = 500

        # PDF caching fields
        self.cached_pdf_data: bytes | None = None
        self.cached_pdf_path: str | None = None
        self.pdf_info: dict[str, Any] | None = None

    @property
    def image(self) -> Image.Image | None:
        """当前底图。**所有赋值都必须走这个 property**（见 setter 的说明）。"""
        return self._image

    @image.setter
    def image(self, value: Image.Image | None) -> None:
        """设置底图，并**自动作废内容指纹缓存**。

        为什么是 property 而不是"在设图处记得调 `_reset_image_fingerprint()`"：

        `cleanup._geometry_scope()` 用 `_image_fingerprint()` 当图像身份，缓存
        按"当前这张图"保存。一旦换图而缓存没清，scope 就会继续报告上一张图的
        身份，于是 `_geometry_in_scope()` 对所有几何恒返回 True —— **B-03 的跨图
        纵深防御被静默拆掉**（表现为旧图几何在新图上继续剔除墨迹）。

        而"记得去清"正是本项目反复出事的模式：`load_image` 与 `project_new`
        各维护一份手写清单，已经漏过 `line_candidates`（B-03）与 `samples`
        （B-11）。`self.image = ...` 在全仓有 6 处赋值点（load_image 两个分支、
        rotate_image、project_new 清空、project_load 的 tar 分支与 json 分支），
        靠人肉清单必然再漏。

        做成 property 后，**任何**赋值路径都无法绕过作废，包括将来新增的。
        代价只是一次属性转发，可忽略。

        注意：`value is None` 时同样作废缓存 —— 虽然 `_image_fingerprint()`
        在 `image is None` 时会直接返回 None，但让缓存与 `_image` 始终同步，
        才不依赖那个分支的返回值细节。
        """
        self._image = value
        self._image_fingerprint_cache = None
