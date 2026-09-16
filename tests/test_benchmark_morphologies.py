# -*- coding: utf-8 -*-
"""Benchmark regression test suite for 6 canonical pollen diagram morphologies.

Covers the complete typological spectrum extracted from Bell (2018) and riojaPlot:
1. Type 1: Filled Silhouette Area (连续实心面积轮廓图)
2. Type 2: Exaggeration Curves (低丰度局部放大轮廓图, e.g. 5x)
3. Type 3: Discrete Horizontal Bars (离散水平条形/柱状图)
4. Type 4: Pure Line / Proxy Curves (连续骨架纯折线/代用指标图)
5. Type 5: Presence / Absence Symbols (稀有属种离散散点/符号标记图)
6. Type 6: Composite Multi-Component Diagram (出版级复合图: 双Y轴 + 分区 + 聚类树)
"""

import os
import sys
import unittest

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
core_dir = os.path.join(root_dir, "straditize")
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

from straditize_core.session import StraditizeSession
from straditize_core.calibration import LinearCalibration, LogCalibration


class TestPollenMorphologyBenchmarks(unittest.TestCase):
    BENCHMARK_DIR = os.path.join(os.path.dirname(__file__), "test_figures", "benchmark_types")

    def _get_image_path(self, filename: str) -> str:
        path = os.path.join(self.BENCHMARK_DIR, filename)
        if not os.path.exists(path):
            self.skipTest(f"Benchmark asset {filename} not found in {self.BENCHMARK_DIR}")
        return path

    def test_type1_filled_silhouette(self):
        """Type 1: Continuous filled silhouette area digitization."""
        img_path = self._get_image_path("type1_filled_silhouette_aber.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 100)
        self.assertGreater(info["height"], 100)

        fg_res = session.extract_foreground(mode="otsu")
        self.assertGreater(fg_res["foreground_pixels"], 0)
        self.assertLess(fg_res["foreground_ratio"], 0.70)

        # Detect columns within core diagram bounds
        cols = session.detect_columns([50, info["width"] - 50], [50, info["height"] - 50])
        self.assertGreaterEqual(len(cols), 1)

        # Digitize first column
        dig_res = session.digitize(0, reader_type="area")
        self.assertIn("points", dig_res)
        self.assertGreater(len(dig_res["points"]), 0)

    def test_type2_exaggeration_handling(self):
        """Type 2: Low-abundance exaggeration curves (e.g. 5x overlay)."""
        img_path = self._get_image_path("type2_exaggeration_bell.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 200)

        fg_res = session.extract_foreground(mode="otsu")
        self.assertGreater(fg_res["foreground_pixels"], 0)

        # Detect columns across the diagram area
        cols = session.detect_columns([100, info["width"] - 50], [80, info["height"] - 80])
        self.assertGreaterEqual(len(cols), 1)

    def test_type3_discrete_horizontal_bars(self):
        """Type 3: Discrete horizontal bars across discrete stratigraphic samples."""
        img_path = self._get_image_path("type3_discrete_bars_bell.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 200)

        fg_res = session.extract_foreground(mode="otsu")
        self.assertGreater(fg_res["foreground_pixels"], 0)

        cols = session.detect_columns([100, info["width"] - 50], [80, info["height"] - 80])
        self.assertGreaterEqual(len(cols), 1)

    def test_type4_pure_line_proxies(self):
        """Type 4: Pure line curves / non-filled proxy indicator curves."""
        img_path = self._get_image_path("type4_pure_line_proxy.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 100)

        fg_res = session.extract_foreground(mode="otsu")
        self.assertGreater(fg_res["foreground_pixels"], 0)

    def test_type5_presence_absence_symbols(self):
        """Type 5: Discrete presence/absence symbol markings (<2% detections)."""
        img_path = self._get_image_path("type5_presence_symbols.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 100)

        fg_res = session.extract_foreground(mode="otsu")
        self.assertGreater(fg_res["foreground_pixels"], 0)

    def test_type6_composite_diagram_roi_and_calibration(self):
        """Type 6: Composite publication diagram (Zonation + Dual Y-axis + Dendrogram)."""
        img_path = self._get_image_path("type6_composite_zonation_cluster.png")
        session = StraditizeSession()
        info = session.load_image(img_path)
        self.assertGreater(info["width"], 300)

        # Multi-region ROI test: crop data area excluding dendrogram on right
        roi_x_max = int(info["width"] * 0.82)
        cols = session.detect_columns([120, roi_x_max], [80, info["height"] - 80])
        self.assertGreaterEqual(len(cols), 1)

        # Two-point vertical calibration
        cal_res = session.calibrate_axes(
            y_marks=[
                {"pixel": 80.0, "val": 0.0},
                {"pixel": float(info["height"] - 80), "val": 150.0},
            ]
        )
        self.assertEqual(cal_res["status"], "calibrated")
        self.assertAlmostEqual(session.y_scale["intercept"], -80.0 * session.y_scale["slope"], delta=1.0)


if __name__ == "__main__":
    unittest.main()
