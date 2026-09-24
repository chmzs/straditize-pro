"""Axes calibration RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register calibration operations."""
    dispatcher.register_method("core.calibrateAxes", session.calibrate_axes)
