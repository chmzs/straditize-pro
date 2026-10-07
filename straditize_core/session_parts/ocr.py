"""Pollen taxa OCR recognition and vocabulary management session mixin."""

from __future__ import annotations

import os
from typing import Any

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
                y0 = max(0, int(self.data_ylim[0] - 320))
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
