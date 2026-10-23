# -*- coding: utf-8 -*-
"""探针 P7：从零走完到「标定 X 刻度」后，`project.save` → `project.load` 往返是否保真。

`docs/ARCHITECTURE.md` §6.0 第 3 条声明："`project_save` 与 `project_load` (v3.0.0)
完整承载多 ROI、各 ROI 内列组与每列 `roi_id` / `x_group_id` / `x_values`"。
§8.4 的判据更进一步：任何"已持久化"的声明，都要让数据**穿过系统自己的重建路径**
再断言一次。本探针就是那条重建路径。

    pixi run python scripts/zero_flow_probes/probe_p7_roundtrip.py 22940
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def snapshot(r: Rpc, cols=(0, 1)) -> list[dict]:
    d = r.call("straditize.getDiagramData")
    out = []
    for i in cols:
        if i >= len(d.get("columns") or []):
            continue
        c = d["columns"][i]
        out.append(
            {
                "col_index": c.get("col_index"),
                "name": c.get("name"),
                "x_ticks": c.get("x_ticks"),
                "x_group_id": c.get("x_group_id"),
                "x_values": c.get("x_values"),
                "unit": c.get("unit"),
                "plot_type": c.get("plot_type"),
                "startX": c.get("startX"),
                "endX": c.get("endX"),
            }
        )
    return out


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)

    print("① 从零建立会话：载图 → 分列 → 标定两列 X 刻度 → 改单位/形态")
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    cols = d["columns"]
    print(f"   分出 {len(cols)} 列")

    for idx, (v0, v1) in ((0, (0, 40)), (1, (0, 55))):
        c = cols[idx]
        px1 = c["startX"]
        px2 = c["tickEndX"] if c["tickEndX"] > px1 else px1 + 60
        r.call(
            "column.calibrateXTicks",
            {
                "col_index": idx,
                "ticks": [{"px": px1, "value": v0}, {"px": px2, "value": v1}],
            },
        )
    # 额外改一项非默认属性：列名 + 单位（走 column.update，用户真实可做的动作）
    upd = r.try_call("column.update", {"col_index": 0, "updates": {"name": "Pinus"}})
    print("   column.update(name=Pinus) ->", "ok" if upd[0] else upd[1])

    before = snapshot(r)
    print("   保存前（后端真值）：")
    for x in before:
        print("    ", json.dumps(x, ensure_ascii=False))

    print("\n② project.save(json, output_path=…) → 读回文件里的同名列")
    tmp = Path(tempfile.mkdtemp(prefix="probe_p7_"))
    out_path = tmp / "proj.json"
    saved = r.call("project.save", {"format": "json", "output_path": str(out_path)})
    print("   save ->", json.dumps(saved, ensure_ascii=False))
    raw = json.loads(out_path.read_text(encoding="utf-8"))
    file_cols = raw.get("columns") or []
    for i in (0, 1):
        if i < len(file_cols):
            c = file_cols[i]
            print(
                f"   文件列{i}: name={c.get('name')!r} x_ticks={json.dumps(c.get('x_ticks'), ensure_ascii=False)}"
                f" x_group_id={c.get('x_group_id')!r} x_values={c.get('x_values')}"
            )

    print("\n③ project.load(该文件) → 再读后端真值（系统自身的重建路径）")
    r.call("project.load", {"project_data": str(out_path)})
    after = snapshot(r)
    print("   载回后（后端真值）：")
    for x in after:
        print("    ", json.dumps(x, ensure_ascii=False))

    print("\n④ 逐字段对账")
    for i, (b, a) in enumerate(zip(before, after)):
        diffs = {k: (b.get(k), a.get(k)) for k in b if b.get(k) != a.get(k)}
        if diffs:
            print(f"   ✗ 列{i} 字段漂移：" + json.dumps(diffs, ensure_ascii=False))
        else:
            print(f"   ✓ 列{i} 逐字段一致")

    print("\n⑤ 漂移的后果：导出/QA 读到的标度是否跟着变")
    rd = r.call("export.getReadiness")
    print("   export.getReadiness =", json.dumps(rd, ensure_ascii=False))
    ok, csv = r.try_call("export.csv", {})
    if ok:
        head = str(csv).splitlines()[:3]
        print("   export.csv 前三行 =", json.dumps(head, ensure_ascii=False))
    else:
        print("   export.csv ->", csv[:200])


if __name__ == "__main__":
    main()
