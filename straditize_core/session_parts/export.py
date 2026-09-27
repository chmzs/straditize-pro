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

from ..metadata.exporter_xlsx import export_scientific_xlsx
from ..metadata.exporter_lipd import export_lipd_jsonld


class ExportMixin:
    """Session mixin for multi-ROI chunked tabular exports (CSV/TSV/LiPD/XLSX/TAR)."""

    def _init_export(self) -> None:
        """Initialize export state."""
        pass

    def get_roi_dataframes(self) -> dict[str, pd.DataFrame]:
        """Construct a pandas DataFrame for each ROI.

        Rules:
        - Sheet/Table name is strictly the ROI name (supports unicode / Chinese, e.g. '花粉');
        - Columns within each ROI do NOT contain ROI prefixes (Contract §4.2);
        - First column is 'depth' (calibrated depth or row pixel if uncalibrated);
        - Readings strictly derived from x_ticks (Contract §4: valueAtX);
        - Missing/unobserved ink values are strictly 0.0 (Zero-Abundance standard).
        """
        rois = getattr(self, "rois", [])
        if not rois:
            # Fallback for single ROI without explicit rois list
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

            # Filter columns belonging to this ROI
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

            # If no columns, produce DataFrame with depth only or empty
            if not roi_cols:
                if samples:
                    depths = [s.get("depth", s.get("row_px")) for s in samples]
                    roi_dfs[roi_name] = pd.DataFrame({"depth": depths})
                else:
                    roi_dfs[roi_name] = pd.DataFrame({"depth": []})
                continue

            # Determine row list for sampling
            if samples:
                row_list = [int(round(s.get("row_px", 0))) for s in samples]
                depth_list = [s.get("depth") for s in samples]
                # If calibrated but sample depth is None, derive it
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
                # Harvest from column_points across this ROI's columns
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

            # Calculate readings for each column (without ROI prefix)
            for idx, col in enumerate(roi_cols):
                c_idx = col.get("col_index", idx)
                # Strict: column name does NOT contain ROI prefix
                col_name = (
                    col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"
                )

                x_ticks = col.get("x_ticks")
                if x_ticks and len(x_ticks) >= 2:
                    px0 = float(x_ticks[0].get("px", 0.0))
                    val0 = float(x_ticks[0].get("value", 0.0))
                    px1 = float(x_ticks[1].get("px", 0.0))
                    val1 = float(x_ticks[1].get("value", 0.0))
                    has_ticks = True
                else:
                    px0 = float(col.get("startX", col.get("start", 0.0)))
                    px1 = float(col.get("endX", col.get("end", px0 + 100.0)))
                    val0 = 0.0
                    val1 = 100.0
                    has_ticks = False

                pts = column_points.get(c_idx, [])
                p_dict = {p["row"]: p["x"] for p in pts}
                c_start_px = float(col.get("startX", col.get("start", px0)))
                scale_type = col.get("scale_type", "linear")

                vals: list[float] = []
                for r in row_list:
                    if r in p_dict:
                        raw_x = p_dict[r]
                    else:
                        raw_x = c_start_px

                    if abs(raw_x - c_start_px) < 1e-6:
                        val = 0.0
                    else:
                        span = px1 - px0
                        if abs(span) > 1e-9:
                            if has_ticks:
                                if scale_type == "log" and val0 > 0 and val1 > 0:
                                    log_v = np.log10(val0) + (raw_x - px0) / span * (
                                        np.log10(val1) - np.log10(val0)
                                    )
                                    val = float(10**log_v)
                                else:
                                    val = float(
                                        val0 + (raw_x - px0) / span * (val1 - val0)
                                    )
                            else:
                                val = float((raw_x - px0) / span * 100.0)
                        else:
                            val = 0.0

                        exag = col.get("exaggeration_mult")
                        if exag is not None and float(exag) > 1.0:
                            val = val / float(exag)

                    vals.append(round(max(0.0, val), 4))

                data_dict[col_name] = vals

            roi_dfs[roi_name] = pd.DataFrame(data_dict)

        return roi_dfs

    def get_export_readiness(self) -> dict[str, Any]:
        """Compute the Export Readiness checklist for all ROIs.

        Rules:
        - Check if ROI has been user-named via `name_source == 'user'`.
          If `name_source == 'default'`, it MUST be listed in readiness_missing.
        - Check if ROI contains columns. If empty, listed in readiness_missing.
        - Returns sheets list, primary_roi name, and missing list.
        """
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

            # Missing if name is still default or has no columns
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
        """Exports standard POSIX UStar .tar project archive with multi-ROI support.

        Invariants:
        1. data/<roi名>.csv per ROI (supports UTF-8 / Chinese filenames);
        2. data.csv strictly matches primary_roi_id content;
        3. plot_strat.R contains a dedicated plotting section for each ROI.
        """
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
            # 1. manifest.json
            m_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            # 2. image/original.png (if exists)
            img = getattr(self, "image", None)
            if img is not None:
                img_bio = io.BytesIO()
                img.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            # 3. data/<roi名>.csv per ROI
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

                # Add data/<roi名>.csv
                csv_filename = f"data/{roi_name}.csv"
                ti_roi_csv = tarfile.TarInfo(name=csv_filename)
                ti_roi_csv.size = len(csv_bytes)
                ti_roi_csv.mtime = int(time.time())
                tf.addfile(ti_roi_csv, io.BytesIO(csv_bytes))

                if roi_name == primary_roi_name:
                    primary_csv_bytes = csv_bytes

                # Append per-ROI R script block
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

            # 4. data.csv strictly matching primary_roi_id
            if not primary_csv_bytes and roi_dfs:
                primary_csv_bytes = (
                    list(roi_dfs.values())[0].to_csv(index=False).encode("utf-8")
                )

            ti_data_csv = tarfile.TarInfo(name="data.csv")
            ti_data_csv.size = len(primary_csv_bytes)
            ti_data_csv.mtime = int(time.time())
            tf.addfile(ti_data_csv, io.BytesIO(primary_csv_bytes))

            # 5. plot_strat.R
            r_script_bytes = "\n".join(r_scripts).encode("utf-8")
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script_bytes)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script_bytes))

            # 6. README.txt
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
            # Predict age using first ROI's depth series
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
                if getattr(age_depth_model, "has_envelope", False) and not any(t.get("name") == "Age_Uncertainty_U1000" for t in ensemble_tables):
                    try:
                        ens = age_depth_model.generate_age_ensemble(
                            sample_depths=depths,
                            n_ensembles=1000,
                            name="Age_Uncertainty_U1000",
                        )
                        if ens and ens.get("data"):
                            ensemble_tables = list(ensemble_tables) + [ens]
                    except Exception as ex:
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

        lipd_jsonld = export_lipd_jsonld(
            meta_info=paper_meta,
            pollen_df=None,
            roi_dfs=roi_dfs,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
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
