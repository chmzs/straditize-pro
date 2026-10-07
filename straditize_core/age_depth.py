"""Age-depth model diagram recognition, extraction, and uncertainty mapping.

Provides scientific algorithms to:
1. Calibrate X (Age) and Y (Depth) axes of an age-depth diagram.
2. Extract the central best-fit line (Median / Weighted Mean Age) and 95% HPD confidence envelope.
3. Map pollen sample depth horizons to calendar ages with uncertainty bounds.
4. Support user metadata attributes (Median vs Mean, confidence levels, IntCal version).
5. Generate ready-to-run rbacon MCMC simulation scripts and LiPD-compatible structures.

This facade module re-exports mathematical modeling from :mod:`.age_depth_model`
and figure tracing / curve extraction from :mod:`.age_depth_tracer`.
"""

from __future__ import annotations

from .age_depth_model import (
    AgeDepthAxisCalibrator,
    AgeDepthModel,
    SIGMA_LOG_RATE_CAP,
    _cumulative_trapezoid,
    check_local_r_environment,
    find_rscript,
    generate_bacon_script,
    generate_geochronr_script,
    run_local_bacon,
)
from .age_depth_tracer import (
    _contiguous_runs,
    _detect_axis_rule_box,
    _otsu_threshold,
    _pava_increasing,
    _rule_box_holds_calibration,
    extract_age_depth_model,
)

__all__ = [
    "AgeDepthAxisCalibrator",
    "AgeDepthModel",
    "SIGMA_LOG_RATE_CAP",
    "_cumulative_trapezoid",
    "_pava_increasing",
    "_contiguous_runs",
    "_otsu_threshold",
    "_detect_axis_rule_box",
    "_rule_box_holds_calibration",
    "extract_age_depth_model",
    "generate_bacon_script",
    "generate_geochronr_script",
    "find_rscript",
    "check_local_r_environment",
    "run_local_bacon",
]
