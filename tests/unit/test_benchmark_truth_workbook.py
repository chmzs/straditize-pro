# -*- coding: utf-8 -*-
"""基准数据集的 Excel 必须能被 openpyxl 直接读取。

## 这个文件修的是什么

用户提供的 `riojaPlotTestData_Pollen_and_Diatom.xlsx` 是**权威真值表**——
它和同目录的 `Pollen_*` / `Diatom_*.png` 是同一份数据画出来的，所以可以
用来逐格核验数字化精度。但原始文件用 openpyxl 打不开：

    KeyError: "There is no item named 'xl/drawings/drawing1.xml' in the archive"

## 根因

文件内 3 个 `xl/worksheets/_rels/sheetN.xml.rels` 各声明了一条
`Target="../drawings/drawingN.xml"` 的关系，但：

1. `xl/drawings/` 目录**完全不存在**（连同 `vmlDrawingN.vml` 一起缺失）
2. 这些关系用的是 `rId1`，而 **sheet XML 里从未引用过 `rId1`**
   （实测各 sheet 只用到 `rId2`（printerSettings）与 `rId3/4/5`（tables））

即：**孤儿关系**。openpyxl 读 rels 时会尝试打开每个 Target，撞上不存在的
文件就抛 KeyError，整个工作簿打不开。

## 修法

删掉 rels 里 Target 指向 `../drawings/` 的关系条目。数据一个字节都没动——
修前修后三张表逐格对比完全相同（50 / 37 / 21 行）。

## 为什么用 openpyxl 而不是自建 XML 解析

本项目里 openpyxl 是 Excel 交付链的既有依赖（`xlsx` 技能、`r-report` 都走它）。
如果基准文件只能用自建解析器读，那它就不能作为"产品真实使用路径"的基准——
用户拿到这类文件时同样会打不开。**用产品实际会用的读取器验证，才是有效判据。**
"""

from __future__ import annotations

import os
import re
import zipfile

import pytest

BENCH = "tests/data/figures/benchmark_types"
TRUTH_XLSX = f"{BENCH}/riojaPlotTestData_Pollen_and_Diatom.xlsx"


@pytest.mark.skipif(
    not os.path.exists(TRUTH_XLSX),
    reason="权威真值表不在本机（tests/data/figures/benchmark_types 未包含该文件）",
)
class TestBenchmarkTruthWorkbook:
    """真值表必须可被 openpyxl 打开，且三张表数据齐全。"""

    def test_openpyxl_can_open_workbook(self) -> None:
        """openpyxl 是产品实际使用的读取器；它打不开就等于基准不可用。"""
        import openpyxl

        workbook = openpyxl.load_workbook(TRUTH_XLSX, data_only=True)

        assert workbook.sheetnames == [
            "Abernethy_Pollen",
            "Abernethy_Pollen_Group",
            "RLGH_Diatoms",
        ], f"工作表名不符: {workbook.sheetnames}"

    def test_pollen_sheet_shape_and_header(self) -> None:
        import openpyxl

        workbook = openpyxl.load_workbook(TRUTH_XLSX, data_only=True)
        sheet = workbook["Abernethy_Pollen"]

        assert sheet.max_row == 50, f"Pollen 应有 50 行（1 表头 + 49 样品），实为 {sheet.max_row}"
        assert sheet.max_column == 39, f"Pollen 应有 39 列，实为 {sheet.max_column}"

        header = [sheet.cell(1, c).value for c in range(1, 5)]
        assert header == ["Depth (cm)", "Age (14C years BP)", "Age (years BP)", "Betula"], (
            f"表头不符: {header}"
        )

        # 首行真实数值（与原始文件逐格核对过）
        first_row = [sheet.cell(2, c).value for c in range(1, 5)]
        assert first_row == [300, 5515, 6295, 15.11], f"首行数据不符: {first_row}"

    def test_diatom_sheet_shape(self) -> None:
        import openpyxl

        workbook = openpyxl.load_workbook(TRUTH_XLSX, data_only=True)
        sheet = workbook["RLGH_Diatoms"]

        assert sheet.max_row == 21, f"Diatom 应有 21 行（1 表头 + 20 样品），实为 {sheet.max_row}"
        assert sheet.max_column == 43, f"Diatom 应有 43 列，实为 {sheet.max_column}"

    def test_no_dangling_relationship_targets(self) -> None:
        """所有 rels 的 Target 都必须指向包内真实存在的文件。

        这条钉住"孤儿关系"这个根因：若将来有人重新用 Excel 另存该文件、
        又留下指向 drawings/ 的悬空关系，此用例会红。
        """
        archive = zipfile.ZipFile(TRUTH_XLSX)
        names = set(archive.namelist())

        dangling: list[tuple[str, str]] = []
        for member in sorted(names):
            if not member.endswith(".rels"):
                continue
            content = archive.read(member).decode("utf-8")
            # 根级 rels（_rels/.rels）的 Target 是包级绝对路径；
            # 其余 rels 的 Target 相对于其所属部件目录。
            is_root = member == "_rels/.rels"
            base = "" if is_root else member.rsplit("/_rels/", 1)[0]
            for target in re.findall(r'Target="([^"]+)"', content):
                if target.startswith("http"):
                    continue
                resolved = target.lstrip("/") if is_root else os.path.normpath(
                    os.path.join(base, target).replace("\\", "/")
                ).replace("\\", "/")
                if resolved not in names:
                    dangling.append((member, target))

        assert dangling == [], f"存在悬空关系引用: {dangling}"
