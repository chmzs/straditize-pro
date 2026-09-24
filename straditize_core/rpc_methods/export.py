"""Data export RPC methods (T10: Multi-ROI chunked exports).

Strictly adheres to:
- Frozen Contracts v1.3 §2.6 & §4.2;
- POSIX UStar tar archiving, multi-sheet XLSX, multi-table LiPD, and readiness checklist.
"""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register data export operations."""
    dispatcher.register_method("export.csv", session.export_csv)
    dispatcher.register_method("export.tar", session.export_multi_tar)
    dispatcher.register_method("export.r", session.export_r)
    dispatcher.register_method("export.exportXlsx", session.export_multi_xlsx)
    dispatcher.register_method("export.exportLipd", session.export_multi_lipd)
    dispatcher.register_method("export.getReadiness", session.get_export_readiness)
    dispatcher.register_method("core.exportData", session.export_data)
