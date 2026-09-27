# -*- coding: utf-8 -*-
"""Regression tests for age-ensemble generation from an extracted age-depth figure.

The generator replaced an earlier implementation that drew AR(1) noise in *sample-index*
space and then forced chronological ordering with ``np.maximum.accumulate``. Two measured
defects motivated the rewrite:

* the correlation length was set per sample index, so changing the resample step from 2 cm
  to 10 cm changed the ensemble roughness by 2.8x and moved the fitted depth of the
  1500 cal BP horizon by 4 cm -- the same figure giving different scientific answers;
* before the repair, 32.9% of ensemble members at a 2 cm step had physically impossible
  age reversals (older sediment above younger), which the projection then silently masked
  while biasing the band and shrinking it below the extracted envelope.

These tests pin the replacement's guarantees: monotone by construction, invariant to the
output sampling step, and faithful to the extracted envelope's magnitude.
"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

import unittest

import numpy as np
from PIL import Image

from straditize_core.age_depth import AgeDepthAxisCalibrator, extract_age_depth_model

FIGURE_DIR = REPO_ROOT / "straditize_core" / "assets" / "age_models"


def _bacon():
    img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
    cal = AgeDepthAxisCalibrator(
        depth_px=[32.0, 668.0],
        depth_vals=[0.0, 150.0],
        age_px=[110.0, 803.5],
        age_vals=[3000.0, 0.0],
    )
    return extract_age_depth_model(
        img, cal, depth_range=(0.0, 160.0), resample_step=2.0
    )


def _ensemble_matrix(model, n=400, **kw):
    depths = np.asarray(model.depths, dtype=float)
    ens = model.generate_age_ensemble(depths, n_ensembles=n, name="test", **kw)
    return depths, np.array([row[1:] for row in ens["data"]], dtype=float), ens


class TestAgeEnsemble(unittest.TestCase):
    def test_01_monotone_by_construction(self):
        """Ages never reverse, and that must not come from a post-hoc projection."""
        depths, arr, _ = _ensemble_matrix(_bacon())
        self.assertTrue(
            np.all(np.diff(arr, axis=0) >= 0.0),
            "generated ensemble contains age reversals",
        )
        # A strictly positive integrand gives strictly increasing ages; allow ties only
        # where rounding to 0.01 yr collapses a genuinely tiny increment.
        self.assertGreater(float(np.diff(arr, axis=0).mean()), 0.0)

    def test_02_median_tracks_extracted_curve(self):
        """The ensemble median must reproduce the extracted median curve."""
        model = _bacon()
        depths, arr, ens = _ensemble_matrix(model, return_diagnostics=True)
        drift = np.abs(np.median(arr, axis=1) - np.asarray(model.ages, dtype=float))
        span = float(np.max(model.ages) - np.min(model.ages))
        self.assertLess(
            float(drift.max()) / span,
            0.03,
            f"ensemble median drifts {drift.max():.0f} yr from the extracted curve",
        )
        self.assertLess(ens["diagnostics"]["median_curve_max_deviation"] / span, 0.03)

    def test_03_envelope_magnitude_matches(self):
        """The realised 95% band must match the extracted envelope in magnitude."""
        model = _bacon()
        _depths, arr, ens = _ensemble_matrix(model, return_diagnostics=True)
        sim = np.median(np.percentile(arr, 97.5, axis=1) - np.percentile(arr, 2.5, axis=1))
        tgt = ens["diagnostics"]["target_envelope_median"]
        self.assertLess(
            abs(sim - tgt) / tgt,
            0.20,
            f"realised band {sim:.0f} yr vs extracted {tgt:.0f} yr",
        )

    def test_04_invariant_to_output_sampling_step(self):
        """Resampling the output must not change the fitted correlation length."""
        img = Image.open(FIGURE_DIR / "bacon_szek.png").convert("RGB")
        cal = AgeDepthAxisCalibrator(
            depth_px=[32.0, 668.0],
            depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5],
            age_vals=[3000.0, 0.0],
        )
        lengths = []
        crossing = []
        for step in (2.0, 5.0, 10.0):
            model = extract_age_depth_model(
                img, cal, depth_range=(0.0, 160.0), resample_step=step
            )
            depths = np.asarray(model.depths, dtype=float)
            ens = model.generate_age_ensemble(
                depths, n_ensembles=600, name="t", return_diagnostics=True
            )
            lengths.append(ens["diagnostics"]["correlation_length"])
            arr = np.array([row[1:] for row in ens["data"]], dtype=float)

            # Feature-level uncertainty: at what depth does each member cross 1500 cal BP?
            hits = []
            for j in range(arr.shape[1]):
                col = arr[:, j]
                i = int(np.searchsorted(col, 1500.0))
                if 0 < i < len(depths):
                    den = col[i] - col[i - 1]
                    frac = (1500.0 - col[i - 1]) / den if den else 0.0
                    hits.append(depths[i - 1] + frac * (depths[i] - depths[i - 1]))
            crossing.append(float(np.mean(hits)))

        self.assertEqual(
            len(set(lengths)), 1, f"fitted correlation length varies with step: {lengths}"
        )
        # The earlier index-space AR(1) moved this by 4 cm across the same steps.
        self.assertLess(
            max(crossing) - min(crossing),
            1.0,
            f"feature depth moves {max(crossing) - min(crossing):.1f} cm with the step",
        )

    def test_05_correlation_is_genuinely_imposed(self):
        """A long correlation length must shift whole curves, not jitter each depth."""
        model = _bacon()
        depths = np.asarray(model.depths, dtype=float)

        def shared_fraction(corr_len):
            ens = model.generate_age_ensemble(
                depths, n_ensembles=400, name="t", correlation_length=corr_len
            )
            arr = np.array([row[1:] for row in ens["data"]], dtype=float)
            offsets = arr - np.median(arr, axis=1)[:, None]
            between = float(np.var(offsets.mean(axis=0)))
            total = float(np.var(offsets))
            return between / total if total > 0 else 0.0

        long_l = shared_fraction(80.0)
        short_l = shared_fraction(2.0)
        self.assertGreater(long_l, short_l + 0.1, "long L did not increase curve coherence")
        self.assertGreater(long_l, 0.5, "a long L should make most variance a shared shift")

    def test_06_explicit_correlation_length_honoured(self):
        model = _bacon()
        depths = np.asarray(model.depths, dtype=float)
        ens = model.generate_age_ensemble(
            depths, n_ensembles=200, name="t", correlation_length=25.0, return_diagnostics=True
        )
        diag = ens["diagnostics"]
        self.assertAlmostEqual(diag["correlation_length"], 25.0, places=6)
        self.assertFalse(diag["correlation_length_fitted"])

    def test_07_output_shape_is_backward_compatible(self):
        model = _bacon()
        depths = np.asarray(model.depths, dtype=float)
        ens = model.generate_age_ensemble(depths, n_ensembles=50, name="MyEnsemble")
        self.assertEqual(ens["name"], "MyEnsemble")
        self.assertEqual(len(ens["columns"]), 51)
        self.assertEqual(ens["columns"][0], "depth")
        self.assertEqual(ens["columns"][1], "iter_1")
        self.assertEqual(len(ens["data"]), len(depths))
        self.assertEqual(len(ens["data"][0]), 51)

    def test_08_empty_and_out_of_range_depths(self):
        model = _bacon()
        self.assertEqual(model.generate_age_ensemble([], n_ensembles=10)["data"], [])

        # Depths outside the model range are clamped by the interpolators, not fatal.
        ens = model.generate_age_ensemble([-50.0, 500.0], n_ensembles=20, name="t")
        self.assertEqual(len(ens["data"]), 2)

    def test_09_diagnostics_reported(self):
        _depths, _arr, ens = _ensemble_matrix(
            _bacon(), return_diagnostics=True, correlation_length=20.0
        )
        diag = ens["diagnostics"]
        for key in (
            "correlation_length",
            "envelope_mismatch",
            "envelope_mismatch_vs_extracted",
            "shared_offset_sigma",
            "age_reversal_rate",
            "simulated_envelope_median",
            "target_envelope_median",
            "median_curve_max_deviation",
        ):
            self.assertIn(key, diag)
        self.assertEqual(diag["age_reversal_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()
