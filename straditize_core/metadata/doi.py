"""DOI Indexing module fetching structured publication metadata.

Sources:
1. Crossref API (Primary source of truth for Title, Authors, Journal, Year, DOI)
2. Semantic Scholar API (Secondary source; extracts open-access PDF URL)

Zero LLM hallucination - purely authoritative structured API retrieval.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger("straditize_metadata")


def normalize_doi(raw_doi: str) -> str:
    """Cleans up raw user input into standard bare DOI string (e.g. 10.1016/j.quascirev.2020.106500)."""
    s = raw_doi.strip()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^doi:\s*", "", s, flags=re.IGNORECASE)
    return s.strip()


def query_crossref(doi: str, timeout: float = 8.0) -> dict[str, Any] | None:
    """Queries Crossref REST API for authoritative publication metadata."""
    clean_doi = normalize_doi(doi)
    if not clean_doi:
        return None

    encoded_doi = urllib.parse.quote(clean_doi)
    url = f"https://api.crossref.org/works/{encoded_doi}"
    headers = {
        "User-Agent": "StraditizePro/2.0 (mailto:scientific_support@straditize.org; paleoecology research)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                message = data.get("message", {})

                # Title
                titles = message.get("title", [])
                title = titles[0] if titles else ""

                # Authors
                authors = []
                for a in message.get("author", []):
                    given = a.get("given", "").strip()
                    family = a.get("family", "").strip()
                    name = f"{given} {family}".strip() if given or family else a.get("name", "").strip()
                    if name:
                        authors.append(name)

                # Journal / Container
                container = message.get("container-title", [])
                journal = container[0] if container else ""

                # Year
                year = None
                date_parts = (
                    message.get("published-print", {}).get("date-parts")
                    or message.get("published-online", {}).get("date-parts")
                    or message.get("issued", {}).get("date-parts")
                )
                if date_parts and date_parts[0]:
                    year = int(date_parts[0][0])

                return {
                    "doi": message.get("DOI", clean_doi),
                    "title": title,
                    "authors": authors,
                    "journal": journal,
                    "year": year,
                    "source": "Crossref",
                }
    except Exception as e:
        logger.warning("Crossref lookup failed for DOI %s: %s", clean_doi, e)
        return None

    return None


def query_semantic_scholar(doi: str, timeout: float = 8.0) -> dict[str, Any] | None:
    """Queries Semantic Scholar Graph API for metadata and Open Access PDF download link."""
    clean_doi = normalize_doi(doi)
    if not clean_doi:
        return None

    fields = "title,authors,year,venue,openAccessPdf"
    url = f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(clean_doi)}?fields={fields}"
    headers = {
        "User-Agent": "StraditizePro/2.0 (paleoecology research)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))

                title = data.get("title", "")
                authors = [a.get("name", "").strip() for a in data.get("authors", []) if a.get("name")]
                journal = data.get("venue", "")
                year = data.get("year")

                oa_pdf = data.get("openAccessPdf") or {}
                oa_url = oa_pdf.get("url", "")

                return {
                    "doi": clean_doi,
                    "title": title,
                    "authors": authors,
                    "journal": journal,
                    "year": year,
                    "open_access_pdf_url": oa_url,
                    "source": "SemanticScholar",
                }
    except Exception as e:
        logger.warning("Semantic Scholar lookup failed for DOI %s: %s", clean_doi, e)
        return None

    return None


def fetch_doi_metadata(doi: str) -> dict[str, Any]:
    """Fetches and synthesizes publication metadata from Crossref and Semantic Scholar.

    Rule: If Crossref and Semantic Scholar conflict, Crossref takes absolute precedence.
    The open_access_pdf_url is preserved only for PDF downloading, not stored into final citation text.
    """
    clean_doi = normalize_doi(doi)
    if not clean_doi:
        return {
            "success": False,
            "error": "Empty or invalid DOI string provided.",
            "data": {},
        }

    # Parallel or sequential lookup
    cr_data = query_crossref(clean_doi)
    s2_data = query_semantic_scholar(clean_doi)

    if not cr_data and not s2_data:
        return {
            "success": False,
            "error": f"DOI '{clean_doi}' was not found in Crossref or Semantic Scholar.",
            "data": {
                "doi": clean_doi,
                "title": "",
                "authors": [],
                "journal": "",
                "year": None,
                "open_access_pdf_url": "",
            },
        }

    # Crossref takes absolute precedence
    primary = cr_data or {}
    secondary = s2_data or {}

    title = primary.get("title") or secondary.get("title") or ""
    authors = primary.get("authors") or secondary.get("authors") or []
    journal = primary.get("journal") or secondary.get("journal") or ""
    year = primary.get("year") or secondary.get("year")
    oa_pdf = secondary.get("open_access_pdf_url") or ""

    return {
        "success": True,
        "data": {
            "doi": clean_doi,
            "title": title,
            "authors": authors,
            "journal": journal,
            "year": year,
            "open_access_pdf_url": oa_pdf,
            "source": "Crossref" if cr_data else "SemanticScholar",
        },
    }
