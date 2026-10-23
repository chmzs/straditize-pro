# -*- coding: utf-8 -*-
"""用「逐行墨迹宽度变异系数」区分真实曲线列与非曲线列（色块/网纹）。

## 为什么需要这个判据

真实基准图 `Pollen_riojaPlotTestData.png` 上，软件分出的 21 列里：

    col1  x=[112,213]   宽 101px  逐行墨迹宽度 CV=0.768   真实曲线
    col15 x=[717,812]   宽  95px  逐行墨迹宽度 CV=0.860   真实曲线
    col21 x=[929,1055]  宽 126px  逐行墨迹宽度 CV=0.008   一整块矩形填充

col21 的逐行宽度几乎恒定（std=1.0px），显然不是曲线，却被当作数据列纳入，
会污染导出数值。

## 判据的物理依据

曲线的横向位置/宽度**随层位变化**；色块、网纹、文字则是**恒定宽度**。
实测三个样本差两个数量级（0.768 / 0.860 vs 0.008），无需调阈值。

## 用法

    pixi run python scripts/product_journey/probe_column_cv.py
    pixi run python scripts/product_journey/probe_column_cv.py --json out.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

BENCH = os.path.join(ROOT, "tests/data/figures/benchmark_types")

# 判定为「非曲线」的 CV 上限。实测曲线最低 0.768、色块 0.008，
# 取 0.1 留出充足余量（不是拟合出来的精确边界）。
NON_CURVE_CV_LIMIT = 0.1

FIGURES = [
    "Pollen_riojaPlotTestData.png",
    "Pollen_BarStyle_riojaPlotTestData.png",
    "Pollen_CruveStyle_riojaPlotTestData.png",
]


def row_ink_widths(dark: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> np.ndarray:
    """该矩形内每行「最左墨迹到最右墨迹」的宽度。"""
    widths = []
    for y in range(y0, y1):
        row = dark[y, x0:x1]
        if not row.any():
            continue
        idx = np.where(row)[0]
        widths.append(int(idx[-1] - idx[0] + 1))
    return np.asarray(widths, dtype=float)


def probe(image_name: str) -> dict:
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=os.path.join(BENCH, image_name))
    session.detect_columns(roi_id=session.rois[0]["id"])

    gray = np.asarray(session.image.convert("L"))
    dark = gray < 160
    y0 = int(session.rois[0]["ylim"][0])
    y1 = int(session.rois[0]["ylim"][1])

    per_column = []
    for index, column in enumerate(session.columns):
        x0, x1 = int(column["start"]), int(column["end"])
        widths = row_ink_widths(dark, x0, x1, y0, y1)
        if widths.size < 10 or widths.mean() <= 0:
            continue
        cv = float(widths.std() / widths.mean())
        per_column.append(
            {
                "column": index + 1,
                "x0": x0,
                "x1": x1,
                "width_px": x1 - x0,
                "rows_with_ink": int(widths.size),
                "mean_ink_width": round(float(widths.mean()), 2),
                "cv": round(cv, 4),
                "looks_like_curve": cv >= NON_CURVE_CV_LIMIT,
            }
        )

    suspicious = [item for item in per_column if not item["looks_like_curve"]]
    return {
        "image": image_name,
        "columns_detected": len(session.columns),
        "columns_scored": len(per_column),
        "non_curve_columns": suspicious,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", dest="json_path", default=None)
    args = parser.parse_args()

    results = []
    for image_name in FIGURES:
        if not os.path.exists(os.path.join(BENCH, image_name)):
            print(f"[跳过] 图版不存在: {image_name}")
            continue
        result = probe(image_name)
        results.append(result)
        print(f"=== {image_name} ===")
        print(f"  分列 {result['columns_detected']}，评分 {result['columns_scored']}")
        if result["non_curve_columns"]:
            for item in result["non_curve_columns"]:
                print(
                    f"  [非曲线] col{item['column']} x=[{item['x0']},{item['x1']}] "
                    f"宽 {item['width_px']}px 墨迹宽 {item['mean_ink_width']}px "
                    f"CV={item['cv']}"
                )
        else:
            print("  无非曲线列")
        print()

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(
                {"non_curve_cv_limit": NON_CURVE_CV_LIMIT, "figures": results},
                handle,
                ensure_ascii=False,
                indent=2,
            )
        print(f"已写出 {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
