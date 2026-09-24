"""OCR and label recognition RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register OCR operations."""
    dispatcher.register_method("ocr.recognizeLabels", session.ocr_recognize_labels)
    dispatcher.register_method("ocr.applyLabels", session.ocr_apply_labels)
    dispatcher.register_method("ocr.getTaxaDict", session.ocr_get_taxa_dict)
    dispatcher.register_method("ocr.parseTaxaText", session.ocr_parse_taxa_text)
    dispatcher.register_method("ocr.saveCustomTaxa", session.ocr_save_custom_taxa)
