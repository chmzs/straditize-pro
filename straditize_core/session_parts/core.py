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
    resolved_path: str | None = None

    # Case 1: Built-in sample key
    if not image_path and not image_data and sample_key:
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
        image_path = str(cand)

    # Case 2: Base64 data URL or raw Base64 string
    if image_data:
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
            try:
                import pypdf

                reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
                total_pages = len(reader.pages)
                if total_pages == 0:
                    raise ValueError("PDF 文档为空，未包含任何页面。")
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
                    return best_img, "PDF_IMAGE", None, pdf_info, raw_bytes
                raise ValueError(
                    f"该 PDF 第 {page_number} 页为纯矢量流未内嵌位图图谱。请将该页导出为 PNG/JPG 图像后载入。"
                )
            except JsonRpcError:
                raise
            except Exception as e:
                raise JsonRpcError(
                    FILE_ERROR,
                    f"PDF 解析失败: {e}。请确认 PDF 包含位图图版，或转为 PNG 导入。",
                ) from e

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

    # Case 3: Local file path
    if not image_path:
        raise JsonRpcError(
            STATE_ERROR,
            "前置输入缺失：未提供图谱源。请在【步骤 1: 载入图谱】中选择本地图片/单页PDF上传，或指定 sample_key（如 'hoya'）。",
        )

    # Fallback search if relative path
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

    resolved_path = os.path.abspath(image_path)
    is_pdf = resolved_path.lower().endswith(".pdf")

    if is_pdf:
        try:
            import pypdf

            with open(resolved_path, "rb") as f:
                raw_bytes = f.read()
            reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
            total_pages = len(reader.pages)
            if total_pages == 0:
                raise ValueError("PDF 文档为空，未包含任何有效页面。")
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
                return best_img, "PDF_IMAGE", resolved_path, pdf_info, raw_bytes
            raise ValueError(
                f"该 PDF 第 {page_number} 页为纯矢量流未内嵌位图图谱。请将该页在外部导出为 PNG/JPG 图像后载入。"
            )
        except JsonRpcError:
            raise
        except Exception as e:
            raise JsonRpcError(
                FILE_ERROR,
                f"PDF 解析失败: {e}。请确认 PDF 包含图谱位图或转为 PNG 后导入。",
            ) from e

    try:
        img = Image.open(resolved_path)
        img.load()
        fmt = (
            img.format
            or os.path.splitext(resolved_path)[1].lstrip(".").upper()
            or "PNG"
        )
        return img, fmt, resolved_path, None, None
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
            if getattr(self, "cached_pdf_data", None):
                image_data = f"data:application/pdf;base64,{base64.b64encode(self.cached_pdf_data).decode('ascii')}"
            elif getattr(self, "cached_pdf_path", None):
                image_path = self.cached_pdf_path

        img, fmt, resolved_path, pdf_info, raw_pdf_bytes = _decode_diagram_source(
            image_path=image_path,
            image_data=image_data,
            sample_key=sample_key,
            file_name=file_name,
            page_number=page_number,
        )
        self.cached_pdf_data = raw_pdf_bytes
        self.cached_pdf_path = (
            resolved_path
            if (resolved_path and resolved_path.lower().endswith(".pdf"))
            else None
        )
        self.pdf_info = pdf_info

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
        self.columns = []
        self.column_points = {}
        self.control_points = {}
        self.is_calibrated = False
        self.y_scale = None
        self.depth_calib = None
        self.taxa_names = []
        self.depth_grid = []
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

    def switch_pdf_page(self, page_number: int = 1) -> dict[str, Any]:
        """Switch to a specific 1-based page of the currently loaded PDF."""
        return self.load_image(page_number=page_number)

    def suggest_data_region(self, fraction: float = 0.7) -> dict[str, float]:
        """Suggest the main diagram rectangle using the legacy ROI heuristic."""
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
            return fallback

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
            return fallback
        return {
            "xMin": float(x_min),
            "xMax": float(x_max + 1),
            "yMin": float(y_min),
            "yMax": float(y_max + 1),
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
    ) -> dict[str, Any]:
        """Segments the foreground (curves/bars) from diagram background."""
        if self.image is None:
            raise JsonRpcError(
                STATE_ERROR, "No image loaded. Please call core.loadImage first."
            )

        gray = np.array(self.image.convert("L"))

        if mode == "otsu":
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
            actual_thresh = threshold if threshold is not None else computed_thresh
        elif mode == "binary":
            actual_thresh = float(threshold) if threshold is not None else 128.0
        elif mode == "adaptive":
            try:
                from skimage.filters import threshold_local

                block_size = 35
                local_thresh = threshold_local(gray, block_size, offset=10)
                mask = gray < local_thresh
                actual_thresh = float(np.mean(local_thresh))
                self.foreground_mask = mask
                self.threshold = actual_thresh
                self.segmentation_mode = mode
                fg_pixels = int(np.sum(mask))
                fg_ratio = float(fg_pixels / gray.size)
                return {
                    "threshold": actual_thresh,
                    "mode": mode,
                    "foreground_pixels": fg_pixels,
                    "foreground_ratio": fg_ratio,
                    "shape": list(mask.shape),
                }
            except Exception:  # noqa: BLE001
                actual_thresh = float(threshold) if threshold is not None else 128.0
        else:
            raise JsonRpcError(
                INVALID_PARAMS, f"Unknown foreground extraction mode: {mode}"
            )

        mask = gray < actual_thresh
        self.foreground_mask = mask
        self.threshold = actual_thresh
        self.segmentation_mode = mode

        fg_pixels = int(np.sum(mask))
        fg_ratio = float(fg_pixels / gray.size)

        return {
            "threshold": actual_thresh,
            "mode": mode,
            "foreground_pixels": fg_pixels,
            "foreground_ratio": fg_ratio,
            "shape": list(mask.shape),
        }

    def detect_columns(
        self,
        data_xlim: list[float] | None = None,
        data_ylim: list[float] | None = None,
        roi_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Detects or divides diagram data columns within provided diagram bounds."""
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

        if self.foreground_mask is None:
            self.extract_foreground()

        ix0, ix1 = round(x0), round(x1)
        iy0, iy1 = round(y0), round(y1)

        sub_mask = self.foreground_mask[iy0:iy1, ix0:ix1]
        from ..columns import detect_column_bounds
        from ..image import remove_horizontal_grid_lines

        cleaned_sub_mask, self.hline_rows = remove_horizontal_grid_lines(
            sub_mask, min_length=35, min_row_occupancy_ratio=0.30
        )

        bounds = detect_column_bounds(
            cleaned_sub_mask, threshold=0.10, min_col_width_ratio=0.01
        )

        detected_cols = []
        if bounds:
            for idx, (s, e) in enumerate(bounds):
                col_start = float(x0 + s)
                col_end = float(x0 + e)
                detected_cols.append(
                    {
                        "col_index": idx,
                        "id": f"{target_roi_id}_col{idx + 1:02d}",
                        "roi_id": target_roi_id,
                        "start": col_start,
                        "end": col_end,
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 100.0,
                        "tickEndX": col_end,
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
                detected_cols.append(
                    {
                        "col_index": idx,
                        "id": f"{target_roi_id}_col{idx + 1:02d}",
                        "roi_id": target_roi_id,
                        "start": c_start,
                        "end": c_end,
                        "scale_type": "linear",
                        "startValue": 0.0,
                        "tickValue": 100.0,
                        "tickEndX": c_end,
                    }
                )

        existing_cols = getattr(self, "columns", [])
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
        offset = len(before_cols)

        old_roi_cols = [c for c in existing_cols if c.get("roi_id") == target_roi_id]
        preserve_state = len(old_roi_cols) == len(detected_cols)
        def_grp_id = target_roi.get("default_group_id") if target_roi else None

        for k, col in enumerate(detected_cols):
            col["_is_new_col"] = True
            col_code = f"col{k + 1:02d}"
            old_c_for_name = old_roi_cols[k] if k < len(old_roi_cols) else None
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
            col["name"] = resolved_name
            col["species"] = resolved_name

            if preserve_state:
                old_c = old_roi_cols[k]
                col["x_group_id"] = old_c.get("x_group_id") or def_grp_id
                col["x_values"] = old_c.get("x_values")
                if old_c.get("x_ticks"):
                    t = old_c["x_ticks"]
                    lo = min(col["start"], col["end"]) - 10
                    hi = max(col["start"], col["end"]) + 10
                    if (
                        len(t) == 2
                        and lo <= t[0].get("px", 0) <= hi
                        and lo <= t[1].get("px", 0) <= hi
                    ):
                        col["x_ticks"] = t
                if old_c.get("unit"):
                    col["unit"] = old_c["unit"]
                if old_c.get("plot_type"):
                    col["plot_type"] = old_c["plot_type"]
                if old_c.get("scale_type"):
                    col["scale_type"] = old_c["scale_type"]
                if old_c.get("exaggeration_mult") is not None:
                    col["exaggeration_mult"] = old_c["exaggeration_mult"]
                    col["has_exaggeration"] = True
            else:
                col["x_group_id"] = def_grp_id

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

        return detected_cols

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
        mask = self.foreground_mask
        if (
            getattr(self, "grid_line_mask", None) is None
            and getattr(self, "degrid_strength", None) is not None
            and self._roi_box(roi_id=roi_id) is not None
        ):
            self.algorithm_degrid(
                strength=self.degrid_strength,
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
            self.extract_foreground()

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
