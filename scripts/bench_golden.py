"""从 rioja 测试数据的原始 Excel 生成 benchmark 黄金值。

背景：`tests/data/figures/benchmark_types/` 下的四张 rioja 图与
`riojaPlotTestData_Pollen_and_Diatom.xlsx` 是同一份数据的不同画法，
图 ↔ 数据一一对应，所以可以拿 Excel 当**真值**量数字化误差。

一条规则（已与图逐列核对）：图上只画 `max >= MIN_MAX` 的属种，顺序同 Excel。
pollen 图 20/20 命中，diatom 图 25/25 命中（两者的元数据列数不同：pollen 有 3 列
Depth/Age14C/AgeBP，diatom 只有 Depth/Age —— 所以**元数据列必须按列名识别**，
按位置切片会漏掉 diatom 的第一个属种，实测漏了 `Achnanthes minutissima` max=3.18）。

**这里不写 `axis_max`**：图上 X 轴量程是"图上的量"，必须由测量者独立从像素测得
（pollen 图 = ceil(max/20)*20 恰好成立，diatom 图 25 个面板共用 px/单位 3.80，
axis_max = 列宽/3.80，只有 1/25 列等于 20）。把从图推出的量写进"真值文件"，
就是用图验图，误差会被自我确认掩盖。

用法：
    .pixi/envs/default/python.exe scripts/bench_golden.py
输出：`tests/data/figures/benchmark_types/golden/{abernethy_pollen,rlgh_diatom}.json`
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx"
OUT_DIR = ROOT / "tests/data/figures/benchmark_types/golden"
MIN_MAX = 2.0


def build(sheet: str) -> dict:
    df = pd.read_excel(XLSX, sheet_name=sheet)
    depth = [float(v) for v in df[df.columns[0]].tolist()]
    meta_cols = [
        c for c in df.columns if str(c).lower().startswith(("depth", "age"))
    ]
    taxa = []
    for name in (c for c in df.columns if c not in meta_cols):
        series = df[name]
        mx = float(series.max())
        if mx < MIN_MAX:
            continue
        taxa.append(
            {
                "name": str(name),
                "max": round(mx, 2),
                "values": [None if pd.isna(v) else round(float(v), 2) for v in series.tolist()],
            }
        )
    return {
        "sheet": sheet,
        "source_xlsx": str(XLSX.relative_to(ROOT)).replace("\\", "/"),
        "min_max_filter": MIN_MAX,
        "meta_columns": meta_cols,
        "n_layers": len(depth),
        "n_taxa": len(taxa),
        "depth_cm": depth,
        "taxa": taxa,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for sheet, filename in (
        ("Abernethy_Pollen", "abernethy_pollen.json"),
        ("RLGH_Diatoms", "rlgh_diatom.json"),
    ):
        obj = build(sheet)
        path = OUT_DIR / filename
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{filename}: {obj['n_taxa']} 列 × {obj['n_layers']} 层 -> {path}")


if __name__ == "__main__":
    main()
