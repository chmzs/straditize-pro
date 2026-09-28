"""Image cleanup and line removal RPC methods (T05: Line Removal v2)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register line removal and cleanup methods."""
    dispatcher.register_method("algorithm.degrid", session.algorithm_degrid)
    dispatcher.register_method("algorithm.detectLineCandidates", session.detect_line_candidates)
    dispatcher.register_method("algorithm.upsertLineGeometry", session.upsert_line_geometry)
    dispatcher.register_method("algorithm.deleteLineGeometry", session.delete_line_geometry)
    dispatcher.register_method("algorithm.setLineThickness", session.set_line_thickness)
    dispatcher.register_method("algorithm.setGeometryStatus", session.set_line_geometry_status)
    dispatcher.register_method("algorithm.clearCleanupEdits", session.clear_cleanup_edits)
    dispatcher.register_method("algorithm.applyLineRemoval", session.apply_line_removal)
