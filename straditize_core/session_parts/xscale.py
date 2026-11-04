"""Single source of truth for column X-axis scale resolution and pixel-to-value conversion.

Unifies all backend conversion paths (CSV/Parquet export, XLSX/LiPD/TAR multi-ROI export,
depth-grid extraction, QA summary, and diagram payload) so the same column and same
calibration produce identical scientific values everywhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from ..calibration import LinearCalibration, LogCalibration
from ..protocol import CALIBRATION_ERROR, INVALID_PARAMS, JsonRpcError

__all__ = [
    "SCALE_TYPES",
    "ColumnScale",
    "normalize_scale_type",
    "resolve_column_scale",
]

#: The only two X-scale types.
#:
#: 历史断点：``scale_type`` 在写入端（``session_parts/xticks.py``）原样落盘，而这里只判
#: ``== "log"``，因此 ``"LOG"`` / ``"log10"`` / ``"sqrt"`` 一律落进线性桶 —— 表面上是
#: 一条正常的读数，实际换了公式，下游无法分辨（与 P-04 同一种失效型，只低一层）。
SCALE_TYPES: tuple[str, str] = ("linear", "log")


def resolve_axis_stroke(col: dict[str, Any] | None, group: dict[str, Any] | None) -> float:
    """轴线粗解析：**列级覆盖 > 组级初值 > 缺省 5**（ARCHITECTURE §6.4）。

    组的 `axis_stroke_px` 是初值（分列时 `measure_axis_stroke` 实测中位数，或用户在手填）；
    列的 `axis_stroke_px` 只放**用户显式覆盖** —— 分列从不写它，所以它一旦存在就是人填的值，
    重新分列也不会被冲掉。逐列差异是真实存在的（实测 beginner 3/5/5/5、fig3 1~2px），
    组级单值会让少数列的 0 点偏 1~2px。

    非法值（0 / 负数 / 非数值）一律视为"未覆盖"，回落组值，绝不静默取 0：
    那会把绿线压到列左缘上，读数整体偏小一个轴粗。
    """
    raw_col = (col or {}).get("axis_stroke_px")
    try:
        col_stroke = float(raw_col) if raw_col is not None else None
    except (TypeError, ValueError):
        col_stroke = None
    if col_stroke is not None and col_stroke > 0:
        return col_stroke
    raw_group = (group or {}).get("axis_stroke_px")
    try:
        group_stroke = float(raw_group) if raw_group is not None else None
    except (TypeError, ValueError):
        group_stroke = None
    if group_stroke is not None and group_stroke > 0:
        return group_stroke
    return 5.0


def normalize_scale_type(scale_type: Any) -> str:
    """Validate and canonicalise an X-scale type.

    Case and surrounding whitespace are normalised（``" LOG "`` → ``"log"``，无歧义）；
    未知取值抛 ``INVALID_PARAMS``，**不静默当线性**：两个分支用同一批像素算出不同的数，
    界面上却看不出区别，静默兜底等于交付一个没人能察觉的错值。
    """
    key = str(scale_type or "linear").strip().lower()
    if key not in SCALE_TYPES:
        raise JsonRpcError(
            INVALID_PARAMS,
            f"未知的 X 轴标度类型 {scale_type!r}：只支持 {' / '.join(SCALE_TYPES)}。",
        )
    return key


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
    source: str  # "group_slope" | "x_ticks" | "legacy" | "x_scales" | "default"

    def __post_init__(self) -> None:
        """构造时一次性归一化，使下游只需面对两个已知取值。

        `ColumnScale` 是冻结的，所以用 ``object.__setattr__`` 写回；这样
        ``px_to_value`` 里的 ``else`` 分支恒等于线性，不再可能悄悄兜住第三个值。
        """
        object.__setattr__(self, "scale_type", normalize_scale_type(self.scale_type))

    def __iter__(self) -> Iterator[Any]:
        """Support tuple unpacking; field order is the yield order below."""
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
        require_calibrated: bool = True,
    ) -> float:
        """Convert an image X pixel coordinate to scientific abundance/value.

        - Validates log scale constraints first when ``strict=True``;
        - Applies Zero-Abundance rule (``0.0``) when ``raw_x`` sits on ``baseline_px``;
        - Uses ``LogCalibration`` for ``scale_type == 'log'`` and ``LinearCalibration`` otherwise;
        - Divides by ``exaggeration_mult`` when ``apply_exaggeration=True`` and ``exaggeration_mult > 1``.

        **未标定时默认抛错**（``require_calibrated=True``）：没有用户确认的两个端点，
        这个换算只会把分列期写入的 `clamp(0.65×列宽,20,80)` 当成满量程算出一个
        看起来正常的数。实测 diatom benchmark：用这套默认值，全表 MAE 从 0.204
        涨到 4.059（19.9 倍，见 docs/findings/bench-issues/bench-diatom.md D-03）。
        调用方若确实要一个"仅供参考"的粗值，必须显式传 False 并自行标注未标定。
        """
        if require_calibrated and not self.calibrated:
            raise ValueError(
                f"列 {col_name!r} 尚未标定 X 轴刻度（scale source={self.source}），"
                "不能把像素换算成读数。请先在步骤 6 标定该列的刻度端点。"
            )
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

    # Case A1: 组级斜率（点齿标定的结果，ARCHITECTURE §6.4）
    #
    # 用户点一个刻度齿 + 填它的数字 → slope = 数字 / (该齿px − 0点px)。
    # 组内所有列共用这个斜率（同量程），每列的 0 点各自算 = 左缘 + 轴线粗。
    # 优先于 x_ticks：组标定是用户的显式动作，旧的两点视为过期
    # （写入组标定时会清掉组内各列的 x_ticks，保证单一事实源）。
    _slope_raw = group_obj.get("value_per_px") if group_obj else None
    _slope: float | None
    try:
        _slope = float(_slope_raw) if _slope_raw is not None else None
    except (TypeError, ValueError):
        _slope = None
    if _slope is not None and _slope != 0:
        _group = group_obj or {}
        # 0 点 = 列左缘 + 轴线粗（ARCHITECTURE §6.4）。
        #
        # `c_start` 是 `detect_column_bounds` 给的**轴线左缘**（列切分线）；面积图的
        # 0 点画在轴线右缘，所以必须再加 `axis_stroke_px`。两者分工是硬的：
        # 红线 = start（列切分线，也是上一列的结束线），绿线 = start + 轴粗（0 点）。
        #
        # `detect_columns` 里的右缘锚定（`anchor_zero_at_axis_right`）默认关闭，
        # 就是为了保住这条分工；一旦开启，start 变成右缘，这里再加轴粗即双偏移。
        _stroke = resolve_axis_stroke(col_dict, _group)
        _zero = c_start + _stroke
        return ColumnScale(
            abs_px0=_zero,
            val0=0.0,
            abs_px1=_zero + 1.0,
            val1=_slope,
            unit=str(_group.get("unit") or col_dict.get("unit") or "%"),
            plot_type=str(_group.get("plot_type") or col_dict.get("plot_type") or "area"),
            scale_type=str(_group.get("scale_type") or "linear"),
            exaggeration_mult=_group.get("exaggeration_mult"),
            calibrated=True,
            source="group_slope",
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
