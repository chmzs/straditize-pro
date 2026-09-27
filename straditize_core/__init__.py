"""straditize_core - Headless, GUI-free, Matplotlib-free core digitization engine for straditize.

Provides pure Python / NumPy / SciPy / pandas / Pillow / scikit-image workflows
for stratigraphic diagram parsing, column detection, profile digitization,
curve control point editing, and scientific calibration.
"""

from .calibration import (
    LinearCalibration,
    PiecewiseCalibration,
    StratigraphicCalibration,
)
from .columns import (
    ColumnBound,
    detect_column_bounds,
    detect_column_starts,
    groupby_arr,
    slice_columns,
)
from .curve import (
    ControlPointSet,
    extract_control_points,
    rdp_indices,
    reconstruct_curve,
)
from .digitize import (
    digitize_column,
    digitize_columns,
    interpolate_hlines,
    trace_area_profile,
    trace_bar_profile,
    trace_line_center,
)
from .image import (
    build_foreground,
    circular_hue_distance,
    dominant_overlay_hue,
    guided_target_color_mask,
    guided_target_hue_family_mask,
    light_overlay_colored_mask,
    load_image,
    normalize_extraction_mode,
    normalize_segmentation_mode,
    normalize_target_colors,
    split_primary_exagg,
    target_color_rgb,
    to_binary,
    to_grey,
)
from .age_depth import (
    AgeDepthAxisCalibrator,
    AgeDepthModel,
    check_local_r_environment,
    extract_age_depth_model,
    generate_bacon_script,
    generate_geochronr_script,
)
from .metadata import (
    chunk_text_by_tokens,
    export_lipd_jsonld,
    export_lipd_package,
    export_scientific_xlsx,
    extract_metadata_from_chunks,
    extract_text_from_pdf,
    fetch_doi_metadata,
    merge_chunk_extractions,
    normalize_doi,
)
from .pipeline import StraditizePipeline

# Lazy exports for protocol, rpc_server, and session to avoid runpy RuntimeWarning on `python -m`
_LAZY_EXPORTS = {
    "StraditizeRpcHttpServer": ".rpc_server",
    "create_rpc_dispatcher": ".rpc_server",
    "run_stdio_server": ".rpc_server",
    "StraditizeSession": ".session",
    "CALIBRATION_ERROR": ".protocol",
    "EXPORT_ERROR": ".protocol",
    "FILE_NOT_FOUND_ERROR": ".protocol",
    "INTERNAL_ERROR": ".protocol",
    "INVALID_PARAMS": ".protocol",
    "INVALID_REQUEST": ".protocol",
    "METHOD_NOT_FOUND": ".protocol",
    "PARSE_ERROR": ".protocol",
    "STATE_ERROR": ".protocol",
    "JsonRpcDispatcher": ".protocol",
    "JsonRpcError": ".protocol",
    "JsonRpcRequest": ".protocol",
}


def __getattr__(name: str):
    if name in _LAZY_EXPORTS:
        import importlib

        mod = importlib.import_module(_LAZY_EXPORTS[name], __package__)
        return getattr(mod, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "AgeDepthAxisCalibrator",
    "AgeDepthModel",
    "CALIBRATION_ERROR",
    "check_local_r_environment",
    "ColumnBound",
    "ControlPointSet",
    "EXPORT_ERROR",
    "FILE_NOT_FOUND_ERROR",
    "INTERNAL_ERROR",
    "INVALID_PARAMS",
    "INVALID_REQUEST",
    "JsonRpcDispatcher",
    "JsonRpcError",
    "JsonRpcRequest",
    "LinearCalibration",
    "METHOD_NOT_FOUND",
    "PARSE_ERROR",
    "PiecewiseCalibration",
    "STATE_ERROR",
    "StraditizePipeline",
    "StraditizeRpcHttpServer",
    "StraditizeSession",
    "StratigraphicCalibration",
    "build_foreground",
    "chunk_text_by_tokens",
    "circular_hue_distance",
    "create_rpc_dispatcher",
    "detect_column_bounds",
    "detect_column_starts",
    "digitize_column",
    "digitize_columns",
    "dominant_overlay_hue",
    "export_lipd_jsonld",
    "export_lipd_package",
    "export_scientific_xlsx",
    "extract_age_depth_model",
    "extract_control_points",
    "extract_metadata_from_chunks",
    "extract_text_from_pdf",
    "fetch_doi_metadata",
    "generate_bacon_script",
    "generate_geochronr_script",
    "groupby_arr",
    "guided_target_color_mask",
    "guided_target_hue_family_mask",
    "interpolate_hlines",
    "light_overlay_colored_mask",
    "load_image",
    "merge_chunk_extractions",
    "normalize_doi",
    "normalize_extraction_mode",
    "normalize_segmentation_mode",
    "normalize_target_colors",
    "rdp_indices",
    "reconstruct_curve",
    "run_stdio_server",
    "slice_columns",
    "split_primary_exagg",
    "target_color_rgb",
    "to_binary",
    "to_grey",
    "trace_area_profile",
    "trace_bar_profile",
    "trace_line_center",
]

__version__ = "0.1.0"
