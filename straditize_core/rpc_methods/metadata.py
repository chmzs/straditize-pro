"""Metadata extraction and management RPC methods."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register metadata operations."""
    dispatcher.register_method("metadata.fetchByDoi", session.metadata_fetch_doi)
    dispatcher.register_method("metadata.extractFromPdf", session.metadata_extract_pdf)
    dispatcher.register_method("metadata.update", session.metadata_update)
    dispatcher.register_method("metadata.get", session.metadata_get)
