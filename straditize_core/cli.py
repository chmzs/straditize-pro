"""Straditize WebMCP & CLI Agent Entrypoint.

Replaces static batch CLI with a live WebMCP (Model Context Protocol) server
that connects AI agents directly to the active Straditize web canvas session
(or an embedded session) to execute the 8-step workflow interactively.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .mcp_server import StraditizeWebMcpServer
from .session import StraditizeSession


def cmd_mcp(args: argparse.Namespace) -> int:
    """Start the WebMCP stdio server bridging AI agents to Straditize."""
    url = (
        None
        if getattr(args, "standalone", False)
        else getattr(args, "url", "http://127.0.0.1:8765/rpc")
    )
    server = StraditizeWebMcpServer(web_rpc_url=url)
    server.serve_stdio()
    return 0


def cmd_list_tools(args: argparse.Namespace) -> int:
    """Print the registered WebMCP tools catalog as JSON."""
    server = StraditizeWebMcpServer(web_rpc_url=None)
    print(json.dumps(server.list_tools(), indent=2, ensure_ascii=False))
    return 0


def cmd_call_tool(args: argparse.Namespace) -> int:
    """Invoke a single WebMCP tool against the live web server or local session."""
    url = (
        None
        if getattr(args, "standalone", False)
        else getattr(args, "url", "http://127.0.0.1:8765/rpc")
    )
    server = StraditizeWebMcpServer(web_rpc_url=url)
    tool_args = json.loads(args.args) if getattr(args, "args", None) else {}
    res = server.call_tool(args.tool, tool_args)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 1 if res.get("isError") else 0


def cmd_extract(args: argparse.Namespace) -> int:
    """Run automated digitization on a single diagram image via WebMCP tool chain."""
    image_path = os.path.abspath(args.image)
    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}", file=sys.stderr)
        return 1

    session = StraditizeSession()
    mcp = StraditizeWebMcpServer(web_rpc_url=None, session=session)

    # Step 1: Load image via WebMCP
    mcp.call_tool("straditize_load_image", {"path": image_path})
    print(f"Loaded image: {image_path} ({session.width}x{session.height})")

    # Step 2: ROI
    if args.roi:
        try:
            parts = [int(p.strip()) for p in args.roi.split(",")]
            if len(parts) != 4:
                raise ValueError
            x0, x1, y0, y1 = parts
        except ValueError:
            print(
                "Error: --roi must be formatted as 'x0,x1,y0,y1' (e.g. '315,1946,511,1311')",
                file=sys.stderr,
            )
            return 1
    else:
        x0, x1 = 0, session.width or 1000
        y0, y1 = 0, session.height or 1000

    mcp.call_tool(
        "straditize_roi_create",
        {"name": "pollen", "x0": x0, "x1": x1, "y0": y0, "y1": y1, "composition": True},
    )

    # Step 5: Detect columns via WebMCP
    mcp.call_tool(
        "straditize_detect_columns", {"data_xlim": [x0, x1], "data_ylim": [y0, y1]}
    )
    print(
        f"Detected {len(session.columns)} columns in data ROI [{x0}, {x1}] x [{y0}, {y1}]"
    )

    if args.taxa:
        taxa_path = os.path.abspath(args.taxa)
        if os.path.exists(taxa_path):
            with open(taxa_path, "r", encoding="utf-8") as f:
                names = [line.strip() for line in f if line.strip()]
            session.batch_set_taxa(names)
        else:
            names = [n.strip() for n in args.taxa.split(",") if n.strip()]
            session.batch_set_taxa(names)

    for c in session.columns:
        session.digitize(c["col_index"], mode=args.mode)

    if args.depth:
        try:
            d_parts = [float(p.strip()) for p in args.depth.split(",")]
            if len(d_parts) == 3:
                start_d, end_d, step_d = d_parts
                session.apply_depth_grid(
                    start_depth=start_d, end_depth=end_d, step=step_d
                )
            elif len(d_parts) == 2:
                start_d, end_d = d_parts
                session.apply_depth_grid(start_depth=start_d, end_depth=end_d, step=2.0)
            else:
                raise ValueError
        except ValueError:
            print(
                "Error: --depth must be formatted as 'top,bottom,step' (e.g. '0,150,2')",
                file=sys.stderr,
            )
            return 1
    else:
        session.apply_depth_grid(start_depth=0, end_depth=100, step=2.0)

    out_format = args.format or ("csv" if args.output.endswith(".csv") else "json")
    output_path = os.path.abspath(args.output)
    session.export_data(format=out_format, output_path=output_path)

    print(f"SUCCESS: Exported {out_format.upper()} data to {output_path}")
    return 0


def cmd_run_project(args: argparse.Namespace) -> int:
    """Run digitization from an existing .tar project archive or project JSON file."""
    proj_path = os.path.abspath(args.project)
    if not os.path.exists(proj_path):
        print(f"Error: Project file not found: {proj_path}", file=sys.stderr)
        return 1

    session = StraditizeSession()
    session.load_project(proj_path)
    out_format = args.format or "csv"
    output_path = os.path.abspath(args.output)
    session.export_data(format=out_format, output_path=output_path)

    print(f"SUCCESS: Exported data to {output_path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="straditize-webmcp",
        description="Straditize WebMCP Server & Agent Interface for 8-Step Stratigraphic Digitization",
    )
    subparsers = parser.add_subparsers(dest="subcommand", help="Available subcommands")

    # MCP server command (Primary Agent Mode)
    p_mcp = subparsers.add_parser(
        "mcp",
        help="Start WebMCP stdio server (bridges to live web canvas or local session)",
    )
    p_mcp.add_argument(
        "--url",
        type=str,
        default="http://127.0.0.1:8765/rpc",
        help="Live Straditize Web RPC URL",
    )
    p_mcp.add_argument(
        "--standalone",
        action="store_true",
        help="Force standalone in-memory session without web bridge",
    )

    # List tools command
    subparsers.add_parser(
        "list-tools", help="List all 8-step workflow WebMCP tools as JSON"
    )

    # Call tool command
    p_call = subparsers.add_parser(
        "call-tool", help="Invoke a WebMCP tool against the live web session"
    )
    p_call.add_argument(
        "tool", type=str, help="WebMCP tool name (e.g. straditize_qa_summarize)"
    )
    p_call.add_argument(
        "--args", type=str, default="{}", help="JSON string of tool arguments"
    )
    p_call.add_argument(
        "--url",
        type=str,
        default="http://127.0.0.1:8765/rpc",
        help="Live Straditize Web RPC URL",
    )
    p_call.add_argument(
        "--standalone", action="store_true", help="Run in standalone mode"
    )

    # Legacy extract command (internally routed via WebMCP)
    p_extract = subparsers.add_parser(
        "extract", help="Digitize diagram image to CSV/JSON via WebMCP"
    )
    p_extract.add_argument(
        "image", type=str, help="Path to diagram image file (PNG/JPG/TIFF)"
    )
    p_extract.add_argument(
        "--roi", type=str, help="Data area bounding box: 'x0,x1,y0,y1'"
    )
    p_extract.add_argument(
        "--depth",
        type=str,
        help="Depth calibration: 'top,bottom,step' (e.g. '0,150,2')",
    )
    p_extract.add_argument(
        "--taxa", type=str, help="Comma-separated taxa names or path to txt file"
    )
    p_extract.add_argument(
        "--mode",
        type=str,
        default="area",
        choices=["area", "bar", "line"],
        help="Digitization mode",
    )
    p_extract.add_argument(
        "-o",
        "--output",
        type=str,
        required=True,
        help="Output file path (e.g. result.csv)",
    )
    p_extract.add_argument(
        "-f", "--format", type=str, choices=["csv", "json"], help="Output format"
    )

    # Run-project command
    p_proj = subparsers.add_parser(
        "run-project", help="Run digitization from a .tar / .json project archive"
    )
    p_proj.add_argument(
        "project", type=str, help="Path to project archive (.tar) or project JSON file"
    )
    p_proj.add_argument(
        "-o", "--output", type=str, required=True, help="Output file path"
    )
    p_proj.add_argument(
        "-f", "--format", type=str, choices=["csv", "json"], help="Output format"
    )

    args = parser.parse_args()

    if args.subcommand == "mcp":
        sys.exit(cmd_mcp(args))
    elif args.subcommand == "list-tools":
        sys.exit(cmd_list_tools(args))
    elif args.subcommand == "call-tool":
        sys.exit(cmd_call_tool(args))
    elif args.subcommand == "extract":
        sys.exit(cmd_extract(args))
    elif args.subcommand == "run-project":
        sys.exit(cmd_run_project(args))
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
