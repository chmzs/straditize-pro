"""Export session mixin."""

from __future__ import annotations


class ExportMixin:
    """Session mixin for multi-ROI chunked tabular exports (TSV/CSV/LiPD/XLSX)."""

    def _init_export(self) -> None:
        """Initialize export state."""
        pass
