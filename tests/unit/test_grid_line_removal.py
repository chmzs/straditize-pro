"""Regression tests for grid/axis line removal and the ROI <-> calibration split.

Two defects motivated this file:

1. The removal rule was "a row with a long horizontal ink run is a grid line",
   so it deleted every pixel of that row. On a filled pollen diagram the widest
   taxon is one long run per row, which meant the *Pinus* column of the built-in
   Hoya figure lost 99% of its silhouette. Measured on that figure, 95% of the
   pixels the old rule flagged at the "weak" preset were >= 4 px thick -- real
   data, not lines.
2. The ROI and the depth axis shared one struct, so the digitising box *was* the
   timescale: dragging the box rewrote the calibration, and `imageYToDepth` fell
   back to `dataYMin` when nothing had been calibrated.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from straditize_core.image import (
    GRID_LINE_PRESETS,
    detect_grid_lines,
    mask_overlay_data_url,
    rasterize_strokes,
    remove_grid_lines,
    remove_horizontal_grid_lines,
    stroke_thickness,
)
from straditize_core.session import StraditizeSession

REPO_ROOT = Path(__file__).resolve().parents[2]
HOYA = REPO_ROOT / "straditize" / "straditize" / "widgets" / "tutorial" / "hoya-del-castillo" / "hoya-del-castillo.png"
#: The figure's own data region (the tutorial's canonical box).
HOYA_ROI = (315, 511, 1946, 1311)


def _synthetic_diagram() -> np.ndarray:
    """A thin true grid line, a thin true vertical, a filled bell and a polyline."""
    height, width = 300, 600
    ink = np.zeros((height, width), dtype=bool)
    ink[150, 40:560] = True  # genuine horizontal grid line
    ink[40:260, 300] = True  # genuine vertical line
    for y in range(50, 250):  # filled bell silhouette the line passes through
        t = (y - 50) / 199
        half = int(60 * np.sin(np.pi * t) ** 0.8) + 1
        ink[y, 120 - half:120 + half] = True
    xs = np.arange(380, 560)  # thin polyline proxy
    ink[np.round(120 + 40 * np.sin(xs / 25)).astype(int), xs] = True
    return ink


def _stroke_thickness_of(mask: np.ndarray) -> np.ndarray:
    return stroke_thickness(np.asarray(mask, dtype=bool), axis=0)


class TestThinnessBound(unittest.TestCase):
    """The perpendicular-thickness bound is what protects filled taxa."""

    def test_thickness_is_measured_per_stroke_not_per_row(self) -> None:
        ink = np.zeros((10, 10), dtype=bool)
        ink[2:8, 4] = True  # a 6 px tall stroke
        thickness = stroke_thickness(ink, axis=0)
        self.assertEqual(int(thickness[2:8, 4].max()), 6)
        self.assertEqual(int(thickness[0, 0]), 0)

    def test_filled_bell_survives_a_line_running_through_it(self) -> None:
        ink = _synthetic_diagram()
        horizontal, vertical, info = detect_grid_lines(ink, strength="medium", roi=(0, 0, 600, 300))

        # The genuine lines are found...
        self.assertEqual(info["horizontal_rows"], [150])
        self.assertEqual(info["vertical_cols"], [300])

        # ...and the filled bell is left alone. The old implementation deleted the
        # whole row, so every one of these pixels disappeared.
        bell = np.zeros_like(ink)
        bell[50:250, 59:182] = True
        wrongly_removed = int((horizontal | vertical)[bell].sum())
        self.assertLessEqual(
            wrongly_removed,
            5,
            f"filled silhouette lost {wrongly_removed} px to line removal",
        )

    def test_thin_polyline_is_not_eaten(self) -> None:
        ink = _synthetic_diagram()
        horizontal, vertical, _ = detect_grid_lines(ink, strength="medium", roi=(0, 0, 600, 300))
        polyline = np.zeros_like(ink)
        polyline[np.ix_(range(70, 181), range(375, 565))] = True
        polyline[150, :] = False  # the true grid line legitimately crosses here
        self.assertEqual(int((horizontal | vertical)[polyline].sum()), 0)

    def test_bell_apex_and_base_are_not_one_continuous_vertical_line(self) -> None:
        """A bell carries thin pixels at its apex and base in the same columns.

        Their bounding box spans the whole silhouette, so accepting a line by
        bounding span would classify the bell's centre columns as a vertical grid
        line. Acceptance is counted instead.
        """
        height, width = 300, 200
        ink = np.zeros((height, width), dtype=bool)
        for y in range(20, 280):
            t = (y - 20) / 259
            half = int(60 * np.sin(np.pi * t) ** 0.8) + 1
            ink[y, 100 - half:100 + half] = True
        _, vertical, _ = detect_grid_lines(ink, strength="medium", roi=(0, 0, width, height))
        self.assertEqual(int(vertical.sum()), 0)


class TestHoyaRegression(unittest.TestCase):
    """The built-in Hoya figure has no horizontal grid lines inside its ROI."""

    @classmethod
    def setUpClass(cls) -> None:
        if not HOYA.is_file():
            raise unittest.SkipTest(f"tutorial figure missing: {HOYA}")
        cls.ink = np.array(Image.open(HOYA).convert("L")) < 138

    def test_no_horizontal_grid_lines_are_invented(self) -> None:
        for strength in GRID_LINE_PRESETS:
            with self.subTest(strength=strength):
                horizontal, _, info = detect_grid_lines(
                    self.ink, strength=strength, roi=HOYA_ROI
                )
                self.assertEqual(info["horizontal_rows"], [])
                self.assertEqual(int(horizontal.sum()), 0)

    def test_removal_stays_a_small_fraction_of_the_roi(self) -> None:
        """The old rule destroyed 55-70% of the ROI ink on this figure."""
        x0, y0, x1, y1 = HOYA_ROI
        roi_ink = int(self.ink[y0:y1, x0:x1].sum())
        for strength in GRID_LINE_PRESETS:
            with self.subTest(strength=strength):
                _, _, info = detect_grid_lines(self.ink, strength=strength, roi=HOYA_ROI)
                ratio = info["horizontal_pixels"] + info["vertical_pixels"]
                self.assertLess(
                    ratio / roi_ink,
                    0.05,
                    f"{strength} removes {ratio} of {roi_ink} ROI ink pixels",
                )

    def test_wide_pinus_silhouette_is_preserved(self) -> None:
        """Pinus is the widest filled taxon; the old rule erased 99% of it."""
        x0, y0, x1, y1 = HOYA_ROI
        pinus = self.ink[y0:y1, 490:660]
        self.assertGreater(int(pinus.sum()), 50_000, "test region no longer covers Pinus")
        _, line_mask, _ = remove_grid_lines(
            self.ink, strength="weak", roi=HOYA_ROI, remove_vertical=False
        )
        lost = int(line_mask[y0:y1, 490:660].sum())
        self.assertLess(lost / int(pinus.sum()), 0.01, f"Pinus lost {lost} px")


class TestManualCorrection(unittest.TestCase):
    def test_strokes_erase_and_restore(self) -> None:
        shape = (60, 60)
        restore, erase = rasterize_strokes(
            shape,
            [
                {"mode": "erase", "radius": 5, "points": [[10, 10], [40, 10]]},
                {"mode": "restore", "radius": 4, "points": [[30, 40]]},
            ],
        )
        self.assertTrue(erase[10, 25], "erase stroke should cover the segment")
        self.assertTrue(restore[40, 30])
        self.assertFalse(erase[40, 30])

    def test_corrections_override_the_automatic_mask(self) -> None:
        ink = _synthetic_diagram()
        _, auto, _ = remove_grid_lines(ink, strength="medium", roi=(0, 0, 600, 300))
        restore, erase = rasterize_strokes(
            ink.shape,
            [
                {"mode": "erase", "radius": 6, "points": [[200, 150], [260, 150]]},
                {"mode": "restore", "radius": 6, "points": [[100, 275]]},
            ],
        )
        final = (auto | restore) & ~erase
        # Everything the brush covered is gone from the final mask, and the
        # restored pixel is present even though the detector never found it.
        self.assertGreater(int((auto & erase).sum()), 0)
        self.assertFalse(final[erase].any())
        self.assertTrue(final[275, 100])

    def test_strokes_outside_the_image_are_clipped_not_fatal(self) -> None:
        restore, erase = rasterize_strokes(
            (20, 20), [{"mode": "erase", "radius": 5, "points": [[-50, -50], [200, 200]]}]
        )
        self.assertEqual(restore.shape, (20, 20))
        self.assertEqual(erase.dtype, np.bool_)

    def test_malformed_strokes_are_ignored(self) -> None:
        restore, erase = rasterize_strokes(
            (10, 10),
            [
                None,
                "nonsense",
                {"mode": "erase"},
                {"mode": "erase", "points": [[1], ["x", "y"], [3, 3]]},
            ],
        )
        self.assertEqual(int(restore.sum()), 0)
        self.assertGreater(int(erase.sum()), 0)


class TestOverlayPayload(unittest.TestCase):
    def test_overlay_is_a_png_data_url_with_both_classes(self) -> None:
        ink = _synthetic_diagram()
        _, line_mask, _ = remove_grid_lines(ink, strength="medium", roi=(0, 0, 600, 300))
        url = mask_overlay_data_url(ink, line_mask)
        self.assertTrue(url.startswith("data:image/png;base64,"))
        self.assertGreater(len(url), 100)


class TestRoiCalibrationSeparation(unittest.TestCase):
    """The ROI is a digitising region; the depth axis is the user's two marks."""

    def setUp(self) -> None:
        self.session = StraditizeSession()
        self.session.load_image(sample_key="hoya")
        self.session.detect_columns([HOYA_ROI[0], HOYA_ROI[2]], [HOYA_ROI[1], HOYA_ROI[3]])

    def test_load_image_suggests_a_region_and_no_calibration(self) -> None:
        info = self.session.load_image(sample_key="hoya")
        self.assertIn("suggested_roi", info)
        self.assertNotIn("suggested_calibration", info)
        for key in ("top_px", "bottom_px", "top_cm", "bottom_cm"):
            self.assertNotIn(key, info["suggested_roi"])

    def test_roi_update_never_touches_the_depth_axis(self) -> None:
        self.session.calibrate_axes(
            y_marks=[{"pixel": 556, "val": 1500}, {"pixel": 1311, "val": 4500}], unit="mm"
        )
        before = dict(self.session.depth_calib)
        self.session.roi_update(y0=560, y1=1300)
        self.assertEqual(self.session.depth_calib, before)
        self.assertEqual(self.session._roi_box(), (315.0, 560.0, 1946.0, 1300.0))

    def test_calibration_never_touches_the_roi(self) -> None:
        roi_before = self.session._roi_box()
        self.session.calibrate_axes(
            y_marks=[{"pixel": 600, "val": 0}, {"pixel": 1200, "val": 300}]
        )
        self.assertEqual(self.session._roi_box(), roi_before)

    def test_two_marks_are_stored_in_pixel_order_regardless_of_click_order(self) -> None:
        self.session.calibrate_axes(
            y_marks=[{"pixel": 1200, "val": 300}, {"pixel": 600, "val": 0}]
        )
        self.assertEqual(self.session.depth_calib["top_px"], 600.0)
        self.assertEqual(self.session.depth_calib["top_cm"], 0.0)
        self.assertEqual(self.session.depth_calib["bottom_px"], 1200.0)
        self.assertEqual(self.session.depth_calib["bottom_cm"], 300.0)

    def test_values_may_decrease_downcore(self) -> None:
        """An age (BP) axis increases upcore; the fit must not assume depth."""
        result = self.session.calibrate_axes(
            y_marks=[{"pixel": 600, "val": 5000}, {"pixel": 1200, "val": 1000}]
        )
        self.assertLess(result["y_scale"]["slope"], 0)
        self.assertEqual(self.session.depth_calib["top_cm"], 5000.0)

    def test_calibration_requires_two_distinct_rows(self) -> None:
        from straditize_core.protocol import JsonRpcError

        with self.assertRaises(JsonRpcError):
            self.session.calibrate_axes(y_marks=[{"pixel": 700, "val": 0}])
        with self.assertRaises(JsonRpcError):
            self.session.calibrate_axes(
                y_marks=[{"pixel": 700, "val": 0}, {"pixel": 700, "val": 100}]
            )

    def test_project_round_trip_keeps_the_two_concepts_apart(self) -> None:
        self.session.calibrate_axes(
            y_marks=[{"pixel": 556, "val": 1500}, {"pixel": 1311, "val": 4500}], unit="mm"
        )
        self.session.roi_update(y0=560, y1=1300)
        self.session.algorithm_degrid(
            strength="medium",
            corrections=[{"mode": "erase", "radius": 5, "points": [[320, 600], [320, 900]]}],
        )
        saved = self.session.project_save(format="json")["data"]

        self.assertEqual(saved["roi"], {"x": 315.0, "y": 560.0, "w": 1631.0, "h": 740.0})
        self.assertEqual(saved["depth_calibration"]["top_px"], 556.0)
        self.assertEqual(saved["depth_calibration"]["bottom_cm"], 4500.0)
        self.assertEqual(saved["depth_calibration"]["unit"], "mm")
        self.assertEqual(len(saved["line_removal"]["corrections"]), 1)

        restored = StraditizeSession()
        restored.load_image(sample_key="hoya")
        restored.project_load(json.loads(json.dumps(saved)))
        # The written file stores ROI y=560, calibration y=556 -- different values,
        # which is the whole point: nothing can be reconstructed from the other.
        self.assertEqual(restored._roi_box(), (315.0, 560.0, 1946.0, 1300.0))
        self.assertEqual(restored.depth_calib["top_px"], 556.0)
        self.assertEqual(restored.depth_calib["top_cm"], 1500.0)
        self.assertEqual(restored.degrid_strength, "medium")
        self.assertEqual(len(restored.line_corrections), 1)

    def test_uncalibrated_project_does_not_invent_a_scale(self) -> None:
        saved = self.session.project_save(format="json")["data"]
        self.assertFalse(saved["depth_calibration"]["is_calibrated"])
        self.assertNotIn("top_cm", saved["depth_calibration"])

    def test_degrid_requires_a_declared_roi(self) -> None:
        from straditize_core.protocol import JsonRpcError

        fresh = StraditizeSession()
        fresh.load_image(sample_key="hoya")
        with self.assertRaises(JsonRpcError):
            fresh.algorithm_degrid(strength="medium")

    def test_degrid_survives_a_later_roi_change(self) -> None:
        """An ROI change invalidates the cached mask; extraction must recompute it."""
        self.session.algorithm_degrid(strength="medium")
        self.session.roi_update(y0=560, y1=1300)
        self.assertIsNone(self.session.grid_line_mask)
        mask = self.session._extraction_mask()
        self.assertIsNotNone(mask)
        self.assertIsNotNone(self.session.grid_line_mask)
        # Outside the ROI there is never data.
        self.assertFalse(bool(mask[0, 0]))
        self.assertFalse(bool(mask[:, 0].any()))

    def test_degrid_off_clears_the_session_mask(self) -> None:
        """"off" must clear the mask, not merely stop drawing it.

        Otherwise the previous mask keeps being subtracted on the digitising path
        after the user turned line removal off.
        """
        self.session.algorithm_degrid(strength="medium")
        self.assertIsNotNone(self.session.grid_line_mask)
        result = self.session.algorithm_degrid(strength="off")
        self.assertIsNone(self.session.grid_line_mask)
        self.assertIsNone(self.session.degrid_strength)
        self.assertIsNone(result["overlay_png"])
        self.assertEqual(result["removed_pixels"], 0)

    def test_digitize_refuses_a_column_outside_the_roi(self) -> None:
        """A column fully outside the ROI has no data; refuse instead of writing zeros."""
        from straditize_core.protocol import JsonRpcError

        self.session.column_add({"name": "outside", "startX": 2100, "endX": 2200})
        outside = len(self.session.columns) - 1
        with self.assertRaises(JsonRpcError) as ctx:
            self.session.digitize(outside, "area")
        self.assertIn("outside the data ROI", str(ctx.exception))

    def test_digitize_still_accepts_a_column_partly_inside_the_roi(self) -> None:
        """A column straddling the ROI edge is legitimate: the outside sliver is the
        axis spine the ROI exists to exclude."""
        col = dict(self.session.columns[0])
        col["start"] = 200  # left of roi xMin = 315
        self.session.columns.append(col)
        points = self.session.digitize(len(self.session.columns) - 1, "area")["points"]
        self.assertGreater(len(points), 0)
        self.assertTrue(all(p["x"] >= 200 for p in points))

    def test_digitize_reads_only_inside_the_roi(self) -> None:
        self.session.algorithm_degrid(strength="medium", remove_vertical=False)
        points = self.session.digitize(0, "area")["points"]
        y0, y1 = self.session._roi_box()[1], self.session._roi_box()[3]
        self.assertAlmostEqual(points[0]["row"], round(y0))
        self.assertAlmostEqual(points[-1]["row"], round(y1))


if __name__ == "__main__":
    unittest.main()
