"""Pollen taxonomic dictionary and fuzzy string correction module.

Sources:
1. "Fluorescence Atlas of Plant Pollen (500 Species)" (140 families, 412 genera, 507 species).
2. National Science & Technology Infrastructure: Endemic Seed Plants of China Pollen DB.
3. Botanical family modern APG nomenclature alignment (e.g. Gramineae -> Poaceae, Compositae -> Asteraceae).
4. Extended European, Mediterranean, and Asian palynology types (e.g. Quercus ilex-type, Ephedra distachya-type).
5. Non-pollen palynomorphs and Quaternary micro-fossils (green algae, diatoms,
   Chironomidae, Ostracoda, coprophilous fungal spores).
6. Diatom genus coverage harvested from the Chinese diatom key maintained by the
   Yantai Institute of Coastal Zone Research, CAS (plant.yic.ac.cn):
   inland key (152 genera, Round 1990 / Kociolek et al. 2003) and marine key
   (114 genera, 金德祥 1982). See ``support/harvest_diatom_genera.py`` and
   ``data/diatom_genera.json``.
"""
from __future__ import annotations

import difflib
import json
import os
import re
from pathlib import Path
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
    "炭屑": {"latin": "Charcoal", "group": "火事件/微体指标", "family": "Proxy", "cls": "npp"},
    "微炭屑": {"latin": "Micro-charcoal", "group": "火环境指标", "family": "Proxy", "cls": "npp"},
    "花粉浓度": {"latin": "Pollen Concentration", "group": "沉积通量指标", "family": "Metric", "cls": "metric"},
    "花粉总数": {"latin": "Total Pollen Sum", "group": "统计基数", "family": "Metric", "cls": "metric"},
}


# ==============================================================================
# 3. 第四纪非花粉微体古生物 (Non-Pollen Palynomorphs, NPP) 与微体指标数据库
#    覆盖绿藻、硅藻、摇蚊、介形虫、粪生真菌孢子等常用古环境代用指标
# ==============================================================================
DEFAULT_NPP_DICT: dict[str, dict[str, str]] = {
    # --- 绿藻类 (Green algae / Chlorophyta) ---
    "盘星藻属": {"latin": "Pediastrum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "盘星藻": {"latin": "Pediastrum boryanum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    # 盘星藻种下分类单元 (Pediastrum infraspecific taxa) —— 中国与蒙古西部湖泊/水库
    # 表层沉积物常见类群，按图版 I / 图版 II 收录。
    "简单盘星藻": {"latin": "Pediastrum simplex var. simplex", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "斯图姆简单盘星藻": {"latin": "Pediastrum simplex var. sturmmi", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "格栅简单盘星藻": {"latin": "Pediastrum simplex var. clathratum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "琵琶简单盘星藻": {"latin": "Pediastrum simplex var. biwaense", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "刺简单盘星藻": {"latin": "Pediastrum simplex var. echinulatum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "二角盘星藻": {"latin": "Pediastrum duplex var. duplex", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "纤细二角盘星藻": {"latin": "Pediastrum duplex var. gracillim", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "皱褶二角盘星藻": {"latin": "Pediastrum duplex var. rugulosum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "四角盘星藻": {"latin": "Pediastrum tetras", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    # 图版 II：boryanum 复合体及其余常见盘星藻分类单元
    "博里盘星藻": {"latin": "Pediastrum boryanum var. boryanum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "长角博里盘星藻型1": {"latin": "Pediastrum boryanum var. longicorne type 1", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "长角博里盘星藻型2": {"latin": "Pediastrum boryanum var. longicorne type 2", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "阿根廷盘星藻相似种": {"latin": "Pediastrum cf. argentinense", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "交替盘星藻": {"latin": "Pediastrum alternans", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "短角博里盘星藻": {"latin": "Pediastrum boryanum var. brevicorne", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "卡氏盘星藻": {"latin": "Pediastrum kawraiskyi", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "角状盘星藻": {"latin": "Pediastrum angulosum var. angulosum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "不对称盘星藻": {"latin": "Pediastrum asymmetricum", "group": "绿藻类 (Green algae / NPP)", "family": "Hydrodictyaceae"},
    "葡萄藻属": {"latin": "Botryococcus", "group": "绿藻类 (Green algae / NPP)", "family": "Botryococcaceae"},
    "葡萄藻": {"latin": "Botryococcus braunii", "group": "绿藻类 (Green algae / NPP)", "family": "Botryococcaceae"},
    "双星藻属": {"latin": "Zygnema", "group": "绿藻类 (Green algae / NPP)", "family": "Zygnemataceae"},
    "双星藻型": {"latin": "Zygnema-type", "group": "绿藻类 (Green algae / NPP)", "family": "Zygnemataceae"},
    "水绵属": {"latin": "Spirogyra", "group": "绿藻类 (Green algae / NPP)", "family": "Zygnemataceae"},
    "转板藻属": {"latin": "Mougeotia", "group": "绿藻类 (Green algae / NPP)", "family": "Zygnemataceae"},
    "鼓藻属": {"latin": "Cosmarium", "group": "绿藻类 (Green algae / NPP)", "family": "Desmidiaceae"},
    "角星鼓藻属": {"latin": "Staurastrum", "group": "绿藻类 (Green algae / NPP)", "family": "Desmidiaceae"},
    "栅藻属": {"latin": "Scenedesmus", "group": "绿藻类 (Green algae / NPP)", "family": "Scenedesmaceae"},
    "绿藻类": {"latin": "Green algae", "group": "绿藻类 (Green algae / NPP)", "family": "Chlorophyta"},

    # --- 硅藻类 (Diatoms / Bacillariophyta) ---
    "硅藻": {"latin": "Diatom", "group": "硅藻类 (Diatom / NPP)", "family": "Bacillariophyta"},
    "硅藻类": {"latin": "Diatoms", "group": "硅藻类 (Diatom / NPP)", "family": "Bacillariophyta"},
    "硅藻壳体": {"latin": "Diatom frustule", "group": "硅藻类 (Diatom / NPP)", "family": "Bacillariophyta"},
    "直链藻属": {"latin": "Melosira", "group": "硅藻类 (Diatom / NPP)", "family": "Melosiraceae"},
    "小环藻属": {"latin": "Cyclotella", "group": "硅藻类 (Diatom / NPP)", "family": "Stephanodiscaceae"},
    "舟形藻属": {"latin": "Navicula", "group": "硅藻类 (Diatom / NPP)", "family": "Naviculaceae"},
    "羽纹藻属": {"latin": "Pinnularia", "group": "硅藻类 (Diatom / NPP)", "family": "Pinnulariaceae"},
    "桥弯藻属": {"latin": "Cymbella", "group": "硅藻类 (Diatom / NPP)", "family": "Cymbellaceae"},
    "脆杆藻属": {"latin": "Fragilaria", "group": "硅藻类 (Diatom / NPP)", "family": "Fragilariaceae"},
    "星杆藻属": {"latin": "Asterionella", "group": "硅藻类 (Diatom / NPP)", "family": "Fragilariaceae"},
    "针杆藻属": {"latin": "Synedra", "group": "硅藻类 (Diatom / NPP)", "family": "Fragilariaceae"},
    "平板藻属": {"latin": "Tabellaria", "group": "硅藻类 (Diatom / NPP)", "family": "Tabellariaceae"},
    "异极藻属": {"latin": "Gomphonema", "group": "硅藻类 (Diatom / NPP)", "family": "Gomphonemataceae"},
    "菱形藻属": {"latin": "Nitzschia", "group": "硅藻类 (Diatom / NPP)", "family": "Bacillariaceae"},
    "圆筛藻属": {"latin": "Coscinodiscus", "group": "硅藻类 (Diatom / NPP)", "family": "Coscinodiscaceae"},

    # --- 摇蚊 (Chironomidae) ---
    "摇蚊": {"latin": "Chironomidae", "group": "摇蚊 (Chironomid / NPP)", "family": "Chironomidae"},
    "摇蚊头壳": {"latin": "Chironomid head capsule", "group": "摇蚊 (Chironomid / NPP)", "family": "Chironomidae"},
    "摇蚊幼虫": {"latin": "Chironomid larva", "group": "摇蚊 (Chironomid / NPP)", "family": "Chironomidae"},
    "摇蚊属": {"latin": "Chironomus", "group": "摇蚊 (Chironomid / NPP)", "family": "Chironomidae"},
    "直突摇蚊属": {"latin": "Orthocladius", "group": "摇蚊 (Chironomid / NPP)", "family": "Chironomidae"},

    # --- 介形虫 (Ostracoda) ---
    "介形虫": {"latin": "Ostracoda", "group": "介形虫 (Ostracod / NPP)", "family": "Ostracoda"},
    "介形类": {"latin": "Ostracod", "group": "介形虫 (Ostracod / NPP)", "family": "Ostracoda"},
    "介形虫壳体": {"latin": "Ostracod valve", "group": "介形虫 (Ostracod / NPP)", "family": "Ostracoda"},
    "土星介属": {"latin": "Ilyocypris", "group": "介形虫 (Ostracod / NPP)", "family": "Ilyocyprididae"},
    "玻璃介属": {"latin": "Candona", "group": "介形虫 (Ostracod / NPP)", "family": "Candonidae"},
    "真星介属": {"latin": "Eucypris", "group": "介形虫 (Ostracod / NPP)", "family": "Cyprididae"},
    "湖花介属": {"latin": "Limnocythere", "group": "介形虫 (Ostracod / NPP)", "family": "Limnocytheridae"},
    "白花介属": {"latin": "Leucocythere", "group": "介形虫 (Ostracod / NPP)", "family": "Limnocytheridae"},
    "达尔文介属": {"latin": "Darwinula", "group": "介形虫 (Ostracod / NPP)", "family": "Darwinulidae"},
    "小玻璃介属": {"latin": "Candoniella", "group": "介形虫 (Ostracod / NPP)", "family": "Candonidae"},

    # --- 粪生真菌孢子 (Coprophilous fungal spores) ---
    "粪生菌孢": {"latin": "Coprophilous fungal spore", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Fungi"},
    "粪生真菌孢子": {"latin": "Coprophilous fungi", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Fungi"},
    "粪球壳孢": {"latin": "Sporormiella", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Sporormiaceae"},
    "粪球壳孢型": {"latin": "Sporormiella-type", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Sporormiaceae"},
    "粪壳科": {"latin": "Sordariaceae", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Sordariaceae"},
    "粪壳属": {"latin": "Sordaria", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Sordariaceae"},
    "粪盘菌属": {"latin": "Cercophora", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Lasiosphaeriaceae"},
    "三角孢属": {"latin": "Delitschia", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Delitschiaceae"},
    "黑团壳孢": {"latin": "Podospora", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Lasiosphaeriaceae"},
    "毛球壳孢": {"latin": "Chaetomium", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Chaetomiaceae"},
    "炭角菌属": {"latin": "Xylaria", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Xylariaceae"},
    "轮层炭壳属": {"latin": "Daldinia", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Hypoxylaceae"},
    "皱球壳孢": {"latin": "Coniochaeta", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Coniochaetaceae"},
    "炭质真菌孢子": {"latin": "Carbonicolous fungal spore", "group": "粪生真菌孢子 (Coprophilous fungi / NPP)", "family": "Fungi"},

    # --- 其他微体指标 (Other NPP) ---
    "苔藓孢子": {"latin": "Bryophyte spore", "group": "其他微体指标 (Other NPP)", "family": "Bryophyta"},
    "泥炭藓孢子": {"latin": "Sphagnum spore", "group": "其他微体指标 (Other NPP)", "family": "Sphagnaceae"},
    "金藻孢囊": {"latin": "Chrysophyte cyst", "group": "其他微体指标 (Other NPP)", "family": "Chrysophyceae"},
    "海绵骨针": {"latin": "Sponge spicule", "group": "其他微体指标 (Other NPP)", "family": "Porifera"},
    "枝角类": {"latin": "Cladocera", "group": "其他微体指标 (Other NPP)", "family": "Cladocera"},
    "变形虫壳": {"latin": "Testate amoeba", "group": "其他微体指标 (Other NPP)", "family": "Amoebozoa"},
    "轮虫": {"latin": "Rotifera", "group": "其他微体指标 (Other NPP)", "family": "Rotifera"},
    "昆虫残体": {"latin": "Insect remains", "group": "其他微体指标 (Other NPP)", "family": "Insecta"},
    "植物残体": {"latin": "Plant tissue", "group": "其他微体指标 (Other NPP)", "family": "Plantae"},
}


class PollenDictionary:
    """Manages bilingual pollen taxa lookup, Latin normalization, and custom user dictionaries."""

    # Diatom genus coverage harvested from the CAS coastal-zone diatom key.
    # Loaded lazily and cached at module level so the 227-entry data file is read once.
    _DIATOM_CACHE: dict[str, Any] | None = None

    DIATOM_HABITAT_LABEL = {
        "inland": "硅藻-淡水/内陆 (Diatom inland / NPP)",
        "marine": "硅藻-海相 (Diatom marine / NPP)",
        "both": "硅藻类 (Diatom / NPP)",
    }

    @staticmethod
    def _data_dir() -> Path:
        """Resolves the bundled data directory in both dev and PyInstaller builds."""
        import sys

        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            cand = Path(sys._MEIPASS) / "straditize_core" / "ocr" / "data"
            if cand.exists():
                return cand
        return Path(__file__).resolve().parent / "data"

    @classmethod
    def diatom_genera_data(cls) -> dict[str, Any]:
        """Loads (and caches) the harvested diatom genus data file."""
        if cls._DIATOM_CACHE is None:
            path = cls._data_dir() / "diatom_genera.json"
            try:
                cls._DIATOM_CACHE = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                cls._DIATOM_CACHE = {"genera": [], "aliases": {}, "source": {}}
        return cls._DIATOM_CACHE

    def __init__(self, custom_dict_path: str | None = None):
        self.entries: dict[str, dict[str, str]] = {}
        self.latin_index: dict[str, str] = {}
        self.clean_index: dict[str, str] = {}
        self.custom_entries: dict[str, dict[str, str]] = {}
        # Chinese labels claimed by more than one genus (surfaced for review)
        self.name_collisions: dict[str, list[str]] = {}

        for zh, meta in DEFAULT_POLLEN_DICT.items():
            self.add_entry(
                zh,
                meta["latin"],
                meta.get("group", "Other"),
                meta.get("family", ""),
                cls=meta.get("cls"),
            )

        for zh, meta in DEFAULT_NPP_DICT.items():
            self.add_entry(
                zh,
                meta["latin"],
                meta.get("group", "Other"),
                meta.get("family", ""),
                cls=meta.get("cls", "npp"),
            )

        self._load_diatom_genera()

        if custom_dict_path and os.path.exists(custom_dict_path):
            self.load_custom_txt(custom_dict_path)

    def _load_diatom_genera(self) -> int:
        """Adds the harvested diatom genera, applying source-spelling aliases.

        Spelling slips in the source key are normalised onto the accepted name.
        A slip whose corrected name does *not* appear in either key (e.g.
        ``Discostlla`` -> ``Discostella``) still produces a proper entry: the
        corrected name becomes canonical and the slip is kept as an alias, so the
        genus keeps its Chinese name and habitat instead of degrading to a
        metadata-less stub.
        """
        data = self.diatom_genera_data()
        aliases: dict[str, str] = data.get("aliases", {}) or {}
        alias_lower = {k.lower(): v for k, v in aliases.items()}

        # Group every spelling variant under its accepted name.
        grouped: dict[str, dict[str, Any]] = {}
        used_zh: dict[str, str] = {}
        for item in data.get("genera", []) or []:
            latin = str(item.get("latin") or "").strip()
            if not latin:
                continue
            canonical = alias_lower.get(latin.lower(), latin)
            entry = grouped.setdefault(
                canonical,
                {"zh": "", "habitat": str(item.get("habitat") or "inland"), "family": ""},
            )
            zh = str(item.get("zh") or "").strip()
            if zh and not entry["zh"]:
                entry["zh"] = zh
            hab = str(item.get("habitat") or "inland")
            if entry["habitat"] != hab:
                entry["habitat"] = "both"
            fam = str(item.get("family") or "").strip()
            if fam and not entry["family"]:
                entry["family"] = fam

        for canonical, meta in sorted(grouped.items()):
            habitat = meta["habitat"]
            group = self.DIATOM_HABITAT_LABEL.get(habitat, self.DIATOM_HABITAT_LABEL["inland"])
            # Entries are keyed by Chinese name, so two genera sharing one Chinese
            # label would silently overwrite each other (the source key uses
            # 四棘藻属 for both Acanthoceras and Attheya). Fall back to the Latin
            # name for the later one so neither genus is lost.
            zh = meta["zh"]
            if zh and zh in used_zh and used_zh[zh] != canonical:
                self.name_collisions[zh] = sorted({used_zh[zh], canonical})
                zh = ""
            if zh:
                used_zh[zh] = canonical
            self.add_entry(
                zh or canonical,
                canonical,
                group=group,
                family=meta["family"],
                cls="npp",
            )

        for alias, canonical in aliases.items():
            self.add_latin_alias(alias, canonical)
        return len(grouped)

    def add_latin_alias(self, alias: str, canonical: str) -> None:
        """Registers an alternative Latin spelling pointing at the accepted name."""
        alias_clean = alias.strip()
        canonical_clean = canonical.strip()
        if not alias_clean or not canonical_clean:
            return
        self.latin_index.setdefault(alias_clean.lower(), canonical_clean)
        simplified = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", alias_clean).lower()
        if simplified:
            self.clean_index.setdefault(simplified, canonical_clean)

    @staticmethod
    def infer_class(group: str) -> str:
        """Infers the taxon class from its group label.

        Classes: 'pollen' (pollen & spores), 'npp' (non-pollen palynomorphs
        and micro-fossils), 'metric' (derived concentration/sum proxies).
        """
        g = group or ""
        if "NPP" in g or "微体" in g or "火" in g:
            return "npp"
        if "Metric" in g or "统计" in g or "通量" in g:
            return "metric"
        return "pollen"

    def add_entry(
        self,
        zh_name: str,
        latin_name: str,
        group: str = "Other",
        family: str = "",
        cls: str | None = None,
        is_custom: bool = False,
    ) -> None:
        clean_zh = zh_name.strip()
        clean_latin = latin_name.strip()
        if not clean_zh or not clean_latin:
            return
        resolved_cls = cls or self.infer_class(group)
        self.entries[clean_zh] = {
            "latin": clean_latin,
            "group": group,
            "family": family,
            "cls": resolved_cls,
            "custom": is_custom,
        }
        self.latin_index[clean_latin.lower()] = clean_latin
        # Also store simplified non-alphanumeric token index for compound words
        # e.g. "quercusilextype" -> "Quercus ilex-type"
        simplified = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", clean_latin).lower()
        if simplified:
            self.clean_index[simplified] = clean_latin
        if is_custom:
            self.custom_entries[clean_zh] = {
                "zh": clean_zh,
                "latin": clean_latin,
                "group": group,
                "family": family,
            }

    @staticmethod
    def strip_plate_key(segment: str) -> str:
        """Strips a leading plate/panel letter key from a figure-caption segment."""
        return re.sub(r"^[a-zA-Z]\s*[)\].、]\s*(?=[A-Z\u4e00-\u9fff])", "", segment.strip())

    # Plate key: a *standalone* single letter followed by ) ] 、 or '.'.
    # The (?<![A-Za-z]) lookbehind is essential: without it the 'f.' inside
    # 'Pediastrum cf. argentinense' would be treated as a panel key, as would the
    # 'g.' in 'Fig. 2' or the 'r.' in 'var.'.
    _PLATE_KEY_RE = re.compile(r"(?<![A-Za-z])[a-zA-Z]\s*(?:[)\]\u3001]|\.(?=\s+[A-Z]))")
    _SEGMENT_SPLIT_RE = re.compile(r"[;；]+")
    # Lines that are a bare taxonomic rank qualifier, not a taxon name
    _QUALIFIER_ONLY_RE = re.compile(r"^(var|cf|aff|sp|spp|subsp|f|type)\.?[\s\d]*$", re.IGNORECASE)

    @classmethod
    def extract_caption_taxa(cls, text: str) -> list[str]:
        """Extracts taxon names from a pasted journal figure-caption block.

        Journal plate captions are hard-wrapped mid-name and pack several taxa on
        one line, e.g.::

            图版Ⅰ。a) Pediastrum
            simplex var. simplex; b) Pediastrum simplex var. sturmmi; c), d) Pediastrum
            simplex var. clathratum; ... l) Pediastrum tetras.

        Handling rules:
        * collapse all whitespace first (so a mid-name line break heals);
        * ignore any leading prose before the first panel key;
        * panel keys are *replaced by* a separator rather than split upon, so
          multi-key prefixes like ``c), d)`` — where ``c)`` is not followed by an
          uppercase letter — cannot leave a stray ``c)`` behind;
        * keep ``cf.`` / ``var.`` / ``type 1`` qualifiers inside names.
        """
        flat = re.sub(r"\s+", " ", text).strip()
        if not flat or not cls._PLATE_KEY_RE.search(flat):
            # No panel keys at all -> not a caption, let the line parser handle it
            return []

        normalised = cls._PLATE_KEY_RE.sub(";", flat)
        pieces = cls._SEGMENT_SPLIT_RE.split(normalised)
        taxa: list[str] = []
        for piece in pieces[1:]:  # pieces[0] is the prose header before the first key
            name = cls.strip_plate_key(piece).strip().strip(".;；,，、")
            if not name or cls._QUALIFIER_ONLY_RE.match(name):
                continue
            taxa.append(name)
        return taxa

    @classmethod
    def parse_taxa_text(cls, text: str) -> list[dict[str, str]]:
        """Parses user-pasted vocabulary text into structured entries.

        Handles three shapes, auto-detected:
        1. 图版说明 / figure caption  -> 'a) Genus species; b) ...'
        2. 中文名,拉丁名[,分组]        -> comma / full-width comma / tab separated
        3. 单列名称                    -> one taxon per line
        """
        out: list[dict[str, str]] = []

        caption_taxa = cls.extract_caption_taxa(text)
        if caption_taxa:
            for name in caption_taxa:
                out.append({"zh_name": name, "latin_name": name, "group": "用户自定义 (User Custom)"})
            return out

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            for segment in re.split(r"[;；]+", line):
                segment = cls.strip_plate_key(segment)
                if not segment:
                    continue
                parts = [p.strip() for p in re.split(r"[,，\t]+", segment) if p.strip()]
                if len(parts) >= 2:
                    out.append({
                        "zh_name": parts[0],
                        "latin_name": parts[1],
                        "group": parts[2] if len(parts) >= 3 else "用户自定义 (User Custom)",
                    })
                elif len(parts) == 1:
                    out.append({
                        "zh_name": parts[0],
                        "latin_name": parts[0],
                        "group": "用户自定义 (User Custom)",
                    })
        return out

    def load_custom_txt(self, path: str) -> int:
        """Loads a user-supplied vocabulary file (.txt / .csv, UTF-8).

        Accepts the same three shapes as :meth:`parse_taxa_text`, including a
        pasted journal figure caption.
        """
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        count = 0
        for item in self.parse_taxa_text(content):
            self.add_entry(
                item["zh_name"],
                item["latin_name"],
                group=item.get("group", "用户自定义 (User Custom)"),
                cls="custom",
                is_custom=True,
            )
            count += 1
        return count

    def save_custom_txt(self, path: str) -> int:
        """Persists the user custom dictionary to a UTF-8 plain text file."""
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        lines = [
            "# Straditize 用户自定义属种词汇表",
            "# 格式: 中文名,拉丁名[,分组]   (每行一条, '#' 开头为注释)",
        ]
        for item in self.custom_entries.values():
            # 分组名中的中英文逗号都会破坏 CSV 行结构（解析端需同时支持半角/全角逗号），
            # 统一替换为顿号后再写入。
            group = (item.get("group") or "").replace(",", "、").replace("，", "、").strip()
            zh = (item.get("zh") or "").replace(",", "、").replace("，", "、").strip()
            latin = (item.get("latin") or "").replace(",", " ").replace("，", " ").strip()
            if not zh or not latin:
                continue
            if group and group != "用户自定义 (User Custom)":
                lines.append(f"{zh},{latin},{group}")
            else:
                lines.append(f"{zh},{latin}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return len(self.custom_entries)

    @staticmethod
    def _common_prefix_len(a: str, b: str) -> int:
        n = 0
        for ca, cb in zip(a, b):
            if ca != cb:
                break
            n += 1
        return n

    @staticmethod
    def _levenshtein(a: str, b: str) -> int:
        """Plain Levenshtein distance (small strings, so the O(n*m) DP is fine)."""
        if a == b:
            return 0
        if not a:
            return len(b)
        if not b:
            return len(a)
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            curr = [i]
            for j, cb in enumerate(b, 1):
                curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb)))
            prev = curr
        return prev[-1]

    @classmethod
    def _latin_candidate_plausible(cls, query_low: str, candidate_low: str, ratio: float) -> bool:
        """Guards against false positives during Latin fuzzy matching.

        Two failure modes are blocked here:

        1. Cross-class hits caused by a shared suffix only. Without this guard an
           unknown NPP name such as 'Sordariaceae' was greedily 'corrected' into
           the unrelated pollen family 'Apiaceae'.
        2. Infra-generic hits caused by a shared genus only. Every unlisted
           'Pediastrum <epithet>' shares the 10-character genus prefix with every
           listed one, so 'Pediastrum tetras' was pulled to 'Pediastrum boryanum'.
           For multi-token names we therefore compare the part *after* the genus.
        """
        if ratio < 0.70:
            return False
        # 1. Length must be comparable (OCR typos do not halve a name)
        len_gap = abs(len(query_low) - len(candidate_low))
        if len_gap > max(2, int(round(0.25 * max(len(query_low), len(candidate_low))))):
            return False
        # 2. Containment is always acceptable (e.g. 'Quercus ilex' -> 'Quercus ilex-type')
        if query_low in candidate_low or candidate_low in query_low:
            return True

        q_tokens = query_low.split()
        c_tokens = candidate_low.split()

        # 3. Same genus: the specific epithet must actually agree.
        #    Sharing a genus alone is far too weak an anchor.
        if len(q_tokens) >= 2 and len(c_tokens) >= 2 and q_tokens[0] == c_tokens[0]:
            q_rest = " ".join(q_tokens[1:])
            c_rest = " ".join(c_tokens[1:])
            if q_rest in c_rest or c_rest in q_rest:
                return True
            rest_ratio = difflib.SequenceMatcher(None, q_rest, c_rest).ratio()
            return rest_ratio >= 0.80

        # 4. Otherwise require a shared leading stem.
        if cls._common_prefix_len(query_low, candidate_low) < 2:
            return False

        # 4b. Single-token names only share a stem at best, so an edit-distance
        #     bound is what actually separates a typo from a *different* genus.
        #     With ~230 diatom genera loaded, a prefix test alone conflates
        #     e.g. 'Navicula' / 'Navicymbula' or 'Gomphonema' / 'Gomphoneis'.
        lev = cls._levenshtein(query_low, candidate_low)
        if lev <= 2:
            return True
        # Long names tolerate a heavier slip, but only at high similarity.
        return len(query_low) >= 10 and lev <= 3 and ratio >= 0.88

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
                "cls": "unknown",
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
                "cls": meta.get("cls", "pollen"),
                "confidence": 1.0,
                "status": "auto",
            }

        # 2. Direct match on Latin lowercase
        query_low = cleaned_query.lower()
        if query_low in self.latin_index:
            std_latin = self.latin_index[query_low]
            meta = self._meta_of_latin(query_low)
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": meta.get("zh", cleaned_query),
                "group": meta.get("group", "Other"),
                "cls": meta.get("cls", "pollen"),
                "confidence": 1.0,
                "status": "auto",
            }

        # 3. Alphanumeric normalized match (e.g. Quercusilextype -> Quercus ilex-type)
        clean_alpha = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", cleaned_query).lower()
        if clean_alpha in self.clean_index:
            std_latin = self.clean_index[clean_alpha]
            low = std_latin.lower()
            meta = self._meta_of_latin(low)
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": meta.get("zh", cleaned_query),
                "group": meta.get("group", "Other"),
                "cls": meta.get("cls", "pollen"),
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
                "cls": "pollen",
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
                "cls": "pollen",
                "confidence": 1.0,
                "status": "auto",
            }

        # 5. Fuzzy matching on Chinese candidate names
        #    Guarded by a length constraint: Chinese taxon names are short and an
        #    OCR slip changes at most one character, never the name's length class.
        all_zh = list(self.entries.keys())
        cutoff_zh = 0.65 if len(cleaned_query) <= 3 else threshold_med
        matches_zh = difflib.get_close_matches(cleaned_query, all_zh, n=5, cutoff=cutoff_zh)
        for best_zh in matches_zh:
            if abs(len(cleaned_query) - len(best_zh)) > 1:
                continue
            ratio = difflib.SequenceMatcher(None, cleaned_query, best_zh).ratio()
            meta = self.entries[best_zh]
            status = "auto" if ratio >= threshold_high else "confirm"
            return {
                "ocr_text": query,
                "suggested_name": meta["latin"],
                "suggested_zh": best_zh,
                "group": meta["group"],
                "cls": meta.get("cls", "pollen"),
                "confidence": round(ratio, 3),
                "status": status,
            }

        # 6. Fuzzy matching on Latin candidate names (guarded against cross-class hits)
        all_latin_low = list(self.latin_index.keys())
        matches_latin = difflib.get_close_matches(query_low, all_latin_low, n=5, cutoff=threshold_med)
        for best_low in matches_latin:
            ratio = difflib.SequenceMatcher(None, query_low, best_low).ratio()
            if not self._latin_candidate_plausible(query_low, best_low, ratio):
                continue
            std_latin = self.latin_index[best_low]
            meta = self._meta_of_latin(best_low)
            # A single-character slip is a confident repair; anything further is
            # only ever a suggestion. Two edits is the range where a real but
            # unlisted neighbour lives (e.g. Cyclotellina vs Cyclotella), so such
            # hits must surface as 'confirm' and never as a silent 'auto' answer.
            lev = self._levenshtein(query_low, best_low)
            status = "auto" if (ratio >= threshold_high and lev <= 1) else "confirm"
            return {
                "ocr_text": query,
                "suggested_name": std_latin,
                "suggested_zh": meta.get("zh", cleaned_query),
                "group": meta.get("group", "Other"),
                "cls": meta.get("cls", "pollen"),
                "confidence": round(ratio, 3),
                "status": status,
            }

        # 7. Unrecognized
        return {
            "ocr_text": query,
            "suggested_name": cleaned_query,
            "suggested_zh": cleaned_query,
            "group": "未分类 (Unassigned)",
            "cls": "unknown",
            "confidence": 0.50,
            "status": "unrecognized",
        }

    def _meta_of_latin(self, latin_low: str) -> dict[str, Any]:
        """Returns the entry meta for a Latin name, resolving spelling aliases first."""
        canonical = self.latin_index.get(latin_low, latin_low)
        canonical_low = canonical.lower()
        for zh, meta in self.entries.items():
            if meta["latin"].lower() == canonical_low:
                return {**meta, "zh": zh}
        return {}
