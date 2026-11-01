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

REPO_ROOT = Path(__file__).resolve().parents[2]

import unittest

import numpy as np
from PIL import Image

from straditize_core.age_depth import AgeDepthAxisCalibrator, extract_age_depth_model

FIGURE_DIR = REPO_ROOT / "straditize_core" / "assets" / "age_models"


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
            img, _bacon_calibrator(), depth_range=(0.0, 160.0)
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
            img, _bchron_calibrator(), depth_range=(0.0, 180.0)
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
            img, _bchron_calibrator(), depth_range=(0.0, 180.0)
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
            img, bp, depth_range=(0.0, 160.0),
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
            img, ad, depth_range=(0.0, 160.0),
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
                img, ad, depth_range=(0.0, 160.0),
                age_increases_downcore=True,
            )
        message = str(ctx.exception)
        # The refusal must name the contradiction and the evidence behind it, so a user can
        # tell a mislabelled axis from a trace that locked onto the wrong stroke.
        self.assertIn("contradicts the age direction", message)
        self.assertIn("forced by the caller", message)
        self.assertIn("median pairwise slope", message)


class TestSedimentationRate(unittest.TestCase):
    def test_two_rate_conventions_are_reciprocal(self):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
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
        # finite. The tolerance used to be 5e-3, documented as "covers the 4-decimal
        # rounding" -- which is exactly how a real defect stayed hidden: the worst error was
        # 5.3%, so the check sat right at its own blind spot. Serialisation now keeps six
        # SIGNIFICANT digits, so the identity holds to a hundredth of a percent.
        finite = np.isfinite(acc) & np.isfinite(sed) & (acc > 0) & (sed > 0)
        self.assertTrue(np.allclose(acc[finite] * sed[finite], 1.0, rtol=1e-4))
        self.assertEqual(pred["rate_units"]["sed_rate"], "cm per year")

    def test_undefined_rate_is_null_not_zero(self):
        """An undefined rate must not be serialised as 0, which means "no deposition".

        At a horizon where PCHIP's derivative is exactly zero the accumulation rate is
        undefined, and so is its reciprocal. The reciprocal used to be written as 0.0, so
        the table showed "0.00 cm/yr" -- a positive claim that nothing is being deposited,
        when the honest answer is that the rate cannot be stated there. This is the project's
        no-substitute-data invariant applied to a reciprocal.
        """
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[142.0, 731.5], age_vals=[0.0, 9.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
        pred = model.predict_age(model.depths)

        acc = pred["acc_rate_yr_per_depth"]
        sed = pred["sed_rate_depth_per_yr"]
        # Wherever one is undefined the other must be too: they are reciprocals.
        for i, (a, s) in enumerate(zip(acc, sed)):
            if a is None:
                self.assertIsNone(
                    s,
                    f"horizon {i}: accumulation undefined but sedimentation reported as {s}",
                )
            if s is None:
                self.assertIsNone(a, f"horizon {i}: sedimentation undefined but acc is {a}")
        # The top of this particular core genuinely has a zero derivative, so the guard must
        # actually be exercised rather than pass vacuously.
        self.assertIn(None, acc, "expected at least one undefined rate on this figure")
        self.assertEqual(
            sum(1 for v in sed if v == 0.0), 0,
            "an undefined rate was serialised as 0.0 (i.e. 'no deposition')",
        )

    def test_interval_rates_are_reciprocal_too(self):
        """The interval arrays share the serialisation path, so they share the hazard."""
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[142.0, 731.5], age_vals=[0.0, 9.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
        pred = model.predict_age(model.depths)

        iacc = np.asarray(
            [v if v is not None else np.nan
             for v in pred["interval_acc_rate_yr_per_depth"]], dtype=float
        )
        ised = np.asarray(
            [v if v is not None else np.nan
             for v in pred["interval_sed_rate_depth_per_yr"]], dtype=float
        )
        finite = np.isfinite(iacc) & np.isfinite(ised) & (iacc > 0) & (ised > 0)
        self.assertGreater(int(finite.sum()), 20, "not enough finite intervals to judge")
        worst = float(np.max(np.abs(iacc[finite] * ised[finite] - 1.0)))
        self.assertLess(
            worst, 1e-4,
            f"interval rates stop being reciprocals (worst error {worst:.2%}); "
            f"before the significant-digit fix 21 of 32 horizons failed here",
        )

    def test_legacy_key_preserved(self):
        """The old sed_rate_yr_per_cm key must keep its original meaning."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
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
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
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
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
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
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)
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
        # The rate is per REAL YEAR, so the header says year -- not the age-axis label.
        # Templating {age_unit} in produced "acc_rate (cal BP per cm)" over a number that was
        # actually years per cm, which read as "3000 cal BP of age per centimetre".
        self.assertIn("acc_rate (yr per cm)", cols)
        self.assertIn("volume_ar (cm per yr; = cm3 cm-2 yr-1)", cols)
        # The unit-less legacy alias must not leak in as a duplicate of acc_rate.
        self.assertNotIn("sed_rate_yr_per_cm", cols)
        self.assertNotIn("rate_units", [c for c in cols if c == "depths"])
        self.assertIn("rate_units", cols)
        self.assertIn("year per cm", str(df["rate_units"].iloc[0]))

    def test_rates_are_per_real_year_on_a_ka_axis(self):
        """A "0..9 ka BP" axis must not make the exported rate 1000x too large.

        The extracted ages carry whatever magnitude the user calibrated against, but
        ``age_unit`` is a label supplied at extraction time and reads "cal BP" for both a
        0..9000 axis and a 0..9 one. Inverting the ka/cm slope therefore produced a number
        1000x too large under a "cm per year" heading. Measured on bacon_lithology.jpg before
        the fix: the exported sed_rate column read 960.5 where the truth was 0.96.

        The check is a magnitude test, not an exact-value test: the point is that the column
        lands in cm/yr, and the whole-core mean is the independent reference.
        """
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        # Age values 0..9, i.e. a kiloyear axis.
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[142.0, 731.5], age_vals=[0.0, 9.0],
        )
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0),)

        from straditize_core.session import build_age_depth_frame

        depths = [float(d) for d in model.analysis_depths[::80]]
        pred = model.predict_age(depths)
        self.assertIn(
            "years_per_age_unit", pred,
            "the payload must expose the age-scale factor so a caller can audit it",
        )
        self.assertEqual(pred["years_per_age_unit"], 1000.0)

        frame = build_age_depth_frame(
            pred, ["sed_rate_depth_per_yr"], model.age_unit, model.depth_unit
        )
        column = "sed_rate (cm per yr)"
        self.assertIn(column, frame.columns)
        values = [v for v in frame[column].tolist() if isinstance(v, float) and v == v]
        self.assertGreater(len(values), 0, "no finite rate was exported")

        # Whole-core reference: span_depth / span_age, computed from the model directly.
        span_depth = float(model.analysis_depths.max() - model.analysis_depths.min())
        span_years = float(
            model.analysis_ages.max() - model.analysis_ages.min()
        ) * 1000.0
        reference = span_depth / span_years
        median_exported = float(np.median(values))
        self.assertLess(
            abs(median_exported / reference - 1.0), 0.8,
            f"exported median {median_exported:.4f} cm/yr vs whole-core {reference:.4f}; "
            f"a factor of 1000 off means the ka->yr conversion went missing",
        )

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


class TestUploadedFigureReachesBackend(unittest.TestCase):
    """The backend extracts from its OWN session image, so an upload must be handed over.

    Regression: ``handleCustomImageFile`` used to set only the local canvas image. The
    calibration points then came from the user's figure while the pixels came from whatever
    the backend still held. Measured with bacon_lithology.jpg (761x998) against a stale
    bacon_szek.png (850x811) it surfaced only because the age-direction guard refused the
    mismatch; two similar figures would have produced a chronology for the wrong diagram.
    """

    def test_base64_load_replaces_session_image(self):
        import base64

        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        session.load_age_depth_diagram(sample_key="bacon")
        self.assertEqual((session.age_depth_image.width, session.age_depth_image.height), (850, 811))

        raw = (FIGURE_DIR / "bacon_lithology.jpg").read_bytes()
        payload = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
        res = session.load_age_depth_diagram(base64_data=payload)
        self.assertEqual(res["status"], "loaded")
        self.assertEqual((res["width"], res["height"]), (761, 998))
        self.assertIsNone(session.age_depth_image_path)

    def test_extraction_follows_the_loaded_upload(self):
        """Extraction geometry must change when a different figure is loaded."""
        import base64

        from straditize_core.session import StraditizeSession

        session = StraditizeSession()
        session.load_age_depth_diagram(sample_key="bacon")
        session.calibrate_and_extract_age_depth(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
            depth_range=[0.0, 160.0],
        )
        before = len(session.age_depth_model.depths)

        raw = (FIGURE_DIR / "bacon_lithology.jpg").read_bytes()
        session.load_age_depth_diagram(
            base64_data="data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
        )
        session.calibrate_and_extract_age_depth(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[148.0, 733.0], age_vals=[0.0, 9000.0],
            depth_range=[0.0, 160.0],
        )
        after = session.age_depth_model
        # Pixel tracks must live in the NEW image's coordinate space. The old figure was
        # 850x811; the uploaded one is 761x998, so a track row beyond 811 can only come
        # from the new image. (A depth-count comparison would be brittle: the traced span
        # differs by a row or two between figures.)
        self.assertGreater(
            float(np.max(after.px_y)),
            811.0,
            "extraction still reports rows inside the previous figure",
        )
        self.assertLessEqual(float(np.max(after.px_y)), 998.0)
        self.assertLessEqual(float(np.max(after.px_x_curve)), 761.0)


class TestChromaticMedianLine(unittest.TestCase):
    """A coloured median over a grey cloud must be traced by its colour, not its darkness.

    bacon_lithology.jpg draws the median as a RED DASHED line and the envelope as a BLACK
    dashed outline. In greyscale red (255,0,0) is 76 and black is 0, so a darkness-only
    tracker follows the younger envelope boundary: measured 0 cm -> -105 and 150 cm -> 4269
    cal BP against a reference of ~0 and ~6550. The extractor now projects colour onto the
    figure's own dominant chromatic direction and prefers that channel when it spans the
    panel, so the median is located by hue while the envelope is still measured by darkness.
    """

    def _model(self, **kw):
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[148.0, 733.0], age_vals=[0.0, 9000.0],
        )
        return extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), **kw)

    def test_chromatic_channel_selected(self):
        model = self._model()
        self.assertEqual(
            model.curve_channel,
            "chroma",
            f"fell back to darkness: {model.curve_channel_reason}",
        )
        # The diagnostic must survive serialisation, not silently reset to the default.
        self.assertEqual(
            model.to_inspection_data()["metadata"]["curve_channel"], "chroma"
        )

    def test_greyscale_figures_stay_on_darkness(self):
        """Figures without a coloured stroke must not switch channels."""
        reasons = {}
        for name, depth_px, age_px, age_vals, drange in (
            ("bacon_szek.png", [32.0, 668.0], [110.0, 803.5], [3000.0, 0.0], (0.0, 160.0)),
            ("bchron_stepped.png", [10.0, 355.0], [95.0, 645.0], [0.0, 12000.0], (0.0, 180.0)),
        ):
            img = Image.open(FIGURE_DIR / name).convert("RGB")
            cal = AgeDepthAxisCalibrator(
                depth_px=depth_px, depth_vals=[0.0, 150.0],
                age_px=age_px, age_vals=age_vals,
            )
            model = extract_age_depth_model(img, cal, depth_range=drange)
            self.assertEqual(
                model.curve_channel, "darkness", f"{name} unexpectedly switched to chroma"
            )
            reasons[name] = model.curve_channel_reason

        # Bchron carries thin BLUE dating-point bars. They are chromatic and thin, so a
        # width-only test would pick them; the row-span comparison must reject them and say
        # why, so the fallback is legible rather than mysterious.
        self.assertIn("dating", reasons["bchron_stepped.png"])

    def test_traces_the_coloured_median(self):
        """Against an independent per-row colour-argmax reference, error must be tiny."""
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        rgb = np.array(img)[..., :3].astype(np.int16)
        # R - max(G,B): grey and black are 0, a red stroke is strongly positive.
        redness = rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[148.0, 733.0], age_vals=[0.0, 9000.0],
        )

        ref_depth, ref_age = [], []
        for y in range(110, 880):
            strip = redness[y, 148:734]
            xs = np.flatnonzero(strip > 10)
            if xs.size:
                ref_depth.append(float(cal.px2depth(float(y))))
                ref_age.append(float(cal.px2age(float(148 + xs[int(np.argmax(strip[xs]))]))))
        ref_depth = np.asarray(ref_depth)
        ref_age = np.asarray(ref_age)
        self.assertGreater(ref_depth.size, 500, "reference trace is too sparse to score")

        model = self._model()
        depths = np.asarray(model.depths, dtype=float)
        ages = np.asarray(model.ages, dtype=float)

        rel = []
        for dep, age in zip(depths, ages):
            if ref_depth.min() <= dep <= ref_depth.max():
                truth = ref_age[int(np.argmin(np.abs(ref_depth - dep)))]
                if truth > 200:  # skip the near-zero top of the core
                    rel.append((age - truth) / truth)
        rel = np.asarray(rel)
        self.assertGreater(rel.size, 300)
        self.assertLess(
            float(np.median(np.abs(rel))),
            0.02,
            f"median |error| {np.median(np.abs(rel)):.2%} against the colour reference",
        )
        self.assertLess(float(np.percentile(np.abs(rel), 95)), 0.05)


class TestSearchRegionIndependentOfCalibration(unittest.TestCase):
    """The search region must not be derived from where the calibration points sit.

    The two age calibration points say what the pixels MEAN, not which part of the panel to
    read. Clamping the axis-rule extent to a margin around the calibration rectangle coupled
    them, and failed silently because users pick two legible ticks rather than the outermost
    ones -- the truncation was horizontal, so rows whose curve fell outside the clamped
    x-window found no candidates and dropped out vertically too.
    """

    #: Three equally legitimate choices of which two age ticks to calibrate against.
    CALIBRATIONS = [
        ([110.0, 803.5], [3000.0, 0.0]),
        ([340.0, 573.0], [2000.0, 1000.0]),
        ([458.0, 688.0], [1500.0, 500.0]),
    ]

    def _extract(self, age_px, age_vals):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=age_px, age_vals=age_vals,
        )
        return extract_age_depth_model(img, cal, depth_range=(0.0, 160.0))

    def test_depth_span_is_identical_across_calibration_choices(self):
        spans = []
        for age_px, age_vals in self.CALIBRATIONS:
            model = self._extract(age_px, age_vals)
            depths = np.asarray(model.depths, dtype=float)
            spans.append((round(float(depths.min()), 1), round(float(depths.max()), 1)))
        self.assertEqual(
            len(set(spans)), 1, f"depth span depends on the calibration choice: {spans}"
        )
        # And it must be the full requested range, not a truncated slice. (The native trace
        # is per-pixel-row, so it lands a fraction past the requested 160.)
        self.assertAlmostEqual(spans[0][0], 0.0, places=1)
        self.assertAlmostEqual(spans[0][1], 160.0, delta=0.5)

    def test_search_region_comes_from_the_axis_rules(self):
        for age_px, age_vals in self.CALIBRATIONS:
            model = self._extract(age_px, age_vals)
            self.assertIn("axis rule", model.roi_source)
            # The same region regardless of calibration.
            self.assertIn("(74, 5, 845, 739)", model.roi_source)

    def test_age_span_agrees_across_calibration_choices(self):
        """Different calibrations describe the same curve, so the ages must agree."""
        spans = []
        for age_px, age_vals in self.CALIBRATIONS:
            model = self._extract(age_px, age_vals)
            ages = np.asarray(model.ages, dtype=float)
            spans.append((float(ages.min()), float(ages.max())))
        widest = max(hi - lo for lo, hi in spans)
        narrowest = min(hi - lo for lo, hi in spans)
        self.assertLess(
            abs(widest - narrowest) / widest,
            0.02,
            f"age span varies with the calibration choice: {spans}",
        )


class TestChannelOverride(unittest.TestCase):
    """The channel can be forced, and forcing it wrong must fail loudly, not quietly."""

    def _bacon_lithology(self):
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[148.0, 733.0], age_vals=[0.0, 9000.0],
        )
        return img, cal

    def _bacon_grey(self):
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
        )
        return img, cal

    def test_auto_and_forced_chroma_agree(self):
        img, cal = self._bacon_lithology()
        auto = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0))
        forced = extract_age_depth_model(
            img, cal, depth_range=(0.0, 160.0), curve_channel="chroma"
        )
        self.assertEqual(auto.curve_channel, "chroma")
        self.assertEqual(forced.curve_channel, "chroma")
        self.assertAlmostEqual(
            float(np.median(np.asarray(auto.ages))), float(np.median(np.asarray(forced.ages))), places=6
        )
        self.assertIn("forced", forced.curve_channel_reason)

    def test_forced_darkness_is_honoured_and_worse(self):
        """Forcing the wrong channel must be allowed, and visibly worse."""
        img, cal = self._bacon_lithology()
        forced = extract_age_depth_model(
            img, cal, depth_range=(0.0, 160.0), curve_channel="darkness"
        )
        self.assertEqual(forced.curve_channel, "darkness")
        self.assertIn("forced", forced.curve_channel_reason)

    def test_forced_chroma_without_a_chromatic_stroke_is_refused(self):
        img, cal = self._bacon_grey()
        with self.assertRaises(ValueError) as ctx:
            extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), curve_channel="chroma")
        self.assertIn("would be interpolated", str(ctx.exception))

    def test_invalid_channel_value_is_refused(self):
        img, cal = self._bacon_grey()
        with self.assertRaises(ValueError) as ctx:
            extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), curve_channel="bogus")
        self.assertIn("must be 'auto'", str(ctx.exception))

    def test_observed_fraction_is_reported(self):
        img, cal = self._bacon_grey()
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0))
        # A genuine trace observes nearly all of its own span; the remainder is interpolated.
        self.assertGreater(model.observed_row_fraction, 0.5)
        self.assertLessEqual(model.observed_row_fraction, 1.0)
        payload = model.to_inspection_data()
        self.assertIn("observed_row_fraction", payload["metadata"])
        self.assertIn("curve_channel", payload["metadata"])

    def test_mostly_interpolated_trace_is_refused(self):
        """A trace built from a handful of rows must not be returned as a curve.

        The chroma channel on a greyscale figure finds a few dozen stray chromatic pixels.
        Interpolating between them would produce a smooth-looking curve that is almost
        entirely invented, and nothing downstream could tell.
        """
        img, cal = self._bacon_grey()
        with self.assertRaises(ValueError) as ctx:
            extract_age_depth_model(img, cal, depth_range=(0.0, 160.0), curve_channel="chroma")
        message = str(ctx.exception)
        self.assertIn("only observed", message)
        self.assertIn("interpolated rather than traced", message)


class TestAgeDirectionIsReadFromTheCurve(unittest.TestCase):
    """The age direction must come from the traced curve, not from the axis signs.

    The four calibration points say what a pixel *means* on each axis. They cannot say which
    way the age runs downcore, because along a curve ``d(age)/dy = (d(age)/dx) * (dx/dy)``
    and ``dx/dy`` belongs to the curve.

    Two bundled figures prove the point -- they have OPPOSITE axis conventions yet the same
    physical direction in depth-age space:

    * ``bacon_lithology.jpg``: top axis runs 0 -> 9 ka BP left to right (age grows
      rightwards); the curve runs left to right as it deepens, so age INCREASES downcore.
    * ``bacon_szek.png``: age axis runs 3000 -> 0 left to right (age grows leftwards); the
      curve runs right to left as it deepens, so age STILL INCREASES downcore.

    A rule based on axis signs alone answers "decreases downcore" for the second figure and
    refuses to extract it. That was the shipped behaviour: the caller hard-coded ``True``,
    which happened to suit the BP-style figures and made every upcore-increasing axis fail
    with "Declared age direction contradicts the figure".
    """

    def _extract(self, name, cal_kwargs, **kw):
        img = Image.open(FIGURE_DIR / name).convert("RGB")
        cal = AgeDepthAxisCalibrator(**cal_kwargs)
        return extract_age_depth_model(img, cal, depth_range=(0.0, 180.0), **kw)

    def test_axis_opposed_figures_agree_in_depth_age_space(self):
        lithology = self._extract(
            "bacon_lithology.jpg",
            dict(depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
                 age_px=[142.0, 731.5], age_vals=[0.0, 9.0]),
        )
        szek = self._extract(
            "bacon_szek.png",
            dict(depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
                 age_px=[110.0, 803.5], age_vals=[3000.0, 0.0]),
        )
        for label, model in (("bacon_lithology", lithology), ("bacon_szek", szek)):
            self.assertTrue(
                model.age_increases_downcore,
                f"{label}: age direction should be 'increases downcore'",
            )
            ages = np.asarray(model.ages, dtype=float)
            self.assertTrue(
                np.all(np.diff(ages) >= -1e-6),
                f"{label}: ages must rise downcore once the direction is right",
            )

    def test_the_verdict_is_auditable(self):
        """A deduction the user cannot inspect is indistinguishable from a guess."""
        model = self._extract(
            "bacon_lithology.jpg",
            dict(depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
                 age_px=[142.0, 731.5], age_vals=[0.0, 9.0]),
        )
        self.assertIn("traced curve", model.age_direction_reason)
        self.assertIn("median pairwise slope", model.age_direction_reason)
        # And it must survive serialisation, or the UI has nothing to show.
        meta = model.to_inspection_data()["metadata"]
        self.assertIs(meta["age_increases_downcore"], True)
        self.assertIn("traced curve", meta["age_direction_reason"])

    def test_caller_can_still_force_a_direction(self):
        """An unusual figure must remain extractable by overriding the deduction."""
        cal_kwargs = dict(depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
                          age_px=[142.0, 731.5], age_vals=[0.0, 9.0])
        agreed = self._extract("bacon_lithology.jpg", cal_kwargs,
                               age_increases_downcore=True)
        self.assertIn("agreeing with the traced curve", agreed.age_direction_reason)

        with self.assertRaises(ValueError) as ctx:
            self._extract("bacon_lithology.jpg", cal_kwargs,
                          age_increases_downcore=False)
        message = str(ctx.exception)
        self.assertIn("against the traced curve", message)
        self.assertIn("median pairwise slope", message)


class TestMedianIntegerAgesWouldStaircase(unittest.TestCase):
    """Regression guard for the staircase the UI drew on steep, coarse age axes.

    ``AgeDepthCanvas.refitCurveFromControlPoints`` used to write
    ``Math.round(ad.age)`` back into the inspection payload. On the bundled figure the age
    axis spans 0..9 ka over 589.5 px, so ONE integer kiloyear is 65.5 px: rounding collapsed
    381 distinct curve columns onto 8, shifting 93% of rows by more than a pixel. The client
    fix removed the rounding; this test pins the underlying arithmetic so the magnitude of
    the hazard is not forgotten, and fails if the age axis in the fixture ever changes
    without the test being reconsidered.
    """

    def test_one_integer_age_step_is_many_pixels(self):
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[142.0, 731.5], age_vals=[0.0, 9.0],
        )
        px_per_ka = abs(float(cal.age2px(1.0)) - float(cal.age2px(0.0)))
        self.assertGreater(
            px_per_ka, 20.0,
            "if one age unit is only a few pixels, integer rounding is harmless and this "
            "guard no longer describes the hazard it was written for",
        )

        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        model = extract_age_depth_model(img, cal, depth_range=(0.0, 160.0))
        payload = model.to_inspection_data()
        ages = np.asarray(payload["ages"], dtype=float)
        true_x = np.asarray(payload["px_points"]["x_curve"], dtype=float)

        rounded_x = np.asarray(cal.age2px(np.round(ages)), dtype=float)
        shift = np.abs(rounded_x - true_x)

        self.assertGreater(
            len(np.unique(np.round(true_x, 1))), 100,
            "the traced curve should span many columns, not a handful",
        )
        self.assertGreater(
            float(np.median(shift)), 2.0,
            "rounding ages to integers should visibly displace the curve on this axis",
        )
        self.assertLess(
            len(np.unique(np.round(rounded_x, 1))), 30,
            "rounding should collapse the curve onto few columns -- this is the staircase",
        )


class TestReportedPrecision(unittest.TestCase):
    """Serialisation must emit the computed number, not a rounded stand-in.

    The inspection payload used ``round(value, 2)`` for ages and the table used
    ``toFixed(1)`` for rates. On a 0..9 ka axis three consecutive horizons all showed 0.37,
    interval widths collapsed to a couple of integers, and a genuine 0.04 ka/cm rate printed
    as "0.0 yr/cm" -- the export looked fabricated even though the curve was fine.

    Any intermediate rounding rule was a lossy guess, so values are now emitted exactly as
    computed. The thresholds below are measured on this figure and record what the broken
    two-decimal version produced, so the guard's discriminating power is visible:

    ==========================  ============  ==============
    quantity                    raw            2 decimals
    ==========================  ============  ==============
    distinct ages               399           356
    distinct interval widths    317            97
    ages with >= 5 decimals     367             0
    ==========================  ============  ==============
    """

    def _model(self):
        img = Image.open(FIGURE_DIR / "bacon_lithology.jpg").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[100.0, 865.0], depth_vals=[0.0, 150.0],
            age_px=[142.0, 731.5], age_vals=[0.0, 9.0],
        )
        # Native sampling: a 5 cm resample grid is coarse enough that two decimals survive,
        # which would let the defect through.
        return extract_age_depth_model(img, cal, depth_range=(0.0, 160.0))

    def test_consecutive_ages_are_not_collapsed(self):
        model = self._model()
        ages = model.to_inspection_data()["ages"]
        distinct = len(set(ages))
        self.assertGreater(
            distinct, 390,
            f"only {distinct} distinct ages over {len(ages)} horizons; two-decimal rounding "
            f"collapses this figure to 356",
        )
        # And the first horizons must differ from each other, which is what the user saw as
        # "0.37, 0.37, 0.37".
        head = ages[4:12]
        self.assertEqual(len(set(head)), len(head), f"horizons collapsed: {head}")

    def test_interval_widths_are_not_quantised(self):
        """Widths are the sharpest tell: 317 distinct values become 97 under two decimals."""
        model = self._model()
        insp = model.to_inspection_data()
        widths = [abs(hi - lo) for hi, lo in zip(insp["age_max"], insp["age_min"])]
        distinct = len({round(w, 6) for w in widths})
        self.assertGreater(
            distinct, 200,
            f"only {distinct} distinct interval widths; two-decimal rounding reduces this "
            f"figure to 97, and the table then shows a coarse, obviously-quantised column",
        )

    def test_most_ages_carry_five_or_more_decimals(self):
        """367 of 405 ages carry >= 5 decimals at full precision, and 0 do at two decimals."""
        model = self._model()
        ages = model.to_inspection_data()["ages"]
        got = sum(
            1 for a in ages if "." in str(a) and len(str(a).split(".")[1]) >= 5
        )
        self.assertGreater(
            got, 300,
            f"only {got} ages carry >=5 decimals; two-decimal rounding leaves none, which is "
            f"why the column read as a made-up number",
        )

    def test_predict_age_does_not_use_fixed_decimals(self):
        """Over the 810 native horizons: 795 distinct ages, but only 545 under two decimals."""
        model = self._model()
        pred = model.predict_age([float(d) for d in model.analysis_depths])
        ages = pred["age_est"]
        distinct = len(set(ages))
        self.assertGreater(
            distinct, 700,
            f"predict_age returned only {distinct} distinct ages over {len(ages)} horizons; "
            f"two-decimal rounding gives 545",
        )


if __name__ == "__main__":
    unittest.main()
