# -*- coding: utf-8 -*-
"""探针 F-3：重新分列抹掉 `x_ticks` 的**触发阈值**（本缺陷的价值全在阈值）。

做法：标定 col0 → 把 ROI 左右各内缩 `shift` px → 重分列 → 读回 `x_ticks`。
同时打印列边界与守卫区间 `[min(start,end)-10, max(start,end)+10]`，
让"为什么这一档丢、那一档留"可复算。

    pixi run python scripts/zero_flow_probes/probe_f3_xticks_threshold.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

BASE_X = [315, 1946]
BASE_Y = [511, 1311]


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)

    print("基准：hoya，ROI = [315,1946] x [511,1311]；标定 col0 的 x_ticks")
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": BASE_X, "data_ylim": BASE_Y})
    c0 = r.call("straditize.getDiagramData")["columns"][0]
    px1, px2 = c0["startX"], c0["tickEndX"]
    print(f"  col0: startX={px1} endX={c0['endX']} tickEndX={px2}")
    print()

    header = f"{'shift':>5} | {'列数':>4} | {'startX':>7} | {'endX':>6} | {'守卫区间':>12} | x_ticks"
    print(header)
    print("-" * len(header))

    rows = []
    for shift in (0, 5, 10, 15, 20, 25, 40):
        r.call("e2e.reset")
        r.call("core.loadImage", {"sample_key": "hoya"})
        r.call("core.detectColumns", {"data_xlim": BASE_X, "data_ylim": BASE_Y})
        r.call(
            "column.calibrateXTicks",
            {"col_index": 0, "ticks": [{"px": px1, "value": 0}, {"px": px2, "value": 40}]},
        )
        marked = r.call("straditize.getDiagramData")["columns"][0]["x_ticks"]
        assert marked is not None, "前置失败：标定没写进后端"

        r.call(
            "core.detectColumns",
            {
                "data_xlim": [BASE_X[0] + shift, BASE_X[1] - shift],
                "data_ylim": BASE_Y,
            },
        )
        d = r.call("straditize.getDiagramData")
        col = d["columns"][0]
        lo = min(col["startX"], col["endX"]) - 10
        hi = max(col["startX"], col["endX"]) + 10
        kept = col["x_ticks"] is not None
        rows.append({"shift": shift, "kept": kept})
        print(
            f"{shift:>5} | {len(d['columns']):>4} | {col['startX']:>7.1f} | {col['endX']:>6.1f} | "
            f"{f'[{lo:.0f},{hi:.0f}]':>12} | {json.dumps(col['x_ticks'])}"
        )

    print()
    lost = [x["shift"] for x in rows if not x["kept"]]
    kept = [x["shift"] for x in rows if x["kept"]]
    print(f">>> 保留的 shift = {kept}")
    print(f">>> 被静默清空的 shift = {lost}")
    if kept and lost:
        print(f">>> 阈值落在 {(max(kept), min(lost))} 区间：小于阈值保留、大于等于阈值静默清空。")
        print(">>> 用户无法预知自己落在哪一侧 —— 这正是缺陷的判别特征。")


if __name__ == "__main__":
    main()
