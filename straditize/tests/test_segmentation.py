# -*- coding: utf-8 -*-
"""Tests for the shared segmentation helpers."""
import time
import unittest

import numpy as np

import straditize.segmentation as segmentation


class SegmentationTest(unittest.TestCase):

    def test_normalize_target_colors_handles_combined_tokens(self):
        colors = segmentation.normalize_target_colors(
            ['#E5E5E5, #EBE2E3', ' #992F31 '])
        self.assertEqual(colors, ['#E5E5E5', '#EBE2E3', '#992F31'])

    def test_build_foreground_guided_fallback_keeps_adjacent_targets(self):
        arr = np.full((12, 12, 4), 255, dtype=np.uint8)
        arr[..., -1] = 255
        arr[2:10, 2:4, :3] = [180, 0, 0]      # dark primary
        arr[2:10, 4:6, :3] = [240, 200, 200]  # pale guided target
        mask = segmentation.build_foreground(
            arr, extraction_mode='standard', segmentation_mode='guided',
            target_colors=['#F0C8C8'])
        expected = np.zeros(mask.shape, dtype=bool)
        expected[2:10, 4:6] = True
        np.testing.assert_array_equal(mask, expected)

    def test_split_primary_exagg_prefers_outer_layer(self):
        rgb = np.ones((10, 12, 3), dtype=float)
        base = np.zeros((10, 12), dtype=bool)
        overlay = np.zeros((10, 12), dtype=bool)
        # dark primary on the right side
        rgb[:, 6:9, :] = np.array([0.7, 0.0, 0.0])
        base[:, 6:9] = True
        overlay[:, 6:9] = True
        # pale candidate on the right (valid outer extension)
        rgb[:, 9:11, :] = np.array([0.94, 0.78, 0.78])
        overlay[:, 9:11] = True
        # pale candidate on the left (should be rejected by outer constraint)
        rgb[:, 3:5, :] = np.array([0.94, 0.78, 0.78])
        overlay[:, 3:5] = True

        mask = segmentation.split_primary_exagg(
            rgb, base, overlay, np.array([[0, 12]]))
        self.assertTrue(mask[:, 9:11].any())
        self.assertFalse(mask[:, 3:5].any())

    def test_trace_line_center_handles_branch_and_small_gaps(self):
        section = np.zeros((20, 14), dtype=bool)
        section[np.arange(3, 17), 4 + (np.arange(3, 17) // 5)] = True
        section[8:11, 9] = True  # branch spur
        section[12, 6] = False   # small gap in main path
        centers = segmentation.trace_line_center(section)
        self.assertTrue(np.isfinite(centers[4:16]).all())
        self.assertLess(np.nanmax(np.abs(np.diff(centers[4:16]))), 4.0)

    def test_trace_bar_profile_ignores_isolated_full_width_row(self):
        section = np.zeros((10, 12), dtype=bool)
        section[2:8, :3] = True
        section[5, :] = True

        values = segmentation.trace_bar_profile(section)

        np.testing.assert_array_equal(
            values, np.array([0, 0, 3, 3, 3, 3, 3, 3, 0, 0], dtype=float))

    def test_trace_bar_profile_bridges_single_missing_row(self):
        section = np.zeros((10, 8), dtype=bool)
        section[2:8, :3] = True
        section[5, :3] = False

        values = segmentation.trace_bar_profile(section)

        np.testing.assert_array_equal(
            values, np.array([0, 0, 3, 3, 3, 3, 3, 3, 0, 0], dtype=float))

    def test_build_foreground_large_image_perf_under_4s(self):
        arr = np.full((1800, 1200, 4), 255, dtype=np.uint8)
        arr[..., -1] = 255
        arr[200:1600, 200:260, :3] = [180, 0, 0]
        arr[200:1600, 260:320, :3] = [240, 200, 200]
        start = time.perf_counter()
        mask = segmentation.build_foreground(
            arr, extraction_mode='standard', segmentation_mode='guided',
            target_colors=['#F0C8C8'])
        elapsed = time.perf_counter() - start
        self.assertTrue(mask.any())
        self.assertLess(
            elapsed, 4.0, msg='guided foreground took %.3fs' % elapsed)
