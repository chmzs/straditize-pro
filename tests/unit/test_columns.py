"""Regression tests for legacy-compatible column boundary detection."""

from __future__ import annotations

import numpy as np

from straditize_core.columns import detect_column_bounds, detect_column_starts


def test_detects_legacy_column_starts() -> None:
    """The detector should recover the starts of separated data runs."""
    binary = np.zeros((100, 240), dtype=np.uint8)
    binary[10:90, 30:80] = 1
    binary[10:90, 110:160] = 1
    binary[10:90, 190:230] = 1

    assert detect_column_starts(binary, threshold=0.10, min_col_width_ratio=0.01).tolist() == [
        30,
        110,
        190,
    ]


def test_column_end_is_the_next_column_start() -> None:
    """Adjacent column intervals must tile from each start to the next start."""
    binary = np.zeros((100, 240), dtype=np.uint8)
    binary[10:90, 30:80] = 1
    binary[10:90, 110:160] = 1
    binary[10:90, 190:230] = 1

    assert detect_column_bounds(
        binary, threshold=0.10, min_col_width_ratio=0.01
    ) == [(30, 110), (110, 190), (190, 240)]
