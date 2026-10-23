# -*- coding: utf-8 -*-
"""G-01：真实期刊扫描件（Han 2026 Fig.3, 2132x928）跑完整八步链路。

只报不改。每一步都打印后端真实返回值（大字段摘要掉）。

用法:
    pixi run python scripts/prod_gate/g01_full_chain.py [--roi auto|measured]
"""
from __future__ import annotations

import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.session import StraditizeSession  # noqa: E402

FIG = "output/han2026_ngamring/fig3_raw.jpeg"
OUT_DIR = "output/prod_gate"

# 独立像素实测得到的图版真值（见 g01_geometry_truth.py 的输出）
TRUE_TOP_FRAME = 232  # 顶框线 y=232..233
TRUE_BOTTOM_FRAME = 869  # 底框线 y=868..869
TRUE_DATA_Y0, TRUE_DATA_Y1 = 233, 861  # 数据区（去掉框线本身）
TRUE_COL_X0, TRUE_COL_X1 = 332, 1280  # 第一个花粉列左边 332，Caryophyllaceae 右边界 1280

# 图版只在 5 列刻度尺下印了数字（pollen-extraction-han2026.md §5，逐像素核对过）
PRINTED_TICKS = {
    "Euphorbiaceae": [(742, 20.0), (789, 40.0), (835, 60.0), (883, 80.0)],
    "Cyperaceae": [(954, 20.0), (1001, 40.0), (1047, 60.0)],
}


def main() -> int:
    mode = "measured"
    if "--roi" in sys.argv:
        mode = sys.argv[sys.argv.index("--roi") + 1]

    os.makedirs(OUT_DIR, exist_ok=True)
    U.hash_banner(f"G-01 full chain (roi={mode})")

    s = StraditizeSession()
    s._init_cleanup()

    # ---- Step 1 载图 ----
    info = s.load_image(os.path.abspath(FIG))
    print("\n[1] load_image")
    print(f"    width x height = {info['width']} x {info['height']}")
    print(f"    suggested_roi  = {info['suggested_roi']}")
    print(f"    rois           = {[(r['id'], r['xlim'], r['ylim']) for r in info['rois']]}")
    print(
        f"    默认 ROI 覆盖数据区的比例: "
        f"纵向 {info['suggested_roi']['yMin']:.0f}..{info['suggested_roi']['yMax']:.0f}"
        f" / 真值 {TRUE_TOP_FRAME}..{TRUE_BOTTOM_FRAME}"
        f" -> 丢了顶部 {info['suggested_roi']['yMin'] - TRUE_TOP_FRAME:.0f}px、"
        f"底部 {TRUE_BOTTOM_FRAME - info['suggested_roi']['yMax']:.0f}px"
    )

    # ---- Step 2 ROI ----
    if mode == "measured":
        # 用户按肉眼框住花粉数据区（这是真实用户会做的事）
        for r in list(s.rois):
            s.roi_remove(r["id"])
        rid = s.roi_create(
            name="Han2026_Fig3",
            x0=TRUE_COL_X0 - 2,
            x1=TRUE_COL_X1 + 50,  # 含最右 Tree/Shrubs 柱状图一部分
            y0=TRUE_DATA_Y0,
            y1=TRUE_DATA_Y1,
            composition=True,
        )["roi"]["id"]
        s.roi_set_primary(rid)
        s.roi_set_active(rid)
    else:
        rid = s.active_roi_id or s.rois[0]["id"]

    roi = s._get_roi(rid) if hasattr(s, "_get_roi") else None
    print(f"\n[2] ROI = {rid}  xlim={roi['xlim']}  ylim={roi['ylim']}")

    # ---- Step 3 清理（前景提取） ----
    fg = s.extract_foreground()
    print("\n[3] extract_foreground")
    U.jprint({k: v for k, v in fg.items()})

    # ---- Step 4 分区线候选 ----
    dc = s.detect_line_candidates(roi_id=rid)
    cands = dc["candidates"]
    print(f"\n[4] detect_line_candidates -> {len(cands)} candidates")
    for c in cands:
        g = c.get("geometry", {})
        print(
            f"    {c['id']:12s} kind={c.get('kind')} "
            f"x0={g.get('x0')} y0={g.get('y0')} x1={g.get('x1')} y1={g.get('y1')}"
        )
    h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
    print(f"    选中横向分区线（kind=A）: {h_ids}")

    # ---- Step 5 应用清理 ----
    res = s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
    print("\n[5] apply_line_removal")
    for k, v in res.items():
        if isinstance(v, str) and len(v) > 200:
            print(f"    {k}: <{len(v)} chars, 摘要>")
        elif isinstance(v, (list, dict)):
            print(f"    {k}: <{type(v).__name__} len={len(v)}>")
        else:
            print(f"    {k}: {v}")

    # ---- Step 6 分列 ----
    cols = s.detect_columns(roi_id=rid)
    print(f"\n[6] detect_columns -> {len(cols)} 列")
    for c in cols:
        print(
            f"    {c['id']:16s} start={c['start']:7.1f} end={c['end']:7.1f} "
            f"width={c['end'] - c['start']:6.1f} tickEndX={c.get('tickEndX')}"
        )
    print(f"    hline_rows（被当作网格线剔除的行，ROI 内相对坐标）= {getattr(s, 'hline_rows', None)}")

    # ---- Step 7 刻度齿检测 ----
    xt = s.detect_xticks_rpc(roi_id=rid)
    print("\n[7] detect_xticks_rpc")
    print(f"    band = {xt.get('band')}")
    per = xt.get("per_column") or []
    print(f"    per_column 条数 = {len(per)}")
    usable = [p for p in per if p.get("usable") or p.get("has_ruler") or p.get("ticks")]
    for p in per:
        ticks = p.get("ticks") or []
        if ticks:
            print(
                f"    col={p.get('col_id') or p.get('index')} ticks={len(ticks)} "
                f"first3={[round(t, 1) for t in ticks[:3]]} usable={p.get('usable')}"
            )

    # ---- Step 8 标定（只用图版真印了数字的两列） ----
    print("\n[8] calibrate_column_xticks —— 只标定图版上真印了数字的列")
    calibrated = 0
    for name, printed in PRINTED_TICKS.items():
        target = None
        for c in cols:
            # 用列几何反查：Euphorbiaceae 列在 694..906，Cyperaceae 在 906..1093
            if name == "Euphorbiaceae" and abs(c["start"] - 694) < 6:
                target = c
            if name == "Cyperaceae" and abs(c["start"] - 906) < 6:
                target = c
        if target is None:
            print(f"    {name}: 未找到对应列 -> SKIP")
            continue
        ticks = [{"px": float(px), "value": float(v)} for px, v in printed]
        # 产品要求恰好两个端点 -> 用最小二乘取两端（这里必须如实说明是线性外推的两点）
        ticks2 = [ticks[0], ticks[-1]]
        try:
            r = s.calibrate_column_xticks(
                target["id"], ticks=ticks2, unit="%", plot_type="area"
            )
            print(
                f"    {name} ({target['id']}): OK 两点={ticks2} -> "
                f"x_ticks={r.get('x_ticks') or r.get('column', {}).get('x_ticks')}"
            )
            calibrated += 1
        except Exception as exc:
            print(f"    {name} ({target['id']}): FAIL {type(exc).__name__}: {exc}")
    print(f"    已标定列数 = {calibrated} / 图版可标定列数 = {len(PRINTED_TICKS)}"
          f" / 检出列数 = {len(cols)}")

    # ---- Step 9 Y 轴标定（深度 0..787cm @ 232..862px，来自图版左轴真印数字） ----
    ax = s.calibrate_axes(
        y_marks=[{"pixel": 232.0, "val": 0.0}, {"pixel": 862.0, "val": 787.0}],
        unit="cm",
    )
    print("\n[9] calibrate_axes")
    U.jprint({k: v for k, v in ax.items() if k in ("y_scale", "is_calibrated", "unit", "success")})

    # ---- Step 10 数字化 ----
    print("\n[10] digitize")
    ok = 0
    for i, c in enumerate(cols):
        try:
            r = s.digitize(i)
            n = len((r.get("points") or []))
            if n:
                ok += 1
            print(f"    col{i + 1:02d} {c['id']:16s} points={n}")
        except Exception as exc:
            print(f"    col{i + 1:02d} {c['id']:16s} FAIL {type(exc).__name__}: {exc}")
    print(f"    成功数字化 {ok} / {len(cols)} 列")

    # ---- Step 11 深度网格 ----
    grid = s.apply_depth_grid(start_depth=0.0, end_depth=787.0, step=5.0)
    print("\n[11] apply_depth_grid")
    U.jprint({k: v for k, v in grid.items() if k in ("count", "rows", "start", "end", "step", "depths")})

    # ---- Step 12 层位 ----
    depths = [float(i) * 5.0 for i in range(158)]  # 0..785 step 5
    ss = s.samples_set([{"depth": d, "label": f"{d:g}cm"} for d in depths])
    print("\n[12] samples_set")
    U.jprint({k: v for k, v in ss.items() if not isinstance(v, (list, dict))})

    # ---- Step 13 导出 ----
    os.makedirs(OUT_DIR, exist_ok=True)
    csv_path = os.path.join(OUT_DIR, f"han2026_{mode}.csv")
    ed = s.export_data(format="csv", output_path=csv_path)
    print("\n[13] export_data(csv)")
    U.jprint({k: v for k, v in ed.items() if not isinstance(v, (list, dict))})
    if os.path.exists(csv_path):
        with open(csv_path, encoding="utf-8") as fh:
            lines = fh.readlines()
        print(f"    行数(含表头)={len(lines)}  表头={lines[0].strip()[:200]}")

    tar_path = os.path.join(OUT_DIR, f"han2026_{mode}.tar")
    tp = s.export_multi_tar(output_path=tar_path)
    print("\n[14] export_multi_tar")
    U.jprint({k: v for k, v in tp.items() if not isinstance(v, (list, dict))})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
