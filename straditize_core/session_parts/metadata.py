"""Metadata and ensemble tables session mixin."""

from __future__ import annotations

import os
from typing import Any

from ..metadata import (
    chunk_text_by_tokens,
    extract_metadata_from_chunks,
    extract_text_from_pdf,
    fetch_doi_metadata,
)
from ..protocol import (
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    JsonRpcError,
)


class MetadataSessionMixin:
    """Session mixin for paper metadata fetching/extraction and ensemble tables."""

    def metadata_fetch_doi(self, doi: str) -> dict[str, Any]:
        """Fetches authoritative structured metadata from Crossref and Semantic Scholar."""
        res = fetch_doi_metadata(doi)
        if res.get("success"):
            data = res.get("data", {})
            self.paper_metadata["publication"] = {
                "doi": data.get("doi", ""),
                "title": data.get("title", ""),
                "authors": data.get("authors", []),
                "journal": data.get("journal", ""),
                "year": data.get("year"),
                "source": data.get("source", "DOI"),
            }
        return res

    def metadata_extract_pdf(
        self,
        pdf_path: str,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        target_site: str | None = None,
        prompt_template: str | None = None,
    ) -> dict[str, Any]:
        """Extracts explicit non-hallucinated metadata from paper PDF text chunks via LLM."""
        if not os.path.exists(pdf_path):
            raise JsonRpcError(FILE_NOT_FOUND_ERROR, f"PDF file not found: {pdf_path}")

        from ..config import load_config

        cfg = load_config()
        eff_api_key = (
            api_key if api_key is not None else (cfg.get("llm_api_key") or None)
        )
        eff_base_url = (
            base_url if base_url is not None else (cfg.get("llm_base_url") or None)
        )
        eff_model = model if model is not None else (cfg.get("llm_model") or "gpt-4o")
        eff_prompt = (
            prompt_template
            if prompt_template is not None
            else (cfg.get("llm_prompt_template") or None)
        )

        pages = extract_text_from_pdf(pdf_path)
        chunks = chunk_text_by_tokens(pages, max_tokens=4000, overlap_tokens=200)

        extracted = extract_metadata_from_chunks(
            chunks,
            api_key=eff_api_key,
            base_url=eff_base_url,
            model=eff_model,
            target_site_name=target_site,
            prompt_template=eff_prompt,
        )

        pub_curr = self.paper_metadata.get("publication", {})
        if extracted.get("funding_agency", {}).get("value"):
            pub_curr["funding_agency"] = extracted["funding_agency"]["value"]
        if extracted.get("funding_grant", {}).get("value"):
            pub_curr["funding_grant"] = extracted["funding_grant"]["value"]
        self.paper_metadata["publication"] = pub_curr

        from ..metadata.exporter_lipd import normalize_lipd_archive_type

        def _pick(section: dict[str, Any], field: str, fallback: Any = "") -> Any:
            val = extracted.get(field, {}).get("value", "")
            if val not in (None, ""):
                return val
            existing = section.get(field, "")
            if existing not in (None, ""):
                return existing
            return fallback

        site_curr = self.paper_metadata.get("site", {})
        raw_archive = _pick(site_curr, "archive_type", "LakeSediment")
        self.paper_metadata["site"] = {
            "site_name": _pick(site_curr, "site_name"),
            "country": _pick(site_curr, "country"),
            "latitude": _pick(site_curr, "latitude"),
            "longitude": _pick(site_curr, "longitude"),
            "elevation_m": _pick(site_curr, "elevation_m"),
            "water_depth_m": _pick(site_curr, "water_depth_m"),
            "core_length_m": _pick(site_curr, "core_length_m"),
            "archive_type": normalize_lipd_archive_type(
                raw_archive, default="LakeSediment"
            ),
            "collection_date": _pick(site_curr, "collection_date"),
            "confidence": extracted.get("site_name", {}).get(
                "confidence", site_curr.get("confidence", "medium")
            ),
            "conflict": extracted.get("site_name", {}).get(
                "conflict", site_curr.get("conflict", False)
            ),
            "candidates": extracted.get("site_name", {}).get(
                "candidates", site_curr.get("candidates", [])
            ),
            "source": "LLM",
        }
        chron_curr = self.paper_metadata.get("chronology", {})
        self.paper_metadata["chronology"] = {
            "age_model": _pick(chron_curr, "age_model"),
            "age_range": _pick(chron_curr, "age_range"),
            "dating_method": _pick(chron_curr, "dating_method"),
            "cal_curve": _pick(chron_curr, "cal_curve"),
            "dating_counts": _pick(chron_curr, "dating_counts"),
            "total_dates": _pick(chron_curr, "total_dates"),
            "reservoir_correction": _pick(chron_curr, "reservoir_correction"),
            "source": "LLM",
        }
        tech_curr = self.paper_metadata.get("technical", {})
        self.paper_metadata["technical"] = {
            "pollen_extraction_method": _pick(tech_curr, "pollen_extraction_method"),
            "laboratory": _pick(tech_curr, "laboratory"),
            "investigators": _pick(tech_curr, "investigators"),
            "digitizer": tech_curr.get("digitizer", ""),
            "affiliation": tech_curr.get("affiliation", ""),
            "digitization_date": tech_curr.get("digitization_date", ""),
            "sampling_interval_cm": _pick(tech_curr, "sampling_interval_cm"),
            "source": "LLM",
        }
        qual_curr = self.paper_metadata.get("quality", {})
        self.paper_metadata["quality"] = {
            "quality_notes": _pick(qual_curr, "quality_notes"),
            "dataset_version": qual_curr.get("dataset_version", "1.0.0"),
            "original_data_url": qual_curr.get("original_data_url", ""),
            "source": "LLM",
        }

        return {
            "success": True,
            "chunks_count": len(chunks),
            "extracted": extracted,
            "current_metadata": self.paper_metadata,
        }

    def metadata_update(self, updated_metadata: dict[str, Any]) -> dict[str, Any]:
        """Allows user to review, correct, and manually fill missing metadata fields."""
        for key in ["publication", "site", "chronology", "technical", "quality"]:
            if key in updated_metadata and isinstance(updated_metadata[key], dict):
                self.paper_metadata[key].update(updated_metadata[key])
        return {"success": True, "metadata": self.paper_metadata}

    def metadata_parse_external(
        self, raw_text: str, apply_to_session: bool = True
    ) -> dict[str, Any]:
        """Parses external LLM output (fenced JSON or flat/nested schema) and optionally updates session metadata."""
        from ..metadata.llm_extractor import (
            EXTERNAL_CHAT_PROMPT,
            parse_external_llm_metadata,
        )

        try:
            parsed_meta = parse_external_llm_metadata(raw_text)
        except ValueError as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc)) from exc

        if apply_to_session:
            for section_key, section_dict in parsed_meta.items():
                if section_key in self.paper_metadata and isinstance(
                    section_dict, dict
                ):
                    for k, v in section_dict.items():
                        if v not in (None, "", []):
                            self.paper_metadata[section_key][k] = v

        return {
            "success": True,
            "parsed_metadata": parsed_meta,
            "current_metadata": self.paper_metadata,
            "default_external_prompt": EXTERNAL_CHAT_PROMPT,
        }

    def metadata_get(self) -> dict[str, Any]:
        """Returns the current reviewed metadata object."""
        return {"metadata": getattr(self, "paper_metadata", {})}

    def ensemble_add(
        self, name: str, columns: list[str], data: list[list[Any]]
    ) -> dict[str, Any]:
        """Imports an ensemble table (e.g. Bacon MCMC realizations or proxy summaries)."""
        tables = getattr(self, "ensemble_tables", [])
        self.ensemble_tables = [t for t in tables if t.get("name") != name]
        self.ensemble_tables.append(
            {
                "name": name,
                "columns": columns,
                "data": data,
            }
        )
        return {
            "success": True,
            "ensemble_count": len(self.ensemble_tables),
            "tables": [t["name"] for t in self.ensemble_tables],
        }

    def ensemble_list(self) -> dict[str, Any]:
        """Lists all available ensemble tables."""
        tables = getattr(self, "ensemble_tables", [])
        return {
            "count": len(tables),
            "tables": [
                {
                    "name": t["name"],
                    "columns": t["columns"],
                    "rows": len(t.get("data", [])),
                }
                for t in tables
            ],
        }


MetadataMixin = MetadataSessionMixin
