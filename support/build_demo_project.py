"""Build the read-only demo project fixture from REAL backend computation.

The online demo must never fabricate results. Instead of shipping a mock, we run
the genuine pipeline once and ship its output as a project archive.

What this fixture deliberately does NOT contain
-----------------------------------------------
Per-column percentage calibration (each taxon column's printed tick value and its
pixel position). Those numbers are printed on the diagram and can only be read by
a human; inventing them would put false percentages in front of visitors. The
fixture therefore stops at auto-split (S3) and contains no percentage readings.

Re-run this after changing any detection algorithm so the demo cannot drift.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from straditize_core.session import StraditizeSession  # noqa: E402

SAMPLE = "hoya"
# 绘图区，由程序量出的长框线得到（见 HANDOFF：竖线 x=310..2206，底框 y=1374）
X0, X1 = 310, 2206
Y0, Y1 = 500, 1374
# 深度轴读数：图上印出的 150 cm 对齐 y=500，450 cm 对齐底框 y=1374。
# 交叉验证：200 cm 预测 y=645.7，与 1:1 裁剪上读到的 y≈645 一致。
DEPTH_MARKS = [{"pixel": 500.0, "val": 150.0}, {"pixel": 1374.0, "val": 450.0}]
# 最右侧的 Zone 生物带条不是属种列
ZONE_STRIP_FROM = 2030
# 检测把最左侧 Charcoal 列在 x=365 切成两段（那是炭屑曲线自身的边界），按图应为一列
CHARCOAL_SPLIT_X = 365


def build(out_path: Path) -> None:
    s = StraditizeSession()
    info = s.load_image(sample_key=SAMPLE)
    print(f"[1] loaded {SAMPLE}: {info['width']}x{info['height']}")

    cols = s.detect_columns(data_xlim=[X0, X1], data_ylim=[Y0, Y1])
    print(f"[2] detect_columns -> {len(cols)} raw bounds")

    kept = [dict(c) for c in cols if c["end"] <= ZONE_STRIP_FROM]
    print(f"[3] dropped {len(cols) - len(kept)} bound(s) at/after x={ZONE_STRIP_FROM} (zone strip / sliver)")

    merged: list[dict] = []
    i = 0
    while i < len(kept):
        cur = kept[i]
        if cur["start"] == X0 and i + 1 < len(kept) and kept[i + 1]["start"] == CHARCOAL_SPLIT_X:
            cur["end"] = kept[i + 1]["end"]
            i += 2
            print(f"[4] merged the split Charcoal column -> {cur['start']:.0f}..{cur['end']:.0f}")
        else:
            i += 1
        merged.append(cur)

    for n, c in enumerate(merged):
        c["col_index"] = n
        # 未做逐列百分比标定：把刻度齿收回到列右界，避免留下指向已被合并掉的半条边界的残值。
        # 演示构建据此不呈现任何百分比读数。
        c["tickEndX"] = c["end"]
        c["tickValue"] = 0.0
    s.columns = merged
    s.column_points = {}
    s.control_points = {}
    print(f"[5] final taxa columns: {len(merged)}")

    s.calibrate_axes(y_marks=DEPTH_MARKS)
    print(f"[6] depth calibrated: {DEPTH_MARKS}")

    # 轮廓数字化是纯像素几何，与本图是否标定无关，因此结果完全真实，
    # 也正是演示最有价值的部分（真实曲线叠在真实图谱上）。
    for c in s.columns:
        try:
            s.digitize(c["col_index"])
        except Exception as exc:  # noqa: BLE001
            print(f"    ! digitize col {c['col_index']} failed: {exc}")
    got = sum(len(v) for v in s.column_points.values())
    print(f"[7] digitized {len(s.column_points)}/{len(s.columns)} columns, {got} raw points")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    res = s.project_save(str(out_path), format="tar")
    print(f"[8] saved -> {out_path} ({res.get('size_bytes', '?')} bytes)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "docs" / "demo" / "demo-project.tar"))
    build(Path(ap.parse_args().out))


if __name__ == "__main__":
    main()
