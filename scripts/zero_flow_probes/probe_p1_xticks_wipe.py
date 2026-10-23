# -*- coding: utf-8 -*-
"""探针 P1：重新分列是否静默抹掉列的 x_ticks，以及污染是否外溢到导出/QA。

做法：直调 RPC 做**因果隔离**（只发 core.detectColumns），每一步都把
`straditize.getDiagramData` 的后端真值打印出来当证据。

    pixi run python scripts/zero_flow_probes/probe_p1_xticks_wipe.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

# 与 support/serve_e2e_backend.py 一致的 hoya 边界（真实用户在内置范例上看到的同一张图）
HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def col_state(r: Rpc) -> list[dict]:
    data = r.call("straditize.getDiagramData")
    return [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "col_index": c.get("col_index"),
            "startX": c.get("startX"),
            "endX": c.get("endX"),
            "tickEndX": c.get("tickEndX"),
            "x_ticks": c.get("x_ticks"),
            "x_group_id": c.get("x_group_id"),
            "x_values": c.get("x_values"),
            "unit": c.get("unit"),
            "plot_type": c.get("plot_type"),
        }
        for c in data.get("columns", [])
    ]


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)
    log = {}

    print("== 0. e2e.reset（零状态） ==")
    print(r.call("e2e.reset"))

    print("\n== 1. 载入 hoya（等价用户上传/选范例） ==")
    loaded = r.call("core.loadImage", {"sample_key": "hoya"})
    print(json.dumps({k: loaded.get(k) for k in ("width", "height", "imageWidth", "imageHeight", "roi")}, ensure_ascii=False))

    print("\n== 2. 第一次分列（用户点 Step5 / 或确认 ROI） ==")
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    after_first = col_state(r)
    print(f"列数={len(after_first)}")
    for c in after_first[:4]:
        print(" ", json.dumps(c, ensure_ascii=False))
    log["after_first_detect"] = after_first

    if not after_first:
        print("!! 第一次分列没产出列，后续标定无从谈起")
        return

    # 步骤 6：用后端自己的列几何算合法刻度像素（与 XTicksPanel 的 expectedPx 同规则）
    c0 = after_first[0]
    p1 = c0["startX"]
    p2 = c0["tickEndX"] if (c0["tickEndX"] and c0["tickEndX"] > p1) else p1 + 80
    print(f"\n== 3. column.calibrateXTicks col0: px=({p1},{p2}) value=(0,40) ==")
    cal = r.call(
        "column.calibrateXTicks",
        {"col_index": 0, "ticks": [{"px": p1, "value": 0}, {"px": p2, "value": 40}]},
    )
    print(json.dumps({"col_index": cal.get("col_index"), "x_ticks": cal.get("x_ticks")}, ensure_ascii=False))
    after_cal = col_state(r)
    print("标定后 col0.x_ticks =", json.dumps(after_cal[0]["x_ticks"], ensure_ascii=False))
    log["after_calibrate"] = after_cal

    print("\n== 3b. 此时导出/QA 读到的标度（resolve_column_scale 链） ==")
    cols_dump = r.call("straditize.getDiagramData").get("columns", [])
    print("  col0 payload x_ticks:", json.dumps(cols_dump[0].get("x_ticks"), ensure_ascii=False))

    print("\n== 4. 再次分列（同一 ROI，同样的 bounds —— 用户回到 Step5 或重进步骤 5 触发） ==")
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    after_second = col_state(r)
    print(f"列数={len(after_second)}")
    for c in after_second[:4]:
        print(" ", json.dumps(c, ensure_ascii=False))
    log["after_second_detect"] = after_second

    wiped = (after_cal[0]["x_ticks"] is not None) and (after_second[0]["x_ticks"] is None)
    print("\n>>> 判定（同 bounds 重分列）：x_ticks 被抹？", "是（缺陷复现）" if wiped else "否")
    if not wiped:
        print("    注意：本轮用的是**完全相同的 bounds**，列边界守卫必然通过，所以不会丢。")
        print("    「重新分列会抹掉 x_ticks」只在 ROI 变化超过阈值时成立——")
        print("    阈值实测见 probe_f3_xticks_threshold.py（列边界移动 >10px 即触发）。")
        print("    只跑本脚本就断言「无缺陷」会得出与注释相反的错误结论。")

    # ---- 污染程度：导出与 QA 读到的数值是否变了 ----
    print("\n== 5. 污染程度：重新分列前后 export.getReadiness / export 数值 -=")
    try:
        readiness = r.call("export.getReadiness")
        print("export.getReadiness keys:", list(readiness.keys())[:20])
        print(json.dumps(readiness, ensure_ascii=False)[:1500])
    except Exception as exc:  # noqa: BLE001
        print("export.getReadiness 失败：", exc)

    print("\n> 说明：本节只做因果隔离；用户可见路径见 probe_f1_roi_rollback.cjs")


if __name__ == "__main__":
    main()
