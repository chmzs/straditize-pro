"""Linked Paleo Data (LiPD) JSON-LD Export Engine (T10).

Conforms strictly to LiPD / LinkedEarth v1.3 standard format:
- Root metadata: dataSetName, archiveType, investigators, pub
- Geo metadata: geo.latitude, geo.longitude, geo.elevation, geo.siteName
- PaleoData: paleoData[0].paleoMeasurementTable containing one table per ROI with tableName = ROI name (Contract §4.2)
- ChronData: chronData[0].chronMeasurementTable containing depth-to-age mappings
- EnsembleTable (Section 9): Optional multi-realization MCMC or multi-model ensemble segments
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from typing import Any
import zipfile
import pandas as pd


_ARCHIVE_TYPE_MAP: dict[str, str] = {
    "lake": "LakeSediment",
    "lake sediment": "LakeSediment",
    "lake sediments": "LakeSediment",
    "lacustrine": "LakeSediment",
    "lacustrine sediment": "LakeSediment",
    "lakesediment": "LakeSediment",
    "marine": "MarineSediment",
    "marine sediment": "MarineSediment",
    "marine sediments": "MarineSediment",
    "marinesediment": "MarineSediment",
    "peat": "Peat",
    "peat bog": "Peat",
    "peatland": "Peat",
    "mire": "Peat",
    "bog": "Peat",
    "fen": "Peat",
    "loess": "TerrestrialSediment",
    "terrestrial sediment": "TerrestrialSediment",
    "terrestrialsediment": "TerrestrialSediment",
    "fluvial sediment": "TerrestrialSediment",
    "alluvial": "TerrestrialSediment",
    "speleothem": "Speleothem",
    "stalagmite": "Speleothem",
    "ice core": "GlacierIce",
    "glacier ice": "GlacierIce",
    "glacierice": "GlacierIce",
    "coral": "Coral",
    "tree": "Wood",
    "tree ring": "Wood",
    "wood": "Wood",
    "bivalve": "Bivalve",
    "mollusk shell": "MolluskShell",
    "molluskshell": "MolluskShell",
    "midden": "Midden",
    "document": "Document",
    "other": "Other",
}


def normalize_lipd_archive_type(raw: Any, default: str = "LakeSediment") -> str:
    """Normalize free-text archive_type into LiPD v1.3 camelCase controlled vocabulary."""
    text = str(raw or "").strip()
    if not text:
        return default
    key = " ".join(text.lower().replace("_", " ").replace("-", " ").split())
    if key in _ARCHIVE_TYPE_MAP:
        return _ARCHIVE_TYPE_MAP[key]
    if " " not in text and text[0].isupper():
        return text
    return "".join(part.capitalize() for part in key.split())


def export_lipd_jsonld(
    meta_info: dict[str, Any] | None = None,
    pollen_df: pd.DataFrame | None = None,
    roi_dfs: dict[str, pd.DataFrame] | None = None,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
    column_units: dict[str, str] | None = None,
    depth_unit: str = "cm",
    primary_axis: str = "depth",
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

    geo_meta = _lipd_geo_metadata(site, site_name)
    pub_meta = _lipd_publication_metadata(pub)
    paleo_measurement_table = _lipd_paleo_tables(
        roi_dfs, pollen_df, depth_unit, col_unit_map
    )
    chron_measurement_table = _lipd_chron_table(age_depth_df)
    ensemble_measurement_table = _lipd_ensemble_tables(ensemble_tables)
    investigators = _lipd_investigators(tech, pub)

    lipd_obj: dict[str, Any] = {
        "@context": "https://linkedearth.github.io/schema/context.json",
        "dataSetName": dataset_name,
        "archiveType": normalize_lipd_archive_type(
            site.get("archive_type"), default="LakeSediment"
        ),
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

    _lipd_apply_optional_fields(lipd_obj, pub, site, tech, qual)

    chron_summary: dict[str, Any] = {}
    if chron.get("age_model"):
        chron_summary["ageModel"] = str(chron["age_model"])
    if chron.get("dating_method"):
        chron_summary["datingMethod"] = str(chron["dating_method"])
    if chron.get("cal_curve"):
        chron_summary["calibrationCurve"] = str(chron["cal_curve"])
    if chron.get("age_range"):
        chron_summary["ageRange"] = str(chron["age_range"])
    if chron.get("total_dates") not in (None, ""):
        chron_summary["totalDates"] = chron["total_dates"]
    if chron.get("dating_counts"):
        chron_summary["datingCounts"] = chron["dating_counts"]
    if chron.get("reservoir_correction"):
        chron_summary["reservoirCorrection"] = str(chron["reservoir_correction"])
    if chron_summary:
        lipd_obj["chronData"][0]["chronologyMetadata"] = chron_summary

    if ensemble_measurement_table:
        lipd_obj["chronData"][0]["chronEnsembleTable"] = ensemble_measurement_table

    return lipd_obj


def _lipd_geo_metadata(site: dict[str, Any], site_name: str) -> dict[str, Any]:
    """地理段：经纬度/海拔解析失败降级成 null，水深与岩芯长度降级成字符串（两种策略不同，别改混）。"""
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
    if lat is not None and lon is not None:
        coords: list[float] = [lon, lat] if elev is None else [lon, lat, elev]
        geo_meta["geometry"] = {"type": "Point", "coordinates": coords}
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
    return geo_meta


def _lipd_publication_metadata(pub: dict[str, Any]) -> list[dict[str, Any]]:
    """文献段：LiPD 的 pub 是一个列表，type=primary 的那条。"""
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
    return pub_meta


def _lipd_paleo_columns(
    df: pd.DataFrame,
    depth_unit: str,
    col_unit_map: dict[str, str],
) -> list[dict[str, Any]]:
    """一张表里每一列 → LiPD 列对象（深度列单独定单位与 variableType）。"""
    paleo_columns: list[dict[str, Any]] = []
    for col_name in df.columns:
        vals = df[col_name].tolist()
        if col_name == "horizon_id" or col_name.lower().endswith("_id"):
            clean_vals = [str(v) if pd.notna(v) else None for v in vals]
            paleo_columns.append(
                {
                    "variableName": col_name,
                    "units": None,
                    "values": clean_vals,
                    "dataType": "string",
                    "variableType": "identifier",
                    "proxy": None,
                    "description": "Consensus horizon identifier",
                }
            )
            continue

        clean_vals = []
        for v in vals:
            if pd.isna(v) or v is None or v == "":
                clean_vals.append(None)
            else:
                try:
                    clean_vals.append(float(v))
                except (ValueError, TypeError):
                    clean_vals.append(str(v))

        lower_name = col_name.strip().lower()
        is_depth = (
            lower_name == "depth"
            or lower_name.startswith("depth ")
            or lower_name.startswith("depth(")
        )
        is_age = (
            lower_name == "age"
            or lower_name.startswith("age ")
            or lower_name.startswith("age(")
            or lower_name in ("cal yr bp", "cal yrbp", "yr bp", "age_cal_bp")
        )
        is_elev = (
            lower_name == "elevation"
            or lower_name.startswith("elevation ")
            or lower_name.startswith("elevation(")
        )
        if is_depth:
            resolved_unit = depth_unit or "cm"
            var_type = "depth"
            proxy = None
            desc = "Core composite depth"
        elif is_age:
            resolved_unit = col_unit_map.get(col_name) or (
                depth_unit if depth_unit and "yr" in depth_unit.lower() else "cal yrBP"
            )
            var_type = "chronology"
            proxy = None
            desc = "Sample age"
        elif is_elev:
            resolved_unit = col_unit_map.get(col_name) or depth_unit or "m"
            var_type = "elevation"
            proxy = None
            desc = "Sample elevation"
        else:
            resolved_unit = col_unit_map.get(col_name) or "%"
            var_type = "measured"
            proxy = "pollen"
            desc = f"Digitized {col_name} ({resolved_unit})"

        paleo_columns.append(
            {
                "variableName": col_name,
                "units": resolved_unit,
                "values": clean_vals,
                "dataType": "float",
                "variableType": var_type,
                "proxy": proxy,
                "description": desc,
            }
        )
    return paleo_columns


def _lipd_paleo_tables(
    roi_dfs: dict[str, pd.DataFrame] | None,
    pollen_df: pd.DataFrame | None,
    depth_unit: str,
    col_unit_map: dict[str, str],
) -> list[dict[str, Any]]:
    """PaleoData 段：优先按 ROI 分表（tableName = ROI 名）；没有 roi_dfs 时退化成单张 pollen_data。

    两个分支的列构造完全相同，只差 tableName——以前各写了一份，已经漂过一次。
    """
    tables: list[dict[str, Any]] = []
    if roi_dfs:
        for roi_name, df in roi_dfs.items():
            tables.append(
                {
                    "tableName": roi_name,
                    "columns": _lipd_paleo_columns(df, depth_unit, col_unit_map),
                }
            )
    elif pollen_df is not None:
        tables.append(
            {
                "tableName": "pollen_data",
                "columns": _lipd_paleo_columns(pollen_df, depth_unit, col_unit_map),
            }
        )
    return tables


def _lipd_chron_table(age_depth_df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """ChronData 段：年代-深度两列（空表也返回一条空的 chron_model，下游按存在性判读）。"""
    chron_columns: list[dict[str, Any]] = []
    if age_depth_df is not None and not age_depth_df.empty:
        for col_name in age_depth_df.columns:
            vals = age_depth_df[col_name].tolist()
            if col_name == "horizon_id" or col_name.lower().endswith("_id"):
                clean_vals = [str(v) if pd.notna(v) else None for v in vals]
                chron_columns.append(
                    {
                        "variableName": col_name,
                        "units": None,
                        "values": clean_vals,
                        "dataType": "string",
                        "variableType": "identifier",
                        "description": "Consensus horizon identifier",
                    }
                )
                continue

            clean_vals = []
            for v in vals:
                if pd.isna(v) or v is None or v == "":
                    clean_vals.append(None)
                else:
                    try:
                        clean_vals.append(float(v))
                    except (ValueError, TypeError):
                        clean_vals.append(str(v))

            is_depth = col_name.lower().startswith("depth")
            chron_columns.append(
                {
                    "variableName": col_name,
                    "units": "cm" if is_depth else "cal yrBP",
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
    return chron_measurement_table


def _lipd_ensemble_tables(
    ensemble_tables: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """集合表段（Section 9）：每条集合表 → 一张 measurement 表。"""
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
                            "units": "cal yrBP" if "age" in col_name.lower() else "cm",
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
    return ensemble_measurement_table


def _lipd_investigators(tech: dict[str, Any], pub: dict[str, Any]) -> list[str]:
    """研究者：显式列表 > 逗号串 > 文献作者。"""
    raw_inv = tech.get("investigators")
    if isinstance(raw_inv, list) and raw_inv:
        investigators = raw_inv
    elif isinstance(raw_inv, str) and raw_inv.strip():
        investigators = [s.strip() for s in raw_inv.split(",") if s.strip()]
    else:
        investigators = pub.get("authors", [])
    return investigators


def _lipd_apply_optional_fields(
    lipd_obj: dict[str, Any],
    pub: dict[str, Any],
    site: dict[str, Any],
    tech: dict[str, Any],
    qual: dict[str, Any],
) -> None:
    """把可选字段按"有值才写"的纪律挂到根对象上（没值的键不能出现，空串也不算有值）。"""
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


def package_lipd_archive(
    lipd_jsonld: dict[str, Any],
    output_path: str | None = None,
) -> bytes:
    """Packages a LiPD JSON-LD and its CSV tables into a BagIt-compliant .lpd ZIP container."""
    dataset_name = lipd_jsonld.get("dataSetName", "dataset")
    data_files: dict[str, bytes] = {}

    jsonld_bytes = json.dumps(lipd_jsonld, indent=2, ensure_ascii=False).encode("utf-8")
    data_files[f"data/{dataset_name}.jsonld"] = jsonld_bytes

    def _add_tables(tables: list[dict[str, Any]], fallback_prefix: str) -> None:
        for idx, table in enumerate(tables):
            t_name = str(table.get("tableName") or f"{fallback_prefix}_{idx + 1}")
            cols = table.get("columns", [])
            data_dict = {
                c["variableName"]: c["values"]
                for c in cols
                if "variableName" in c and "values" in c
            }
            if not data_dict:
                continue
            rel_path = f"data/{t_name}.csv"
            if rel_path in data_files:
                rel_path = f"data/{fallback_prefix}_{t_name}.csv"
            df = pd.DataFrame(data_dict)
            data_files[rel_path] = df.to_csv(index=False, lineterminator="\n").encode(
                "utf-8"
            )

    paleo_root = (lipd_jsonld.get("paleoData") or [{}])[0]
    _add_tables(paleo_root.get("paleoMeasurementTable", []), "paleo")

    chron_root = (lipd_jsonld.get("chronData") or [{}])[0]
    _add_tables(chron_root.get("chronMeasurementTable", []), "chron")
    _add_tables(chron_root.get("chronEnsembleTable", []), "ensemble")

    manifest_lines = [
        f"{hashlib.md5(content).hexdigest()}  {rel_path}"
        for rel_path, content in sorted(data_files.items())
    ]
    manifest_bytes = ("\n".join(manifest_lines) + "\n").encode("utf-8")
    bagit_bytes = (
        "BagIt-Version: 0.97\nTag-File-Character-Encoding: UTF-8\n"
    ).encode("utf-8")
    tagmanifest_lines = [
        f"{hashlib.md5(bagit_bytes).hexdigest()}  bagit.txt",
        f"{hashlib.md5(manifest_bytes).hexdigest()}  manifest-md5.txt",
    ]
    tagmanifest_bytes = ("\n".join(tagmanifest_lines) + "\n").encode("utf-8")

    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bagit.txt", bagit_bytes)
        zf.writestr("manifest-md5.txt", manifest_bytes)
        zf.writestr("tagmanifest-md5.txt", tagmanifest_bytes)
        for rel_path, content in sorted(data_files.items()):
            zf.writestr(rel_path, content)

    zip_bytes = bio.getvalue()
    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(zip_bytes)

    return zip_bytes


# Alias for backwards compatibility
export_lipd_package = package_lipd_archive
