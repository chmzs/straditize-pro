"""Column management and detection RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register column manipulation and detection methods."""
    dispatcher.register_method("column.add", session.column_add)
    dispatcher.register_method("column.remove", session.column_remove)
    dispatcher.register_method("column.update", session.column_update)
    dispatcher.register_method("core.detectColumns", session.detect_columns)
    dispatcher.register_method("algorithm.detectColumns", session.algorithm_detect_columns)
