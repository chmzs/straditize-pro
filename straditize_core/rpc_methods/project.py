"""Project lifecycle, image operations, and command history RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register project, image, and history operations."""
    dispatcher.register_method("project.new", session.project_new)
    dispatcher.register_method("project.load", session.project_load)
    dispatcher.register_method("project.save", session.project_save)

    dispatcher.register_method("core.loadImage", session.load_image)
    dispatcher.register_method("image.load", session.load_image)
    dispatcher.register_method("image.detectDeskew", session.detect_deskew_angle)
    dispatcher.register_method("image.rotate", session.rotate_image)

    dispatcher.register_method("history.undo", session.history_undo)
    dispatcher.register_method("history.redo", session.history_redo)

    dispatcher.register_method("core.batchSetTaxa", session.batch_set_taxa)
    dispatcher.register_method("core.applyDepthGrid", session.apply_depth_grid)
    dispatcher.register_method("core.extractGridValues", session.extract_grid_values)
