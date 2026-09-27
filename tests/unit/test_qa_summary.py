"""Unit tests and invariants verification for QaSummary and geological diagnostics (T09).

Strictly verifies the 5 criteria from Ticket T09 and Frozen Contract v1.3 §2.7:
1. Horizons Σ = [96, 103.5, 0] -> violations_over has exactly 103.5; empty_horizons has exactly 0;
2. composition=False and value 48000 -> violations_over empty, sum faithfully returned;
3. Column peak 108 > declared_max 100 (derived from x_ticks) -> over=True;
   and verifies that declared_max does NOT depend on any stored fields;
4. Empty ROI -> complete structure, 0 counts, no exceptions and no fabrications;
5. tolerance: 101.0 / 2.0 does not violate, 101.0 / 0.5 violates.
Plus L3 check on real Hoya figure.
"""

from __future__ import annotations

from pathlib import Path
import pytest

from straditize_core.session import StraditizeSession

HOYA_PATH = Path(
    "straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png"
)


def test_qa_criterion_1_composition_gate_and_empty_horizons():
    """Criterion 1: Horizons Σ = [96, 103.5, 0] -> violations_over has 103.5; empty_horizons has 0."""
    session = StraditizeSession()
    roi_res = session.roi_create(name="pollen", composition=True)
    roi_id = roi_res["roi"]["id"]

    # 1 column with x_ticks [0, 100]
    session.columns = [
        {
            "col_index": 0,
            "name": "TaxaA",
            "roi_id": roi_id,
            "startX": 100.0,
            "endX": 200.0,
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 100.0}],
            "scale_type": "linear",
        }
    ]
    # Points corresponding to 96, 103.5, 0
    # In pixels: startX = 100. 96% -> 196px; 103.5% -> 203.5px; 0% -> 100px (baseline)
    session.column_points = {
        0: [
            {"row": 10, "x": 196.0},
            {"row": 20, "x": 203.5},
            {"row": 30, "x": 100.0},
        ]
    }
    # Samples with explicit depths (including depth 0.0 for the zero horizon)
    session.samples = [
        {"row_px": 10, "depth": 10.0, "source": "manual"},
        {"row_px": 20, "depth": 20.0, "source": "manual"},
        {"row_px": 30, "depth": 0.0, "source": "manual"},
    ]

    summary = session.qa_summarize(roi_id=roi_id, tolerance=2.0)

    # 1. Total counts
    assert summary["n_horizons"] == 3
    assert summary["n_horizons_with_data"] == 2
    assert summary["n_horizons_empty"] == 1

    # 2. violations_over contains exactly the 103.5 sum
    assert len(summary["violations_over"]) == 1
    assert summary["violations_over"][0]["sum"] == 103.5
    assert summary["violations_over"][0]["depth"] == 20.0

    # 3. empty_horizons contains exactly the 0 depth horizon
    assert len(summary["empty_horizons"]) == 1
    assert summary["empty_horizons"][0]["depth"] == 0.0
    assert summary["empty_horizons"][0]["reason"] == "no ink read"

    # 4. sum stats include all-zero horizon
    assert summary["sum"]["min"] == 0.0
    assert summary["sum"]["max"] == 103.5


def test_qa_criterion_2_non_composition():
    """Criterion 2: composition=False and value 48000 -> violations_over empty, sum faithfully returned."""
    session = StraditizeSession()
    roi_res = session.roi_create(name="concentration", composition=False)
    roi_id = roi_res["roi"]["id"]

    session.columns = [
        {
            "col_index": 0,
            "name": "PollenGrains",
            "roi_id": roi_id,
            "startX": 100.0,
            "endX": 200.0,
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 50000.0}],
            "scale_type": "linear",
        }
    ]
    # x for 48000: 100 + (48000/50000)*100 = 196.0
    session.column_points = {
        0: [
            {"row": 15, "x": 196.0},
        ]
    }
    session.samples = [
        {"row_px": 15, "depth": 15.0, "source": "manual"},
    ]

    summary = session.qa_summarize(roi_id=roi_id, tolerance=2.0)

    assert summary["composition"] is False
    assert len(summary["violations_over"]) == 0
    assert summary["sum"]["max"] == 48000.0


def test_qa_criterion_3_declared_max_strictly_from_x_ticks():
    """Criterion 3: Column peak 108 > declared_max 100 (from x_ticks) -> over=True;

    And asserts that declared_max does NOT depend on any stored fields.
    """
    session = StraditizeSession()
    roi_res = session.roi_create(name="pollen", composition=True)
    roi_id = roi_res["roi"]["id"]

    # Deliberately pollute column with stored/historical fields that must be ignored
    col = {
        "col_index": 0,
        "name": "Pinus",
        "roi_id": roi_id,
        "startX": 100.0,
        "endX": 200.0,
        "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 100.0}],
        "tickValue": 999.0,  # Obsolete field - MUST be ignored
        "declared_max": 888.0,  # Stored field - MUST be ignored
        "scale_type": "linear",
    }
    session.columns = [col]

    # Peak value 108%: x = 100 + 1.08 * 100 = 208.0
    session.column_points = {
        0: [
            {"row": 50, "x": 208.0},
        ]
    }
    session.samples = [
        {"row_px": 50, "depth": 50.0, "source": "manual"},
    ]

    summary1 = session.qa_summarize(roi_id=roi_id)
    assert len(summary1["per_column_max"]) == 1
    c_res1 = summary1["per_column_max"][0]
    assert c_res1["name"] == "Pinus"
    assert c_res1["declared_max"] == 100.0  # Derived from x_ticks, NOT 999 or 888!
    assert c_res1["peak"] == 108.0
    assert c_res1["over"] is True

    # Mutate x_ticks to span 200px with value 200 -> peak remains 108.0, declared_max becomes 200.0 and over becomes False
    col["x_ticks"] = [{"px": 100.0, "value": 0.0}, {"px": 300.0, "value": 200.0}]

    summary2 = session.qa_summarize(roi_id=roi_id)
    c_res2 = summary2["per_column_max"][0]
    assert c_res2["declared_max"] == 200.0
    assert c_res2["peak"] == 108.0
    assert c_res2["over"] is False


def test_qa_criterion_4_empty_roi():
    """Criterion 4: Empty ROI -> complete structure, 0 counts, no exceptions, no fabrications."""
    session = StraditizeSession()
    roi_res = session.roi_create(name="empty_zone", composition=True)
    roi_id = roi_res["roi"]["id"]

    summary = session.qa_summarize(roi_id=roi_id)

    assert summary["roi_id"] == roi_id
    assert summary["roi_name"] == "empty_zone"
    assert summary["composition"] is True
    assert summary["n_horizons"] == 0
    assert summary["n_horizons_with_data"] == 0
    assert summary["n_horizons_empty"] == 0
    assert summary["empty_horizons"] == []
    assert summary["violations_over"] == []
    assert summary["per_column_max"] == []
    assert summary["sum"] == {"min": 0.0, "p50": 0.0, "max": 0.0, "mean": 0.0}
    assert summary["shortfall"] == {"min": 0.0, "max": 0.0, "mean": 0.0}


def test_qa_criterion_5_tolerance():
    """Criterion 5: tolerance: 101.0 / 2.0 does not violate, 101.0 / 0.5 violates."""
    session = StraditizeSession()
    roi_res = session.roi_create(name="pollen", composition=True)
    roi_id = roi_res["roi"]["id"]

    session.columns = [
        {
            "col_index": 0,
            "name": "Taxa1",
            "roi_id": roi_id,
            "startX": 0.0,
            "endX": 100.0,
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
            "scale_type": "linear",
        }
    ]
    # Sum = 101.0
    session.column_points = {
        0: [{"row": 10, "x": 101.0}],
    }
    session.samples = [
        {"row_px": 10, "depth": 5.0, "source": "manual"},
    ]

    # tolerance = 2.0 -> threshold 102.0 -> 101.0 not a violation
    res_tol2 = session.qa_summarize(roi_id=roi_id, tolerance=2.0)
    assert len(res_tol2["violations_over"]) == 0

    # tolerance = 0.5 -> threshold 100.5 -> 101.0 violates
    res_tol05 = session.qa_summarize(roi_id=roi_id, tolerance=0.5)
    assert len(res_tol05["violations_over"]) == 1
    assert res_tol05["violations_over"][0]["sum"] == 101.0


def test_qa_l3_hoya_pollen_roi():
    """L3 check: runs on real Hoya figure pollen ROI and reports QA metrics."""
    assert HOYA_PATH.exists()
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))

    # Detect columns on Hoya pollen ROI
    session.roi_create(name="pollen", x0=315, x1=1946, y0=511, y1=1311)
    session.detect_columns([315, 1946], [511, 1311], roi_id="roi_1")

    # Digitize columns so turning points and data exist
    for col in session.columns[:8]:
        session.digitize(col["col_index"])

    # Extract consensus turning points for horizons
    session.samples_extract_consensus(tolerance_px=3.0, min_taxa_support=1)

    summary = session.qa_summarize(roi_id="roi_1", tolerance=2.0)

    # Print L3 grammar
    print(f"\nN_HORIZONS={summary['n_horizons']}")
    print(f"SUM_MIN={summary['sum']['min']}")
    print(f"SUM_MAX={summary['sum']['max']}")
    print(f"SHORTFALL_MEAN={summary['shortfall']['mean']}")
    print(f"N_EMPTY={summary['n_horizons_empty']}")

    assert summary["n_horizons"] > 0
    assert summary["sum"]["max"] > 0.0
