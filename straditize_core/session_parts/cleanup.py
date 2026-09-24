"""Cleanup session mixin (lines and exclusions)."""

from __future__ import annotations


class CleanupMixin:
    """Session mixin for line detection, mask synthesis, and exclusion regions."""

    def _init_cleanup(self) -> None:
        """Initialize cleanup state."""
        pass
