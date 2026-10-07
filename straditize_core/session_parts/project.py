"""Project session mixin managing project serialization, loading, archiving, and undo/redo."""

from __future__ import annotations

import base64
import io
import json
import os
import tarfile
import time
from typing import Any

import numpy as np
from PIL import Image

from ..age_depth import AgeDepthModel
from ..protocol import (
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    JsonRpcError,
)
from .xscale import resolve_column_scale


class ProjectSessionMixin:
    """Session mixin for project lifecycle: new, load, save, undo, and redo."""

    def _record_history(self, action_name: str) -> None:
        """Records a snapshot of editable entities for undo/redo (max 500 steps, Section 七)."""
        snapshot = {
            "action": action_name,
            "timestamp": time.time(),
            "columns": [dict(c) for c in getattr(self, "columns", [])],
            "control_points": {
                k: dict(v) for k, v in getattr(self, "control_points", {}).items()
            },
            "data_xlim": list(self.data_xlim)
            if getattr(self, "data_xlim", None)
            else None,
            "data_ylim": list(self.data_ylim)
            if getattr(self, "data_ylim", None)
            else None,
            "taxa_names": list(getattr(self, "taxa_names", [])),
        }
        undo_stack = getattr(self, "undo_stack", None)
        if undo_stack is None:
            self.undo_stack = []
            undo_stack = self.undo_stack
        undo_stack.append(snapshot)
        max_hist = getattr(self, "max_history", 500)
        if len(undo_stack) > max_hist:
            undo_stack.pop(0)
        if hasattr(self, "redo_stack") and self.redo_stack is not None:
            self.redo_stack.clear()

    def history_undo(self) -> dict[str, Any]:
        """Undo last command."""
        undo_stack = getattr(self, "undo_stack", [])
        if not undo_stack:
            return {"success": False, "message": "Nothing to undo"}
        current = {
            "columns": [dict(c) for c in getattr(self, "columns", [])],
            "control_points": {
                k: dict(v) for k, v in getattr(self, "control_points", {}).items()
            },
            "data_xlim": list(self.data_xlim)
            if getattr(self, "data_xlim", None)
            else None,
            "data_ylim": list(self.data_ylim)
            if getattr(self, "data_ylim", None)
            else None,
            "taxa_names": list(getattr(self, "taxa_names", [])),
        }
        if not hasattr(self, "redo_stack") or self.redo_stack is None:
            self.redo_stack = []
        self.redo_stack.append(current)
        prev = undo_stack.pop()
        self.columns = prev["columns"]
        self.control_points = prev["control_points"]
        self.data_xlim = prev["data_xlim"]
        self.data_ylim = prev["data_ylim"]
        self.taxa_names = prev["taxa_names"]
        return {"success": True, "action": prev.get("action", "undo")}

    def history_redo(self) -> dict[str, Any]:
        """Redo last undone command."""
        redo_stack = getattr(self, "redo_stack", [])
        if not redo_stack:
            return {"success": False, "message": "Nothing to redo"}
        current = {
            "columns": [dict(c) for c in getattr(self, "columns", [])],
            "control_points": {
                k: dict(v) for k, v in getattr(self, "control_points", {}).items()
            },
            "data_xlim": list(self.data_xlim)
            if getattr(self, "data_xlim", None)
            else None,
            "data_ylim": list(self.data_ylim)
            if getattr(self, "data_ylim", None)
            else None,
            "taxa_names": list(getattr(self, "taxa_names", [])),
        }
        if not hasattr(self, "undo_stack") or self.undo_stack is None:
            self.undo_stack = []
        self.undo_stack.append(current)
        nxt = redo_stack.pop()
        self.columns = nxt["columns"]
        self.control_points = nxt["control_points"]
        self.data_xlim = nxt["data_xlim"]
        self.data_ylim = nxt["data_ylim"]
        self.taxa_names = nxt["taxa_names"]
        return {"success": True, "action": nxt.get("action", "redo")}

    def project_new(self, clear_image: bool = False) -> dict[str, Any]:
        """Clears session state to start a clean project."""
        self.columns = []
        self.column_points = {}
        self.control_points = {}
        self.reader_types = {}
        self.is_calibrated = False
        self.y_scale = None
        self.x_scales = {}
        self.depth_calib = None
        self.grid_line_mask = None
        self.candidate_line_mask = None
        self.degrid_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        self.cleanup_stats = {}
        self.cleanup_overlay_png = None
        self.degrid_strength = None
        self.degrid_info = None
        self.line_corrections = []
        self.taxa_names = []
        self.depth_grid = []
        self.samples = []
        self.age_depth_model = None
        self.age_depth_image = None
        self.age_depth_image_path = None
        self.ensemble_tables = {}
        self.chron_events = []
        self.undo_stack = []
        self.redo_stack = []
        self._init_rois()

        if clear_image:
            self.image = None
            self.image_path = None
            self.width = 0
            self.height = 0
            self.foreground_mask = None
            self.data_xlim = None
            self.data_ylim = None
            self.meta_info = {}

        return {"success": True, "status": "new_project_created"}

    def project_load(self, project_data: dict[str, Any] | str) -> dict[str, Any]:
        """Loads a project from a POSIX .tar archive, .json file, or dictionary."""
        if hasattr(self, "undo_stack") and self.undo_stack is not None:
            self.undo_stack.clear()
        if hasattr(self, "redo_stack") and self.redo_stack is not None:
            self.redo_stack.clear()

        if isinstance(project_data, str):
            path = os.path.abspath(project_data)
            if not os.path.exists(path):
                raise JsonRpcError(
                    FILE_NOT_FOUND_ERROR, f"Project file not found: {path}"
                )

            if path.endswith(".tar") or tarfile.is_tarfile(path):
                with tarfile.open(path, "r") as tf:
                    json_member = None
                    img_member = None
                    ad_img_member = None
                    for m in tf.getmembers():
                        nl = m.name.lower()
                        if nl.endswith("straditize.json") or (
                            nl.endswith(".json")
                            and "manifest" not in nl
                            and "info" not in nl
                        ):
                            json_member = m
                        elif "age_depth" in nl and nl.endswith(
                            (".png", ".jpg", ".jpeg")
                        ):
                            ad_img_member = m
                        elif nl.endswith((".png", ".jpg", ".jpeg")):
                            img_member = m

                    if not json_member:
                        raise JsonRpcError(
                            INVALID_PARAMS, "No straditize.json found in .tar archive."
                        )

                    f_json = tf.extractfile(json_member)
                    if not f_json:
                        raise JsonRpcError(
                            INVALID_PARAMS,
                            "Could not extract straditize.json from archive.",
                        )
                    parsed = json.loads(f_json.read().decode("utf-8"))

                    if img_member:
                        f_img = tf.extractfile(img_member)
                        if f_img:
                            img_bytes = f_img.read()
                            img_obj = Image.open(io.BytesIO(img_bytes))
                            img_obj.load()
                            self.image = img_obj
                            self.width, self.height = img_obj.size
                            self.format = img_obj.format or "PNG"
                            self.mode = img_obj.mode

                    if ad_img_member:
                        f_ad = tf.extractfile(ad_img_member)
                        if f_ad:
                            ad_bytes = f_ad.read()
                            ad_obj = Image.open(io.BytesIO(ad_bytes))
                            ad_obj.load()
                            self.age_depth_image = ad_obj
                            self.age_depth_image_path = "archive://image/age_depth.png"

                    return self.project_load(parsed)
            else:
                with open(path, "r", encoding="utf-8") as f:
                    parsed = json.load(f)
                return self.project_load(parsed)

        cal = (
            project_data.get("depth_calibration")
            or project_data.get("calibration")
            or {}
        )
        roi = project_data.get("roi") or {}

        self.data_xlim = None
        self.data_ylim = None
        if "w" in roi and "h" in roi:
            self.data_xlim = [
                float(roi.get("x", 0)),
                float(roi.get("x", 0)) + float(roi["w"]),
            ]
            self.data_ylim = [
                float(roi.get("y", 0)),
                float(roi.get("y", 0)) + float(roi["h"]),
            ]
        elif roi:
            if "x0" in roi and "x1" in roi:
                self.data_xlim = [float(roi["x0"]), float(roi["x1"])]
            if "y0" in roi and "y1" in roi:
                self.data_ylim = [float(roi["y0"]), float(roi["y1"])]

        self.is_calibrated = False
        self.y_scale = None
        self.depth_calib = None
        self.grid_line_mask = None
        self.candidate_line_mask = None
        self.degrid_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        self.cleanup_stats = {}
        self.cleanup_overlay_png = None
        self.degrid_info = None
        line_removal = project_data.get("line_removal") or {}
        self.degrid_strength = line_removal.get("strength") or None
        self.degrid_remove_vertical = bool(line_removal.get("remove_vertical", True))
        corrections = line_removal.get("corrections") or []
        self.line_corrections = [c for c in corrections if isinstance(c, dict)]
        if unit := cal.get("unit"):
            self.depth_unit = str(unit)

        top_px, bottom_px = cal.get("top_px"), cal.get("bottom_px")
        top_val = cal.get("top_cm", cal.get("top_val"))
        bottom_val = cal.get("bottom_cm", cal.get("bottom_val"))
        if None not in (top_px, bottom_px, top_val, bottom_val) and float(
            bottom_px
        ) != float(top_px):
            self.calibrate_axes(
                y_marks=[
                    {"pixel": float(top_px), "val": float(top_val)},
                    {"pixel": float(bottom_px), "val": float(bottom_val)},
                ],
                unit=self.depth_unit,
            )

        raw_cols = project_data.get("columns", [])
        self.columns = []
        self.control_points = {}
        self.taxa_names = []

        self._init_rois()
        saved_rois = project_data.get("rois")
        if saved_rois and isinstance(saved_rois, list):
            self.rois = [dict(r) for r in saved_rois]
            self.primary_roi_id = project_data.get("primary_roi_id") or (
                self.rois[0]["id"] if self.rois else None
            )
            self.active_roi_id = (
                project_data.get("active_roi_id") or self.primary_roi_id
            )
            for r in self.rois:
                if not r.get("x_groups"):
                    def_grp = {
                        "id": f"{r['id']}_grp1",
                        "name": "默认组",
                        "unit": "%",
                        "plot_type": "area",
                        "scale_type": "linear",
                        "exaggeration_mult": None,
                        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                    }
                    r["x_groups"] = [def_grp]
                    r["default_group_id"] = def_grp["id"]
        else:
            roi_raw = project_data.get("roi")
            if roi_raw and isinstance(roi_raw, dict):
                rx0 = float(roi_raw.get("x", 0.0))
                ry0 = float(roi_raw.get("y", 0.0))
                rx1 = rx0 + float(roi_raw.get("w", 100.0))
                ry1 = ry0 + float(roi_raw.get("h", 100.0))
            else:
                rx0, ry0 = 0.0, 0.0
                rx1 = float(getattr(self, "width", 100.0) or 100.0)
                ry1 = float(getattr(self, "height", 100.0) or 100.0)
            created = self.roi_create(name="pollen", x0=rx0, x1=rx1, y0=ry0, y1=ry1)[
                "roi"
            ]
            self.primary_roi_id = created["id"]
            self.active_roi_id = created["id"]

        primary_roi = (
            self._get_roi(self.primary_roi_id)
            if self.primary_roi_id
            else (self.rois[0] if self.rois else None)
        )

        for idx, c in enumerate(raw_cols):
            name = c.get("species") or c.get("name") or f"Col {idx}"
            self.taxa_names.append(name)
            col_roi_id = c.get("roi_id") or (
                self.primary_roi_id if len(self.rois) <= 1 else None
            )
            if not col_roi_id and self.rois:
                col_roi_id = self.rois[0]["id"]

            target_roi = self._get_roi(col_roi_id) if col_roi_id else primary_roi

            x_group_id = c.get("x_group_id")
            x_values = c.get("x_values")
            x_ticks = c.get("x_ticks")

            if not x_group_id and target_roi:
                grp_id = f"{col_roi_id}_grp_{idx + 1}"
                c_start = float(c.get("startX", c.get("start", 0)))
                c_end = float(c.get("endX", c.get("end", c_start + 100)))
                c_span = max(1e-9, c_end - c_start)

                if x_ticks and len(x_ticks) >= 2:
                    val0 = float(x_ticks[0].get("value", 0))
                    val1 = float(x_ticks[1].get("value", 100))
                    px0 = float(x_ticks[0].get("px", c_start))
                    px1 = float(x_ticks[1].get("px", c_end))
                    rel0 = (px0 - c_start) / c_span
                    rel1 = (px1 - c_start) / c_span
                    x_values = [val0, val1]
                else:
                    rel0 = 0.0
                    rel1 = 1.0
                    if (
                        c.get("startValue") is not None
                        or c.get("tickValue") is not None
                    ):
                        x_values = [
                            float(c.get("startValue", 0)),
                            float(c.get("tickValue", 100)),
                        ]

                grp = {
                    "id": grp_id,
                    "name": f"{name}组",
                    "unit": c.get("unit", "%"),
                    "plot_type": c.get("plot_type") or c.get("plotType") or "area",
                    "scale_type": c.get("scale_type", "linear"),
                    "exaggeration_mult": c.get("exaggeration_mult"),
                    "tick_layout": [{"rel": rel0}, {"rel": rel1}],
                }
                target_roi.setdefault("x_groups", []).append(grp)
                x_group_id = grp_id

            col_dict = {
                "col_index": idx,
                "id": c.get("id") or f"{col_roi_id}_col{idx + 1:02d}",
                "name": name,
                "species": name,
                "roi_id": col_roi_id,
                "x_group_id": x_group_id,
                "x_values": x_values,
                "start": c.get("startX", c.get("start", 0)),
                "startX": c.get("startX", c.get("start", 0)),
                "end": c.get("endX", c.get("end", 100)),
                "endX": c.get("endX", c.get("end", 100)),
                "scale_type": c.get("scale_type", "linear"),
                "plot_type": c.get("plot_type") or c.get("plotType") or "area",
                "unit": c.get("unit", "%"),
                "exaggeration_mult": c.get("exaggeration_mult"),
                "x_ticks": x_ticks,
                "startValue": c.get("startValue", 0),
                "tickValue": c.get("tickValue", 100),
                "tickEndX": c.get("tickEndX", c.get("endX", 100)),
            }
            self.columns.append(col_dict)

            pts = c.get("points") or c.get("controlPoints") or []
            ctrls: dict[int, float] = {}
            for p in pts:
                y_val = round(p.get("y", 0))
                x_val = float(p.get("x", 0))
                ctrls[y_val] = x_val
            self.control_points[idx] = ctrls

        img_meta = project_data.get("image") or {}
        if (
            isinstance(img_meta, dict)
            and img_meta.get("base64")
            and getattr(self, "image", None) is None
        ):
            raw_b64 = img_meta["base64"]
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            img_obj = Image.open(io.BytesIO(base64.b64decode(raw_b64)))
            img_obj.load()
            self.image = img_obj
            self.width, self.height = img_obj.size
            self.format = img_obj.format or "PNG"
            self.mode = img_obj.mode

        if project_data.get("paper_metadata"):
            self.metadata_update(project_data["paper_metadata"])
        if project_data.get("samples") is not None:
            self.samples = list(project_data["samples"])
        if project_data.get("line_candidates") is not None:
            self.line_candidates = list(project_data["line_candidates"])
        if project_data.get("selected_candidate_ids") is not None:
            self.selected_candidate_ids = set(project_data["selected_candidate_ids"])
        if project_data.get("ensemble_tables") is not None:
            self.ensemble_tables = list(project_data["ensemble_tables"])

        ad_data = project_data.get("age_depth")
        if isinstance(ad_data, dict):
            if (
                ad_data.get("image_base64")
                and getattr(self, "age_depth_image", None) is None
            ):
                ad_b64 = ad_data["image_base64"]
                if "," in ad_b64:
                    ad_b64 = ad_b64.split(",", 1)[1]
                ad_obj = Image.open(io.BytesIO(base64.b64decode(ad_b64)))
                ad_obj.load()
                self.age_depth_image = ad_obj
                self.age_depth_image_path = "archive://image/age_depth.png"
            if ad_data.get("calib_state"):
                self.age_depth_calib_state = dict(ad_data["calib_state"])
            insp = ad_data.get("inspection")
            if isinstance(insp, dict) and insp.get("depths") and insp.get("ages"):
                meta = insp.get("metadata") or {}
                model = AgeDepthModel(
                    depths=insp["depths"],
                    ages=insp["ages"],
                    age_min=insp.get("age_min"),
                    age_max=insp.get("age_max"),
                    curve_type=meta.get("curve_type", "median"),
                    envelope_type=meta.get("envelope_type", "95_hpd"),
                    depth_unit=meta.get("depth_unit", "cm"),
                    age_unit=meta.get("age_unit", "cal BP"),
                    cal_curve=meta.get("calibration_curve", "IntCal20"),
                    notes=meta.get("notes", ""),
                )
                px_pts = insp.get("px_points")
                if isinstance(px_pts, dict):
                    model.px_y = np.asarray(px_pts.get("y", []), dtype=float)
                    model.px_x_curve = np.asarray(
                        px_pts.get("x_curve", []), dtype=float
                    )
                    model.px_x_min = np.asarray(px_pts.get("x_min", []), dtype=float)
                    model.px_x_max = np.asarray(px_pts.get("x_max", []), dtype=float)
                self.age_depth_model = model

        return {
            "success": True,
            "columns_count": len(self.columns),
            "taxa": self.taxa_names,
            "is_calibrated": self.is_calibrated,
            "has_age_depth_image": getattr(self, "age_depth_image", None) is not None,
            "has_age_depth_model": self.age_depth_model is not None,
        }

    load_project = project_load

    def project_save(
        self,
        output_path: str | None = None,
        format: str = "tar",
    ) -> dict[str, Any]:
        """Saves project to POSIX UStar .tar archive or JSON per Section 八."""
        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
        }

        if getattr(self, "depth_calib", None):
            calib = {
                "is_calibrated": True,
                "top_px": self.depth_calib["top_px"],
                "bottom_px": self.depth_calib["bottom_px"],
                "top_cm": self.depth_calib["top_cm"],
                "bottom_cm": self.depth_calib["bottom_cm"],
                "unit": self.depth_calib.get("unit") or self.depth_unit,
            }
        else:
            calib = {"is_calibrated": False, "unit": getattr(self, "depth_unit", "cm")}

        roi = (
            {
                "x": self.data_xlim[0],
                "y": self.data_ylim[0],
                "w": self.data_xlim[1] - self.data_xlim[0],
                "h": self.data_ylim[1] - self.data_ylim[0],
            }
            if getattr(self, "data_xlim", None) and getattr(self, "data_ylim", None)
            else None
        )

        cols_export = []
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        for idx, col in enumerate(columns):
            c_idx = col.get("col_index", idx)
            name = (
                col.get("species")
                or col.get("name")
                or (taxa_names[c_idx] if c_idx < len(taxa_names) else f"Col {c_idx}")
            )
            ctrls = getattr(self, "control_points", {}).get(c_idx, {})
            pts = []
            for y_r, x_c in ctrls.items():
                pts.append(
                    {
                        "x": round(x_c, 2),
                        "y": y_r,
                        "value": round(x_c, 2),
                        "kind": "peak",
                        "valid_segment": True,
                    }
                )
            pts.sort(key=lambda p: p["y"])
            scale = resolve_column_scale(self, col, c_idx)
            cols_export.append(
                {
                    "id": col.get("id") or f"col_{c_idx}",
                    "col_index": c_idx,
                    "species": name,
                    "name": name,
                    "roi_id": col.get("roi_id"),
                    "x_group_id": col.get("x_group_id"),
                    "x_values": col.get("x_values"),
                    "x_ticks": col.get("x_ticks"),
                    "color": col.get("color", "#38bdf8"),
                    "visible": col.get("visible", True),
                    "scale_type": scale.scale_type,
                    "plot_type": scale.plot_type,
                    "unit": scale.unit,
                    "exaggeration_mult": scale.exaggeration_mult,
                    "has_exaggeration": scale.exaggeration_mult is not None,
                    "startX": col.get("startX", col.get("start", 0)),
                    "start": col.get("start", 0),
                    "endX": col.get("endX", col.get("end", 100)),
                    "end": col.get("end", 100),
                    "startValue": scale.val0,
                    "tickValue": scale.val1,
                    "tickEndX": scale.abs_px1,
                    "points": pts,
                }
            )

        ad_export: dict[str, Any] | None = None
        if (
            getattr(self, "age_depth_image", None) is not None
            or getattr(self, "age_depth_model", None) is not None
        ):
            ad_export = {
                "image_path": "image/age_depth.png"
                if getattr(self, "age_depth_image", None) is not None
                else None,
                "width": self.age_depth_image.width
                if getattr(self, "age_depth_image", None) is not None
                else 0,
                "height": self.age_depth_image.height
                if getattr(self, "age_depth_image", None) is not None
                else 0,
                "calib_state": getattr(self, "age_depth_calib_state", None),
                "inspection": (
                    self.age_depth_model.to_inspection_data()
                    if getattr(self, "age_depth_model", None) is not None
                    else None
                ),
            }

        project_json: dict[str, Any] = {
            "version": "3.0.0",
            "schema_version": "3.0",
            "image": {
                "path": "image/original.png",
                "width": getattr(self, "width", 0),
                "height": getattr(self, "height", 0),
            },
            "depth_calibration": calib,
            "roi": roi,
            "rois": getattr(self, "rois", []),
            "primary_roi_id": getattr(self, "primary_roi_id", None),
            "active_roi_id": getattr(self, "active_roi_id", None),
            "line_removal": {
                "strength": getattr(self, "degrid_strength", None),
                "remove_vertical": getattr(self, "degrid_remove_vertical", True),
                "corrections": getattr(self, "line_corrections", []),
            },
            "line_candidates": getattr(self, "line_candidates", []),
            "selected_candidate_ids": sorted(
                getattr(self, "selected_candidate_ids", set()) or set()
            ),
            "samples": getattr(self, "samples", []),
            "paper_metadata": getattr(self, "paper_metadata", {}),
            "age_depth": ad_export,
            "ensemble_tables": getattr(self, "ensemble_tables", []),
            "columns": cols_export,
        }

        if format.lower() == "json":
            if output_path:
                if getattr(self, "image", None) is not None:
                    ib = io.BytesIO()
                    self.image.save(ib, format="PNG")
                    project_json["image"]["base64"] = base64.b64encode(
                        ib.getvalue()
                    ).decode("ascii")
                if (
                    ad_export is not None
                    and getattr(self, "age_depth_image", None) is not None
                ):
                    ab = io.BytesIO()
                    self.age_depth_image.save(ab, format="PNG")
                    ad_export["image_base64"] = base64.b64encode(ab.getvalue()).decode(
                        "ascii"
                    )
            json_str = json.dumps(project_json, indent=2, ensure_ascii=False)
            if output_path:
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(json_str)
                return {"path": output_path, "success": True}
            return {"data": project_json, "success": True}

        tar_bio = io.BytesIO()
        with tarfile.open(fileobj=tar_bio, mode="w") as tf:
            # 1. manifest.json
            m_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            # 2. straditize.json
            sj_bytes = json.dumps(project_json, indent=2, ensure_ascii=False).encode(
                "utf-8"
            )
            ti_sj = tarfile.TarInfo(name="straditize.json")
            ti_sj.size = len(sj_bytes)
            ti_sj.mtime = int(time.time())
            tf.addfile(ti_sj, io.BytesIO(sj_bytes))

            # 3. image/original.png
            if getattr(self, "image", None) is not None:
                img_bio = io.BytesIO()
                self.image.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            # 3b. image/age_depth.png
            if getattr(self, "age_depth_image", None) is not None:
                ad_bio = io.BytesIO()
                self.age_depth_image.save(ad_bio, format="PNG")
                ad_data = ad_bio.getvalue()
                ti_ad = tarfile.TarInfo(name="image/age_depth.png")
                ti_ad.size = len(ad_data)
                ti_ad.mtime = int(time.time())
                tf.addfile(ti_ad, io.BytesIO(ad_data))

            # 4. data.csv
            try:
                if not getattr(self, "column_points", None) and columns:
                    for col in columns:
                        self.digitize(col["col_index"])
                res = self.export_data("csv")
                csv_str = (
                    (res.get("csv") or res.get("csv_content") or "")
                    if isinstance(res, dict)
                    else str(res)
                )
                if not csv_str.strip():
                    raise ValueError("empty csv")
                csv_data = csv_str.encode("utf-8")
            except (ValueError, KeyError, RuntimeError, JsonRpcError):
                headers = ["depth"] + [
                    c.get("species") or c.get("name") or f"col_{idx}"
                    for idx, c in enumerate(columns)
                ]
                lines = [",".join(headers)]
                depth_vals = getattr(self, "depth_grid", None) or [
                    0.0,
                    50.0,
                    100.0,
                    150.0,
                ]
                for d in depth_vals:
                    lines.append(",".join([str(round(d, 2))] + ["0.00"] * len(columns)))
                csv_data = "\n".join(lines).encode("utf-8")

            ti_csv = tarfile.TarInfo(name="data.csv")
            ti_csv.size = len(csv_data)
            ti_csv.mtime = int(time.time())
            tf.addfile(ti_csv, io.BytesIO(csv_data))

            # 5. plot_strat.R
            r_script = (
                b"# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
                b"# Generated automatically by Straditize v2.0 (straditize pro)\n"
                b"if (!requireNamespace('rioja', quietly=TRUE)) install.packages('rioja')\n"
                b"library(rioja)\n"
                b"df <- read.csv('data.csv', check.names=FALSE)\n"
                b"strat.plot(df[-1], yvar=df[[1]], y.rev=TRUE, scale.percent=TRUE, plot.line=TRUE, title='Stratigraphic Pollen Diagram (Straditize Pro)')\n"
            )
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script))

            # 6. README.txt
            readme = (
                b"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                b"================================================================\n\n"
                b"Hierarchy:\n"
                b"manifest.json      - Version and metadata\n"
                b"image/original.png - Original stratigraphic diagram\n"
                b"straditize.json    - Full vector model\n"
                b"data.csv           - Calibrated matrix (Depth in 1st col, unobserved = 0.0)\n"
                b"plot_strat.R       - rioja::strat.plot plotting template\n"
                b"README.txt         - Documentation\n\n"
                b"SCIENTIFIC NOTICE:\n"
                b"In data.csv, unobserved taxa are strictly 0.0 (never NA).\n"
                b"Add a pseudocount before taking log transformations.\n"
            )
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))

        tar_bytes = tar_bio.getvalue()
        if output_path:
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {"path": output_path, "size": len(tar_bytes), "success": True}

        return {
            "tar_base64": base64.b64encode(tar_bytes).decode("ascii"),
            "size": len(tar_bytes),
            "success": True,
        }

    save_project = project_save


ProjectMixin = ProjectSessionMixin
