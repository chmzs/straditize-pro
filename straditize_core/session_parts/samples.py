"""Samples session mixin (T08: Sample horizons & consensus extraction)."""

from __future__ import annotations

import math
from typing import Any, Sequence
from ..protocol import INVALID_PARAMS, STATE_ERROR, JsonRpcError


#: 拐点共识层位的诊断量（issue #83, #124）。只有 `source == 'auto'` 的层位带这些键，
#: 其余来源缺失是正常状态——缺失即"无共识度信息"，渲染与导出一律不得编造取值。
_SAMPLE_DIAGNOSTIC_KEYS = (
    "support_columns",
    "cluster_span_px",
    "member_count",
    "polarity",
)


def _sample_diagnostics(sample: dict[str, Any]) -> dict[str, Any]:
    """把层位自带的共识诊断量原样带过去（缺省不写键，不填 0）。"""
    out: dict[str, Any] = {}
    for key in _SAMPLE_DIAGNOSTIC_KEYS:
        val = sample.get(key)
        if val is not None:
            out[key] = str(val) if key == "polarity" else int(val)
    return out


class SamplesMixin:
    """Session mixin for sample horizons and consensus extraction."""

    samples: list[dict[str, Any]]

    def _init_samples(self) -> None:
        """Initialize samples state."""
        self.samples = []

    def _depth_for_row_px(self, row_px: float) -> float | None:
        """Calculate real physical depth for pixel row, or return None if uncalibrated."""
        if (
            getattr(self, "is_calibrated", False)
            and getattr(self, "y_scale", None) is not None
        ):
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
          "source": 'auto' | 'paste' | 'manual' | 'grid',
          # 可选，仅 `auto` 层位带：拐点共识诊断量（#83）
          "support_columns"?: int, "cluster_span_px"?: int, "member_count"?: int,
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
            # `grid` = `samples.fromDepthGrid` 生成的等距网格层位（与拐点共识 `auto`、
            # 粘贴 `paste`、手工 `manual` 并列）。未知取值仍落 `manual`（既有行为）。
            if s_source not in ("auto", "paste", "manual", "grid"):
                s_source = "manual"

            valid_samples.append(
                {
                    "row_px": int(round(row_px)),
                    "depth": depth_val,
                    "source": s_source,
                    **_sample_diagnostics(s),
                }
            )

        # Sort by row_px ascending
        valid_samples.sort(key=lambda item: item["row_px"])

        # **先记录，再修改，并把 samples 纳入快照**（B-06b / task-12）。
        #
        # 两层都要补，少一层都撤不回来：
        # 1. 快照结构原本不含 `samples`（`_snapshot_editable_state()` 只管
        #    columns/control_points/data_xlim/data_ylim/taxa_names），即便记了也恢复
        #    不了；
        # 2. 记录时机原本在赋值之后，即便快照含 samples，存进去的也是新值。
        #
        # ## 判断：samples **应当**参与撤销
        #
        # 层位是用户在步骤 7 显式输入（粘贴深度 / 手工添加 / 自动共识后人工确认），
        # 与 columns 同为可编辑实体。粘错一批却撤不回来，用户会以为撤销生效而继续
        # 往下走——这比"不支持撤销"更糟，属于**静默失效**。
        #
        # 粒度问题（整批只记一格）不构成反对理由：一次粘贴本就是**一个用户动作**，
        # 撤销应当一次撤整批，而不是 158 次。这与文本编辑器里"一次 Ctrl+Z 撤掉整段
        # 粘贴"是同一种语义。
        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Set {len(valid_samples)} sample horizons")

        self.samples = valid_samples

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
        mode: str = "dual",
        adaptive_window: bool = True,
    ) -> dict[str, Any]:
        """Discover sample horizons by consensus of turning points across taxa and set them into samples."""
        if not hasattr(self, "extract_horizon_consensus"):
            raise JsonRpcError(
                -32603, "extract_horizon_consensus method not available on session."
            )

        res = self.extract_horizon_consensus(
            tolerance_px=tolerance_px,
            min_taxa_support=min_taxa_support,
            mode=mode,
            adaptive_window=adaptive_window,
        )
        self._last_consensus_config = {
            "tolerance_px": tolerance_px,
            "min_taxa_support": min_taxa_support,
            "mode": mode,
            "adaptive_window": adaptive_window,
        }
        pixel_y = res.get("pixel_y", [])
        # #83：把逐层共识诊断量（support_columns / cluster_span_px / member_count）
        # 一并落到 samples 上，否则画布无法区分「8 列共振」与「1 列孤峰」。
        diagnostics = {h["row_px"]: h for h in (res.get("horizons") or [])}

        new_samples = []
        for row in pixel_y:
            entry: dict[str, Any] = {
                "row_px": row,
                "depth": self._depth_for_row_px(row),
                "source": "auto",
            }
            layer = diagnostics.get(row)
            if layer is not None:
                entry.update(_sample_diagnostics(layer))
            new_samples.append(entry)

        return self.samples_set(new_samples, source="auto")

    def samples_paste_depths(self, depths: Sequence[float]) -> dict[str, Any]:
        """Set sample horizons from a pasted sequence of real depth numbers.

        Requires Y-axis calibration to map depths back to pixel rows.
        """
        if (
            not getattr(self, "is_calibrated", False)
            or getattr(self, "y_scale", None) is None
        ):
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
            new_samples.append(
                {
                    "row_px": int(round(row_px)),
                    "depth": round(d_val, 4),
                    "source": "paste",
                }
            )

        return self.samples_set(new_samples, source="paste")

    def samples_from_depth_grid(
        self,
        step: float,
        start_depth: float | None = None,
        end_depth: float | None = None,
        replace: bool = True,
    ) -> dict[str, Any]:
        """按**等距网格**生成层位（S4：钻孔 600+ 样品，拐点共识给不出这个密度）。

        ## 为什么需要它

        `samples_extract_consensus` 的行集是「多列拐点聚类」的结果，点密度由拐点数决定
        而不是采样方案决定：同一张图，数字化从稀疏控制点换成稠密逐行曲线后点数
        203 → 355（实测，见 `docs/findings/recon-20261117.md` §5）。用户要的
        「按采样间隔出数」是另一种行集，不能靠调共识参数得到。

        ## 与既有行集的关系

        写进 `self.depth_grid`（`dataset=depth_grid` 的那份）**与** `self.samples`
        （默认导出行集）—— 两条通道同一批数，避免"导出面板选网格 / 默认导出"给出
        两套行位。

        ## 什么都不静默兜底

        - 未标定 → `STATE_ERROR`（没有深度就没有网格，不给行号冒充深度）；
        - `step <= 0` → `INVALID_PARAMS`；
        - 显式区间越出标定区间 → `INVALID_PARAMS`，消息带上真实标定区间。
          （本工程深度标定只覆盖 y 592..984，而 ROI 是 316..1836；按 ROI 外推会给出
          一批假年龄，见报告 §9 相邻发现 1。）
        - 步长细于图像行分辨率（多个深度落到同一行）→ `INVALID_PARAMS`，消息给出
          该图的 `x{unit}/px` 分辨率与最小可用步长。**不**静默去重：那会让用户以为
          自己拿到了 N 个层位，实际拿到更少。
        """
        if (
            not getattr(self, "is_calibrated", False)
            or getattr(self, "y_scale", None) is None
        ):
            raise JsonRpcError(
                STATE_ERROR,
                "前置状态缺失：等距网格需要 Y 轴标定。请先在【步骤 3: Y轴标定】完成两点标定。",
            )
        slope = float(self.y_scale.get("slope", 0.0))
        intercept = float(self.y_scale.get("intercept", 0.0))
        if abs(slope) < 1e-12:
            raise JsonRpcError(
                STATE_ERROR,
                "算法解算中断：当前 Y 轴标定斜率为 0，无法把深度映射回像素行。请重新标定。",
            )
        try:
            step_value = float(step)
        except (TypeError, ValueError) as exc:
            raise JsonRpcError(
                INVALID_PARAMS, f"步长必须是数值（收到 {step!r}）。"
            ) from exc
        if not (step_value > 0):
            raise JsonRpcError(INVALID_PARAMS, f"步长必须 > 0（收到 {step_value}）。")

        calib = getattr(self, "depth_calib", None) or {}
        cal_lo = calib.get("top_cm")
        cal_hi = calib.get("bottom_cm")
        unit = str(calib.get("unit") or getattr(self, "depth_unit", "") or "")
        if cal_lo is None or cal_hi is None:
            raise JsonRpcError(
                STATE_ERROR,
                "前置状态缺失：缺少深度标定区间（top_cm/bottom_cm），无法约束网格范围。",
            )
        cal_lo, cal_hi = sorted((float(cal_lo), float(cal_hi)))

        # 默认区间 = ROI 深度范围 ∩ 标定区间：ROI 之外没有墨迹，标定之外没有深度。
        roi_lo, roi_hi = cal_lo, cal_hi
        ylim = getattr(self, "data_ylim", None)
        if ylim and len(ylim) >= 2 and ylim[0] is not None and ylim[1] is not None:
            y_lo, y_hi = sorted((float(ylim[0]), float(ylim[1])))
            roi_lo = slope * y_lo + intercept
            roi_hi = slope * y_hi + intercept
            roi_lo, roi_hi = sorted((roi_lo, roi_hi))
        lo = max(cal_lo, roi_lo) if start_depth is None else float(start_depth)
        hi = min(cal_hi, roi_hi) if end_depth is None else float(end_depth)
        if start_depth is not None or end_depth is not None:
            if lo < cal_lo - 1e-9 or hi > cal_hi + 1e-9:
                raise JsonRpcError(
                    INVALID_PARAMS,
                    f"区间 [{lo}, {hi}] 越出 Y 轴标定区间 [{cal_lo}, {cal_hi}] {unit}："
                    "标定之外没有真实深度，不做外推。",
                )
        lo, hi = sorted((lo, hi))
        if hi - lo <= 0:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"区间为空（[{lo}, {hi}]）：请检查 ROI 与 Y 轴标定是否重叠。",
            )

        # 浮点保护：`hi - lo` 由标定斜率的乘加得到，100.0 常常是 99.9999999999986，
        # 直接 int() 会少一个层位（实测：0..100 每 1cm 只出 100 层而不是 101 层）。
        span = hi - lo
        count = int(math.floor(span / step_value + 1e-9)) + 1
        if count < 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"步长 {step_value} 与区间 [{lo}, {hi}] 不足以生成两个层位（只有 {count} 个）。",
            )
        depths = [round(lo + index * step_value, 6) for index in range(count)]

        rows = [int(round((depth - intercept) / slope)) for depth in depths]
        if len(set(rows)) != len(rows):
            resolution = abs(slope)
            raise JsonRpcError(
                INVALID_PARAMS,
                f"步长 {step_value} {unit} 细于图像行分辨率 {resolution:.5f} {unit}/px："
                f"{len(depths)} 个深度会落到 {len(set(rows))} 行上。"
                f"该图最小可用步长约 {resolution:.3f} {unit}（1 px）。",
            )

        if replace:
            self.samples = []
        result = self.samples_set(
            [
                {"row_px": row, "depth": depth, "source": "grid"}
                for row, depth in zip(rows, depths)
            ],
            source="grid",
        )
        self.depth_grid = list(depths)
        result.update(
            {
                "step": step_value,
                "start": lo,
                "end": hi,
                "unit": unit,
                "row_step_px": (rows[1] - rows[0]) if len(rows) > 1 else 0,
            }
        )
        return result
