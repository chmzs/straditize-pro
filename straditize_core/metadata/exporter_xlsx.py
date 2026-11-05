"""Scientific Multi-Sheet XLSX Export Engine using pandas and openpyxl (T10).

Sheets:
- Per-ROI sheets: One sheet per ROI, sheet name = ROI name (Contract §4.2, supports Chinese/Unicode, e.g. '花粉').
- meta_info (optional): Structured vertical layout (Category, Field, Value, Source, Confidence).
- age-depth (optional): Chronological tie-in (depth, calendar age, 95% min/max, sed_rate).
- ensemble_tables (optional): MCMC or multi-model ensemble realizations.
- qc_notes (optional): Quality control flags and remarks.
- readme (optional): Automatically generated variable glossary, units, and software provenance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import io
import os
from typing import Any, Callable
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
import pandas as pd


def export_scientific_xlsx(
    meta_info: dict[str, Any] | None = None,
    pollen_df: pd.DataFrame | None = None,
    roi_dfs: dict[str, pd.DataFrame] | None = None,
    include_meta_sheets: bool = True,
    age_depth_df: pd.DataFrame | None = None,
    ensemble_tables: list[dict[str, Any]] | None = None,
    qc_notes: list[dict[str, Any]] | None = None,
    include_readme: bool = True,
    output_path: str | None = None,
) -> bytes:
    """Generates a publication-grade multi-sheet Excel (.xlsx) workbook conforming to Section 8.1 & T10."""
    meta_info = meta_info or {}
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        # ====================================================================
        # 1. meta_info Sheet (Optional)
        # ====================================================================
        if include_meta_sheets and meta_info:
            _write_meta_sheet(writer, meta_info)

        # ====================================================================
        _write_data_sheets(
            writer,
            roi_dfs=roi_dfs,
            pollen_df=pollen_df,
            include_meta_sheets=include_meta_sheets,
            age_depth_df=age_depth_df,
            ensemble_tables=ensemble_tables,
        )
        _write_doc_sheets(
            writer,
            include_meta_sheets=include_meta_sheets,
            qc_notes=qc_notes,
            include_readme=include_readme,
        )

    # Styling pass with openpyxl
    bio.seek(0)
    wb = openpyxl.load_workbook(bio)
    _style_workbook(wb)
    return _serialize_workbook(wb, output_path)


def _format_authors(raw: Any) -> str:
    """作者列：list 用逗号连接，其余直接 str()（缺键时给空串，与原实现逐字一致）。"""
    if isinstance(raw, list):
        return ", ".join(raw)
    return str(raw)


@dataclass(frozen=True)
class _MetaRowSpec:
    """meta_info 的一行：Category / Field + 取值位置 + 默认来源与置信度。"""

    category: str
    field: str
    section: str
    key: str
    default: Any = ""
    source: str = "User"
    confidence: str | None = None  # None = 取该分组的 confidence（缺省 medium）
    optional: bool = False  # 有值才出现
    transform: Callable[[Any], Any] | None = None


#: meta_info 的全部字段，顺序即表格行序（golden 逐格钉住，缺一行就红）。
#: 五组的差异只有三处：Source 的缺省值、Confidence 是字面量还是取分组值、以及哪些行可选。
_META_ROWS: tuple[_MetaRowSpec, ...] = (
    # Group 1: Publication —— Source 缺省 DOI，置信度固定 high
    _MetaRowSpec(
        "Publication", "DOI", "publication", "doi", source="DOI", confidence="high"
    ),
    _MetaRowSpec(
        "Publication", "Title", "publication", "title", source="DOI", confidence="high"
    ),
    _MetaRowSpec(
        "Publication",
        "Authors",
        "publication",
        "authors",
        source="DOI",
        confidence="high",
        transform=_format_authors,
    ),
    _MetaRowSpec(
        "Publication",
        "Journal",
        "publication",
        "journal",
        source="DOI",
        confidence="high",
    ),
    _MetaRowSpec(
        "Publication", "Year", "publication", "year", source="DOI", confidence="high"
    ),
    _MetaRowSpec(
        "Publication",
        "Funding Agency",
        "publication",
        "funding_agency",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Publication",
        "Funding Grant",
        "publication",
        "funding_grant",
        source="User",
        confidence="high",
        optional=True,
    ),
    # Group 2: Site Location —— 必填行取分组 confidence（缺省 medium），可选行固定 high
    _MetaRowSpec("Site Location", "Site Name", "site", "site_name", source="LLM"),
    _MetaRowSpec("Site Location", "Latitude (°N)", "site", "latitude", source="LLM"),
    _MetaRowSpec("Site Location", "Longitude (°E)", "site", "longitude", source="LLM"),
    _MetaRowSpec(
        "Site Location", "Elevation (m a.s.l.)", "site", "elevation_m", source="LLM"
    ),
    _MetaRowSpec(
        "Site Location",
        "Archive Type",
        "site",
        "archive_type",
        default="lake sediment",
        source="LLM",
    ),
    _MetaRowSpec(
        "Site Location",
        "Country / Region",
        "site",
        "country",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Site Location",
        "Water Depth (m)",
        "site",
        "water_depth_m",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Site Location",
        "Core Length (m)",
        "site",
        "core_length_m",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Site Location",
        "Collection Date",
        "site",
        "collection_date",
        source="User",
        confidence="high",
        optional=True,
    ),
    # Group 3: Chronology —— 校准曲线那一行是唯一 Source 固定 User 的必填行
    _MetaRowSpec(
        "Chronology",
        "Age Model",
        "chronology",
        "age_model",
        default="Bacon",
        source="LLM",
    ),
    _MetaRowSpec("Chronology", "Age Range", "chronology", "age_range", source="LLM"),
    _MetaRowSpec(
        "Chronology",
        "Dating Method",
        "chronology",
        "dating_method",
        default="14C",
        source="LLM",
    ),
    _MetaRowSpec(
        "Chronology",
        "Calibration Curve",
        "chronology",
        "cal_curve",
        default="IntCal20",
        source="User",
        confidence="high",
    ),
    # Group 4: Technical & Laboratory
    _MetaRowSpec(
        "Technical",
        "Pollen Extraction Method",
        "technical",
        "pollen_extraction_method",
        default="HF digestion / sieving",
        source="LLM",
    ),
    _MetaRowSpec("Technical", "Laboratory", "technical", "laboratory", source="LLM"),
    _MetaRowSpec(
        "Technical",
        "Sampling Interval (cm)",
        "technical",
        "sampling_interval_cm",
        source="LLM",
    ),
    _MetaRowSpec(
        "Technical",
        "Investigators / Collectors",
        "technical",
        "investigators",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Technical",
        "Digitizer / Curator",
        "technical",
        "digitizer",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Technical",
        "Affiliation / Institution",
        "technical",
        "affiliation",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Technical",
        "Digitization Date",
        "technical",
        "digitization_date",
        source="User",
        confidence="high",
        optional=True,
    ),
    # Group 5: Quality & Remarks —— 全部 User / high
    _MetaRowSpec(
        "Quality & Remarks",
        "Quality Notes",
        "quality",
        "quality_notes",
        default="Unobserved taxa strictly filled as 0.00 (Zero-Abundance standard).",
        source="User",
        confidence="high",
    ),
    _MetaRowSpec(
        "Quality & Remarks",
        "Dataset Version",
        "quality",
        "dataset_version",
        source="User",
        confidence="high",
        optional=True,
    ),
    _MetaRowSpec(
        "Quality & Remarks",
        "Original Data URL",
        "quality",
        "original_data_url",
        source="User",
        confidence="high",
        optional=True,
    ),
)


def _write_meta_sheet(writer: pd.ExcelWriter, meta_info: dict[str, Any]) -> None:
    """把 meta_info 摊平成一行一条（Category / Field / Value / Source / Confidence）。

    字段清单见 _META_ROWS：五组的差异只有 Source 缺省值、Confidence 是字面量还是取分组值、
    以及哪些行「有值才出现」。改字段就是改表里的一行，不用再抄五遍 append。
    """
    rows: list[dict[str, Any]] = []
    for spec in _META_ROWS:
        section = meta_info.get(spec.section, {})
        raw = section.get(spec.key, spec.default)
        if spec.optional and not raw:
            continue
        value = spec.transform(raw) if spec.transform else raw
        confidence = (
            spec.confidence
            if spec.confidence is not None
            else section.get("confidence", "medium")
        )
        rows.append(
            {
                "Category": spec.category,
                "Field": spec.field,
                "Value": value,
                "Source": section.get("source", spec.source),
                "Confidence": confidence,
            }
        )
    pd.DataFrame(rows).to_excel(writer, sheet_name="meta_info", index=False)


def _style_workbook(wb: openpyxl.Workbook) -> None:
    """统一所有 sheet 的表头样式（Segoe UI 11 粗体白字 / 深色实底 / 居中）与列宽。

    列宽按内容长度自适应并夹在 [12, 45]：太窄看不清、太宽在窄屏上横向滚动。
    """
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(
        start_color="0F172A", end_color="0F172A", fill_type="solid"
    )
    border_thin = Side(border_style="thin", color="CBD5E1")
    grid_border = Border(
        left=border_thin, right=border_thin, top=border_thin, bottom=border_thin
    )
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


def _serialize_workbook(wb: openpyxl.Workbook, output_path: str | None) -> bytes:
    """序列化为 bytes；给了 output_path 就顺带落盘（目录不存在则创建）。"""
    out_bio = io.BytesIO()
    wb.save(out_bio)
    xlsx_bytes = out_bio.getvalue()
    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(xlsx_bytes)
    return xlsx_bytes


def _write_data_sheets(
    writer: pd.ExcelWriter,
    *,
    roi_dfs: dict[str, pd.DataFrame] | None,
    pollen_df: pd.DataFrame | None,
    include_meta_sheets: bool,
    age_depth_df: pd.DataFrame | None,
    ensemble_tables: list[dict[str, Any]] | None,
) -> None:
    """数据类 sheet：每 ROI 一张（§4.2，无 ROI 时退回单张 pollen）。

    ROI 优先于 pollen：多 ROI 工程里 pollen 只是其中一张，单独再写会重复。
    sheet 名截断到 31 字符（Excel 硬限制），超出会被 openpyxl 拒绝。
    """
    # 2. ROI Sheets: One sheet per ROI, sheet name = ROI name (Contract §4.2)
    # ====================================================================
    if roi_dfs:
        for roi_name, df in roi_dfs.items():
            clean_sheet_name = str(roi_name)[:31]
            df.to_excel(writer, sheet_name=clean_sheet_name, index=False)
    elif pollen_df is not None:
        pollen_df.to_excel(writer, sheet_name="pollen", index=False)

    # ====================================================================
    # 3. age-depth Sheet (Optional)
    # ====================================================================
    if include_meta_sheets and age_depth_df is not None and not age_depth_df.empty:
        age_depth_df.to_excel(writer, sheet_name="age-depth", index=False)

    # ====================================================================
    # 4. ensemble tables (Section 9, Optional)
    # ====================================================================
    if include_meta_sheets and ensemble_tables:
        if len(ensemble_tables) == 1:
            t0 = ensemble_tables[0]
            sheet_label = str(t0.get("name") or "Age_Uncertainty_U1000")[:31]
            df_ens = pd.DataFrame(t0.get("data", []), columns=t0.get("columns"))
            df_ens.to_excel(writer, sheet_name=sheet_label, index=False)
        else:
            for idx, t in enumerate(ensemble_tables):
                sheet_label = str(t.get("name") or f"ensemble_{idx + 1}")[:31]
                df_ens = pd.DataFrame(t.get("data", []), columns=t.get("columns"))
                df_ens.to_excel(writer, sheet_name=sheet_label, index=False)

    # ====================================================================


def _write_doc_sheets(
    writer: pd.ExcelWriter,
    *,
    include_meta_sheets: bool,
    qc_notes: list[dict[str, Any]] | None,
    include_readme: bool,
) -> None:
    """说明类 sheet：qc_notes 与 readme（软件版本、导出时间、数据标准、R 生态兼容）。"""
    # 5. qc_notes Sheet (Optional)
    # ====================================================================
    if include_meta_sheets and qc_notes:
        df_qc = pd.DataFrame(qc_notes)
        df_qc.to_excel(writer, sheet_name="qc_notes", index=False)

    # ====================================================================
    # 6. readme Sheet (Optional)
    # ====================================================================
    if include_meta_sheets and include_readme:
        readme_data = [
            {
                "Item": "Software",
                "Description": "Straditize Pro v2.0 (Modern Geological Stratigraphic Digitizer)",
            },
            {
                "Item": "Export Timestamp",
                "Description": datetime.now(timezone.utc).isoformat(),
            },
            {
                "Item": "Pollen Matrix Standard",
                "Description": "Depths in 1st column. Unobserved taxa strictly filled as 0.00 (never NA).",
            },
            {
                "Item": "LiPD Compatibility",
                "Description": "Conforms to Linked Paleo Data (LiPD) & PaCTS community standards.",
            },
            {
                "Item": "R Ecosystem",
                "Description": "Compatible with rioja::strat.plot, vegan, and geoChronR.",
            },
        ]
        df_readme = pd.DataFrame(readme_data)
        df_readme.to_excel(writer, sheet_name="readme", index=False)
