"""Linked Paleo Data (LiPD) JSON-LD Export Engine.

Conforms strictly to LiPD / LinkedEarth v1.3 standard format:
- Root metadata: dataSetName, archiveType, investigators, pub
- Geo metadata: geo.latitude, geo.longitude, geo.elevation, geo.siteName
- PaleoData: paleoData[0].paleoMeasurementTable[0] containing columns for pollen variables
- ChronData: chronData[0].chronMeasurementTable[0] containing depth-to-age mappings
- EnsembleTable (Section 9): Optional multi-realization MCMC or multi-model ensemble segments
"""
from __future__ import annotations

import io
import json
import os
from typing import Any
import zipfile
import pandas as pd


def export_lipd_jsonld(
    meta_info: dict[str, Any],
    pollen_df: pd.DataFrame,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Builds a complete Linked Paleo Data (LiPD) JSON-LD structure conforming to LiPDverse."""
    pub = meta_info.get("publication", {})
    site = meta_info.get("site", {})
    chron = meta_info.get("chronology", {})
    tech = meta_info.get("technical", {})
    qual = meta_info.get("quality", {})

    site_name = site.get("site_name") or "Unnamed_Site"
    year_str = str(pub.get("year") or "2026")
    authors_first = (pub.get("authors", ["Author"])[0] if isinstance(pub.get("authors"), list) and pub.get("authors") else "Author").split()[-1]
    dataset_name = f"{site_name}_{authors_first}_{year_str}".replace(" ", "_")

    # 1. Geographic metadata
    try:
        lat = float(site.get("latitude", 0.0))
    except (ValueError, TypeError):
        lat = None

    try:
        lon = float(site.get("longitude", 0.0))
    except (ValueError, TypeError):
        lon = None

    try:
        elev = float(site.get("elevation_m", 0.0))
    except (ValueError, TypeError):
        elev = None

    geo_meta = {
        "siteName": site_name,
        "latitude": lat,
        "longitude": lon,
        "elevation": elev,
    }

    # 2. Publication metadata
    pub_meta = [
        {
            "doi": pub.get("doi", ""),
            "title": pub.get("title", ""),
            "author": pub.get("authors", []),
            "journal": pub.get("journal", ""),
            "year": pub.get("year"),
            "type": "primary",
        }
    ]

    # 3. PaleoData (Pollen Matrix)
    paleo_columns: list[dict[str, Any]] = []
    for col_name in pollen_df.columns:
        vals = pollen_df[col_name].tolist()
        clean_vals = [float(v) if pd.notna(v) else None for v in vals]
        is_depth = col_name.lower().startswith("depth")
        paleo_columns.append({
            "variableName": col_name,
            "units": "cm" if is_depth else "%",
            "values": clean_vals,
            "dataType": "float",
            "variableType": "depth" if is_depth else "measured",
            "proxy": "pollen" if not is_depth else None,
            "description": f"Digitized {col_name} abundance" if not is_depth else "Core composite depth",
        })

    paleo_measurement_table = [
        {
            "tableName": "pollen_data",
            "columns": paleo_columns,
        }
    ]

    # 4. ChronData (Age-Depth Models)
    chron_columns: list[dict[str, Any]] = []
    if age_depth_df is not None and not age_depth_df.empty:
        for col_name in age_depth_df.columns:
            vals = age_depth_df[col_name].tolist()
            clean_vals = [float(v) if pd.notna(v) else None for v in vals]
            c_low = col_name.lower()
            chron_columns.append({
                "variableName": col_name,
                "units": "cm" if "depth" in c_low else chron.get("age_unit", "cal BP"),
                "values": clean_vals,
                "dataType": "float",
                "variableType": "depth" if "depth" in c_low else "age",
            })

    chron_data = [
        {
            "chronName": chron.get("age_model", "Bacon_Model"),
            "chronMeasurementTable": [
                {
                    "tableName": "age_model_table",
                    "columns": chron_columns,
                }
            ],
            "method": chron.get("dating_method", "14C"),
            "calibrationCurve": chron.get("cal_curve", "IntCal20"),
        }
    ]

    # 5. Ensemble Table (Section 9)
    ensemble_section: list[dict[str, Any]] = []
    if ensemble_tables:
        for t in ensemble_tables:
            t_name = t.get("name", "Bacon_Ensemble")
            cols = t.get("columns", ["depth", "age", "uncertainty"])
            data_rows = t.get("data", [])

            # Pivot rows into column-based structure for LiPD
            col_data: dict[str, list[Any]] = {c: [] for c in cols}
            for row in data_rows:
                for c_idx, c_name in enumerate(cols):
                    col_data[c_name].append(row[c_idx] if c_idx < len(row) else None)

            ens_cols = []
            for c_name in cols:
                ens_cols.append({
                    "variableName": c_name,
                    "values": col_data[c_name],
                    "dataType": "float",
                })

            ensemble_section.append({
                "ensembleTableName": t_name,
                "columns": ens_cols,
            })

    lipd_json: dict[str, Any] = {
        "@context": "https://linked.earth/ontology/lipd.jsonld",
        "dataSetName": dataset_name,
        "archiveType": site.get("archive_type", "lake sediment"),
        "originalDataURL": f"https://doi.org/{pub.get('doi', '')}" if pub.get("doi") else "",
        "investigators": pub.get("authors", []),
        "geo": geo_meta,
        "pub": pub_meta,
        "paleoData": [
            {
                "paleoMeasurementTable": paleo_measurement_table,
            }
        ],
        "chronData": chron_data,
        "metadataProvenance": {
            "generator": "Straditize Pro v2.0",
            "extractionMethod": tech.get("pollen_extraction_method", ""),
            "laboratory": tech.get("laboratory", ""),
            "qualityNotes": qual.get("quality_notes", ""),
        },
    }

    if ensemble_section:
        lipd_json["ensembleTable"] = ensemble_section

    return lipd_json


def export_lipd_package(
    meta_info: dict[str, Any],
    pollen_df: pd.DataFrame,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
    output_path: str | None = None,
) -> bytes:
    """Packs LiPD JSON-LD into a standard .lpd (zip) container accepted by LiPDverse."""
    lipd_json = export_lipd_jsonld(meta_info, pollen_df, age_depth_df, ensemble_tables)
    dataset_name = lipd_json.get("dataSetName", "PaleoData")

    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        json_bytes = json.dumps(lipd_json, indent=2, ensure_ascii=False).encode("utf-8")
        zf.writestr(f"{dataset_name}.jsonld", json_bytes)
        # Add bagit declaration
        zf.writestr("bagit.txt", "BagIt-Version: 0.97\nTag-File-Character-Encoding: UTF-8\n")

    pkg_bytes = bio.getvalue()

    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(pkg_bytes)

    return pkg_bytes
