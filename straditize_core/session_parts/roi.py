"""ROI session mixin managing multiple digitisation regions."""

from __future__ import annotations

import re
from typing import Any

from ..protocol import JsonRpcError

ROI_NAME_PATTERN = re.compile(r"^[\w\u4e00-\u9fa5-]{1,31}$")


class RoiMixin:
    """ROI lifecycle, multi-ROI state, and form defaults."""

    rois: list[dict[str, Any]]
    primary_roi_id: str | None
    active_roi_id: str | None
    _roi_counter: int

    def _init_rois(self) -> None:
        """Initialise multi-ROI storage."""
        self.rois = []
        self.primary_roi_id = None
        self.active_roi_id = None
        self._roi_counter = 0

    def _validate_roi_name(self, name: str, current_roi_id: str | None = None) -> None:
        """Validate ROI name format and uniqueness."""
        if not isinstance(name, str) or not ROI_NAME_PATTERN.match(name):
            raise JsonRpcError(
                -32602,
                f"参数格式不合规：ROI 名称 '{name}' 格式不合法。名称必须为 1-31 位中英文字符、数字或连字符，不得包含空格或斜杠。",
            )
        for r in getattr(self, "rois", []):
            if r["name"] == name and r["id"] != current_roi_id:
                raise JsonRpcError(
                    -32002,
                    f"命名冲突：区域名称 '{name}' 已存在。同一项目中 ROI 名称必须唯一，请修改名称。",
                )

    def _get_roi(self, roi_id: str) -> dict[str, Any]:
        """Look up an ROI by id or raise -32001."""
        for r in getattr(self, "rois", []):
            if r["id"] == roi_id:
                return r
        raise JsonRpcError(
            -32001,
            f"前置状态缺失：未找到 ROI '{roi_id}'。请在【步骤 2: ROI】中先创建或选取该有效区。",
        )

    def roi_create(
        self,
        name: str | None = None,
        x0: float = 0.0,
        x1: float = 0.0,
        y0: float = 0.0,
        y1: float = 0.0,
        composition: bool = True,
    ) -> dict[str, Any]:
        """Create a new ROI."""
        if not hasattr(self, "rois") or self.rois is None:
            self._init_rois()

        if name is None:
            self._roi_counter += 1
            cand_name = f"roi_{self._roi_counter}"
            while any(r["name"] == cand_name for r in self.rois):
                self._roi_counter += 1
                cand_name = f"roi_{self._roi_counter}"
            name = cand_name
            name_source = "default"
        else:
            name_source = "user"
            self._roi_counter += 1

        self._validate_roi_name(name)

        roi_id = f"roi_{self._roi_counter}"
        default_grp_id = f"{roi_id}_grp1"
        default_grp = {
            "id": default_grp_id,
            "name": "默认组",
            "unit": "%",
            "plot_type": "area",
            "scale_type": "linear",
            "exaggeration_mult": None,
            "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
        }

        max_w = float(getattr(self, "width", 0) or 100000.0)
        max_h = float(getattr(self, "height", 0) or 100000.0)
        min_x = max(0.0, min(float(x0), float(x1)))
        max_x = min(max_w, max(float(x0), float(x1))) if max_w > 0 else max(float(x0), float(x1))
        min_y = max(0.0, min(float(y0), float(y1)))
        max_y = min(max_h, max(float(y0), float(y1))) if max_h > 0 else max(float(y0), float(y1))
        xlim = [min_x, max_x]
        ylim = [min_y, max_y]

        roi: dict[str, Any] = {
            "id": roi_id,
            "name": name,
            "name_source": name_source,
            "composition": bool(composition),
            "visible": True,
            "xlim": xlim,
            "ylim": ylim,
            "columns_stale": False,
            "form_defaults": None,
            "x_groups": [default_grp],
            "default_group_id": default_grp_id,
        }
        self.rois.append(roi)

        if self.primary_roi_id is None:
            self.primary_roi_id = roi_id
        if self.active_roi_id is None:
            self.active_roi_id = roi_id

        if self.active_roi_id == roi_id:
            self.data_xlim = list(xlim)
            self.data_ylim = list(ylim)

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Create ROI {name}")

        return {"roi": roi, "rois_count": len(self.rois)}

    def roi_update(
        self,
        roi_id: str | None = None,
        name: str | None = None,
        xlim: list[float] | None = None,
        ylim: list[float] | None = None,
        visible: bool | None = None,
        composition: bool | None = None,
        form_defaults: dict[str, Any] | None = None,
        columns_stale: bool | None = None,
        x0: float | None = None,
        x1: float | None = None,
        y0: float | None = None,
        y1: float | None = None,
        x: float | None = None,
        y: float | None = None,
        w: float | None = None,
        h: float | None = None,
    ) -> dict[str, Any]:
        """Update ROI properties."""
        if not hasattr(self, "rois") or self.rois is None:
            self._init_rois()

        if x is not None and w is not None:
            x0 = x
            x1 = x + w
        if y is not None and h is not None:
            y0 = y
            y1 = y + h

        if roi_id is None:
            roi_id = self.active_roi_id or (self.rois[0]["id"] if self.rois else None)

        if not roi_id or not any(r["id"] == roi_id for r in self.rois):
            # If no rois exist yet, create default one to stay backward compatible
            if any(v is not None for v in (x0, x1, y0, y1, xlim, ylim, x, y, w, h)):
                sug = (
                    self.suggest_data_region()
                    if (hasattr(self, "suggest_data_region") and getattr(self, "image", None) is not None)
                    else {"xMin": 0.0, "xMax": getattr(self, "width", 100.0), "yMin": 0.0, "yMax": getattr(self, "height", 100.0)}
                )
                curr_x = getattr(self, "data_xlim", None) or [sug["xMin"], sug["xMax"]]
                curr_y = getattr(self, "data_ylim", None) or [sug["yMin"], sug["yMax"]]
                bx0 = x0 if x0 is not None else (xlim[0] if xlim else curr_x[0])
                bx1 = x1 if x1 is not None else (xlim[1] if xlim else curr_x[1])
                by0 = y0 if y0 is not None else (ylim[0] if ylim else curr_y[0])
                by1 = y1 if y1 is not None else (ylim[1] if ylim else curr_y[1])
                res = self.roi_create(name="pollen", x0=bx0, x1=bx1, y0=by0, y1=by1)
                r_created = res["roi"]
                self.active_roi_id = r_created["id"]
                self.data_xlim = list(r_created["xlim"])
                self.data_ylim = list(r_created["ylim"])
                if hasattr(self, "rois") and self.rois:
                    self.rois[0]["name_source"] = "default"
                self.grid_line_mask = None
                self.degrid_info = None
                return {
                    "roi": r_created,
                    "data_xlim": r_created["xlim"],
                    "data_ylim": r_created["ylim"],
                    "roi_box": (r_created["xlim"][0], r_created["ylim"][0], r_created["xlim"][1], r_created["ylim"][1]),
                    "success": True,
                }
            raise JsonRpcError(-32602, f"ROI '{roi_id}' not found.")

        roi = self._get_roi(roi_id)

        # Coordinate changes
        coord_changed = False
        new_xlim = list(roi["xlim"])
        new_ylim = list(roi["ylim"])
        max_w = float(getattr(self, "width", 0) or 100000.0)
        max_h = float(getattr(self, "height", 0) or 100000.0)

        if xlim is not None and len(xlim) == 2:
            min_x = max(0.0, min(float(xlim[0]), float(xlim[1])))
            max_x = min(max_w, max(float(xlim[0]), float(xlim[1]))) if max_w > 0 else max(float(xlim[0]), float(xlim[1]))
            new_xlim = [min_x, max_x]
            coord_changed = True
        elif x0 is not None and x1 is not None:
            min_x = max(0.0, min(float(x0), float(x1)))
            max_x = min(max_w, max(float(x0), float(x1))) if max_w > 0 else max(float(x0), float(x1))
            new_xlim = [min_x, max_x]
            coord_changed = True

        if ylim is not None and len(ylim) == 2:
            min_y = max(0.0, min(float(ylim[0]), float(ylim[1])))
            max_y = min(max_h, max(float(ylim[0]), float(ylim[1]))) if max_h > 0 else max(float(ylim[0]), float(ylim[1]))
            new_ylim = [min_y, max_y]
            coord_changed = True
        elif y0 is not None and y1 is not None:
            min_y = max(0.0, min(float(y0), float(y1)))
            max_y = min(max_h, max(float(y0), float(y1))) if max_h > 0 else max(float(y0), float(y1))
            new_ylim = [min_y, max_y]
            coord_changed = True

        if coord_changed:
            roi["xlim"] = new_xlim
            roi["ylim"] = new_ylim
            # per-ROI columns_stale: only mark this ROI stale
            roi["columns_stale"] = True
            if self.active_roi_id == roi_id:
                self.data_xlim = list(new_xlim)
                self.data_ylim = list(new_ylim)
                self.grid_line_mask = None
                self.degrid_info = None

        if name is not None and name != roi["name"]:
            self._validate_roi_name(name, current_roi_id=roi_id)
            roi["name"] = name
            roi["name_source"] = "user"

        if visible is not None:
            roi["visible"] = bool(visible)

        if composition is not None:
            roi["composition"] = bool(composition)

        if form_defaults is not None:
            roi["form_defaults"] = form_defaults

        if columns_stale is not None:
            roi["columns_stale"] = bool(columns_stale)

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Update ROI {roi['name']}")

        return {
            "roi": roi,
            "data_xlim": roi["xlim"],
            "data_ylim": roi["ylim"],
            "roi_box": (roi["xlim"][0], roi["ylim"][0], roi["xlim"][1], roi["ylim"][1]),
            "success": True,
        }

    def roi_remove(self, roi_id: str) -> dict[str, Any]:
        """Remove an ROI and cascade-delete its columns."""
        if not hasattr(self, "rois") or self.rois is None:
            self._init_rois()

        roi = self._get_roi(roi_id)
        self.rois.remove(roi)

        # Cascade delete columns belonging to this ROI and re-index point stores
        removed_column_ids: list[str] = []
        kept_columns = []
        removed_indices: set[int] = set()
        for idx, col in enumerate(getattr(self, "columns", [])):
            col.setdefault("col_index", idx)
            if col.get("roi_id") == roi_id:
                cid = col.get("id") or f"col_{col.get('col_index')}"
                removed_column_ids.append(cid)
                c_idx = col.get("col_index")
                if isinstance(c_idx, int):
                    removed_indices.add(c_idx)
            else:
                kept_columns.append(col)
        self.columns = kept_columns
        if hasattr(self, "taxa_names") and self.taxa_names:
            self.taxa_names = [
                n for i, n in enumerate(self.taxa_names) if i not in removed_indices
            ]
        reindex = getattr(self, "_reindex_columns", None)
        if callable(reindex):
            reindex(sync_taxa_names=False)

        # Re-assign active and primary if deleted
        if self.active_roi_id == roi_id:
            if (
                self.primary_roi_id
                and self.primary_roi_id != roi_id
                and any(r["id"] == self.primary_roi_id for r in self.rois)
            ):
                self.active_roi_id = self.primary_roi_id
            elif self.rois:
                self.active_roi_id = self.rois[0]["id"]
            else:
                self.active_roi_id = None

        if self.primary_roi_id == roi_id:
            if self.rois:
                self.primary_roi_id = self.rois[0]["id"]
            else:
                self.primary_roi_id = None

        if self.active_roi_id:
            active_roi = next((r for r in self.rois if r["id"] == self.active_roi_id), None)
            if active_roi:
                self.data_xlim = list(active_roi["xlim"])
                self.data_ylim = list(active_roi["ylim"])
            else:
                self.data_xlim = None
                self.data_ylim = None
        else:
            self.data_xlim = None
            self.data_ylim = None

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Remove ROI {roi_id}")

        return {"success": True, "removed_column_ids": removed_column_ids}

    def roi_list(self) -> dict[str, Any]:
        """List all ROIs."""
        if not hasattr(self, "rois") or self.rois is None:
            self._init_rois()
        return {
            "rois": self.rois,
            "primary_roi_id": self.primary_roi_id,
            "active_roi_id": self.active_roi_id,
        }

    def roi_set_active(self, roi_id: str) -> dict[str, Any]:
        """Set the active ROI."""
        roi = self._get_roi(roi_id)
        self.active_roi_id = roi_id
        self.data_xlim = list(roi["xlim"])
        self.data_ylim = list(roi["ylim"])
        return {"active_roi_id": self.active_roi_id}

    def roi_set_primary(self, roi_id: str) -> dict[str, Any]:
        """Set the primary ROI."""
        self._get_roi(roi_id)
        self.primary_roi_id = roi_id
        return {"primary_roi_id": self.primary_roi_id}

    def roi_apply_form_defaults(self, roi_id: str) -> dict[str, Any]:
        """Write form_defaults to all columns in this ROI without inheritance."""
        roi = self._get_roi(roi_id)
        form = roi.get("form_defaults")
        if not form:
            return {"changed": [], "count": 0}

        changed: list[dict[str, Any]] = []
        field_mapping = {
            "plot_type": form.get("plotType"),
            "scale_type": form.get("scaleType"),
            "unit": form.get("unit"),
            "exaggeration_mult": form.get("exaggerationMult"),
            "startValue": form.get("startValue"),
            "tickValue": form.get("step") or form.get("tickValue"),
        }

        for col in getattr(self, "columns", []):
            if col.get("roi_id") == roi_id:
                col_id = col.get("id") or f"col_{col.get('col_index')}"
                for target_field, target_val in field_mapping.items():
                    if target_val is not None:
                        old_val = col.get(target_field)
                        col[target_field] = target_val
                        changed.append({
                            "column_id": col_id,
                            "field": target_field,
                            "from": old_val,
                            "to": target_val,
                        })

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Apply form defaults to ROI {roi_id}")

        return {"changed": changed, "count": len(changed)}

    # ========================================================================
    # X-Groups within ROI Management (Design 2026-09-29 P2)
    # ========================================================================

    def roi_group_create(
        self,
        roi_id: str,
        name: str | None = None,
        unit: str = "%",
        plot_type: str = "area",
        scale_type: str = "linear",
        exaggeration_mult: float | None = None,
        tick_layout: list[dict[str, float]] | None = None,
    ) -> dict[str, Any]:
        """Create a new column group within an ROI (Invariant 1: 组在 ROI 内)."""
        roi = self._get_roi(roi_id)
        groups = roi.setdefault("x_groups", [])
        grp_num = len(groups) + 1
        grp_id = f"{roi_id}_grp{grp_num}"
        while any(g.get("id") == grp_id for g in groups):
            grp_num += 1
            grp_id = f"{roi_id}_grp{grp_num}"

        group_name = name or f"组 {grp_num}"
        layout = tick_layout or [{"rel": 0.0}, {"rel": 1.0}]

        grp: dict[str, Any] = {
            "id": grp_id,
            "name": group_name,
            "unit": unit,
            "plot_type": plot_type,
            "scale_type": scale_type,
            "exaggeration_mult": exaggeration_mult,
            "tick_layout": layout,
        }
        groups.append(grp)
        return {"roi_id": roi_id, "group": grp, "groups_count": len(groups)}

    def roi_group_update(
        self,
        roi_id: str,
        group_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """Update properties of a column group within an ROI."""
        roi = self._get_roi(roi_id)
        groups = roi.setdefault("x_groups", [])
        target = next((g for g in groups if g.get("id") == group_id), None)
        if not target:
            raise JsonRpcError(-32602, f"Group '{group_id}' not found in ROI '{roi_id}'.")

        allowed_fields = (
            "name",
            "unit",
            "plot_type",
            "scale_type",
            "exaggeration_mult",
            "tick_layout",
        )
        for field in allowed_fields:
            if field in updates:
                target[field] = updates[field]

        return {"roi_id": roi_id, "group": target}

    def roi_group_remove(
        self,
        roi_id: str,
        group_id: str,
    ) -> dict[str, Any]:
        """Remove a group from an ROI (cannot remove the only remaining group; columns fallback to default_group_id)."""
        roi = self._get_roi(roi_id)
        groups = roi.setdefault("x_groups", [])
        if len(groups) <= 1:
            raise JsonRpcError(
                -32602,
                f"不能删除 ROI '{roi_id}' 内唯一的组（每列必须恰属一组）。",
            )

        target = next((g for g in groups if g.get("id") == group_id), None)
        if not target:
            raise JsonRpcError(-32602, f"Group '{group_id}' not found in ROI '{roi_id}'.")

        groups.remove(target)
        if roi.get("default_group_id") == group_id:
            roi["default_group_id"] = groups[0]["id"]

        fallback_id = roi["default_group_id"]
        reassigned_count = 0
        for col in getattr(self, "columns", []):
            if col.get("roi_id") == roi_id and col.get("x_group_id") == group_id:
                col["x_group_id"] = fallback_id
                reassigned_count += 1

        return {
            "roi_id": roi_id,
            "removed_group_id": group_id,
            "fallback_group_id": fallback_id,
            "reassigned_columns_count": reassigned_count,
            "groups_count": len(groups),
        }
