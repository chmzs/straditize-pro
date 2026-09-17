# -*- coding: utf-8 -*-
"""Unit tests for Pollen Taxa OCR Recognition, Botanical Dictionary, and Spatial Column Snapping.

Conforms to Section 3 of the OCR & Review Specification:
1. Exact match for Chinese botanical names and Latin binomials.
2. APG family modern nomenclature mapping (e.g. 禾本科 -> Poaceae, Compositae -> Asteraceae).
3. Fuzzy edit-distance tolerance (e.g. 'Querous' auto-suggested as 'Quercus').
4. Custom user dictionary import (.txt plain text).
5. 45-degree oblique label strip affine rotation and reverse coordinate mapping.
6. Baseline anchor point calculation and spatial column snapping (X_anchor -> Column.startX).
7. End-to-end Session RPC workflow integration.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import tempfile
import unittest
import numpy as np
from PIL import Image

from straditize_core.ocr import (
    PollenDictionary,
    OcrTaxaRecognitionEngine,
    rotate_label_strip,
    map_box_to_original,
    compute_baseline_anchor,
)
from straditize_core.session import StraditizeSession


class TestOcrTaxaRecognitionSuite(unittest.TestCase):
    def setUp(self):
        self.dict = PollenDictionary()

    def test_01_botanical_dictionary_exact_and_apg_mapping(self):
        """Verify exact matches for Chinese genera and APG family nomenclature."""
        # Exact Chinese lookup
        res_pinus = self.dict.match_text("松属")
        self.assertEqual(res_pinus["suggested_name"], "Pinus")
        self.assertEqual(res_pinus["status"], "auto")
        self.assertEqual(res_pinus["confidence"], 1.0)

        res_abies = self.dict.match_text("冷杉属")
        self.assertEqual(res_abies["suggested_name"], "Abies")
        self.assertEqual(res_abies["status"], "auto")

        # APG modernization
        res_poaceae = self.dict.match_text("禾本科")
        self.assertEqual(res_poaceae["suggested_name"], "Poaceae")
        self.assertEqual(res_poaceae["status"], "auto")

        res_aster = self.dict.match_text("Compositae")
        self.assertEqual(res_aster["suggested_name"], "Asteraceae")
        self.assertEqual(res_aster["status"], "auto")

    def test_02_fuzzy_levenshtein_error_tolerance(self):
        """Verify edit-distance resilience against OCR typos."""
        # OCR typo: 'Querous' instead of 'Quercus'
        res_typo = self.dict.match_text("Querous")
        self.assertEqual(res_typo["suggested_name"], "Quercus")
        self.assertIn(res_typo["status"], ("auto", "confirm"))
        self.assertGreaterEqual(res_typo["confidence"], 0.80)

        # Chinese slight OCR blur: '云彬属' instead of '云杉属'
        res_zh_blur = self.dict.match_text("云彬属")
        self.assertEqual(res_zh_blur["suggested_name"], "Picea")
        self.assertIn(res_zh_blur["status"], ("auto", "confirm"))

    def test_03_custom_user_dictionary_import(self):
        """Verify importing domain-specific taxa from plain .txt file."""
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as f:
            f.write("新疆落叶松,Larix sibirica,地方特有种\n")
            f.write("准噶尔乌头,Aconitum soongaricum,高山草甸\n")
            custom_txt_path = f.name

        custom_dict = PollenDictionary(custom_dict_path=custom_txt_path)
        res_custom = custom_dict.match_text("新疆落叶松")
        self.assertEqual(res_custom["suggested_name"], "Larix sibirica")
        self.assertEqual(res_custom["group"], "地方特有种")
        self.assertEqual(res_custom["status"], "auto")

    def test_04_affine_45_degree_rotation_and_coordinate_inversion(self):
        """Verify rotating oblique strip to horizontal and mapping bounding box back to original space."""
        # Create a synthetic image with oblique content
        img = Image.new("RGB", (400, 100), color=(255, 255, 255))
        rot_arr, meta = rotate_label_strip(img, angle_deg=-45.0)

        self.assertEqual(meta["angle_deg"], -45.0)
        self.assertGreater(rot_arr.shape[0], 0)
        self.assertGreater(rot_arr.shape[1], 0)

        # Map a test box from rotated coordinates back to original coordinates
        test_box_rot = [(50.0, 30.0), (100.0, 30.0), (100.0, 60.0), (50.0, 60.0)]
        orig_box = map_box_to_original(test_box_rot, meta, global_offset=(100.0, 20.0))

        self.assertEqual(len(orig_box), 4)
        for pt in orig_box:
            self.assertEqual(len(pt), 2)
            # Coordinate must be within reasonable offset range
            self.assertGreaterEqual(pt[0], 0.0)
            self.assertGreaterEqual(pt[1], 0.0)

    def test_05_baseline_anchor_calculation_and_column_snapping(self):
        """Verify lowest point calculation and matching with Column.startX."""
        # Oblique bounding box: lowest Y point is the bottom anchor
        box = [[120.0, 50.0], [150.0, 20.0], [170.0, 40.0], [140.0, 70.0]]
        ax, ay = compute_baseline_anchor(box)
        self.assertEqual(ay, 70.0)
        self.assertEqual(ax, 140.0)

        # Test snapping with engine
        engine = OcrTaxaRecognitionEngine()
        labels = [
            {
                "id": "label_001",
                "anchor_x": 142.0,
                "anchor_y": 70.0,
                "associated_column_id": None,
                "associated_column_index": None,
            },
            {
                "id": "label_002",
                "anchor_x": 260.0,
                "anchor_y": 70.0,
                "associated_column_id": None,
                "associated_column_index": None,
            }
        ]
        columns = [
            {"id": "taxa_0", "col_index": 0, "name": "Col_1", "startX": 140.0},
            {"id": "taxa_1", "col_index": 1, "name": "Col_2", "startX": 258.0},
        ]

        engine._snap_labels_to_columns(labels, columns)

        self.assertEqual(labels[0]["associated_column_id"], "taxa_0")
        self.assertEqual(labels[0]["associated_column_name"], "Col_1")
        self.assertEqual(labels[1]["associated_column_id"], "taxa_1")
        self.assertEqual(labels[1]["associated_column_name"], "Col_2")

    def test_06_session_ocr_full_workflow_integration(self):
        """Verify Session.ocr_recognize_labels and Session.ocr_apply_labels."""
        session = StraditizeSession()
        session.load_image(sample_key="hoya")
        session.detect_columns([315, 1946], [511, 1311])

        # Execute OCR recognition on top header region
        ocr_res = session.ocr_recognize_labels(label_row_bbox=[315, 200, 1946, 510], angle_deg=-45.0)
        self.assertTrue(ocr_res["success"])
        data = ocr_res["data"]
        self.assertIn("labels", data)
        self.assertIn("label_row_image", data)
        self.assertTrue(data["label_row_image"].startswith("data:image/png;base64,"))
        self.assertIn("summary", data)

        # Apply reviewed labels to columns
        sample_confirmed = [
            {"associated_column_id": "taxa_0", "suggested_name": "Pinus", "ocr_text": "松属"},
            {"associated_column_id": "taxa_1", "suggested_name": "Abies", "ocr_text": "冷杉属"},
            {"associated_column_id": "taxa_2", "suggested_name": "Picea", "ocr_text": "云杉属"},
        ]
        apply_res = session.ocr_apply_labels(sample_confirmed)
        self.assertTrue(apply_res["success"])
        self.assertGreaterEqual(apply_res["applied_count"], 3)

        # Verify column names updated in session
        col0 = next(c for c in session.columns if c["id"] == "taxa_0")
        self.assertEqual(col0["name"], "Pinus")
        self.assertEqual(col0["species"], "Pinus")


if __name__ == "__main__":
    unittest.main()
