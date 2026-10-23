# -*- coding: utf-8 -*-
"""三绘图风格（area / bar / curve）在同一真值下的精度对照基准。

## 这套基准解决什么问题

此前项目黑名单记录：

    ❌ "line" 读数仍取带内全部墨迹均值（外来墨迹照算），改它需先有线型图 GT。

也就是说，想改线型图读数逻辑，却**没有真值可比**。用户提供的三张同数据图版
（1179×600，共用 `Abernethy_Pollen` 真值 49 样品 × 36 属种）正好补上这块 GT。

## 为什么用「最佳匹配相关」而不是逐列直比

软件分列结果与真值表的列顺序**不对应**（实测软件第 1 列匹配真值 `Ulmus`，
而非表内第 1 列的 `Betula`）。直接按列号比会把"列错位"混进"读数误差"，
得到接近 0 的相关系数——那是假结论。

因此每个软件列与**全部**真值列求归一化相关，取最大值。这衡量的是
"这一列是否对上了某条真实曲线"，与列序无关。

## 口径边界（不可越界解读）

- 相关是**归一化后的形状比较**：图中未标定绝对量程，故不衡量绝对精度。
- 相关中位 0.69 不等于"69% 准确"：多数列能对上真值中的某条曲线，但受
  分列错位影响，列与属种并非一一对应。
- 要得到绝对精度，必须先解决「分列 ↔ 真值列」的映射，否则任何数字都被错位污染。

用法：
    pixi run python scripts/product_journey/bench_plot_styles.py
    pixi run python scripts/product_journey/bench_plot_styles.py --json out.json
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
    """把序列线性拉伸到 [0, 1]，只保留形状。"""
    span = values.max() - values.min()
    if span <= 0:
        return values * 0.0
    return (values - values.min()) / span


def _resample(values: np.ndarray, n: int) -> np.ndarray:
    """按相对位置重采样到 n 个点，使长度不同的两条曲线可比。"""
    return np.interp(
        np.linspace(0.0, 1.0, n),
        np.linspace(0.0, 1.0, len(values)),
        values,
    )


def load_truth() -> dict[str, np.ndarray]:
    """读取权威真值：{属种名: 逐样品数值数组}。"""
    workbook = openpyxl.load_workbook(TRUTH_XLSX, data_only=True)
    sheet = workbook[TRUTH_SHEET]
    header = [sheet.cell(1, c).value for c in range(1, sheet.max_column + 1)]
    truth: dict[str, np.ndarray] = {}
    for column, name in enumerate(header, start=1):
        # 前三列是 Depth / Age(14C) / Age(years)，不是属种
        if column <= 3 or not name:
            continue
        values = [
            float(sheet.cell(row, column).value or 0.0)
            for row in range(2, sheet.max_row + 1)
        ]
        truth[str(name)] = np.asarray(values, dtype=float)
    return truth


def best_match_correlation(
    extracted: np.ndarray, truth: dict[str, np.ndarray]
) -> tuple[float, str | None]:
    """该列与全部真值列的最大归一化相关，及对应的真值列名。"""
    probe = _normalise(extracted)
    best_corr = -1.0
    best_name: str | None = None
    for name, series in truth.items():
        n = min(len(probe), len(series))
        if n < 10:
            continue
        a = _resample(probe, n)
        b = _resample(_normalise(series), n)
        if a.std() == 0 or b.std() == 0:
            continue
        corr = float(np.corrcoef(a, b)[0, 1])
        if corr > best_corr:
            best_corr, best_name = corr, name
    return best_corr, best_name


def measure_style(image_name: str, truth: dict[str, np.ndarray]) -> dict:
    """跑一张图：分列 → 数字化 → 导出 → 逐列最佳匹配。"""
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=os.path.join(BENCH, image_name))
    session.detect_columns(roi_id=session.rois[0]["id"])
    for index in range(len(session.columns)):
        session.digitize(index)

    rows = list(csv.reader(io.StringIO(session.export_csv())))
    header, body = rows[0], rows[1:]

    per_column = []
    for column in range(1, len(header)):
        values = [float(r[column]) for r in body if r[column]]
        if len(values) < 10:
            continue
        corr, matched = best_match_correlation(np.asarray(values), truth)
        per_column.append(
            {
                "column": header[column],
                "correlation": round(corr, 4),
                "matched_truth_column": matched,
            }
        )

    corrs = np.asarray([item["correlation"] for item in per_column])
    return {
        "image": image_name,
        "columns_detected": len(session.columns),
        "columns_scored": len(per_column),
        "correlation_median": round(float(np.median(corrs)), 4) if corrs.size else None,
        "correlation_mean": round(float(corrs.mean()), 4) if corrs.size else None,
        "columns_above_0_7": int((corrs > 0.7).sum()) if corrs.size else 0,
        "per_column": per_column,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", dest="json_path", default=None)
    args = parser.parse_args()

    if not os.path.exists(TRUTH_XLSX):
        print(f"[错误] 真值表不存在: {TRUTH_XLSX}", file=sys.stderr)
        return 3

    truth = load_truth()
    print(f"真值: {TRUTH_SHEET} | {len(truth)} 个属种")
    print()

    results = []
    for image_name, style in STYLES:
        path = os.path.join(BENCH, image_name)
        if not os.path.exists(path):
            print(f"[跳过] 图版不存在: {image_name}")
            continue
        result = measure_style(image_name, truth)
        result["style"] = style
        results.append(result)
        print(f"=== {style} | {image_name} ===")
        print(f"  分列 {result['columns_detected']} 列，评分 {result['columns_scored']} 列")
        print(
            f"  最佳匹配相关: 中位 {result['correlation_median']} | "
            f"均值 {result['correlation_mean']} | >0.7 的列 {result['columns_above_0_7']}"
        )
        print()

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump({"truth_columns": len(truth), "styles": results}, handle,
                      ensure_ascii=False, indent=2)
        print(f"已写出 {args.json_path}")

    if len(results) < 2:
        print("[错误] 可比较的风格少于 2 种，无法做对照", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
