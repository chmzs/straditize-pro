"""Sample horizons and consensus extraction RPC methods (T08)."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register samples.* RPC methods."""
    dispatcher.register_method("samples.set", session.samples_set)
    dispatcher.register_method("samples.list", session.samples_list)
    dispatcher.register_method("samples.clear", session.samples_clear)
    dispatcher.register_method("samples.extractConsensus", session.samples_extract_consensus)
    dispatcher.register_method("samples.pasteDepths", session.samples_paste_depths)
