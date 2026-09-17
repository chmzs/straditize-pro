"""Command Line Interface (CLI) for Straditize Core.

Enables headless, automated batch digitization of stratigraphic diagrams
without requiring a GUI or interactive browser session.
"""
from __future__ import annotations

import argparse
import os
import sys

from .session import StraditizeSession


def cmd_extract(args: argparse.Namespace) -> int:
    """Run automated digitization on a single diagram image."""
    image_path = os.path.abspath(args.image)
    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}", file=sys.stderr)
        return 1

    session = StraditizeSession()
    session.load_image(image_path)
    print(f"Loaded image: {image_path} ({session.width}x{session.height})")

    # 1. Parse ROI
    if args.roi:
        try:
            parts = [int(p.strip()) for p in args.roi.split(",")]
            if len(parts) != 4:
                raise ValueError
            x0, x1, y0, y1 = parts
        except ValueError:
            print("Error: --roi must be formatted as 'x0,x1,y0,y1' (e.g. '315,1946,511,1311')", file=sys.stderr)
            return 1
    else:
        x0, x1 = 0, session.width or 1000
        y0, y1 = 0, session.height or 1000

    # 2. Detect columns
    cols = session.detect_columns([x0, x1], [y0, y1])
    print(f"Detected {len(cols)} columns in data ROI [{x0}, {x1}] x [{y0}, {y1}]")

    # 3. Batch set taxa names if provided
    if args.taxa:
        taxa_path = os.path.abspath(args.taxa)
        if os.path.exists(taxa_path):
            with open(taxa_path, "r", encoding="utf-8") as f:
                names = [line.strip() for line in f if line.strip()]
            session.batch_set_taxa(names)
            print(f"Applied {len(names)} taxa names from {taxa_path}")
        else:
            names = [n.strip() for n in args.taxa.split(",") if n.strip()]
            session.batch_set_taxa(names)

    # 4. Digitize each column
    for c in session.columns:
        c_idx = c["col_index"]
        session.digitize(c_idx, mode=args.mode)
    print(f"Digitized {len(session.columns)} columns (mode: {args.mode})")

    # 5. Apply depth sampling grid
    if args.depth:
        try:
            d_parts = [float(p.strip()) for p in args.depth.split(",")]
            if len(d_parts) == 3:
                start_d, end_d, step_d = d_parts
                session.apply_depth_grid(start_depth=start_d, end_depth=end_d, step=step_d)
            elif len(d_parts) == 2:
                start_d, end_d = d_parts
                session.apply_depth_grid(start_depth=start_d, end_depth=end_d, step=2.0)
            else:
                raise ValueError
        except ValueError:
            print("Error: --depth must be formatted as 'top,bottom,step' (e.g. '0,150,2')", file=sys.stderr)
            return 1
    else:
        session.apply_depth_grid(start_depth=0, end_depth=100, step=2.0)

    # 6. Extract and save matrix data
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
    print(f"Loaded project: {proj_path}")

    out_format = args.format or "csv"
    output_path = os.path.abspath(args.output)
    session.export_data(format=out_format, output_path=output_path)

    print(f"SUCCESS: Exported data to {output_path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="straditize-cli",
        description="Headless Command Line Interface for Straditize Stratigraphic Digitization",
    )
    subparsers = parser.add_subparsers(dest="subcommand", help="Available subcommands")

    # Extract command
    p_extract = subparsers.add_parser("extract", help="Digitize diagram image to CSV/JSON")
    p_extract.add_argument("image", type=str, help="Path to diagram image file (PNG/JPG/TIFF)")
    p_extract.add_argument("--roi", type=str, help="Data area bounding box: 'x0,x1,y0,y1'")
    p_extract.add_argument("--depth", type=str, help="Depth calibration: 'top,bottom,step' (e.g. '0,150,2')")
    p_extract.add_argument("--taxa", type=str, help="Comma-separated taxa names or path to txt file")
    p_extract.add_argument("--mode", type=str, default="area", choices=["area", "bar", "line"], help="Digitization mode")
    p_extract.add_argument("-o", "--output", type=str, required=True, help="Output file path (e.g. result.csv)")
    p_extract.add_argument("-f", "--format", type=str, choices=["csv", "json"], help="Output format")

    # Run-project command
    p_proj = subparsers.add_parser("run-project", help="Run digitization from a .tar / .json project archive")
    p_proj.add_argument("project", type=str, help="Path to project archive (.tar) or project JSON file")
    p_proj.add_argument("-o", "--output", type=str, required=True, help="Output file path")
    p_proj.add_argument("-f", "--format", type=str, choices=["csv", "json"], help="Output format")

    args = parser.parse_args()

    if args.subcommand == "extract":
        sys.exit(cmd_extract(args))
    elif args.subcommand == "run-project":
        sys.exit(cmd_run_project(args))
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
