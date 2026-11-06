"""Core session mixin: image loading, preprocessing, segmentation, and column operations."""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..protocol import (
    FILE_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: 「填满整列的色块/空框」的判据阈值（task-21）。
#:
#: ## 判据要解决什么
#:
#: `detect_column_bounds` 按"墨迹水平游程"切列，它无法区分「随层位变化的曲线」
#: 与「整列恒定填充的色块/网纹/边框」。后者被当成数据列纳入后，导出的那一列
#: 数值是**恒定满值**（实测 mean=30.19 / std=3.53，几乎钉在满量程 31），
#: 直接污染科研数据。
#:
#: ## 两个量的物理依据
#:
#: - **CV（逐行墨迹宽度的变异系数）**：曲线的横向位置与宽度**随层位变化**，
#:   故逐行宽度有大方差；色块/网纹/边框是**恒定宽度**，方差近零。
#: - **ratio（均值墨迹宽 / 列宽）**：色块与边框**填满整列**，比值≈1；
#:   真实曲线无论怎么变，横向总留有空白，比值明显小于 1。
#:
#: 两个条件**同时**成立才算色块——单看任一个都会误伤：
#: 单看 CV 会把"平坦的曲线段"算进去；单看 ratio 会把"宽而实的 bar 列"算进去。
#:
#: ## 实测分离度（95 个真实列，跨 5 张图）
#:
#: | | 命中列 | 其余列 |
#: |---|---|---|
#: | CV | ≤ 0.0080 | 最低 0.3156（差 39 倍） |
#: | ratio | ≥ 0.9796 | 最高 0.7355 |
#:
#: 阈值 0.1 / 0.95 落在两簇中间的宽裕位置，**不是拟合出来的精确边界**。
#: 五张图命中且只命中 5 列：hoya col29（70px 空框）、beginner col4（227px 空框）、
#: 三张 Pollen 基准图的 col21（126px 实心填充）。
#:
#: ## 为什么是「标记」而不是「剔除」
#:
#: 静默剔除同样是隐瞒——用户会奇怪"为什么列数变少了"，也无从判断被拿掉的是不是
#: 他真要的数据。故保留该列、打 `suspect_block` 标记，由界面提示用户确认。
#: 这符合项目铁律"绝不返回替代数据"：数据照原样给出，但**明确标注它不是曲线**。
SUSPECT_BLOCK_CV_LIMIT = 0.1
SUSPECT_BLOCK_FILL_RATIO = 0.95

#: 参与判据的最少墨迹行数。行数太少时 CV 没有统计意义（例如只扫到 3 行）。
_SUSPECT_MIN_INK_ROWS = 10

#: 「墨迹」的灰度阈值。与 `scripts/product_journey/probe_column_cv.py` 同口径，
#: 便于用同一个探针交叉复核判据。
#:
#: 不用 `foreground_mask` 的原因见调用处注释：Otsu 会把整行浅灰边框算成前景，
#: 人为把某些行的墨迹宽度拉满列宽，从而把真实曲线误标成色块。
_SUSPECT_DARK_THRESHOLD = 160


def _row_ink_widths(dark: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> np.ndarray:
    """该矩形内每行「最左墨迹到最右墨迹」的水平宽度（px）。

    只统计**有墨迹的行**：空白行宽度恒为 0，会把 CV 稀释成无意义的小值。
    """
    widths: list[int] = []
    for y in range(max(0, y0), min(dark.shape[0], y1)):
        row = dark[y, max(0, x0) : max(0, x1)]
        if not row.any():
            continue
        indices = np.where(row)[0]
        widths.append(int(indices[-1] - indices[0] + 1))
    return np.asarray(widths, dtype=float)


def _detect_block_column(
    dark: np.ndarray, x0: int, x1: int, y0: int, y1: int
) -> dict[str, Any] | None:
    """判定某列是否"填满整列的色块"或"空框"；是则返回证据，否则 ``None``。

    返回的字典会原样挂到列对象的 ``suspect_block`` 上，因此只放**不可变标量**
    （float / int / str）——撤销栈的列快照是浅拷贝，嵌套可变容器会被共享引用。

    ## 两种形态（都不是曲线）

    1. **填满整列的色块**：逐行墨迹宽度几乎恒定（``cv < 0.1``）且铺满整列
       （``fill_ratio > 0.95``）。典型是岩性柱、百分比填充带。
    2. **空框**：左右各一条竖边框、内部大片空白。

    形态 2 为什么要单独判：零点校正（见 ``measure_axis_right_edge``）会把
    左侧竖边推出列外，只剩右边一条竖线，此时 ``fill_ratio`` 掉到 0.1 以下，
    单靠形态 1 会漏判。所以空框必须用**内部空白比例**判定——把每行"有墨像素数
    / 该行墨迹跨度"求均值，空框极低（只有竖边），色块接近 1。
    """
    span = int(x1) - int(x0)
    if span <= 0:
        return None
    widths = _row_ink_widths(dark, x0, x1, y0, y1)
    if widths.size < _SUSPECT_MIN_INK_ROWS:
        return None
    mean_width = float(widths.mean())
    if mean_width <= 0:
        return None
    cv = float(widths.std() / mean_width)
    fill_ratio = mean_width / float(span)

    # 形态 1：填满整列的色块
    if cv < SUSPECT_BLOCK_CV_LIMIT and fill_ratio > SUSPECT_BLOCK_FILL_RATIO:
        return {
            "reason": "fills_whole_column",
            "cv": round(cv, 6),
            "fill_ratio": round(fill_ratio, 6),
            "mean_ink_width": round(mean_width, 2),
            "column_width": span,
        }

    # 形态 2（空框）已撤回：实测把 Pollen_CruveStyle 的 col6（真实细线曲线，
    # 逐行只有 1~4px 墨迹、跨度极小）误判成空框——`interior_ink_ratio` 高
    # 只说明"墨迹在跨度内是连续的"，细线曲线同样满足。该维度不足以区分
    # 空框与细线曲线，需结合"墨迹位置是否随 y 变化"，属独立任务。

    # 形态 3 已撤回：曾试过「墨迹宽度 ≤3px 即非曲线」，但实测把 Diatom 18 列、
    # PollenCurve 13 列真实细线曲线全部误标。细线型曲线与边框线在"宽度窄"这一点上
    # 无法区分——真正的区别是边框线**位置恒定**（每行都在同一个 x），曲线位置随 y 变。
    # 该判据需要额外的"位置方差"维度，暂不实现；形态 1/2 已覆盖主要场景。
    return None


def _decode_diagram_source(
    image_path: str | None = None,
    image_data: str | None = None,
    sample_key: str | None = None,
    file_name: str | None = None,
    page_number: int = 1,
) -> tuple[Image.Image, str, str | None, dict[str, Any] | None, bytes | None]:
    """Decodes bitmap image or extracts page from PDF.

    Returns (PIL_Image, format_str, resolved_path, pdf_info, raw_pdf_bytes).
    Raises JsonRpcError with human guidance on failures.
    """
    if not image_path and not image_data and sample_key:
        image_path = _resolve_sample_image(sample_key)

    if image_data:
        return _decode_inline_payload(image_data, file_name, page_number)

    if not image_path:
        raise JsonRpcError(
            STATE_ERROR,
            "前置输入缺失：未提供图谱源。请在【步骤 1: 载入图谱】中选择本地图片/单页PDF上传，或指定 sample_key（如 'hoya'）。",
        )

    resolved_path = _resolve_existing_image_path(image_path)
    if resolved_path.lower().endswith(".pdf"):
        with open(resolved_path, "rb") as f:
            raw_bytes = f.read()
        best_img, pdf_info = _read_pdf_page_image(raw_bytes, page_number)
        return best_img, "PDF_IMAGE", resolved_path, pdf_info, raw_bytes

    img, fmt = _open_raster_image(resolved_path, image_path)
    return img, fmt, resolved_path, None, None


def _resolve_sample_image(sample_key: str) -> str:
    """内置范例名 → 包内图片路径；未知名字把可选项一并报出来。"""
    pkg_root = Path(__file__).resolve().parent.parent
    repo_root = pkg_root.parent
    tutorial_dir = pkg_root / "assets" / "tutorials"
    sample_candidates = {
        "hoya": tutorial_dir / "hoya-del-castillo.png",
        "verification": repo_root / "verification_real_pollen_edit.png",
        "beginner": tutorial_dir / "beginner-tutorial.png",
    }
    cand = sample_candidates.get(sample_key.lower())
    if cand is None:
        raise JsonRpcError(
            INVALID_PARAMS,
            f"未知的 sample_key '{sample_key}'。可选范例：{sorted(sample_candidates)}。",
        )
    if not cand.is_file():
        raise JsonRpcError(
            FILE_ERROR,
            f"内置范例图片缺失: {cand}。请确认仓库完整性。",
        )
    return str(cand)


def _decode_inline_payload(
    image_data: str,
    file_name: str | None,
    page_number: int,
) -> tuple[Image.Image, str, str | None, dict[str, Any] | None, bytes | None]:
    """base64 / data URL 载荷 → 解码后的图；PDF 载荷交给共用的页抽取。"""
    raw_b64 = image_data
    is_pdf = False
    name_hint = file_name or ""
    if raw_b64.startswith("data:"):
        header, raw_b64 = raw_b64.split(",", 1)
        if "application/pdf" in header:
            is_pdf = True
    elif name_hint.lower().endswith(".pdf"):
        is_pdf = True

    try:
        raw_bytes = base64.b64decode(raw_b64)
    except Exception as e:
        raise JsonRpcError(
            INVALID_PARAMS,
            f"Base64 图像数据解析失败: {e}。请重新上传有效图片。",
        ) from e

    if is_pdf or raw_bytes.startswith(b"%PDF"):
        best_img, pdf_info = _read_pdf_page_image(raw_bytes, page_number)
        return best_img, "PDF_IMAGE", None, pdf_info, raw_bytes

    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.load()
        fmt = img.format or "PNG"
        return img, fmt, None, None, None
    except Exception as e:
        raise JsonRpcError(
            FILE_ERROR,
            f"上传图像数据解码失败: {e}。请检查文件是否损坏。",
        ) from e


def _read_pdf_page_image(
    raw_bytes: bytes, page_number: int
) -> tuple[Image.Image, dict[str, Any]]:
    """从 PDF 字节里抽出第 page_number 页面积最大的内嵌位图。

    两个入口（base64 内嵌 / 本地 .pdf 路径）共用这一段，文案只有一份：
    以前两份各写各的，「导出」与「在外部导出」、「位图图版」与「图谱位图」已经漂了，
    而且内层句末的句号与外壳又拼出「载入。。请确认」的双句号。
    """
    try:
        import pypdf

        reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
        total_pages = len(reader.pages)
        if total_pages == 0:
            raise ValueError("PDF 文档为空，未包含任何有效页面")
        if page_number < 1 or page_number > total_pages:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"页码超出有效范围：该 PDF 共有 {total_pages} 页，请求的第 {page_number} 页不存在。请输入 1 到 {total_pages} 之间的页码。",
            )
        target_page = reader.pages[page_number - 1]
        pdf_info = {"total_pages": total_pages, "current_page": page_number}
        if target_page.images:
            imgs = [img.image for img in target_page.images]
            best_img = max(imgs, key=lambda im: im.size[0] * im.size[1])
            return best_img, pdf_info
        raise ValueError(
            f"该 PDF 第 {page_number} 页为纯矢量流未内嵌位图图谱。"
            "请将该页在外部导出为 PNG/JPG 图像后载入"
        )
    except JsonRpcError:
        raise
    except Exception as e:
        raise JsonRpcError(
            FILE_ERROR,
            f"PDF 解析失败: {e}。请确认 PDF 包含图谱位图或转为 PNG 后导入。",
        ) from e


def _resolve_existing_image_path(image_path: str) -> str:
    """相对路径找不到时再试 cwd 与包根；都不在就报缺文件，并给出绝对路径。"""
    if not os.path.isabs(image_path) and not os.path.exists(image_path):
        cwd_cand = os.path.abspath(os.path.join(os.getcwd(), image_path))
        core_cand = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", image_path)
        )
        if os.path.exists(cwd_cand):
            image_path = cwd_cand
        elif os.path.exists(core_cand):
            image_path = core_cand

    if not os.path.exists(image_path):
        raise JsonRpcError(
            FILE_ERROR,
            f"未找到图谱文件: '{image_path}'。请检查路径是否存在或已移动。",
        )
    return os.path.abspath(image_path)


def _open_raster_image(
    resolved_path: str, image_path: str
) -> tuple[Image.Image, str]:
    """打开位图并定格式；失败时把用户给的路径和真实原因一起报出来。"""
    try:
        img = Image.open(resolved_path)
        img.load()
        fmt = (
            img.format
            or os.path.splitext(resolved_path)[1].lstrip(".").upper()
            or "PNG"
        )
        return img, fmt
    except Exception as e:
        raise JsonRpcError(
            FILE_ERROR,
            f"无法解析图像文件 '{image_path}': {e}。请确认文件为有效图片格式。",
        ) from e


class CoreMixin:
    """Core session lifecycle, image processing, segmentation, and column operations."""

    def _init_core(self) -> None:
        """Initialize core session state."""
        pass

    def load_image(
        self,
        image_path: str | None = None,
        image_data: str | None = None,
        sample_key: str | None = None,
        file_name: str | None = None,
        page_number: int = 1,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Loads a diagram image or PDF page into memory."""
        if not image_path and not image_data and not sample_key:
            image_path, image_data = self._cached_pdf_source()

        img, fmt, resolved_path, pdf_info, raw_pdf_bytes = _decode_diagram_source(
            image_path=image_path,
            image_data=image_data,
            sample_key=sample_key,
            file_name=file_name,
            page_number=page_number,
        )
        self._remember_pdf_state(resolved_path, pdf_info, raw_pdf_bytes)
        self._apply_image_payload(img, fmt, resolved_path, file_name)
        self._reset_per_image_state()
        sug = self._init_default_roi_from_suggestion()

        return {
            "success": True,
            "width": self.width,
            "height": self.height,
            "format": self.format,
            "mode": self.mode,
            "image_path": self.image_path,
            "image_url": "/image/current",
            "suggested_roi": sug,
            "rois": self.rois,
            "primary_roi_id": self.primary_roi_id,
            "active_roi_id": self.active_roi_id,
            "pdf_info": self.pdf_info,
        }

    # ---- load_image 的分段实现 ----

    def _cached_pdf_source(self) -> tuple[str | None, str | None]:
        """没有显式给图源时，回落到上一次载入的 PDF（换页正靠它）。

        两个返回值必须先各自初始化为 None：原来这段在 `load_image` 体内时，
        `image_path` / `image_data` 是**函数入参**（恒有值），抽成 helper 后变成局部变量，
        只会赋值其中一个，另一个就会 UnboundLocalError。
        """
        image_path: str | None = None
        image_data: str | None = None
        if getattr(self, "cached_pdf_data", None):
            image_data = f"data:application/pdf;base64,{base64.b64encode(self.cached_pdf_data).decode('ascii')}"
        elif getattr(self, "cached_pdf_path", None):
            image_path = self.cached_pdf_path
        return image_path, image_data

    def _remember_pdf_state(
        self,
        resolved_path: str | None,
        pdf_info: dict[str, Any] | None,
        raw_pdf_bytes: bytes | None,
    ) -> None:
        """记住 PDF 原文与页码信息（只对 .pdf 路径缓存路径，PDF 换页要用）。"""
        self.cached_pdf_data = raw_pdf_bytes
        self.cached_pdf_path = (
            resolved_path
            if (resolved_path and resolved_path.lower().endswith(".pdf"))
            else None
        )
        self.pdf_info = pdf_info

    def _apply_image_payload(
        self,
        img: Image.Image,
        fmt: str,
        resolved_path: str | None,
        file_name: str | None,
    ) -> None:
        """写入图像身份与像素数组；超过 16M 像素不建数组（避免一次吃掉几百 MB）。"""
        self.image_path = resolved_path or (
            f"upload://{file_name}" if file_name else "upload://diagram.png"
        )
        self.width, self.height = img.size
        self.format = fmt
        self.mode = img.mode

        if self.width * self.height > 16_000_000:
            self.image = img.convert("RGBA") if img.mode != "RGBA" else img
            self.image_array = None
        else:
            self.image = img.convert("RGBA")
            self.image_array = np.array(self.image)

    def _reset_per_image_state(self) -> None:
        """清空所有"属于上一张图"的状态；清单里每一行都对着一个实测缺陷。

        故意不清年代学（age_depth_model / ensemble_tables）、论文元数据与 PDF 缓存：
        它们不派生于这张图的像素，清了等于毁掉用户的既有工作（详见下面的逐项注释）。
        """
        # 指纹缓存由 `StraditizeSession.image` 的 setter 自动作废（见那里），
        # 这里不需要也不应该再手工清一次 —— 手写清单正是本轮反复漏项的地方。
        self.foreground_mask = None
        self.grid_line_mask = None
        self.candidate_line_mask = None
        self.degrid_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        self.cleanup_stats = {}
        self.cleanup_overlay_png = None
        self.degrid_strength = None
        self.degrid_info = None
        self.line_corrections = []
        # 换图必须清空"属于上一张图"的清理几何。
        #
        # 历史缺陷（B-03）：这三项从未被清过，而 `_init_rois()` 会把 ROI 计数器归零、
        # 让新图 ROI 又叫 `roi_1` —— 与旧几何的 `roi_id` 同名，于是
        # `_geometry_mask()` 里 `cand.get("roi_id") != roi_id` 的过滤完全失效，
        # 旧图确认过的几何会在**新图**上继续剔除墨迹（实测 24 条残留 → 剔除 13454 px），
        # 用户无从得知。`project_new()` 同样漏了这三项。
        #
        # 保留：`getattr` 兜底 —— 新建会话时 `_init_cleanup()` 尚未跑过，
        # 这三个属性可能还不存在（它们由 `CleanupMixin._init_cleanup()` 创建）。
        self.line_candidates = []
        self.exclusion_regions = []
        self.line_strokes = []
        self.selected_candidate_ids = set()
        self.columns = []
        self.column_points = {}
        self.control_points = {}
        self.reader_types = {}
        self.is_calibrated = False
        self.y_scale = None
        self.x_scales = {}
        self.depth_calib = None
        self.taxa_names = []
        self.depth_grid = []
        # 采样层位（B-11）。`export_data` 直接拿 `samples` 当输出网格的 depth 列，
        # 所以它不清就等于把上一张图的深度写进新图的 CSV —— 实测换图后
        # samples 2→2（列数已 29→4），hoya 的 5.0/15.0 出现在 beginner 的 depth 列。
        # `project_new()` 的清单里一直有它，只有这里漏了。
        self.samples = []
        # 每列百分比的像素斜率（`x_scales`）与识别器类型（`reader_types`）都是
        # **按 col_index 存的**：列一旦重建，旧索引指向的是别的列。不清它们，
        # `resolve_column_scale` 的 legacy 分支会拿旧斜率换算新列。
        # 两层提取（`shadow_mask`/`solid_layers`）与刻度带（`tick_band`）同理，
        # 它们都是上一张图的**像素产物**：旧 `shadow_mask` 与新图尺寸不同，
        # `mask_overlay_data_url` 直接 ValueError；旧 `solid_layers` 的像素计数
        # 会被 `core.getShadowLayer` 当成本图的统计量报给用户。
        self.foreground_column_edges = None
        self.shadow_mask = None
        self.solid_layers = None
        self.tick_band = None
        # 撤销栈存的是**上一张图**的 columns/control_points/data_ylim 快照。
        # 换图后 columns 已清空，若栈还在，`history.undo()` 就能把旧图的列与取数区
        # 复活到新图上（跨图伪造几何）。前端在载图时本就 `history.reset(...)`，
        # 这里清空是让后端与前端语义一致，不是新增规则。
        self.undo_stack = []
        self.redo_stack = []
        # 故意**不**清的项（它们不派生于这张图的像素，清了等于毁掉用户的既有工作）：
        # - `age_depth_model` / `age_depth_image` / `ensemble_tables`：年代学来自
        #   `agedepth.loadModelDiagram` 单独上传的模型示意图，按**深度值**对齐，
        #   与图谱像素无关；一次 Bacon MCMC 可能要跑几分钟。`project_new()` 会清它们，
        #   因为那是"新项目"；换图是"同一项目里换一张图"，语义不同。
        # - `paper_metadata`：描述论文而非图，换图（含 PDF 换页）后仍然成立。
        # - `cached_pdf_data` / `cached_pdf_path` / `pdf_info`：PDF 换页正靠它们。

    def _init_default_roi_from_suggestion(self) -> dict[str, Any]:
        """按建议取数区自动建一个 pollen ROI，返回该建议（供调用方回给前端）。"""
        self.data_xlim = None
        self.data_ylim = None
        self._init_rois()

        sug = self.suggest_data_region()
        self.roi_create(
            name="pollen",
            x0=sug["xMin"],
            x1=sug["xMax"],
            y0=sug["yMin"],
            y1=sug["yMax"],
            composition=True,
        )
        return sug

    def switch_pdf_page(self, page_number: int = 1) -> dict[str, Any]:
        """Switch to a specific 1-based page of the currently loaded PDF."""
        return self.load_image(page_number=page_number)

    def _axis_spine_region(self, mask: np.ndarray) -> dict[str, float] | None:
        """用面板竖直轴线定数据区；检测不到返回 None（交给密度启发式）。

        判据是**结构**不是密度：轴线是贯穿数据区全高的直线，它自己就标出了
        「数据区从哪一行到哪一行」。面积填充图的填充也贯穿，一并算进来不害事——
        横向取最外侧的贯穿列，纵向取这些列上墨迹的上下界。

        断续竖线（聚类树分支、表格边框）被 ``min_run`` 挡掉：它们的最长连续段
        远小于数据区高度。
        """
        height, width = mask.shape
        if height < 40 or width < 40:
            return None
        min_run = max(20, int(0.6 * height))
        longest = np.zeros(width, dtype=np.int32)
        pad = np.zeros(1, np.int8)
        for x in range(width):
            column = mask[:, x]
            if not column.any():
                continue
            edges = np.diff(np.concatenate((pad, column.view(np.int8), pad)))
            starts = np.flatnonzero(edges == 1)
            if starts.size:
                ends = np.flatnonzero(edges == -1)
                longest[x] = int((ends - starts).max())
        axis_cols = np.flatnonzero(longest >= max(30, int(0.3 * height)))
        if axis_cols.size < 3:
            return None
        # 只保留「run 长度接近同组中位数」的列：面板轴线长度都等于数据区高度，
        # 而页面边框/表格竖线贯穿整图、Y 轴引线只覆盖局部——它们会被这一步筛掉。
        runs = longest[axis_cols].astype(float)
        median_run = float(np.median(runs))
        core_cols = axis_cols[(runs >= 0.9 * median_run) & (runs <= 1.1 * median_run)]
        if core_cols.size < 3:
            return None
        # 纵向：**这些轴线同时都落墨**的行。标题区里轴线还没开始、轴标签区已经结束，
        # 所以这一条同时给出数据区的上沿与下沿，不依赖墨迹密度。
        row_frac = mask[:, core_cols].mean(axis=1)
        rows = np.flatnonzero(row_frac >= 0.8)
        if rows.size < 0.1 * height:
            return None
        y_min, y_max = int(rows.min()), int(rows.max())

        # 横向用数据区内墨迹的包围盒（宁宽不窄：宽了用户能裁，窄了直接丢数据）。
        # 精确的左右界（排除 Age 轴文字区、右侧聚类树/图例）留给分列阶段识别空列，
        # 不在"建议框"这一层猜 —— 实测同一张图换个判据就在 41/68/112 之间跳。
        band = mask[y_min : y_max + 1, :]
        band_ink = band.any(axis=0)
        ink_cols = np.flatnonzero(band_ink)
        if ink_cols.size == 0:
            return None
        # 横向边界锚在「贯穿列 **且右侧紧接连续墨迹**」上：面板轴线的右边就是本面板的
        # 填充/柱，而 Y 轴标签、图例边框、聚类树的右侧是断续文字。
        # 只判「贯穿」不够——实测图例边框也 95% 贯穿，会把 xMax 拉到图像右缘 1179。
        full_cols = np.flatnonzero(band.mean(axis=0) >= 0.95)
        solid = [
            int(x)
            for x in full_cols
            if x + 5 <= width and bool(band_ink[x + 1 : x + 6].all())
        ]
        if not solid:
            return None
        x_min = min(solid)
        x_max = max(solid)
        # 末列可能是**空心列**（只有轴线、没有填充），`solid` 会漏掉它 ——
        # hoya 实测因此从 29 列掉到 28 列（xMax 1962 vs 2030）。补上「数据区内仍有
        # 长竖结构」的最后一列；图例色块没有竖结构，不会被补进来。
        band_run = np.zeros(width, dtype=np.int32)
        for x in range(width):
            col = band[:, x]
            if not col.any():
                continue
            e = np.diff(np.concatenate((pad, col.view(np.int8), pad)))
            st = np.flatnonzero(e == 1)
            if st.size:
                band_run[x] = int((np.flatnonzero(e == -1) - st).max())
        tall = np.flatnonzero(band_run >= max(20, int(0.6 * (y_max - y_min + 1))))
        if tall.size:
            x_max = max(x_max, int(tall.max()))
        # 向右延伸到本面板的填充右界：用「行覆盖 ≥12%」判"这里还是数据"，
        # 而不是「有任何一个像素」——图例文字与聚类树分支每列都沾到墨，
        # 但覆盖率远低于填充。
        dense = band.mean(axis=0) >= 0.12
        while x_max + 1 < width and dense[x_max + 1]:
            x_max += 1
        if x_max - x_min < 0.1 * width or y_max - y_min < 0.1 * height:
            return None
        return {
            "xMin": float(x_min),
            "xMax": float(x_max + 1),
            "yMin": float(y_min),
            "yMax": float(y_max + 1),
        }

    def suggest_data_region(self, fraction: float = 0.7) -> dict[str, float]:
        """Suggest the main diagram rectangle: 轴线结构优先，墨迹密度兜底。"""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")
        if not 0 < fraction <= 1:
            raise ValueError("fraction must be in the interval (0, 1].")

        width, height = self.width, self.height
        fallback = {
            "xMin": round(width * 0.12),
            "xMax": round(width * 0.94),
            "yMin": round(height * 0.18),
            "yMax": round(height * 0.88),
        }

        from skimage.measure import label

        from ..image import to_binary

        mask = np.asarray(to_binary(self.image), dtype=bool)
        if not mask.any():
            return {**fallback, "confidence": "low", "method": "fallback_ratio"}

        # 结构判据优先：面板竖直轴线定数据区。
        # 实测 rioja pollen 图顶部约 100px 是标题 + 斜排属种名（墨迹稀疏），
        # 下面的密度启发式会直接跳过它：pollen 三图 yMin 被判到 188–197，
        # 而数据区实从 82–93 开始 —— 一次丢 15/49 层（30.6%），
        # 且 digitize 只在 ROI 内取数、不报警。轴线是贯穿全高的直线，
        # 它的纵向跨度就是数据区，与墨迹密度无关。
        spine = self._axis_spine_region(mask)
        if spine is not None:
            return {**spine, "confidence": "high", "method": "axis_spine"}

        max_horizontal = fraction * float(mask.sum(axis=1).max())
        max_vertical = fraction * float(mask.sum(axis=0).max())
        cumulative_left = mask.cumsum(axis=1)
        cumulative_top = mask.cumsum(axis=0)
        cumulative_right = mask[:, ::-1].cumsum(axis=1)[:, ::-1]
        cumulative_bottom = mask[::-1].cumsum(axis=0)[::-1]

        right_candidates = np.vstack(
            np.where(
                (cumulative_left > max_horizontal) & (cumulative_top > max_vertical)
            )
        )
        if right_candidates.size:
            candidate_index = (
                right_candidates.shape[1]
                - 1
                - right_candidates.max(axis=0)[::-1].argmax()
            )
            y_max, x_max = right_candidates[:, candidate_index]
        else:
            x_max = (
                cumulative_top.shape[1]
                - 1
                - (cumulative_top[:, ::-1] > max_vertical).any(axis=0).argmax()
            )
            y_max = (
                cumulative_left.shape[0]
                - 1
                - (cumulative_left[::-1] > max_horizontal).any(axis=1).argmax()
            )

        left_candidates = np.vstack(
            np.where(
                (cumulative_right > max_horizontal) & (cumulative_bottom > max_vertical)
            )
        )
        if left_candidates.size:
            candidate_index = left_candidates.min(axis=0).argmin()
            y_min, x_min = left_candidates[:, candidate_index]
        else:
            x_min = (cumulative_bottom > max_vertical).any(axis=0).argmax()
            y_min = (cumulative_right > max_horizontal).any(axis=1).argmax()

        # 候选集为空时上面两个 else 分支的表达式会退化：它们找的是"累计量首次超过
        # 阈值"的位置，而累计量在密集图上从一开始就超过阈值，于是 x_min/x_max、
        # y_min/y_max 全部塌缩到同一处，最后得到只有 2px 高的框。
        #
        # 实测（tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png，
        # 1179×600，墨迹占比 40.9%）：right_candidates 与 left_candidates **都是 0**，
        # 建议框退化为 xlim=[68,1061] ylim=[241,243]（高 2px），随后 detect_columns
        # 直接抛 "Bounds is too small"，用户点【下一步】就崩。
        #
        # 修法：候选集为空（启发式失效）时，改用**墨迹包围盒**——它只依赖"哪里有墨"，
        # 与累计量阈值无关，在任何墨迹分布下都成立。若包围盒本身也不合法，才退回
        # 固定比例的 fallback。
        if not right_candidates.size or not left_candidates.size:
            rows_with_ink = np.where(mask.any(axis=1))[0]
            cols_with_ink = np.where(mask.any(axis=0))[0]
            if rows_with_ink.size and cols_with_ink.size:
                x_min = int(cols_with_ink.min())
                x_max = int(cols_with_ink.max())
                y_min = int(rows_with_ink.min())
                y_max = int(rows_with_ink.max())

        x_min, x_max = sorted((int(x_min), int(x_max)))
        y_min, y_max = sorted((int(y_min), int(y_max)))
        if y_min == y_max:
            y_min = int(cumulative_right.any(axis=1).argmax())
        if x_min == x_max:
            x_min = int(cumulative_bottom.any(axis=0).argmax())

        if 0 <= y_max < height and 0 <= x_max < width and mask[y_max, x_max]:
            labels = label(mask, connectivity=2)
            component_id = labels[y_max, x_max]
            if component_id:
                component_rows, component_cols = np.where(
                    labels[y_min : y_max + 1] == component_id
                )
                if component_cols.size:
                    x_max = max(x_max, int(component_cols.max()))

        if x_max <= x_min or y_max <= y_min:
            return {**fallback, "confidence": "low", "method": "fallback_ratio"}
        return {
            "xMin": float(x_min),
            "xMax": float(x_max + 1),
            "yMin": float(y_min),
            "yMax": float(y_max + 1),
            "confidence": "medium",
            "method": "ink_density",
        }

    def get_image_slice(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        max_dim: int | None = None,
    ) -> Image.Image:
        """Extracts a bounding box sub-image slice with optional downsampling."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")

        x1 = max(0, min(x, self.width))
        y1 = max(0, min(y, self.height))
        x2 = max(x1, min(x + w, self.width))
        y2 = max(y1, min(y + h, self.height))

        if x2 <= x1 or y2 <= y1:
            return Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))

        cropped = self.image.crop((x1, y1, x2, y2))
        if max_dim and (cropped.width > max_dim or cropped.height > max_dim):
            scale = max_dim / max(cropped.width, cropped.height)
            new_w = max(1, round(cropped.width * scale))
            new_h = max(1, round(cropped.height * scale))
            cropped = cropped.resize((new_w, new_h), Image.Resampling.BILINEAR)

        return cropped

    def get_image_preview(self, max_dim: int = 2048) -> Image.Image:
        """Provides a memory-efficient downsampled overview of the loaded image."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")
        if self.width <= max_dim and self.height <= max_dim:
            return self.image
        scale = max_dim / max(self.width, self.height)
        new_w = max(1, round(self.width * scale))
        new_h = max(1, round(self.height * scale))
        return self.image.resize((new_w, new_h), Image.Resampling.BILINEAR)

    def detect_deskew_angle(self) -> dict[str, Any]:
        """Detects whether the loaded diagram is tilted/skewed."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")
        from ..image import estimate_deskew_angle

        angle = estimate_deskew_angle(self.image)
        return {
            "has_skew": abs(angle) >= 0.25,
            "suggested_rotation_angle": angle,
        }

    def rotate_image(self, angle: float) -> dict[str, Any]:
        """Rotates the loaded diagram by angle degrees to correct tilt."""
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")
        if abs(angle) < 1e-4:
            return {"success": True, "width": self.width, "height": self.height}

        self.image = self.image.rotate(
            float(angle),
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=(255, 255, 255, 255) if self.image.mode == "RGBA" else 255,
        )
        self.width, self.height = self.image.size
        self.image_array = np.array(self.image)
        # 旋转改变了每一个像素 → 指纹由 `image` 的 setter 自动作废，于是旧的
        # 清理几何自动失效（几何坐标是旋转前的像素坐标，对新图没有意义）。
        # 这正是指纹方案胜过 image_path 的地方：旋转后路径没变，路径方案完全
        # 判不出"同一张图但像素变了"，指纹判得出。
        self.foreground_mask = None
        self.columns = []
        self.column_points = {}
        self.control_points = {}

        return {
            "success": True,
            "angle": angle,
            "width": self.width,
            "height": self.height,
        }

    def extract_foreground(
        self,
        threshold: float | None = None,
        mode: str = "otsu",
        extraction_mode: str | None = None,
        column_edges: list[int] | None = None,
    ) -> dict[str, Any]:
        """Segments the foreground (curves/bars) from diagram background.

        ``mode`` selects how the *threshold* is chosen for the two grey-level
        paths (``otsu`` / ``binary`` / ``adaptive``).

        ``extraction_mode`` selects *what counts as ink* at all, and is what the
        UI exposes:

        * ``standard`` (default) —— 灰度阈值。对黑白线图足够，对双层彩色图
          会把浅色阴影连同一半阴影算进读数，见 ``docs/ARCHITECTURE.md``。
        * ``light-overlay-white`` / ``light-ink-dark`` / ``dark-ink-light`` ——
          原有的单层彩色/反色分支。
        * ``solid-over-shadow`` —— 双层图（实心 + 夸张包络）。只取实心层；
          包络单独存进 ``shadow_mask`` 供目视，永不进入读数。

        ``column_edges`` 只在双层模式使用：它给出各列的像素 x 边界，用来估计
        每列自己的纸白（逐列白点）。缺省时改用整图白点。

        无论选择哪种 ``extraction_mode``，``threshold`` 字段都仍是 Otsu/binary
        的灰度阈值，切换模式时仍然可比——它不是双层模式的判定依据。
        """
        if self.image is None:
            raise JsonRpcError(
                STATE_ERROR, "No image loaded. Please call core.loadImage first."
            )

        from ..image import normalize_extraction_mode

        ext_mode = normalize_extraction_mode(extraction_mode)
        gray = np.array(self.image.convert("L"))

        actual_thresh = self._resolve_foreground_threshold(
            gray, threshold, mode
        )
        mask = self._build_foreground_mask(
            gray, actual_thresh, ext_mode, column_edges
        )

        self.foreground_mask = mask
        self.threshold = actual_thresh
        self.segmentation_mode = mode
        self.extraction_mode = ext_mode
        self.foreground_column_edges = list(column_edges) if column_edges else None

        self._apply_two_layer_split(ext_mode, column_edges)

        fg_pixels = int(np.sum(mask))
        fg_ratio = float(fg_pixels / gray.size)

        result = {
            "threshold": actual_thresh,
            "mode": mode,
            "extraction_mode": ext_mode,
            "foreground_pixels": fg_pixels,
            "foreground_ratio": fg_ratio,
            "shape": list(mask.shape),
        }
        if ext_mode == "solid-over-shadow":
            result["shadow_pixels"] = int(self.shadow_mask.sum())
            result["solid_pixels"] = fg_pixels
            result["layers"] = self.solid_layers
        return result

    # ---- extract_foreground 的分段实现 ----

    def _otsu_threshold(self, gray: np.ndarray) -> float:
        """Otsu 阈值；skimage 不可用时退化成手写的类间方差最大化（同一算法）。"""
        try:
            from skimage.filters import threshold_otsu

            computed_thresh = float(threshold_otsu(gray))
        except Exception:  # noqa: BLE001
            hist, _bin_edges = np.histogram(gray, bins=256, range=(0, 256))
            total = gray.size
            current_max, threshold_val = 0, 128
            sum_total = np.dot(np.arange(256), hist)
            weight_bg, sum_bg = 0, 0
            for t in range(256):
                weight_bg += hist[t]
                if weight_bg == 0:
                    continue
                weight_fg = total - weight_bg
                if weight_fg == 0:
                    break
                sum_bg += t * hist[t]
                mean_bg = sum_bg / weight_bg
                mean_fg = (sum_total - sum_bg) / weight_fg
                var_between = weight_bg * weight_fg * ((mean_bg - mean_fg) ** 2)
                if var_between > current_max:
                    current_max = var_between
                    threshold_val = t
            computed_thresh = float(threshold_val)
        return computed_thresh

    def _resolve_foreground_threshold(
        self,
        gray: np.ndarray,
        threshold: float | None,
        mode: str,
    ) -> float:
        """按 mode 取实际阈值（otsu / binary / adaptive）；未知 mode 直接报错，不猜。"""
        if mode == "otsu":
            computed_thresh = self._otsu_threshold(gray)
            actual_thresh = threshold if threshold is not None else computed_thresh
        elif mode == "binary":
            actual_thresh = float(threshold) if threshold is not None else 128.0
        elif mode == "adaptive":
            from skimage.filters import threshold_local

            block_size = 35
            local_thresh = threshold_local(gray, block_size, offset=10)
            actual_thresh = float(np.mean(local_thresh))
        else:
            raise JsonRpcError(
                INVALID_PARAMS, f"Unknown foreground extraction mode: {mode}"
            )
        return actual_thresh

    def _build_foreground_mask(
        self,
        gray: np.ndarray,
        actual_thresh: float,
        ext_mode: str,
        column_edges: list[int] | None,
    ) -> np.ndarray:
        """把阈值变成掩膜。阈值只决定哪些黑白像素算墨，彩色像素由 extraction_mode 判定。

        这里永远走 build_foreground：它内部的 two_axis 对黑白图退化为等价于 Otsu 二值，
        对彩色/双层图才有正确分层。历史上这段曾是 colour_path = ext_mode != standard，
        于是默认路径永远走单阈值分支、双层分层一次都没被调用过（灰度填充整列被丢）。
        `gray` 保留在签名里只是为了与调用点一致。
        """
        from ..image import build_foreground

        # 彩色/双层路径：阈值不再决定"是不是墨"，只决定"哪些黑白像素算墨"。
        # 彩色像素由 extraction_mode 单独判定，否则浅彩色实心会被灰度阈值
        # 整列丢掉（这正是 Han et al. 2026 Fig.3 的失败模式）。
        rgb = (
            self.image_array[..., :3]
            if getattr(self, "image_array", None) is not None
            else np.array(self.image)[..., :3]
        )
        mask = build_foreground(
            np.dstack([rgb, np.full(rgb.shape[:2], 255, dtype=np.uint8)]),
            threshold=actual_thresh * 3,
            extraction_mode=ext_mode,
            column_edges=column_edges,
        )
        return mask

    def _apply_two_layer_split(
        self,
        ext_mode: str,
        column_edges: list[int] | None,
    ) -> None:
        """双层图（实心 + 夸张包络）：包络单独留一份供导出与目视，永不进入读数掩膜。"""
        from ..image import shadow_layers, two_layer_consistency, two_layer_split

        # 「实心层 + 夸张包络」：包络单独留一份，供导出与目视核对，
        # 但**永不**进入 foreground_mask —— 那是读数口径，不是视图。
        self.shadow_mask = None
        self.solid_layers = None
        self.two_layer_report = None
        if ext_mode == "solid-over-shadow":
            rgb_full = (
                self.image_array[..., :3]
                if getattr(self, "image_array", None) is not None
                else np.array(self.image)[..., :3]
            )
            parts = two_layer_split(rgb_full, column_edges=column_edges)
            verdict = two_layer_consistency(rgb_full, parts)
            self.two_layer_report = verdict
            if not verdict["consistent"]:
                # 静默给错数 > 明确报错不可用：这里的掩膜会把某一种颜色的读数
                # 放大整整一个夸张倍数，而界面上一切正常。宁可拒绝。
                raise JsonRpcError(
                    INVALID_PARAMS,
                    "双层分离（solid-over-shadow）在当前图上不可信，已拒绝产出"
                    "前景掩膜，以免读数被按颜色分别放大。\n\n"
                    f"技术原因：{verdict['reason']}\n\n"
                    "建议：改用 standard 并人工核对浅色层；或提交一张该图版的"
                    "裁剪样本以便补足判据。",
                )
            layers = shadow_layers(rgb_full, column_edges=column_edges)
            self.solid_layers = {k: int(v.sum()) for k, v in layers.items()}
            self.shadow_mask = layers["shadow"]

    def _extract_foreground_from_settings(self) -> dict[str, Any]:
        """Re-run extraction with the mode the user picked.

        Every implicit call site (column detection, cleanup, digitising) goes
        through here instead of calling :meth:`extract_foreground` bare: a bare
        call silently drops back to Otsu, which is exactly how a user's chosen
        ``solid-over-shadow`` would be undone the moment they clicked
        "detect columns". One helper, one place to look when a mask comes out
        in the wrong mode.
        """
        edges = getattr(self, "foreground_column_edges", None)
        if edges is None:
            edges = self._column_band_edges()
        mode = getattr(self, "extraction_mode", None) or "standard"
        return self.extract_foreground(extraction_mode=mode, column_edges=edges)

    def _column_band_edges(self) -> list[int] | None:
        """x boundaries of the columns, ascending; ``None`` when there are none.

        Used as the band grid for per-column white points. Falls back to the
        data ROI so that a two-layer figure still gets *some* band structure
        before the user has drawn columns.
        """
        columns = getattr(self, "columns", None) or []
        starts = sorted(int(round(c["start"])) for c in columns if "start" in c)
        ends = sorted(int(round(c["end"])) for c in columns if "end" in c)
        if len(starts) >= 2 and len(ends) >= 2:
            edges: list[int] = []
            for start, end in zip(starts, ends):
                if not edges or start > edges[-1]:
                    edges.append(start)
                edges.append(max(start, end))
            return edges if len(edges) >= 2 else None
        roi = self._roi_box() if hasattr(self, "_roi_box") else None
        if roi:
            width = float(roi[2]) - float(roi[0])
            if width > 0:
                n = max(2, min(40, int(width // 40)))
                return [int(roi[0] + width * i / n) for i in range(n + 1)]
        return None

    def _build_detected_columns(
        self,
        bounds: list,
        *,
        x0: float,
        target_roi_id: str,
        gray_sub: "np.ndarray",
        cleaned_sub_mask: "np.ndarray",
        ix0: int,
        ix1: int,
        iy0: int,
        iy1: int,
    ) -> list[dict[str, Any]]:
        """由列边界构造列对象（无 bounds 时按宽度均分兜底）。

        三条语义写在这里，改之前先读：
        1. start 是**轴线左缘 = 列切分线**，不是 0 点；0 点由下游统一算
           zero = start + axis_stroke_px（ARCHITECTURE §6.4）。把 start 推到
           轴线右缘会让下游再加一次轴粗，形成重复偏移。
        2. anchor_zero_at_axis_right 是可选的**旧语义开关**：它把 start 直接当 0 点，
           代价是 Aber 36 列里 26 列被推后 1~2 px（Mean R² 0.9866 -> 0.8959）。
           默认关闭；开启者必须把 axis_stroke_px 视为 0，否则双偏移。
        3. tickEndX 的初始宽度按**原始列宽**算，不用扣掉零点偏移后的宽度——
           否则整条量程同比缩水，读数系统性偏低。
        """
        from ..columns import has_measurable_axis, measure_axis_right_edge

        detected_cols = []
        if bounds:
            # `start` 的语义唯一：**轴线左缘 = 列切分线**。
            #
            # 0 点不由这里决定，而由下游统一算：`zero = start + axis_stroke_px`
            # （ARCHITECTURE §6.4）。若这里把 start 推到轴线右缘，下游再加一次轴粗
            # 就是**重复偏移**——实测事故（2026-11-04）：fig3 16 列里
            # `start − 实测轴右缘` = 1/2/5/6px 逐列不同，固定 5px 既不对齐轴线，
            # 也让 `abs_px0` 右移（刻距 13px 的列上约 0.38 个刻度，读数系统性偏大）。
            #
            # 右缘锚定保留为可选开关（`anchor_zero_at_axis_right = True`）：它把 start
            # 直接当 0 点用，适合"细灰基线 + 独立曲线"图；但 `measure_axis_right_edge`
            # 无法从结构上区分「真基线」与「filled-silhouette 填充左缘」（fig3 col3 与
            # Aber col2 完全同构，亮度/右侧空白/彩色率三个判据全部失败）。实测代价：
            # 开启后 Aber 36 列中 26 列被推后 1~2px，Mean R² 由 0.9866 掉到 0.8959。
            # 故默认关闭；开启者必须同时把 `axis_stroke_px` 视为 0，否则双偏移。
            if getattr(self, "anchor_zero_at_axis_right", False):
                # 彩色信息是区分"真基线"与"填充轮廓左缘"的决定性依据：
                # 放大比对实测——真基线纯灰（彩色占比 0.00）、右侧立刻断开；
                # filled-silhouette 的左缘带颜色（彩色占比 0.42）、右侧持续有内容。
                # 两者在"暗占比/宽度/贯穿率"上完全同值，只有颜色能分开。
                rgb_panel = np.asarray(self.image.convert("RGB"))[iy0:iy1, ix0:ix1]
                axis_right_offsets = measure_axis_right_edge(
                    rgb_panel, cleaned_sub_mask, [s for s, _ in bounds]
                )
            else:
                axis_right_offsets = [0 for _ in bounds]
            for idx, (s, e) in enumerate(bounds):
                col_start = float(x0 + s + axis_right_offsets[idx])
                col_end = float(x0 + e)
                # 初始刻度齿位置与列间分界线 end 彻底解耦，不吸附列终点。
                #
                # 量程宽度必须按**原始列宽**算，不能用扣掉零点偏移后的宽度：
                # 零点右移 2px 后再拿 (col_end - col_start) 算 tick 宽度，会让
                # 整条量程同比缩水（实测 Aber col2 宽 63px、右移 2px，若按新宽度
                # 算 tickEndX 会少 1.3px，把 88% 丰度的读数压低约 2%）。
                # 正确做法：零点只移动原点，量程跨度保持原始列宽。
                raw_span = float(e - s)
                init_tick_w = max(20.0, min(raw_span * 0.65, 80.0))
                detected_cols.append(
                    {
                        "col_index": idx,
                        "id": f"{target_roi_id}_col{idx + 1:02d}",
                        "roi_id": target_roi_id,
                        "start": col_start,
                        "end": col_end,
                        # 该列左缘处是否真有**贯穿列高的竖轴**。false 表示 0 点
                        # 不可测（无轴列 / 假列），必须由用户手动指定 —— 绝不静默
                        # 按"轴线粗 = 0"处理，那会让整列读数系统偏 1–5px。
                        "zero_point_measurable": bool(
                            has_measurable_axis(gray_sub, int(s), 0, gray_sub.shape[0])
                        ),
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 20.0,
                        "tickEndX": round(col_start + init_tick_w, 1),
                        "plot_type": "area",
                        "has_exaggeration": False,
                        "exaggeration_multiplier": 5.0,
                    }
                )
        else:
            width_px = ix1 - ix0
            num_cols = max(1, min(5, width_px // 80))
            col_w = width_px / num_cols
            for idx in range(num_cols):
                c_start = float(x0 + idx * col_w)
                c_end = float(x0 + (idx + 1) * col_w)
                init_tick_w = max(20.0, min((c_end - c_start) * 0.65, 80.0))
                detected_cols.append(
                    {
                        "col_index": idx,
                        "id": f"{target_roi_id}_col{idx + 1:02d}",
                        "roi_id": target_roi_id,
                        "start": c_start,
                        "end": c_end,
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 20.0,
                        "tickEndX": round(c_start + init_tick_w, 1),
                    }
                )

        return detected_cols

    def _prepare_detection_masks(
        self,
        x0: float,
        x1: float,
        y0: float,
        y1: float,
    ) -> tuple[int, int, int, int, "np.ndarray", "np.ndarray", list]:
        """取搜索窗口内的掩膜与灰度，去掉横线后检测列边界。

        为什么两幅图都要：列边界与 0 点可测性判定用**灰度**（轴的有无是结构问题：
        沿 y 恒定且与纸白有差，二值化会因图版深浅整批失效）；列分割用二值掩膜。
        """
        if self.foreground_mask is None:
            self._extract_foreground_from_settings()

        ix0, ix1 = round(x0), round(x1)
        iy0, iy1 = round(y0), round(y1)

        sub_mask = self.foreground_mask[iy0:iy1, ix0:ix1]
        # 0 点可测性判定用**灰度**而不是二值 mask：轴的有无是结构问题
        # （沿 y 是否恒定 + 与纸白是否有差），二值化会因图版深浅整批失效。
        gray_sub = np.asarray(self.image.convert("L"))[iy0:iy1, ix0:ix1]
        from ..columns import detect_column_bounds
        from ..image import remove_horizontal_grid_lines

        cleaned_sub_mask, self.hline_rows = remove_horizontal_grid_lines(
            sub_mask, min_length=35, min_row_occupancy_ratio=0.30
        )

        bounds = detect_column_bounds(
            cleaned_sub_mask, threshold=0.10, min_col_width_ratio=0.01
        )

        return ix0, ix1, iy0, iy1, gray_sub, cleaned_sub_mask, bounds

    def _resolve_column_bounds(
        self,
        data_xlim: list[float] | None,
        data_ylim: list[float] | None,
        roi_id: str | None,
    ) -> tuple[float, float, float, float, dict[str, Any] | None, str]:
        """解析目标 ROI、校验并夹取搜索边界，并把结果回写到会话。

        回写四样东西，都是下游默认会读的：data_xlim / data_ylim（本次搜索范围）、
        target_roi 的 xlim / ylim（ROI 跟着走）、grid_line_mask / degrid_info 清空
        （换了范围，上一轮的掩膜不再对应当前范围）。
        """
        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded.")

        target_roi = None
        if roi_id:
            target_roi = self._get_roi(roi_id)
            target_roi_id = roi_id
            if data_xlim is None:
                data_xlim = list(target_roi["xlim"])
            if data_ylim is None:
                data_ylim = list(target_roi["ylim"])
        elif hasattr(self, "rois") and self.rois:
            target_roi_id = self.active_roi_id or self.rois[0]["id"]
            target_roi = self._get_roi(target_roi_id)
            if data_xlim is None:
                data_xlim = list(target_roi["xlim"])
            if data_ylim is None:
                data_ylim = list(target_roi["ylim"])
        else:
            target_roi_id = "roi_1"

        if (
            data_xlim is None
            or data_ylim is None
            or len(data_xlim) != 2
            or len(data_ylim) != 2
        ):
            raise JsonRpcError(
                INVALID_PARAMS,
                "data_xlim and data_ylim must each have 2 elements [min, max]",
            )

        x0, x1 = sorted([float(data_xlim[0]), float(data_xlim[1])])
        y0, y1 = sorted([float(data_ylim[0]), float(data_ylim[1])])

        x0 = max(0.0, min(x0, float(self.width)))
        x1 = max(0.0, min(x1, float(self.width)))
        y0 = max(0.0, min(y0, float(self.height)))
        y1 = max(0.0, min(y1, float(self.height)))

        if (x1 - x0) < 5 or (y1 - y0) < 5:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Bounds [{x0}, {x1}], [{y0}, {y1}] is too small (image is {self.width}x{self.height})",
            )

        self.data_xlim = [x0, x1]
        self.data_ylim = [y0, y1]
        if target_roi is not None:
            target_roi["xlim"] = [x0, x1]
            target_roi["ylim"] = [y0, y1]
        self.grid_line_mask = None
        self.degrid_info = None
        return x0, x1, y0, y1, target_roi, target_roi_id

    def _merge_with_existing_columns(
        self,
        detected_cols: list[dict[str, Any]],
        *,
        bounds: list,
        gray_sub: "np.ndarray",
        target_roi: dict[str, Any] | None,
        target_roi_id: str,
        x0: float,
        y0: float,
        y1: float,
    ) -> list[dict[str, Any]]:
        """把新检出的列并进 self.columns：保留其它 ROI 的列、沿用同名列的既有状态。

        复杂度全在「什么该继承」上：old_roi_cols 与 detected_cols 数量相同时沿用旧状态
        （preserve_state），否则当作重新分列、只保留组归属；before/after 依 first_roi_pos
        切分，最后整体 _reindex_columns 并补回超出的 taxa_names 尾巴。
        """
        existing_cols = getattr(self, "columns", [])
        before_cols, after_cols, old_roi_cols = self._split_columns_by_roi(
            existing_cols, target_roi_id
        )
        offset = len(before_cols)
        preserve_state = len(old_roi_cols) == len(detected_cols)
        def_grp_id = target_roi.get("default_group_id") if target_roi else None

        for k, col in enumerate(detected_cols):
            col["_is_new_col"] = True
            col_code = f"col{k + 1:02d}"
            old_c_for_name = old_roi_cols[k] if k < len(old_roi_cols) else None
            resolved_name = self._merged_column_name(
                col_code, old_c_for_name, offset=offset, k=k
            )
            col["name"] = resolved_name
            col["species"] = resolved_name

            if preserve_state:
                self._inherit_column_state(col, old_roi_cols[k], def_grp_id)
            else:
                self._reset_column_group_after_relayout(
                    col, old_c_for_name, def_grp_id
                )

        self._apply_measured_axis_stroke(
            gray_sub, bounds, detected_cols, def_grp_id, target_roi
        )
        self._mark_suspect_block_columns(detected_cols, y0, y1)
        self._splice_columns(before_cols, detected_cols, after_cols, target_roi)

        return detected_cols

    # ---- _merge_with_existing_columns 的分段实现 ----

    def _split_columns_by_roi(
        self,
        existing_cols: list[dict[str, Any]],
        target_roi_id: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """按目标 ROI 把既有列切成「之前 / 该 ROI / 之后」三段（保持原顺序）。"""
        first_roi_pos = next(
            (
                i
                for i, c in enumerate(existing_cols)
                if c.get("roi_id") == target_roi_id
            ),
            len(existing_cols),
        )
        before_cols = [
            c
            for i, c in enumerate(existing_cols)
            if i < first_roi_pos and c.get("roi_id") != target_roi_id
        ]
        after_cols = [
            c
            for i, c in enumerate(existing_cols)
            if i >= first_roi_pos and c.get("roi_id") != target_roi_id
        ]

        old_roi_cols = [c for c in existing_cols if c.get("roi_id") == target_roi_id]
        return before_cols, after_cols, old_roi_cols

    def _merged_column_name(
        self,
        col_code: str,
        old_c_for_name: dict[str, Any] | None,
        *,
        offset: int,
        k: int,
    ) -> str:
        """合并后的列名：既有 taxa 名 / 既有列名 > 占位编号（占位名不算名字）。"""
        gi = (
            old_c_for_name.get("col_index", offset + k)
            if old_c_for_name is not None
            else (offset + k)
        )
        taxa_cand = (
            self.taxa_names[gi]
            if (self.taxa_names and 0 <= gi < len(self.taxa_names))
            else None
        )
        old_name = (
            old_c_for_name.get("name") or old_c_for_name.get("species")
            if old_c_for_name is not None
            else None
        )
        if taxa_cand and taxa_cand != col_code:
            resolved_name = taxa_cand
        elif old_name and old_name != col_code:
            resolved_name = old_name
        elif taxa_cand:
            resolved_name = taxa_cand
        elif old_name:
            resolved_name = old_name
        else:
            resolved_name = col_code
        return resolved_name

    def _inherit_column_state(
        self,
        col: dict[str, Any],
        old_c: dict[str, Any],
        def_grp_id: str | None,
    ) -> None:
        """列数没变：沿用同索引旧列的组归属、标定、单位与绘图类型。

        x 刻度要先过区间守卫：落在列带外的整对标定必须被拒绝并留痕（B-02），
        不能静默丢弃——用户看不到标定已经没了，只会觉得读数不对。
        """
        col["x_group_id"] = old_c.get("x_group_id") or def_grp_id
        col["x_values"] = old_c.get("x_values")
        if old_c.get("x_ticks"):
            t = old_c["x_ticks"]
            c_min = min(col["start"], col["end"])
            c_max = max(col["start"], col["end"])
            max_img_w = float(getattr(self, "width", 0) or 100000.0)
            lo = c_min - 15.0
            ref_span = 0.0
            x_group_id = col.get("x_group_id")
            if x_group_id:
                for r_item in getattr(self, "rois", []):
                    for grp in r_item.get("x_groups", []):
                        if grp.get("id") == x_group_id and grp.get(
                            "ref_span_px"
                        ):
                            ref_span = max(ref_span, float(grp["ref_span_px"]))
            max_span = max(
                c_max - c_min + 15.0,
                (ref_span + 15.0) if ref_span > 0 else 80.0,
            )
            hi = min(c_min + max_span, max_img_w)
            px0 = t[0].get("px", 0) if len(t) == 2 else -999
            px1 = t[1].get("px", 0) if len(t) == 2 else -999
            p_min = min(px0, px1)
            p_max = max(px0, px1)
            if (
                len(t) == 2
                and lo <= p_min <= c_max + 15.0
                and c_min < p_max <= hi
            ):
                col["x_ticks"] = t
            else:
                # B-02：守卫失败曾是**静默**丢弃——用户标定凭空消失、
                # 面板回到 0/N，没有任何提示。这里把"丢了什么、丢在哪"
                # 留在列上，`straditize.getDiagramData` 会原样透传，
                # 由步骤 5/6 面板告知用户需要重新标定。
                #
                # 值必须是**不可变**的：撤销栈的列快照是
                # `[dict(c) for c in self.columns]`（浅拷贝），嵌套容器
                # 会被快照与活动列共享引用。故 px/band 用 tuple；
                # 外层 dict 只整体赋值/整体 pop，任何地方都不就地改它。
                col["x_ticks_dropped"] = {
                    "reason": "out_of_band",
                    "px": tuple(tick.get("px", 0) for tick in t),
                    "band": (lo, hi),
                }
        if old_c.get("unit"):
            col["unit"] = old_c["unit"]
        if old_c.get("plot_type"):
            col["plot_type"] = old_c["plot_type"]
        if old_c.get("scale_type"):
            col["scale_type"] = old_c["scale_type"]
        if old_c.get("exaggeration_mult") is not None:
            col["exaggeration_mult"] = old_c["exaggeration_mult"]
            col["has_exaggeration"] = True

    def _reset_column_group_after_relayout(
        self,
        col: dict[str, Any],
        old_c: dict[str, Any] | None,
        def_grp_id: str | None,
    ) -> None:
        """列数变了：只保留组归属，旧标定记为 column_layout_changed（与越界区分）。"""
        col["x_group_id"] = def_grp_id
        # 列数变了（preserve_state=False）时整块状态回填都被跳过，旧标定
        # 同样**静默消失**——这与区间守卫越界是同一个缺陷的两个分支，
        # 只是幅度更大（实测 hoya 左边界右移 120px：28→27 列、标定 1→0、
        # 无任何提示）。这里同样留下显式记录，但 reason 必须区分开：
        # 越界是"同一列、刻度落在列外"，列数变化是"该索引对应的物理列
        # 已经不是原来那一列"，用户要做的动作不同。
        if old_c is not None and old_c.get("x_ticks"):
            col["x_ticks_dropped"] = {
                "reason": "column_layout_changed",
                "px": tuple(
                    tick.get("px", 0)
                    for tick in old_c.get("x_ticks") or []
                ),
                "band": (col["start"], col["end"]),
            }

    def _apply_measured_axis_stroke(
        self,
        gray_sub: "np.ndarray",
        bounds: list,
        detected_cols: list[dict[str, Any]],
        def_grp_id: str | None,
        target_roi: dict[str, Any] | None,
    ) -> None:
        """轴线粗自动实测并写到**组**上（0 点 = 列左缘 + 轴线粗，ARCHITECTURE §6.4）。"""
        from ..columns import measure_axis_stroke

        # 轴线粗自动实测（ARCHITECTURE §6.4：0 点 = 列左缘 + 轴线粗）。
        #
        # 写进**组**而不是列：一个列组共用一条斜率、一个轴粗（组是标定单位）。
        # 逐列实测值只用于取中位数 —— 同一张图各列的框线粗细会差 1~2px
        # （实测 beginner 4/6/6/6），存逐列值等于把组语义拆散。
        #
        # 两条写入纪律：
        # ① 组上已经有正数就不覆盖 —— 用户手填的粗细必须赢过自动值，否则每次
        #    重新分列都会把他调好的绿线位置冲掉；
        # ② 测不出就**什么都不写**（字段保持缺省）。前端以"缺省 = 未实测"为准，
        #    显示「按 5px 估算，可手工调整」；绝不在这里静默写 5 假装测出来了。
        #
        # ③ 只在**过半数列**测得出时才写。组参数会施加到组内每一列，少数列的测量值
        #    代表不了其余列：实测 hoya 29 列里只有 8 列（28%）左缘是灰度均匀的轴线，
        #    中位数算出来是 2，照写会让另外 21 列的 0 点整体左移 3px —— 那是拿
        #    "部分列的猜测"冒充"全组的实测"。宁可留给用户填。
        if detected_cols:
            axis_widths = measure_axis_stroke(gray_sub, [s for s, _ in bounds])
            measured_widths = [w for w in axis_widths if w > 0]
            coverage = len(measured_widths) / max(1, len(axis_widths))
            if measured_widths and coverage >= 0.5 and def_grp_id:
                for grp in (target_roi or {}).get("x_groups") or []:
                    if grp.get("id") != def_grp_id:
                        continue
                    if float(grp.get("axis_stroke_px") or 0) <= 0:
                        grp["axis_stroke_px"] = int(
                            round(float(np.median(measured_widths)))
                        )
                    break

    def _mark_suspect_block_columns(
        self,
        detected_cols: list[dict[str, Any]],
        y0: float,
        y1: float,
    ) -> None:
        """给「填满整列的色块 / 空框」打 suspect_block 证据（task-21）。"""
        # 「填满整列的色块/空框」标记（task-21）。
        #
        # 必须在 `self.columns = ...` **之前**做：判据要看这一列的像素内容，而
        # 列坐标此刻刚定下来。放在构造之后、赋值之前，可以逐列算一次、只在命中
        # 时写一个键，未命中的列不出现 `suspect_block`（不给前端制造噪音键）。
        #
        # 判定用**该列自己的** [start, end] × ROI 的 [y0, y1]：色块的定义就是
        # "在这块列区域里每行的墨迹都填满横向"，换成别的区间测的就不是同一件事。
        #
        # **输入源必须是灰度阈值，不能用 `foreground_mask`**（实测教训）：
        # 前景掩膜用的是 Otsu（本图 threshold=173），它会把图版顶/底边框那种
        # 整行浅灰线也算成前景，于是某几行的"墨迹宽度"被人为拉满列宽，
        # CV 被压到 0.007 —— 一条真实曲线（灰度口径 CV=0.4545）会被误标成色块。
        # 灰度阈值（<160，与 `scripts/product_journey/probe_column_cv.py` 同口径）
        # 只取真正的深色笔画，五张图 95 列实测分离度 39 倍。
        if detected_cols:
            gray_for_block = np.asarray(self.image.convert("L"))
            block_mask = gray_for_block < _SUSPECT_DARK_THRESHOLD
            # 统计起点落在 **0 点**（轴线右缘 = start + 轴线粗），不是列左缘：
            # 轴线与紧贴它的左竖边不是数据墨迹。旧实现从 start 起算，一旦 start
            # 保持左缘语义，空框的左竖边就会被算进"每行墨迹跨度"，fill_ratio 冲到 1
            # → 误标成"填满整列的色块"（实测 hoya col29，见 test_column_block_detection）。
            #
            # ## 为什么这里**不**跟随组上的自动实测值（2026-11-04 实测）
            #
            # 组里的 `axis_stroke_px` 现在由 `measure_axis_stroke` 自动实测（beginner=6）。
            # 把这个值喂给本窗口会让 beginner 第 4 列的空框**不再被标记**：
            #
            # | 窗口起点 | mean_ink_width | cv | fill_ratio | 形态 1（cv<0.1） |
            # |:---|:---|:---|:---|:---|
            # | start+5 | 221.0 | 0.0004 | 0.9955 | 命中 |
            # | start+6 | 207.1 | 0.2470 | 0.9372 | 不命中 |
            #
            # 差别全部来自那 1px：`start+5` 恰好把空框的**左竖边**留在窗口内，于是
            # 每行的墨迹跨度都被拉满、cv 压到 0；按正确的 0 点心（start+6）切掉左竖边
            # 后只剩右竖边，形态 1 就判不出来了。换言之"空框能被识别"目前**依赖这 1px
            # 溢出**，而真正的替代判据（墨迹位置是否随 y 变化）是三试三败的独立任务
            # （见 `_detect_block_column` 的形态 2/3 注释）。
            #
            # 所以本窗口继续用历史口径 5px，与 0 点解耦：修 0 点不该顺手把空框检测打哑。
            # 只报不改 —— 这个耦合本身是技术债，见 HANDOFF 记录。
            _BLOCK_STAT_STROKE_PX = 5.0
            for col in detected_cols:
                evidence = _detect_block_column(
                    block_mask,
                    int(round(col["start"] + _BLOCK_STAT_STROKE_PX)),
                    int(round(col["end"])),
                    int(round(y0)),
                    int(round(y1)),
                )
                if evidence is not None:
                    col["suspect_block"] = evidence

    def _splice_columns(
        self,
        before_cols: list[dict[str, Any]],
        detected_cols: list[dict[str, Any]],
        after_cols: list[dict[str, Any]],
        target_roi: dict[str, Any] | None,
    ) -> None:
        """把新列接回原位，重排 col_index 并补回超出的 taxa 尾巴。"""
        self.columns = before_cols + detected_cols + after_cols
        had_taxa_names = bool(self.taxa_names)
        extra_tail = (
            self.taxa_names[len(self.columns) :]
            if len(self.taxa_names) > len(self.columns)
            else []
        )
        self._reindex_columns(sync_taxa_names=had_taxa_names)
        if extra_tail:
            self.taxa_names.extend(extra_tail)

        if target_roi:
            target_roi["columns_stale"] = False

    def detect_columns(
        self,
        data_xlim: list[float] | None = None,
        data_ylim: list[float] | None = None,
        roi_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Detects or divides diagram data columns within provided diagram bounds."""
        x0, x1, y0, y1, target_roi, target_roi_id = self._resolve_column_bounds(
            data_xlim, data_ylim, roi_id
        )

        (
            ix0,
            ix1,
            iy0,
            iy1,
            gray_sub,
            cleaned_sub_mask,
            bounds,
        ) = self._prepare_detection_masks(x0, x1, y0, y1)

        detected_cols = self._build_detected_columns(
            bounds,
            x0=x0,
            target_roi_id=target_roi_id,
            gray_sub=gray_sub,
            cleaned_sub_mask=cleaned_sub_mask,
            ix0=ix0,
            ix1=ix1,
            iy0=iy0,
            iy1=iy1,
        )

        return self._merge_with_existing_columns(
            detected_cols,
            bounds=bounds,
            gray_sub=gray_sub,
            target_roi=target_roi,
            target_roi_id=target_roi_id,
            x0=x0,
            y0=y0,
            y1=y1,
        )

    def _roi_box(
        self, roi_id: str | None = None
    ) -> tuple[float, float, float, float] | None:
        """The data region as ``(x0, y0, x1, y1)``, or ``None`` when unset."""
        if roi_id and hasattr(self, "rois") and self.rois:
            roi_obj = next((r for r in self.rois if r.get("id") == roi_id), None)
            if roi_obj and roi_obj.get("xlim") and roi_obj.get("ylim"):
                x0, x1 = sorted((float(roi_obj["xlim"][0]), float(roi_obj["xlim"][1])))
                y0, y1 = sorted((float(roi_obj["ylim"][0]), float(roi_obj["ylim"][1])))
                return x0, y0, x1, y1
        if not getattr(self, "data_xlim", None) or not getattr(self, "data_ylim", None):
            return None
        x0, x1 = sorted((float(self.data_xlim[0]), float(self.data_xlim[1])))
        y0, y1 = sorted((float(self.data_ylim[0]), float(self.data_ylim[1])))
        return x0, y0, x1, y1

    def _roi_mask(self, roi_id: str | None = None) -> np.ndarray:
        """Boolean mask of the data region, used to fence off everything outside it."""
        mask = np.zeros((self.height, self.width), dtype=bool)
        box = self._roi_box(roi_id=roi_id)
        if box is None:
            return ~mask
        x0, y0, x1, y1 = (int(round(v)) for v in box)
        x0, x1 = sorted((max(0, min(self.width, x0)), max(0, min(self.width, x1))))
        y0, y1 = sorted((max(0, min(self.height, y0)), max(0, min(self.height, y1))))
        mask[y0:y1, x0:x1] = True
        return mask

    def _extraction_mask(self, roi_id: str | None = None) -> np.ndarray | None:
        """Ink actually offered to the digitizer: inside the ROI, minus grid lines."""
        if getattr(self, "foreground_mask", None) is None:
            return None
        from ..image import is_supported_grid_line_strength

        mask = self.foreground_mask
        # 去线强度只接受预设名。这不是多余的校验：`degrid_strength` 除了 RPC 之外还能从
        # 工程包载入（历史包存过数字），历史上的 `line_removal.strength=0.6` 会一路走到
        # `algorithm_degrid` 抛 ValueError，再被导出侧的保底逻辑吞成一份全 0 的占位 CSV。
        # 载入侧已经丢弃非法值并告警；这里再挡一次，保证任何入口都炸不到取数。
        degrid_strength = getattr(self, "degrid_strength", None)
        if (
            getattr(self, "grid_line_mask", None) is None
            and is_supported_grid_line_strength(degrid_strength)
            and self._roi_box(roi_id=roi_id) is not None
        ):
            self.algorithm_degrid(
                strength=degrid_strength,
                corrections=getattr(self, "line_corrections", []),
                remove_vertical=getattr(self, "degrid_remove_vertical", True),
            )
        if getattr(self, "grid_line_mask", None) is not None:
            mask = mask & ~self.grid_line_mask
        return mask & self._roi_mask(roi_id=roi_id)

    def column_add(self, column: dict[str, Any]) -> dict[str, Any]:
        """Adds a column definition to the project."""
        self._record_history("Add column")
        c_idx = len(self.columns)
        col_code = f"col{c_idx + 1:02d}"
        name = column.get("species") or column.get("name") or col_code
        col_dict = {
            "col_index": c_idx,
            "name": name,
            "species": name,
            "start": column.get("startX", column.get("start", 0)),
            "end": column.get("endX", column.get("end", 100)),
            "scale_type": column.get("scale_type", "linear"),
            "x_ticks": column.get("x_ticks"),
            "startValue": column.get("startValue", 0),
            "tickValue": column.get("tickValue", 100),
            "tickEndX": column.get("tickEndX", column.get("endX", 100)),
        }
        self.columns.append(col_dict)
        self.taxa_names.append(name)
        self.control_points[c_idx] = {}
        return {"col_index": c_idx, "column": col_dict}

    def _resolve_col_index(self, col_index: int | str) -> int:
        """列的两种寻址：``col_index``(int) 或列 id(如 ``roi_1_col01``)。"""
        if isinstance(col_index, bool):
            raise JsonRpcError(
                INVALID_PARAMS, f"Invalid column reference: {col_index!r}"
            )
        if isinstance(col_index, int):
            return col_index
        text = str(col_index).strip()
        if text.lstrip("-").isdigit():
            return int(text)
        for col in getattr(self, "columns", []):
            if col.get("id") == text:
                return int(col["col_index"])
        raise JsonRpcError(INVALID_PARAMS, f"Unknown column: {col_index!r}")

    def _reindex_columns(self, sync_taxa_names: bool = False) -> None:
        """Re-assigns sequential col_index = 0..N-1 on self.columns."""
        new_column_points: dict[int, list[dict[str, float]]] = {}
        new_control_points: dict[int, dict[int, float]] = {}
        new_reader_types: dict[int, str] = {}
        new_x_scales: dict[int, dict[str, float]] = {}

        old_column_points = getattr(self, "column_points", {}) or {}
        old_control_points = getattr(self, "control_points", {}) or {}
        old_reader_types = getattr(self, "reader_types", {}) or {}
        old_x_scales = getattr(self, "x_scales", {}) or {}

        for new_idx, col in enumerate(self.columns):
            is_new = bool(col.pop("_is_new_col", False))
            old_idx = col.get("col_index")
            col["col_index"] = new_idx
            if not is_new and isinstance(old_idx, int):
                if old_idx in old_column_points:
                    new_column_points[new_idx] = old_column_points[old_idx]
                if old_idx in old_control_points:
                    new_control_points[new_idx] = old_control_points[old_idx]
                if old_idx in old_reader_types:
                    new_reader_types[new_idx] = old_reader_types[old_idx]
                if old_idx in old_x_scales:
                    new_x_scales[new_idx] = old_x_scales[old_idx]

        self.column_points = new_column_points
        self.control_points = new_control_points
        self.reader_types = new_reader_types
        self.x_scales = new_x_scales

        if sync_taxa_names:
            self.taxa_names = [
                c.get("name") or c.get("species") or f"col{i + 1:02d}"
                for i, c in enumerate(self.columns)
            ]

    def column_remove(self, col_index: int | str) -> dict[str, Any]:
        """Removes a column from the project and re-indexes point stores."""
        self._record_history("Remove column")
        target_idx = self._resolve_col_index(col_index)
        if 0 <= target_idx < len(self.columns):
            for idx, c in enumerate(self.columns):
                c.setdefault("col_index", idx)
            self.columns.pop(target_idx)
            if hasattr(self, "taxa_names") and 0 <= target_idx < len(self.taxa_names):
                self.taxa_names.pop(target_idx)
            self._reindex_columns(sync_taxa_names=False)
            return {"success": True, "removed": target_idx}
        raise JsonRpcError(INVALID_PARAMS, f"Column index out of bounds: {target_idx}")

    def column_update(
        self, col_index: int | str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Updates column properties."""
        self._record_history("Update column")
        target_idx = self._resolve_col_index(col_index)
        if 0 <= target_idx < len(self.columns):
            col = self.columns[target_idx]
            for k, v in updates.items():
                if k in ("name", "species"):
                    col["name"] = v
                    col["species"] = v
                    while len(self.taxa_names) < len(self.columns):
                        idx_pad = len(self.taxa_names)
                        c_pad = self.columns[idx_pad]
                        self.taxa_names.append(
                            c_pad.get("name")
                            or c_pad.get("species")
                            or f"col{idx_pad + 1:02d}"
                        )
                    self.taxa_names[target_idx] = v
                elif k == "startX":
                    col["start"] = v
                    col["startX"] = v
                elif k == "endX":
                    col["end"] = v
                    col["endX"] = v
                elif k in ("plot_type", "plotType"):
                    col["plot_type"] = v
                elif k in (
                    "exaggeration_mult",
                    "exaggerationMult",
                    "exaggeration_multiplier",
                ):
                    if v is None or float(v) <= 1.0:
                        col["exaggeration_mult"] = None
                        col["has_exaggeration"] = False
                        col["mult_source"] = None
                    else:
                        col["exaggeration_mult"] = float(v)
                        col["exaggeration_multiplier"] = float(v)
                        col["has_exaggeration"] = True
                        col["mult_source"] = "user"
                elif k in ("has_exaggeration", "hasExaggeration"):
                    has_ex = bool(v)
                    col["has_exaggeration"] = has_ex
                    if not has_ex:
                        col["exaggeration_mult"] = None
                        col["mult_source"] = None
                elif k == "axis_stroke_px":
                    # 列级轴粗覆盖（ARCHITECTURE §6.4）：只放用户显式值，必须**当场校验**。
                    # 不能靠 `resolve_axis_stroke` 的软回落吞掉非法值：那样用户改完
                    # 看到的是"改成功了"，实际仍是组值，绿线一动不动而没有任何报错。
                    # `None` = 清除覆盖、回到组值。
                    if v is None:
                        col.pop("axis_stroke_px", None)
                    else:
                        try:
                            stroke = float(v)
                        except (TypeError, ValueError):
                            raise JsonRpcError(
                                INVALID_PARAMS,
                                f"轴线粗必须是 1–20 之间的数值，收到 {v!r}。",
                            )
                        if not (1.0 <= stroke <= 20.0):
                            raise JsonRpcError(
                                INVALID_PARAMS,
                                f"轴线粗必须在 1–20px 之间，收到 {stroke}。",
                            )
                        col["axis_stroke_px"] = stroke
                else:
                    col[k] = v
            return {"success": True, "column": col}
        raise JsonRpcError(INVALID_PARAMS, f"Column index out of bounds: {target_idx}")

    def algorithm_detect_columns(
        self,
        xlim: list[float] | None = None,
        ylim: list[float] | None = None,
        data_xlim: list[float] | None = None,
        data_ylim: list[float] | None = None,
        roi_id: str | None = None,
        min_width: int = 10,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        """Runs column detection inside ROI."""
        if roi_id:
            roi = self._get_roi(roi_id)
            target_xlim = list(roi["xlim"])
            target_ylim = list(roi["ylim"])
        else:
            target_xlim = xlim or data_xlim or self.data_xlim
            target_ylim = ylim or data_ylim or self.data_ylim
        if not target_xlim or not target_ylim:
            raise JsonRpcError(
                INVALID_PARAMS, "Data ROI bounds must be specified or set in session."
            )
        res = self.detect_columns(
            data_xlim=target_xlim, data_ylim=target_ylim, roi_id=roi_id
        )
        self._record_history("Detect columns")
        return res

    def extract_horizon_consensus(
        self,
        tolerance_px: float = 2.5,
        min_taxa_support: int = 1,
    ) -> dict[str, Any]:
        """Discovers authentic historical sampling horizons by clustering turning points across all taxa."""
        if not getattr(self, "columns", None):
            raise JsonRpcError(STATE_ERROR, "No columns detected.")

        for c_idx in range(len(self.columns)):
            if c_idx not in self.column_points:
                self.digitize(c_idx, "area")

        try:
            from scipy.signal import find_peaks
        except ImportError:
            find_peaks = None

        all_turning_rows: list[int] = []

        for _c_idx, pts in self.column_points.items():
            if not pts or len(pts) < 5:
                continue
            rows = np.array([p["row"] for p in pts], dtype=int)
            xs = np.array([p["x"] for p in pts], dtype=float)

            dyn_range = float(np.ptp(xs)) if len(xs) > 0 else 1.0
            prominence = max(1.0, dyn_range * 0.04)

            peaks_idx: list[int] = []
            valleys_idx: list[int] = []
            if find_peaks is not None and len(xs) > 5:
                p_idx, _ = find_peaks(xs, prominence=prominence, distance=3)
                v_idx, _ = find_peaks(-xs, prominence=prominence, distance=3)
                peaks_idx = list(p_idx)
                valleys_idx = list(v_idx)

            turning_rows = list(rows[peaks_idx]) + list(rows[valleys_idx])
            all_turning_rows.extend(turning_rows)

        if not all_turning_rows:
            return {"horizons_count": 0, "pixel_y": [], "depths": []}

        all_turning_rows.sort()
        clusters: list[list[int]] = []
        for r in all_turning_rows:
            if not clusters or abs(r - float(np.mean(clusters[-1]))) > tolerance_px:
                clusters.append([r])
            else:
                clusters[-1].append(r)

        consensus_rows = [
            int(round(float(np.mean(cl))))
            for cl in clusters
            if len(cl) >= min_taxa_support
        ]

        depths: list[float] = []
        if self.is_calibrated and self.y_scale is not None:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            depths = [round(sy * r + iy, 4) for r in consensus_rows]

        return {
            "horizons_count": len(consensus_rows),
            "pixel_y": consensus_rows,
            "depths": depths,
        }

    def algorithm_degrid(
        self,
        strength: str = "medium",
        corrections: list[dict[str, Any]] | None = None,
        remove_vertical: bool = True,
    ) -> dict[str, Any]:
        """Detect grid/axis lines inside the ROI and publish the removal mask."""
        from ..image import (
            GRID_LINE_PRESETS,
            detect_grid_lines,
            mask_overlay_data_url,
            normalize_grid_line_strength,
        )

        if self.image is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded in session.")

        if str(strength).strip().lower() == "off":
            self.degrid_line_mask = None
            self._rebuild_grid_line_mask()
            self.degrid_strength = None
            self.degrid_info = None
            self._record_history("Degrid off")
            return {
                "success": True,
                "strength": "off",
                "remove_vertical": bool(remove_vertical),
                "max_thickness": 0,
                "horizontal_rows": [],
                "vertical_cols": [],
                "removed_lines_count": 0,
                "removed_pixels": 0,
                "auto_pixels": 0,
                "manual_restore_pixels": 0,
                "manual_erase_pixels": 0,
                "roi": list(self._roi_box() or (0, 0, 0, 0)),
                "overlay_png": None,
            }

        strength = normalize_grid_line_strength(strength)
        roi = self._roi_box()
        if roi is None:
            raise JsonRpcError(
                INVALID_PARAMS,
                "Data ROI bounds must be set before grid-line removal.",
            )

        if self.foreground_mask is None:
            self._extract_foreground_from_settings()

        ink = self.foreground_mask
        horizontal, vertical, info = detect_grid_lines(
            ink,
            strength=strength,
            roi=roi,
            remove_vertical=remove_vertical,
        )
        auto = horizontal | vertical

        from ..image import rasterize_strokes

        restore, erase = rasterize_strokes(ink.shape, corrections)
        self.manual_restore_mask = restore
        self.manual_erase_mask = erase
        self.degrid_line_mask = auto
        self._rebuild_grid_line_mask()
        self.degrid_strength = strength
        self.degrid_remove_vertical = bool(remove_vertical)
        self.line_corrections = list(corrections or [])
        self.degrid_info = {
            **info,
            "correction_restore_pixels": int((restore & ~auto).sum()),
            "correction_erase_pixels": int((auto & erase).sum()),
        }

        self._record_history("Degrid")
        return {
            "success": True,
            "strength": strength,
            "remove_vertical": bool(remove_vertical),
            "max_thickness": GRID_LINE_PRESETS[strength]["max_thickness"],
            "horizontal_rows": info["horizontal_rows"],
            "vertical_cols": info["vertical_cols"],
            "removed_lines_count": len(info["horizontal_rows"])
            + len(info["vertical_cols"]),
            "removed_pixels": int(self.grid_line_mask.sum())
            if self.grid_line_mask is not None
            else 0,
            "auto_pixels": int(auto.sum()),
            "manual_restore_pixels": int((restore & ~auto).sum()),
            "manual_erase_pixels": int((auto & erase).sum()),
            "roi": list(roi),
            "overlay_png": mask_overlay_data_url(ink, self.grid_line_mask),
        }
