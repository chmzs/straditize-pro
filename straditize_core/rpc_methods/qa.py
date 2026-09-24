"""QA and consistency verification RPC methods (T09).

Strictly adheres to Frozen Contracts v1.3 §2.7 and §7.
"""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register qa.* RPC methods."""
    dispatcher.register_method("qa.summarize", session.qa_summarize)
