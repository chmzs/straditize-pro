# -*- coding: utf-8 -*-
"""Comprehensive verification for Metadata Extraction, Age-Depth Native Ensembles, and LiPD / XLSX Exporters.

Tests conforming to Section 10 of the Specification (v1.2):
1. DOI normalization and structured indexing.
2. PDF chapter/token-aware chunking (<=4000 tokens, 200 overlap).
3. LLM multi-chunk metadata merging with zero-hallucination and conflict tagging.
4. Native Age-Depth Ensemble generation (Bacon/Bchron MCMC style, 1000 realizations).
5. Publication-grade multi-sheet XLSX export (openpyxl).
6. Linked Paleo Data (LiPD) JSON-LD and .lpd package container generation.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import unittest
import numpy as np
import openpyxl
import pandas as pd
import zipfile

from straditize_core.age_depth import AgeDepthAxisCalibrator, AgeDepthModel
from straditize_core.metadata.doi import normalize_doi
from straditize_core.metadata.exporter_lipd import export_lipd_jsonld, export_lipd_package
from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx
from straditize_core.metadata.llm_extractor import merge_chunk_extractions
from straditize_core.metadata.pdf_parser import approximate_tokens, chunk_text_by_tokens
from straditize_core.session import StraditizeSession


class TestMetadataAndLiPDSuite(unittest.TestCase):
    def test_01_doi_normalization_and_rules(self):
        """Verify standard cleaning of varied DOI user inputs."""
        self.assertEqual(normalize_doi("10.1016/j.quascirev.2020.106500"), "10.1016/j.quascirev.2020.106500")
        self.assertEqual(normalize_doi("https://doi.org/10.1016/j.quascirev.2020.106500"), "10.1016/j.quascirev.2020.106500")
        self.assertEqual(normalize_doi("http://dx.doi.org/10.1038/nature12373"), "10.1038/nature12373")
        self.assertEqual(normalize_doi("doi: 10.1177/0959683617715691"), "10.1177/0959683617715691")

    def test_02_pdf_token_chunking_constraints(self):
        """Verify token estimation and overlapping chunk boundaries."""
        sample_pages = [
            {"page": 1, "text": "Introduction\n" + ("Paleoclimate pollen reconstruction. " * 800)},
            {"page": 2, "text": "Site description and methods\n" + ("Lake sediment core taken at 2300m elevation. " * 600)},
            {"page": 3, "text": "Chronology\n" + ("Bacon age-depth model was constructed using IntCal20. " * 700)},
        ]
        chunks = chunk_text_by_tokens(sample_pages, max_tokens=1500, overlap_tokens=150)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(c["token_est"], 1500)
            self.assertTrue(len(c["text"]) > 0)

    def test_03_llm_chunk_merging_and_conflict_detection(self):
        """Verify merging logic: unmentioned fields stay empty, conflicting fields tag candidates."""
        # Simulated extraction from Chunk 1
        chunk1 = {
            "site_name": {"value": "Lake Chon", "confidence": "high", "quote": "Lake Chon is situated..."},
            "elevation_m": {"value": "1250", "confidence": "high", "quote": "at 1250 m a.s.l."},
            "dating_method": {"value": "14C", "confidence": "high", "quote": "dated by 14C AMS"},
            # other fields missing
        }
        # Simulated extraction from Chunk 2 (mentions different elevation or multiple sites)
        chunk2 = {
            "site_name": {"value": "Loch Chon", "confidence": "high", "quote": "Loch Chon sediment core"},
            "elevation_m": {"value": "1250", "confidence": "high", "quote": "1250m above sea level"},
            "age_model": {"value": "Bacon", "confidence": "high", "quote": "modeled via Bacon software"},
        }

        merged = merge_chunk_extractions([chunk1, chunk2])

        # 1. Consistent elevation
        self.assertEqual(merged["elevation_m"]["value"], "1250")
        self.assertFalse(merged["elevation_m"]["conflict"])

        # 2. Conflict in site name ("Lake Chon" vs "Loch Chon")
        self.assertTrue(merged["site_name"]["conflict"])
        self.assertEqual(len(merged["site_name"]["candidates"]), 2)

        # 3. Explicit missing field must strictly be empty string (no hallucination)
        self.assertEqual(merged["pollen_extraction_method"]["value"], "")
        self.assertEqual(merged["pollen_extraction_method"]["confidence"], "none")

    def test_04_native_age_depth_ensemble_generation(self):
        """Verify AgeDepthModel directly generates 1000 MCMC ensemble realizations."""
        depths = np.array([0.0, 50.0, 100.0, 150.0])
        ages = np.array([0.0, 450.0, 1100.0, 2600.0])
        age_min = np.array([0.0, 350.0, 950.0, 2300.0])
        age_max = np.array([0.0, 550.0, 1300.0, 2900.0])

        model = AgeDepthModel(
            depths=depths,
            ages=ages,
            age_min=age_min,
            age_max=age_max,
            curve_type="weighted_mean",
            envelope_type="95_hpd",
        )

        sample_depths = [10.0, 30.0, 70.0, 110.0, 140.0]
        ens = model.generate_age_ensemble(sample_depths, n_ensembles=1000, name="Bacon_Ensemble_1000")

        self.assertEqual(ens["name"], "Bacon_Ensemble_1000")
        self.assertEqual(len(ens["columns"]), 1001)  # depth + 1000 iterations
        self.assertEqual(len(ens["data"]), len(sample_depths))

        # Test chronological ordering along core depth for each realization
        for row_idx in range(len(sample_depths) - 1):
            for iter_idx in range(1, 1001):
                age_top = ens["data"][row_idx][iter_idx]
                age_bottom = ens["data"][row_idx + 1][iter_idx]
                self.assertGreaterEqual(age_bottom, age_top)

    def test_05_multi_sheet_xlsx_export(self):
        """Verify publication-grade XLSX workbook with meta_info, pollen, age-depth, ensemble."""
        meta_info = {
            "publication": {"doi": "10.1016/j.quascirev.2026.01", "title": "Holocene pollen history", "authors": ["A. Smith", "B. Doe"], "journal": "QSR", "year": 2026},
            "site": {"site_name": "Surkhandarya", "latitude": "38.25", "longitude": "67.89", "elevation_m": "1420", "archive_type": "lake sediment"},
            "chronology": {"age_model": "Bacon", "age_range": "0-12000 cal BP", "dating_method": "14C AMS", "cal_curve": "IntCal20"},
            "technical": {"pollen_extraction_method": "HF sieving", "laboratory": "Pollen Lab", "sampling_interval_cm": "2"},
            "quality": {"quality_notes": "Unobserved taxa strictly filled as 0.00"},
        }
        pollen_df = pd.DataFrame({
            "depth": [10.0, 20.0, 30.0],
            "Pinus": [45.2, 50.1, 48.0],
            "Betula": [12.0, 0.0, 8.5],
        })
        age_depth_df = pd.DataFrame({
            "depth": [10.0, 20.0, 30.0],
            "age_est": [150.0, 320.0, 510.0],
            "age_min": [120.0, 280.0, 460.0],
            "age_max": [180.0, 360.0, 560.0],
        })
        ensemble_tables = [
            {
                "name": "Bacon_Ensemble_1000",
                "columns": ["depth", "iter_1", "iter_2"],
                "data": [[10.0, 148.0, 152.0], [20.0, 315.0, 325.0], [30.0, 505.0, 515.0]],
            }
        ]

        xlsx_bytes = export_scientific_xlsx(
            meta_info=meta_info,
            pollen_df=pollen_df,
            age_depth_df=age_depth_df,
            ensemble_tables=ensemble_tables,
            include_readme=True,
        )
        self.assertGreater(len(xlsx_bytes), 1000)

        # Inspect generated workbook with openpyxl
        import io
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        self.assertIn("meta_info", wb.sheetnames)
        self.assertIn("pollen", wb.sheetnames)
        self.assertIn("age-depth", wb.sheetnames)
        self.assertIn("ensemble_table", wb.sheetnames)
        self.assertIn("readme", wb.sheetnames)

        # Check meta_info contents
        ws_meta = wb["meta_info"]
        found_doi = any(cell.value == "10.1016/j.quascirev.2026.01" for row in ws_meta.iter_rows() for cell in row)
        self.assertTrue(found_doi)

    def test_06_lipd_jsonld_and_package(self):
        """Verify Linked Paleo Data (LiPD) JSON-LD structure and .lpd zip package."""
        meta_info = {
            "publication": {"doi": "10.1016/j.quascirev.2026.01", "title": "Lake Chon Pollen", "authors": ["Jane Explorer"], "journal": "QSR", "year": 2026},
            "site": {"site_name": "Loch_Chon", "latitude": 56.12, "longitude": -4.51, "elevation_m": 120, "archive_type": "lake sediment"},
            "chronology": {"age_model": "Bacon", "cal_curve": "IntCal20"},
            "technical": {"pollen_extraction_method": "HF"},
            "quality": {"quality_notes": "None"},
        }
        pollen_df = pd.DataFrame({"depth": [0.0, 10.0], "Pinus": [25.0, 30.0]})
        age_depth_df = pd.DataFrame({"depth": [0.0, 10.0], "age_est": [50.0, 180.0]})
        ensemble_tables = [
            {"name": "Bacon_1000", "columns": ["depth", "iter_1"], "data": [[0.0, 48.0], [10.0, 182.0]]}
        ]

        # 1. JSON-LD structure
        jsonld = export_lipd_jsonld(meta_info, pollen_df, age_depth_df, ensemble_tables)
        self.assertEqual(jsonld["@context"], "https://linked.earth/ontology/lipd.jsonld")
        self.assertEqual(jsonld["geo"]["siteName"], "Loch_Chon")
        self.assertEqual(jsonld["geo"]["latitude"], 56.12)
        self.assertEqual(len(jsonld["paleoData"][0]["paleoMeasurementTable"][0]["columns"]), 2)
        self.assertIn("ensembleTable", jsonld)

        # 2. .lpd (zip) packaging
        pkg_bytes = export_lipd_package(meta_info, pollen_df, age_depth_df, ensemble_tables)
        import io
        with zipfile.ZipFile(io.BytesIO(pkg_bytes), "r") as zf:
            namelist = zf.namelist()
            self.assertTrue(any(name.endswith(".jsonld") for name in namelist))
            self.assertIn("bagit.txt", namelist)

    def test_07_session_integration_full_pipeline(self):
        """Verify full session workflow from DOI -> age-depth extraction -> native ensemble -> XLSX & LiPD export."""
        session = StraditizeSession()
        session.load_image(sample_key="hoya")
        session.detect_columns([315, 1946], [511, 1311])
        session.apply_depth_grid(start_depth=0, end_depth=150, step=10)

        # 1. Set paper metadata
        session.metadata_update({
            "publication": {"doi": "10.1038/s41586-026-0001", "title": "Hoya del Castillo Pollen Record", "authors": ["S. Perez"], "journal": "Nature", "year": 2026},
            "site": {"site_name": "Hoya del Castillo", "latitude": "39.5", "longitude": "-2.8", "elevation_m": "950", "archive_type": "lake sediment"},
        })

        # 2. Extract age-depth model (which automatically generates and mounts native ensemble)
        ad_res = session.calibrate_and_extract_age_depth(
            depth_px=[32.0, 668.0],
            depth_vals=[0.0, 150.0],
            age_px=[110.0, 804.0],
            age_vals=[3000.0, 0.0],
            notes="Bacon model for Hoya core",
        )
        self.assertTrue(ad_res["status"] == "extracted")
        self.assertIsNotNone(ad_res.get("generated_ensemble"))

        # Verify ensemble table is now natively registered in session
        ens_list = session.ensemble_list()
        self.assertGreaterEqual(ens_list["count"], 1)
        self.assertIn("Bacon_Ensemble_1000", [t["name"] for t in ens_list["tables"]])

        # 3. Export XLSX with all sheets included
        xlsx_res = session.export_advanced_xlsx(include_age_depth=True, include_ensemble_names=["Bacon_Ensemble_1000"])
        self.assertTrue(xlsx_res["success"])
        self.assertGreater(xlsx_res["size_bytes"], 2000)

        # 4. Export LiPD package
        lipd_res = session.export_advanced_lipd(include_age_depth=True, include_ensemble_names=["Bacon_Ensemble_1000"])
        self.assertTrue(lipd_res["success"])
        self.assertGreater(lipd_res["size_bytes"], 1000)


if __name__ == "__main__":
    unittest.main()
