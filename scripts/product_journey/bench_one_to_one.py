# -*- coding: utf-8 -*-
"""列-属种一对一映射 + 逐列精度基准（替换掉有缺陷的「最佳匹配」口径）。

## 为什么必须换口径

`bench_plot_styles.py` 用「每个软件列与全部真值列求最大相关」，**不要求一对一**，
于是多列可匹配同一条真值曲线。实测：

    bar 风格 21 个软件列只对上 9 个不同真值列（Alnus glutinosa 被 5 列同时匹配）

那种口径下的相关系数是「列错位 + 允许重复」的混合产物，**不能当精度读数**。

本脚本改用**匈牙利算法求一对一最优分配**（`scipy.optimize.linear_sum_assignment`
在负相关矩阵上），保证每个软件列与每个真值属种至多匹配一次。

## 它回答的问题

- 软件分出的每一列，**最可能**对应哪个属种（一对一，不重复）
- 该列读数与真值的相关有多高
- 有多少列达到 0.7 以上的相关

## 口径边界（不可越界解读）

- 相关是**归一化后**的形状比较：图版无绝对标度，故不衡量绝对精度。
- 一对一分配**只是最优猜测**，不保证与作图时的真实列序一致。要独立验证分配
  是否正确，需要图上可读的属种名——但 riojaPlot 图版的标签竖排紧邻，
  OCR 在这类图上不可用（连通域 5 个，对比 Han2026 的 172 个）。
- 因此本脚本的结论定位是：**给出一个可复跑、不重复、可比较的基准**，
  用于「改读数算法前后是否变好」的对照，而非宣称绝对精度。

用法：
    pixi run python scripts/product_journey/bench_one_to_one.py
    pixi run python scripts/product_journey/bench_one_to_one.py --figure Pollen_CruveStyle_riojaPlotTestData.png
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys

import numpy as np
import openpyxl
from scipy.optimize import linear_sum_assignment

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

BENCH = os.path.join(ROOT, "tests/data/figures/benchmark_types")
TRUTH_XLSX = os.path.join(BENCH, "riojaPlotTestData_Pollen_and_Diatom.xlsx")
TRUTH_SHEET = "Abernethy_Pollen"

STYLES = [
    ("Pollen_riojaPlotTestData.png", "area"),
    ("Pollen_BarStyle_riojaPlotTestData.png", "bar"),
    ("Pollen_CruveStyle_riojaPlotTestData.png", "curve"),
]


def _normalise(values: np.ndarray) -> np.ndarray:
    span = values.max() - values.min()
    if span <= 0:
        return values * 0.0
    return (values - values.min()) / span


def _correlate(a: np.ndarray, b: np.ndarray) -> float:
    n = min(len(a), len(b))
    if n < 10:
        return 0.0
    x = np.interp(np.linspace(0.0, 1.0, n), np.linspace(0.0, 1.0, len(a)), a)
    y = np.interp(np.linspace(0.0, 1.0, n), np.linspace(0.0, 1.0, len(b)), b)
    if x.std() == 0 or y.std() == 0:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def load_truth() -> tuple[list[str], dict[str, np.ndarray]]:
    workbook = openpyxl.load_workbook(TRUTH_XLSX, data_only=True)
    sheet = workbook[TRUTH_SHEET]
    header = [sheet.cell(1, c).value for c in range(1, sheet.max_column + 1)]
    names: list[str] = []
    series: dict[str, np.ndarray] = {}
    for column, name in enumerate(header, start=1):
        if column <= 3 or not name:
            continue
        names.append(str(name))
        series[str(name)] = np.asarray(
            [float(sheet.cell(row, column).value or 0.0)
             for row in range(2, sheet.max_row + 1)],
            dtype=float,
        )
    return names, series


def measure(image_name: str, names: list[str], series: dict[str, np.ndarray]) -> dict:
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=os.path.join(BENCH, image_name))
    session.detect_columns(roi_id=session.rois[0]["id"])

    flagged = [index + 1 for index, col in enumerate(session.columns)
               if col.get("suspect_block")]
    for index in range(len(session.columns)):
        session.digitize(index)

    rows = list(csv.reader(io.StringIO(session.export_csv())))
    header, body = rows[0], rows[1:]

    extracted: list[np.ndarray] = []
    labels: list[str] = []
    for column in range(1, len(header)):
        values = [float(r[column]) for r in body if r[column]]
        if len(values) < 10:
            continue
        extracted.append(_normalise(np.asarray(values)))
        labels.append(header[column])

    # 相关矩阵：行 = 软件列，列 = 真值属种
    matrix = np.zeros((len(extracted), len(names)))
    for i, probe in enumerate(extracted):
        for j, name in enumerate(names):
            matrix[i, j] = _correlate(probe, _normalise(series[name]))

    # 匈牙利：负号变最大化；允许非方阵（列数 ≠ 属种数）
    row_idx, col_idx = linear_sum_assignment(-matrix)
    assignments = []
    for i, j in zip(row_idx, col_idx):
        assignments.append(
            {
                "column": labels[i],
                "matched_taxon": names[j],
                "correlation": round(float(matrix[i, j]), 4),
            }
        )
    corrs = np.asarray([item["correlation"] for item in assignments])
    return {
        "image": image_name,
        "columns_detected": len(session.columns),
        "columns_scored": len(extracted),
        "suspect_block_columns": flagged,
        "assignments": assignments,
        "correlation_median": round(float(np.median(corrs)), 4) if corrs.size else None,
        "correlation_mean": round(float(corrs.mean()), 4) if corrs.size else None,
        "columns_above_0_7": int((corrs > 0.7).sum()) if corrs.size else 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--figure", default=None, help="只跑指定图版")
    parser.add_argument("--json", dest="json_path", default=None)
    args = parser.parse_args()

    if not os.path.exists(TRUTH_XLSX):
        print(f"[错误] 真值表不存在: {TRUTH_XLSX}", file=sys.stderr)
        return 3

    names, series = load_truth()
    print(f"真值: {TRUTH_SHEET} | {len(names)} 个属种")
    print("口径: 匈牙利一对一最优分配（每个软件列与每个属种至多匹配一次）")
    print()

    targets = STYLES
    if args.figure:
        targets = [(n, s) for n, s in STYLES if n == args.figure] or [
            (args.figure, "custom")
        ]

    results = []
    for image_name, style in targets:
        if not os.path.exists(os.path.join(BENCH, image_name)):
            print(f"[跳过] 图版不存在: {image_name}")
            continue
        result = measure(image_name, names, series)
        result["style"] = style
        results.append(result)
        print(f"=== {style} | {image_name} ===")
        print(f"  分列 {result['columns_detected']}，评分 {result['columns_scored']}，"
              f"色块列 {result['suspect_block_columns'] or '无'}")
        print(f"  一对一相关: 中位 {result['correlation_median']} | "
              f"均值 {result['correlation_mean']} | >0.7 的列 {result['columns_above_0_7']}")
        for item in result["assignments"]:
            print(f"    {item['column']:<8} -> {item['matched_taxon']:<24} "
                  f"{item['correlation']:>6.3f}")
        print()

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump({"truth_taxa": len(names), "figures": results}, handle,
                      ensure_ascii=False, indent=2)
        print(f"已写出 {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
