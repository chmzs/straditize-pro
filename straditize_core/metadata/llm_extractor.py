"""LLM-based structured extraction of explicit paleoenvironmental metadata from paper chunks.

Strict constraints:
1. Zero Hallucination: Extract ONLY explicitly stated facts. Return empty string "" if not found.
2. Temperature = 0.1, strict JSON schema output.
3. Multi-chunk merging with conflict detection (candidates list).
4. Graceful fallback if no LLM API key configured (DOI indexing remains functional).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any
import urllib.error
import urllib.request

logger = logging.getLogger("straditize_metadata")

TARGET_FIELDS = [
    "site_name",
    "latitude",
    "longitude",
    "elevation_m",
    "archive_type",
    "age_model",
    "age_range",
    "dating_method",
    "pollen_extraction_method",
    "laboratory",
    "sampling_interval_cm",
    "quality_notes",
]

EXTRACTION_SYSTEM_PROMPT = """You are an expert scientific data extractor specializing in quaternary paleoecology, palynology, and paleoclimate stratigraphy.

YOUR ABSOLUTE MANDATE:
- Extract ONLY facts that are EXPLICITLY and UNAMBIGUOUSLY written in the provided text snippet.
- DO NOT extrapolate, DO NOT infer, DO NOT hallucinate, and DO NOT look up external data (e.g. do not guess elevation from coordinates, do not guess country or age model).
- If an item is NOT mentioned explicitly in the text, you MUST return an empty string "" for that field.

Return a valid JSON object matching this schema:
{
  "site_name": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "latitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "longitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "elevation_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "archive_type": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_model": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_range": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "dating_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "pollen_extraction_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "laboratory": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "sampling_interval_cm": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "quality_notes": {"value": string, "confidence": "high"|"medium"|"low", "quote": string}
}

Special notes:
- latitude/longitude: Return decimal degrees if written, or convert explicit degrees/minutes/seconds if unambiguously stated. Otherwise keep verbatim string.
- archive_type: e.g. "lake sediment", "peat bog", "marine sediment", "fluvial sediment".
- age_model: e.g. "Bacon", "Bchron", "CLAM", "OxCal", "linear interpolation", or "".
- quote: Provide the short verbatim sentence proving this extraction. If value is "", quote must be "".
"""


def call_openai_compatible_api(
    prompt: str,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str = "gpt-4o",
    timeout: float = 30.0,
) -> dict[str, Any] | None:
    """Executes a standard OpenAI-compatible chat completions call."""
    key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or os.getenv("LLM_API_KEY")
    if not key:
        logger.info("No LLM API key provided or found in environment variables.")
        return None

    raw_base = base_url or os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1"
    endpoint = raw_base.rstrip("/") + "/chat/completions"

    payload = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Extract explicit metadata from this scientific paper text snippet:\n\n{prompt}"},
        ],
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=req_data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "StraditizePro/2.0 Metadata Extractor",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                res_json = json.loads(resp.read().decode("utf-8"))
                choice = res_json.get("choices", [])[0]
                content = choice.get("message", {}).get("content", "{}")
                return json.loads(content)
    except Exception as e:
        logger.warning("LLM API call failed: %s", e)
        return None

    return None


def merge_chunk_extractions(
    chunk_results: list[dict[str, Any]],
    target_site_name: str | None = None,
) -> dict[str, Any]:
    """Merges extractions across multiple chunks, detecting conflicts and synthesizing confidences."""
    merged: dict[str, Any] = {}

    for field in TARGET_FIELDS:
        all_values = []
        best_entry = None

        for cr in chunk_results:
            if not isinstance(cr, dict):
                continue
            entry = cr.get(field)
            if isinstance(entry, dict):
                val = str(entry.get("value", "")).strip()
                if val:
                    conf = entry.get("confidence", "medium")
                    quote = entry.get("quote", "")
                    all_values.append({"value": val, "confidence": conf, "quote": quote})

        if not all_values:
            merged[field] = {
                "value": "",
                "confidence": "none",
                "source": "LLM",
                "conflict": False,
                "candidates": [],
                "quote": "",
            }
            continue

        # Check unique distinct values (case-insensitive)
        unique_vals_map: dict[str, dict[str, Any]] = {}
        for item in all_values:
            norm = item["value"].lower()
            if norm not in unique_vals_map:
                unique_vals_map[norm] = item

        unique_list = list(unique_vals_map.values())

        if len(unique_list) == 1:
            # Consistent across chunks
            selected = unique_list[0]
            merged[field] = {
                "value": selected["value"],
                "confidence": selected["confidence"],
                "source": "LLM",
                "conflict": False,
                "candidates": [selected["value"]],
                "quote": selected["quote"],
            }
        else:
            # Conflicting values across chunks!
            candidates = [it["value"] for it in unique_list]

            # If user specified a preferred target site name and this is site_name field
            chosen_val = candidates[0]
            if field == "site_name" and target_site_name:
                for c in candidates:
                    if target_site_name.lower() in c.lower():
                        chosen_val = c
                        break

            merged[field] = {
                "value": chosen_val,
                "confidence": "medium",
                "source": "LLM",
                "conflict": True,
                "candidates": candidates,
                "quote": unique_list[0]["quote"],
            }

    return merged


def extract_metadata_from_chunks(
    chunks: list[dict[str, Any]],
    api_key: str | None = None,
    base_url: str | None = None,
    model: str = "gpt-4o",
    target_site_name: str | None = None,
) -> dict[str, Any]:
    """Runs LLM extraction over each text chunk and merges results with conflict detection."""
    chunk_results = []

    for chunk in chunks:
        txt = chunk["text"].strip()
        # Heuristic speedup: skip chunks that contain only References/Bibliography
        if txt.lower().startswith("[page") and ("references\n" in txt.lower() or "bibliography\n" in txt.lower()):
            if len(txt) < 3000:
                continue

        res = call_openai_compatible_api(
            prompt=txt,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        if res:
            chunk_results.append(res)

    if not chunk_results:
        # Fallback empty structure
        return merge_chunk_extractions([], target_site_name=target_site_name)

    return merge_chunk_extractions(chunk_results, target_site_name=target_site_name)
