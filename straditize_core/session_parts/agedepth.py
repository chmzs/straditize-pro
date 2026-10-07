"""Age-depth session mixin managing chronological harmonization and modeling."""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image

from ..age_depth import (
    AgeDepthAxisCalibrator,
    AgeDepthModel,
    check_local_r_environment,
    extract_age_depth_model,
    run_local_bacon as run_local_bacon_func,
)
from ..components import component_manager
from ..protocol import (
    CALIBRATION_ERROR,
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: Rate columns an age-depth export may carry, keyed by the ``predict_age`` field name.
#: The value is a template whose ``{age_unit}`` / ``{depth_unit}`` placeholders are filled
#: at export time, so the unit travels *inside the column name* rather than only in a
#: side-channel that a spreadsheet would drop.
AGE_DEPTH_RATE_COLUMNS: dict[str, str] = {
    "volume_ar_cm_per_yr": "volume_ar (cm per yr; = cm3 cm-2 yr-1)",
    "sed_rate_depth_per_yr": "sed_rate ({depth_unit} per yr)",
    "acc_rate_yr_per_depth": "acc_rate ({age_unit} per {depth_unit})",
    "interval_acc_rate_yr_per_depth": "interval_acc_rate ({age_unit} per {depth_unit})",
    "interval_sed_rate_depth_per_yr": "interval_sed_rate ({depth_unit} per yr)",
}

#: Non-rate columns an age-depth export always carries. Everything not listed here and not
#: in AGE_DEPTH_RATE_COLUMNS is dropped, so a unit-less legacy alias such as
#: ``sed_rate_yr_per_cm`` cannot slip into the dataset as a duplicate of ``acc_rate``.
AGE_DEPTH_BASE_COLUMNS: tuple[str, ...] = ("depths", "age_est", "age_min", "age_max")


def build_age_depth_frame(
    pred: dict[str, Any],
    rate_columns: list[str] | None,
    age_unit: str,
    depth_unit: str,
) -> pd.DataFrame:
    """Builds the exported age-depth table with units embedded in the column names.

    Only :data:`AGE_DEPTH_BASE_COLUMNS` plus the user-selected rates survive. An allow-list
    rather than a deny-list, because the field dict also carries unit-less legacy aliases
    (``sed_rate_yr_per_cm``), ``rate_units``, and nested ``metadata`` that must never reach
    a spreadsheet as columns. Selecting no rates still returns the age columns.
    """
    clean = {k: v for k, v in pred.items() if isinstance(v, (list, tuple))}
    selected = set(rate_columns or [])

    renamed: dict[str, Any] = {}
    for key in AGE_DEPTH_BASE_COLUMNS:
        if key in clean:
            renamed[key] = clean[key]
    for key, template in AGE_DEPTH_RATE_COLUMNS.items():
        if key in selected and key in clean:
            renamed[template.format(age_unit=age_unit, depth_unit=depth_unit)] = clean[
                key
            ]

    units = pred.get("rate_units", {})
    n_rows = len(clean.get("depths", []))
    if selected and units and n_rows:
        # An explicit unit row, so the sheet still states its convention even if a
        # downstream consumer renames the columns.
        renamed["rate_units"] = [
            f"acc={units.get('acc_rate', '')}; vol={units.get('volume_ar', '')}"
        ] * n_rows
    return pd.DataFrame(renamed)


class AgeDepthSessionMixin:
    """Age-depth model diagram loading, calibration, extraction, and Bacon modeling."""

    def load_age_depth_diagram(
        self,
        image_path: str | None = None,
        base64_data: str | None = None,
        sample_key: str | None = None,
    ) -> dict[str, Any]:
        """Loads an age-depth model diagram image into session for chronological harmonization."""
        if sample_key:
            # 内置范例随包分发（pyproject package-data 与 PyInstaller datas 均已登记）。
            sample_dir = (
                Path(__file__).resolve().parent.parent / "assets" / "age_models"
            )
            sample_map = {
                "bacon": str(sample_dir / "bacon_szek.png"),
                "bchron": str(sample_dir / "bchron_stepped.png"),
            }
            image_path = sample_map.get(sample_key.lower())

        if base64_data:
            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]
            raw_bytes = base64.b64decode(base64_data)
            self.age_depth_image = Image.open(io.BytesIO(raw_bytes))
            self.age_depth_image_path = None
        elif image_path and os.path.exists(image_path):
            self.age_depth_image = Image.open(image_path)
            self.age_depth_image_path = os.path.abspath(image_path)
        else:
            raise JsonRpcError(
                FILE_NOT_FOUND_ERROR, f"Age-depth image not found: {image_path}"
            )

        return {
            "status": "loaded",
            "width": self.age_depth_image.width,
            "height": self.age_depth_image.height,
            "has_model": self.age_depth_model is not None,
        }

    def calibrate_and_extract_age_depth(
        self,
        depth_px: list[float],
        depth_vals: list[float],
        age_px: list[float],
        age_vals: list[float],
        roi_box: tuple[float, float, float, float] | None = None,
        curve_type: str = "median",
        envelope_type: str = "95_hpd",
        depth_unit: str = "cm",
        age_unit: str = "cal BP",
        cal_curve: str = "IntCal20",
        notes: str = "",
        depth_range: list[float] | tuple[float, float] | None = None,
        resample_step: float | None = None,
        depth_log: bool = False,
        age_log: bool = False,
        exclude_boxes: list[list[float]] | None = None,
        age_increases_downcore: bool = True,
        age_is_calendar_year: bool = True,
        rate_columns: list[str] | None = None,
        curve_channel: str = "auto",
        calib_markers: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Extracts age-depth curves and the 95% confidence envelope with inspection data."""
        if self.age_depth_image is None:
            raise JsonRpcError(
                STATE_ERROR,
                "No age-depth diagram is loaded in this session. Load the figure first "
                "(agedepth.loadModelDiagram) before calibrating and extracting.",
            )

        calibrator = AgeDepthAxisCalibrator(
            depth_px=depth_px,
            depth_vals=depth_vals,
            age_px=age_px,
            age_vals=age_vals,
            depth_unit=depth_unit,
            age_unit=age_unit,
            depth_log=depth_log,
            age_log=age_log,
        )

        # Rectangular eraser regions supplied by the UI, rasterised into a boolean mask.
        exclude_mask = None
        if exclude_boxes:
            img_w, img_h = self.age_depth_image.size
            exclude_mask = np.zeros((img_h, img_w), dtype=bool)
            for box in exclude_boxes:
                if len(box) != 4:
                    continue
                bx0, by0, bx1, by1 = (int(round(v)) for v in box)
                lo_x, hi_x = sorted((max(0, min(img_w, bx0)), max(0, min(img_w, bx1))))
                lo_y, hi_y = sorted((max(0, min(img_h, by0)), max(0, min(img_h, by1))))
                exclude_mask[lo_y:hi_y, lo_x:hi_x] = True

        model = extract_age_depth_model(
            self.age_depth_image,
            calibrator=calibrator,
            roi_box=roi_box,
            curve_type=curve_type,
            envelope_type=envelope_type,
            cal_curve=cal_curve,
            notes=notes,
            depth_range=depth_range,
            resample_step=resample_step,
            exclude_mask=exclude_mask,
            age_increases_downcore=age_increases_downcore,
            curve_channel=curve_channel,
        )
        self.age_depth_model = model
        self.age_depth_is_calendar_year = bool(age_is_calendar_year)
        self.age_depth_calib_state = {
            "depth_px": [float(v) for v in depth_px],
            "depth_vals": [float(v) for v in depth_vals],
            "age_px": [float(v) for v in age_px],
            "age_vals": [float(v) for v in age_vals],
            "depth_unit": depth_unit,
            "age_unit": age_unit,
            "cal_curve": cal_curve,
            "depth_range": list(depth_range) if depth_range else None,
            "resample_step": float(resample_step)
            if resample_step is not None
            else None,
            "depth_log": bool(depth_log),
            "age_log": bool(age_log),
            "exclude_boxes": [list(b) for b in (exclude_boxes or [])],
            "calib_markers": [dict(m) for m in calib_markers]
            if calib_markers
            else None,
            "notes": notes,
        }
        self.age_depth_rate_columns = [
            c for c in (rate_columns or []) if c in AGE_DEPTH_RATE_COLUMNS
        ]

        # Harmonize with current pollen sample depths if available
        sample_depths = []
        if self.column_points and self.is_calibrated and self.y_scale:
            all_r = sorted(
                {p["row"] for pts in self.column_points.values() for p in pts}
            )
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            sample_depths = [round(sy * r + iy, 2) for r in all_r]
        elif self.depth_grid:
            sample_depths = [round(float(d), 2) for d in self.depth_grid]
        elif len(model.depths) > 0:
            step_stride = max(1, len(model.depths) // 30)
            sample_depths = [round(float(d), 2) for d in model.depths[::step_stride]]

        mapped_samples = model.predict_age(sample_depths) if sample_depths else None

        ensemble_info = None
        if sample_depths and not age_is_calendar_year:
            ensemble_info = {
                "skipped": True,
                "reason": "AGEDEPTH_UNCALIBRATED_14C",
                "message": (
                    "The age axis is uncalibrated 14C, not a calendar timescale. "
                    "Calibrate the dates first; no age ensemble was generated."
                ),
            }
        elif sample_depths:
            model_tag = (
                "Bacon"
                if "bacon" in notes.lower()
                or "bacon" in (self.age_depth_image_path or "").lower()
                else "AgeModel"
            )
            ensemble_table = model.generate_age_ensemble(
                sample_depths=sample_depths,
                n_ensembles=1000,
                name=f"{model_tag}_Ensemble_1000",
                return_diagnostics=True,
            )
            self.ensemble_tables = [
                t
                for t in self.ensemble_tables
                if t.get("name") != ensemble_table["name"]
            ]
            self.ensemble_tables.append(ensemble_table)
            diagnostics = ensemble_table.get("diagnostics", {})
            ensemble_info = {
                "name": ensemble_table["name"],
                "columns_count": len(ensemble_table["columns"]),
                "rows_count": len(ensemble_table["data"]),
                "diagnostics": diagnostics,
            }
            if isinstance(mapped_samples, dict) and diagnostics.get("rate"):
                mapped_samples["rate"] = diagnostics["rate"]

        if mapped_samples and mapped_samples.get("depths"):
            calib_year_ages = mapped_samples.get("age_est", [])
            mapped_samples["px_y"] = [
                round(float(calibrator.depth2px(d)), 1)
                for d in mapped_samples["depths"]
            ]
            mapped_samples["px_x_curve"] = [
                round(float(calibrator.age2px(a)), 1) for a in calib_year_ages
            ]

        return {
            "status": "extracted",
            "inspection": model.to_inspection_data(),
            "mapped_samples": mapped_samples,
            "generated_ensemble": ensemble_info,
        }

    def get_age_depth_inspection(self) -> dict[str, Any]:
        """Returns current age-depth model visual inspection data and metadata."""
        if (
            self.age_depth_model is None
            and getattr(self, "age_depth_image", None) is None
        ):
            return {"has_model": False, "has_image": False}
        return {
            "has_model": self.age_depth_model is not None,
            "has_image": getattr(self, "age_depth_image", None) is not None,
            "image_width": self.age_depth_image.width
            if getattr(self, "age_depth_image", None)
            else 0,
            "image_height": self.age_depth_image.height
            if getattr(self, "age_depth_image", None)
            else 0,
            "calib_state": getattr(self, "age_depth_calib_state", None),
            "inspection": (
                self.age_depth_model.to_inspection_data()
                if self.age_depth_model is not None
                else None
            ),
        }

    def update_age_depth_model(
        self,
        depths: list[float],
        ages: list[float],
        age_min: list[float] | None = None,
        age_max: list[float] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Updates the session age-depth model from user-edited tabular data."""
        if len(depths) < 2 or len(ages) < 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                "Age-depth model requires at least 2 depth-age pairs.",
            )
        if len(depths) != len(ages):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Depths count ({len(depths)}) does not match ages count ({len(ages)}).",
            )
        if age_min is not None and len(age_min) != len(depths):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"age_min count ({len(age_min)}) does not match depths count ({len(depths)}).",
            )
        if age_max is not None and len(age_max) != len(depths):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"age_max count ({len(age_max)}) does not match depths count ({len(depths)}).",
            )

        depths_arr = np.asarray(depths, dtype=float)
        ages_arr = np.asarray(ages, dtype=float)
        s_idx = np.argsort(depths_arr)

        sorted_depths = depths_arr[s_idx]
        sorted_ages = ages_arr[s_idx]
        sorted_min = (
            np.asarray(age_min, dtype=float)[s_idx] if age_min is not None else None
        )
        sorted_max = (
            np.asarray(age_max, dtype=float)[s_idx] if age_max is not None else None
        )

        prev_insp = (
            self.age_depth_model.to_inspection_data()
            if self.age_depth_model is not None
            else {}
        )
        prev_meta = prev_insp.get("metadata", {})
        meta = metadata or {}
        curve_type = meta.get("curve_type", prev_meta.get("curve_type", "median"))
        envelope_type = meta.get(
            "envelope_type", prev_meta.get("envelope_type", "95_hpd")
        )
        depth_unit = meta.get("depth_unit", prev_meta.get("depth_unit", "cm"))
        age_unit = meta.get("age_unit", prev_meta.get("age_unit", "cal BP"))
        cal_curve = meta.get(
            "calibration_curve", prev_meta.get("calibration_curve", "IntCal20")
        )
        notes = meta.get("notes", prev_meta.get("notes", "User edited age-depth table"))

        model = AgeDepthModel(
            depths=sorted_depths,
            ages=sorted_ages,
            age_min=sorted_min,
            age_max=sorted_max,
            curve_type=curve_type,
            envelope_type=envelope_type,
            depth_unit=depth_unit,
            age_unit=age_unit,
            cal_curve=cal_curve,
            notes=notes,
        )

        cs = getattr(self, "age_depth_calib_state", None)
        if (
            cs
            and "depth_px" in cs
            and "age_px" in cs
            and "depth_vals" in cs
            and "age_vals" in cs
        ):
            calibrator = AgeDepthAxisCalibrator(
                depth_px=cs["depth_px"],
                depth_vals=cs["depth_vals"],
                age_px=cs["age_px"],
                age_vals=cs["age_vals"],
                depth_unit=cs.get("depth_unit", depth_unit),
                age_unit=cs.get("age_unit", age_unit),
                depth_log=cs.get("depth_log", False),
                age_log=cs.get("age_log", False),
            )
            model.px_y = np.asarray(calibrator.depth2px(sorted_depths), dtype=float)
            model.px_x_curve = np.asarray(calibrator.age2px(sorted_ages), dtype=float)
            if sorted_min is not None:
                model.px_x_min = np.asarray(calibrator.age2px(sorted_min), dtype=float)
            if sorted_max is not None:
                model.px_x_max = np.asarray(calibrator.age2px(sorted_max), dtype=float)

        self.age_depth_model = model

        sample_depths = []
        if self.column_points and self.is_calibrated and self.y_scale:
            all_r = sorted(
                {p["row"] for pts in self.column_points.values() for p in pts}
            )
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            sample_depths = [round(sy * r + iy, 2) for r in all_r]
        elif self.depth_grid:
            sample_depths = [round(float(d), 2) for d in self.depth_grid]
        elif len(model.depths) > 0:
            step_stride = max(1, len(model.depths) // 30)
            sample_depths = [round(float(d), 2) for d in model.depths[::step_stride]]

        mapped_samples = model.predict_age(sample_depths) if sample_depths else None

        if sample_depths and getattr(self, "age_depth_is_calendar_year", True):
            ensemble_table = model.generate_age_ensemble(
                sample_depths=sample_depths,
                n_ensembles=1000,
                name="AgeModel_Ensemble_1000",
                return_diagnostics=True,
            )
            self.ensemble_tables = [
                t
                for t in self.ensemble_tables
                if t.get("name") != ensemble_table["name"]
            ]
            self.ensemble_tables.append(ensemble_table)

        return {
            "success": True,
            "inspection": model.to_inspection_data(),
            "mapped_samples": mapped_samples,
        }

    def run_local_bacon(
        self,
        dates: list[dict[str, Any]],
        core_name: str = "MyCore",
        thickness: float = 5.0,
        cc: int = 1,
        hiatus_depths: list[float] | None = None,
        slumps: list[tuple[float, float]] | None = None,
        d_r: float | None = None,
        d_std: float | None = None,
        depth_min: float = 0.0,
        depth_max: float = 150.0,
        depth_step: float = 1.0,
    ) -> dict[str, Any]:
        """Runs native local Rscript rbacon simulation and updates current session age-depth model."""
        res = run_local_bacon_func(
            dates=dates,
            core_name=core_name,
            thickness=thickness,
            cc=cc,
            hiatus_depths=hiatus_depths,
            slumps=slumps,
            d_r=d_r,
            d_std=d_std,
            depth_min=depth_min,
            depth_max=depth_max,
            depth_step=depth_step,
        )
        if res.get("success"):
            depths = res.get("depths", [])
            ages = res.get("ages", [])
            age_min = res.get("age_min", [])
            age_max = res.get("age_max", [])
            model = AgeDepthModel(
                depths=depths,
                ages=ages,
                age_min=age_min,
                age_max=age_max,
                curve_type="median",
                envelope_type="95_hpd",
                depth_unit="cm",
                age_unit="cal BP",
                cal_curve="IntCal20" if cc == 1 else f"cc_{cc}",
                notes="Generated by native R rbacon MCMC simulation",
            )
            self.age_depth_model = model

            sample_depths = []
            if self.depth_grid:
                sample_depths = [round(float(d), 2) for d in self.depth_grid]
            elif self.column_points and self.is_calibrated and self.y_scale:
                all_r = sorted(
                    {p["row"] for pts in self.column_points.values() for p in pts}
                )
                sy = self.y_scale["slope"]
                iy = self.y_scale["intercept"]
                sample_depths = [round(sy * r + iy, 2) for r in all_r]

            mapped_samples = model.predict_age(sample_depths) if sample_depths else None
            res["inspection"] = model.to_inspection_data()
            res["mapped_samples"] = mapped_samples

            if sample_depths:
                ens_table = model.generate_age_ensemble(
                    sample_depths=sample_depths,
                    n_ensembles=1000,
                    name="Bacon_Native_Ensemble_1000",
                )
                self.ensemble_tables = [
                    t
                    for t in self.ensemble_tables
                    if t.get("name") != ens_table["name"]
                ]
                self.ensemble_tables.append(ens_table)
                res["generated_ensemble"] = {
                    "name": ens_table["name"],
                    "columns_count": len(ens_table["columns"]),
                    "rows_count": len(ens_table["data"]),
                }

        return res

    def run_age_modeling(
        self,
        dates: list[dict[str, Any]],
        core_name: str = "MyCore",
        thickness: float = 5.0,
        cc: int = 1,
        hiatus_depths: list[float] | None = None,
        slumps: list[tuple[float, float]] | None = None,
        d_r: float | None = None,
        d_std: float | None = None,
        depth_min: float = 0.0,
        depth_max: float = 150.0,
        depth_step: float = 1.0,
    ) -> dict[str, Any]:
        """Workflow matching execution hierarchy."""
        r_env = check_local_r_environment()
        if r_env.get("has_r") and r_env.get("has_rbacon"):
            return self.run_local_bacon(
                dates=dates,
                core_name=core_name,
                thickness=thickness,
                cc=cc,
                hiatus_depths=hiatus_depths,
                slumps=slumps,
                d_r=d_r,
                d_std=d_std,
                depth_min=depth_min,
                depth_max=depth_max,
                depth_step=depth_step,
            )

        status = component_manager.get_status("age-modeling")
        if status.get("is_installed"):
            return {
                "success": True,
                "backend": "webr",
                "code": "AGEDEPTH_WEBR_READY",
                "message": "WebR add-on is installed; computation runs in-browser via WASM.",
                "component_status": status,
            }

        return {
            "success": False,
            "need_installation": True,
            "has_local_r": r_env.get("has_r", False),
            "has_rbacon": False,
            "r_version": r_env.get("r_version"),
            "component_status": status,
            "code": "AGEDEPTH_NO_RBACON",
            "message": (
                "Local rbacon was not detected and the WebR add-on is not installed. "
                "Download the ~40MB add-on, or run install.packages('rbacon')."
            ),
        }

    def generate_age_ensemble(
        self,
        n_ensembles: int = 1000,
        name: str | None = None,
    ) -> dict[str, Any]:
        """Generates native Age Ensemble Table from the current age-depth model and mounts it into session."""
        if self.age_depth_model is None:
            raise JsonRpcError(
                CALIBRATION_ERROR, "No age-depth model extracted in current session."
            )

        sample_depths = []
        if self.column_points and self.is_calibrated and self.y_scale:
            all_r = sorted(
                {p["row"] for pts in self.column_points.values() for p in pts}
            )
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            sample_depths = [round(sy * r + iy, 2) for r in all_r]
        elif self.depth_grid:
            sample_depths = self.depth_grid
        else:
            sample_depths = self.age_depth_model.depths.tolist()

        table_name = name or f"Age_Ensemble_{n_ensembles}"
        table = self.age_depth_model.generate_age_ensemble(
            sample_depths=sample_depths,
            n_ensembles=n_ensembles,
            name=table_name,
        )

        self.ensemble_tables = [
            t for t in self.ensemble_tables if t.get("name") != table_name
        ]
        self.ensemble_tables.append(table)

        return {
            "success": True,
            "table_name": table_name,
            "columns": table["columns"][:5]
            + [f"... (+{len(table['columns']) - 5} cols)"],
            "rows_count": len(table["data"]),
            "total_ensembles": len(self.ensemble_tables),
        }


AgeDepthMixin = AgeDepthSessionMixin
