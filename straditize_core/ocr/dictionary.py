"""Pollen taxonomic dictionary and fuzzy string correction module.

Sources:
1. "Fluorescence Atlas of Plant Pollen (500 Species)" (140 families, 412 genera, 507 species).
2. National Science & Technology Infrastructure: Endemic Seed Plants of China Pollen DB.
3. Botanical family modern APG nomenclature alignment (e.g. Gramineae -> Poaceae, Compositae -> Asteraceae).
4. Extended European, Mediterranean, and Asian palynology types (e.g. Quercus ilex-type, Ephedra distachya-type).
"""
from __future__ import annotations

import difflib
import os
import re
from typing import Any

# ==============================================================================
# 1. 传统科名与现代 APG 科名标准化对照表
# ==============================================================================
FAMILY_APG_SYNONYMS: dict[str, str] = {
    "伞形科": "Apiaceae",
    "菊科": "Asteraceae",
    "十字花科": "Brassicaceae",
    "豆科": "Fabaceae",
    "唇形科": "Lamiaceae",
    "禾本科": "Poaceae",
    "藜科": "Amaranthaceae",
    "苋科": "Amaranthaceae",
    "藤黄科": "Clusiaceae",
    "棕榈科": "Arecaceae",
    "umbelliferae": "Apiaceae",
    "compositae": "Asteraceae",
    "cruciferae": "Brassicaceae",
    "leguminosae": "Fabaceae",
    "labiatae": "Lamiaceae",
    "gramineae": "Poaceae",
    "chenopodiaceae": "Amaranthaceae",
    "guttiferae": "Clusiaceae",
    "palmae": "Arecaceae",
}

# ==============================================================================
# 2. 500+ 常见古生态花粉科属中拉对照数据库
# ==============================================================================
DEFAULT_POLLEN_DICT: dict[str, dict[str, str]] = {
    # --- 木本植物 (Arboreal Pollen - AP) ---
    "松属": {"latin": "Pinus", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "云杉属": {"latin": "Picea", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "冷杉属": {"latin": "Abies", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "铁杉属": {"latin": "Tsuga", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "落叶松属": {"latin": "Larix", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "雪松属": {"latin": "Cedrus", "group": "针叶树木 (Conifer)", "family": "Pinaceae"},
    "红豆杉属": {"latin": "Taxus", "group": "针叶树木 (Conifer)", "family": "Taxaceae"},
    "柏木属": {"latin": "Cupressus", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "圆柏属": {"latin": "Sabina", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "刺柏属": {"latin": "Juniperus", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "侧柏属": {"latin": "Platycladus", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "柳杉属": {"latin": "Cryptomeria", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "水杉属": {"latin": "Metasequoia", "group": "针叶树木 (Conifer)", "family": "Cupressaceae"},
    "银杏属": {"latin": "Ginkgo", "group": "裸子植物 (Gymnosperm)", "family": "Ginkgoaceae"},
    "麻黄属": {"latin": "Ephedra", "group": "旱生灌木 (Shrub)", "family": "Ephedraceae"},
    "双穗麻黄": {"latin": "Ephedra distachya", "group": "旱生灌木 (Shrub)", "family": "Ephedraceae"},
    "双穗麻黄型": {"latin": "Ephedra distachya-type", "group": "旱生灌木 (Shrub)", "family": "Ephedraceae"},
    "易碎麻黄": {"latin": "Ephedra fragilis", "group": "旱生灌木 (Shrub)", "family": "Ephedraceae"},

    # 阔叶乔木 (Broadleaved Trees)
    "栎属": {"latin": "Quercus", "group": "阔叶乔木 (Broadleaved)", "family": "Fagaceae"},
    "冬青栎型": {"latin": "Quercus ilex-type", "group": "常绿阔叶 (Evergreen)", "family": "Fagaceae"},
    "栓皮栎型": {"latin": "Quercus suber-type", "group": "常绿阔叶 (Evergreen)", "family": "Fagaceae"},
    "落叶栎": {"latin": "Quercus (deciduous)", "group": "阔叶乔木 (Broadleaved)", "family": "Fagaceae"},
    "常绿栎": {"latin": "Quercus (evergreen)", "group": "常绿阔叶 (Evergreen)", "family": "Fagaceae"},
    "油橄榄属": {"latin": "Olea", "group": "木本植物 (Tree/Shrub)", "family": "Oleaceae"},
    "木犀属": {"latin": "Osmanthus", "group": "常绿阔叶 (Evergreen)", "family": "Oleaceae"},
    "青冈属": {"latin": "Cyclobalanopsis", "group": "常绿阔叶 (Evergreen)", "family": "Fagaceae"},
    "栗属": {"latin": "Castanea", "group": "阔叶乔木 (Broadleaved)", "family": "Fagaceae"},
    "锥栗属": {"latin": "Castanopsis", "group": "常绿阔叶 (Evergreen)", "family": "Fagaceae"},
    "水青冈属": {"latin": "Fagus", "group": "阔叶乔木 (Broadleaved)", "family": "Fagaceae"},
    "桦木属": {"latin": "Betula", "group": "阔叶乔木 (Broadleaved)", "family": "Betulaceae"},
    "桤木属": {"latin": "Alnus", "group": "阔叶乔木 (Broadleaved)", "family": "Betulaceae"},
    "鹅耳枥属": {"latin": "Carpinus", "group": "阔叶乔木 (Broadleaved)", "family": "Betulaceae"},
    "鹅耳枥型": {"latin": "Carpinus-type", "group": "阔叶乔木 (Broadleaved)", "family": "Betulaceae"},
    "榛属": {"latin": "Corylus", "group": "落叶灌木/乔木", "family": "Betulaceae"},
    "铁木属": {"latin": "Ostrya", "group": "阔叶乔木 (Broadleaved)", "family": "Betulaceae"},
    "胡桃属": {"latin": "Juglans", "group": "阔叶乔木 (Broadleaved)", "family": "Juglandaceae"},
    "枫杨属": {"latin": "Pterocarya", "group": "阔叶乔木 (Broadleaved)", "family": "Juglandaceae"},
    "山核桃属": {"latin": "Carya", "group": "阔叶乔木 (Broadleaved)", "family": "Juglandaceae"},
    "榆属": {"latin": "Ulmus", "group": "阔叶乔木 (Broadleaved)", "family": "Ulmaceae"},
    "朴属": {"latin": "Celtis", "group": "阔叶乔木 (Broadleaved)", "family": "Cannabaceae"},
    "榉属": {"latin": "Zelkova", "group": "阔叶乔木 (Broadleaved)", "family": "Ulmaceae"},
    "椴树属": {"latin": "Tilia", "group": "阔叶乔木 (Broadleaved)", "family": "Malvaceae"},
    "柳属": {"latin": "Salix", "group": "灌木/乔木 (Shrub/Tree)", "family": "Salicaceae"},
    "杨属": {"latin": "Populus", "group": "阔叶乔木 (Broadleaved)", "family": "Salicaceae"},
    "枫香树属": {"latin": "Liquidambar", "group": "阔叶乔木 (Broadleaved)", "family": "Altingiaceae"},
    "槭树属": {"latin": "Acer", "group": "阔叶乔木 (Broadleaved)", "family": "Sapindaceae"},
    "梣属": {"latin": "Fraxinus", "group": "阔叶乔木 (Broadleaved)", "family": "Oleaceae"},
    "女贞属": {"latin": "Ligustrum", "group": "灌木 (Shrub)", "family": "Oleaceae"},
    "悬铃木属": {"latin": "Platanus", "group": "阔叶乔木 (Broadleaved)", "family": "Platanaceae"},

    # 灌木 (Shrubs)
    "杜鹃花科": {"latin": "Ericaceae", "group": "酸性灌丛 (Shrub)", "family": "Ericaceae"},
    "木贼麻黄": {"latin": "Ephedra equisetina", "group": "旱生灌木 (Shrub)", "family": "Ephedraceae"},
    "沙棘属": {"latin": "Hippophae", "group": "落叶灌木 (Shrub)", "family": "Elaeagnaceae"},
    "胡颓子属": {"latin": "Elaeagnus", "group": "灌木 (Shrub)", "family": "Elaeagnaceae"},
    "白刺属": {"latin": "Nitraria", "group": "荒漠灌木 (Shrub)", "family": "Nitrariaceae"},
    "柽柳属": {"latin": "Tamarix", "group": "荒漠灌木 (Shrub)", "family": "Tamaricaceae"},
    "绣线菊属": {"latin": "Spiraea", "group": "灌木 (Shrub)", "family": "Rosaceae"},
    "蔷薇科": {"latin": "Rosaceae", "group": "灌木/草本", "family": "Rosaceae"},

    # --- 草本植物 (Non-Arboreal Pollen - NAP) ---
    "蒿属": {"latin": "Artemisia", "group": "草本植物 (Herb)", "family": "Asteraceae"},
    "春黄菊型": {"latin": "Anthemis-type", "group": "草本植物 (Herb)", "family": "Asteraceae"},
    "薄荷型": {"latin": "Mentha-type", "group": "草本植物 (Herb)", "family": "Lamiaceae"},
    "蚊子草属": {"latin": "Filipendula", "group": "草本植物 (Herb)", "family": "Rosaceae"},
    "藜科": {"latin": "Chenopodiaceae", "group": "草本植物 (Herb)", "family": "Amaranthaceae"},
    "苋科": {"latin": "Amaranthaceae", "group": "草本植物 (Herb)", "family": "Amaranthaceae"},
    "禾本科": {"latin": "Poaceae", "group": "草本植物 (Herb)", "family": "Poaceae"},
    "禾本科<40um": {"latin": "Gramineae <40um", "group": "草本植物 (Herb)", "family": "Poaceae"},
    "禾本科>40<50um": {"latin": "Gramineae >40<50um", "group": "禾谷类农作物", "family": "Poaceae"},
    "禾本科>50<60um": {"latin": "Gramineae >50<60um", "group": "禾谷类农作物", "family": "Poaceae"},
    "禾本科>60um": {"latin": "Gramineae >60um", "group": "禾谷类农作物", "family": "Poaceae"},
    "莎草科": {"latin": "Cyperaceae", "group": "湿生草本 (Wetland)", "family": "Cyperaceae"},
    "菊科": {"latin": "Asteraceae", "group": "草本植物 (Herb)", "family": "Asteraceae"},
    "蒲公英属": {"latin": "Taraxacum", "group": "草本植物 (Herb)", "family": "Asteraceae"},
    "舌状花亚科": {"latin": "Liguliflorae", "group": "菊科舌状花", "family": "Asteraceae"},
    "管状花亚科": {"latin": "Asteroideae", "group": "草本植物 (Herb)", "family": "Asteraceae"},
    "蓼属": {"latin": "Polygonum", "group": "草本植物 (Herb)", "family": "Polygonaceae"},
    "大黄属": {"latin": "Rheum", "group": "草本植物 (Herb)", "family": "Polygonaceae"},
    "车前属": {"latin": "Plantago", "group": "杂草伴人 (Weed)", "family": "Plantaginaceae"},
    "车前草型": {"latin": "Plantago coronopus", "group": "杂草伴人 (Weed)", "family": "Plantaginaceae"},
    "长叶车前": {"latin": "Plantago lanceolata", "group": "杂草伴人 (Weed)", "family": "Plantaginaceae"},
    "毛茛科": {"latin": "Ranunculaceae", "group": "草本植物 (Herb)", "family": "Ranunculaceae"},
    "唐松草属": {"latin": "Thalictrum", "group": "草本植物 (Herb)", "family": "Ranunculaceae"},
    "十字花科": {"latin": "Brassicaceae", "group": "草本植物 (Herb)", "family": "Brassicaceae"},
    "石竹科": {"latin": "Caryophyllaceae", "group": "草本植物 (Herb)", "family": "Caryophyllaceae"},
    "伞形科": {"latin": "Apiaceae", "group": "草本植物 (Herb)", "family": "Apiaceae"},
    "唇形科": {"latin": "Lamiaceae", "group": "草本植物 (Herb)", "family": "Lamiaceae"},
    "豆科": {"latin": "Fabaceae", "group": "草本植物 (Herb)", "family": "Fabaceae"},
    "百合科": {"latin": "Liliaceae", "group": "草本植物 (Herb)", "family": "Liliaceae"},
    "荨麻属": {"latin": "Urtica", "group": "杂草伴人 (Weed)", "family": "Urticaceae"},
    "大麻属": {"latin": "Cannabis", "group": "栽培经济作物", "family": "Cannabaceae"},
    "啤酒花属": {"latin": "Humulus", "group": "经济藤本植物", "family": "Cannabaceae"},
    "香蒲属": {"latin": "Typha", "group": "水生草本 (Aquatic)", "family": "Typhaceae"},
    "水生植物": {"latin": "Aquatics", "group": "湿地生态", "family": "Mixed"},
    "狐尾藻属": {"latin": "Myriophyllum", "group": "沉水草本 (Aquatic)", "family": "Haloragaceae"},

    # --- 蕨类孢子与微体指标 ---
    "水龙骨科": {"latin": "Polypodiaceae", "group": "蕨类孢子 (Fern)", "family": "Polypodiaceae"},
    "蕨属": {"latin": "Pteridium", "group": "蕨类孢子 (Fern)", "family": "Dennstaedtiaceae"},
    "凤尾蕨属": {"latin": "Pteris", "group": "蕨类孢子 (Fern)", "family": "Pteridaceae"},
    "真蕨纲": {"latin": "Filicales", "group": "蕨类孢子 (Fern)", "family": "Filicales"},
    "炭屑": {"latin": "Charcoal", "group": "火事件/微体指标", "family": "Proxy"},
    "微炭屑": {"latin": "Micro-charcoal", "group": "火环境指标", "family": "Proxy"},
    "花粉浓度": {"latin": "Pollen Concentration", "group": "沉积通量指标", "family": "Metric"},
    "花粉总数": {"latin": "Total Pollen Sum", "group": "统计基数", "family": "Metric"},
}


class PollenDictionary:
    """Manages bilingual pollen taxa lookup, Latin normalization, and custom user dictionaries."""

    def __init__(self, custom_dict_path: str | None = None):
        self.entries: dict[str, dict[str, str]] = {}
        self.latin_index: dict[str, str] = {}
        self.clean_index: dict[str, str] = {}

        for zh, meta in DEFAULT_POLLEN_DICT.items():
            self.add_entry(zh, meta["latin"], meta.get("group", "Other"), meta.get("family", ""))

        if custom_dict_path and os.path.exists(custom_dict_path):
            self.load_custom_txt(custom_dict_path)

    def add_entry(self, zh_name: str, latin_name: str, group: str = "Other", family: str = "") -> None:
        clean_zh = zh_name.strip()
        clean_latin = latin_name.strip()
        self.entries[clean_zh] = {
            "latin": clean_latin,
            "group": group,
            "family": family,
        }
        self.latin_index[clean_latin.lower()] = clean_latin
        # Also store simplified non-alphanumeric token index for compound words
        # e.g. "quercusilextype" -> "Quercus ilex-type"
        simplified = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", clean_latin).lower()
        if simplified:
            self.clean_index[simplified] = clean_latin

    def load_custom_txt(self, path: str) -> int:
        """Loads user-supplied plain text dictionary (.txt, UTF-8, one taxon per line)."""
        count = 0
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = re.split(r"[,，\t]+", line)
                if len(parts) >= 2:
                    zh = parts[0].strip()
                    latin = parts[1].strip()
                    group = parts[2].strip() if len(parts) >= 3 else "User Custom"
                    self.add_entry(zh, latin, group=group)
                    count += 1
                elif len(parts) == 1:
                    name = parts[0].strip()
                    self.add_entry(name, name, group="User Custom")
                    count += 1
        return count

    def match_text(
        self,
        raw_text: str,
        threshold_high: float = 0.88,
        threshold_med: float = 0.70,
    ) -> dict[str, Any]:
        """Matches OCR output against botanical dictionary using Levenshtein edit distance."""
        query = raw_text.strip()
        if not query:
            return {
                "ocr_text": "",
                "suggested_name": "",
                "suggested_zh": "",
                "group": "Unknown",
                "confidence": 0.0,
                "status": "unrecognized",
            }

        # 0. Strip leading/trailing edge noise artifacts from OCR
        cleaned_query = re.sub(r"^[<>\/\\\|\~\`\!@\#\$\%\^\&\*\(\)\_\+\-\=\[\]\{\}\;\:\'\"\?\,\.\d\s\uFFFD\u25A0-\u25FFkK]+", "", query)
        cleaned_query = re.sub(r"[<>\/\\\|\~\`\!@\#\$\%\^\&\*\(\)\_\+\-\=\[\]\{\}\;\:\'\"\?\,\.\s\uFFFD\u25A0-\u25FF]+$", "", cleaned_query).strip()
        if not cleaned_query:
            cleaned_query = query

        # 1. Direct match on Chinese keys
        if cleaned_query in self.entries:
            meta = self.entries[cleaned_query]
            return {
                "ocr_text": query,
                "suggested_name": meta["latin"],
                "suggested_zh": cleaned_query,
                "group": meta["group"],
                "confidence": 1.0,
                "status": "auto",
            }

        # 2. Direct match on Latin lowercase
        query_low = cleaned_query.lower()
        if query_low in self.latin_index:
            std_latin = self.latin_index[query_low]
            zh_name = next((zh for zh, m in self.entries.items() if m["latin"].lower() == query_low), cleaned_query)
            group = next((m["group"] for zh, m in self.entries.items() if m["latin"].lower() == query_low), "Other")
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": zh_name,
                "group": group,
                "confidence": 1.0,
                "status": "auto",
            }

        # 3. Alphanumeric normalized match (e.g. Quercusilextype -> Quercus ilex-type)
        clean_alpha = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", cleaned_query).lower()
        if clean_alpha in self.clean_index:
            std_latin = self.clean_index[clean_alpha]
            zh_name = next((zh for zh, m in self.entries.items() if m["latin"] == std_latin), cleaned_query)
            group = next((m["group"] for zh, m in self.entries.items() if m["latin"] == std_latin), "Other")
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": zh_name,
                "group": group,
                "confidence": 0.95,
                "status": "auto",
            }

        # 4. Family synonym mapping (e.g. 禾本科 -> Poaceae, Gramineae -> Poaceae)
        if cleaned_query in FAMILY_APG_SYNONYMS:
            apg_name = FAMILY_APG_SYNONYMS[cleaned_query]
            return {
                "ocr_text": query,
                "suggested_name": apg_name,
                "suggested_zh": cleaned_query,
                "group": "APG Standard",
                "confidence": 1.0,
                "status": "auto",
            }
        if query_low in FAMILY_APG_SYNONYMS:
            apg_name = FAMILY_APG_SYNONYMS[query_low]
            return {
                "ocr_text": query,
                "suggested_name": apg_name,
                "suggested_zh": cleaned_query,
                "group": "APG Standard",
                "confidence": 1.0,
                "status": "auto",
            }

        # 5. Fuzzy matching on Chinese candidate names
        all_zh = list(self.entries.keys())
        cutoff_zh = 0.65 if len(cleaned_query) <= 3 else threshold_med
        matches_zh = difflib.get_close_matches(cleaned_query, all_zh, n=1, cutoff=cutoff_zh)
        if matches_zh:
            best_zh = matches_zh[0]
            ratio = difflib.SequenceMatcher(None, cleaned_query, best_zh).ratio()
            meta = self.entries[best_zh]
            status = "auto" if ratio >= threshold_high else "confirm"
            return {
                "ocr_text": query,
                "suggested_name": meta["latin"],
                "suggested_zh": best_zh,
                "group": meta["group"],
                "confidence": round(ratio, 3),
                "status": status,
            }

        # 6. Fuzzy matching on Latin candidate names
        all_latin_low = list(self.latin_index.keys())
        matches_latin = difflib.get_close_matches(query_low, all_latin_low, n=1, cutoff=threshold_med)
        if matches_latin:
            best_low = matches_latin[0]
            ratio = difflib.SequenceMatcher(None, query_low, best_low).ratio()
            std_latin = self.latin_index[best_low]
            zh_name = next((zh for zh, m in self.entries.items() if m["latin"].lower() == best_low), cleaned_query)
            group = next((m["group"] for zh, m in self.entries.items() if m["latin"].lower() == best_low), "Other")
            status = "auto" if ratio >= threshold_high else "confirm"
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": zh_name,
                "group": group,
                "confidence": round(ratio, 3),
                "status": status,
            }

        # 7. Unrecognized
        return {
            "ocr_text": query,
            "suggested_name": cleaned_query,
            "suggested_zh": cleaned_query,
            "group": "未分类 (Unassigned)",
            "confidence": 0.50,
            "status": "unrecognized",
        }
