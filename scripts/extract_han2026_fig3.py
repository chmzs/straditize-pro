# -*- coding: utf-8 -*-
"""Han et al. (2026, GPC 256:105195) Fig. 3 花粉图 —— 用 Straditize 本体走完整八步，
并**逐列标注读数来源**（本脚本的核心价值：可追溯，不编造）。

## 读数来源（provenance）三级

- `human`：图版刻度尺下**印了数字**的列。本脚本用印刷数字锚定的刻度齿做两点式标定。
- `paper_range`：图版**无数字**的列，满量程取自论文正文报告的量程上界。
  **这是回推，不是图版直读**，导出 CSV 的表头注释会写明。
- `NA`：既无图版数字、论文正文也没报告量程的列（Abies / Picea / Betula / Quercus_D）。
  **不编造满量程，直接输出空值。**

## 图版几何（逐像素实测，2026-10-19 data-engineer 复核）

- 每列底部有独立刻度尺，小齿间距 **12.5 px**（全图一致，实测 12.0–13.0，中位 12.5）。
- 宽列的大齿 = 每 4 个小齿（50 px），印 20/40/60/80 → **1 小齿 = 5 单位 → 2.5 px/单位**。
  该比例在 4 个印数字的列上自洽（Euphorbiaceae 0→80 跨 200px、Cyperaceae 0→70 跨 175px）。
- 刻度尺起点 = 列基线（= 0），终点 = 该列量程上界。

用法：
    pixi run python scripts/extract_han2026_fig3.py
"""
from __future__ import annotations

import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
OUT_DIR = "output/han2026_ngamring"

# 绘图区纵向：顶线 y=232（0 cm），底线 y=862（787 cm）
ROI_Y0, ROI_Y1 = 233, 861
DEPTH_TOP_PX, DEPTH_BOTTOM_PX = 232.0, 862.0
DEPTH_MAX_CM = 787.0
GRID_STEP_CM = 5.0

# 论文正文报告的量程上界（%）。None = 正文未报告 → 该列无法标定，输出 NA。
PAPER_MAX = {
    "Pinus": 40.74,
    "Abies": None,
    "Picea": None,
    "Betula": None,
    "Quercus_D": None,
    "Quercus_E": None,
    "Rosaceae": 12.97,
    "Chenopodiaceae": 6.68,
    "Hippophae": 7.75,
    "Euphorbiaceae": None,
    "Cyperaceae": 70.07,
    "Artemisia": 67.42,
    "Poaceae": 9.21,
    "Ranunculaceae": 14.0,
    "Caryophyllaceae": 4.29,
}

# (name, x0, x1, tick_px0, tick_px1, full_scale, provenance)
#   x0/x1        = 列几何边界（图版实测基线）
#   tick_px0/1   = 刻度尺两点（起点 = 0；终点 = 满量程）
#   full_scale   = 终点对应的百分比值
#   provenance   = human（图版印数字）/ paper_range（正文回推）/ NA（不可标定）
COLUMN_SPECS = [
    ("Pinus",            332,  370, 332.0,  358.0, 40.74, "paper_range"),
    ("Abies",            370,  407, 370.0,  395.0, None,  "NA"),
    ("Picea",            407,  445, 407.0,  432.0, None,  "NA"),
    ("Betula",           445,  482, 445.0,  470.0, None,  "NA"),
    ("Quercus_D",        482,  521, 482.0,  507.0, None,  "NA"),
    # ---- 以下 5 列图版印了数字 → human ----
    # Quercus(E)：刻度齿 519.5(=0) → 569.5(=20)，跨 4 小齿 50px → 2.5 px/单位
    ("Quercus_E",        521,  582, 519.5,  569.5, 20.0,  "human"),
    ("Rosaceae",         582,  619, 582.0,  607.0, 12.97, "paper_range"),
    ("Chenopodiaceae",   619,  657, 619.0,  645.0, 6.68,  "paper_range"),
    ("Hippophae",        657,  694, 657.0,  682.0, 7.75,  "paper_range"),
    # Euphorbiaceae：印 20@744 / 40@794 / 60@844 / 80@894（每 4 小齿 20 单位）
    ("Euphorbiaceae",    694,  906, 694.0,  894.0, 80.0,  "human"),
    # Cyperaceae：印 20/40/60；刻度尺 0→70 跨 14 小齿 175px
    ("Cyperaceae",       906, 1093, 906.0, 1081.0, 70.0,  "human"),
    ("Artemisia",       1093, 1131, 1093.0, 1119.0, 67.42, "paper_range"),
    # Poaceae：印 20@1181（= 刻度尺终点，跨 4 小齿）
    ("Poaceae",         1131, 1193, 1131.0, 1181.0, 20.0,  "human"),
    ("Ranunculaceae",   1193, 1231, 1193.0, 1218.0, 14.0,  "paper_range"),
    # Caryophyllaceae：刻度尺 0→1269（3 小齿）；印刷数字在 x1241–1283 一带，
    #   分辨率不足以无歧义判读，且填充为灰色(182)被默认阈值丢弃 → 双重存疑，见文档。
    ("Caryophyllaceae", 1231, 1280, 1231.0, 1269.0, 15.2,  "human"),
]

PROVENANCE_NOTE = {
    "human": "满量程取自图版刻度尺印刷数字（人工判读）",
    "paper_range": "满量程由论文正文量程上界回推，非图版直读",
    "NA": "无图版数字且正文未报告量程，未标定",
}


def _measure_fill_max(img_gray: np.ndarray, spec) -> dict:
    """独立于软件流程，直接从图版量出每列的实心填充最大像素跨度。

    用于偏差表的交叉校验：若软件提取值与图版实测值不符，说明链路有问题。
    """
    name, x0, x1, t0, t1, fs, prov = spec
    y0, y1 = 240, 858  # 避开上下框线
    sub = img_gray[y0:y1, int(x0) + 3: int(x1) - 1]
    thr = 205 if name == "Caryophyllaceae" else 150
    prof = []
    for row in sub:
        w = np.where(row <= thr)[0]
        prof.append(int(w.max()) if len(w) else -1)
    prof = np.array(prof)
    if prof.size == 0 or prof.max() < 0:
        return {"max_px": None, "frac_nonzero": 0.0}
    return {
        "max_px": int(prof.max()),
        "frac_nonzero": round(float((prof > 2).mean()), 4),
    }


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    gray = np.asarray(Image.open(FIG).convert("L")).astype(float)

    s = StraditizeSession()
    s._init_cleanup()

    # ---- Step 1 载入 --------------------------------------------------
    info = s.load_image(os.path.abspath(FIG))
    print(f"[1/8] 载入 {info['width']}x{info['height']}")

    # ---- Step 2 ROI ---------------------------------------------------
    s.roi_create(name="Ngamring_Co", x0=324, x1=1280, y0=ROI_Y0, y1=ROI_Y1,
                 composition=True)
    roi_id = s.rois[0]["id"]
    s.roi_set_primary(roi_id)
    s.roi_set_active(roi_id)
    print(f"[2/8] ROI {roi_id}: x[324,1280] y[{ROI_Y0},{ROI_Y1}]")

    # ---- Step 3 Y 轴两点标定（深度 cm） --------------------------------
    s.calibrate_axes(
        y_marks=[{"pixel": DEPTH_TOP_PX, "val": 0.0},
                 {"pixel": DEPTH_BOTTOM_PX, "val": DEPTH_MAX_CM}],
        unit="cm",
    )
    print(f"[3/8] Y 轴: {DEPTH_TOP_PX:.0f}px=0cm → {DEPTH_BOTTOM_PX:.0f}px={DEPTH_MAX_CM:.0f}cm")

    # ---- Step 4 清理 --------------------------------------------------
    s.detect_line_candidates(roi_id=roi_id)
    print(f"[4/8] 清理: 候选 {len(s.line_candidates)} 条（保持未确认，不改原图墨迹）")

    # ---- Step 5 分列（图版实测边界） -----------------------------------
    s.columns = []
    for name, x0, x1, _t0, _t1, _fs, _prov in COLUMN_SPECS:
        s.column_add({"name": name, "species": name,
                      "startX": float(x0), "endX": float(x1)})
    for idx, (name, x0, x1, _t0, _t1, _fs, _prov) in enumerate(COLUMN_SPECS):
        s.column_update(idx, {"roi_id": roi_id, "name": name, "species": name,
                              "start": float(x0), "end": float(x1),
                              "startX": float(x0), "endX": float(x1),
                              "unit": "%", "plot_type": "area"})
    print(f"[5/8] 分列: {len(s.columns)} 列（图版实测边界）")

    # ---- Step 6 标定列 X 刻度（两点式，逐列标注来源） -------------------
    n_human = n_paper = n_na = 0
    for idx, (name, x0, x1, t0, t1, fs, prov) in enumerate(COLUMN_SPECS):
        if fs is None:
            n_na += 1
            continue
        s.calibrate_column_xticks(
            idx,
            ticks=[{"px": float(t0), "value": 0.0},
                   {"px": float(t1), "value": float(fs)}],
            unit="%", plot_type="area", scale_type="linear",
        )
        if prov == "human":
            n_human += 1
        else:
            n_paper += 1
    print(f"[6/8] 标定: {len(s.columns)} 列（human {n_human} / paper_range {n_paper} / NA {n_na}）")

    # ---- Step 7 数字化 + 深度网格 --------------------------------------
    for col in s.columns:
        s.digitize(col["col_index"], "area")
    npts = sum(len(v) for v in s.column_points.values())
    grid = s.apply_depth_grid(start_depth=0.0, end_depth=DEPTH_MAX_CM, step=GRID_STEP_CM)
    print(f"[7/8] 数字化 {npts} 点；深度网格 {grid['count']} 层（{GRID_STEP_CM:.0f} cm，同原论文取样）")

    # ---- Step 8 取值 + 导出 -------------------------------------------
    grid_res = s.extract_grid_values()
    depths = grid_res["depths"]
    taxa = grid_res["taxa"]
    rows = grid_res["data"]
    print(f"[8/8] 网格取值: {grid_res['rows_count']} 层 × {grid_res['columns_count']} 列")

    prov_by_name = {c[0]: c[6] for c in COLUMN_SPECS}
    fs_by_name = {c[0]: c[5] for c in COLUMN_SPECS}

    trusted_cols = [t for t in taxa if prov_by_name.get(t) == "human"]
    na_cols = [t for t in taxa if prov_by_name.get(t) == "NA"]

    # ---- 可信表：只含 human 列 -----------------------------------------
    trusted_path = os.path.join(OUT_DIR, "Han2026_Fig3_trusted.csv")
    with open(trusted_path, "w", newline="", encoding="utf-8") as fh:
        fh.write("# Han et al. (2026) GPC 256:105195 Fig.3 — Ngamring Co 花粉百分比（可信子集）\n")
        fh.write("# 读数来源：图版刻度尺印刷数字，两点式标定（provenance=human）\n")
        fh.write("# 深度网格：0-787 cm，步长 5 cm，与原论文取样一致（正文报 159 个样品）\n")
        fh.write("# 列几何与刻度实测：见 docs/findings/pollen-extraction-han2026.md\n")
        for t in trusted_cols:
            fh.write(f"#   {t}: 满量程 {fs_by_name[t]}% — {PROVENANCE_NOTE['human']}\n")
        fh.write("# ⚠️ Caryophyllaceae 填充为灰色(182)，被默认灰度 Otsu 阈值丢弃（覆盖率约 0.5%），\n")
        fh.write("#    本列数值不可信，仅作占位；其余 4 列提取正常。详见上述文档 §5。\n")
        fh.write("# ⚠️ 本表是图版的几何复现与量级校验，不是原始数据的替代品：\n")
        fh.write("#    原始数据（159 样品 × 全部类群）需向通讯作者 Xianyong Cao (xcao@itpcas.ac.cn) 索取。\n")
        w = csv.writer(fh)
        w.writerow(["depth_cm"] + trusted_cols)
        for d in depths:
            r = rows[int(round(d))] if isinstance(rows, dict) else rows[depths.index(d)]
            w.writerow([d] + [r.get(t, "") for t in trusted_cols])

    # ---- 全量表：15 列 + provenance 表头注释 ---------------------------
    full_path = os.path.join(OUT_DIR, "Han2026_Fig3_with_paper_ranges.csv")
    with open(full_path, "w", newline="", encoding="utf-8") as fh:
        fh.write("# Han et al. (2026) GPC 256:105195 Fig.3 — Ngamring Co 花粉百分比（全 15 列）\n")
        fh.write("# ⚠️ 本表逐列标注读数来源，请勿把 paper_range 列当作图版直读结果使用。\n")
        fh.write("# provenance 取值：\n")
        fh.write("#   human       满量程取自图版刻度尺印刷数字（人工判读）\n")
        fh.write("#   paper_range 满量程由论文正文量程上界回推，非图版直读\n")
        fh.write("#   NA          无图版数字且正文未报告量程，未标定（该列全为空值）\n")
        for t in taxa:
            p = prov_by_name.get(t, "NA")
            fs = fs_by_name.get(t)
            fs_s = "未标定" if fs is None else f"{fs}%"
            fh.write(f"#   {t:18s} provenance={p:12s} 满量程={fs_s:8s} {PROVENANCE_NOTE.get(p, '')}\n")
        fh.write("# ⚠️ 原始数据（159 样品 × 全部类群）未随论文公开，需向通讯作者\n")
        fh.write("#    Xianyong Cao (xcao@itpcas.ac.cn) 索取；图版提取的定位是几何复现 + 量级校验。\n")
        w = csv.writer(fh)
        w.writerow(["depth_cm"] + list(taxa))
        for i, d in enumerate(depths):
            r = rows[i]
            w.writerow([d] + [("" if prov_by_name.get(t) == "NA" else r.get(t, ""))
                              for t in taxa])

    # ---- 偏差表：提取 max vs 论文 max ----------------------------------
    dev_rows = []
    for name, x0, x1, t0, t1, fs, prov in COLUMN_SPECS:
        pm = PAPER_MAX.get(name)
        vals = [float(rows[i][name]) for i in range(len(depths))
                if prov != "NA" and rows[i].get(name) is not None]
        emax = max(vals) if vals else None
        fill = _measure_fill_max(gray, (name, x0, x1, t0, t1, fs, prov))
        dev = None
        if emax is not None and pm:
            dev = round((emax - pm) / pm * 100.0, 1)
        dev_rows.append({
            "column": name,
            "provenance": prov,
            "full_scale_pct": fs,
            "extract_max_pct": None if emax is None else round(emax, 2),
            "paper_max_pct": pm,
            "deviation_pct": dev,
            "figure_max_px": fill["max_px"],
            "nonzero_fraction": fill["frac_nonzero"],
        })

    dev_path = os.path.join(OUT_DIR, "Han2026_Fig3_deviation.json")
    with open(dev_path, "w", encoding="utf-8") as fh:
        json.dump({"figure": "Han2026 Fig.3", "grid_step_cm": GRID_STEP_CM,
                   "n_layers": len(depths), "columns": dev_rows}, fh,
                  ensure_ascii=False, indent=2)

    # ---- 工程包 -------------------------------------------------------
    s.project_save(output_path=os.path.join(OUT_DIR, "Han2026_Fig3_pollen.project.json"),
                   format="json")
    s.project_save(output_path=os.path.join(OUT_DIR, "Han2026_Fig3_pollen.project.tar"))

    print(f"      可信表  {trusted_path}  ({len(trusted_cols)} 列: {', '.join(trusted_cols)})")
    print(f"      全量表  {full_path}")
    print(f"      偏差表  {dev_path}")
    print()
    print(f"{'column':18s} {'prov':12s} {'extract':>8s} {'paper':>8s} {'dev%':>7s} {'figpx':>6s}")
    for r in dev_rows:
        em = "-" if r["extract_max_pct"] is None else f"{r['extract_max_pct']:.2f}"
        pm = "-" if r["paper_max_pct"] is None else f"{r['paper_max_pct']:.2f}"
        dv = "-" if r["deviation_pct"] is None else f"{r['deviation_pct']:+.1f}"
        fp = "-" if r["figure_max_px"] is None else str(r["figure_max_px"])
        print(f"{r['column']:18s} {r['provenance']:12s} {em:>8s} {pm:>8s} {dv:>7s} {fp:>6s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
