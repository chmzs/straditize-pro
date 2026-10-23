"""X-Ticks and column scale calibration RPC methods (T07)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register x-ticks methods."""
    dispatcher.register_method("algorithm.detectXTicks", session.detect_xticks_rpc)
    # 只读：测量刻度尺几何（轴线 / 刻线 / 格数 / 刻距）。**不产出任何读数**。
    # 见 `session_parts/xticks.py::measure_ruler_geometry` 的方法文档：
    # 跨列外推满量程在真实图版上实测误差 84%–151%，故本接口拒绝产出建议值。
    dispatcher.register_method("algorithm.measureRuler", session.measure_ruler_geometry)
    dispatcher.register_method("column.calibrateXTicks", session.calibrate_column_xticks)
    dispatcher.register_method("column.clearXTicks", session.clear_column_xticks)
