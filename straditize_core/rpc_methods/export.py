"""Data export RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register data export operations."""
    dispatcher.register_method("export.csv", session.export_csv)
    dispatcher.register_method("export.tar", session.export_tar)
    dispatcher.register_method("export.r", session.export_r)
    dispatcher.register_method("export.exportXlsx", session.export_advanced_xlsx)
    dispatcher.register_method("export.exportLipd", session.export_advanced_lipd)
    dispatcher.register_method("core.exportData", session.export_data)
