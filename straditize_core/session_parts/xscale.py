"""Single source of truth for column X-axis scale resolution and pixel-to-value conversion.

Unifies all backend conversion paths (CSV/Parquet export, XLSX/LiPD/TAR multi-ROI export,
depth-grid extraction, QA summary, and diagram payload) so the same column and same
calibration produce identical scientific values everywhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from ..calibration import LinearCalibration, LogCalibration
from ..protocol import CALIBRATION_ERROR, JsonRpcError

__all__ = [
    "ColumnScale",
    "resolve_column_scale",
]


@dataclass(frozen=True)
class ColumnScale:
    """Resolved X-axis calibration and display metadata for a single column."""

    abs_px0: float
    val0: float
    abs_px1: float
    val1: float
    unit: str
    plot_type: str
    scale_type: str
    exaggeration_mult: float | None
    calibrated: bool
    source: str  # "x_ticks" | "legacy" | "x_scales" | "default"

    def __iter__(self) -> Iterator[Any]:
        """Support tuple unpacking per design §3.3."""
        yield self.abs_px0
        yield self.val0
        yield self.abs_px1
        yield self.val1
        yield self.unit
        yield self.plot_type
        yield self.scale_type
        yield self.exaggeration_mult
        yield self.calibrated
        yield self.source

    @property
    def declared_max(self) -> float:
        """Maximum declared value across the two tick endpoints when calibrated."""
        return max(self.val0, self.val1) if self.calibrated else 0.0

    def px_to_value(
        self,
        raw_x: float,
        *,
        baseline_px: float | None = None,
        strict: bool = False,
        apply_exaggeration: bool = True,
        col_name: str = "column",
        ndigits: int | None = 4,
    ) -> float:
        """Convert an image X pixel coordinate to scientific abundance/value.

        - Validates log scale constraints first when ``strict=True``;
        - Applies Zero-Abundance rule (``0.0``) when ``raw_x`` sits on ``baseline_px``;
        - Uses ``LogCalibration`` for ``scale_type == 'log'`` and ``LinearCalibration`` otherwise;
        - Divides by ``exaggeration_mult`` when ``apply_exaggeration=True`` and ``exaggeration_mult > 1``.
        """
        span = self.abs_px1 - self.abs_px0

        if self.scale_type == "log":
            try:
                log_calib = LogCalibration(
                    [self.abs_px0, self.abs_px1],
                    [self.val0, self.val1],
                    name=col_name,
                )
            except ValueError as exc:
                if strict:
                    raise JsonRpcError(
                        CALIBRATION_ERROR,
                        f"Invalid log scale calibration for column '{col_name}': {exc}",
                    ) from exc
                log_calib = None
        else:
            log_calib = None

        if baseline_px is not None and abs(raw_x - baseline_px) < 1e-6:
            return 0.0

        if abs(span) <= 1e-9:
            val = 0.0
        elif self.scale_type == "log":
            if log_calib is not None:
                val = float(log_calib.px2data(raw_x))
            else:
                val = float(
                    self.val0 + (raw_x - self.abs_px0) / span * (self.val1 - self.val0)
                )
        else:
            try:
                lin_calib = LinearCalibration(
                    [self.abs_px0, self.abs_px1],
                    [self.val0, self.val1],
                    name=col_name,
                )
                val = float(lin_calib.px2data(raw_x))
            except (ValueError, ZeroDivisionError):
                val = float(
                    self.val0 + (raw_x - self.abs_px0) / span * (self.val1 - self.val0)
                )

        if (
            apply_exaggeration
            and self.exaggeration_mult is not None
            and self.exaggeration_mult > 1.0
        ):
            val = val / self.exaggeration_mult

        clamped = max(0.0, val)
        return round(clamped, ndigits) if ndigits is not None else clamped


def resolve_column_scale(
    session: Any,
    col: dict[str, Any] | None,
    col_index: int | None = None,
) -> ColumnScale:
    """Resolve a column's X-axis scale parameters from a single authoritative entry point.

    Priority (P0):
    1. ``col["x_ticks"]`` (two tick endpoints) -> ``calibrated=True, source="x_ticks"``;
    2. Legacy fields (``startValue`` / ``tickValue`` / ``tickEndX``) or ``session.x_scales``
       -> ``calibrated=False, source="legacy" | "x_scales" | "default"``.
    """
    col_dict = col or {}
    if col_index is None:
        raw_idx = col_dict.get("col_index")
        col_index = int(raw_idx) if isinstance(raw_idx, int) else None

    c_start = float(col_dict.get("startX", col_dict.get("start", 0.0)))
    c_end = float(col_dict.get("endX", col_dict.get("end", c_start + 100.0)))

    # Look up ROI and X-Group if session has multi-ROI context (Design 2026-09-29 P2)
    roi_obj: dict[str, Any] | None = None
    group_obj: dict[str, Any] | None = None
    rois = getattr(session, "rois", None)
    if isinstance(rois, list) and rois:
        col_roi_id = col_dict.get("roi_id")
        if col_roi_id:
            roi_obj = next((r for r in rois if r.get("id") == col_roi_id), None)
        if not roi_obj:
            active_id = getattr(session, "active_roi_id", None) or getattr(
                session, "primary_roi_id", None
            )
            roi_obj = next((r for r in rois if r.get("id") == active_id), rois[0])

        if roi_obj:
            groups = roi_obj.get("x_groups") or []
            target_grp_id = col_dict.get("x_group_id") or roi_obj.get(
                "default_group_id"
            )
            if target_grp_id:
                group_obj = next(
                    (g for g in groups if g.get("id") == target_grp_id), None
                )
            if not group_obj and groups:
                group_obj = groups[0]

    scale_type = str(
        col_dict.get("scale_type")
        or (group_obj.get("scale_type") if group_obj else None)
        or "linear"
    )
    unit = str(
        col_dict.get("unit")
        or (group_obj.get("unit") if group_obj else None)
        or "%"
    )
    plot_type = str(
        col_dict.get("plot_type")
        or col_dict.get("plotType")
        or (group_obj.get("plot_type") if group_obj else None)
        or "area"
    )

    # Resolve exaggeration multiplier across both modern (`exaggeration_mult`)
    # and legacy (`has_exaggeration` + `exaggeration_multiplier` / `exaggerationMult`) keys.
    exaggeration_mult: float | None = None
    if col_dict.get("exaggeration_mult") is not None:
        raw_exag = float(col_dict["exaggeration_mult"])
        if raw_exag > 1.0:
            exaggeration_mult = raw_exag
    elif bool(
        col_dict.get("has_exaggeration", col_dict.get("hasExaggeration", False))
    ):
        raw_exag = float(
            col_dict.get(
                "exaggeration_multiplier", col_dict.get("exaggerationMult", 1.0)
            )
            or 1.0
        )
        if raw_exag > 1.0:
            exaggeration_mult = raw_exag
    elif group_obj and group_obj.get("exaggeration_mult") is not None:
        raw_exag = float(group_obj["exaggeration_mult"])
        if raw_exag > 1.0:
            exaggeration_mult = raw_exag

    # Case A1: Resolved via group tick_layout and column x_values (D1: 组管位置，列管数值)
    x_values = col_dict.get("x_values")
    if isinstance(x_values, (list, tuple)) and len(x_values) >= 2 and group_obj:
        layout = group_obj.get("tick_layout") or [{"rel": 0.0}, {"rel": 1.0}]
        rel0 = float(layout[0].get("rel", 0.0))
        rel1 = float(layout[1].get("rel", 1.0))
        abs_px0 = c_start + rel0 * (c_end - c_start)
        abs_px1 = c_start + rel1 * (c_end - c_start)
        val0 = float(x_values[0])
        val1 = float(x_values[1])
        return ColumnScale(
            abs_px0=abs_px0,
            val0=val0,
            abs_px1=abs_px1,
            val1=val1,
            unit=unit,
            plot_type=plot_type,
            scale_type=scale_type,
            exaggeration_mult=exaggeration_mult,
            calibrated=True,
            source="group",
        )

    # Case A2: Explicit x_ticks (transition SSOT)
    x_ticks = col_dict.get("x_ticks")
    if isinstance(x_ticks, (list, tuple)) and len(x_ticks) >= 2:
        t0, t1 = x_ticks[0], x_ticks[1]
        abs_px0 = float(t0.get("px", t0.get("pixel", c_start)))
        val0 = float(t0.get("value", t0.get("val", 0.0)))
        abs_px1 = float(t1.get("px", t1.get("pixel", c_end)))
        val1 = float(t1.get("value", t1.get("val", 100.0)))
        return ColumnScale(
            abs_px0=abs_px0,
            val0=val0,
            abs_px1=abs_px1,
            val1=val1,
            unit=unit,
            plot_type=plot_type,
            scale_type=scale_type,
            exaggeration_mult=exaggeration_mult,
            calibrated=True,
            source="x_ticks",
        )

    # Fallback: legacy three-piece fields or session.x_scales
    abs_px0 = c_start
    raw_tick_end = col_dict.get("tickEndX")
    abs_px1 = float(raw_tick_end) if raw_tick_end is not None else c_end
    if abs(abs_px1 - abs_px0) < 1e-9:
        abs_px1 = c_end if abs(c_end - abs_px0) >= 1e-9 else (abs_px0 + 100.0)

    has_legacy = any(
        col_dict.get(k) is not None for k in ("startValue", "tickValue", "tickEndX")
    )
    x_scales = getattr(session, "x_scales", None) if session is not None else None
    is_calib = bool(getattr(session, "is_calibrated", False)) if session is not None else False

    if (
        not has_legacy
        and is_calib
        and isinstance(x_scales, dict)
        and col_index is not None
        and col_index in x_scales
    ):
        sx = float(x_scales[col_index].get("slope", 1.0))
        ix = float(x_scales[col_index].get("intercept", 0.0))
        val0 = sx * abs_px0 + ix
        val1 = sx * abs_px1 + ix
        source = "x_scales"
    else:
        default_val0 = 0.0 if scale_type != "log" else 1.0
        val0 = (
            float(col_dict["startValue"])
            if col_dict.get("startValue") is not None
            else default_val0
        )
        val1 = (
            float(col_dict["tickValue"])
            if col_dict.get("tickValue") is not None
            else 100.0
        )
        source = "legacy" if has_legacy else "default"

    return ColumnScale(
        abs_px0=abs_px0,
        val0=val0,
        abs_px1=abs_px1,
        val1=val1,
        unit=unit,
        plot_type=plot_type,
        scale_type=scale_type,
        exaggeration_mult=exaggeration_mult,
        calibrated=False,
        source=source,
    )
