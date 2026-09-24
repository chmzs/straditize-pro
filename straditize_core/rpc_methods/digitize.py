"""Digitisation, turning points, and control points RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register digitisation operations."""
    dispatcher.register_method("core.extractForeground", session.extract_foreground)
    dispatcher.register_method("core.digitize", session.digitize)
    dispatcher.register_method("core.updateControlPoint", session.update_control_point)
    dispatcher.register_method("point.add", session.point_add)
    dispatcher.register_method("point.move", session.point_move)
    dispatcher.register_method("point.remove", session.point_remove)
    dispatcher.register_method("algorithm.extractTurningPoints", session.algorithm_extract_turning_points)
    dispatcher.register_method("algorithm.extractHorizonConsensus", session.extract_horizon_consensus)
