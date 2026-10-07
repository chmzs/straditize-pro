"""Export session mixin (T10: Multi-ROI chunked scientific tabular exports).

Strictly adheres to:
- Frozen Contracts v1.3 §2.6 (primary_roi_id) & §4.2 (Export Mapping);
- Redesign Specification §4.2 & §5.3;
- POSIX UStar .tar archiving with data/<roi>.csv per ROI and data.csv matching primary_roi_id.
"""

from __future__ import annotations

import base64
import io
import json
import os
import tarfile
import time
from typing import Any

import numpy as np
import pandas as pd

from ..metadata import (
    export_lipd_package,
)
from ..metadata.exporter_lipd import export_lipd_jsonld
from ..metadata.exporter_xlsx import export_scientific_xlsx
from ..protocol import (
    CALIBRATION_ERROR,
    EXPORT_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)
from .agedepth import build_age_depth_frame
from .xscale import resolve_column_scale


class ExportMixin:
    """Session mixin for multi-ROI chunked tabular exports (CSV/TSV/LiPD/XLSX/TAR)."""

    def _init_export(self) -> None:
        """Initialize export state."""
        pass

    def get_roi_dataframes(self) -> dict[str, pd.DataFrame]:
        """Construct a pandas DataFrame for each ROI."""
        rois = getattr(self, "rois", [])
        if not rois:
            rois = [{"id": "pollen", "name": "pollen", "name_source": "default"}]

        all_columns = getattr(self, "columns", [])
        samples = getattr(self, "samples", [])
        column_points = getattr(self, "column_points", {})
        is_calibrated = getattr(self, "is_calibrated", False)
        y_scale = getattr(self, "y_scale", None)

        roi_dfs: dict[str, pd.DataFrame] = {}

        for roi in rois:
            roi_id = roi["id"]
            roi_name = roi.get("name", roi_id)

            roi_cols = [
                c
                for c in all_columns
                if c.get("roi_id") == roi_id
                or (
                    not c.get("roi_id")
                    and (
                        len(rois) <= 1
                        or roi_id == getattr(self, "primary_roi_id", None)
                    )
                )
            ]

            if not roi_cols:
                if samples:
                    depths = [s.get("depth", s.get("row_px")) for s in samples]
                    roi_dfs[roi_name] = pd.DataFrame({"depth": depths})
                else:
                    roi_dfs[roi_name] = pd.DataFrame({"depth": []})
                continue

            if samples:
                row_list = [int(round(s.get("row_px", 0))) for s in samples]
                depth_list = [s.get("depth") for s in samples]
                if is_calibrated and y_scale:
                    depth_list = [
                        d
                        if d is not None
                        else round(
                            y_scale.get("slope", 0.0) * r
                            + y_scale.get("intercept", 0.0),
                            4,
                        )
                        for r, d in zip(row_list, depth_list)
                    ]
            else:
                c_indices = {c.get("col_index", idx) for idx, c in enumerate(roi_cols)}
                pts_rows = set()
                for c_idx in c_indices:
                    if c_idx in column_points:
                        pts_rows.update(p["row"] for p in column_points[c_idx])
                row_list = sorted(pts_rows) if pts_rows else [0]
                if is_calibrated and y_scale:
                    depth_list = [
                        round(
                            y_scale.get("slope", 0.0) * r
                            + y_scale.get("intercept", 0.0),
                            4,
                        )
                        for r in row_list
                    ]
                else:
                    depth_list = row_list

            data_dict: dict[str, Any] = {"depth": depth_list}

            taxa_names = getattr(self, "taxa_names", None) or []
            for idx, col in enumerate(roi_cols):
                c_idx = col.get("col_index", idx)
                if taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx]:
                    col_name = taxa_names[c_idx]
                else:
                    col_name = (
                        col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"
                    )

                scale = resolve_column_scale(self, col, c_idx)
                pts = column_points.get(c_idx, [])
                p_dict = {p["row"]: p["x"] for p in pts}
                c_start_px = float(col.get("startX", col.get("start", scale.abs_px0)))

                vals = [
                    scale.px_to_value(
                        p_dict.get(r, c_start_px),
                        baseline_px=c_start_px,
                        col_name=col_name,
                        ndigits=4,
                    )
                    for r in row_list
                ]

                data_dict[col_name] = vals

            roi_dfs[roi_name] = pd.DataFrame(data_dict)

        return roi_dfs

    def get_export_readiness(self) -> dict[str, Any]:
        """Compute the Export Readiness checklist for all ROIs."""
        rois = getattr(self, "rois", [])
        if not rois:
            rois = [{"id": "pollen", "name": "pollen", "name_source": "default"}]

        all_columns = getattr(self, "columns", [])
        primary_roi_id = getattr(self, "primary_roi_id", None) or rois[0]["id"]
        primary_roi_name = next(
            (r.get("name", r["id"]) for r in rois if r["id"] == primary_roi_id),
            rois[0].get("name", "pollen"),
        )

        sheets = [r.get("name", r["id"]) for r in rois]
        missing_rois: list[str] = []

        for r in rois:
            r_id = r["id"]
            r_name = r.get("name", r_id)
            name_source = r.get("name_source", "default")
            cols = [c for c in all_columns if c.get("roi_id") == r_id]

            if name_source == "default" or len(cols) == 0:
                missing_rois.append(r_name)

        return {
            "sheets": sheets,
            "primary_roi": primary_roi_name,
            "primary_roi_id": primary_roi_id,
            "readiness_missing": missing_rois,
            "total_rois": len(rois),
            "ready": len(missing_rois) == 0,
        }

    def export_multi_tar(self, output_path: str | None = None) -> dict[str, Any]:
        """Exports standard POSIX UStar .tar project archive with multi-ROI support."""
        roi_dfs = self.get_roi_dataframes()
        rois = getattr(self, "rois", [])
        primary_roi_id = getattr(self, "primary_roi_id", None) or (
            rois[0]["id"] if rois else "pollen"
        )
        primary_roi_name = next(
            (r.get("name", r["id"]) for r in rois if r["id"] == primary_roi_id),
            list(roi_dfs.keys())[0] if roi_dfs else "pollen",
        )

        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
            "primary_roi_id": primary_roi_id,
            "primary_roi": primary_roi_name,
            "rois": [r.get("name", r.get("id")) for r in rois],
        }

        tar_bio = io.BytesIO()
        with tarfile.open(fileobj=tar_bio, mode="w") as tf:
            m_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            img = getattr(self, "image", None)
            if img is not None:
                img_bio = io.BytesIO()
                img.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            primary_csv_bytes: bytes = b""
            r_scripts: list[str] = [
                "# ==============================================================================",
                "# Straditize Pro - Multi-ROI Stratigraphic Diagram Plotting Script",
                "# Generated automatically by Straditize v2.0 (straditize pro)",
                "# Requires R package 'rioja' (install.packages('rioja'))",
                "# ==============================================================================\n",
                "if (!requireNamespace('rioja', quietly = TRUE)) install.packages('rioja')",
                "library(rioja)\n",
            ]

            for roi_name, df in roi_dfs.items():
                csv_str = df.to_csv(index=False)
                csv_bytes = csv_str.encode("utf-8")

                csv_filename = f"data/{roi_name}.csv"
                ti_roi_csv = tarfile.TarInfo(name=csv_filename)
                ti_roi_csv.size = len(csv_bytes)
                ti_roi_csv.mtime = int(time.time())
                tf.addfile(ti_roi_csv, io.BytesIO(csv_bytes))

                if roi_name == primary_roi_name:
                    primary_csv_bytes = csv_bytes

                r_scripts.append(f"# --- ROI: {roi_name} ---")
                r_scripts.append(f"if (file.exists('{csv_filename}')) {{")
                r_scripts.append(
                    f"  df_{roi_name} <- read.csv('{csv_filename}', check.names = FALSE)"
                )
                r_scripts.append(f"  if (ncol(df_{roi_name}) > 1) {{")
                r_scripts.append(
                    f"    strat.plot(df_{roi_name}[-1], yvar = df_{roi_name}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.line = TRUE, title = '{roi_name}')"
                )
                r_scripts.append("  }")
                r_scripts.append("}\n")

            if not primary_csv_bytes and roi_dfs:
                primary_csv_bytes = (
                    list(roi_dfs.values())[0].to_csv(index=False).encode("utf-8")
                )

            ti_data_csv = tarfile.TarInfo(name="data.csv")
            ti_data_csv.size = len(primary_csv_bytes)
            ti_data_csv.mtime = int(time.time())
            tf.addfile(ti_data_csv, io.BytesIO(primary_csv_bytes))

            r_script_bytes = "\n".join(r_scripts).encode("utf-8")
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script_bytes)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script_bytes))

            readme = (
                f"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                f"================================================================\n"
                f"Primary ROI: {primary_roi_name}\n"
                f"Total ROIs: {len(roi_dfs)}\n\n"
                f"Files:\n"
                f"data.csv             - Primary ROI dataset ({primary_roi_name})\n"
                f"data/<roi>.csv       - Per-ROI isolated scientific CSV tables\n"
                f"plot_strat.R         - R plotting script with sections for each ROI\n"
                f"manifest.json        - Version metadata and ROI hierarchy\n"
            ).encode("utf-8")
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))

        tar_bytes = tar_bio.getvalue()
        if output_path:
            out_dir = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {
                "path": os.path.abspath(output_path),
                "size": len(tar_bytes),
                "success": True,
            }

        b64_tar = base64.b64encode(tar_bytes).decode("ascii")
        return {
            "data": b64_tar,
            "tar_base64": b64_tar,
            "size": len(tar_bytes),
            "success": True,
        }

    def export_multi_xlsx(
        self,
        output_path: str | None = None,
        include_meta_sheets: bool = True,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
        include_readme: bool = True,
    ) -> dict[str, Any]:
        """Exports calibrated multi-ROI sheets into an Excel workbook."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            if "depth" in first_df.columns:
                depths = first_df["depth"].tolist()
                pred = age_depth_model.predict_age(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_min": pred.get("age_min", []),
                        "age_max": pred.get("age_max", []),
                    }
                )
                if getattr(age_depth_model, "has_envelope", False) and not any(
                    t.get("name") == "Age_Uncertainty_U1000" for t in ensemble_tables
                ):
                    try:
                        ens = age_depth_model.generate_age_ensemble(
                            sample_depths=depths,
                            n_ensembles=1000,
                            name="Age_Uncertainty_U1000",
                        )
                        if ens and ens.get("data"):
                            ensemble_tables = list(ensemble_tables) + [ens]
                    except Exception:
                        pass

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t for t in ensemble_tables if t.get("name") in include_ensemble_names
            ]
        elif ensemble_tables:
            selected_ensembles = ensemble_tables

        xlsx_bytes = export_scientific_xlsx(
            meta_info=paper_meta,
            pollen_df=None,
            roi_dfs=roi_dfs,
            include_meta_sheets=include_meta_sheets,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            include_readme=include_readme,
            output_path=output_path,
        )

        return {
            "success": True,
            "size_bytes": len(xlsx_bytes),
            "output_path": os.path.abspath(output_path) if output_path else None,
            "data": xlsx_bytes if not output_path else None,
        }

    def export_multi_lipd(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """Exports Linked Paleo Data (LiPD) JSON-LD structure with per-ROI measurement tables."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            if "depth" in first_df.columns:
                depths = first_df["depth"].tolist()
                pred = age_depth_model.predict_age(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_min": pred.get("age_min", []),
                        "age_max": pred.get("age_max", []),
                    }
                )

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t for t in ensemble_tables if t.get("name") in include_ensemble_names
            ]
        elif ensemble_tables:
            selected_ensembles = ensemble_tables

        col_units: dict[str, str] = {}
        taxa_names = getattr(self, "taxa_names", None) or []
        for idx, col in enumerate(getattr(self, "columns", [])):
            c_idx = col.get("col_index", idx)
            c_name = (
                taxa_names[c_idx]
                if (taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx])
                else (col.get("name") or col.get("species") or f"col{c_idx + 1:02d}")
            )
            col_units[c_name] = resolve_column_scale(self, col, c_idx).unit

        lipd_jsonld = export_lipd_jsonld(
            meta_info=paper_meta,
            pollen_df=None,
            roi_dfs=roi_dfs,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            column_units=col_units,
            depth_unit=getattr(self, "depth_unit", "cm") or "cm",
        )

        if output_path:
            out_dir = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(lipd_jsonld, f, indent=2, ensure_ascii=False)
            return {
                "success": True,
                "output_path": os.path.abspath(output_path),
                "lipd": lipd_jsonld,
            }

        return {"success": True, "lipd": lipd_jsonld}

    def calibrate_axes(
        self,
        y_marks: list[dict[str, float]],
        x_marks: list[dict[str, float]] | None = None,
        unit: str | None = None,
    ) -> dict[str, Any]:
        """Calibrates pixel coordinates into scientific depth/age and percentage units."""
        if not y_marks or len(y_marks) < 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                "y_marks must contain at least 2 calibration points: [{'pixel': p, 'val': v}, ...]",
            )

        y_pixels = np.array(
            [m.get("pixel") if "pixel" in m else m.get("px") for m in y_marks],
            dtype=float,
        )
        y_vals = np.array(
            [m.get("val") if "val" in m else m.get("value") for m in y_marks],
            dtype=float,
        )

        if np.all(y_pixels == y_pixels[0]):
            raise JsonRpcError(
                INVALID_PARAMS, "Y calibration pixels cannot all be identical"
            )

        slope_y, intercept_y = np.polyfit(y_pixels, y_vals, deg=1)
        self.y_scale = {"slope": float(slope_y), "intercept": float(intercept_y)}

        ordered = sorted(
            zip(y_pixels.tolist(), y_vals.tolist()), key=lambda pair: pair[0]
        )
        self.depth_calib = {
            "top_px": float(ordered[0][0]),
            "top_cm": float(ordered[0][1]),
            "bottom_px": float(ordered[-1][0]),
            "bottom_cm": float(ordered[-1][1]),
        }
        if unit:
            self.depth_unit = str(unit).strip() or self.depth_unit
        self.depth_calib["unit"] = self.depth_unit

        self.x_scales = {}
        if x_marks:
            col_groups: dict[int, list[dict[str, float]]] = {}
            for xm in x_marks:
                c_idx = int(xm.get("col_index", 0))
                col_groups.setdefault(c_idx, []).append(xm)

            for c_idx, marks in col_groups.items():
                if len(marks) >= 2:
                    xp = np.array([m["pixel"] for m in marks], dtype=float)
                    xv = np.array([m["val"] for m in marks], dtype=float)
                    sx, ix = np.polyfit(xp, xv, deg=1)
                    self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}
                elif (
                    len(marks) == 1
                    and getattr(self, "columns", None)
                    and c_idx < len(self.columns)
                ):
                    col_start = self.columns[c_idx]["start"]
                    xp = float(marks[0]["pixel"])
                    xv = float(marks[0]["val"])
                    span = max(1.0, xp - col_start)
                    sx = xv / span
                    self.x_scales[c_idx] = {
                        "slope": float(sx),
                        "intercept": float(-sx * col_start),
                    }

        columns = getattr(self, "columns", [])
        for c_idx, col in enumerate(columns):
            if c_idx not in self.x_scales:
                col_w = max(1.0, col["end"] - col["start"])
                sx = 100.0 / col_w
                ix = -sx * col["start"]
                self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}

        self.is_calibrated = True
        return {
            "status": "calibrated",
            "y_scale": self.y_scale,
            "x_scales": {str(k): v for k, v in self.x_scales.items()},
        }

    def export_data(
        self,
        format: str = "csv",
        strict: bool = False,
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """Exports the calibrated data matrix to CSV or Parquet format."""
        if not getattr(self, "column_points", None):
            if getattr(self, "control_points", None) and any(
                self.control_points.values()
            ):
                all_r = sorted(
                    {r for ctrls in self.control_points.values() for r in ctrls}
                )
                for c_idx in range(len(getattr(self, "columns", []))):
                    ctrls = self.control_points.get(c_idx, {})
                    c_start = float(self.columns[c_idx].get("start", 0))
                    self.column_points[c_idx] = [
                        {"row": r, "x": float(ctrls.get(r, c_start))} for r in all_r
                    ]
            elif (
                getattr(self, "columns", None)
                and getattr(self, "image", None) is not None
            ):
                for col in self.columns:
                    try:
                        self.digitize(col["col_index"])
                    except (ValueError, KeyError, RuntimeError, JsonRpcError):
                        pass
            elif getattr(self, "columns", None) and getattr(self, "data_ylim", None):
                y0, y1 = int(self.data_ylim[0]), int(self.data_ylim[1])
                sample_rows = list(range(y0, y1 + 1, max(1, (y1 - y0) // 50)))
                for c_idx in range(len(self.columns)):
                    c_start = float(self.columns[c_idx].get("start", 0))
                    self.column_points[c_idx] = [
                        {"row": r, "x": c_start} for r in sample_rows
                    ]

        if not getattr(self, "column_points", None):
            raise JsonRpcError(STATE_ERROR, "No digitized data available to export.")

        fmt = format.lower()
        if fmt not in ("csv", "parquet"):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Unsupported export format '{format}'. Use 'csv' or 'parquet'.",
            )

        if strict and not getattr(self, "is_calibrated", False):
            raise JsonRpcError(
                CALIBRATION_ERROR,
                "Axes calibration is required when strict=True.",
            )

        samples = getattr(self, "samples", None) or []
        if samples:
            all_rows = [int(round(s.get("row_px", 0))) for s in samples]
            raw_depths = [s.get("depth") for s in samples]
            if (
                getattr(self, "is_calibrated", False)
                and getattr(self, "y_scale", None) is not None
            ):
                sy = self.y_scale["slope"]
                iy = self.y_scale["intercept"]
                depth_series = [
                    round(float(d), 4) if d is not None else round(sy * r + iy, 4)
                    for r, d in zip(all_rows, raw_depths)
                ]
            else:
                depth_series = [
                    d if d is not None else r for r, d in zip(all_rows, raw_depths)
                ]
        else:
            all_rows = sorted(
                {p["row"] for pts in self.column_points.values() for p in pts}
            )
            if not all_rows:
                all_rows = [0]

            if (
                getattr(self, "is_calibrated", False)
                and getattr(self, "y_scale", None) is not None
            ):
                sy = self.y_scale["slope"]
                iy = self.y_scale["intercept"]
                depth_series = [round(sy * r + iy, 4) for r in all_rows]
            else:
                depth_series = all_rows

        data_dict: dict[str, Any] = {"depth": depth_series}

        if getattr(self, "age_depth_model", None) is not None:
            age_pred = self.age_depth_model.predict_age(depth_series)
            data_dict["age_est"] = age_pred["age_est"]
            data_dict["age_min_95"] = age_pred["age_min"]
            data_dict["age_max_95"] = age_pred["age_max"]

        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        for c_idx in sorted(self.column_points.keys()):
            col_def = columns[c_idx] if c_idx < len(columns) else {}
            if taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx]:
                col_name = taxa_names[c_idx]
            else:
                col_name = (
                    col_def.get("name")
                    or col_def.get("species")
                    or f"col{c_idx + 1:02d}"
                )

            pts = self.column_points[c_idx]
            p_dict = {p["row"]: p["x"] for p in pts}
            default_start = float(col_def.get("startX", col_def.get("start", 0.0)))
            raw_x = [p_dict.get(r, default_start) for r in all_rows]

            scale = resolve_column_scale(self, col_def, c_idx)
            data_dict[col_name] = [
                scale.px_to_value(
                    x,
                    baseline_px=default_start,
                    strict=strict,
                    col_name=col_name,
                    ndigits=4,
                )
                for x in raw_x
            ]

        df = pd.DataFrame(data_dict)

        csv_string: str | None = None
        saved_path: str | None = None

        if fmt == "csv":
            csv_string = df.to_csv(index=False)
            if output_path:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(csv_string)
                saved_path = os.path.abspath(output_path)
        elif fmt == "parquet":
            if not output_path:
                raise JsonRpcError(
                    EXPORT_ERROR,
                    "Parquet export requires 'output_path' parameter.",
                )
            try:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                df.to_parquet(output_path, index=False)
                saved_path = os.path.abspath(output_path)
            except Exception as pe:  # noqa: BLE001
                raise JsonRpcError(
                    EXPORT_ERROR,
                    f"Failed to export parquet (ensure pyarrow/fastparquet is installed): {pe}",
                )

        return {
            "format": fmt,
            "strict": strict,
            "rows_count": len(df),
            "columns_count": len(df.columns),
            "columns": list(df.columns),
            "data": df.head(50).to_dict(orient="records"),
            "file_path": saved_path,
            "path": saved_path,
            "csv": csv_string,
            "csv_content": csv_string,
        }

    def batch_set_taxa(self, names: list[str]) -> dict[str, Any]:
        """Batch sets or updates taxa names for diagram columns."""
        if not isinstance(names, list) or not all(
            isinstance(n, (str, int, float)) for n in names
        ):
            raise JsonRpcError(
                INVALID_PARAMS, "Parameter 'names' must be a list of strings."
            )

        clean_names = [str(n).strip() for n in names]
        self.taxa_names = clean_names

        columns = getattr(self, "columns", [])
        for idx, col in enumerate(columns):
            if idx < len(clean_names):
                col["name"] = clean_names[idx]
            else:
                col.setdefault("name", f"col_{idx}")

        return {
            "taxa": self.taxa_names,
            "count": len(self.taxa_names),
        }

    def apply_depth_grid(
        self,
        depths: list[float] | None = None,
        start_depth: float | None = None,
        end_depth: float | None = None,
        step: float | None = None,
    ) -> dict[str, Any]:
        """Generates and sets a global geological sampling depth grid."""
        if depths is not None:
            if not isinstance(depths, list) or len(depths) == 0:
                raise JsonRpcError(
                    INVALID_PARAMS, "'depths' must be a non-empty list of numbers."
                )
            try:
                grid = [round(float(d), 4) for d in depths]
            except (ValueError, TypeError) as e:
                raise JsonRpcError(INVALID_PARAMS, f"Invalid value in 'depths': {e}")
        elif start_depth is not None and end_depth is not None and step is not None:
            try:
                s = float(start_depth)
                e = float(end_depth)
                st = float(step)
            except (ValueError, TypeError) as ex:
                raise JsonRpcError(
                    INVALID_PARAMS, f"Invalid start_depth, end_depth, or step: {ex}"
                )

            if st <= 0:
                raise JsonRpcError(INVALID_PARAMS, "Parameter 'step' must be positive.")
            if s == e:
                grid = [round(s, 4)]
            elif e > s:
                num_steps = int(np.floor((e - s) / st + 1e-6))
                grid = [round(float(s + i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] < e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
            else:
                num_steps = int(np.floor((s - e) / st + 1e-6))
                grid = [round(float(s - i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] > e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
        else:
            raise JsonRpcError(
                INVALID_PARAMS,
                "Either 'depths' list or ('start_depth', 'end_depth', 'step') must be provided.",
            )

        self.depth_grid = grid
        return {
            "depths": self.depth_grid,
            "count": len(self.depth_grid),
        }

    def extract_grid_values(
        self,
        depths: list[float] | None = None,
    ) -> dict[str, Any]:
        """Extracts abundance curves across all taxa along the global depth grid."""
        if not getattr(self, "column_points", None):
            raise JsonRpcError(
                STATE_ERROR,
                "No digitized columns available. Please call core.digitize first.",
            )

        target_depths = (
            depths if depths is not None else getattr(self, "depth_grid", None)
        )
        if not target_depths:
            raise JsonRpcError(
                STATE_ERROR,
                "No depth grid available. Provide 'depths' or call core.applyDepthGrid first.",
            )

        try:
            clean_depths = [float(d) for d in target_depths]
        except (ValueError, TypeError) as e:
            raise JsonRpcError(INVALID_PARAMS, f"Invalid value in depths: {e}")

        col_indices = sorted(self.column_points.keys())
        taxa_labels = []
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        for c_idx in col_indices:
            if taxa_names and c_idx < len(taxa_names):
                taxa_labels.append(taxa_names[c_idx])
            elif c_idx < len(columns) and "name" in columns[c_idx]:
                taxa_labels.append(columns[c_idx]["name"])
            else:
                taxa_labels.append(f"col_{c_idx}")

        matrix: list[list[float]] = []
        records: list[dict[str, Any]] = []

        is_calib = (
            getattr(self, "is_calibrated", False)
            and getattr(self, "y_scale", None) is not None
        )
        if is_calib:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            if sy == 0:
                raise JsonRpcError(
                    CALIBRATION_ERROR, "Invalid y_scale slope (cannot be zero)."
                )

        for d in clean_depths:
            row_vals = []
            row_dict: dict[str, Any] = {"depth": round(d, 4)}

            if is_calib:
                target_pixel_row = (d - iy) / sy
            else:
                target_pixel_row = d

            for c_idx, taxon in zip(col_indices, taxa_labels):
                pts = self.column_points[c_idx]
                p_rows = np.array([p["row"] for p in pts], dtype=float)
                p_x = np.array([p["x"] for p in pts], dtype=float)

                sort_idx = np.argsort(p_rows)
                interp_x = float(
                    np.interp(target_pixel_row, p_rows[sort_idx], p_x[sort_idx])
                )

                col_def = columns[c_idx] if c_idx < len(columns) else {}
                c_start_px = float(col_def.get("startX", col_def.get("start", 0.0)))
                scale = resolve_column_scale(self, col_def, c_idx)
                val = scale.px_to_value(
                    interp_x,
                    baseline_px=c_start_px,
                    col_name=taxon,
                    ndigits=4,
                )

                row_vals.append(val)
                row_dict[taxon] = val

            matrix.append(row_vals)
            records.append(row_dict)

        return {
            "depths": [round(d, 4) for d in clean_depths],
            "taxa": taxa_labels,
            "matrix": matrix,
            "data": records,
            "rows_count": len(matrix),
            "columns_count": len(taxa_labels),
        }

    def export_csv(
        self,
        depths: list[float] | None = None,
        output_path: str | None = None,
    ) -> str | dict[str, Any]:
        """Generates stratigraphic CSV: depth in 1st col, unobserved taxa = 0.0 (Section 八)."""
        res = self.export_data("csv", output_path=output_path)
        if output_path:
            return {"path": output_path, "success": True}
        return res.get("csv", "") if isinstance(res, dict) else str(res)

    def export_tar(self, output_path: str | None = None) -> dict[str, Any]:
        """Exports standard POSIX UStar tar project archive."""
        return self.project_save(output_path=output_path, format="tar")

    def export_r(self, output_path: str | None = None) -> str | dict[str, Any]:
        """Generates R plotting template script using rioja::strat.plot."""
        r_script = (
            "# ==============================================================================\n"
            "# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
            "# Generated automatically by Straditize v2.0 (straditize pro)\n"
            "# Requires R package 'rioja' (install.packages('rioja'))\n"
            "# ==============================================================================\n\n"
            "if (!requireNamespace('rioja', quietly = TRUE)) {\n"
            "  install.packages('rioja', repos = 'https://cloud.r-project.org')\n"
            "}\n"
            "library(rioja)\n\n"
            "data_file <- if (file.exists('data.csv')) 'data.csv' else list.files(pattern = '\\\\.csv$')[1]\n"
            "df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)\n"
            "depth <- df[[1]]\n"
            "taxa_data <- as.matrix(sapply(df[, -1, drop = FALSE], as.numeric))\n"
            "taxa_data[is.na(taxa_data)] <- 0\n\n"
            "pdf('stratigraphic_diagram.pdf', width = 12, height = 8)\n"
            "strat.plot(\n"
            "  d = taxa_data,\n"
            "  yvar = depth,\n"
            "  y.rev = TRUE,\n"
            "  ylabel = 'Depth (cm)',\n"
            "  scale.percent = TRUE,\n"
            "  plot.poly = TRUE,\n"
            "  plot.line = TRUE,\n"
            "  title = 'Stratigraphic Pollen Diagram (Straditize Pro)'\n"
            ")\n"
            "dev.off()\n"
            "message('Diagram successfully rendered: stratigraphic_diagram.pdf')\n"
        )
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(r_script)
            return {"path": output_path, "success": True}
        return r_script

    def export_advanced_xlsx(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
        include_qc: bool = False,
        include_readme: bool = True,
    ) -> dict[str, Any]:
        """Exports calibrated pollen data and metadata into a publication-ready multi-sheet XLSX."""
        pollen_res = self.export_data("csv")
        pollen_csv = (
            pollen_res.get("csv") if isinstance(pollen_res, dict) else str(pollen_res)
        )
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or "depth\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and "depth" in pollen_df.columns
        ):
            depths = pollen_df["depth"].tolist()
            pred = self.age_depth_model.predict_age(depths)
            age_depth_df = build_age_depth_frame(
                pred,
                getattr(self, "age_depth_rate_columns", []),
                self.age_depth_model.age_unit,
                self.age_depth_model.depth_unit,
            )

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t
                for t in getattr(self, "ensemble_tables", [])
                if t["name"] in include_ensemble_names
            ]

        xlsx_bytes = export_scientific_xlsx(
            meta_info=getattr(self, "paper_metadata", {}),
            pollen_df=pollen_df,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            include_readme=include_readme,
            output_path=output_path,
        )

        b64 = base64.b64encode(xlsx_bytes).decode("ascii")
        return {
            "success": True,
            "size_bytes": len(xlsx_bytes),
            "output_path": os.path.abspath(output_path) if output_path else None,
            "base64": b64 if not output_path else None,
        }

    def export_advanced_lipd(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """Exports into Linked Paleo Data (LiPD) .lpd package compliant with LiPDverse."""
        pollen_res = self.export_data("csv")
        pollen_csv = (
            pollen_res.get("csv") if isinstance(pollen_res, dict) else str(pollen_res)
        )
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or "depth\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and "depth" in pollen_df.columns
        ):
            depths = pollen_df["depth"].tolist()
            pred = self.age_depth_model.predict_age(depths)
            age_depth_df = build_age_depth_frame(
                pred,
                getattr(self, "age_depth_rate_columns", []),
                self.age_depth_model.age_unit,
                self.age_depth_model.depth_unit,
            )

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t
                for t in getattr(self, "ensemble_tables", [])
                if t["name"] in include_ensemble_names
            ]

        lipd_jsonld = export_lipd_jsonld(
            meta_info=getattr(self, "paper_metadata", {}),
            pollen_df=pollen_df,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
        )
        pkg_bytes = export_lipd_package(lipd_jsonld, output_path=output_path)

        b64 = base64.b64encode(pkg_bytes).decode("ascii")
        return {
            "success": True,
            "size_bytes": len(pkg_bytes),
            "output_path": os.path.abspath(output_path) if output_path else None,
            "base64": b64 if not output_path else None,
        }
