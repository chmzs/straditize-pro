# -*- coding: utf-8 -*-
"""`export_lipd_jsonld` 的完整输出基线（重构前）。

## 为什么需要它

这是**对外数据标准的出口**：LiPD / LinkedEarth v1.3。结构一旦错位（`paleoMeasurementTable` 的
分层、`variableType` 取值、索引单位、`timestamp` 该不该出现），下游 LiPDverse 直接拒收或静默
读成另一套字段——而本地界面一切正常。现有 `test_metadata_and_lipd` 只抽查几个键存在，
e2e 的 T1 也只核对"结构里有这张表"。

## 钉的是什么

五种输入形状，整份 JSON-LD 逐字段比对：

1. `full_roi`：全量元数据 + 两个 ROI 表 + 年代-深度 + 集合表 + 逐列单位；
2. `minimal_pollen`：空元数据 + 单张 `pollen_df`（走兼容分支）；
3. `bad_geo_values`：经纬度/海拔是字符串垃圾 → 必须降级成 null，而水深/岩芯长度
   降级成字符串（同一字段两种降级策略，容易改错一个）；
4. `investigator_string`：`technical.investigators` 是逗号串 → 必须切成列表；
5. `no_optional`：可选字段全空 → 根对象里**不该出现** funding/createdBy/notes 这些键。

## 重新生成

    UPDATE_LIPD_GOLDEN=1 pixi run python -m pytest tests/unit/test_lipd_export_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

from straditize_core.metadata.exporter_lipd import export_lipd_jsonld

GOLDEN = Path(__file__).parent / "fixtures" / "lipd_export_golden.json"


def _roi_dfs() -> dict[str, pd.DataFrame]:
    return {
        "pollen_a": pd.DataFrame(
            {"Depth (cm)": [0.0, 10.0], "Pinus": [12.5, None], "Betula": [None, 3.25]}
        ),
        "pollen_b": pd.DataFrame({"Depth (cm)": [0.0, 5.0], "Quercus": [7.0, 8.5]}),
    }


def _meta(full: bool = True) -> dict:
    if not full:
        return {}
    return {
        "publication": {
            "doi": "10.1000/xyz",
            "title": "Test core",
            "authors": ["Alice Smith", "Bob Jones"],
            "journal": "Test Journal",
            "year": 2024,
            "funding_agency": "NSFC",
            "funding_grant": "42000000",
        },
        "site": {
            "site_name": "Ngamring",
            "latitude": "29.5",
            "longitude": "85.25",
            "elevation_m": "4720",
            "country": "China",
            "water_depth_m": "12.5",
            "core_length_m": "320",
            "collection_date": "2023-08",
            "archive_type": "LakeSediment",
        },
        "chronology": {"dating_method": "14C", "cal_curve": "IntCal20"},
        "technical": {
            "investigators": ["Carol Lin"],
            "digitizer": "DSH",
            "affiliation": "Some Lab",
            "laboratory": "Palaeo Lab",
            "digitization_date": "2026-01-02",
        },
        "quality": {
            "dataset_version": "1.0.0",
            "original_data_url": "https://example.org/data",
            "quality_notes": "reviewed",
        },
    }


def _age_depth_df() -> pd.DataFrame:
    return pd.DataFrame({"Depth (cm)": [0.0, 10.0, 20.0], "Age (yr BP)": [0.0, 500.0, 1000.0]})


def _ensemble_tables() -> list[dict]:
    return [
        {
            "name": "bacon",
            "columns": ["depth", "age_iter1", "age_iter2"],
            "data": [[0.0, 0.0, 5.0], [10.0, 480.0, 512.0]],
        }
    ]


def _collect() -> dict:
    out = {}
    out["full_roi"] = export_lipd_jsonld(
        meta_info=_meta(),
        roi_dfs=_roi_dfs(),
        age_depth_df=_age_depth_df(),
        ensemble_tables=_ensemble_tables(),
        column_units={"Pinus": "%", "Betula": "%", "Quercus": "%"},
        depth_unit="cm",
    )

    pollen_df = pd.DataFrame({"Depth (cm)": [0.0, 10.0], "Picea": [1.0, 2.0]})
    out["minimal_pollen"] = export_lipd_jsonld(pollen_df=pollen_df)

    bad = _meta()
    bad["site"] = dict(bad["site"])
    bad["site"].update(
        {"latitude": "n/a", "longitude": "", "elevation_m": "unknown",
         "water_depth_m": "deep", "core_length_m": "long"}
    )
    out["bad_geo_values"] = export_lipd_jsonld(meta_info=bad, roi_dfs=_roi_dfs())

    inv = _meta()
    inv["technical"] = dict(inv["technical"])
    inv["technical"]["investigators"] = "Ada Liu, Ben Wu ,"
    out["investigator_string"] = export_lipd_jsonld(meta_info=inv, roi_dfs=_roi_dfs())

    out["no_optional"] = export_lipd_jsonld()
    return out


def test_lipd_export_snapshot_is_stable() -> None:
    snapshot = _collect()

    if os.environ.get("UPDATE_LIPD_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_LIPD_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:2000]}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:2000]}"
        )
