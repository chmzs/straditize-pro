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
    extract_age_depth_model,
    generate_bacon_script,
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

# Optional RPC & Session exports for remote/headless RPC integration
try:
    from .protocol import (
        CALIBRATION_ERROR,
        EXPORT_ERROR,
        FILE_NOT_FOUND_ERROR,
        INTERNAL_ERROR,
        INVALID_PARAMS,
        INVALID_REQUEST,
        METHOD_NOT_FOUND,
        PARSE_ERROR,
        STATE_ERROR,
        JsonRpcDispatcher,
        JsonRpcError,
        JsonRpcRequest,
    )
    from .rpc_server import (
        StraditizeRpcHttpServer,
        create_rpc_dispatcher,
        run_stdio_server,
    )
    from .session import StraditizeSession
except ImportError:
    pass

__all__ = [
    "AgeDepthAxisCalibrator",
    "AgeDepthModel",
    "CALIBRATION_ERROR",
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
