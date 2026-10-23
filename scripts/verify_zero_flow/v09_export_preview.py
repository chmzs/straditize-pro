# -*- coding: utf-8 -*-
"""独立复核 I：static F-06（导出预览 Depth 全 0.0）与 F-08（未标定列 0→20 与文案不符）。

F-06 是**前端** ExportModal 的呈现问题。后端可判定的一半是：
"后端 CSV 的 depth 列是否是像素行号"（static 说 507/508/509…）。
另一半我用源码复刻 `getStandardDepthHorizons` 的数学，判断"全 0.0"是否可从代码推出。

F-08 是文案 vs 实现。后端可判定：`resolve_column_scale` 的 legacy 分支实际产出什么。

运行：
    pixi run python scripts/verify_zero_flow/v09_export_preview.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, new_session  # noqa: E402

CFG = isolate_config()


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("I1. static F-06：未标定 Y 轴时后端 CSV 的 depth 列")
    s = hoya(new_session())
    print(f"  is_calibrated = {bool(getattr(s, 'depth_calib', None))}  "
          f"depth_calib keys = {sorted((getattr(s, 'depth_calib', None) or {}).keys())}")
    exp = s.export_data(format="csv")
    rows = [r.split(",") for r in (exp.get("csv") or "").splitlines() if r.strip()]
    hdr, body = rows[0], rows[1:]
    print(f"  表头前 3 列 = {hdr[:3]}   数据行 = {len(body)}")
    depths = [r[0] for r in body[:8]]
    print(f"  前 8 行 depth = {depths}")
    uniq = sorted({r[0] for r in body}, key=lambda x: float(x))
    print(f"  depth 唯一值个数 = {len(uniq)}  首/末 = {uniq[0]} / {uniq[-1]}")
    print(f"  >>> 是否是像素行号（单调整数、与 ROI ylim 对齐）？ "
          f"{'是' if all(d.replace('.', '', 1).isdigit() for d in uniq[:20]) else '否'}")

    banner("I2. 同一会话：Y 轴标定之后 depth 列变成什么")
    s2 = hoya(new_session())
    s2.calibrate_axes([{"pixel": 511, "val": 0}, {"pixel": 1311, "val": 1300}], unit="cm")
    exp2 = s2.export_data(format="csv")
    rows2 = [r.split(",") for r in (exp2.get("csv") or "").splitlines() if r.strip()]
    body2 = rows2[1:]
    print(f"  标定后 depth 前 8 行 = {[r[0] for r in body2[:8]]}")
    print(f"  标定后 depth 唯一值个数 = {len({r[0] for r in body2})}")

    banner("I3. static F-08：未标定列的 legacy 标度实值")
    s3 = hoya(new_session())
    from straditize_core.session_parts.xscale import resolve_column_scale

    for k in (0, 1):
        c = s3.columns[k]
        sc = resolve_column_scale(s3, c, k)
        print(
            f"  列{k}: start={c['start']} end={c['end']} tickEndX={c['tickEndX']} "
            f"startValue={c['startValue']} tickValue={c['tickValue']}"
        )
        print(
            f"        resolve -> val0={sc.val0} val1={sc.val1} px0={sc.abs_px0} "
            f"px1={sc.abs_px1} calibrated={sc.calibrated} source={sc.source}"
        )
    print("  >>> 0..20 是 detect_columns 硬编码；列宽百分比会得到 val1≈100（列宽归一）")
    print("      两者都**不是**用户在图上读到的刻度值。")

    banner("I4. static F-08 的文案来源")
    from pathlib import Path

    p = Path("frontend/src/components/steps/ExportReadinessPanel.ts")
    for i, ln in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if "按列宽百分比" in ln or "未标定" in ln:
            print(f"  ExportReadinessPanel.ts:{i}  {ln.strip()[:150]}")

    banner("I5. static F-06 的前端数学（从源码复刻，非跑浏览器）")
    sp = Path("frontend/src/core/SplineInterpolator.ts").read_text(encoding="utf-8").splitlines()
    start = None
    for i, ln in enumerate(sp, 1):
        if "getStandardDepthHorizons" in ln:
            start = i
            break
    if start:
        for j in range(start, min(start + 60, len(sp))):
            print(f"  SplineInterpolator.ts:{j}  {sp[j]}")
    else:
        print("  未找到 getStandardDepthHorizons")


if __name__ == "__main__":
    main()
