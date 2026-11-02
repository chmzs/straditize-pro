"""Regression tests for the ``line`` reader on filled profiles (issue D-08).

On a filled silhouette the curve is the fill's TOP EDGE. The legacy ``line``
reader averaged the row's ink, which lands on the middle of the fill, so every
column reported exactly half the truth (measured: Diatom benchmark, P03 7.11 vs
14.21, P09 8.42 vs 16.84, P22 3.16 vs 6.32 — ratio 0.500).

The rule now distinguishes the two drawings structurally: ink that starts at the
baseline is a fill (read its right edge), ink that floats at the value is a stroke
(read its centre). With the legacy average restored these tests fail.
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from straditize_core.digitize import _line_own_offset
from straditize_core.session import StraditizeSession

BENCH = os.path.join("tests", "data", "figures", "benchmark_types")
DIATOM_IMAGE = os.path.join(BENCH, "Diatom_riojaPlotTestData.png")


def _row(offsets: list[int], areas: list[float]):
    """Build ``(fg_indices, band_labels_row, label_areas)`` for one band row."""
    labels_row = np.zeros(max(offsets) + 1, dtype=int)
    labels_row[offsets] = 1
    return np.asarray(offsets, dtype=int), labels_row, np.asarray(areas, dtype=float)


# --- the rule itself ---------------------------------------------------------

def test_filled_row_reads_the_fill_top_edge_not_its_middle():
    """Ink runs from the baseline (offset 0) to offset 10: the value is 10 px,
    not the 5 px that the legacy average reported."""
    fg, labels, areas = _row(list(range(0, 11)), [0.0, 900.0])

    assert _line_own_offset(fg, labels, areas) == 10.0


def test_filled_row_shorter_than_the_component_threshold_still_reads_the_edge():
    """A 4-px fill never clears ``_AREA_MIN_COMPONENT_PX``; the anchored tier
    must still return the fill's top edge (3), not its centre (1.5)."""
    fg, labels, areas = _row([0, 1, 2, 3], [0.0, 4.0])

    assert _line_own_offset(fg, labels, areas) == 3.0


def test_floating_stroke_reads_its_centre():
    """A 4-px stroke that does not touch the baseline is the curve itself, so the
    centre is the reading (the fill rule must not turn every stroke into its
    right edge)."""
    fg, labels, areas = _row([40, 41, 42, 43], [0.0, 500.0])

    assert _line_own_offset(fg, labels, areas) == 41.5


# --- the benchmark figure ----------------------------------------------------

@pytest.mark.skipif(not os.path.exists(DIATOM_IMAGE), reason="benchmark figure missing")
def test_line_and_area_agree_on_the_filled_diatom_profiles():
    """D-08 acceptance: on a filled profile ``line`` and ``area`` must report the
    same amplitude (ratio in 0.95-1.05); the legacy average gave 0.500."""
    session = StraditizeSession()
    session.load_image(image_path=DIATOM_IMAGE)
    columns = session.detect_columns(data_xlim=[70, 1055])

    ratios = {}
    for index, column in enumerate(columns):
        width = float(column["end"]) - float(column["start"])
        area = np.array([p["x"] for p in session.digitize(index, "area")["points"]],
                        dtype=float)
        line = np.array([p["x"] for p in session.digitize(index, "line")["points"]],
                        dtype=float)
        if float(np.ptp(area)) < 0.1 * width:  # panel too flat to be informative
            continue
        ratios[index] = float(line.max() - area.min()) / float(area.max() - area.min())

    assert ratios, "no column was informative"
    for index, ratio in ratios.items():
        assert 0.95 <= ratio <= 1.05, (index, ratio)
