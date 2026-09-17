"""Unit tests for straditize_core.

Completely independent of Qt and Matplotlib.
Verifies image binarization, column boundary detection, column digitization,
curve control points (RDP and spline reconstruction), and coordinate calibrations.
"""
import subprocess
import sys
import unittest
from pathlib import Path

# Ensure straditize_core can be imported even if not installed in site-packages
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np
import pandas as pd
from PIL import Image
from straditize_core.calibration import (
    LinearCalibration,
    LogCalibration,
    PiecewiseCalibration,
    StratigraphicCalibration,
)
from straditize_core.columns import (
    detect_column_bounds,
    detect_column_starts,
    groupby_arr,
    slice_columns,
)
from straditize_core.curve import (
    ControlPointSet,
    extract_control_points,
    rdp_indices,
    reconstruct_curve,
)
from straditize_core.digitize import (
    digitize_columns,
    trace_area_profile,
    trace_bar_profile,
    trace_line_center,
)
from straditize_core.image import (
    build_foreground,
    circular_hue_distance,
    dominant_overlay_hue,
    light_overlay_colored_mask,
    load_image,
    to_binary,
    to_grey,
)
from straditize_core.pipeline import StraditizePipeline

TEST_DIR = Path(__file__).resolve().parent
TEST_FIGURES_DIR = TEST_DIR / "test_figures"


class PureCoreIsolationTest(unittest.TestCase):
    """Verify straditize_core does not import PyQt5 or matplotlib."""

    def test_strict_zero_gui_isolation(self):
        # Run in an isolated subprocess to avoid pytest runner / conftest pollution
        code = (
            f"import sys\n"
            f"sys.path.insert(0, r'{REPO_ROOT}')\n"
            f"import straditize_core\n"
            f"forbidden = [m for m in sys.modules if 'PyQt5' in m or 'matplotlib' in m]\n"
            f"assert len(forbidden) == 0, f'Forbidden modules imported: {{forbidden}}'\n"
            f"print('ISOLATION_OK')\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            proc.returncode, 0,
            f"straditize_core isolation check failed in clean subprocess:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
        )
        self.assertIn("ISOLATION_OK", proc.stdout)


class ImageBinarizationTest(unittest.TestCase):
    """Test image loading and color/foreground binarization."""

    def test_load_image_various_types(self):
        # 1. NumPy 2D array
        arr2d = np.zeros((20, 20), dtype=np.uint8)
        img1 = load_image(arr2d)
        self.assertIsInstance(img1, Image.Image)
        self.assertEqual(img1.mode, 'RGBA')
        self.assertEqual(img1.size, (20, 20))

        # 2. NumPy 3D RGB array
        arr3d = np.zeros((30, 25, 3), dtype=np.uint8)
        img2 = load_image(arr3d)
        self.assertEqual(img2.size, (25, 30))

        # 3. Existing file path if present
        basic_path = TEST_FIGURES_DIR / "basic_diagram.png"
        if basic_path.exists():
            img3 = load_image(basic_path)
            self.assertEqual(img3.mode, 'RGBA')

    def test_to_binary_and_to_grey(self):
        # White background (255, 255, 255), black stroke (0, 0, 0)
        img_arr = np.full((10, 10, 3), 255, dtype=np.uint8)
        img_arr[3:7, 3:7, :] = 0  # 4x4 black box
        img = Image.fromarray(img_arr).convert('RGB')

        binary = to_binary(img, threshold=200 * 3)
        self.assertEqual(binary.shape, (10, 10))
        self.assertEqual(binary.dtype, np.uint8)
        self.assertEqual(binary[3:7, 3:7].sum(), 16)
        self.assertEqual(binary[0:2, :].sum(), 0)

        grey = to_grey(img, threshold=200 * 3)
        self.assertEqual(grey.shape, (10, 10))
        self.assertTrue((grey[3:7, 3:7] > 0).all())
        self.assertTrue((grey[0:2, :] == 0).all())

    def test_guided_segmentation_target_colors(self):
        # Red foreground vs Green unwanted lines
        arr = np.full((15, 15, 4), 255, dtype=np.uint8)
        arr[2:8, 2:5, :3] = [220, 20, 20]    # Red target
        arr[9:12, 2:5, :3] = [20, 220, 20]  # Green background mark

        mask = build_foreground(
            arr, extraction_mode='standard', segmentation_mode='guided',
            target_colors=['#DC1414'])
        self.assertTrue(mask[2:8, 2:5].all())
        self.assertFalse(mask[9:12, 2:5].any())

    def test_light_overlay_detection(self):
        rgb = np.ones((8, 8, 3), dtype=float)
        rgb[2:6, 2:6, :] = [0.95, 0.75, 0.75]  # Pale pink overlay
        colored = light_overlay_colored_mask(rgb)
        self.assertTrue(colored[2:6, 2:6].all())
        self.assertFalse(colored[0:2, :].any())

    def test_circular_hue_and_dominant_hue(self):
        h1 = np.array([0.05, 0.95])
        h2 = 0.0
        dist = circular_hue_distance(h1, h2)
        np.testing.assert_allclose(dist, [0.05, 0.05])

        # Test dominant overlay hue
        hue = np.array([0.1, 0.12, 0.09, 0.8])
        sat = np.array([0.5, 0.6, 0.5, 0.1])
        mask = np.array([True, True, True, False])
        dom_hue, conf = dominant_overlay_hue(hue, sat, mask)
        self.assertIsNotNone(dom_hue)
        self.assertAlmostEqual(dom_hue, 0.103, delta=0.02)
        self.assertGreater(conf, 0.9)


class ColumnDetectionTest(unittest.TestCase):
    """Test automatic column boundary detection."""

    def test_groupby_arr(self):
        arr = np.array([True, True, False, False, False, True])
        keys, bounds = groupby_arr(arr)
        np.testing.assert_array_equal(keys, [True, False, True])
        np.testing.assert_array_equal(bounds, [0, 2, 5, 6])

    def test_detect_column_bounds_synthetic(self):
        # Create a synthetic diagram of 100 rows x 120 cols with 3 distinct columns
        # Col 0: cols 10..30 (width 20)
        # Col 1: cols 50..70 (width 20)
        # Col 2: cols 90..110 (width 20)
        binary = np.zeros((100, 120), dtype=np.uint8)
        binary[10:90, 10:30] = 1
        binary[10:90, 50:70] = 1
        binary[10:90, 90:110] = 1

        starts = detect_column_starts(binary, threshold=0.1, min_col_width_ratio=0.05)
        self.assertEqual(len(starts), 3)
        self.assertEqual(starts[0], 10)
        self.assertEqual(starts[1], 50)
        self.assertEqual(starts[2], 90)

        # Compact bounds
        compact_bounds = detect_column_bounds(binary, threshold=0.1, compact=True)
        self.assertEqual(len(compact_bounds), 3)
        self.assertEqual(compact_bounds[0], (10, 30))
        self.assertEqual(compact_bounds[1], (50, 70))
        self.assertEqual(compact_bounds[2], (90, 110))

        # Tiled bounds
        tiled_bounds = detect_column_bounds(binary, threshold=0.1, compact=False)
        self.assertEqual(tiled_bounds[0], (10, 50))
        self.assertEqual(tiled_bounds[1], (50, 90))
        self.assertEqual(tiled_bounds[2], (90, 120))

    def test_slice_columns(self):
        arr = np.arange(100).reshape(10, 10)
        bounds = [(0, 3), (3, 7), (7, 10)]
        slices = slice_columns(arr, bounds)
        self.assertEqual(len(slices), 3)
        self.assertEqual(slices[0].shape, (10, 3))
        self.assertEqual(slices[1].shape, (10, 4))
        self.assertEqual(slices[2].shape, (10, 3))


class DigitizationTest(unittest.TestCase):
    """Test column digitization profiles (area, line, bar)."""

    def test_trace_area_profile(self):
        # Section width 10, height 5
        section = np.zeros((5, 10), dtype=bool)
        section[0, :3] = True  # width = 3
        section[1, :7] = True  # width = 7
        section[2, :] = False  # width = 0
        section[3, 2:5] = True # max pixel = 4, width = 5
        section[4, :1] = True  # width = 1

        profile = trace_area_profile(section)
        np.testing.assert_array_equal(profile, [3.0, 7.0, 0.0, 5.0, 1.0])

    def test_trace_line_center(self):
        # A clean vertical line at x = 5
        section = np.zeros((20, 12), dtype=bool)
        section[2:18, 5] = True
        centers = trace_line_center(section)
        self.assertTrue(np.isfinite(centers[2:18]).all())
        np.testing.assert_allclose(centers[2:18], 5.0)

    def test_trace_bar_profile_continuity(self):
        section = np.zeros((10, 15), dtype=bool)
        section[2:8, :5] = True
        # Gap in row 5
        section[5, :5] = False
        values = trace_bar_profile(section, max_gap=1)
        # Should bridge single missing row
        np.testing.assert_array_equal(
            values, [0, 0, 5, 5, 5, 5, 5, 5, 0, 0])

    def test_digitize_columns_and_interpolate_hlines(self):
        binary = np.zeros((20, 30), dtype=np.uint8)
        # Column 0: 0..15, filled 5 px wide
        binary[:, :5] = 1
        # Column 1: 15..30, filled 8 px wide
        binary[:, 15:23] = 1

        # Add horizontal artifact line at row 10 across both columns
        binary[10, :] = 1

        bounds = [(0, 15), (15, 30)]
        df = digitize_columns(
            binary, bounds, method='area', column_names=['PollenA', 'PollenB'],
            hline_locs=[10])

        self.assertEqual(list(df.columns), ['PollenA', 'PollenB'])
        self.assertEqual(len(df), 20)
        # Because row 10 was interpolated, PollenA should remain around 5 and PollenB around 8
        self.assertAlmostEqual(df['PollenA'].iloc[10], 5.0, delta=0.5)
        self.assertAlmostEqual(df['PollenB'].iloc[10], 8.0, delta=0.5)


class CurveControlPointTest(unittest.TestCase):
    """Test Ramer-Douglas-Peucker simplification, control points, and spline reconstruction."""

    def test_rdp_indices_simple_triangle(self):
        # A triangle: (0, 0), (5, 10), (10, 0) with collinear intermediate points
        x = np.linspace(0, 10, 11)
        y = np.array([0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0], dtype=float)

        # With epsilon = 0.5, only (0,0), (5,10), (10,0) should be kept
        kept = rdp_indices(x, y, epsilon=0.5)
        self.assertEqual(kept, [0, 5, 10])

    def test_extract_control_points(self):
        s = pd.Series([0, 1, 2, 3, 5, 7, 9, 10, 9, 7, 5, 3, 1, 0], index=range(14))
        rows, vals = extract_control_points(s, epsilon=0.5, max_points=10)
        self.assertGreater(len(rows), 2)
        self.assertEqual(len(rows), len(vals))
        self.assertIn(0, rows)
        self.assertIn(13, rows)
        self.assertIn(7, rows)  # Peak should be detected

    def test_reconstruct_curve_methods(self):
        rows = [0, 5, 10]
        values = [0.0, 10.0, 0.0]
        target = np.arange(11)

        # Linear
        rec_lin = reconstruct_curve(rows, values, target, method='linear')
        self.assertAlmostEqual(rec_lin[5], 10.0)
        self.assertAlmostEqual(rec_lin[2], 4.0)

        # Pchip (monotonic Hermite)
        rec_pchip = reconstruct_curve(rows, values, target, method='pchip')
        self.assertAlmostEqual(rec_pchip[5], 10.0)
        self.assertTrue(np.all(rec_pchip >= 0.0))  # No negative overshoot

        # Spline
        rows_4 = [0, 3, 7, 10]
        vals_4 = [0.0, 5.0, 8.0, 0.0]
        rec_spline = reconstruct_curve(rows_4, vals_4, target, method='spline')
        self.assertEqual(len(rec_spline), 11)
        self.assertAlmostEqual(rec_spline[3], 5.0, delta=1e-5)

    def test_control_point_set_editing(self):
        cpset = ControlPointSet(rows=[0, 10], values=[0.0, 20.0])
        # Add a point at row 5
        cpset.add_or_update(row=5, value=15.0)
        self.assertEqual(cpset.rows, [0.0, 5.0, 10.0])
        self.assertEqual(cpset.values, [0.0, 15.0, 20.0])

        # Remove point
        removed = cpset.remove_at(5.0)
        self.assertTrue(removed)
        self.assertEqual(cpset.rows, [0.0, 10.0])


class ScientificCalibrationTest(unittest.TestCase):
    """Test bi-directional scientific coordinate calibrations."""

    def test_linear_calibration_forward_and_backward(self):
        # Pixel row 0 -> Depth 10.0 cm; Pixel row 500 -> Depth 110.0 cm
        cal = LinearCalibration(px_points=[0, 500], data_points=[10.0, 110.0], name="Depth")

        self.assertAlmostEqual(cal.px2data(0), 10.0)
        self.assertAlmostEqual(cal.px2data(250), 60.0)
        self.assertAlmostEqual(cal.px2data(500), 110.0)

        # Inverse
        self.assertAlmostEqual(cal.data2px(10.0), 0.0)
        self.assertAlmostEqual(cal.data2px(60.0), 250.0)
        self.assertAlmostEqual(cal.data2px(110.0), 500.0)

    def test_piecewise_calibration(self):
        # Non-linear age model:
        # px 0 -> 0 BP, px 200 -> 1000 BP, px 500 -> 4000 BP
        cal = PiecewiseCalibration([0, 200, 500], [0, 1000, 4000], name="Age")
        self.assertAlmostEqual(cal.px2data(100), 500.0)
        self.assertAlmostEqual(cal.data2px(500.0), 100.0)

    def test_stratigraphic_calibration_dataframe(self):
        y_cal = LinearCalibration([0, 100], [50.0, 150.0], name="Depth (cm)")
        # 1 px width = 0.5 % abundance
        strat_cal = StratigraphicCalibration(y_calibration=y_cal, x_scale=0.5, y_name="Depth (cm)")

        df_px = pd.DataFrame({
            'Pinus': [10.0, 20.0, 30.0],
            'Betula': [4.0, 6.0, 8.0],
        }, index=[0, 50, 100])

        df_sci = strat_cal.transform_dataframe(df_px)
        np.testing.assert_allclose(df_sci.index.values, [50.0, 100.0, 150.0])
        np.testing.assert_allclose(df_sci['Pinus'].values, [5.0, 10.0, 15.0])
        np.testing.assert_allclose(df_sci['Betula'].values, [2.0, 3.0, 4.0])

        # Invert back to pixel domain
        df_roundtrip = strat_cal.inverse_transform_dataframe(df_sci)
        np.testing.assert_allclose(df_roundtrip.index.values, df_px.index.values)
        np.testing.assert_allclose(df_roundtrip['Pinus'].values, df_px['Pinus'].values)


class LogCalibrationTest(unittest.TestCase):
    """Unit tests for LogCalibration bi-directional mapping and hard constraints."""

    def test_log_calibration_mapping_and_inversion(self):
        cal = LogCalibration(px_points=[100.0, 200.0], data_points=[1.0, 100.0])
        # Exact points
        self.assertAlmostEqual(cal.px2data(100.0), 1.0)
        self.assertAlmostEqual(cal.px2data(200.0), 100.0)
        # Geometric midpoint (150 px) should be sqrt(1 * 100) = 10.0
        self.assertAlmostEqual(cal.px2data(150.0), 10.0)

        # Inverse mapping (data2px)
        self.assertAlmostEqual(cal.data2px(1.0), 100.0)
        self.assertAlmostEqual(cal.data2px(100.0), 200.0)
        self.assertAlmostEqual(cal.data2px(10.0), 150.0)

        # Array round-trip
        test_vals = np.array([1.5, 10.0, 25.0, 80.0])
        px = cal.data2px(test_vals)
        recovered = cal.px2data(px)
        np.testing.assert_allclose(recovered, test_vals, rtol=1e-10)

    def test_log_calibration_hard_constraints(self):
        # start_val <= 0
        with self.assertRaises(ValueError):
            LogCalibration(px_points=[0.0, 100.0], data_points=[0.0, 10.0])

        # tick_val <= 0
        with self.assertRaises(ValueError):
            LogCalibration(px_points=[0.0, 100.0], data_points=[1.0, -5.0])

        # start_val == tick_val
        with self.assertRaises(ValueError):
            LogCalibration(px_points=[0.0, 100.0], data_points=[10.0, 10.0])

        # identical pixel points
        with self.assertRaises(ValueError):
            LogCalibration(px_points=[50.0, 50.0], data_points=[1.0, 10.0])

        # inverse mapping on non-positive value
        cal = LogCalibration(px_points=[0.0, 100.0], data_points=[1.0, 10.0])
        with self.assertRaises(ValueError):
            cal.data2px(0.0)
        with self.assertRaises(ValueError):
            cal.data2px(-1.0)


class StraditizePipelineEndToEndTest(unittest.TestCase):
    """End-to-end headless pipeline workflow test."""

    def test_complete_headless_workflow(self):
        # 1. Synthesize a multi-column diagram image
        height, width = 60, 80
        img_arr = np.full((height, width, 4), 255, dtype=np.uint8)
        # Column 0: x=10..30, curve width expands from 2 to 12
        for r in range(height):
            w = int(2 + 10 * (r / height))
            img_arr[r, 10:10 + w, :3] = 0
        # Column 1: x=40..70, curve width constant 8
        img_arr[:, 40:48, :3] = 0

        # 2. Run pipeline
        pipeline = StraditizePipeline()
        pipeline.load(img_arr)
        pipeline.preprocess(threshold=200 * 3)
        self.assertIsNotNone(pipeline.binary)

        pipeline.set_column_bounds([(10, 40), (40, 75)], column_names=['TaxonA', 'TaxonB'])
        pipeline.digitize(method='area')

        self.assertIsNotNone(pipeline.df_pixels)
        self.assertEqual(list(pipeline.df_pixels.columns), ['TaxonA', 'TaxonB'])
        self.assertEqual(len(pipeline.df_pixels), height)

        # 3. Scientific calibration
        # Align y_px range with row indices 0 to height - 1
        pipeline.calibrate(
            y_px=[0, height - 1],
            y_data=[100.0, 200.0],
            x_scale=0.2,
            y_name="Elevation (m)",
        )
        df_final = pipeline.get_dataframe(calibrated=True)

        self.assertEqual(df_final.index.name, "Elevation (m)")
        self.assertAlmostEqual(df_final.index[0], 100.0)
        self.assertAlmostEqual(df_final.index[-1], 200.0)

        # 4. Interactive control point edit on TaxonA
        rows, vals = pipeline.get_control_points('TaxonA')
        self.assertGreater(len(rows), 1)
        self.assertEqual(len(rows), len(vals))

        # Modify a control point and check curve rebuilding
        pipeline.update_control_point('TaxonA', row=30, value=25.0, rebuild=True)
        self.assertEqual(pipeline.df_pixels['TaxonA'].iloc[30], 25.0)


if __name__ == '__main__':
    unittest.main()
