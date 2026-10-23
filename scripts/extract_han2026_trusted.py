# -*- coding: utf-8 -*-
"""Han et al. (2026) Fig.3 —— **只提取有印刷数字的列**（可信子集）。

## 为什么只做 5 列

图版每列底部有独立刻度尺，但只有 5 列在刻度尺下印了数字：

| 列 | 印刷数字 | 可两点式定线 |
| :--- | :--- | :--- |
| Quercus(E) | `20` @ x=569 | ✗ 单点 |
| Euphorbiaceae | `20/40/60/80` | ✓ 四点 |
| Cyperaceae | `20/40/60` | ✓ 三点 |
| Poaceae | `20` @ x=1181 | ✗ 单点 |
| Caryophyllaceae | `20` @ x=1264 | ✗ 单点 |

其余 10 列**只有刻线、无数字**。每格代表多少是作图书版设定，图上无信息可推
（实测跨列外推误差 −84% ~ +151%，见 `docs/findings/defects-from-real-figure.md`）。
故本脚本**只输出能定线的那 2 列**，其余一律不产出 —— 宁缺勿编。

## 与论文 reported max 的交叉校验

```
Cyperaceae  刻度尺末端(1081) → 74.6%   论文 70.07%   偏差 +6.5%
Euphorbiaceae 列末端(924)    → 97.4%   论文未报      无外部校验
```

+6.5% 来自"列末端 vs 刻度尺末端"的差异，属扫描图版提取的正常量级。

用法：
    pixi run python scripts/extract_han2026_trusted.py
"""
from __future__ import annotations

import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
OUT_DIR = "output/han2026_ngamring"
ROI_Y0, ROI_Y1 = 233, 861
DEPTH_TOP_PX, DEPTH_BOTTOM_PX, DEPTH_MAX_CM = 232.0, 862.0, 787.0

# name, x0, x1, [(printed_number_centre_px, value), ...]
TRUSTED = [
    ("Euphorbiaceae", 704, 924, [(742, 20.0), (789, 40.0), (835, 60.0), (883, 80.0)]),
    ("Cyperaceae", 907, 1096, [(954, 20.0), (1001, 40.0), (1047, 60.0)]),
]

#: 论文正文 reported max，用于交叉校验（仅作对照，不参与标定）
PAPER_MAX = {"Cyperaceae": 70.07}


def fit(pts: list[tuple[float, float]]) -> tuple[float, float]:
    """Least-squares line ``value = slope*px + intercept`` from printed numbers."""
    xs = np.array([p for p, _ in pts], dtype=float)
    ys = np.array([v for _, v in pts], dtype=float)
    slope, intercept = np.polyfit(xs, ys, 1)
    return float(slope), float(intercept)


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    s = StraditizeSession()
    s._init_cleanup()
    info = s.load_image(os.path.abspath(FIG))
    print(f"[1] 载入 {info['width']}x{info['height']}")

    s.roi_create(name="Ngamring_trusted", x0=704, x1=1096,
                 y0=ROI_Y0, y1=ROI_Y1, composition=True)
    roi_id = s.rois[0]["id"]
    s.roi_set_primary(roi_id)
    s.roi_set_active(roi_id)
    print(f"[2] ROI {roi_id}")

    s.calibrate_axes(
        y_marks=[{"pixel": DEPTH_TOP_PX, "val": 0.0},
                 {"pixel": DEPTH_BOTTOM_PX, "val": DEPTH_MAX_CM}],
        unit="cm",
    )
    print(f"[3] Y 轴 0–{DEPTH_MAX_CM:.0f} cm")

    s.columns = []
    for name, x0, x1, _pts in TRUSTED:
        s.column_add({"name": name, "species": name,
                      "startX": float(x0), "endX": float(x1)})
    for i, (name, x0, x1, _pts) in enumerate(TRUSTED):
        s.column_update(i, {"roi_id": roi_id, "name": name, "species": name,
                            "start": float(x0), "end": float(x1),
                            "startX": float(x0), "endX": float(x1),
                            "unit": "%", "plot_type": "area"})
    print(f"[4] 分列 {len(s.columns)} 列（仅可信子集）")

    print("[5] 两点式标定（读数取自图版印刷数字）")
    for i, (name, x0, x1, pts) in enumerate(TRUSTED):
        slope, intercept = fit(pts)
        px0 = float(pts[0][0] - (pts[0][1] - slope * pts[0][0]) / slope)  # value->0 的 x
        px0 = -intercept / slope
        px1 = float(x1)
        v1 = slope * px1 + intercept
        s.calibrate_column_xticks(
            i,
            ticks=[{"px": round(px0, 2), "value": 0.0},
                   {"px": round(px1, 2), "value": round(v1, 2)}],
            unit="%", plot_type="area", scale_type="linear",
        )
        check = ", ".join(f"{p}→{slope * p + intercept:.1f}" for p, v in pts)
        print(f"    {name:<16} 0% @ x={px0:.1f} → 满量程 {v1:.1f}%  (拟合校验: {check})")

    print("[6] 数字化")
    for col in s.columns:
        s.digitize(col["col_index"], "area")
    npts = sum(len(v) for v in s.column_points.values())
    s.apply_depth_grid(start_depth=0.0, end_depth=DEPTH_MAX_CM, step=5.0)
    print(f"    {npts} 点 / {len(s.depth_grid)} 深度层（5 cm）")

    csv_path = os.path.join(OUT_DIR, "Han2026_Fig3_trusted.csv")
    s.export_data(format="csv", output_path=csv_path)
    s.project_save(output_path=os.path.join(OUT_DIR, "Han2026_Fig3_trusted.project.json"),
                   format="json")
    print(f"[7] 导出 {csv_path}")

    # ---- 交叉校验（论文 reported max）----
    print("\n[8] 与论文 reported max 交叉校验")
    with open(csv_path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for name, *_ in TRUSTED:
        vals = [float(r[name]) for r in rows if r.get(name)]
        pm = PAPER_MAX.get(name)
        line = f"    {name:<16} 提取 max={max(vals):>6.2f}%  非零 {sum(1 for v in vals if v > 0)}/{len(vals)}"
        if pm:
            line += f"  论文 {pm:.2f}%  偏差 {(max(vals) / pm - 1) * 100:+.1f}%"
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
