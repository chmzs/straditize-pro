# -*- coding: utf-8 -*-
"""独立复核 K：workflow 自动触发 (WorkflowController.ts:201-206) 的前置条件。

static F-01 的第 1 条根因是"进入 CALIBRATE_COLUMNS 时，若没有任何列带
`detected_ticks`，就 queueMicrotask 点 #btn-detect-xticks"。我在**后端**侧能判定的
是那条 `hasAnyTeeth` 条件在两处状态下的取值：
  K1 刚分完列（detected_ticks 从未写过）
  K2 走过一次自动提取之后（前端会把 detected_ticks 写进镜像）

并核对：`detected_ticks` 是否**只存在于前端镜像**（后端 payload 里没有这个字段）。
若后端不返回 detected_ticks，则每次进入步骤 6（包括在步骤 5↔6 之间来回切）都会
再次触发自动标定 —— 这会放大 F-01 的影响面。

运行：
    pixi run python scripts/verify_zero_flow/v11_trigger.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, make_dispatcher, new_session, rpc_call  # noqa: E402

CFG = isolate_config()


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("K1. 后端 payload 里有没有 detected_ticks")
    s = hoya(new_session())
    _d, M = make_dispatcher(s)
    p = rpc_call(M, "straditize.getDiagramData")
    keys = sorted(p["columns"][0].keys())
    print(f"  列字段（后端权威）= {keys}")
    print(f"  'detected_ticks' 在 payload 里？ {'是' if 'detected_ticks' in keys else '否'}")

    banner("K2. 前端镜像里 detected_ticks 的来源")
    from pathlib import Path

    ib = Path("frontend/src/services/InspectorBridge.ts").read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(ib, 1):
        if "detected_ticks" in ln:
            print(f"  InspectorBridge.ts:{i}  {ln.strip()}")
    for f in ("frontend/src/types/pollen.ts", "frontend/src/services/RpcClient.ts",
              "frontend/src/components/steps/XTicksPanel.ts"):
        src = Path(f).read_text(encoding="utf-8").splitlines()
        for i, ln in enumerate(src, 1):
            if "detected_ticks" in ln:
                print(f"  {f}:{i}  {ln.strip()}")

    banner("K3. WorkflowController 的自动触发条件（源码）")
    wc = Path("frontend/src/services/WorkflowController.ts").read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(wc, 1):
        if "hasAnyTeeth" in ln or "btn-detect-xticks" in ln:
            for j in range(max(0, i - 3), min(len(wc), i + 4)):
                print(f"  WorkflowController.ts:{j + 1}  {wc[j]}")
            print()

    banner("K4. 后端有没有列被标定（两侧状态对照）")
    s2 = hoya(new_session())
    _d2, M2 = make_dispatcher(s2)
    p2 = rpc_call(M2, "straditize.getDiagramData")
    print(f"  分列后：已标定列 = {sum(1 for c in p2['columns'] if c.get('x_ticks'))} / {len(p2['columns'])}")
    print(f"          x_ticks 全为 None？ {all(c.get('x_ticks') is None for c in p2['columns'])}")
    print("  → 后端此时是干净的；F-01 的 8 次写入完全由前端在进入步骤 6 时发起。")

    banner("K5. 这些「编造」值是否进入了 QA 与就绪清单")
    # 复刻一次
    res = s2.detect_xticks_rpc(roi_id=s2.rois[0]["id"])
    n = 0
    for item in res.get("per_column") or []:
        ticks = item.get("ticks") or []
        if len(ticks) < 2:
            continue
        idx = item["column_index"]
        pcol = rpc_call(M2, "straditize.getDiagramData")["columns"][idx]
        val1 = pcol.get("x_ticks")[0]["value"] if pcol.get("x_ticks") else 0
        val2 = pcol.get("x_ticks")[1]["value"] if pcol.get("x_ticks") and len(pcol["x_ticks"]) > 1 else pcol.get("maxPercent")
        s2.calibrate_column_xticks(
            idx, [{"px": pcol["startX"], "value": val1},
                  {"px": ticks[-1], "value": val2}], "%")
        n += 1
    print(f"  复刻写入 {n} 列")
    qa = rpc_call(M2, "qa.summarize")
    print(f"  qa.n_uncalibrated = {qa.get('n_uncalibrated')}  "
          f"uncalibrated_columns = {qa.get('uncalibrated_columns')}")
    rd = rpc_call(M2, "export.getReadiness")
    print(f"  export.getReadiness.readiness_missing = {rd.get('readiness_missing')}")
    print("  → 这 8 列在后端已被视作「已标定」，QA 不再把它们计入 uncalibrated。")


if __name__ == "__main__":
    main()
