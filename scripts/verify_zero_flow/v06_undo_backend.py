# -*- coding: utf-8 -*-
"""独立复核 F：static F-04（Ctrl+Z 把前端列清成 0 列）与 F-05（撤销不覆盖 x_ticks）。

F-04 的前端侧需要真实浏览器，我在 v06a_undo_browser.mjs 里做；
本脚本只做**后端一半**，并核对前端源码里的 `prev.columns = []` 传递链。

关键判据：后端 `history_undo()` 返回的 `columns` 到底是不是空数组？
- static F-04 说"前端清成 0 列，后端仍是 29 列"——这是前端 `HistoryManager` 的
  基线快照 issue，**不是**后端 `history_undo`。
- 必须分清这两条不同的撤销实现（前端 `HistoryManager` vs 后端 `undo_stack`）。

运行：
    pixi run python scripts/verify_zero_flow/v06_undo_backend.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, new_session  # noqa: E402

CFG = isolate_config()


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("F1. 后端撤销栈：标定 X 刻度后 history_undo 能否回退？")
    s = hoya(new_session())
    c = s.columns[0]
    ticks = [
        {"px": float(c["start"]), "value": 0.0},
        {"px": float(c["tickEndX"]), "value": 40.0},
    ]
    s.calibrate_column_xticks(0, ticks, "%")
    print(f"  标定后 x_ticks = {s.columns[0]['x_ticks']}")
    print(f"  undo_stack 深度 = {len(s.undo_stack)}")
    res = s.history_undo()
    print(f"  history_undo() -> {res}")
    print(f"  撤销后 x_ticks = {s.columns[0].get('x_ticks')}")
    print(f"  撤销后 undo_stack 深度 = {len(s.undo_stack)}")
    stayed = s.columns[0].get("x_ticks") == ticks
    print(f"  >>> 状态未回退？ {'是（缺陷 F-05）' if stayed else '否'}")

    banner("F2. 清空 x_ticks 后撤销")
    s2 = hoya(new_session())
    c2 = s2.columns[0]
    s2.calibrate_column_xticks(0, [{"px": float(c2["start"]), "value": 0.0},
                                   {"px": float(c2["tickEndX"]), "value": 40.0}], "%")
    print(f"  标定后 x_ticks = {s2.columns[0]['x_ticks']}")
    s2.clear_column_xticks(0)
    print(f"  清空后 x_ticks = {s2.columns[0].get('x_ticks')}  栈深={len(s2.undo_stack)}")
    s2.history_undo()
    print(f"  undo 后 x_ticks = {s2.columns[0].get('x_ticks')}  栈深={len(s2.undo_stack)}")
    print(f"  >>> 清空可撤销？ {'否（缺陷）' if s2.columns[0].get('x_ticks') is None else '是'}")

    banner("F3. 后端 undo 快照里到底有没有 x_ticks")
    s3 = hoya(new_session())
    s3._record_history("probe-before")
    snap = s3.undo_stack[-1]
    print(f"  快照键 = {sorted(snap.keys())}")
    print(f"  快照 columns[0] 键 = {sorted(snap['columns'][0].keys())}")
    print(f"  快照 columns[0].x_ticks = {snap['columns'][0].get('x_ticks')}")

    banner("F4. 前端撤销链（源码核对）")
    from pathlib import Path

    hm = Path("frontend/src/core/HistoryManager.ts").read_text(encoding="utf-8").splitlines()
    print("  HistoryManager.reset 实现：")
    start = next((i for i, ln in enumerate(hm, 1) if "reset(" in ln), None)
    if start:
        for i in range(start, min(start + 28, len(hm))):
            print(f"    :{i}  {hm[i - 1]}")
    fl = Path("frontend/src/services/FileLoaderService.ts").read_text(encoding="utf-8").splitlines()
    print("\n  FileLoaderService 的 history.reset 调用点：")
    for i, ln in enumerate(fl, 1):
        if "history.reset" in ln:
            print(f"    :{i}  {ln.strip()}")
    gc = Path("frontend/src/components/GeologyCanvas.ts").read_text(encoding="utf-8").splitlines()
    print("\n  GeologyCanvas 的 Ctrl+Z 分支：")
    for i, ln in enumerate(gc, 1):
        if "history.undo()" in ln:
            for j in range(i - 1, min(i + 10, len(gc))):
                print(f"    :{j + 1}  {gc[j]}")


if __name__ == "__main__":
    main()
