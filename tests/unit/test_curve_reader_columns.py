"""Regression tests for the two column-boundary defects found on the curve-style
benchmark figure (issues P-01 and P-02 in ``docs/findings/bench-issues/bench-pollen.md``).

P-01 — a panel axis loses to the first ink of its own curve when both land within
``min_col_width_ratio`` of each other, so Empetrum's band ran to Gramineae's axis.

P-02 — the panel's own Y axis is a separate stroke on an unfilled (curve) drawing
and is the band's largest connected component, so the area reader reported the
axis (0 %) wherever the curve stood clear of it.

Both tests are falsifiable: with the legacy rules restored they fail (see
``docs/findings/bench-curve-fix.md`` for the measured red/green numbers).
"""

from __future__ import annotations

import json
import math
import os

import numpy as np
import pytest

from straditize_core.columns import detect_column_starts
from straditize_core.digitize import trace_area_profile
from straditize_core.session import StraditizeSession

BENCH = os.path.join("tests", "data", "figures", "benchmark_types")
CURVE_IMAGE = os.path.join(BENCH, "Pollen_CruveStyle_riojaPlotTestData.png")
POLLEN_GOLDEN = os.path.join(BENCH, "golden", "abernethy_pollen.json")

#: Panel left axes measured from the pixels (identical on all three pollen styles;
#: see ``docs/findings/bench-pollen.md`` §1).
SPINES = [112, 213, 332, 345, 359, 378, 423, 474, 525, 544, 601, 652, 691, 704,
          717, 812, 825, 839, 896, 909, 929]

#: Row of each printed depth tick on the bar/curve layouts (depth 300 -> row 82,
#: 540 -> row 543; the y axis is linear in age, not in depth).
CURVE_TICK_ROWS = [82, 114, 145, 181, 217, 248, 279, 313, 355, 404, 456, 502, 543]
TICK_DEPTHS = np.arange(300, 541, 20, dtype=float)


def _curve_session():
    """Session on the curve-style figure with the ROI covering the whole data box."""
    session = StraditizeSession()
    session.load_image(image_path=CURVE_IMAGE)
    session.detect_columns()
    session.roi_update(y0=float(CURVE_TICK_ROWS[0]), y1=563.0)
    return session, session.detect_columns()


def _axis_max(taxon: dict) -> float:
    """Full-scale value of a pollen panel: ``ceil(max / 20) * 20``.

    Independently verified from the pixels (each panel's maximum fill width
    converts to 18.5-20 / 36-40 / 80 / 100 units for that scale), see
    ``docs/findings/bench-pollen.md`` §1.
    """
    return float(math.ceil(float(taxon["max"]) / 20.0) * 20)


def _row_for_depth(depth: float) -> int:
    rows = np.asarray(CURVE_TICK_ROWS, dtype=float)
    if depth <= TICK_DEPTHS[0]:
        return int(round(rows[0]))
    if depth >= TICK_DEPTHS[-1]:
        return int(round(rows[-1]))
    return int(round(float(np.interp(depth, TICK_DEPTHS, rows))))


# --- P-01: a close pair of candidates is resolved by vertical coverage ---------

def test_axis_beats_curve_first_ink_within_the_minimum_column_width():
    """Candidate 20 is the panel axis (ink in every row); candidate 28 only holds
    the curve's first ink (20 % of rows). They are 8 px apart, i.e. closer than
    ``min_col_width_ratio`` * width = 10 px, so the pair must collapse onto the
    axis. The legacy rule kept the *follower* and so started the column 8 px to
    the right — the whole P-01 defect.
    """
    binary = np.zeros((100, 1000), dtype=bool)
    binary[0, 10] = True            # stray speck, keeps x=20 out of the first run
    binary[:, 20] = True            # panel axis: 100/100 rows
    binary[10:30, 28:31] = True     # curve's first ink: 20/100 rows, 8 px to the right
    binary[:, 500] = True           # next panel's axis

    starts = detect_column_starts(binary, threshold=0.10, min_col_width_ratio=0.01)

    assert starts.tolist() == [20, 500]


@pytest.mark.skipif(not os.path.exists(CURVE_IMAGE), reason="benchmark figure missing")
def test_curve_style_keeps_all_three_lost_panel_axes():
    """P-01 acceptance: 601 / 652 / 839 (±2 px) must be detected again and no
    column may run past its panel's right axis."""
    _, columns = _curve_session()
    starts = [int(round(c["start"])) for c in columns]

    for axis in (601, 652, 839):
        assert any(abs(start - axis) <= 2 for start in starts), (axis, starts)

    ends = {int(round(c["start"])): int(round(c["end"])) for c in columns}
    for axis, nxt in ((601, 652), (652, 691), (839, 896)):
        owner = min(ends, key=lambda s: abs(s - axis))
        assert ends[owner] <= nxt + 1, (axis, ends[owner])


@pytest.mark.skipif(
    not (os.path.exists(CURVE_IMAGE) and os.path.exists(POLLEN_GOLDEN)),
    reason="benchmark figure or golden values missing",
)
def test_curve_style_three_columns_within_five_percent_points():
    """P-01 acceptance, values: Empetrum / Gramineae / Ononis-type MAE <= 5.00
    (measured 34.05 / 34.71 / 21.09 before the fix, 1.18 / 1.17 / 2.72 after)."""
    session, columns = _curve_session()
    golden = json.load(open(POLLEN_GOLDEN, encoding="utf-8"))
    taxa = golden["taxa"]
    depths = [float(d) for d in golden["depth_cm"]]

    targets = {9: 5.00, 10: 5.00, 16: 5.00}  # Empetrum, Gramineae, Ononis-type
    measured = {}
    for index, limit in targets.items():
        column = min(range(len(columns)),
                     key=lambda k: abs(columns[k]["start"] - SPINES[index]))
        session.calibrate_column_xticks(
            column,
            ticks=[{"px": SPINES[index], "value": 0.0},
                   {"px": SPINES[index + 1], "value": _axis_max(taxa[index])}],
        )
        read = {int(p["row"]): float(p["x"])
                for p in session.digitize(column, "area")["points"]}
        errors = []
        for depth, truth in zip(depths, taxa[index]["values"]):
            if truth is None:
                continue
            row = _row_for_depth(depth)
            if row not in read:
                continue
            value = ((read[row] - SPINES[index])
                     / (SPINES[index + 1] - SPINES[index])
                     * _axis_max(taxa[index]))
            errors.append(abs(value - float(truth)))
        measured[taxa[index]["name"]] = float(np.mean(errors))
        assert measured[taxa[index]["name"]] <= limit, measured


# --- P-02: the panel's own Y axis is not data --------------------------------

def test_panel_axis_stroke_is_not_read_as_the_curve():
    """A 1-px axis that spans the band must be ignored; the row's only data ink
    is the curve at offsets 40..43, so the reading is 44 (= 43 + 1 px width)."""
    band = np.zeros((100, 60), dtype=bool)
    band[:, 0] = True          # axis: 100/100 rows
    band[50, 40:44] = True     # the row's only data ink

    profile = trace_area_profile(band)

    assert profile[50] == 44.0
    # Rows holding nothing but the axis keep their legacy 1-px reading.
    assert np.all(profile[[0, 25, 99]] == 1.0)


@pytest.mark.skipif(not os.path.exists(CURVE_IMAGE), reason="benchmark figure missing")
def test_empetrum_row_502_is_read_off_the_axis():
    """P-02 acceptance: with Empetrum's true panel bounds (544..601) row 502 — whose
    only curve ink is at 586..589 — must read inside [586, 590], not 544."""
    session, columns = _curve_session()
    column = next(k for k, c in enumerate(columns) if abs(c["start"] - 544) <= 2)
    session.columns[column]["start"] = 544.0
    session.columns[column]["end"] = 601.0

    read = {int(p["row"]): float(p["x"])
            for p in session.digitize(column, "area")["points"]}

    assert 586.0 <= read[502] <= 590.0, read[502]


@pytest.mark.skipif(
    not (os.path.exists(CURVE_IMAGE) and os.path.exists(POLLEN_GOLDEN)),
    reason="benchmark figure or golden values missing",
)
def test_empetrum_true_bounds_within_two_and_a_half_percent_points():
    """P-02 acceptance, values: Empetrum MAE <= 2.50 with its true panel bounds
    (measured 4.42 before the fix, 1.18 after)."""
    session, columns = _curve_session()
    golden = json.load(open(POLLEN_GOLDEN, encoding="utf-8"))
    taxes = golden["taxa"]
    depths = [float(d) for d in golden["depth_cm"]]

    index = 9  # Empetrum
    column = next(k for k, c in enumerate(columns)
                  if abs(c["start"] - SPINES[index]) <= 2)
    session.columns[column]["start"] = float(SPINES[index])
    session.columns[column]["end"] = float(SPINES[index + 1])
    session.calibrate_column_xticks(
        column,
        ticks=[{"px": SPINES[index], "value": 0.0},
               {"px": SPINES[index + 1], "value": _axis_max(taxes[index])}],
    )
    read = {int(p["row"]): float(p["x"])
            for p in session.digitize(column, "area")["points"]}

    errors = []
    for depth, truth in zip(depths, taxes[index]["values"]):
        if truth is None:
            continue
        row = _row_for_depth(depth)
        if row not in read:
            continue
        value = ((read[row] - SPINES[index])
                 / (SPINES[index + 1] - SPINES[index])
                 * _axis_max(taxes[index]))
        errors.append(abs(value - float(truth)))

    assert float(np.mean(errors)) <= 2.50, float(np.mean(errors))
