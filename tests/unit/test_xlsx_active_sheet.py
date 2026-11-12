"""XLSX 打开时应停在数据页，而不是元信息页（UI/交付可用性判据）。

旧行为：sheet 顺序是 `meta_info → 数据 → readme`，但 `wb.active` 停留在第一张，
用户打开文件先看到元信息表，得手动切页才能取数。sheet **顺序**正确不代表**落点**正确。

判据读的是 `openpyxl.load_workbook(...).active.title`——即 Excel 打开时真正显示的那一页，
不是 `sheetnames[0]`（两者在旧实现里恰好不同，这正是本缺陷的隐蔽处）。
"""

from __future__ import annotations

import io

import openpyxl
import pandas as pd

from straditize_core.metadata.exporter_xlsx import export_scientific_xlsx

_DOC_PREFIXES = ("meta", "readme", "qc", "doc")


def _load(**kwargs) -> openpyxl.Workbook:
    payload = export_scientific_xlsx(**kwargs)
    return openpyxl.load_workbook(io.BytesIO(payload))


def test_active_sheet_is_data_when_meta_present() -> None:
    frame = pd.DataFrame({"depth": [1.0, 2.0], "Pinus": [10.0, 20.0]})
    workbook = _load(meta_info={"site": {"site_name": "判据测试湖"}}, pollen_df=frame)
    assert "meta_info" in workbook.sheetnames
    active = (workbook.active.title or "").strip().lower()
    assert not active.startswith(_DOC_PREFIXES), (
        f"打开文件应停在数据页，实际停在 {workbook.active.title!r}"
    )


def test_active_sheet_follows_first_roi_when_multi_roi() -> None:
    frame = pd.DataFrame({"depth": [1.0, 2.0], "Pinus": [10.0, 20.0]})
    workbook = _load(
        meta_info={"site": {"site_name": "判据测试湖"}},
        roi_dfs={"判据分区": frame},
    )
    active = (workbook.active.title or "").strip().lower()
    assert not active.startswith(_DOC_PREFIXES)
    assert workbook.active.title == "判据分区"
