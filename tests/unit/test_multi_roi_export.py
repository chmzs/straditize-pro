"""Unit tests and invariants verification for multi-ROI chunked exports (T10).

Strictly verifies the 5 criteria from Ticket T10:
1. Two ROIs -> XLSX sheet names set strictly equals ROI names set (openpyxl read-back);
2. LiPD tableName set strictly equals ROI names set;
3. .tar contains data/<roi>.csv and data.csv matches primary_roi_id (switching primary changes data.csv content);
4. Each CSV's column headers do NOT contain ROI prefixes;
5. Chinese ROI names (e.g. '花粉') produce correct sheet names and filenames.
Plus L3 check on real Hoya three-ROI export.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path
import tarfile
import openpyxl
import pytest

from straditize_core.session import StraditizeSession

HOYA_PATH = Path(
    "straditize_core/assets/tutorials/hoya-del-castillo.png"
)


def _setup_two_rois_session() -> StraditizeSession:
    session = StraditizeSession()
    r1 = session.roi_create(name="pollen", composition=True)["roi"]
    r2 = session.roi_create(name="charcoal", composition=False)["roi"]

    # Column for pollen: Pinus (values around 80)
    col1 = {
        "col_index": 0,
        "name": "Pinus",
        "roi_id": r1["id"],
        "start": 100.0,
        "end": 200.0,
        "startX": 100.0,
        "endX": 200.0,
        "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 100.0}],
    }
    # Column for charcoal: MicroCharcoal (values around 500)
    col2 = {
        "col_index": 1,
        "name": "MicroCharcoal",
        "roi_id": r2["id"],
        "start": 300.0,
        "end": 400.0,
        "startX": 300.0,
        "endX": 400.0,
        "x_ticks": [{"px": 300.0, "value": 0.0}, {"px": 400.0, "value": 1000.0}],
    }
    session.columns = [col1, col2]

    # Two sample horizons
    session.samples = [
        {"row_px": 50, "depth": 10.0, "source": "manual"},
        {"row_px": 100, "depth": 20.0, "source": "manual"},
    ]
    # Points: Pinus has x=180 (val 80), Charcoal has x=350 (val 500)
    session.column_points = {
        0: [{"row": 50, "x": 180.0}, {"row": 100, "x": 180.0}],
        1: [{"row": 50, "x": 350.0}, {"row": 100, "x": 350.0}],
    }
    return session


def test_criterion_1_two_rois_xlsx_sheet_names():
    """Criterion 1: Two ROIs -> XLSX sheet names set strictly equals ROI names set (openpyxl read-back)."""
    session = _setup_two_rois_session()
    res = session.export_multi_xlsx(include_meta_sheets=False)
    assert res["success"] is True

    # Read back bytes via openpyxl
    xlsx_bytes = session.export_multi_xlsx(include_meta_sheets=False)
    # Get raw bytes from helper
    dfs = session.get_roi_dataframes()
    from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx

    bio_bytes = export_scientific_xlsx(roi_dfs=dfs, include_meta_sheets=False)

    wb = openpyxl.load_workbook(io.BytesIO(bio_bytes))
    sheet_names_set = set(wb.sheetnames)

    assert sheet_names_set == {"pollen", "charcoal"}


def test_criterion_2_two_rois_lipd_table_names():
    """Criterion 2: LiPD tableName set strictly equals ROI names set."""
    session = _setup_two_rois_session()
    lipd_res = session.export_multi_lipd()
    assert lipd_res["success"] is True

    lipd_obj = lipd_res["lipd"]
    meas_tables = lipd_obj.get("paleoData", [{}])[0].get("paleoMeasurementTable", [])
    table_names = {t["tableName"] for t in meas_tables}

    assert table_names == {"pollen", "charcoal"}


def test_criterion_3_tar_archive_and_primary_roi_switch():
    """Criterion 3: .tar contains data/<roi>.csv and data.csv matches primary_roi_id;

    switching primary ROI dynamically updates data.csv content.
    """
    session = _setup_two_rois_session()
    r1_id = session.rois[0]["id"]
    r2_id = session.rois[1]["id"]

    # 1. Primary ROI is pollen (r1)
    session.roi_set_primary(r1_id)
    tar_res1 = session.export_multi_tar()
    assert tar_res1["success"] is True

    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(tar_res1["data"]))) as tf:
        names = tf.getnames()
        assert "data/pollen.csv" in names
        assert "data/charcoal.csv" in names
        assert "data.csv" in names

        data_csv_1 = tf.extractfile("data.csv").read()
        pollen_csv_1 = tf.extractfile("data/pollen.csv").read()
        charcoal_csv_1 = tf.extractfile("data/charcoal.csv").read()

        # Content of data.csv MUST strictly equal primary_roi (pollen)
        assert data_csv_1 == pollen_csv_1
        assert data_csv_1 != charcoal_csv_1

    # 2. Switch Primary ROI to charcoal (r2)
    session.roi_set_primary(r2_id)
    tar_res2 = session.export_multi_tar()

    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(tar_res2["data"]))) as tf:
        data_csv_2 = tf.extractfile("data.csv").read()
        charcoal_csv_2 = tf.extractfile("data/charcoal.csv").read()

        # Content of data.csv MUST dynamically switch to charcoal!
        assert data_csv_2 == charcoal_csv_2
        assert data_csv_2 != pollen_csv_1


def test_criterion_4_column_names_no_roi_prefix():
    """Criterion 4: Each CSV's column headers do NOT contain ROI prefixes."""
    session = _setup_two_rois_session()
    dfs = session.get_roi_dataframes()

    pollen_cols = list(dfs["pollen"].columns)
    charcoal_cols = list(dfs["charcoal"].columns)

    # Must be ['depth', 'Pinus'] - NOT ['depth', 'pollen_Pinus'] or ['depth', 'r1_Pinus']
    assert pollen_cols == ["depth", "Pinus"]
    assert charcoal_cols == ["depth", "MicroCharcoal"]


def test_criterion_5_chinese_roi_name():
    """Criterion 5: Chinese ROI names (e.g. '花粉') produce correct sheet names and filenames."""
    session = StraditizeSession()
    r_cn = session.roi_create(name="花粉", composition=True)["roi"]
    col_cn = {
        "col_index": 0,
        "name": "松属",
        "roi_id": r_cn["id"],
        "start": 100.0,
        "end": 200.0,
        "startX": 100.0,
        "endX": 200.0,
        "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 100.0}],
    }
    session.columns = [col_cn]
    session.samples = [{"row_px": 50, "depth": 10.0, "source": "manual"}]
    session.column_points = {0: [{"row": 50, "x": 150.0}]}

    # 1. XLSX Sheet Name check
    dfs = session.get_roi_dataframes()
    from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx

    bio_bytes = export_scientific_xlsx(roi_dfs=dfs, include_meta_sheets=False)
    wb = openpyxl.load_workbook(io.BytesIO(bio_bytes))
    assert "花粉" in wb.sheetnames

    # 2. TAR Filename check
    tar_res = session.export_multi_tar()
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(tar_res["data"]))) as tf:
        names = tf.getnames()
        assert "data/花粉.csv" in names


def test_l3_three_rois_reporting():
    """L3 check: three-ROI export on Hoya, reporting sheet names, LiPD tableNames, and data/ files."""
    assert HOYA_PATH.exists()
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))

    session.rois.clear()
    session.columns.clear()

    r1 = session.roi_create(name="charcoal", x0=315, x1=460, y0=511, y1=1311)["roi"]
    r2 = session.roi_create(name="main_pollen", x0=460, x1=1250, y0=511, y1=1311)["roi"]
    r3 = session.roi_create(name="minor_taxa", x0=1250, x1=1946, y0=511, y1=1311)["roi"]

    session.detect_columns(roi_id=r1["id"])
    session.detect_columns(roi_id=r2["id"])
    session.detect_columns(roi_id=r3["id"])

    # 1. XLSX Sheets
    dfs = session.get_roi_dataframes()
    from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx

    bio_bytes = export_scientific_xlsx(roi_dfs=dfs, include_meta_sheets=False)
    wb = openpyxl.load_workbook(io.BytesIO(bio_bytes))
    sheets_list = wb.sheetnames

    # 2. LiPD Table Names
    lipd_res = session.export_multi_lipd()
    tables = lipd_res["lipd"]["paleoData"][0]["paleoMeasurementTable"]
    lipd_table_names = [t["tableName"] for t in tables]

    # 3. TAR Data files
    tar_res = session.export_multi_tar()
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(tar_res["data"]))) as tf:
        data_files = [n for n in tf.getnames() if n.startswith("data/")]

    print(f"\n[L3 Three ROIs Report]")
    print(f"SHEETS={sheets_list}")
    print(f"LIPD_TABLES={lipd_table_names}")
    print(f"DATA_FILES={data_files}")

    assert set(sheets_list) == {"charcoal", "main_pollen", "minor_taxa"}
    assert set(lipd_table_names) == {"charcoal", "main_pollen", "minor_taxa"}
    assert "data/charcoal.csv" in data_files
    assert "data/main_pollen.csv" in data_files
    assert "data/minor_taxa.csv" in data_files
