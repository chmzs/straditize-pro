# -*- coding: utf-8 -*-
"""Unit tests for age-depth model diagram recognition, extraction, and uncertainty mapping.

Uses authentic Bacon and Bchron age-depth plots from real scientific literature.
"""
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

from straditize_core.age_depth import (
    AgeDepthAxisCalibrator,
    AgeDepthModel,
    extract_age_depth_model,
    generate_bacon_script,
)

TEST_DIR = Path(__file__).resolve().parent
AGE_MODELS_DIR = TEST_DIR / "test_figures" / "age_models"


class AgeDepthModelRecognitionTest(unittest.TestCase):
    def setUp(self):
        self.bacon_img_path = AGE_MODELS_DIR / "bacon_szek.png"
        self.bchron_img_path = AGE_MODELS_DIR / "bchron_stepped.png"
        self.assertTrue(self.bacon_img_path.exists(), "Missing bacon_szek.png test figure")
        self.assertTrue(self.bchron_img_path.exists(), "Missing bchron_stepped.png test figure")

    def test_01_bacon_szek_model_extraction(self):
        """Verify feature line and 95% confidence envelope extraction from Bacon szek plot."""
        img = Image.open(self.bacon_img_path)
        w, h = img.size

        # Bacon szek plot axes:
        # Depth axis (Y): 0 cm near top (y ~ 54), 150 cm near bottom (y ~ 737)
        # Age axis (X): 3000 cal BP on left (x ~ 148), 0 cal BP on right (x ~ 806)
        calibrator = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0],
            depth_vals=[0.0, 150.0],
            age_px=[110.0, 804.0],
            age_vals=[3000.0, 0.0],
            depth_unit="cm",
            age_unit="cal BP",
        )

        roi_box = (120, 50, 820, 740)
        model = extract_age_depth_model(
            img,
            calibrator=calibrator,
            roi_box=roi_box,
            curve_type="weighted_mean",
            envelope_type="95_hpd",
            cal_curve="IntCal20",
            notes="Extracted from authentic Szek Bacon profile",
        )

        # 1. Check extracted depths and ages arrays
        self.assertGreater(len(model.depths), 100)
        self.assertEqual(len(model.depths), len(model.ages))
        self.assertEqual(len(model.ages), len(model.age_min))
        self.assertEqual(len(model.age_min), len(model.age_max))

        # 2. Mathematical constraint: min age <= age_est <= max age
        self.assertTrue(np.all(model.age_min <= model.age_max + 1e-6))

        # 3. Scientific check at known depth horizons on Szek core:
        # Depth 50 cm: approx 350 - 550 cal BP
        pred_50 = model.predict_age([50.0])
        self.assertGreater(pred_50["age_est"][0], 250.0)
        self.assertLess(pred_50["age_est"][0], 650.0)

        # Depth 100 cm: approx 900 - 1300 cal BP
        pred_100 = model.predict_age([100.0])
        self.assertGreater(pred_100["age_est"][0], 800.0)
        self.assertLess(pred_100["age_est"][0], 1400.0)

        # Depth 150 cm: approx 2200 - 2900 cal BP
        pred_150 = model.predict_age([150.0])
        self.assertGreater(pred_150["age_est"][0], 2000.0)
        self.assertLess(pred_150["age_est"][0], 3000.0)

        # 4. Multi-sample depth interpolation
        pollen_depths = [10.0, 30.0, 50.0, 70.0, 90.0, 110.0, 130.0, 150.0]
        mapped = model.predict_age(pollen_depths)
        self.assertEqual(len(mapped["depths"]), len(pollen_depths))
        self.assertEqual(len(mapped["age_est"]), len(pollen_depths))
        self.assertEqual(len(mapped["sed_rate_yr_per_cm"]), len(pollen_depths))

        # Monotonically increasing age with depth
        self.assertTrue(np.all(np.diff(mapped["age_est"]) > 0))

        # Check user-provided metadata
        self.assertEqual(mapped["metadata"]["curve_type"], "weighted_mean")
        self.assertEqual(mapped["metadata"]["envelope_type"], "95_hpd")
        self.assertEqual(mapped["metadata"]["calibration_curve"], "IntCal20")

    def test_02_bchron_stepped_model_extraction(self):
        """Verify stepped age-depth curve and confidence band extraction from Bchron plot."""
        img = Image.open(self.bchron_img_path)
        w, h = img.size

        # Bchron stepped plot axes:
        # Depth axis (Y): 0 cm near top (y ~ 24), 150 cm near bottom (y ~ 410)
        # Age axis (X): 0 cal yr BP on left (x ~ 80), 12000 cal yr BP on right (x ~ 720)
        calibrator = AgeDepthAxisCalibrator(
            depth_px=[24.0, 410.0],
            depth_vals=[0.0, 150.0],
            age_px=[80.0, 720.0],
            age_vals=[0.0, 12000.0],
            depth_unit="cm",
            age_unit="cal yr BP",
        )

        roi_box = (60, 20, 735, 470)
        model = extract_age_depth_model(
            img,
            calibrator=calibrator,
            roi_box=roi_box,
            curve_type="median",
            envelope_type="95_ci",
            cal_curve="IntCal20",
        )

        self.assertGreater(len(model.depths), 80)
        # Check depth 100 cm: age roughly 4000 - 6500 cal yr BP
        pred = model.predict_age([100.0])
        self.assertGreater(pred["age_est"][0], 3500.0)
        self.assertLess(pred["age_est"][0], 7000.0)
        self.assertLessEqual(pred["age_min"][0], pred["age_est"][0])
        self.assertGreaterEqual(pred["age_max"][0], pred["age_est"][0])

    def test_03_generate_bacon_script(self):
        """Verify automated generation of rbacon R modeling script."""
        dates = [
            {"id": "C14_1", "age": 850, "error": 30, "depth": 25.0, "thickness": 1},
            {"id": "C14_2", "age": 2200, "error": 45, "depth": 75.0, "thickness": 2},
            {"id": "C14_3", "age": 4500, "error": 60, "depth": 140.0, "thickness": 2},
        ]
        sample_depths = [10.0, 25.0, 50.0, 75.0, 100.0]
        r_code = generate_bacon_script("TestLake", dates, thickness=5, cc=1, sample_depths=sample_depths)

        self.assertIn("library(rbacon)", r_code)
        self.assertIn("Bacon(\"TestLake\"", r_code)
        self.assertIn("TestLake_depths.txt", r_code)
        self.assertIn("C14_1,850,30,25.0,1", r_code)


if __name__ == "__main__":
    unittest.main()
