"""Unit tests for the column-band own-curve membership rule.

A column band can hold ink that is not the column's own curve (a neighbouring
panel's zero line, dashed horizontal grid lines, the plot frame). The rule
identifies the column's own curve as the leftmost *connected ink component* of at
least ``_AREA_MIN_COMPONENT_PX`` pixels and then reads that component's rightmost
ink. These tests pin the selection and its two fallbacks.

The rule lives in ``straditize_core.digitize`` and is shared with the batch
``trace_area_profile`` reader, so one physical quantity has one read rule; these
tests import it from its single definition.
"""

import unittest

import numpy as np

from straditize_core.digitize import (
    _AREA_MIN_COMPONENT_PX,
    _band_components,
    _own_run_last_offset,
    _run_bounds,
)


def _row(labels: list[int], areas: list[float]):
    """Build ``(fg_indices, band_labels_row, label_areas)`` from a band row."""
    labels_row = np.asarray(labels, dtype=int)
    return np.flatnonzero(labels_row > 0), labels_row, np.asarray(areas, dtype=float)


class TestRunBounds(unittest.TestCase):
    def test_splits_runs_on_one_pixel_gaps(self):
        starts, ends = _run_bounds(np.array([0, 1, 2, 4, 5, 9]))
        np.testing.assert_array_equal(starts, [0, 3, 5])
        np.testing.assert_array_equal(ends, [2, 4, 5])

    def test_single_pixel(self):
        starts, ends = _run_bounds(np.array([7]))
        np.testing.assert_array_equal(starts, [0])
        np.testing.assert_array_equal(ends, [0])


class TestBandComponents(unittest.TestCase):
    def test_labels_and_areas_of_two_blobs(self):
        band = np.zeros((4, 6), dtype=bool)
        band[0:2, 0:2] = True  # 4 px blob
        band[2:4, 4:6] = True  # 4 px blob, separate
        labels, areas = _band_components(band)

        self.assertEqual(labels.shape, band.shape)
        self.assertEqual(labels[0, 0], labels[1, 1])
        self.assertNotEqual(labels[0, 0], labels[2, 4])
        self.assertEqual(labels[0, 5], 0)
        self.assertEqual(areas[0], 0.0)
        self.assertEqual(areas[labels[0, 0]], 4.0)
        self.assertEqual(areas[labels[2, 4]], 4.0)

    def test_connects_diagonals(self):
        band = np.zeros((2, 2), dtype=bool)
        band[0, 0] = True
        band[1, 1] = True
        _, areas = _band_components(band)
        self.assertEqual(areas[1], 2.0)

    def test_empty_band(self):
        labels, areas = _band_components(np.zeros((3, 3), dtype=bool))
        self.assertTrue((labels == 0).all())
        np.testing.assert_array_equal(areas, [0.0])


class TestOwnRunSelection(unittest.TestCase):
    def test_prefers_substantial_structure_over_foreign_speck_on_the_right(self):
        # Own silhouette (500 px) on the left; a small foreign blob on the right.
        fg, labels, areas = _row([1, 1, 1, 0, 0, 2, 2], [0.0, 500.0, 12.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 2)

    def test_reads_rightmost_ink_of_the_own_component(self):
        # Own component's ink is split by a one-pixel antialiasing gap; a small
        # foreign blob sits further right and must not be read.
        fg, labels, areas = _row([1, 1, 0, 1, 1, 1, 0, 2], [0.0, 900.0, 8.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 5)

    def test_ignores_small_dashed_marks_left_of_the_curve(self):
        # Thin-line diagram: dashed grid marks (10 px each) to the left, the
        # curve's own ink split into two runs of the one substantial component.
        fg, labels, areas = _row(
            [1, 1, 1, 0, 2, 2, 0, 3, 3, 0, 3, 3, 3], [0.0, 10.0, 10.0, 3821.0]
        )
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 12)

    def test_anchored_component_wins_when_nothing_is_substantial(self):
        # No component clears the area threshold, but the row's ink starts at the
        # baseline: the anchored component is still the own curve, so the foreign
        # island further right must not be read.
        fg, labels, areas = _row([1, 1, 0, 2, 2, 2, 0, 3], [0.0, 4.0, 6.0, 3.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 1)

    def test_anchored_component_is_read_where_it_reappears_later_in_the_row(self):
        # The anchored component's ink resumes at offset 3 after an antialiasing
        # gap; its rightmost ink in this row is 3, not the first run's end (1).
        fg, labels, areas = _row([1, 1, 0, 1, 0, 2], [0.0, 4.0, 9.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 3)

    def test_falls_back_to_rightmost_ink_when_nothing_is_anchored(self):
        # Nothing is substantial and the ink starts away from the baseline: only
        # then is the legacy rightmost-ink reading used.
        fg, labels, areas = _row([0, 0, 0, 0, 0, 1, 1, 0, 2, 2], [0.0, 4.0, 3.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 9)

    def test_area_at_threshold_counts_as_substantial(self):
        fg, labels, areas = _row(
            [1, 1, 0, 2], [0.0, float(_AREA_MIN_COMPONENT_PX), 0.0]
        )
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 1)

    def test_single_contiguous_run(self):
        fg, labels, areas = _row([1, 1, 1, 1], [0.0, 400.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 3)

    def test_background_label_zero_is_never_treated_as_ink(self):
        fg, labels, areas = _row([1, 1], [0.0, 0.0])
        self.assertEqual(_own_run_last_offset(fg, labels, areas), 1)


if __name__ == "__main__":
    unittest.main()
