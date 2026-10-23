# -*- coding: utf-8 -*-
"""独立复核 B：编造标度是否真的改变导出的科学数值？

这是 F-01 定级的关键。静态审计只证明"写进了后端"，journey-log F-1 只证明
"8/28 列被标定"。二者都没有直接回答：**这两个编造的读数（0 与 20）有没有
把 CSV 里的数改成别的值？**

做法：两个**完全平行**的会话，唯一差别是"有没有走前端那 8 次自动标定"，
然后比对同一个导出入口产出的 CSV。

运行：
    pixi run python scripts/verify_zero_flow/v02_export_delta.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, new_session  # noqa: E402

CFG = isolate_config()


def replicate_inspector_expression(col_payload: dict, ticks: list) -> tuple:
    """逐字复刻 InspectorBridge.ts:360-363 的核心取值（与 v01 同一份实现）。"""
    xt = col_payload.get("x_ticks")
    val1 = xt[0]["value"] if xt else None
    if val1 is None:
        val1 = 0
    val2 = xt[1]["value"] if xt and len(xt) > 1 else None
    if val2 is None:
        val2 = col_payload.get("maxPercent")
    if val2 is None:
        val2 = (len(ticks) - 1) * 10 if len(ticks) > 2 else 20
    p1 = col_payload.get("startX", col_payload.get("start"))
    p2 = ticks[-1] if ticks else None
    return p1, val1, p2, val2


def build(apply_fabrication: bool):
    s = hoya(new_session())
    roi = s.rois[0]["id"]
    if apply_fabrication:
        res = s.detect_xticks_rpc(roi_id=roi)
        from straditize_core.rpc_methods.system import register  # noqa: F401
        from straditize_core.rpc_server import create_rpc_dispatcher

        _d = create_rpc_dispatcher(s)
        payload = _d._methods["straditize.getDiagramData"]()
        cols = payload["columns"]
        n = 0
        for item in res.get("per_column") or []:
            idx = item["column_index"]
            ticks = item.get("ticks") or []
            if len(ticks) < 2:
                continue
            p1, val1, p2, val2 = replicate_inspector_expression(cols[idx], ticks)
            if p2 is None:
                continue
            s.calibrate_column_xticks(
                idx, [{"px": p1, "value": val1}, {"px": p2, "value": val2}], "%"
            )
            n += 1
        return s, n
    return s, 0


def csv_matrix(s):
    exp = s.export_data(format="csv")
    content = exp.get("csv") or exp.get("csv_content") or ""
    rows = [ln.split(",") for ln in content.splitlines() if ln.strip()]
    return rows[0], rows[1:]


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("B1. 会话 A：不做任何标定（诚实 legacy 兜底）")
    a, na = build(False)
    hdr_a, rows_a = csv_matrix(a)
    print(f"  自动标定次数 = {na}   csv 行数（含表头）= {len(rows_a) + 1}")
    print(f"  已标定列 = {sum(1 for c in a.columns if c.get('x_ticks'))} / {len(a.columns)}")

    banner("B2. 会话 B：复刻前端自动标定 8 列后导出")
    b, nb = build(True)
    hdr_b, rows_b = csv_matrix(b)
    print(f"  自动标定次数 = {nb}   csv 行数（含表头）= {len(rows_b) + 1}")
    print(f"  已标定列 = {sum(1 for c in b.columns if c.get('x_ticks'))} / {len(b.columns)}")

    banner("B3. 两套 CSV 逐格比对（同一张图、同一个 ROI、同一份几何）")
    assert hdr_a == hdr_b, "表头应当相同"
    print(f"  表头一致: {hdr_a == hdr_b}")
    print(f"  数据行数: A={len(rows_a)}  B={len(rows_b)}")

    n = min(len(rows_a), len(rows_b))
    diff_cells = 0
    diff_rows = 0
    max_delta = 0.0
    max_delta_where = ""
    per_col = {}
    for r in range(n):
        ra, rb = rows_a[r], rows_b[r]
        if len(ra) != len(rb):
            continue
        row_diff = False
        for c in range(len(ra)):
            try:
                va, vb = float(ra[c]), float(rb[c])
            except (TypeError, ValueError):
                continue
            d = abs(vb - va)
            if d > 1e-9:
                diff_cells += 1
                row_diff = True
                per_col[hdr_a[c]] = per_col.get(hdr_a[c], 0) + 1
                if d > max_delta:
                    max_delta = d
                    max_delta_where = (
                        f"行{r} 列{hdr_a[c]}  legacy={va}  编造后={vb}  Δ={d:.4f}"
                    )
        if row_diff:
            diff_rows += 1

    print(f"  有差异的行 = {diff_rows} / {n}")
    print(f"  有差异的格 = {diff_cells}")
    print(f"  受影响列（列名 -> 差异格数）= {per_col}")
    print(f"  最大绝对差 = {max_delta:.4f}")
    print(f"    {max_delta_where}")

    banner("B4. 结论判定")
    if diff_cells > 0:
        print("  >>> 编造读数**改变了导出 CSV 的科学数值**（不是只改内存字段）。")
        print("  >>> 因此它污染的是最终交付给用户的科研数据。")
    else:
        print("  >>> 编造读数**未**改变导出 CSV 数值（可能被后续环节覆盖或未被读取）。")


if __name__ == "__main__":
    main()
