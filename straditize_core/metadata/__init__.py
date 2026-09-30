"""Metadata semi-automatic extraction, synthesis, and export module for Straditize Pro."""

from .doi import fetch_doi_metadata, normalize_doi, query_crossref, query_semantic_scholar
from .exporter_lipd import export_lipd_jsonld, export_lipd_package
from .exporter_xlsx import export_scientific_xlsx
from .llm_extractor import (
    EXTERNAL_CHAT_PROMPT,
    extract_metadata_from_chunks,
    merge_chunk_extractions,
    parse_external_llm_metadata,
)
from .pdf_parser import chunk_text_by_tokens, extract_text_from_pdf

__all__ = [
    "EXTERNAL_CHAT_PROMPT",
    "chunk_text_by_tokens",
    "export_lipd_jsonld",
    "export_lipd_package",
    "export_scientific_xlsx",
    "extract_metadata_from_chunks",
    "extract_text_from_pdf",
    "fetch_doi_metadata",
    "merge_chunk_extractions",
    "normalize_doi",
    "parse_external_llm_metadata",
    "query_crossref",
    "query_semantic_scholar",
]
