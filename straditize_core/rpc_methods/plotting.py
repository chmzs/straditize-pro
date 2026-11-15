"""Local plotting RPC methods (one-click stratigraphic diagram)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register local plotting operations."""
    dispatcher.register_method("plot.detectR", session.plot_detect_r)
    dispatcher.register_method("plot.render", session.plot_render)
