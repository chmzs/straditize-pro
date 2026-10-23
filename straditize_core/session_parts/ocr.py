"""Pollen taxa OCR recognition and vocabulary management session mixin."""

from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..ocr import OcrTaxaRecognitionEngine, PollenDictionary
from ..protocol import (
    STATE_ERROR,
    JsonRpcError,
)


class OcrSessionMixin:
    """Session mixin for OCR taxa detection, dictionary lookup, and column naming."""

    @staticmethod
    def user_taxa_dict_path() -> str:
        """Returns the persistent per-user custom taxa vocabulary path."""
        override = os.environ.get("STRADITIZE_TAXA_DICT")
        if override:
            return os.path.abspath(override)
        return os.path.join(os.path.expanduser("~"), ".straditize", "taxa_custom.txt")

    def _detect_label_band_top(
        self, x0: int, x1: int, data_top: int, *, min_band_height: int = 20
    ) -> int:
        """Return the top row of the rotated-taxa label band above the data area.

        ## 为什么不能用一个固定跨度

        旧实现是 ``y0 = max(0, data_top - 320)``。真实论文图版上
        ``data_top = 233`` → ``233 - 320 = -87`` → ``max(0, -87) = 0``，
        于是**默认 bbox 从图像最顶端开始**，把标签区上方的图例文字（如
        ``Herbs``，anchor_y=57.9，比标签行低处 221.2 高出 163.3px）也扫进来。

        后果不是"多识别一个标签"这么轻：``ocr/engine.py`` 的 ``can_pair``
        要求 ``len(labels) == len(columns)``，多一个假标签就让**全部**正确
        配对整体否决（实测 17 标签 / 16 列 → ``associated_column_id`` 全 None）。

        ## 判据：从数据区上边界向上扫，找**高度足够**的暗像素密集带

        实测（Han 2026 Fig.3，2132×928，数据区 [330,1330]×[233,869]）：
        ```
        y=232        暗像素占比 ≈ 100%（数据区顶边线，高度仅 1 行）
        y= 81..221   暗像素 48..215（旋转属种名文字带，高度 141 行）
        y=  8.. 26   暗像素稀疏（图例区）
        ```
        所以判据是：把连续密集行切成段，**取最靠近数据区、且高度 ≥ 20 行的
        那一段**。细线（高度 1 行的顶边线）被高度下限排除；上方图例区因
        不与数据区相邻而不被选中。

        **没有魔法数**：不假设标签带一定在数据区上方多少像素，也不假设它
        的高度；只依赖"文字带比边线厚"这个物理事实。窗口上限取
        ``data_top`` 本身（不越过数据区），下界到 0。
        """
        from ..image import to_binary  # noqa: F401  (保持与本模块既有依赖一致)

        if getattr(self, "image", None) is None:
            return 0
        gray = np.asarray(self.image.convert("L"))
        dark = gray < 160
        width = max(1, x1 - x0)
        # "有文字"的下限：该行暗像素占标签区宽度的 3%，但不低于 10px。
        # 单行边线只有 1 行，会被下面的高度下限排除，故此处只需区分"有字/无字"。
        dense_threshold = max(10, int(width * 0.03))

        dense_rows = [
            y
            for y in range(data_top - 1, -1, -1)
            if int(dark[y, x0:x1].sum()) > dense_threshold
        ]
        if not dense_rows:
            return max(0, data_top - 320)

        # 切成连续段（允许 5 行以内的间断：旋转文字的斜向笔画会断开几行）
        segments: list[tuple[int, int]] = []
        current = [dense_rows[0]]
        for y in dense_rows[1:]:
            if current[-1] - y <= 5:
                current.append(y)
            else:
                segments.append((min(current), max(current)))
                current = [y]
        segments.append((min(current), max(current)))

        # 取最靠近数据区、且厚度够的那一段
        for top, bottom in segments:
            if bottom - top + 1 >= min_band_height:
                return int(top)
        # 找不到厚度足够的文字带：退回保守跨度（不越过数据区）
        return max(0, data_top - 320)

    def ocr_recognize_labels(
        self,
        label_row_bbox: list[int] | tuple[int, int, int, int] | None = None,
        angle_deg: float = 45.0,
        custom_dict_path: str | None = None,
    ) -> dict[str, Any]:
        """Executes OCR detection and botanical matching on diagram top label row."""
        if getattr(self, "image", None) is None:
            raise JsonRpcError(STATE_ERROR, "No diagram image loaded in session.")

        w, h = self.width, self.height
        if label_row_bbox is None:
            if getattr(self, "data_xlim", None) and getattr(self, "data_ylim", None):
                x0, x1 = int(self.data_xlim[0]), int(self.data_xlim[1])
                y0 = self._detect_label_band_top(x0, x1, int(self.data_ylim[0]))
                y1 = int(self.data_ylim[0] + 5)
                bbox = [x0, y0, x1, y1]
            else:
                bbox = [int(w * 0.1), int(h * 0.05), int(w * 0.9), int(h * 0.32)]
        else:
            bbox = list(label_row_bbox)

        dict_path = custom_dict_path or self.user_taxa_dict_path()
        engine = OcrTaxaRecognitionEngine(
            custom_dict_path=dict_path if os.path.exists(dict_path) else None
        )
        result = engine.recognize_label_row(
            diagram_image=self.image,
            label_row_bbox=bbox,
            columns=getattr(self, "columns", []),
            angle_deg=angle_deg,
        )
        result["custom_dict_path"] = dict_path
        result["custom_dict_entries"] = len(engine.dictionary.custom_entries)
        result["builtin_dict_entries"] = len(engine.dictionary.entries) - len(
            engine.dictionary.custom_entries
        )
        return {"success": True, "data": result}

    def ocr_get_taxa_dict(self) -> dict[str, Any]:
        """Returns the built-in vocabulary summary plus user custom entries."""
        from ..ocr.dictionary import DEFAULT_NPP_DICT, DEFAULT_POLLEN_DICT

        path = self.user_taxa_dict_path()
        dictionary = PollenDictionary(
            custom_dict_path=path if os.path.exists(path) else None
        )
        custom = sorted(dictionary.custom_entries.values(), key=lambda item: item["zh"])
        return {
            "success": True,
            "path": path,
            "exists": os.path.exists(path),
            "builtin_pollen_count": len(DEFAULT_POLLEN_DICT),
            "builtin_npp_count": len(DEFAULT_NPP_DICT),
            "custom": custom,
            "custom_count": len(custom),
        }

    def ocr_parse_taxa_text(self, text: str = "") -> dict[str, Any]:
        """Parses pasted vocabulary text into structured taxa entries."""
        entries = PollenDictionary.parse_taxa_text(text or "")
        is_caption = bool(PollenDictionary.extract_caption_taxa(text or ""))
        return {
            "success": True,
            "entries": entries,
            "count": len(entries),
            "format": "figure_caption" if is_caption else "list",
        }

    def ocr_save_custom_taxa(
        self,
        entries: list[dict[str, Any]] | None = None,
        raw_text: str | None = None,
        mode: str = "append",
        clear: bool = False,
    ) -> dict[str, Any]:
        """Persists user-supplied taxa into the per-user vocabulary file."""
        path = self.user_taxa_dict_path()
        dict_obj = PollenDictionary(
            custom_dict_path=path if os.path.exists(path) else None
        )
        if clear or mode == "replace":
            dict_obj.custom_entries = {}

        if not entries and raw_text:
            entries = PollenDictionary.parse_taxa_text(raw_text)

        added = 0
        skipped: list[str] = []
        for raw in entries or []:
            if not isinstance(raw, dict):
                continue
            zh = str(raw.get("zh_name") or raw.get("zh") or "").strip()
            latin = str(raw.get("latin_name") or raw.get("latin") or "").strip()
            if not latin:
                skipped.append(zh or "<empty>")
                continue
            if not zh:
                zh = latin
            group = str(raw.get("group") or "用户自定义 (User Custom)").strip()
            dict_obj.add_entry(zh, latin, group=group, cls="custom", is_custom=True)
            added += 1

        count = dict_obj.save_custom_txt(path)
        return {
            "success": True,
            "path": path,
            "added": added,
            "skipped": skipped,
            "custom_count": count,
            "entries": sorted(dict_obj.custom_entries.values(), key=lambda i: i["zh"]),
        }

    def ocr_apply_labels(
        self, confirmed_labels: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Applies user-reviewed taxon names directly into column definitions."""
        applied_count = 0
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        for item in confirmed_labels:
            col_id = item.get("associated_column_id")
            name_to_apply = item.get("suggested_name") or item.get("ocr_text")
            if not col_id or not name_to_apply:
                continue

            for idx, col in enumerate(columns):
                c_idx = col.get("col_index", idx)
                cid = col.get("id") or f"taxa_{c_idx}"
                if (
                    cid == col_id
                    or f"taxa_{c_idx}" == col_id
                    or f"col_{c_idx}" == col_id
                ):
                    col["name"] = name_to_apply
                    col["species"] = name_to_apply
                    col["id"] = col_id
                    while len(taxa_names) < len(columns):
                        pad_i = len(taxa_names)
                        c_pad = columns[pad_i]
                        taxa_names.append(
                            c_pad.get("name")
                            or c_pad.get("species")
                            or f"col{pad_i + 1:02d}"
                        )
                    if 0 <= c_idx < len(taxa_names):
                        taxa_names[c_idx] = name_to_apply
                    applied_count += 1
                    break

        return {
            "success": True,
            "applied_count": applied_count,
            "columns_count": len(columns),
        }


OcrMixin = OcrSessionMixin
