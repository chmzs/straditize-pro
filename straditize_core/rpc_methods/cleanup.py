"""Image cleanup and line removal RPC methods (T05: Line Removal v2)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register line removal and cleanup methods."""
    dispatcher.register_method("algorithm.degrid", session.algorithm_degrid)
    dispatcher.register_method("algorithm.detectLineCandidates", session.detect_line_candidates)
    dispatcher.register_method("algorithm.applyLineRemoval", session.apply_line_removal)
