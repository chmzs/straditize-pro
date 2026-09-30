"""Linked Paleo Data (LiPD) JSON-LD Export Engine (T10).

Conforms strictly to LiPD / LinkedEarth v1.3 standard format:
- Root metadata: dataSetName, archiveType, investigators, pub
- Geo metadata: geo.latitude, geo.longitude, geo.elevation, geo.siteName
- PaleoData: paleoData[0].paleoMeasurementTable containing one table per ROI with tableName = ROI name (Contract §4.2)
- ChronData: chronData[0].chronMeasurementTable containing depth-to-age mappings
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
    meta_info: dict[str, Any] | None = None,
    pollen_df: pd.DataFrame | None = None,
    roi_dfs: dict[str, pd.DataFrame] | None = None,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
    column_units: dict[str, str] | None = None,
    depth_unit: str = "cm",
) -> dict[str, Any]:
    """Builds a complete Linked Paleo Data (LiPD) JSON-LD structure conforming to LiPDverse and Contract §4.2."""
    meta_info = meta_info or {}
    pub = meta_info.get("publication", {})
    site = meta_info.get("site", {})
    chron = meta_info.get("chronology", {})
    tech = meta_info.get("technical", {})
    qual = meta_info.get("quality", {})
    col_unit_map = column_units or {}

    site_name = site.get("site_name") or "Unnamed_Site"
    year_str = str(pub.get("year") or "2026")
    authors_first = (
        pub.get("authors", ["Author"])[0]
        if isinstance(pub.get("authors"), list) and pub.get("authors")
        else "Author"
    ).split()[-1]
    dataset_name = f"{site_name}_{authors_first}_{year_str}".replace(" ", "_")

    # 1. Geographic metadata (LiPD v1.3 geo & site properties)
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

    geo_meta: dict[str, Any] = {
        "siteName": site_name,
        "latitude": lat,
        "longitude": lon,
        "elevation": elev,
    }
    if site.get("country"):
        geo_meta["country"] = str(site["country"])
    if site.get("water_depth_m") not in (None, ""):
        try:
            geo_meta["waterDepth"] = float(site["water_depth_m"])
        except (ValueError, TypeError):
            geo_meta["waterDepth"] = str(site["water_depth_m"])
    if site.get("core_length_m") not in (None, ""):
        try:
            geo_meta["coreLength"] = float(site["core_length_m"])
        except (ValueError, TypeError):
            geo_meta["coreLength"] = str(site["core_length_m"])
    if site.get("collection_date"):
        geo_meta["collectionDate"] = str(site["collection_date"])

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

    # 3. PaleoData: One measurement table per ROI (Contract §4.2: tableName = ROI name)
    paleo_measurement_table: list[dict[str, Any]] = []

    if roi_dfs:
        for roi_name, df in roi_dfs.items():
            paleo_columns: list[dict[str, Any]] = []
            for col_name in df.columns:
                vals = df[col_name].tolist()
                clean_vals = [float(v) if pd.notna(v) else None for v in vals]
                is_depth = col_name.lower().startswith("depth")
                resolved_unit = (
                    (depth_unit or "cm")
                    if is_depth
                    else (col_unit_map.get(col_name) or "%")
                )
                paleo_columns.append(
                    {
                        "variableName": col_name,
                        "units": resolved_unit,
                        "values": clean_vals,
                        "dataType": "float",
                        "variableType": "depth" if is_depth else "measured",
                        "proxy": "pollen" if not is_depth else None,
                        "description": f"Digitized {col_name} ({resolved_unit})"
                        if not is_depth
                        else "Core composite depth",
                    }
                )
            paleo_measurement_table.append(
                {
                    "tableName": roi_name,
                    "columns": paleo_columns,
                }
            )
    elif pollen_df is not None:
        paleo_columns = []
        for col_name in pollen_df.columns:
            vals = pollen_df[col_name].tolist()
            clean_vals = [float(v) if pd.notna(v) else None for v in vals]
            is_depth = col_name.lower().startswith("depth")
            resolved_unit = (
                (depth_unit or "cm")
                if is_depth
                else (col_unit_map.get(col_name) or "%")
            )
            paleo_columns.append(
                {
                    "variableName": col_name,
                    "units": resolved_unit,
                    "values": clean_vals,
                    "dataType": "float",
                    "variableType": "depth" if is_depth else "measured",
                    "proxy": "pollen" if not is_depth else None,
                    "description": f"Digitized {col_name} ({resolved_unit})"
                    if not is_depth
                    else "Core composite depth",
                }
            )
        paleo_measurement_table.append(
            {
                "tableName": "pollen_data",
                "columns": paleo_columns,
            }
        )

    # 4. ChronData (Age-Depth Models)
    chron_columns: list[dict[str, Any]] = []
    if age_depth_df is not None and not age_depth_df.empty:
        for col_name in age_depth_df.columns:
            vals = age_depth_df[col_name].tolist()
            clean_vals = [float(v) if pd.notna(v) else None for v in vals]
            is_depth = col_name.lower().startswith("depth")
            chron_columns.append(
                {
                    "variableName": col_name,
                    "units": "cm" if is_depth else "yr BP",
                    "values": clean_vals,
                    "dataType": "float",
                    "variableType": "depth" if is_depth else "chronology",
                    "description": f"Modeled {col_name} parameter",
                }
            )

    chron_measurement_table = [
        {
            "tableName": "chron_model",
            "columns": chron_columns,
        }
    ]

    # 5. Ensemble Tables (Section 9)
    ensemble_measurement_table = []
    if ensemble_tables:
        for idx, t in enumerate(ensemble_tables):
            ens_cols = []
            cols_names = t.get("columns", [])
            data_rows = t.get("data", [])
            if data_rows and cols_names:
                df_temp = pd.DataFrame(data_rows, columns=cols_names)
                for col_name in df_temp.columns:
                    ens_cols.append(
                        {
                            "variableName": col_name,
                            "units": "yr BP" if "age" in col_name.lower() else "cm",
                            "values": [
                                float(v) if pd.notna(v) else None
                                for v in df_temp[col_name]
                            ],
                            "dataType": "float",
                        }
                    )
            ensemble_measurement_table.append(
                {
                    "tableName": t.get("name", f"ensemble_{idx + 1}"),
                    "columns": ens_cols,
                }
            )

    # Resolve investigators (explicit field/lab investigators if provided, else publication authors)
    raw_inv = tech.get("investigators")
    if isinstance(raw_inv, list) and raw_inv:
        investigators = raw_inv
    elif isinstance(raw_inv, str) and raw_inv.strip():
        investigators = [s.strip() for s in raw_inv.split(",") if s.strip()]
    else:
        investigators = pub.get("authors", [])

    # Assemble Root LiPD JSON-LD Object
    lipd_obj: dict[str, Any] = {
        "@context": "https://linkedearth.github.io/schema/context.json",
        "dataSetName": dataset_name,
        "archiveType": site.get("archive_type", "LakeSediment"),
        "investigators": investigators,
        "pub": pub_meta,
        "geo": geo_meta,
        "paleoData": [
            {
                "paleoMeasurementTable": paleo_measurement_table,
            }
        ],
        "chronData": [
            {
                "chronMeasurementTable": chron_measurement_table,
            }
        ],
    }

    if pub.get("funding_agency") or pub.get("funding_grant"):
        lipd_obj["funding"] = [
            {
                "fundingAgency": pub.get("funding_agency", ""),
                "fundingGrant": pub.get("funding_grant", ""),
            }
        ]
    if tech.get("digitizer"):
        lipd_obj["createdBy"] = str(tech["digitizer"])
    if tech.get("affiliation"):
        lipd_obj["affiliation"] = str(tech["affiliation"])
    if tech.get("laboratory"):
        lipd_obj["laboratory"] = str(tech["laboratory"])
    if tech.get("digitization_date"):
        lipd_obj["digitizationDate"] = str(tech["digitization_date"])
    if site.get("collection_date"):
        lipd_obj["collectionDate"] = str(site["collection_date"])
    if qual.get("dataset_version"):
        lipd_obj["datasetVersion"] = str(qual["dataset_version"])
    if qual.get("original_data_url"):
        lipd_obj["originalDataUrl"] = str(qual["original_data_url"])
    if qual.get("quality_notes"):
        lipd_obj["notes"] = str(qual["quality_notes"])

    if ensemble_measurement_table:
        lipd_obj["chronData"][0]["chronEnsembleTable"] = ensemble_measurement_table

    return lipd_obj


def package_lipd_archive(
    lipd_jsonld: dict[str, Any],
    output_path: str | None = None,
) -> bytes:
    """Packages a LiPD JSON-LD and its CSV tables into a standard .lpd ZIP container."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        # Write metadata JSON-LD
        jsonld_str = json.dumps(lipd_jsonld, indent=2, ensure_ascii=False)
        zf.writestr(f"{lipd_jsonld.get('dataSetName', 'dataset')}.jsonld", jsonld_str)

        # Write paleo measurement CSVs
        for table in lipd_jsonld.get("paleoData", [{}])[0].get(
            "paleoMeasurementTable", []
        ):
            t_name = table.get("tableName", "paleo")
            cols = table.get("columns", [])
            data_dict = {
                c["variableName"]: c["values"]
                for c in cols
                if "variableName" in c and "values" in c
            }
            if data_dict:
                df = pd.DataFrame(data_dict)
                csv_bytes = df.to_csv(index=False).encode("utf-8")
                zf.writestr(f"{t_name}.csv", csv_bytes)

    zip_bytes = bio.getvalue()
    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(zip_bytes)

    return zip_bytes


# Alias for backwards compatibility
export_lipd_package = package_lipd_archive
