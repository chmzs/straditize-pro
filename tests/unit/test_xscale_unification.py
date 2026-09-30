"""P0 unit tests for unified column X-scale resolution (`resolve_column_scale`).

Covers:
1. Priority order (`x_ticks` > legacy > `x_scales` > default) and `calibrated`/`source` flags;
2. Tuple unpacking contract per `docs/plans/2026-09-29-column-groups-design.md` §3.3;
3. Exaggeration multiplier unification (`exaggeration_mult` vs `has_exaggeration` + `exaggeration_multiplier`);
4. Highest-value invariant: identical numerical values across CSV, Parquet, XLSX, and LiPD exports
   for the same column and same calibration (linear, exaggerated, and logarithmic columns);
5. Step 7 `extract_grid_values`, Step 8 `qa_summarize`, and `getDiagramData` column payload
   all respect Step 6 `x_ticks` calibration via `resolve_column_scale`.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any
import openpyxl
import pandas as pd
from PIL import Image
import pytest

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import ColumnScale, resolve_column_scale


def test_resolve_column_scale_prefers_x_ticks_over_legacy() -> None:
    """When both x_ticks and legacy fields exist, x_ticks wins and calibrated=True."""
    col = {
        "col_index": 0,
        "startX": 100.0,
        "endX": 200.0,
        "x_ticks": [{"px": 110.0, "value": 5.0}, {"px": 190.0, "value": 45.0}],
        "startValue": 0.0,
        "tickValue": 999.0,
        "tickEndX": 200.0,
        "unit": "粒",
        "plot_type": "bar",
        "scale_type": "linear",
        "exaggeration_mult": 5.0,
    }
    scale = resolve_column_scale(None, col)
    assert isinstance(scale, ColumnScale)
    assert scale.calibrated is True
    assert scale.source == "x_ticks"
    assert (scale.abs_px0, scale.val0, scale.abs_px1, scale.val1) == (
        110.0,
        5.0,
        190.0,
        45.0,
    )
    assert scale.unit == "粒"
    assert scale.plot_type == "bar"
    assert scale.scale_type == "linear"
    assert scale.exaggeration_mult == 5.0
    assert scale.declared_max == 45.0

    # Tuple unpacking per design §3.3
    (
        abs_px0,
        val0,
        abs_px1,
        val1,
        unit,
        plot_type,
        scale_type,
        exag,
        calibrated,
        source,
    ) = scale
    assert (abs_px0, val0, abs_px1, val1) == (110.0, 5.0, 190.0, 45.0)
    assert (unit, plot_type, scale_type, exag, calibrated, source) == (
        "粒",
        "bar",
        "linear",
        5.0,
        True,
        "x_ticks",
    )


def test_resolve_column_scale_legacy_fallback_marks_uncalibrated() -> None:
    """Without x_ticks, legacy fields are used as fallback and calibrated=False."""
    col = {
        "col_index": 0,
        "start": 100.0,
        "end": 300.0,
        "startValue": 0.0,
        "tickValue": 50.0,
        "tickEndX": 300.0,
        "has_exaggeration": True,
        "exaggeration_multiplier": 4.0,
    }
    scale = resolve_column_scale(None, col)
    assert scale.calibrated is False
    assert scale.source == "legacy"
    assert (scale.abs_px0, scale.val0, scale.abs_px1, scale.val1) == (
        100.0,
        0.0,
        300.0,
        50.0,
    )
    assert scale.exaggeration_mult == 4.0
    assert scale.declared_max == 0.0
    # At x=200 (midpoint of 100..300), raw linear value is 25.0; divided by 4x exaggeration -> 6.25
    assert scale.px_to_value(200.0, baseline_px=100.0) == 6.25


def test_four_export_formats_and_grid_and_qa_produce_identical_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Highest-value invariant (Design §7 P0 & §8):

    For the same column and same calibration, CSV, Parquet, XLSX, LiPD (and TAR) exports
    MUST produce strictly equal numerical values — and Step 7 (`extract_grid_values`)
    plus Step 8 (`qa_summarize`) must agree on the exact same numbers.
    """
    session = StraditizeSession()
    roi = session.roi_create(name="pollen", composition=True)["roi"]
    roi_id = roi["id"]

    # Configure 3 columns with distinct non-default calibrations so any fallback to
    # legacy 0..100% or ignored exaggeration_mult immediately breaks equality:
    # - Col 0 (Pinus): x_ticks 0 -> 40% (while legacy tickValue is polluted with 100)
    # - Col 1 (Betula): x_ticks 0 -> 20% with 5x exaggeration_mult
    # - Col 2 (Charcoal): log scale x_ticks 1 -> 100 over 500..700 px
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col01",
            "name": "Pinus",
            "species": "Pinus",
            "roi_id": roi_id,
            "start": 100.0,
            "end": 200.0,
            "startX": 100.0,
            "endX": 200.0,
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 40.0}],
            "startValue": 0.0,
            "tickValue": 100.0,  # Legacy seed that previously caused CSV != XLSX
            "tickEndX": 200.0,
            "scale_type": "linear",
        },
        {
            "col_index": 1,
            "id": "roi_1_col02",
            "name": "Betula",
            "species": "Betula",
            "roi_id": roi_id,
            "start": 300.0,
            "end": 400.0,
            "startX": 300.0,
            "endX": 400.0,
            "x_ticks": [{"px": 300.0, "value": 0.0}, {"px": 400.0, "value": 20.0}],
            "startValue": 0.0,
            "tickValue": 100.0,
            "tickEndX": 400.0,
            "scale_type": "linear",
            "exaggeration_mult": 5.0,
        },
        {
            "col_index": 2,
            "id": "roi_1_col03",
            "name": "Charcoal",
            "species": "Charcoal",
            "roi_id": roi_id,
            "start": 500.0,
            "end": 700.0,
            "startX": 500.0,
            "endX": 700.0,
            "x_ticks": [{"px": 500.0, "value": 1.0}, {"px": 700.0, "value": 100.0}],
            "startValue": 1.0,
            "tickValue": 1000.0,  # Legacy seed differs from x_ticks
            "tickEndX": 700.0,
            "scale_type": "log",
        },
    ]
    session.taxa_names = ["Pinus", "Betula", "Charcoal"]

    # Y-axis calibration: row 50 -> 10.0 cm, row 100 -> 20.0 cm
    session.is_calibrated = True
    session.y_scale = {"slope": 0.2, "intercept": 0.0}
    session.samples = [
        {"row_px": 50, "depth": 10.0, "source": "manual"},
        {"row_px": 100, "depth": 20.0, "source": "manual"},
    ]

    # Row 50:
    #   Pinus x=150 -> 20.0% (NOT 50.0%!)
    #   Betula x=350 -> 10.0% raw / 5x = 2.0%
    #   Charcoal x=600 -> 10.0 (midpoint of log 1..100, NOT 31.6228 from legacy 1..1000!)
    # Row 100:
    #   Pinus x=175 -> 30.0%
    #   Betula x=300 (baseline) -> 0.0%
    #   Charcoal x=700 -> 100.0
    session.column_points = {
        0: [{"row": 50, "x": 150.0}, {"row": 100, "x": 175.0}],
        1: [{"row": 50, "x": 350.0}, {"row": 100, "x": 300.0}],
        2: [{"row": 50, "x": 600.0}, {"row": 100, "x": 700.0}],
    }

    expected = {
        "depth": [10.0, 20.0],
        "Pinus": [20.0, 30.0],
        "Betula": [2.0, 0.0],
        "Charcoal": [10.0, 100.0],
    }

    # 1. CSV export (`export_data("csv")`)
    csv_res = session.export_data(format="csv")
    df_csv = pd.read_csv(io.StringIO(csv_res["csv"]))

    # 2. Parquet export (`export_data("parquet")`)
    parquet_path = tmp_path / "out.parquet"
    captured_parquet_dfs: list[pd.DataFrame] = []

    def _capture_to_parquet(self_df: pd.DataFrame, path: Any, index: bool = False, **kwargs: Any) -> None:
        captured_parquet_dfs.append(self_df.copy())
        Path(path).write_bytes(b"PAR1")

    monkeypatch.setattr(pd.DataFrame, "to_parquet", _capture_to_parquet)
    parquet_res = session.export_data(format="parquet", output_path=str(parquet_path))
    assert parquet_res["format"] == "parquet"
    assert len(captured_parquet_dfs) == 1
    df_parquet = captured_parquet_dfs[0]

    # 3. XLSX export (`export_multi_xlsx`)
    xlsx_res = session.export_multi_xlsx(include_meta_sheets=False, include_readme=False)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_res["data"]))
    ws = wb["pollen"]
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h) for h in rows[0]]
    df_xlsx = pd.DataFrame(list(rows[1:]), columns=headers)

    # 4. LiPD export (`export_multi_lipd`)
    lipd_res = session.export_multi_lipd()
    table = lipd_res["lipd"]["paleoData"][0]["paleoMeasurementTable"][0]
    lipd_cols = {col["variableName"]: col["values"] for col in table["columns"]}
    df_lipd = pd.DataFrame(lipd_cols)[["depth", "Pinus", "Betula", "Charcoal"]]

    for col_name, exp_vals in expected.items():
        assert df_csv[col_name].tolist() == pytest.approx(exp_vals), f"CSV mismatch on {col_name}"
        assert df_parquet[col_name].tolist() == pytest.approx(exp_vals), f"Parquet mismatch on {col_name}"
        assert df_xlsx[col_name].tolist() == pytest.approx(exp_vals), f"XLSX mismatch on {col_name}"
        assert df_lipd[col_name].tolist() == pytest.approx(exp_vals), f"LiPD mismatch on {col_name}"

    # 5. Step 7 (`extract_grid_values`) at depths [10.0, 20.0]
    grid_res = session.extract_grid_values(depths=[10.0, 20.0])
    assert grid_res["matrix"] == [
        [20.0, 2.0, 10.0],
        [30.0, 0.0, 100.0],
    ]

    # 6. Step 8 (`qa_summarize`)
    qa_res = session.qa_summarize(roi_id=roi_id)
    peaks = {c["name"]: c["peak"] for c in qa_res["per_column_max"]}
    declared = {c["name"]: c["declared_max"] for c in qa_res["per_column_max"]}
    assert peaks == {"Pinus": 30.0, "Betula": 2.0, "Charcoal": 100.0}
    assert declared == {"Pinus": 40.0, "Betula": 20.0, "Charcoal": 100.0}


def test_diagram_payload_projects_scale_from_resolve_column_scale() -> None:
    """Site 5 (`rpc_methods/system.py`): `getDiagramData` derives scale fields from `resolve_column_scale`."""
    session = StraditizeSession()
    session.image = Image.new("L", (300, 300), 255)
    session.width, session.height = 300, 300
    session.column_points = {0: [{"row": 10, "x": 150.0}]}
    session.columns = [
        {
            "col_index": 0,
            "id": "roi_1_col01",
            "name": "Pinus",
            "species": "Pinus",
            "start": 100.0,
            "end": 200.0,
            "startX": 100.0,
            "endX": 200.0,
            "x_ticks": [{"px": 110.0, "value": 0.0}, {"px": 190.0, "value": 40.0}],
            "unit": "粒/cm³",
            "plot_type": "bar",
            "scale_type": "linear",
            "exaggeration_mult": 5.0,
            "roi_id": "roi_1",
        }
    ]
    session.taxa_names = ["Pinus"]
    session.control_points = {0: {}}

    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    col_payload = dispatcher._methods["straditize.getDiagramData"]()["columns"][0]

    assert col_payload["unit"] == "粒/cm³"
    assert col_payload["plot_type"] == "bar"
    assert col_payload["plotType"] == "bar"
    assert col_payload["exaggeration_mult"] == 5.0
    assert col_payload["hasExaggeration"] is True
    assert col_payload["exaggerationMult"] == 5.0
    assert col_payload["startValue"] == 0.0
    assert col_payload["tickValue"] == 40.0
    assert col_payload["tickEndX"] == 190.0
    assert col_payload["scaleCalib"] == {
        "originX": 110.0,
        "originVal": 0.0,
        "calibX": 190.0,
        "calibVal": 40.0,
        "unit": "粒/cm³",
    }
