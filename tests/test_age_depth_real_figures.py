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


if __name__ == "__main__":
    unittest.main()
