"""Straditize WebMCP (Model Context Protocol) Server & Live Web Session Bridge.

Exposes the complete 8-step stratigraphic digitization workflow and topbar export
as structured MCP tools for AI agents:
- Step 1 (Load): straditize_load_image
- Step 2 (ROI): straditize_roi_create, straditize_roi_set_primary
- Step 3 (Y-Calib): straditize_calibrate_y
- Step 4 (Cleanup): straditize_cleanup_lines
- Step 5 (Columns & Naming): straditize_detect_columns, straditize_rename_column, straditize_snap_labels
- Step 6 (X-Ticks): straditize_detect_xticks, straditize_calibrate_column
- Step 7 (Horizons): straditize_extract_consensus_horizons, straditize_paste_depths
- Step 8 (QA Gate): straditize_qa_summarize
- Export (Topbar): straditize_export_readiness, straditize_export

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
        "rpc_method": "cleanup.detectCandidates",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "line_fraction_h": {
                    "type": "number",
                    "description": "Horizontal span fraction threshold (default 0.75).",
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
                    "description": "Maximum stroke thickness in px (default 3).",
                },
            },
            "required": ["roi_id"],
        },
    },
    {
        "name": "straditize_apply_line_removal",
        "description": "Step 4: Apply selected line removal candidates and exclusion regions to the extraction mask.",
        "rpc_method": "cleanup.apply",
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
        "name": "straditize_detect_xticks",
        "description": "Step 6: Detect X-axis scale tick marks using 1-D vertical run geometry.",
        "rpc_method": "xticks.detect",
        "inputSchema": {
            "type": "object",
            "properties": {
                "roi_id": {"type": "string", "description": "Target ROI ID."},
                "dark_threshold": {
                    "type": "integer",
                    "description": "Greyscale threshold (default 160).",
                },
            },
        },
    },
    {
        "name": "straditize_calibrate_column",
        "description": "Step 6: Calibrate a column's X-axis scale using two tick endpoints [Tick(px, value), Tick(px, value)].",
        "rpc_method": "xticks.calibrateColumn",
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
]


class StraditizeWebMcpServer:
    """Model Context Protocol (WebMCP) server bridging AI agents to Straditize."""

    def __init__(
        self,
        web_rpc_url: str | None = "http://127.0.0.1:8765/rpc",
        session: StraditizeSession | None = None,
    ) -> None:
        self.web_rpc_url = web_rpc_url
        self.session = session or StraditizeSession()
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

        try:
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
