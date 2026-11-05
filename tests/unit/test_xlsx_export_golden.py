# -*- coding: utf-8 -*-
"""`export_scientific_xlsx` 的输出快照（重构前的行为基线）。

## 为什么需要它

这个函数 437 行，其中 312 行在写 meta_info 这一个 sheet（五组字段各抄一遍 append）。
重构要把它收敛成表驱动，任何一处字段名/默认值走样都会让导出的表格少一行或多一列 ——
而现有测试只断言「sheet 名集合」与「某些 key 存在」，覆盖不到逐格内容。

所以这里钉**逐格快照**：同输入下每个 sheet 的每个单元格值必须完全相同。

## 时间戳是怎么处理的

readme sheet 带 `Export Timestamp`（`datetime.now`），每次导出都不同。这里不回避也不
删掉整行：把该格归一化成 `<timestamp>` 占位 —— 其余 readme 内容仍然逐字比对。

重新生成（仅在有意义地改导出内容时）：

    UPDATE_XLSX_GOLDEN=1 .pixi/envs/default/python.exe -m pytest \
        tests/unit/test_xlsx_export_golden.py
"""

import io
import json
import os
from pathlib import Path

import openpyxl
import pandas as pd

from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx

GOLDEN = Path(__file__).parent / "fixtures" / "xlsx_export_golden.json"


def _meta() -> dict:
    return {
        "publication": {
            "doi": "10.1016/j.quascirev.2020.106000",
            "title": "Holocene vegetation of Lake X",
            "authors": ["A. One", "B. Two"],
            "journal": "Quaternary Science Reviews",
            "year": 2020,
            "funding_agency": "NSFC",
            "funding_grant": "42001000",
            "source": "DOI",
        },
        "site": {
            "site_name": "Lake X",
            "latitude": 43.1,
            "longitude": 87.2,
            "elevation_m": 1500.0,
            "country": "China",
            "archive_type": "lake sediment",
            "water_depth_m": 2.5,
            "core_length_m": 1.2,
            "collection_date": "2019-07",
            "source": "User",
            "confidence": "high",
        },
        "chronology": {
            "dating_method": "210Pb",
            "age_model": "CRS",
            "age_range": "0-150 cal BP",
            "cal_curve": "IntCal20",
            "source": "User",
            "confidence": "high",
        },
        "technical": {
            "investigators": "C. Three",
            "digitizer": "D. Four",
            "affiliation": "Institute Y",
            "laboratory": "Lab Z",
            "sampling_interval_cm": 1.0,
            "digitization_date": "2024-01",
            "source": "User",
            "confidence": "high",
        },
        "quality": {
            "quality_notes": "Unobserved taxa filled as 0.00",
            "dataset_version": "v1.2",
            "original_data_url": "https://example.org/data",
            "source": "User",
        },
    }


def _pollen() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "depth_cm": [1.0, 2.0, 3.0],
            "Pinus": [10.0, 20.0, 30.0],
            "Betula": [5.0, 6.0, 7.0],
        }
    )


def _snapshot(payload: bytes) -> dict:
    wb = openpyxl.load_workbook(io.BytesIO(payload))
    cells: dict[str, list[list]] = {}
    styles: dict[str, dict] = {}
    for name in wb.sheetnames:
        rows: list[list] = []
        for row in wb[name].iter_rows(values_only=True):
            cells_row = []
            for value in row:
                if isinstance(value, float):
                    cells_row.append(round(value, 9))
                elif value is None:
                    cells_row.append(None)
                else:
                    cells_row.append(str(value))
            rows.append(cells_row)
        if name == "readme":
            for r in rows:
                if r and r[0] == "Export Timestamp" and len(r) > 1:
                    r[1] = "<timestamp>"
        cells[name] = rows

        # 样式也一起钉：golden 只比单元格值的话，改坏表头字体/填充/列宽是抓不到的。
        header_style = []
        for cell in wb[name][1]:
            color = cell.font.color.rgb if cell.font.color is not None else None
            header_style.append(
                [
                    cell.font.name,
                    cell.font.size,
                    bool(cell.font.bold),
                    color,
                    cell.fill.patternType,
                    cell.fill.fgColor.rgb,
                    cell.alignment.horizontal,
                    cell.alignment.vertical,
                ]
            )
        styles[name] = {
            "header": header_style,
            "widths": {k: v.width for k, v in wb[name].column_dimensions.items()},
            "grid": wb[name].views.sheetView[0].showGridLines,
        }
    return {"sheets": list(wb.sheetnames), "cells": cells, "styles": styles}


def _collect() -> dict:
    return {
        "full": _snapshot(
            export_scientific_xlsx(
                meta_info=_meta(),
                pollen_df=_pollen(),
                roi_dfs={
                    "pollen": _pollen(),
                    "charcoal": pd.DataFrame(
                        {"depth_cm": [1.0, 2.0], "charcoal": [3.0, 4.0]}
                    ),
                },
                age_depth_df=pd.DataFrame(
                    {"depth_cm": [1.0, 2.0], "age_cal_bp": [100.0, 200.0]}
                ),
                ensemble_tables=[
                    {
                        "name": "Age_Uncertainty",
                        "columns": ["depth_cm", "age"],
                        "data": [[1.0, 120.0], [2.0, 220.0]],
                    }
                ],
                qc_notes=[{"Item": "sum_check", "Value": "pass", "Detail": "ok"}],
                include_meta_sheets=True,
                include_readme=True,
            )
        ),
        "minimal": _snapshot(
            export_scientific_xlsx(
                pollen_df=_pollen(),
                include_meta_sheets=False,
                include_readme=False,
            )
        ),
    }


def test_export_snapshot_is_stable() -> None:
    """同输入 → 每个 sheet 的每个单元格值不变（时间戳归一化后）。"""
    snapshot = _collect()

    if os.environ.get("UPDATE_XLSX_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_XLSX_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys()
    for case in expected:
        assert snapshot[case]["sheets"] == expected[case]["sheets"], (
            f"{case} 的 sheet 列表变了：{snapshot[case]['sheets']} vs {expected[case]['sheets']}"
        )
        for sheet, want_style in expected[case]["styles"].items():
            assert snapshot[case]["styles"][sheet] == want_style, (
                f"{case}/{sheet} 的表头样式或列宽变了："
                f"{snapshot[case]['styles'][sheet]!r} vs {want_style!r}"
            )
        for sheet, want_rows in expected[case]["cells"].items():
            got_rows = snapshot[case]["cells"][sheet]
            assert len(got_rows) == len(want_rows), (
                f"{case}/{sheet} 行数变了：{len(got_rows)} vs {len(want_rows)}"
            )
            for i, (got_row, want_row) in enumerate(zip(got_rows, want_rows)):
                assert got_row == want_row, (
                    f"{case}/{sheet} 第 {i + 1} 行不一致：{got_row!r} vs {want_row!r}"
                )
