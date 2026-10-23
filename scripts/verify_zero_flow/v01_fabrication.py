# -*- coding: utf-8 -*-
"""独立复核 A：F-01 / journey F-1 的"编造读数"链。

我做三件事，全部用**产品自己的后端 API**，不使用任何队友脚本：

A1. 复刻 `InspectorBridge.ts:355-369` 的取值表达式（纯 Python 复刻，输入取自后端
    真实 payload），证明 val1/val2 的取值来源。
A2. 用复刻出的 (px, value) 真的调用 `calibrate_column_xticks`，然后走导出同一条
    解析入口 `resolve_column_scale`，量化"编造值 vs 用户本应读到的值"的偏差。
A3. 回答 journey-log F-1 的核心数字：28 列里到底几列能拿到 >=2 个齿。

运行：
    pixi run python scripts/verify_zero_flow/v01_fabrication.py
"""
from __future__ import annotations

from vcommon import (  # noqa: E402
    REPO, banner, hoya, isolate_config, make_dispatcher, new_session, rpc_call,
)

CFG = isolate_config()


def replicate_inspector_expression(col: dict, ticks: list) -> tuple:
    """逐字复刻 frontend/src/services/InspectorBridge.ts:360-363。

    ```ts
    const val1 = col.x_ticks?.[0]?.value ?? 0;
    const val2 =
      col.x_ticks?.[1]?.value ??
      col.maxPercent ??
      (item.ticks.length > 2 ? (item.ticks.length - 1) * 10 : 20);
    ```
    `col.maxPercent` 由后端 `straditize_core/rpc_methods/system.py:160`
    `max(scale.val0, scale.val1)` 提供（payload 字段），这里用同式计算。
    """
    xt = col.get("x_ticks")
    val1 = (xt[0]["value"] if xt and len(xt) > 0 else None)
    if val1 is None:
        val1 = 0  # `?? 0`

    val2 = (xt[1]["value"] if xt and len(xt) > 1 else None)
    if val2 is None:
        val2 = col.get("_maxPercent")
    if val2 is None:
        val2 = (len(ticks) - 1) * 10 if len(ticks) > 2 else 20  # 三元兜底

    p1 = col.get("startX", col.get("start"))
    p2 = ticks[-1] if ticks else None  # `item.ticks[item.ticks.length - 1]`
    return p1, val1, p2, val2


def main() -> None:
    print(f"[env] config isolated at: {CFG}")
    print(f"[env] repo: {REPO}")

    s = hoya(new_session())
    roi = s.rois[0]["id"]

    # ---- 后端真实 payload（system.py:128-160 同源） ----
    from straditize_core.session_parts.xscale import resolve_column_scale

    _d, M = make_dispatcher(s)
    payload = rpc_call(M, "straditize.getDiagramData")
    cols = payload["columns"]
    banner("A0. 后端 payload：列字段（未经用户任何输入）")
    for c in cols[:3]:
        print(
            f"  col_index={c['col_index']} start={c.get('start')} end={c.get('end')} "
            f"tickEndX={c.get('tickEndX')} startValue={c.get('startValue')} "
            f"tickValue={c.get('tickValue')} maxPercent={c.get('maxPercent')} "
            f"x_ticks={c.get('x_ticks')}"
        )

    # ---- A1/A3: 检测齿 ----
    res = s.detect_xticks_rpc(roi_id=roi)
    per = res.get("per_column") or []
    banner("A1. detect_xticks_rpc：每列齿数（这是 journey F-1 的核心数字）")
    print(f"  后端总列数 = {len(s.columns)}   band = {res.get('band')}")
    with2 = [p for p in per if len(p.get("ticks") or []) >= 2]
    with1 = [p for p in per if len(p.get("ticks") or []) == 1]
    with0 = [p for p in per if len(p.get("ticks") or []) == 0]
    print(f"  per_column 条目数 = {len(per)}")
    print(f"  >=2 齿（可标定） = {len(with2)}   索引 {[p['column_index'] for p in with2]}")
    print(f"  ==1 齿           = {len(with1)}   索引 {[p['column_index'] for p in with1]}")
    print(f"  ==0 齿           = {len(with0)}   索引 {[p['column_index'] for p in with0]}")

    # ---- A2: 复刻前端表达式 + 真的写进后端 ----
    banner("A2. 复刻 InspectorBridge 取值 -> 真实 calibrate -> 导出同源读数对比")
    print(
        f"{'col':>4} {'p1':>1}{'':0}{'px0':>7} {'px1':>7} {'val1':>6} {'val2':>6} "
        f"{'px/unit':>8}  {'写入?':>5}"
    )
    written = []
    for item in per:
        idx = item["column_index"]
        ticks = item.get("ticks") or []
        col = cols[idx]
        col["_maxPercent"] = col.get("maxPercent")
        if len(ticks) < 2:
            continue
        p1, val1, p2, val2 = replicate_inspector_expression(col, ticks)
        if p2 is None:
            continue
        span_px = abs(p2 - p1)
        span_val = abs(val2 - val1)
        ppu = (span_px / span_val) if span_val else 0.0
        # 真的写进后端 —— 与前端 `rpcClient.calibrateColumnXTicks` 同一 API
        s.calibrate_column_xticks(
            idx,
            [{"px": p1, "value": val1}, {"px": p2, "value": val2}],
            "%",
        )
        written.append(idx)
        print(
            f"{idx:>4} {p1:>7} {p2:>7} {val1:>6} {val2:>6} {ppu:>8.2f}   OK"
        )

    banner("A2.1 写入后的后端真值（所有人从未填过任何输入框）")
    calibrated = [c for c in s.columns if c.get("x_ticks")]
    print(f"  已标定列数 = {len(calibrated)} / {len(s.columns)}")
    for c in calibrated:
        xt = c["x_ticks"]
        print(
            f"    {c['id']}  px={xt[0]['px']}..{xt[1]['px']}  "
            f"value={xt[0]['value']}..{xt[1]['value']}"
        )

    ppu_list = []
    for c in calibrated:
        xt = c["x_ticks"]
        ppu_list.append(abs(xt[1]["px"] - xt[0]["px"]) / max(abs(xt[1]["value"] - xt[0]["value"]), 1e-9))
    if ppu_list:
        print(
            f"  px/1% 分布: min={min(ppu_list):.2f} max={max(ppu_list):.2f} "
            f"倍数={max(ppu_list) / max(min(ppu_list), 1e-9):.2f}x"
        )

    # ---- A2.2: 导出同源读数 ----
    banner("A2.2 导出解析入口 resolve_column_scale 给出的标度（这些数会进 CSV）")
    for c in s.columns[:4]:
        sc = resolve_column_scale(s, c, c["col_index"])
        print(
            f"  {c['id']}: source={sc.source} calibrated={sc.calibrated} "
            f"val0={sc.val0:.2f} val1={sc.val1:.2f} "
            f"px0={sc.abs_px0} px1={sc.abs_px1}"
        )

    # ---- A2.3: 量化：编造值 vs "用户本应读到的值" ----
    banner("A2.3 量化：编造 0..20 标度 覆盖掉 legacy 标度后，派生的「满量程像素宽度」")
    print("  说明：px/1% 若物理一致，同一张图上各列应接近同一值。真实标度必须来自人读刻度。")
    print("  下面把 0..20 的编造标度与 legacy(0..20, tickEndX=start+65%列宽) 的差异摊开：")
    for c in s.columns:
        xt = c.get("x_ticks")
        if not xt:
            continue
        fab_px = abs(xt[1]["px"] - xt[0]["px"])
        leg_px = abs(float(c.get("tickEndX", 0)) - float(c.get("start", 0)))
        print(
            f"  {c['id']}: 编造跨度={fab_px:.0f}px  legacy 跨度={leg_px:.0f}px  "
            f"差={fab_px - leg_px:+.0f}px  "
            f"(编造把该列 0..20 的像素区间改成了{'更长' if fab_px > leg_px else '更短'}的一段)"
        )

    banner("A2.4 端到端：导出 CSV 里这些列的数值")
    exp = s.export_data(format="csv") if hasattr(s, "export_data") else None
    if isinstance(exp, dict):
        content = exp.get("content") or exp.get("csv") or ""
        lines = content.splitlines()
        print(f"  csv 行数 = {len(lines)}  表头 = {lines[0] if lines else '(empty)'}")
        if len(lines) > 1:
            print(f"  第 1 数据行 = {lines[1][:160]}")
    else:
        print(f"  export_data 返回类型 {type(exp)}（不适用于本复核）")


if __name__ == "__main__":
    main()
