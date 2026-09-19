# -*- coding: utf-8 -*-
"""Regression tests against the real bundled age-depth figures.

The synthetic figures in ``test_age_depth_extraction_quality`` verify the extractor on
controlled geometry. These tests run against the two renderings that ship with the app,
because both exposed failures that synthetic geometry did not:

* ``bacon_szek.png`` carries an inline ``szek`` title near the top-left. A
  darkness-only bootstrap locked onto that text and dragged a spurious horizontal
  segment across the panel, truncating the shallow end of the curve at ~471 cal BP
  instead of ~0.
* the same figure draws its depth axis rule past the outermost tick label (ticks stop
  at 150 cm, the rule runs to ~166 cm). A search window derived from the calibration
  points alone cut the curve off at the 150 cm tick.

The assertions below are invariants chosen to fail loudly on exactly those two
regressions, rather than imprecise hand-read checkpoints.
"""
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import unittest

import numpy as np
from PIL import Image

from straditize_core.age_depth import AgeDepthAxisCalibrator, extract_age_depth_model

FIGURE_DIR = REPO_ROOT / "tests" / "test_figures" / "age_models"


def _bacon_calibrator() -> AgeDepthAxisCalibrator:
    """Calibration read off the bacon_szek.png tick marks (measured programmatically)."""
    return AgeDepthAxisCalibrator(
        depth_px=[32.0, 668.0],
        depth_vals=[0.0, 150.0],
        age_px=[110.0, 803.5],
        age_vals=[3000.0, 0.0],
    )


def _bchron_calibrator() -> AgeDepthAxisCalibrator:
    """Calibration read off the bchron_stepped.png tick marks (age axis runs 0 -> 12000)."""
    return AgeDepthAxisCalibrator(
        depth_px=[10.0, 355.0],
        depth_vals=[0.0, 150.0],
        age_px=[95.0, 645.0],
        age_vals=[0.0, 12000.0],
    )


class TestRealFigureExtraction(unittest.TestCase):
    def test_bacon_sample_full_curve_span(self):
        """The trace must reach both ends of the drawn curve, not just the tick range."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        model = extract_age_depth_model(
            img,
            _bacon_calibrator(),
            depth_range=(0.0, 160.0),
            resample_step=2.0,
        )
        depths = np.asarray(model.depths, dtype=float)
        ages = np.asarray(model.ages, dtype=float)

        # Deep end: the curve flattens into a bulge past the 150 cm tick. A search window
        # clipped to the calibration points truncates at ~2310 cal BP instead.
        self.assertGreater(
            float(ages.max()),
            2800.0,
            "deep end of the curve was truncated; search window too tight",
        )
        self.assertGreater(
            float(depths.max()),
            150.0,
            "extraction stopped at the last depth tick instead of the axis-rule extent",
        )

        # Shallow end: the curve starts at the top-right near 0 cal BP. A trace that locks
        # onto the inline 'szek' title reports a minimum age around 471 cal BP instead.
        self.assertLess(
            float(ages.min()),
            150.0,
            "shallow end never reached the top of the curve (possible title-text lock-on)",
        )

    def test_bacon_sample_monotonic_and_bounded_envelope(self):
        """Ages increase downcore and the envelope stays a band, not the whole panel."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        model = extract_age_depth_model(
            img, _bacon_calibrator(), depth_range=(0.0, 160.0), resample_step=2.0
        )
        ages = np.asarray(model.ages, dtype=float)
        lo = np.asarray(model.age_min, dtype=float)
        hi = np.asarray(model.age_max, dtype=float)

        self.assertTrue(np.all(np.diff(ages) >= -1e-6), "extracted ages not monotonic")
        self.assertTrue(np.all(lo <= ages + 1e-6), "age_min exceeds the median curve")
        self.assertTrue(np.all(hi >= ages - 1e-6), "age_max falls below the median curve")

        span = float(ages.max() - ages.min())
        width = float(np.median(hi - lo))
        self.assertLess(width, 0.5 * span, "envelope degenerated into a full-panel blob")

    def test_bchron_stepped_reversed_age_axis(self):
        """The age axis runs young -> old (left -> right); direction must be respected."""
        img = Image.open(FIGURE_DIR / "bchron_stepped.png").convert("RGB")
        model = extract_age_depth_model(
            img, _bchron_calibrator(), depth_range=(0.0, 180.0), resample_step=2.0
        )
        depths = np.asarray(model.depths, dtype=float)
        ages = np.asarray(model.ages, dtype=float)

        self.assertTrue(np.all(np.diff(ages) >= -1e-6), "extracted ages not monotonic")
        self.assertLess(float(ages.min()), 1500.0, "shallow end not reached")
        self.assertGreater(float(ages.max()), 11000.0, "deep end not reached")
        self.assertGreater(float(depths.max()), 165.0, "stepped curve truncated early")

    def test_bchron_stepped_step_geometry_preserved(self):
        """The stepped profile must survive: the trace cannot be smoothed into a ramp."""
        img = Image.open(FIGURE_DIR / "bchron_stepped.png").convert("RGB")
        model = extract_age_depth_model(
            img, _bchron_calibrator(), depth_range=(0.0, 180.0), resample_step=2.0
        )
        ages = np.asarray(model.ages, dtype=float)
        depths = np.asarray(model.depths, dtype=float)

        # Sedimentation rate across the profile: a stepped chronology alternates between
        # near-vertical steps and long near-flat treads, so the rate spread must be large.
        rate = np.diff(ages) / np.maximum(np.diff(depths), 1e-9)
        spread = float(np.percentile(rate, 95) - np.percentile(rate, 5))
        self.assertGreater(spread, 40.0, "stepped structure was flattened away")


class TestAgeDirectionConvention(unittest.TestCase):
    """The age axis convention drives the monotonicity prior, and is not guessable.

    The four calibration points alone cannot tell you whether an axis is BP-style
    (increasing downcore) or AD/CE-style (increasing upcore). Applying isotonic regression
    in the wrong direction does not error -- it flattens a valid chronology into a constant
    -- so the convention is declared explicitly and a contradiction is refused.
    """

    def _bacon_image(self):
        return Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")

    def test_bp_and_ad_conventions_both_recover_the_curve(self):
        img = self._bacon_image()
        # The same physical figure read as cal yr BP ...
        bp = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        m_bp = extract_age_depth_model(
            img, bp, depth_range=(0.0, 160.0), resample_step=2.0,
            age_increases_downcore=True,
        )
        ages_bp = np.asarray(m_bp.ages, dtype=float)
        self.assertTrue(np.all(np.diff(ages_bp) >= -1e-9))
        self.assertGreater(float(ages_bp.max() - ages_bp.min()), 2000.0)

        # ... and as cal yr AD (increasing upcore, so decreasing downcore).
        ad = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[0.0, 3000.0],
        )
        m_ad = extract_age_depth_model(
            img, ad, depth_range=(0.0, 160.0), resample_step=2.0,
            age_increases_downcore=False,
        )
        ages_ad = np.asarray(m_ad.ages, dtype=float)
        self.assertTrue(np.all(np.diff(ages_ad) <= 1e-9))
        self.assertGreater(float(ages_ad.max() - ages_ad.min()), 2000.0)

    def test_misdeclared_direction_is_refused(self):
        """A declaration contradicting the figure must fail loudly, not flatten silently."""
        img = self._bacon_image()
        ad = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[0.0, 3000.0],
        )
        with self.assertRaises(ValueError) as ctx:
            extract_age_depth_model(
                img, ad, depth_range=(0.0, 160.0), resample_step=2.0,
                age_increases_downcore=True,
            )
        self.assertIn("contradicts the figure", str(ctx.exception))


class TestSedimentationRate(unittest.TestCase):
    def test_two_rate_conventions_are_reciprocal(self):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), resample_step=2.0)
        pred = model.predict_age(model.depths)

        acc = np.asarray(
            [v if v is not None else np.nan for v in pred["acc_rate_yr_per_depth"]], dtype=float
        )
        sed = np.asarray(
            [v if v is not None else np.nan for v in pred["sed_rate_depth_per_yr"]], dtype=float
        )
        self.assertGreater(float(np.nanmin(acc)), -1e-9, "accumulation rate cannot be negative")
        self.assertGreater(float((acc > 0).mean()), 0.5, "most horizons should accumulate")
        # A rate is reported as a magnitude, so reciprocals must agree where both are
        # finite. Tolerance covers the 4-decimal rounding applied for JSON transport.
        finite = np.isfinite(acc) & np.isfinite(sed) & (acc > 0) & (sed > 0)
        self.assertTrue(np.allclose(acc[finite] * sed[finite], 1.0, rtol=5e-3))
        self.assertEqual(pred["rate_units"]["sed_rate"], "cm per year")

    def test_legacy_key_preserved(self):
        """The old sed_rate_yr_per_cm key must keep its original meaning."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), resample_step=2.0)
        pred = model.predict_age(model.depths)
        self.assertEqual(
            pred["sed_rate_yr_per_cm"], pred["acc_rate_yr_per_depth"]
        )

    def test_interval_rate_reported(self):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), resample_step=2.0)
        pred = model.predict_age(model.depths)
        interval = np.asarray(
            [v if v is not None else np.nan for v in pred["interval_acc_rate_yr_per_depth"]],
            dtype=float,
        )
        self.assertEqual(interval.size, len(model.depths))
        self.assertTrue(np.any(np.isfinite(interval)))

    def test_ensemble_supplies_rate_uncertainty(self):
        """Rate uncertainty comes from the ensemble, so it must widen the point estimate."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), resample_step=2.0)
        depths = np.asarray(model.depths, dtype=float)
        ens = model.generate_age_ensemble(
            depths, n_ensembles=400, name="t", return_diagnostics=True
        )
        rate = ens["diagnostics"]["rate"]

        def _f(key):
            return np.asarray([v if v is not None else np.nan for v in rate[key]], dtype=float)

        mid, lo, hi = (
            _f("acc_rate_yr_per_depth"),
            _f("acc_rate_yr_per_depth_min"),
            _f("acc_rate_yr_per_depth_max"),
        )

        self.assertEqual(mid.size, depths.size)
        ok = np.isfinite(mid) & np.isfinite(lo) & np.isfinite(hi)
        self.assertTrue(np.all(lo[ok] <= mid[ok] + 1e-6))
        self.assertTrue(np.all(hi[ok] >= mid[ok] - 1e-6))
        # A point estimate would report no spread at all; the posterior must have some.
        self.assertGreater(float(np.median(hi[ok] - lo[ok])), 0.0)


class TestAgeDepthExportColumns(unittest.TestCase):
    """Rate columns must be opt-in and must carry their unit into the dataset."""

    def _pred(self):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), resample_step=2.0)
        return model.predict_age([0.0, 2.0, 4.0])

    def test_nothing_selected_still_exports_ages(self):
        from straditize_core.session import build_age_depth_frame

        df = build_age_depth_frame(self._pred(), [], "cal BP", "cm")
        self.assertEqual(list(df.columns), ["depths", "age_est", "age_min", "age_max"])

    def test_selected_rates_are_named_with_units(self):
        from straditize_core.session import build_age_depth_frame

        df = build_age_depth_frame(
            self._pred(), ["volume_ar_cm_per_yr", "acc_rate_yr_per_depth"], "cal BP", "cm"
        )
        cols = list(df.columns)
        self.assertIn("acc_rate (cal BP per cm)", cols)
        self.assertIn("volume_ar (cm per yr; = cm3 cm-2 yr-1)", cols)
        # The unit-less legacy alias must not leak in as a duplicate of acc_rate.
        self.assertNotIn("sed_rate_yr_per_cm", cols)
        self.assertNotIn("rate_units", [c for c in cols if c == "depths"])
        self.assertIn("rate_units", cols)
        self.assertIn("cal BP per cm", str(df["rate_units"].iloc[0]))

    def test_unselected_rate_is_dropped(self):
        from straditize_core.session import build_age_depth_frame

        df = build_age_depth_frame(self._pred(), ["volume_ar_cm_per_yr"], "cal BP", "cm")
        cols = list(df.columns)
        self.assertTrue(any(c.startswith("volume_ar") for c in cols))
        self.assertFalse(any(c.startswith("acc_rate") for c in cols))

    def test_no_rate_column_is_ever_unitless(self):
        from straditize_core.session import (
            AGE_DEPTH_RATE_COLUMNS,
            build_age_depth_frame,
        )

        df = build_age_depth_frame(
            self._pred(), list(AGE_DEPTH_RATE_COLUMNS), "ka cal BP", "m"
        )
        for col in df.columns:
            if col in ("depths", "age_est", "age_min", "age_max", "rate_units"):
                continue
            # Every rate column name must state its unit.
            self.assertTrue(
                "per" in col and ("(" in col),
                f"rate column {col!r} does not declare its unit",
            )


if __name__ == "__main__":
    unittest.main()
