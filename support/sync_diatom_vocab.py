"""Regenerate the frontend diatom vocabulary module from the harvested backend data.

The OCR matcher lives in the backend, but the sidebar's "批量导入名单" cleanup uses
the frontend ``PollenGlossary``. Both must recognise the same genera, otherwise a
pasted diatom name list behaves differently depending on which entry point the user
picks. This keeps the two in sync from a single source of truth.

Reads  : straditize_core/ocr/data/diatom_genera.json
Writes : frontend/src/core/diatomGenera.ts

Offline and idempotent. Run with::

    pixi run python support/sync_diatom_vocab.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "straditize_core" / "ocr" / "data" / "diatom_genera.json"
DST = ROOT / "frontend" / "src" / "core" / "diatomGenera.ts"

HEADER = """/**
 * 硅藻属名表 (diatom genera) —— 自动生成，请勿手工编辑。
 *
 * 由 `support/sync_diatom_vocab.py` 从 `straditize_core/ocr/data/diatom_genera.json`
 * 生成；后者由 `support/harvest_diatom_genera.py` 采集自中国科学院烟台海岸带研究所
 * 硅藻检索表 (plant.yic.ac.cn)：
 *   - 内陆/淡水检索表 {inland_count} 属（Round 1990，译自 Kociolek et al. 2003）
 *   - 海洋检索表 {marine_count} 属（金德祥 1982）
 *
 * 与后端 `PollenDictionary` 使用同一份词表，避免两侧纠正结果不一致。
 */
"""


def ts_string_list(name: str, values: list[str]) -> str:
    body = ",\n".join(f"  {json.dumps(v, ensure_ascii=False)}" for v in values)
    return f"export const {name}: string[] = [\n{body},\n];\n"


def ts_string_map(name: str, mapping: dict[str, str]) -> str:
    body = ",\n".join(
        f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}"
        for k, v in sorted(mapping.items())
    )
    return f"export const {name}: Record<string, string> = {{\n{body},\n}};\n"


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}; run support/harvest_diatom_genera.py first", file=sys.stderr)
        return 1

    data = json.loads(SRC.read_text(encoding="utf-8"))
    aliases: dict[str, str] = data.get("aliases", {}) or {}
    alias_lower = {k.lower() for k in aliases}

    # Canonical names: skip source slips (they are emitted as aliases) but keep the
    # corrected name they point at, which may not appear in the key itself.
    canonical: list[str] = []
    seen: set[str] = set()
    for item in data.get("genera", []):
        latin = str(item.get("latin") or "").strip()
        if not latin or latin.lower() in alias_lower:
            continue
        if latin not in seen:
            seen.add(latin)
            canonical.append(latin)
    for accepted in aliases.values():
        if accepted not in seen:
            seen.add(accepted)
            canonical.append(accepted)
    canonical.sort()

    source = data.get("source", {})
    habitats = [str(g.get("habitat") or "") for g in data.get("genera", [])]
    header = HEADER.format(
        inland_count=habitats.count("inland") + habitats.count("both"),
        marine_count=habitats.count("marine") + habitats.count("both"),
    )

    out = (
        header
        + "\n"
        + ts_string_list("DIATOM_GENERA", canonical)
        + "\n"
        + ts_string_map("DIATOM_SOURCE_ALIASES", aliases)
        + "\n"
        + f"export const DIATOM_GENERA_SOURCE = {json.dumps(source, ensure_ascii=False, indent=2)} as const;\n"
    )
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(out, encoding="utf-8")
    print(f"wrote {DST}: {len(canonical)} genera, {len(aliases)} source aliases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
