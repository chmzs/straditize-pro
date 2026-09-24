"""X-Ticks and column scale calibration RPC methods (T07)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register x-ticks methods."""
    dispatcher.register_method("algorithm.detectXTicks", session.detect_xticks_rpc)
    dispatcher.register_method("column.calibrateXTicks", session.calibrate_column_xticks)
