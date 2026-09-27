# -*- coding: utf-8 -*-
"""Quantitative regression tests for age-depth diagram extraction.

The legacy extractor relied on a global largest-connected-component mask plus a
"darkest pixel per row" median estimator. That approach silently degrades on the two
rendering styles that dominate the literature:

* a filled grey MCMC cloud (Bacon), whose darker outline defeats the median estimator;
* an ensemble drawn as many thin disconnected lines (Bchron), where the largest
  connected component is an arbitrary single realisation.

These tests render synthetic diagrams from a known ground-truth curve and assert the
recovered ages stay within tolerance, so a regression in the extractor fails loudly
instead of quietly returning plausible-looking noise.
"""

import unittest

import numpy as np
from PIL import Image, ImageDraw

from straditize_core.age_depth import AgeDepthAxisCalibrator, extract_age_depth_model

# Synthetic figure geometry (0-indexed pixel space)
FRAME_X0, FRAME_Y0 = 110, 60
FRAME_X1, FRAME_Y1 = 800, 1000
AGE_AT_X0, AGE_AT_X1 = 7000.0, 0.0
DEPTH_AT_Y0, DEPTH_AT_Y1 = 0.0, 500.0


def _truth_age(depth: np.ndarray) -> np.ndarray:
    """Monotonic ground-truth age(depth) in cal BP."""
    d = np.asarray(depth, dtype=float)
    return 9.0 * d + 150.0 * np.log1p(d / 30.0)


def _truth_sigma(depth: np.ndarray) -> np.ndarray:
    """Age uncertainty that grows downcore."""
    return 40.0 + 0.12 * _truth_age(depth)


def _depth_to_y(depth: np.ndarray) -> np.ndarray:
    return FRAME_Y0 + (np.asarray(depth) - DEPTH_AT_Y0) / (DEPTH_AT_Y1 - DEPTH_AT_Y0) * (
        FRAME_Y1 - FRAME_Y0
    )


def _age_to_x(age: np.ndarray) -> np.ndarray:
    return FRAME_X0 + (AGE_AT_X0 - np.asarray(age)) / (AGE_AT_X0 - AGE_AT_X1) * (
        FRAME_X1 - FRAME_X0
    )


def _make_calibrator() -> AgeDepthAxisCalibrator:
    return AgeDepthAxisCalibrator(
        depth_px=[FRAME_Y0, FRAME_Y1],
        depth_vals=[DEPTH_AT_Y0, DEPTH_AT_Y1],
        age_px=[FRAME_X0, FRAME_X1],
        age_vals=[AGE_AT_X0, AGE_AT_X1],
        depth_unit="cm",
        age_unit="cal BP",
    )


def _render_cloud_diagram(
    *, grid_lines: bool = False, inline_label: bool = False, dashed_outline: bool = False
) -> Image.Image:
    """Renders a Bacon-style filled grey confidence cloud with a dark median line."""
    img = Image.new("RGB", (900, 1100), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    depths = np.linspace(DEPTH_AT_Y0, DEPTH_AT_Y1, 400)
    ages = _truth_age(depths)
    sigma = _truth_sigma(depths)
    ys = _depth_to_y(depths)

    if dashed_outline:
        # Real Bacon / Bchron renderings outline the envelope with a *lighter*, dashed
        # grey rule while the median line stays the darkest stroke. The dashes leave
        # white gaps, so a per-row scan must bridge them vertically.
        left_pts = [(float(_age_to_x(ages + 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys))]
        right_pts = [(float(_age_to_x(ages - 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys))]
        for i in range(0, len(ys) - 1, 4):
            for pts in (left_pts, right_pts):
                end = min(i + 2, len(ys) - 1)
                draw.line([pts[i], pts[end]], fill=(140, 140, 140), width=2)
    else:
        polygon = [
            (float(_age_to_x(ages - 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys))
        ] + [
            (float(_age_to_x(ages + 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys) - 1, -1, -1)
        ]
        draw.polygon(polygon, fill=(205, 205, 205))
        draw.line(
            [(float(_age_to_x(ages + 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys))],
            fill=(150, 150, 150),
            width=3,
        )
        draw.line(
            [(float(_age_to_x(ages - 1.96 * sigma)[i]), float(ys[i])) for i in range(len(ys))],
            fill=(150, 150, 150),
            width=3,
        )

    # Dark median line (the feature that must be recovered)
    median_pts = [(float(_age_to_x(ages)[i]), float(ys[i])) for i in range(len(ys))]
    draw.line(median_pts, fill=(60, 60, 60), width=4)

    if grid_lines:
        for frac in (0.25, 0.5, 0.75):
            y = int(FRAME_Y0 + frac * (FRAME_Y1 - FRAME_Y0))
            draw.line([(FRAME_X0, y), (FRAME_X1, y)], fill=(150, 150, 150), width=2)

    if inline_label:
        draw.text((FRAME_X0 + 40, FRAME_Y0 + 470), "Bacon 3.2.0 median", fill=(20, 20, 20))

    # Plot frame drawn last so it is a solid rule on top of everything
    draw.rectangle([FRAME_X0, FRAME_Y0, FRAME_X1, FRAME_Y1], outline=(0, 0, 0), width=3)

    # Axis tick labels outside the frame (must not leak into the extraction)
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        y = int(FRAME_Y0 + frac * (FRAME_Y1 - FRAME_Y0))
        draw.text((20, y - 6), f"{int(frac * DEPTH_AT_Y1)}", fill=(0, 0, 0))
        x = int(FRAME_X0 + frac * (FRAME_X1 - FRAME_X0))
        draw.text((x - 12, FRAME_Y1 + 20), f"{int(AGE_AT_X0 * (1 - frac))}", fill=(0, 0, 0))
    draw.text((320, FRAME_Y1 + 50), "Age (cal BP)", fill=(0, 0, 0))
    draw.text((20, 20), "Depth (cm)", fill=(0, 0, 0))
    return img


class TestAgeDepthExtractionQuality(unittest.TestCase):
    def setUp(self):
        self.calibrator = _make_calibrator()

    def _assert_close_to_truth(
        self, model, tolerance_frac: float = 0.015, p95_frac: float = 0.03
    ) -> None:
        """Assert the extracted curve tracks ground truth within a relative tolerance."""
        depths = np.asarray(model.depths, dtype=float)
        ages = np.asarray(model.ages, dtype=float)
        truth = _truth_age(depths)

        # Compare only where the truth is well above zero ref age (top of core is ~0).
        mask = truth > 300
        self.assertGreater(mask.sum(), 20, "too few comparable horizons extracted")

        rel_err = np.abs(ages[mask] - truth[mask]) / truth[mask]
        median_err = float(np.median(rel_err))
        p95_err = float(np.percentile(rel_err, 95))
        self.assertLess(
            median_err,
            tolerance_frac,
            f"median relative age error {median_err:.3%} exceeds {tolerance_frac:.1%}",
        )
        self.assertLess(
            p95_err,
            p95_frac,
            f"p95 relative age error {p95_err:.3%} exceeds {p95_frac:.1%}",
        )

        # Envelope must bracket the true curve on the overwhelming majority of horizons.
        lo = np.asarray(model.age_min, dtype=float)
        hi = np.asarray(model.age_max, dtype=float)
        inside = (truth[mask] >= lo[mask] * 0.9) & (truth[mask] <= hi[mask] * 1.1)
        self.assertGreater(float(inside.mean()), 0.95, "envelope fails to bracket ground truth")

    def test_01_filled_cloud_extraction(self):
        """Bacon-style filled cloud: median line recovered within tolerance."""
        model = extract_age_depth_model(_render_cloud_diagram(), self.calibrator)
        self._assert_close_to_truth(model)

    def test_02_grid_lines_and_inline_label(self):
        """Horizontal grid lines and an inline text label must not derail extraction."""
        img = _render_cloud_diagram(grid_lines=True, inline_label=True)
        model = extract_age_depth_model(img, self.calibrator)
        self._assert_close_to_truth(model)

    def test_03_dashed_outline_envelope(self):
        """White interior with a lighter dashed outline; dashes must be bridged vertically."""
        img = _render_cloud_diagram(dashed_outline=True)
        model = extract_age_depth_model(img, self.calibrator)
        self._assert_close_to_truth(model)

    def test_04_monotonicity_enforced(self):
        """Extracted ages must never decrease downcore."""
        model = extract_age_depth_model(_render_cloud_diagram(), self.calibrator)
        order = np.argsort(np.asarray(model.depths, dtype=float))
        ages = np.asarray(model.ages, dtype=float)[order]
        self.assertTrue(np.all(np.diff(ages) >= -1e-6), "extracted ages are not monotonic")

    def test_05_depth_range_clipping(self):
        """depth_range clips the extracted section independently of the calibration."""
        full = extract_age_depth_model(_render_cloud_diagram(), self.calibrator)
        clipped = extract_age_depth_model(
            _render_cloud_diagram(), self.calibrator, depth_range=(100.0, 300.0)
        )

        self.assertGreater(len(full.depths), len(clipped.depths))
        self.assertGreaterEqual(float(np.min(clipped.depths)), 98.0)
        self.assertLessEqual(float(np.max(clipped.depths)), 302.0)

    def test_06_resample_regular_grid(self):
        """resample_step yields an evenly spaced depth grid."""
        model = extract_age_depth_model(
            _render_cloud_diagram(),
            self.calibrator,
            depth_range=(0.0, 500.0),
            resample_step=5.0,
        )
        depths = np.asarray(model.depths, dtype=float)
        diffs = np.diff(depths)
        self.assertGreater(len(depths), 50)
        self.assertAlmostEqual(float(diffs.mean()), 5.0, places=4)
        self.assertLess(float(diffs.std()), 1e-6)
        self._assert_close_to_truth(model)

    def test_07_exclude_mask_erases_interference(self):
        """An exclude mask suppresses an interfering region (eraser-brush semantics)."""
        img = _render_cloud_diagram(inline_label=True)
        baseline = extract_age_depth_model(img, self.calibrator)

        mask = np.zeros((img.height, img.width), dtype=bool)
        mask[FRAME_Y0 + 440 : FRAME_Y0 + 500, FRAME_X0 + 10 : FRAME_X0 + 320] = True
        erased = extract_age_depth_model(img, self.calibrator, exclude_mask=mask)

        # The eraser must not damage the recovered curve.
        order_b = np.argsort(np.asarray(baseline.depths, dtype=float))
        order_e = np.argsort(np.asarray(erased.depths, dtype=float))
        self.assertTrue(
            np.all(np.diff(np.asarray(baseline.ages, dtype=float)[order_b]) >= -1e-6)
        )
        self.assertTrue(np.all(np.diff(np.asarray(erased.ages, dtype=float)[order_e]) >= -1e-6))
        self._assert_close_to_truth(erased)

    def test_08_log_calibration_axis(self):
        """A logarithmic x-axis round-trips through the calibrator."""
        cal = AgeDepthAxisCalibrator(
            depth_px=[0.0, 500.0],
            depth_vals=[0.0, 500.0],
            age_px=[0.0, 300.0],
            age_vals=[100.0, 100000.0],
            age_log=True,
        )
        self.assertTrue(cal.age_log)
        mid_px = 150.0
        mid_age = cal.px2age(mid_px)
        # Geometric mid-point of a log axis
        self.assertAlmostEqual(float(mid_age), np.sqrt(100.0 * 100000.0), places=4)
        self.assertAlmostEqual(float(cal.age2px(mid_age)), mid_px, places=6)

    def test_09_inspection_arrays_are_aligned(self):
        """to_inspection_data must decimate every parallel array with the same stride."""
        model = extract_age_depth_model(_render_cloud_diagram(), self.calibrator)
        payload = model.to_inspection_data()
        px = payload["px_points"]

        self.assertEqual(payload["decimation_step"], max(1, len(model.px_y) // 400))
        n = len(px["y"])
        self.assertGreater(n, 0)
        # A single index must address all parallel arrays consistently.
        for key in ("depths", "ages", "age_min", "age_max"):
            self.assertEqual(len(payload[key]), n, f"{key} length differs from px_points.y")
        for key in ("x_curve", "x_min", "x_max"):
            self.assertEqual(len(px[key]), n, f"px_points.{key} length differs from px_points.y")

    def test_09b_resampled_arrays_are_aligned(self):
        """Resampling must keep the pixel tracks the same length as the depth grid."""
        model = extract_age_depth_model(
            _render_cloud_diagram(),
            self.calibrator,
            depth_range=(0.0, 500.0),
            resample_step=5.0,
        )
        payload = model.to_inspection_data()
        px = payload["px_points"]

        self.assertEqual(len(model.px_y), len(model.depths))
        self.assertEqual(len(model.px_x_curve), len(model.depths))
        self.assertEqual(len(px["y"]), len(payload["depths"]))

        # The resampled pixel rows must correspond to the resampled depths.
        depths = np.asarray(payload["depths"], dtype=float)
        rows = np.asarray(px["y"], dtype=float)
        recovered = np.asarray(self.calibrator.px2depth(rows), dtype=float)
        self.assertTrue(
            np.allclose(recovered, depths, atol=0.2),
            "resampled pixel rows no longer map back to their depth grid",
        )

    def test_10_degenerate_input_raises(self):
        """A depth range outside the drawn curve fails loudly rather than returning noise."""
        blank = Image.new("RGB", (900, 1100), (255, 255, 255))
        with self.assertRaises(ValueError):
            extract_age_depth_model(blank, self.calibrator)


if __name__ == "__main__":
    unittest.main()
