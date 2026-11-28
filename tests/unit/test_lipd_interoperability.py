# -*- coding: utf-8 -*-
"""Regression tests for #189 (LiPD v1.3 interoperability) and metadata alignment."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from unittest.mock import patch

import pandas as pd

from straditize_core.metadata.exporter_lipd import (
    export_lipd_jsonld,
    normalize_lipd_archive_type,
    package_lipd_archive,
)
from straditize_core.session import StraditizeSession


def test_archive_type_normalization() -> None:
    assert normalize_lipd_archive_type("lake sediment") == "LakeSediment"
    assert normalize_lipd_archive_type("peat bog") == "Peat"
    assert normalize_lipd_archive_type("marine sediment") == "MarineSediment"
    assert normalize_lipd_archive_type("loess") == "TerrestrialSediment"
    assert normalize_lipd_archive_type("LakeSediment") == "LakeSediment"
    assert normalize_lipd_archive_type("") == "LakeSediment"


def test_geo_geometry_and_age_axis_columns() -> None:
    meta = {
        "publication": {"title": "Test", "authors": ["A. Author"], "year": 2025},
        "site": {
            "site_name": "Gahai",
            "latitude": "37.1333",
            "longitude": "97.5167",
            "elevation_m": "2848",
            "archive_type": "lake sediment",
        },
        "chronology": {
            "age_model": "Bacon",
            "dating_method": "AMS 14C",
            "cal_curve": "IntCal20",
            "dating_counts": "AMS 14C: 12 (plant macrofossils); 210Pb: 18",
            "total_dates": "30",
            "reservoir_correction": "450 yr",
        },
    }
    pollen_df = pd.DataFrame({"Age (cal yr BP)": [0.0, 500.0], "Pinus": [20.0, 35.0]})
    age_depth_df = pd.DataFrame({"depth": [0.0, 10.0], "age": [0.0, 500.0]})

    lipd = export_lipd_jsonld(
        meta_info=meta,
        pollen_df=pollen_df,
        age_depth_df=age_depth_df,
        depth_unit="cal yrBP",
    )

    assert lipd["archiveType"] == "LakeSediment"
    assert lipd["geo"]["geometry"] == {
        "type": "Point",
        "coordinates": [97.5167, 37.1333, 2848.0],
    }

    paleo_cols = {
        c["variableName"]: c for c in lipd["paleoData"][0]["paleoMeasurementTable"][0]["columns"]
    }
    age_col = paleo_cols["Age (cal yr BP)"]
    assert age_col["variableType"] == "chronology"
    assert age_col["units"] == "cal yrBP"
    assert age_col["proxy"] is None

    chron_cols = {
        c["variableName"]: c for c in lipd["chronData"][0]["chronMeasurementTable"][0]["columns"]
    }
    assert chron_cols["age"]["units"] == "cal yrBP"

    chron_meta = lipd["chronData"][0]["chronologyMetadata"]
    assert chron_meta["datingCounts"] == "AMS 14C: 12 (plant macrofossils); 210Pb: 18"
    assert chron_meta["totalDates"] == "30"
    assert chron_meta["reservoirCorrection"] == "450 yr"


def test_bad_geo_omits_invalid_geometry() -> None:
    lipd = export_lipd_jsonld(
        meta_info={"site": {"site_name": "X", "latitude": "bad", "longitude": ""}}
    )
    assert "geometry" not in lipd["geo"]


def test_bagit_package_checksums_and_layout() -> None:
    meta = {
        "publication": {"title": "Bag Test", "authors": ["Jane Doe"], "year": 2024},
        "site": {"site_name": "BagLake", "latitude": 30.0, "longitude": 90.0},
    }
    pollen_df = pd.DataFrame({"Depth (cm)": [0.0, 10.0], "Picea": [10.0, 20.0]})
    age_depth_df = pd.DataFrame({"depth": [0.0, 10.0], "age": [0.0, 400.0]})
    lipd = export_lipd_jsonld(
        meta_info=meta, pollen_df=pollen_df, age_depth_df=age_depth_df
    )
    raw = package_lipd_archive(lipd)

    with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
        names = set(zf.namelist())
        assert "bagit.txt" in names
        assert "manifest-md5.txt" in names
        assert "tagmanifest-md5.txt" in names
        assert any(n.startswith("data/") and n.endswith(".jsonld") for n in names)
        assert "data/pollen_data.csv" in names
        assert "data/chron_model.csv" in names

        manifest_text = zf.read("manifest-md5.txt").decode("utf-8").strip().splitlines()
        manifest_entries = {}
        for line in manifest_text:
            digest, rel_path = line.split("  ", 1)
            manifest_entries[rel_path] = digest
            assert hashlib.md5(zf.read(rel_path)).hexdigest() == digest

        assert set(manifest_entries.keys()) == {
            n for n in names if n.startswith("data/")
        }

        tag_text = zf.read("tagmanifest-md5.txt").decode("utf-8").strip().splitlines()
        for line in tag_text:
            digest, tag_path = line.split("  ", 1)
            assert hashlib.md5(zf.read(tag_path)).hexdigest() == digest

        json.loads(zf.read(next(n for n in names if n.endswith(".jsonld"))))


def test_metadata_extract_pdf_non_destructive_merge(tmp_path) -> None:
    pdf_path = tmp_path / "dummy.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n")

    session = StraditizeSession()
    session.metadata_update(
        {
            "site": {
                "site_name": "UserLake",
                "country": "China",
                "archive_type": "peat bog",
            },
            "chronology": {
                "age_model": "Bacon",
                "cal_curve": "",
            },
        }
    )

    fake_extracted = {
        "site_name": {"value": "", "confidence": "none"},
        "country": {"value": "", "confidence": "none"},
        "archive_type": {"value": "", "confidence": "none"},
        "age_model": {"value": "", "confidence": "none"},
        "cal_curve": {"value": "", "confidence": "none"},
        "dating_counts": {"value": "AMS 14C: 10", "confidence": "high"},
        "total_dates": {"value": "10", "confidence": "high"},
        "reservoir_correction": {"value": "300 yr", "confidence": "medium"},
    }

    with (
        patch(
            "straditize_core.session_parts.metadata.extract_text_from_pdf",
            return_value=[{"page": 1, "text": "Dummy text"}],
        ),
        patch(
            "straditize_core.session_parts.metadata.chunk_text_by_tokens",
            return_value=[{"page": 1, "text": "Dummy text", "token_est": 2}],
        ),
        patch(
            "straditize_core.session_parts.metadata.extract_metadata_from_chunks",
            return_value=fake_extracted,
        ),
    ):
        res = session.metadata_extract_pdf(str(pdf_path))

    assert res["success"] is True
    assert session.paper_metadata["site"]["site_name"] == "UserLake"
    assert session.paper_metadata["site"]["country"] == "China"
    assert session.paper_metadata["site"]["archive_type"] == "Peat"
    assert session.paper_metadata["chronology"]["age_model"] == "Bacon"
    assert session.paper_metadata["chronology"]["cal_curve"] == ""
    assert session.paper_metadata["chronology"]["dating_counts"] == "AMS 14C: 10"
    assert session.paper_metadata["chronology"]["total_dates"] == "10"
    assert session.paper_metadata["chronology"]["reservoir_correction"] == "300 yr"


def test_external_llm_parses_chron_counts() -> None:
    session = StraditizeSession()
    raw = """```json
    {
      "site": {"site_name": "Gahai", "archive_type": "lake sediment"},
      "chronology": {
        "age_model": "Bacon",
        "dating_counts": "AMS 14C: 14 (charcoal); 210Pb: 12",
        "total_dates": "26",
        "reservoir_correction": "None"
      }
    }
    ```"""
    res = session.metadata_parse_external(raw, apply_to_session=True)
    assert res["success"] is True
    assert session.paper_metadata["site"]["archive_type"] == "LakeSediment"
    assert (
        session.paper_metadata["chronology"]["dating_counts"]
        == "AMS 14C: 14 (charcoal); 210Pb: 12"
    )
    assert session.paper_metadata["chronology"]["total_dates"] == "26"
    assert session.paper_metadata["chronology"]["reservoir_correction"] == "None"
