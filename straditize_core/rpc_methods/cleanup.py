"""Image cleanup and line removal RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register line removal and cleanup methods."""
    dispatcher.register_method("algorithm.degrid", session.algorithm_degrid)
