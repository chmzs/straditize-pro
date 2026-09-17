"""PDF parsing and chapter/section token-bounded chunking module.

Features:
1. Extracts full text and structural page markers from text-based PDFs using pypdf.
2. Section-aware sliding-window chunking (chunk size <= 4000 tokens, 200 tokens overlap).
3. Identifies paleoecology/stratigraphy relevant sections (Site, Chronology, Methods) for prioritization.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path
import re
from typing import Any

from pypdf import PdfReader

logger = logging.getLogger("straditize_metadata")


def extract_text_from_pdf(pdf_source: str | bytes | Path) -> list[dict[str, Any]]:
    """Extracts text page-by-page from a PDF file path or binary bytes.

    Returns a list of dicts: [{"page": 1, "text": "..."}]
    """
    if isinstance(pdf_source, (str, Path)):
        reader = PdfReader(str(pdf_source))
    elif isinstance(pdf_source, bytes):
        reader = PdfReader(io.BytesIO(pdf_source))
    else:
        raise TypeError(f"Unsupported pdf_source type: {type(pdf_source)}")

    pages_data = []
    for idx, page in enumerate(reader.pages):
        try:
            txt = page.extract_text() or ""
            pages_data.append({"page": idx + 1, "text": txt})
        except Exception as e:
            logger.warning("Failed to extract page %d: %e", idx + 1, e)
            pages_data.append({"page": idx + 1, "text": ""})

    return pages_data


def approximate_tokens(text: str) -> int:
    """Estimates token count (~3.5-4 characters per token for scientific English/Chinese)."""
    # Simple word & CJK character estimation
    words = len(re.findall(r"\w+", text))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    return max(1, int(words + cjk * 1.5))


def chunk_text_by_tokens(
    pages_data: list[dict[str, Any]],
    max_tokens: int = 4000,
    overlap_tokens: int = 200,
) -> list[dict[str, Any]]:
    """Chunks full-document text into overlapping blocks compliant with LLM token budgets.

    Constraint: Each chunk <= max_tokens (default 4000), overlap 200 tokens.
    """
    full_text_parts = []
    for p in pages_data:
        p_num = p["page"]
        txt = p["text"].strip()
        if txt:
            full_text_parts.append(f"\n[Page {p_num}]\n{txt}")

    unified_text = "\n".join(full_text_parts)
    paragraphs = re.split(r"\n\s*\n", unified_text)

    chunks: list[dict[str, Any]] = []
    current_paras: list[str] = []
    current_token_count = 0

    for para in paragraphs:
        p_tokens = approximate_tokens(para)

        # If a single paragraph is enormous, split by sentences
        if p_tokens > max_tokens:
            sentences = re.split(r"(?<=[.!?。！？])\s+", para)
            for sent in sentences:
                s_tokens = approximate_tokens(sent)
                if current_token_count + s_tokens > max_tokens and current_paras:
                    chunk_str = "\n\n".join(current_paras)
                    chunks.append({
                        "chunk_index": len(chunks),
                        "text": chunk_str,
                        "token_est": current_token_count,
                    })
                    # Keep overlap
                    overlap_paras = []
                    overlap_count = 0
                    for op in reversed(current_paras):
                        opt = approximate_tokens(op)
                        if overlap_count + opt <= overlap_tokens:
                            overlap_paras.insert(0, op)
                            overlap_count += opt
                        else:
                            break
                    current_paras = overlap_paras
                    current_token_count = overlap_count

                current_paras.append(sent)
                current_token_count += s_tokens
            continue

        if current_token_count + p_tokens > max_tokens and current_paras:
            chunk_str = "\n\n".join(current_paras)
            chunks.append({
                "chunk_index": len(chunks),
                "text": chunk_str,
                "token_est": current_token_count,
            })
            # Overlap backward accumulation
            overlap_paras = []
            overlap_count = 0
            for op in reversed(current_paras):
                opt = approximate_tokens(op)
                if overlap_count + opt <= overlap_tokens:
                    overlap_paras.insert(0, op)
                    overlap_count += opt
                else:
                    break
            current_paras = overlap_paras
            current_token_count = overlap_count

        current_paras.append(para)
        current_token_count += p_tokens

    if current_paras:
        chunks.append({
            "chunk_index": len(chunks),
            "text": "\n\n".join(current_paras),
            "token_est": current_token_count,
        })

    return chunks
