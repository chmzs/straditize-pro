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

REPO_ROOT = Path(__file__).resolve().parents[2]
AGE_MODELS_DIR = REPO_ROOT / "straditize_core" / "assets" / "age_models"


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


class TestSedimentationRateEstimate(unittest.TestCase):
    """The rate must be a windowed regression with an error bar, not a point derivative.

    A digitised trace carries ~1 px of age error per row. Differentiating the fitted curve
    point by point turns that noise straight into the rate, attaches no uncertainty, and
    lapses to "undefined" wherever isotonic pooling flattened the curve. These tests pin the
    replacement: least squares over a window, slope inverted to depth per year, with the
    slope's standard error propagated through the inversion.
    """

    @staticmethod
    def _constant_core(scale: float = 1.0, noise_sd: float = 12.0):
        """41 horizons, 5 cm apart, a true 25 yr/cm, plus optional per-horizon noise."""
        depths = np.arange(0.0, 201.0, 5.0)
        clean = depths * 25.0
        noisy = clean + np.random.default_rng(0).normal(0, noise_sd, depths.size)
        model = AgeDepthModel(
            depths=depths,
            ages=noisy / scale,
            age_min=(noisy - 40) / scale,
            age_max=(noisy + 40) / scale,
        )
        return model, depths

    def test_recovers_a_known_constant_rate(self):
        model, depths = self._constant_core()
        res = model.estimate_sedimentation_rate(depths)
        sed = np.asarray([v for v in res["sed_rate"] if v is not None])
        self.assertEqual(sed.size, depths.size, "every horizon should be defined here")
        # truth: 25 yr/cm -> 1/25 = 0.04 cm/yr
        self.assertAlmostEqual(float(np.median(sed)), 0.04, delta=0.002)
        # and it must be stable across the core, since the truth is constant
        self.assertLess(float(np.percentile(sed, 95) - np.percentile(sed, 5)), 0.01)

    def test_reports_a_standard_error(self):
        model, depths = self._constant_core()
        res = model.estimate_sedimentation_rate(depths)
        se = [v for v in res["sed_rate_se"] if v is not None]
        self.assertEqual(len(se), depths.size)
        self.assertTrue(all(v > 0 for v in se), "a rate without an error bar is unusable")
        rel = np.asarray(se) / np.asarray([v for v in res["sed_rate"] if v is not None])
        # The synthetic core carries a +/-40 yr envelope, so the envelope-derived relative
        # standard error bottoms out near 57/40/25 = 5.7% no matter how wide the window gets.
        # That is the fixture's floor, not a defect; the point of the assertion is that the
        # error bar exists, is finite, and is the right order of magnitude.
        self.assertLess(float(np.median(rel)), 0.10)
        self.assertGreater(float(np.median(rel)), 0.0)
        # And it must be reported separately from the OLS-only figure, so a caller can see
        # that the OLS number is optimistic on an interpolated curve.
        self.assertIn("sed_rate_se_ols", res)
        ols = [v for v in res["sed_rate_se_ols"] if v is not None]
        self.assertGreater(len(ols), 0)
        self.assertGreater(
            float(np.median(se)), float(np.median(ols)),
            "the reported error must not be the optimistic OLS-only figure",
        )

    def test_the_age_axis_scale_cancels_out(self):
        """A 0..9 ka axis and a 0..9000 yr axis describe one core; the rate must not differ.

        This is the factor-of-1000 trap: both axes can be labelled "cal BP", so the scale is
        inferred from the magnitudes and reported, rather than trusted from a unit string.
        """
        years_model, depths = self._constant_core(scale=1.0)
        ka_model, _ = self._constant_core(scale=1000.0)

        years_res = years_model.estimate_sedimentation_rate(depths)
        ka_res = ka_model.estimate_sedimentation_rate(depths)

        self.assertEqual(years_res["years_per_age_unit"], 1.0)
        self.assertEqual(ka_res["years_per_age_unit"], 1000.0)
        self.assertIn("ka", ka_res["age_scale_inferred"])

        first = np.median([v for v in years_res["sed_rate"] if v is not None])
        second = np.median([v for v in ka_res["sed_rate"] if v is not None])
        self.assertAlmostEqual(float(first), float(second), delta=0.002)

    def test_a_reversal_yields_null_not_a_number(self):
        """Where age does not advance with depth there is no rate, and it must say so.

        The reversal has to be a NEGATIVE SLOPE, not a downward shift: shifting a block of
        ages down by a constant leaves the within-window slope at +25 yr/cm, so a windowed
        estimator rightly still reports a rate there. Inverting the deeper half makes the
        slope negative, which is the case that has no rate at all.
        """
        depths = np.arange(0.0, 201.0, 5.0)
        ages = depths * 25.0
        # Deeper half runs backwards at the same magnitude: slope -25 yr/cm.
        ages[20:] = ages[19] - (depths[20:] - depths[19]) * 25.0 - 30.0
        model = AgeDepthModel(
            depths=depths, ages=ages, age_min=ages - 40, age_max=ages + 40
        )
        res = model.estimate_sedimentation_rate(depths)
        bad = [
            (d, s)
            for d, s, st in zip(res["depths"], res["sed_rate"], res["status"])
            if st == "non_positive_slope"
        ]
        self.assertGreater(len(bad), 0, "the reversal must be detected")
        for depth, rate in bad:
            self.assertIsNone(
                rate, f"depth {depth}: a reversed interval was given a numeric rate"
            )

    def test_a_shifted_block_is_not_mistaken_for_a_reversal(self):
        """A constant downward shift keeps a positive slope, so a rate is still defined.

        This guards the opposite error: flagging every age decrease as a reversal when the
        window still sees a coherent, if offset, chronology.
        """
        depths = np.arange(0.0, 201.0, 5.0)
        ages = depths * 25.0
        ages[20:] -= 300.0          # offset, but still rising at 25 yr/cm
        model = AgeDepthModel(
            depths=depths, ages=ages, age_min=ages - 40, age_max=ages + 40
        )
        res = model.estimate_sedimentation_rate(depths)
        n_ok = sum(1 for st in res["status"] if st == "ok")
        self.assertGreater(
            n_ok, len(depths) // 2,
            "an offset horizon sequence still has a positive slope and a valid rate",
        )

    def test_too_few_horizons_is_refused(self):
        model = AgeDepthModel(depths=np.array([0.0, 10.0]), ages=np.array([0.0, 250.0]))
        with self.assertRaises(ValueError) as ctx:
            model.estimate_sedimentation_rate([0.0, 10.0])
        self.assertIn("at least three horizons", str(ctx.exception))

    def test_window_is_chosen_not_imposed(self):
        """The smoothing length is a DEPTH THICKNESS, reported, and bounded by the cap.

        Counting horizons instead would make the smoothing length depend on the resampling
        grid rather than on the data: the native trace carries one row every 0.2 cm, so
        "20 horizons" meant 4 cm -- thin enough that the fitted curve is locally linear and
        the OLS residual collapsed to a fake confidence of se = 0.
        """
        model, depths = self._constant_core()
        res = model.estimate_sedimentation_rate(depths)
        self.assertIn("window_depth", res)
        thickness = res["window_depth"]
        self.assertIsNotNone(thickness)
        self.assertGreater(thickness, 0)
        # Bounded by max_window_fraction (20%) of the observed depth span.
        span = float(np.max(model.analysis_depths) - np.min(model.analysis_depths))
        self.assertLessEqual(thickness, span * 0.2 + 1e-6)
        # A wider thickness must actually be used by more horizons.
        self.assertGreater(max(res["window_per_horizon"]), 3)
        # And an explicit thickness must be honoured rather than searched over.
        fixed = model.estimate_sedimentation_rate(depths, window=20.0)
        self.assertAlmostEqual(fixed["window_depth"], 20.0)


if __name__ == "__main__":
    unittest.main()
