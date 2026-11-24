"""Straditize WebMCP (Model Context Protocol) Server & Live Web Session Bridge.

Exposes the complete 8-step stratigraphic digitization workflow, visual feedback,
chronology modeling, and automated pipelines as structured MCP tools for AI agents:
- Step 1 (Load): straditize_load_image
- Step 2 (ROI): straditize_roi_create, straditize_roi_set_primary
- Step 3 (Y-Calib): straditize_calibrate_y
- Step 4 (Cleanup): straditize_detect_line_candidates, straditize_apply_line_removal
- Step 5 (Columns & Naming): straditize_detect_columns, straditize_rename_column, straditize_snap_labels, straditize_column_update
- Step 6 (Calibration): straditize_group_create, straditize_group_update, straditize_group_remove, straditize_calibrate_group, straditize_calibrate_column
- Step 7 (Horizons): straditize_extract_consensus_horizons, straditize_paste_depths
- Step 8 (QA Gate): straditize_qa_summarize
- Export (Topbar): straditize_export_readiness, straditize_export
- Multimodal Vision: straditize_get_visual_slice
- Chronology / Age-Depth: straditize_agedepth_generate_bacon_script, straditize_agedepth_check_r_env, straditize_agedepth_run_local_bacon, straditize_agedepth_generate_geochronr_script
- Autopilot Macro: straditize_auto_digitize

Supports two execution backends:
1. Live Web Bridge Mode (default when web server is active on http://127.0.0.1:8765/rpc):
   Forwards tool invocations over HTTP JSON-RPC to the active browser session (Shared Canvas Co-pilot).
2. Embedded Session Mode:
   Executes against an in-memory StraditizeSession via JsonRpcDispatcher.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any

from .protocol import JsonRpcDispatcher, JsonRpcError
from .rpc_methods import register_all
from .session import StraditizeSession

MCP_PROTOCOL_VERSION = "2024-11-05"

WEBMCP_TOOLS: list[dict[str, Any]] = [
    {
        "name": "straditize_get_status",
        "description": "Get current session status, image dimensions, ROIs, columns, and calibration state.",
        "rpc_method": "core.getStatus",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "straditize_load_image",
        "description": "Step 1: Load a stratigraphic diagram image from a file path or built-in sample key ('hoya').",
        "rpc_method": "core.loadImage",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative file path to the image.",
                },
                "sample_key": {
                    "type": "string",
                    "description": "Built-in sample key, e.g. 'hoya'.",
                },
            },
        },
    },
    {
        "name": "straditize_roi_create",
        "description": "Step 2: Create a named data ROI (Region of Interest) container.",
        "rpc_method": "roi.create",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Unique ROI name (1-31 chars, e.g. 'pollen', 'charcoal', '花粉').",
                },
                "x0": {"type": "number", "description": "Left pixel boundary."},
                "x1": {"type": "number", "description": "Right pixel boundary."},
                "y0": {"type": "number", "description": "Top pixel boundary."},
                "y1": {"type": "number", "description": "Bottom pixel boundary."},
                "composition": {
                    "type": "boolean",
                    "description": "True if columns represent percentage composition (<=100%).",
                },
            },
            "required": ["name", "x0", "x1", "y0", "y1"],
        },
    },
    {
        "name": "straditize_roi_set_primary",
        "description": "Step 2: Set the primary ROI whose data populates root data.csv in .tar archives.",
        "rpc_method": "roi.setPrimary",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {
                    "type": "string",
                    "description": "Target ROI ID (e.g. 'roi_1').",
                },
            },
            "required": ["roi_id"],
        },
    },
    {
        "name": "straditize_calibrate_y",
        "description": "Step 3: Calibrate the global Y-axis (depth or age) using two reference pixel rows.",
        "rpc_method": "core.calibrateAxes",
        "inputSchema": {
            "type": "object",
            "properties": {
                "y_marks": {
                    "type": "array",
                    "description": "Two calibration marks: [{'px': row_y, 'val': depth_or_age}, ...].",
                    "items": {
                        "type": "object",
                        "properties": {
                            "px": {"type": "number"},
                            "val": {"type": "number"},
                        },
                        "required": ["px", "val"],
                    },
                },
                "unit": {
                    "type": "string",
                    "description": "Physical unit (e.g. 'cm', 'm', 'cal yr BP').",
                },
            },
            "required": ["y_marks"],
        },
    },
    {
        "name": "straditize_detect_line_candidates",
        "description": "Step 4: Scan ROI for coordinate grid lines and artifact candidates (kinds A, B, C).",
        "rpc_method": "algorithm.detectLineCandidates",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "line_fraction_h": {
                    "type": "number",
                    "description": "Horizontal span fraction threshold (default 0.65).",
                },
                "line_fraction_v": {
                    "type": "number",
                    "description": "Vertical span fraction threshold (default 0.30).",
                },
                "line_width_min": {
                    "type": "integer",
                    "description": "Minimum stroke thickness in px (default 1).",
                },
                "line_width_max": {
                    "type": "integer",
                    "description": "Maximum stroke thickness in px (default: adaptive, derived from the ROI long side).",
                },
            },
            "required": ["roi_id"],
        },
    },
    {
        "name": "straditize_apply_line_removal",
        "description": "Step 4: Apply selected line removal candidates and exclusion regions to the extraction mask.",
        "rpc_method": "algorithm.applyLineRemoval",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "selected_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of candidate IDs to remove.",
                },
            },
            "required": ["roi_id", "selected_ids"],
        },
    },
    {
        "name": "straditize_detect_columns",
        "description": "Step 5: Automatically segment taxa columns within an ROI based on clean ink profiles.",
        "rpc_method": "core.detectColumns",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "data_xlim": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "Optional [x0, x1] bounds.",
                },
                "data_ylim": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "Optional [y0, y1] bounds.",
                },
            },
        },
    },
    {
        "name": "straditize_rename_column",
        "description": "Step 5: Rename a column with strict ROI-scoped uniqueness check (no auto-suffix).",
        "rpc_method": "naming.renameColumn",
        "inputSchema": {
            "type": "object",
            "properties": {
                "col_index": {
                    "type": ["integer", "string"],
                    "description": "Column index or column ID.",
                },
                "name": {"type": "string", "description": "New taxon/variable name."},
            },
            "required": ["col_index", "name"],
        },
    },
    {
        "name": "straditize_snap_labels",
        "description": "Step 5: Interval-based [startX, endX) OCR label snapping and 3-category reconciliation.",
        "rpc_method": "naming.snapLabels",
        "inputSchema": {
            "type": "object",
            "properties": {
                "labels": {
                    "type": "array",
                    "description": "List of OCR label objects containing id, anchor_x, and optional bbox.",
                    "items": {"type": "object"},
                },
            },
            "required": ["labels"],
        },
    },
    {
        "name": "straditize_column_update",
        "description": "Step 5/6: Update column properties (associate to group x_group_id, rename, set plot_type or exaggeration_mult).",
        "rpc_method": "column.update",
        "inputSchema": {
            "type": "object",
            "properties": {
                "col_index": {"type": "integer", "description": "Column index."},
                "name": {"type": "string", "description": "New taxon name."},
                "x_group_id": {"type": "string", "description": "Target column group ID."},
                "plot_type": {"type": "string", "enum": ["area", "bar", "line", "symbol"]},
                "exaggeration_mult": {"type": "number", "description": "Column-level exaggeration factor."},
            },
            "required": ["col_index"],
        },
    },
    {
        "name": "straditize_calibrate_column",
        "description": "Step 6: Calibrate a column's X-axis scale using two tick endpoints [Tick(px, value), Tick(px, value)].",
        "rpc_method": "column.calibrateXTicks",
        "inputSchema": {
            "type": "object",
            "properties": {
                "col_index": {"type": "integer", "description": "Column index."},
                "ticks": {
                    "type": "array",
                    "description": "Exactly two tick endpoints: [{'px': x0, 'value': v0}, {'px': x1, 'value': v1}].",
                    "items": {
                        "type": "object",
                        "properties": {
                            "px": {"type": "number"},
                            "value": {"type": "number"},
                        },
                        "required": ["px", "value"],
                    },
                },
                "unit": {
                    "type": "string",
                    "description": "Measurement unit (default '%').",
                },
                "plot_type": {
                    "type": "string",
                    "enum": ["area", "bar", "line", "symbol"],
                },
                "scale_type": {"type": "string", "enum": ["linear", "log"]},
                "exaggeration_mult": {
                    "type": ["number", "null"],
                    "description": "Optional exaggeration factor.",
                },
            },
            "required": ["col_index", "ticks"],
        },
    },
    {
        "name": "straditize_group_create",
        "description": "Step 6: Create an X-scale column group within an ROI (e.g. for shared slope or exaggeration).",
        "rpc_method": "roi.groupCreate",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "group_name": {"type": "string", "description": "Display name of the group."},
                "unit": {"type": "string", "description": "Physical unit (e.g. '%', 'grains/g')."},
                "plot_type": {"type": "string", "enum": ["area", "bar", "line", "symbol"]},
                "scale_type": {"type": "string", "enum": ["linear", "log"]},
                "exaggeration_mult": {"type": "number", "description": "Exaggeration multiplier (e.g. 5.0)."},
                "layout": {"type": "string", "enum": ["single", "paired", "custom"]},
            },
            "required": ["roi_id"],
        },
    },
    {
        "name": "straditize_group_update",
        "description": "Step 6: Update group-level calibration properties (value_per_px slope, axis_stroke_px, exaggeration_mult, unit).",
        "rpc_method": "roi.groupUpdate",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "group_id": {"type": "string", "description": "Group ID (e.g. 'grp_default')."},
                "updates": {
                    "type": "object",
                    "description": "Dict of group properties to update: value_per_px, axis_stroke_px, exaggeration_mult, unit, plot_type, scale_type.",
                },
            },
            "required": ["roi_id", "group_id", "updates"],
        },
    },
    {
        "name": "straditize_group_remove",
        "description": "Step 6: Remove an X-scale column group from an ROI.",
        "rpc_method": "roi.groupRemove",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "group_id": {"type": "string", "description": "Group ID to remove."},
            },
            "required": ["roi_id", "group_id"],
        },
    },
    {
        "name": "straditize_calibrate_group",
        "description": "Step 6: Calibrate an entire column group's slope (value_per_px) and physical parameters in one shot.",
        "rpc_method": "roi.groupUpdate",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "group_id": {"type": "string", "description": "Target Group ID (e.g. 'grp_default')."},
                "value_per_px": {"type": "number", "description": "Direct group slope (value per pixel)."},
                "px_span": {"type": "number", "description": "Pixel distance between 0 and reference tick."},
                "val_span": {"type": "number", "description": "Value difference across px_span (used to calculate slope if value_per_px omitted)."},
                "unit": {"type": "string", "description": "Measurement unit (default '%')."},
                "axis_stroke_px": {"type": "number", "description": "Axis stroke width in px (0-point offset)."},
                "exaggeration_mult": {"type": "number", "description": "Exaggeration multiplier (e.g. 5.0)."},
                "plot_type": {"type": "string", "enum": ["area", "bar", "line", "symbol"]},
            },
            "required": ["roi_id", "group_id"],
        },
    },
    {
        "name": "straditize_extract_consensus_horizons",
        "description": "Step 7: Discover real historical sampling horizons via multi-taxa turning point curvature consensus.",
        "rpc_method": "samples.extractConsensus",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tolerance_px": {
                    "type": "number",
                    "description": "Vertical clustering tolerance in pixels (default 3.0).",
                },
                "min_taxa_support": {
                    "type": "integer",
                    "description": "Minimum supporting taxa count (default 2).",
                },
            },
        },
    },
    {
        "name": "straditize_paste_depths",
        "description": "Step 7: Directly paste a list of known historical sample depths/ages (bypassing curvature consensus).",
        "rpc_method": "samples.pasteDepths",
        "inputSchema": {
            "type": "object",
            "properties": {
                "depths": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "List of sample depths or ages.",
                },
            },
            "required": ["depths"],
        },
    },
    {
        "name": "straditize_qa_summarize",
        "description": "Step 8: Run geological quality assurance checks (composition sum <= 100%, empty horizons, declared_max).",
        "rpc_method": "qa.summarize",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Optional target ROI ID."},
                "tolerance": {
                    "type": "number",
                    "description": "Allowed composition excess percentage (default 2.0).",
                },
            },
        },
    },
    {
        "name": "straditize_export_readiness",
        "description": "Topbar Export: Inspect multi-ROI export readiness checklist (sheets, primary_roi, readiness_missing).",
        "rpc_method": "export.getReadiness",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "straditize_export",
        "description": "Topbar Export: Export calibrated multi-ROI scientific data to XLSX, LiPD, TAR, or CSV.",
        "rpc_method": "export.tar",
        "inputSchema": {
            "type": "object",
            "properties": {
                "format": {
                    "type": "string",
                    "enum": ["tar", "xlsx", "lipd", "csv"],
                    "description": "Target export format.",
                },
                "output_path": {
                    "type": "string",
                    "description": "Destination file path.",
                },
            },
        },
    },
    {
        "name": "straditize_get_visual_slice",
        "description": "Visual feedback slice: Extract an image sub-region (by ROI, column, or bbox) as Base64 PNG for multimodal LLM inspection.",
        "rpc_method": "image.getVisualSlice",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "col_index": {"type": "integer", "description": "Target column index."},
                "bbox": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "[x0, y0, x1, y1] pixel bounding box.",
                },
                "max_dim": {
                    "type": "integer",
                    "description": "Maximum dimension for downscaling (default 1600).",
                },
                "include_overlays": {
                    "type": "boolean",
                    "description": "Whether to draw column boundary overlay lines.",
                },
            },
        },
    },
    {
        "name": "straditize_agedepth_generate_bacon_script",
        "description": "Chronology: Generate an executable rbacon age-depth modeling script with prior constraints.",
        "rpc_method": "agedepth.generateBaconScript",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dates": {
                    "type": "array",
                    "description": "List of dating objects: [{'depth': d, 'age': a, 'error': e, 'id': '...'}].",
                    "items": {"type": "object"},
                },
                "core_name": {"type": "string", "description": "Core name (default 'MyCore')."},
                "thickness": {"type": "number", "description": "Bacon section thickness in cm (default 5.0)."},
                "cc": {"type": "integer", "description": "Calibration curve (1: IntCal20, 2: Marine20, 3: SHCal20)."},
                "hiatus_depths": {"type": "array", "items": {"type": "number"}},
                "acc_mean": {"type": "number", "description": "Prior accumulation mean in yr/cm."},
                "mem_mean": {"type": "number", "description": "Prior memory mean (default 0.7)."},
            },
            "required": ["dates"],
        },
    },
    {
        "name": "straditize_agedepth_check_r_env",
        "description": "Chronology: Inspect local R environment, testing rbacon and geoChronR package availability.",
        "rpc_method": "agedepth.checkREnvironment",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "straditize_agedepth_run_local_bacon",
        "description": "Chronology: Execute local Bacon Bayesian age-depth MCMC modeling via R background process.",
        "rpc_method": "agedepth.runLocalBacon",
        "inputSchema": {
            "type": "object",
            "properties": {
                "core_name": {"type": "string"},
                "dates": {"type": "array", "items": {"type": "object"}},
                "thickness": {"type": "number"},
                "cc": {"type": "integer"},
                "hiatus_depths": {"type": "array", "items": {"type": "number"}},
            },
            "required": ["dates"],
        },
    },
    {
        "name": "straditize_agedepth_generate_geochronr_script",
        "description": "Chronology: Generate an R script for LiPD age-depth integration with geoChronR.",
        "rpc_method": "agedepth.generateGeoChronRScript",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lipd_file_name": {"type": "string"},
                "site_name": {"type": "string"},
                "thickness": {"type": "number"},
                "hiatus_depths": {"type": "array", "items": {"type": "number"}},
            },
            "required": ["lipd_file_name"],
        },
    },
    {
        "name": "straditize_auto_digitize",
        "description": "Autopilot Macro: Execute full end-to-end stratigraphic digitization pipeline (Load -> Calibrate -> Detect -> Digitize -> QA) in one shot.",
        "rpc_method": "straditize.autoDigitize",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Path to image file."},
                "sample_key": {"type": "string", "description": "Built-in sample key (e.g. 'hoya')."},
                "y_marks": {
                    "type": "array",
                    "description": "Two calibration marks: [{'px': y, 'val': depth_or_age}, ...].",
                    "items": {"type": "object"},
                },
                "roi": {
                    "type": "object",
                    "description": "ROI bounds: {'name': 'pollen', 'x0': ..., 'y0': ..., 'x1': ..., 'y1': ..., 'composition': True}.",
                },
                "group_calib": {
                    "type": "object",
                    "description": "Group calibration parameters: {'value_per_px': ..., 'axis_stroke_px': ..., 'unit': '%'}.",
                },
                "run_cleanup": {"type": "boolean", "description": "Whether to run automatic degrid line removal."},
                "tolerance_px": {"type": "number", "description": "Consensus horizon clustering tolerance (default 3.0)."},
            },
        },
    },
]


class StraditizeWebMcpServer:
    """Model Context Protocol (WebMCP) server bridging AI agents to Straditize."""

    def __init__(
        self,
        web_rpc_url: str | None = "http://127.0.0.1:8765/rpc",
        session: StraditizeSession | None = None,
        dispatcher: JsonRpcDispatcher | None = None,
    ) -> None:
        self.web_rpc_url = web_rpc_url
        self.session = session or StraditizeSession()
        if dispatcher is not None:
            self.dispatcher = dispatcher
        else:
            self.dispatcher = JsonRpcDispatcher()
            register_all(self.dispatcher, self.session)
        self._tool_map = {t["name"]: t for t in WEBMCP_TOOLS}

    def list_tools(self) -> list[dict[str, Any]]:
        """Return MCP-compliant tool definitions."""
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "inputSchema": t["inputSchema"],
            }
            for t in WEBMCP_TOOLS
        ]

    def _call_rpc(self, method: str, params: dict[str, Any]) -> Any:
        """Invoke RPC method against live Web server if reachable, else local session."""
        if self.web_rpc_url:
            payload = json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": params,
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                self.web_rpc_url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                    if "error" in body and body["error"]:
                        err = body["error"]
                        raise JsonRpcError(
                            err.get("code", -32000), err.get("message", "RPC error")
                        )
                    return body.get("result")
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                # Fallback to in-memory session when web server is not running
                pass

        # Execute against embedded session
        body = self.dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }
        )
        if body is None or not isinstance(body, dict):
            return None
        if "error" in body and body["error"]:
            err = body["error"]
            raise JsonRpcError(err.get("code", -32000), err.get("message", "RPC error"))
        return body.get("result")

    def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Execute an MCP tool by name and return an MCP CallToolResult."""
        if name not in self._tool_map:
            return {
                "content": [{"type": "text", "text": f"Unknown tool: {name}"}],
                "isError": True,
            }

        tool_spec = self._tool_map[name]
        args = dict(arguments or {})
        rpc_method = tool_spec["rpc_method"]

        # Route format-specific export calls
        if name == "straditize_export":
            fmt = args.pop("format", "tar")
            if fmt == "xlsx":
                rpc_method = "export.exportXlsx"
            elif fmt == "lipd":
                rpc_method = "export.exportLipd"
            elif fmt == "csv":
                rpc_method = "export.csv"
            else:
                rpc_method = "export.tar"

        # Route group calibration convenience tool
        elif name == "straditize_calibrate_group":
            roi_id = args.pop("roi_id")
            group_id = args.pop("group_id")
            updates = dict(args.pop("updates", {}) or {})
            for fld in (
                "value_per_px",
                "axis_stroke_px",
                "unit",
                "exaggeration_mult",
                "plot_type",
            ):
                if fld in args and args[fld] is not None:
                    updates[fld] = args[fld]
            # Convert px_span and val_span to value_per_px if omitted
            if "value_per_px" not in updates and "px_span" in args and "val_span" in args:
                px = float(args["px_span"])
                val = float(args["val_span"])
                if px != 0:
                    updates["value_per_px"] = val / px
            rpc_method = "roi.groupUpdate"
            args = {"roi_id": roi_id, "group_id": group_id, "updates": updates}

        try:
            if name == "straditize_auto_digitize":
                result = self._run_auto_digitize(args)
            else:
                result = self._call_rpc(rpc_method, args)

            # Strip raw binary bytes from text serialization if present
            if (
                isinstance(result, dict)
                and "data" in result
                and isinstance(result["data"], (bytes, bytearray))
            ):
                result = {k: v for k, v in result.items() if k != "data"}
                result["archive_generated"] = True

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(result, ensure_ascii=False, default=str),
                    }
                ],
                "isError": False,
            }
        except Exception as exc:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Error executing {name}: {exc}",
                    }
                ],
                "isError": True,
            }

    def _run_auto_digitize(self, args: dict[str, Any]) -> dict[str, Any]:
        """Execute automated end-to-end digitization pipeline.

        Strictly follows architectural invariants: all data is computed from
        real backend execution, never mocked or substituted.
        """
        image_path = args.get("image_path")
        sample_key = args.get("sample_key")
        if not image_path and not sample_key:
            sample_key = "hoya"

        steps_done: list[str] = []

        # Step 1: Load image
        load_args: dict[str, Any] = {}
        if image_path:
            load_args["path"] = image_path
        if sample_key:
            load_args["sample_key"] = sample_key
        self._call_rpc("core.loadImage", load_args)
        steps_done.append("load_image")

        # Step 2: Calibrate Y if y_marks provided
        y_marks = args.get("y_marks")
        if y_marks and isinstance(y_marks, list) and len(y_marks) >= 2:
            self._call_rpc("core.calibrateAxes", {"y_marks": y_marks})
            steps_done.append("calibrate_y")

        # Step 3: Create ROI & set primary (or update if already exists from auto-suggestion)
        roi_args = args.get("roi")
        target_roi_id: str | None = None
        if roi_args and isinstance(roi_args, dict):
            status = self._call_rpc("core.getStatus", {})
            existing_rois = (
                status.get("rois", []) if isinstance(status, dict) else []
            )
            r_name = roi_args.get("name")
            matched_roi = next(
                (r for r in existing_rois if r.get("name") == r_name), None
            )
            if matched_roi:
                target_roi_id = matched_roi.get("id")
                update_params: dict[str, Any] = {"roi_id": target_roi_id}
                for k in ("x0", "x1", "y0", "y1", "composition"):
                    if k in roi_args:
                        update_params[k] = roi_args[k]
                self._call_rpc("roi.update", update_params)
            else:
                created = self._call_rpc("roi.create", roi_args)
                if isinstance(created, dict):
                    target_roi_id = created.get("roi", {}).get("id") or created.get(
                        "id"
                    )
            if target_roi_id:
                self._call_rpc("roi.setPrimary", {"roi_id": target_roi_id})
                steps_done.append("create_roi")
        else:
            # If no explicit roi given, use primary/active from load_image
            status = self._call_rpc("core.getStatus", {})
            target_roi_id = (
                status.get("primary_roi_id") if isinstance(status, dict) else None
            )

        # Step 4: Optional cleanup
        if bool(args.get("run_cleanup")) and target_roi_id:
            try:
                self._call_rpc("algorithm.degrid", {"roi_id": target_roi_id})
                steps_done.append("cleanup_degrid")
            except Exception:
                pass

        # Step 5: Detect columns
        detect_params: dict[str, Any] = {}
        if target_roi_id:
            detect_params["roi_id"] = target_roi_id
        cols_res = self._call_rpc("core.detectColumns", detect_params)
        steps_done.append("detect_columns")
        columns = cols_res.get("columns", []) if isinstance(cols_res, dict) else []

        # Step 6: Digitize curves / ink across all detected columns
        self._call_rpc("column.redigitizeAll", {})
        steps_done.append("digitize")

        # Step 6.5: Apply group calibration prior if given
        group_calib = args.get("group_calib")
        if group_calib and isinstance(group_calib, dict) and target_roi_id:
            try:
                status = self._call_rpc("core.getStatus", {})
                rois = status.get("rois", []) if isinstance(status, dict) else []
                cur_roi = next((r for r in rois if r.get("id") == target_roi_id), None)
                groups = cur_roi.get("x_groups", []) if cur_roi else []
                group_id = groups[0].get("id") if groups else "grp_default"
                self._call_rpc(
                    "roi.groupUpdate",
                    {
                        "roi_id": target_roi_id,
                        "group_id": group_id,
                        "updates": group_calib,
                    },
                )
                steps_done.append("group_calibration")
            except Exception:
                pass

        # Step 7: Extract consensus horizons
        tol = float(args.get("tolerance_px", 3.0))
        horizons_res = self._call_rpc(
            "samples.extractConsensus", {"tolerance_px": tol}
        )
        steps_done.append("extract_consensus_horizons")
        horizons = (
            horizons_res.get("horizons", []) if isinstance(horizons_res, dict) else []
        )

        # Step 8: QA summarize
        qa_params: dict[str, Any] = {}
        if target_roi_id:
            qa_params["roi_id"] = target_roi_id
        qa_res = self._call_rpc("qa.summarize", qa_params)
        steps_done.append("qa_summarize")

        violations = (
            qa_res.get("violations_over", []) if isinstance(qa_res, dict) else []
        )
        empty_horizons = (
            qa_res.get("empty_horizons", []) if isinstance(qa_res, dict) else []
        )

        return {
            "status": "completed",
            "steps_completed": steps_done,
            "target_roi_id": target_roi_id,
            "columns_count": len(columns),
            "horizons_count": len(horizons),
            "qa_summary": {
                "composition_gate_passed": len(violations) == 0,
                "violations_count": len(violations),
                "empty_horizons_count": len(empty_horizons),
                "n_horizons_with_data": qa_res.get("n_horizons_with_data", 0)
                if isinstance(qa_res, dict)
                else 0,
            },
            "qa_full": qa_res,
        }

    def handle_mcp_message(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        """Process a single JSON-RPC 2.0 MCP message."""
        method = msg.get("method", "")
        msg_id = msg.get("id")
        params = msg.get("params") or {}

        # Notifications have no id and expect no response
        if msg_id is None:
            return None

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {
                        "tools": {"listChanged": False},
                    },
                    "serverInfo": {
                        "name": "straditize-webmcp",
                        "version": "2.0.0",
                    },
                },
            }

        if method == "ping":
            return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": self.list_tools()},
            }

        if method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments") or {}
            res = self.call_tool(tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": res,
            }

        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
        }

    def serve_stdio(self) -> None:
        """Run the MCP JSON-RPC loop over standard input/output."""
        for line in sys.stdin:
            line_str = line.strip()
            if not line_str:
                continue
            try:
                msg = json.loads(line_str)
            except json.JSONDecodeError:
                continue

            resp = self.handle_mcp_message(msg)
            if resp is not None:
                sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
                sys.stdout.flush()
