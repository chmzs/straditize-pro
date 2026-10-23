# -*- coding: utf-8 -*-
"""探针 P5：自动存档草稿「恢复」只写前端镜像、不回灌后端（用户可见的分叉）。

`frontend/src/main.ts:699-731` 的 draft-recovery banner：点【恢复】只做
    canvasComponent.loadNewDiagram(draft.data);
    history.reset(draft.data.columns, draft.data.activeTaxaId);
    sidebar/inspector 刷新
——**没有任何** RPC。而后端会话此时可能已经不含这些列（例如另一个标签页点了
【重置】、或后端重启过）。

本探针不依赖 UI 复现完整链路，而是用**后端真值**直接证明分叉后果：
  1. 建一个"有分列的会话"（等价用户关页前的状态）。
  2. 后端 `project.new`（等价：另一个标签页点了【重置】，或后端进程重启）。
  3. 此时若用户点草稿【恢复】，前端会显示 N 列；而后端 `getDiagramData` 是空。
  4. 紧接着用户做任何真实动作（步骤 5 重分列 / 导出）会发生什么。

    pixi run python scripts/zero_flow_probes/probe_p5_draft.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)
    print("① 建立「有列」的会话（等价用户关页前的状态）")
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d1 = r.call("straditize.getDiagramData")
    print(f"   后端 columns = {len(d1['columns'])} | 第 1 列 = {d1['columns'][0]['id']}")

    print("\n② 另一个标签页点【重置】(等价：后端 project.new)")
    r.call("project.new", {})
    d2 = r.call("straditize.getDiagramData")
    print(f"   后端 columns = {len(d2['columns'])} | rois = {len(d2.get('rois') or [])}")
    print("   —— 前端镜像此刻仍有", len(d1["columns"]), "列（草稿里保存的那份）")

    print("\n③ 用户点草稿【恢复】：前端只调用 loadNewDiagram，不发任何 RPC")
    print("   故后端读到的仍是：")
    d3 = r.call("straditize.getDiagramData")
    print(f"   columns = {len(d3['columns'])} | rois = {len(d3.get('rois') or [])} | imageSrc = {d3.get('imageSrc')}")

    print("\n④ 用户在'看起来有 28 列'的界面上继续动作，逐个看后端反应")
    probes = [
        ("column.calibrateXTicks", {"col_index": 0, "ticks": [{"px": 322, "value": 0}, {"px": 402, "value": 40}]}),
        ("export.getReadiness", {}),
        ("export.csv", {}),
        ("qa.summarize", {}),
    ]
    for method, params in probes:
        ok, res = r.try_call(method, params)
        if ok:
            brief = json.dumps(res, ensure_ascii=False)
            print(f"   {method} -> ok  {brief[:220]}")
        else:
            print(f"   {method} -> FAIL  {res[:220]}")

    print("\n⑤ 后端权威状态（用户真正会拿到的东西）")
    d4 = r.call("straditize.getDiagramData")
    print(f"   columns = {len(d4['columns'])} | rois = {len(d4.get('rois') or [])}")


if __name__ == "__main__":
    main()
