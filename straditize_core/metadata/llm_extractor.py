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
    "country",
    "latitude",
    "longitude",
    "elevation_m",
    "water_depth_m",
    "core_length_m",
    "archive_type",
    "collection_date",
    "investigators",
    "funding_agency",
    "funding_grant",
    "age_model",
    "age_range",
    "dating_method",
    "cal_curve",
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
  "country": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "latitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "longitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "elevation_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "water_depth_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "core_length_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "archive_type": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "collection_date": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "investigators": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "funding_agency": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "funding_grant": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_model": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_range": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "dating_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "cal_curve": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "pollen_extraction_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "laboratory": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "sampling_interval_cm": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "quality_notes": {"value": string, "confidence": "high"|"medium"|"low", "quote": string}
}

Special notes:
- latitude/longitude: Return decimal degrees if written, or convert explicit degrees/minutes/seconds if unambiguously stated. Otherwise keep verbatim string.
- archive_type: e.g. "lake sediment", "peat bog", "marine sediment", "fluvial sediment".
- age_model: e.g. "Bacon", "Bchron", "CLAM", "OxCal", "linear interpolation", or "".
- investigators: Field/coring team or laboratory analysts explicitly mentioned.
- quote: Provide the short verbatim sentence proving this extraction. If value is "", quote must be "".
"""


def call_openai_compatible_api(
    prompt: str,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str = "gpt-4o",
    system_prompt: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any] | None:
    """Executes a standard OpenAI-compatible chat completions call."""
    key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or os.getenv("LLM_API_KEY")
    if not key:
        logger.info("No LLM API key provided or found in environment variables.")
        return None

    raw_base = base_url or os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1"
    endpoint = raw_base.rstrip("/") + "/chat/completions"

    sys_content = system_prompt.strip() if system_prompt and system_prompt.strip() else EXTRACTION_SYSTEM_PROMPT

    payload = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": sys_content},
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
    prompt_template: str | None = None,
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
            system_prompt=prompt_template,
        )
        if res:
            chunk_results.append(res)

    if not chunk_results:
        # Fallback empty structure
        return merge_chunk_extractions([], target_site_name=target_site_name)

    return merge_chunk_extractions(chunk_results, target_site_name=target_site_name)


EXTERNAL_CHAT_PROMPT = """你是一名第四纪古生态、孢粉学与古气候地层学数据提取专家。请阅读我上传的这篇论文 PDF，严格提取文中**明确写出**的元数据（严禁推测或编造；文中未提及的字段请填 "" 或 null），并**仅输出一个符合以下结构的 JSON 代码块**（可直接复制导入 Straditize Pro）：

```json
{
  "publication": {
    "doi": "论文 DOI（不含 https://doi.org/ 前缀，如 10.1016/j.quascirev.2024.108504）",
    "title": "论文完整英文或中文标题",
    "authors": ["作者1", "作者2", "作者3"],
    "journal": "期刊全称",
    "year": 2024,
    "funding_agency": "资助机构（如 NSFC, NSF, ERC）",
    "funding_grant": "基金项目号（如 41771212）"
  },
  "site": {
    "site_name": "钻孔或剖面站点名称（如 Lake Gahai (GHB core)）",
    "country": "国家与地理区域（如 China (Qaidam Basin, Qinghai)）",
    "latitude": "十进制度纬度（北纬为正，如 37.1333）",
    "longitude": "十进制度经度（东经为正，如 97.5167）",
    "elevation_m": "海拔米数（纯数字字符串，如 2848）",
    "water_depth_m": "采样处水深米数（如 11.4）",
    "core_length_m": "钻孔总长米数（如 14.0）",
    "archive_type": "沉积档案类型（如 lake sediment, peat, loess, marine sediment）",
    "collection_date": "野外钻取/采集时间（如 2008-05 或 2018）"
  },
  "chronology": {
    "age_model": "年代-深度模型方法（如 Bacon, Bchron, CLAM, linear interpolation）",
    "dating_method": "测年方法与材料（如 AMS 14C (plant macrofossils / bulk organic)）",
    "age_range": "年代覆盖范围（如 0-11400 cal yr BP）",
    "cal_curve": "校正曲线（如 IntCal20, Marine20）"
  },
  "technical": {
    "investigators": "野外钻取与实验分析人员名单（逗号分隔）",
    "affiliation": "第一完成单位/研究机构名称",
    "laboratory": "孢粉与测年分析实验室名称",
    "pollen_extraction_method": "孢粉提取实验方法（如 HCl-NaOH-HF treatment + Lycopodium tablets）",
    "sampling_interval_cm": "采样间隔厘米数（如 2）"
  },
  "quality": {
    "dataset_version": "1.0.0",
    "original_data_url": "原始数据或补充材料链接（如 https://doi.org/...）",
    "quality_notes": "样品总数、每样统计粒数等质量控制说明（如 660 samples analyzed, >500 terrestrial pollen grains counted per sample）"
  }
}
```"""


def _unwrap_val(v: Any) -> Any:
    """Unwraps `{"value": ...}` dicts produced by chunk-level extraction prompts."""
    if isinstance(v, dict) and "value" in v:
        return v["value"]
    return v


def parse_external_llm_metadata(raw_text: str) -> dict[str, Any]:
    """Parses user-pasted external LLM output (Markdown code blocks, conversational text,
    nested `paper_metadata` JSON, or flat chunk-extraction JSON) into standard `paper_metadata`.
    """
    import re

    if not raw_text or not str(raw_text).strip():
        raise ValueError("粘贴内容为空，请先从外部 AI 对话中复制生成的 JSON 内容。")

    text = str(raw_text).strip()

    # 1. Try extracting from ```json ... ``` or ``` ... ``` fenced code block first
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.IGNORECASE)
    candidate_str = fence_match.group(1) if fence_match else None

    # 2. If no fenced block, locate the outermost `{ ... }` JSON object in the text
    if not candidate_str:
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            candidate_str = text[first_brace : last_brace + 1]
        else:
            candidate_str = text

    try:
        parsed = json.loads(candidate_str)
    except Exception as exc:
        raise ValueError(
            f"未能从粘贴文本中解析出合法的 JSON 对象（{exc}）。请确保复制了完整的 {{ ... }} JSON 内容。"
        ) from exc

    if not isinstance(parsed, dict):
        raise ValueError("解析结果不是 JSON 对象（dict），请检查粘贴格式。")

    # Support unwrapping if top-level key is "paper_metadata" or "metadata"
    if "paper_metadata" in parsed and isinstance(parsed["paper_metadata"], dict):
        parsed = parsed["paper_metadata"]
    elif "metadata" in parsed and isinstance(parsed["metadata"], dict) and (
        "publication" in parsed["metadata"] or "site" in parsed["metadata"]
    ):
        parsed = parsed["metadata"]

    pub_in = parsed.get("publication") if isinstance(parsed.get("publication"), dict) else {}
    site_in = parsed.get("site") if isinstance(parsed.get("site"), dict) else {}
    chron_in = parsed.get("chronology") if isinstance(parsed.get("chronology"), dict) else {}
    tech_in = parsed.get("technical") if isinstance(parsed.get("technical"), dict) else {}
    qual_in = parsed.get("quality") if isinstance(parsed.get("quality"), dict) else {}

    def pick(section: dict[str, Any], key: str, default: Any = "") -> Any:
        if key in section and section[key] is not None:
            val = _unwrap_val(section[key])
            if val != "":
                return val
        if key in parsed and parsed[key] is not None:
            val = _unwrap_val(parsed[key])
            if val != "":
                return val
        return default

    raw_authors = pick(pub_in, "authors", [])
    if isinstance(raw_authors, str):
        authors = [a.strip() for a in re.split(r"[,;，；]+", raw_authors) if a.strip()]
    elif isinstance(raw_authors, list):
        authors = [str(a).strip() for a in raw_authors if str(a).strip()]
    else:
        authors = []

    raw_year = pick(pub_in, "year", None)
    year_val: int | None = None
    if raw_year not in (None, ""):
        try:
            year_val = int(str(raw_year).strip()[:4])
        except (ValueError, TypeError):
            year_val = None

    raw_doi = str(pick(pub_in, "doi", "")).strip()
    raw_doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", raw_doi, flags=re.IGNORECASE).strip()

    normalized: dict[str, Any] = {
        "publication": {
            "doi": raw_doi,
            "title": str(pick(pub_in, "title", "")).strip(),
            "authors": authors,
            "journal": str(pick(pub_in, "journal", "")).strip(),
            "year": year_val,
            "funding_agency": str(pick(pub_in, "funding_agency", "")).strip(),
            "funding_grant": str(pick(pub_in, "funding_grant", "")).strip(),
            "source": "External LLM",
        },
        "site": {
            "site_name": str(pick(site_in, "site_name", "")).strip(),
            "country": str(pick(site_in, "country", "")).strip(),
            "latitude": str(pick(site_in, "latitude", "")).strip(),
            "longitude": str(pick(site_in, "longitude", "")).strip(),
            "elevation_m": str(pick(site_in, "elevation_m", "")).strip(),
            "water_depth_m": str(pick(site_in, "water_depth_m", "")).strip(),
            "core_length_m": str(pick(site_in, "core_length_m", "")).strip(),
            "archive_type": str(pick(site_in, "archive_type", "lake sediment")).strip() or "lake sediment",
            "collection_date": str(pick(site_in, "collection_date", "")).strip(),
            "source": "External LLM",
        },
        "chronology": {
            "age_model": str(pick(chron_in, "age_model", "Bacon")).strip() or "Bacon",
            "age_range": str(pick(chron_in, "age_range", "")).strip(),
            "dating_method": str(pick(chron_in, "dating_method", "14C AMS")).strip() or "14C AMS",
            "cal_curve": str(pick(chron_in, "cal_curve", "IntCal20")).strip() or "IntCal20",
            "source": "External LLM",
        },
        "technical": {
            "pollen_extraction_method": str(pick(tech_in, "pollen_extraction_method", "")).strip(),
            "laboratory": str(pick(tech_in, "laboratory", "")).strip(),
            "investigators": str(pick(tech_in, "investigators", "")).strip(),
            "digitizer": str(pick(tech_in, "digitizer", "")).strip(),
            "affiliation": str(pick(tech_in, "affiliation", "")).strip(),
            "digitization_date": str(pick(tech_in, "digitization_date", "")).strip(),
            "sampling_interval_cm": str(pick(tech_in, "sampling_interval_cm", "")).strip(),
            "source": "External LLM",
        },
        "quality": {
            "quality_notes": str(pick(qual_in, "quality_notes", "")).strip(),
            "dataset_version": str(pick(qual_in, "dataset_version", "1.0.0")).strip() or "1.0.0",
            "original_data_url": str(pick(qual_in, "original_data_url", "")).strip(),
            "source": "External LLM",
        },
    }
    return normalized
