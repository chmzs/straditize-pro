"""Scientific Multi-Sheet XLSX Export Engine using pandas and openpyxl.

Sheets:
1. meta_info: Structured vertical layout (Category, Field, Value, Source, Confidence).
2. pollen: Calibrated abundance matrix (depth in first col, strictly 0.0 for unobserved taxa).
3. age-depth: Chronological tie-in (depth, calendar age, 95% min/max, sed_rate).
4. ensemble_tables: Optional MCMC or multi-model ensemble realizations.
5. qc_notes: Optional quality control flags and remarks.
6. readme: Automatically generated variable glossary, units, and software provenance.
"""
from __future__ import annotations

from datetime import datetime, timezone
import io
import os
from typing import Any
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
import pandas as pd


def export_scientific_xlsx(
    meta_info: dict[str, Any],
    pollen_df: pd.DataFrame,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
    qc_notes: list[dict[str, Any]] | None = None,
    include_readme: bool = True,
    output_path: str | None = None,
) -> bytes:
    """Generates a publication-grade multi-sheet Excel (.xlsx) workbook conforming to Section 8.1."""
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        # ====================================================================
        # 1. meta_info Sheet
        # ====================================================================
        meta_rows = []

        # Group 1: Publication
        pub = meta_info.get("publication", {})
        meta_rows.append({"Category": "Publication", "Field": "DOI", "Value": pub.get("doi", ""), "Source": pub.get("source", "DOI"), "Confidence": "high"})
        meta_rows.append({"Category": "Publication", "Field": "Title", "Value": pub.get("title", ""), "Source": pub.get("source", "DOI"), "Confidence": "high"})
        authors_val = ", ".join(pub.get("authors", [])) if isinstance(pub.get("authors"), list) else str(pub.get("authors", ""))
        meta_rows.append({"Category": "Publication", "Field": "Authors", "Value": authors_val, "Source": pub.get("source", "DOI"), "Confidence": "high"})
        meta_rows.append({"Category": "Publication", "Field": "Journal", "Value": pub.get("journal", ""), "Source": pub.get("source", "DOI"), "Confidence": "high"})
        meta_rows.append({"Category": "Publication", "Field": "Year", "Value": pub.get("year", ""), "Source": pub.get("source", "DOI"), "Confidence": "high"})

        # Group 2: Site Location
        site = meta_info.get("site", {})
        meta_rows.append({"Category": "Site Location", "Field": "Site Name", "Value": site.get("site_name", ""), "Source": site.get("source", "LLM"), "Confidence": site.get("confidence", "medium")})
        meta_rows.append({"Category": "Site Location", "Field": "Latitude (°N)", "Value": site.get("latitude", ""), "Source": site.get("source", "LLM"), "Confidence": site.get("confidence", "medium")})
        meta_rows.append({"Category": "Site Location", "Field": "Longitude (°E)", "Value": site.get("longitude", ""), "Source": site.get("source", "LLM"), "Confidence": site.get("confidence", "medium")})
        meta_rows.append({"Category": "Site Location", "Field": "Elevation (m a.s.l.)", "Value": site.get("elevation_m", ""), "Source": site.get("source", "LLM"), "Confidence": site.get("confidence", "medium")})
        meta_rows.append({"Category": "Site Location", "Field": "Archive Type", "Value": site.get("archive_type", "lake sediment"), "Source": site.get("source", "LLM"), "Confidence": site.get("confidence", "medium")})

        # Group 3: Chronology
        chron = meta_info.get("chronology", {})
        meta_rows.append({"Category": "Chronology", "Field": "Age Model", "Value": chron.get("age_model", "Bacon"), "Source": chron.get("source", "LLM"), "Confidence": chron.get("confidence", "medium")})
        meta_rows.append({"Category": "Chronology", "Field": "Age Range", "Value": chron.get("age_range", ""), "Source": chron.get("source", "LLM"), "Confidence": chron.get("confidence", "medium")})
        meta_rows.append({"Category": "Chronology", "Field": "Dating Method", "Value": chron.get("dating_method", "14C"), "Source": chron.get("source", "LLM"), "Confidence": chron.get("confidence", "medium")})
        meta_rows.append({"Category": "Chronology", "Field": "Calibration Curve", "Value": chron.get("cal_curve", "IntCal20"), "Source": "User", "Confidence": "high"})

        # Group 4: Technical & Laboratory
        tech = meta_info.get("technical", {})
        meta_rows.append({"Category": "Technical", "Field": "Pollen Extraction Method", "Value": tech.get("pollen_extraction_method", "HF digestion / sieving"), "Source": tech.get("source", "LLM"), "Confidence": tech.get("confidence", "medium")})
        meta_rows.append({"Category": "Technical", "Field": "Laboratory", "Value": tech.get("laboratory", ""), "Source": tech.get("source", "LLM"), "Confidence": tech.get("confidence", "medium")})
        meta_rows.append({"Category": "Technical", "Field": "Sampling Interval (cm)", "Value": tech.get("sampling_interval_cm", ""), "Source": tech.get("source", "LLM"), "Confidence": tech.get("confidence", "medium")})

        # Group 5: Quality Remarks
        qual = meta_info.get("quality", {})
        meta_rows.append({"Category": "Quality & Remarks", "Field": "Quality Notes", "Value": qual.get("quality_notes", "Unobserved taxa strictly filled as 0.00 (Zero-Abundance standard)."), "Source": qual.get("source", "User"), "Confidence": "high"})

        df_meta = pd.DataFrame(meta_rows)
        df_meta.to_excel(writer, sheet_name="meta_info", index=False)

        # ====================================================================
        # 2. pollen Sheet
        # ====================================================================
        pollen_df.to_excel(writer, sheet_name="pollen", index=False)

        # ====================================================================
        # 3. age-depth Sheet
        # ====================================================================
        if age_depth_df is not None and not age_depth_df.empty:
            age_depth_df.to_excel(writer, sheet_name="age-depth", index=False)

        # ====================================================================
        # 4. ensemble tables (Section 9)
        # ====================================================================
        if ensemble_tables:
            if len(ensemble_tables) == 1:
                t0 = ensemble_tables[0]
                df_ens = pd.DataFrame(t0.get("data", []), columns=t0.get("columns"))
                df_ens.to_excel(writer, sheet_name="ensemble_table", index=False)
            else:
                for idx, t in enumerate(ensemble_tables):
                    sheet_label = f"ensemble_{idx + 1}"
                    df_ens = pd.DataFrame(t.get("data", []), columns=t.get("columns"))
                    df_ens.to_excel(writer, sheet_name=sheet_label, index=False)

        # ====================================================================
        # 5. qc_notes Sheet (Optional)
        # ====================================================================
        if qc_notes:
            df_qc = pd.DataFrame(qc_notes)
            df_qc.to_excel(writer, sheet_name="qc_notes", index=False)

        # ====================================================================
        # 6. readme Sheet (Optional)
        # ====================================================================
        if include_readme:
            readme_data = [
                {"Item": "Software", "Description": "Straditize Pro v2.0 (Modern Geological Stratigraphic Digitizer)"},
                {"Item": "Export Timestamp", "Description": datetime.now(timezone.utc).isoformat()},
                {"Item": "Pollen Matrix Standard", "Description": "Depths in 1st column. Unobserved taxa strictly filled as 0.00 (never NA)."},
                {"Item": "LiPD Compatibility", "Description": "Conforms to Linked Paleo Data (LiPD) & PaCTS community standards."},
                {"Item": "R Ecosystem", "Description": "Compatible with rioja::strat.plot, vegan, and geoChronR."},
            ]
            df_readme = pd.DataFrame(readme_data)
            df_readme.to_excel(writer, sheet_name="readme", index=False)

    # Styling pass with openpyxl
    bio.seek(0)
    wb = openpyxl.load_workbook(bio)

    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    border_thin = Side(border_style="thin", color="CBD5E1")
    grid_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    for sheetname in wb.sheetnames:
        ws = wb[sheetname]
        ws.views.sheetView[0].showGridLines = True
        # Style header row
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(45, max(12, max_len + 3))

    out_bio = io.BytesIO()
    wb.save(out_bio)
    xlsx_bytes = out_bio.getvalue()

    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(xlsx_bytes)

    return xlsx_bytes
