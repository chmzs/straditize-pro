"""Harvest the Chinese diatom genus key maintained by Yantai Institute of Coastal
Zone Research, CAS (plant.yic.ac.cn) into a structured data file used by
``straditize_core.ocr.dictionary``.

Source pages
------------
* ``.../diatom/key/inland.php`` -- 152 inland (freshwater / inland brackish) genera,
  classification after Round (1990), translated from Kociolek et al. (2003).
* ``.../diatom/key/marine.php`` -- 114 marine genera, classification after
  金德祥 (1982), amended from 金德祥 (1965) and 杨树民/董树刚 (2006).
* ``.../diatom/io/genus.php?<Genus>`` -- per-genus detail page, which carries the
  Chinese genus name and the full taxonomic chain (phylum; class; ...; family).

Output
------
``straditize_core/ocr/data/diatom_genera.json``::

    {
      "source": {...},
      "genera": [
        {"latin": "Cyclotella", "zh": "小环藻属", "habitat": "inland",
         "rank": ["Bacillariophyta", "Coscinodiscophyceae", ...], "family": "..."},
        ...
      ],
      "aliases": {"Thalasiosira": "Thalassiosira", ...}   # source-key typos
    }

The script is idempotent and network-only; it is never imported at runtime.
Run with::

    pixi run python support/harvest_diatom_genera.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://plant.yic.ac.cn/microalgae/diatom"
KEYS = {
    "inland": f"{BASE}/key/inland.php",
    "marine": f"{BASE}/key/marine.php",
}
OUT_PATH = Path(__file__).resolve().parent.parent / "straditize_core" / "ocr" / "data" / "diatom_genera.json"

ZH_TOKEN = r"[\u4e00-\u9fff]{2,14}"
GENUS_LINK = re.compile(r"<a[^>]*genus\.php\?([^\"'<>]+)")
ZH_BEFORE_LINK = re.compile(r"(" + ZH_TOKEN + r"(?:属|科|亚科))\s*<a[^>]*genus\.php\?([^\"'<>]+)")
RANK_CHAIN = re.compile(
    r"Bacillariophyta\s*;([^<]{5,220}?)(?:分类|分布|生境|\s*</)",
    re.S,
)

# Spelling variants present in the source key text (mostly OCR/typing slips in the
# marine key). Mapped to the accepted name so a diagram printing either spelling
# still resolves. The Chinese name was used as the cross-check.
SOURCE_ALIASES = {
    "Thalasiosira": "Thalassiosira",
    "Bacteriastru": "Bacteriastrum",
    "Eunoita": "Eunotia",
    "Meridiom": "Meridion",
    "Neidiun": "Neidium",
    "Soliopleura": "Scoliopleura",
    "Discostlla": "Discostella",
    "Endictyca": "Endictya",
    "Gomphoeymbella": "Gomphocymbella",
    "Rhabdomema": "Rhabdonema",
    "Leudugera": "Leudugeria",
    "Tetratella": "Tetracyclus",
    "Rhoiconeis": "Rhoicosphenia",
}


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "straditize-vocab-harvest/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", "ignore")
        except Exception as exc:  # noqa: BLE001 - network flake, retried below
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def clean_latin(raw: str) -> str:
    return re.sub(r"\.html$", "", raw.strip())


def harvest_key(url: str) -> tuple[list[str], dict[str, str]]:
    """Returns (ordered genus names, {genus: chinese name}) for one key page."""
    html = fetch(url)
    order: list[str] = []
    seen: set[str] = set()
    for raw in GENUS_LINK.findall(html):
        name = clean_latin(raw)
        if name and name not in seen:
            seen.add(name)
            order.append(name)
    zh_by_genus = {clean_latin(la): zh for zh, la in ZH_BEFORE_LINK.findall(html)}
    return order, zh_by_genus


def harvest_genus_detail(genus: str) -> dict[str, object]:
    """Scrapes Chinese name and taxonomic chain from a genus detail page."""
    html = fetch(f"{BASE}/io/genus.php?{genus}")
    body = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"\s+", " ", body).strip()

    zh = ""
    m = re.search(r"(" + ZH_TOKEN + r"(?:属|科|亚科))\s*" + re.escape(genus), body)
    if m:
        zh = m.group(1)
    else:
        # fall back: the Chinese token immediately preceding the genus name
        m = re.search(r"(" + ZH_TOKEN + r"属)\s+" + re.escape(genus), body)
        if m:
            zh = m.group(1)

    chain: list[str] = []
    m = re.search(
        r"Bacillariophyta\s*;\s*([A-Za-z][A-Za-z\-]*(?:\s*;\s*[A-Za-z][A-Za-z\-]*){1,6})",
        body,
    )
    if m:
        chain = [p.strip() for p in m.group(1).split(";") if p.strip()]
    family = chain[-1] if chain else ""
    return {"zh": zh, "rank": chain, "family": family}


def main() -> int:
    inland, inland_zh = harvest_key(KEYS["inland"])
    marine, marine_zh = harvest_key(KEYS["marine"])
    print(f"key pages: inland={len(inland)} genera, marine={len(marine)} genera")

    habitat: dict[str, str] = {}
    for g in inland:
        habitat[g] = "inland"
    for g in marine:
        habitat[g] = "both" if g in habitat else "marine"

    all_genera = sorted(habitat)
    print(f"union={len(all_genera)} genera; fetching detail pages ...")

    genera: list[dict[str, object]] = []
    for i, genus in enumerate(all_genera, 1):
        try:
            detail = harvest_genus_detail(genus)
        except Exception as exc:  # noqa: BLE001 - keep going, record the gap
            print(f"  [{i}/{len(all_genera)}] {genus}: FETCH FAILED ({exc})")
            detail = {"zh": "", "rank": [], "family": ""}
        zh = detail["zh"] or inland_zh.get(genus) or marine_zh.get(genus) or ""
        genera.append(
            {
                "latin": genus,
                "zh": zh,
                "habitat": habitat[genus],
                "rank": detail["rank"],
                "family": detail["family"],
            }
        )
        if i % 25 == 0:
            print(f"  [{i}/{len(all_genera)}] ...")
        time.sleep(0.15)

    missing_zh = [g["latin"] for g in genera if not g["zh"]]
    payload = {
        "source": {
            "inland": KEYS["inland"],
            "marine": KEYS["marine"],
            "inland_classification": "Round (1990), translated from Kociolek et al. (2003); 152 genera",
            "marine_classification": "金德祥 (1982), amended from 金德祥 (1965) and 杨树民/董树刚 (2006); 114 genera",
            "harvested_by": "support/harvest_diatom_genera.py",
        },
        "genera": genera,
        "aliases": SOURCE_ALIASES,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"\nwrote {OUT_PATH} ({len(genera)} genera)")
    print(f"chinese names resolved: {len(genera) - len(missing_zh)}/{len(genera)}")
    if missing_zh:
        print(f"missing chinese name ({len(missing_zh)}): {', '.join(missing_zh)}")
    with_rank = sum(1 for g in genera if g["rank"])
    print(f"taxonomic chain resolved: {with_rank}/{len(genera)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
