"""Optical Character Recognition (OCR) and botanical taxon matching package."""

from .affine import compute_baseline_anchor, map_box_to_original, rotate_label_strip
from .dictionary import DEFAULT_POLLEN_DICT, FAMILY_APG_SYNONYMS, PollenDictionary
from .engine import OcrTaxaRecognitionEngine

__all__ = [
    "DEFAULT_POLLEN_DICT",
    "FAMILY_APG_SYNONYMS",
    "OcrTaxaRecognitionEngine",
    "PollenDictionary",
    "compute_baseline_anchor",
    "map_box_to_original",
    "rotate_label_strip",
]
