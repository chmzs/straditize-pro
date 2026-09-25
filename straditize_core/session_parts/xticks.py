"""X-Ticks session mixin (T07: Geometric x-axis tick detection and column calibration)."""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np

from ..protocol import JsonRpcError
from ..xticks import detect_xticks


class XTicksMixin:
    """Session mixin for X-ticks detection and per-column calibration."""

    tick_band: list[int] | None

    def _init_xticks(self) -> None:
        """Initialize xticks state."""
        self.tick_band = None

    def detect_xticks_rpc(
        self,
        roi_id: str | None = None,
        band: Sequence[int] | None = None,
        dark_threshold: int = 160,
    ) -> dict[str, Any]:
        """Detect x-axis tick marks for an ROI using geometric run algorithm."""
        if getattr(self, "image", None) is None:
            return {"band": None, "per_column": []}

        # Convert image to greyscale
        img = self.image.convert("L")
        gray = np.array(img)

        cols = []
        target_roi_id = roi_id
        if not target_roi_id and hasattr(self, "rois") and self.rois:
            target_roi_id = getattr(self, "active_roi_id", None) or self.rois[0]["id"]

        for col in getattr(self, "columns", []):
            if not target_roi_id or col.get("roi_id") == target_roi_id:
                cols.append((col.get("startX", col.get("start", 0)), col.get("endX", col.get("end", 0))))

        res = detect_xticks(gray, band=band, dark_threshold=dark_threshold, columns=cols if cols else None)
        if res.get("band"):
            self.tick_band = list(res["band"])
        return res

    def calibrate_column_xticks(
        self,
        col_index: int,
        ticks: list[dict[str, float]],
        unit: str = "%",
        plot_type: str = "area",
        scale_type: str = "linear",
        exaggeration_mult: float | None = None,
    ) -> dict[str, Any]:
        """Calibrate a column's scale using exactly two tick endpoints [Tick(px, value), Tick(px, value)].

        Enforces:
        - Exactly two ticks required;
        - Pixel coordinates must not be identical;
        - Updates Column.x_ticks as the sole source of truth.
        """
        if not ticks or len(ticks) != 2:
            raise JsonRpcError(
                -32602,
                f"参数格式不合规：每列标定需要恰好 2 个端点刻度齿 (Tick)，当前提供了 {len(ticks) if ticks else 0} 个。请在【步骤 6: 标定列】点选起点和终点刻度。",
            )

        t0, t1 = ticks[0], ticks[1]
        px0, val0 = float(t0.get("px", t0.get("pixel", 0))), float(t0.get("value", t0.get("val", 0)))
        px1, val1 = float(t1.get("px", t1.get("pixel", 0))), float(t1.get("value", t1.get("val", 0)))

        if px0 == px1:
            raise JsonRpcError(
                -32602,
                "参数格式不合规：两个标定刻度齿的像素 X 坐标不能相同。请重新拾取相隔一定距离的刻度线齿。",
            )

        columns = getattr(self, "columns", [])
        if col_index < 0 or col_index >= len(columns):
            raise JsonRpcError(
                -32001,
                f"前置状态缺失：列索引 {col_index} 超出范围。请先在【步骤 5: 分列】确认列切分。",
            )

        col = columns[col_index]

        # Check bounds: tick endpoints should fall reasonably near column boundaries
        c_start = float(col.get("startX", col.get("start", 0)))
        c_end = float(col.get("endX", col.get("end", 0)))
        lo, hi = min(c_start, c_end) - 10, max(c_start, c_end) + 10
        if not (lo <= px0 <= hi and lo <= px1 <= hi):
            # Out of bounds warning / guard
            raise JsonRpcError(
                -32602,
                f"参数范围越界：刻度点像素 ({px0}, {px1}) 超出该列物理范围 [{lo}, {hi}]。请在列边界内拾取有效标尺刻度。",
            )

        # Set sole source of truth
        col["x_ticks"] = [{"px": px0, "value": val0}, {"px": px1, "value": val1}]
        col["unit"] = unit
        col["plot_type"] = plot_type
        col["scale_type"] = scale_type
        col["exaggeration_mult"] = exaggeration_mult
        col["mult_source"] = "user" if exaggeration_mult is not None else None

        # Derive px_per_unit for inspection
        px_span = abs(px1 - px0)
        val_span = abs(val1 - val0)
        px_per_unit = (px_span / val_span) if val_span > 0 else 0.0

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Calibrate X-Ticks for {col.get('name', f'col_{col_index}')}")

        return {
            "col_index": col_index,
            "x_ticks": col["x_ticks"],
            "px_per_unit": px_per_unit,
            "column": col,
        }
