"""Samples session mixin (T08: Sample horizons & consensus extraction)."""

from __future__ import annotations

from typing import Any, Sequence
from ..protocol import JsonRpcError


class SamplesMixin:
    """Session mixin for sample horizons and consensus extraction."""

    samples: list[dict[str, Any]]

    def _init_samples(self) -> None:
        """Initialize samples state."""
        self.samples = []

    def _depth_for_row_px(self, row_px: float) -> float | None:
        """Calculate real physical depth for pixel row, or return None if uncalibrated."""
        if getattr(self, "is_calibrated", False) and getattr(self, "y_scale", None) is not None:
            slope = self.y_scale.get("slope", 0.0)
            intercept = self.y_scale.get("intercept", 0.0)
            return round(slope * float(row_px) + intercept, 4)
        return None

    def samples_set(
        self,
        samples: Sequence[dict[str, Any]],
        source: str = "manual",
    ) -> dict[str, Any]:
        """Set sample horizons.

        Each sample must conform to:
        {
          "row_px": int | float,
          "depth": float | None,
          "source": 'auto' | 'paste' | 'manual',
        }
        Uncalibrated sessions enforce depth === None.
        """
        if not hasattr(self, "samples") or self.samples is None:
            self._init_samples()

        valid_samples: list[dict[str, Any]] = []
        for s in samples:
            row_px = float(s.get("row_px", 0.0))
            given_depth = s.get("depth")
            # If session is calibrated, calculate depth if not given
            calc_depth = self._depth_for_row_px(row_px)
            depth_val = float(given_depth) if given_depth is not None else calc_depth

            s_source = s.get("source", source)
            if s_source not in ("auto", "paste", "manual"):
                s_source = "manual"

            valid_samples.append({
                "row_px": int(round(row_px)),
                "depth": depth_val,
                "source": s_source,
            })

        # Sort by row_px ascending
        valid_samples.sort(key=lambda item: item["row_px"])
        self.samples = valid_samples

        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Set {len(self.samples)} sample horizons")

        return {"samples": self.samples, "count": len(self.samples)}

    def samples_list(self) -> dict[str, Any]:
        """List all current sample horizons."""
        if not hasattr(self, "samples") or self.samples is None:
            self._init_samples()
        return {"samples": self.samples, "count": len(self.samples)}

    def samples_clear(self) -> dict[str, Any]:
        """Clear all sample horizons."""
        if not hasattr(self, "samples") or self.samples is None:
            self._init_samples()
        cleared_count = len(self.samples)
        self.samples = []
        return {"success": True, "cleared_count": cleared_count}

    def samples_extract_consensus(
        self,
        tolerance_px: float = 2.5,
        min_taxa_support: int = 1,
    ) -> dict[str, Any]:
        """Discover sample horizons by consensus of turning points across taxa and set them into samples."""
        if not hasattr(self, "extract_horizon_consensus"):
            raise JsonRpcError(-32603, "extract_horizon_consensus method not available on session.")

        res = self.extract_horizon_consensus(
            tolerance_px=tolerance_px, min_taxa_support=min_taxa_support
        )
        pixel_y = res.get("pixel_y", [])

        new_samples = []
        for row in pixel_y:
            new_samples.append({
                "row_px": row,
                "depth": self._depth_for_row_px(row),
                "source": "auto",
            })

        return self.samples_set(new_samples, source="auto")

    def samples_paste_depths(self, depths: Sequence[float]) -> dict[str, Any]:
        """Set sample horizons from a pasted sequence of real depth numbers.

        Requires Y-axis calibration to map depths back to pixel rows.
        """
        if not getattr(self, "is_calibrated", False) or getattr(self, "y_scale", None) is None:
            raise JsonRpcError(
                -32001,
                "前置状态缺失：无法映射外部粘贴深度。当前图谱尚未建立 Y 轴标定，请先前往【步骤 3: Y轴标定】完成两点深度标定。",
            )

        slope = self.y_scale.get("slope", 0.0)
        intercept = self.y_scale.get("intercept", 0.0)
        if abs(slope) < 1e-9:
            raise JsonRpcError(
                -32003,
                "算法解算中断：当前 Y 轴标定斜率为 0，无法将物理深度逆向映射回像素行。请在【步骤 3: Y轴标定】中重新设置有效的两点标定。",
            )

        new_samples = []
        for d in depths:
            d_val = float(d)
            # depth = slope * row + intercept -> row = (depth - intercept) / slope
            row_px = (d_val - intercept) / slope
            new_samples.append({
                "row_px": int(round(row_px)),
                "depth": round(d_val, 4),
                "source": "paste",
            })

        return self.samples_set(new_samples, source="paste")
