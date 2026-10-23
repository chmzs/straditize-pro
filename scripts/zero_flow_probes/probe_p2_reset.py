# -*- coding: utf-8 -*-
"""探针 P2：工具栏【重置全部操作】(onResetAll) 在真实用户路径上是否报错。

复刻 `frontend/src/services/ToolbarBridge.ts:130-169` 的调用序列（只读产品源码，
不改它）：
    canvas.resetAllOperations()          # 纯前端，探针里等价于"忽略"
    rpc.resetProjectState()              # -> project.new {}
    recomposeCleanupState('归零后重算清理掩膜')
       -> rpc.refreshCleanup(roiId)      # -> algorithm.applyLineRemoval {roi_id}
       -> applyCleanupState(res)         # 需 res.candidates/stats/overlay_png

在**零状态**（刚启动、从未载图）与**已载图**两种前置下分别跑，看哪一种报错。

    pixi run python scripts/zero_flow_probes/probe_p2_reset.py 22940
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402


def reset_project(r: Rpc) -> None:
    """等价 onResetAll 的后端调用。"""
    ok, res = r.try_call("project.new", {})
    print(f"  project.new -> ok={ok} {'' if ok else res}")


def recompose(r: Rpc) -> None:
    ok, res = r.try_call("algorithm.applyLineRemoval", {"roi_id": None})
    if ok:
        keys = sorted(res.keys()) if isinstance(res, dict) else type(res).__name__
        print(f"  algorithm.applyLineRemoval -> ok=True keys={keys}")
    else:
        print(f"  algorithm.applyLineRemoval -> ok=False\n    {res}")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    r = Rpc(port)

    print("=" * 70)
    print("场景 A：真·零状态（进程刚起，从未载过图）——等价新开应用点【重置】")
    print("=" * 70)
    # ⚠️ 本场景要求**后端进程刚启动且从未被用过**。为让"当前是否真零状态"可判定，
    # 这里先如实打印现状；若已不是零状态，明确标注并跳过，绝不假装。
    st = r.call("straditize.getDiagramData")
    truly_zero = st.get("imageSrc") is None and not (st.get("rois") or [])
    print("  现状：imageSrc =", st.get("imageSrc"), "| rois =", len(st.get("rois") or []))
    if not truly_zero:
        print("  ⚠️ 当前**不是**零状态，本场景跳过。要复现请先重启 zero_backend.py 再跑。")
        print("     （跳过而不是硬跑，是为了不让「已载图」的会话被当作「零状态」证据。）")
        print("\n" + "=" * 70)
        print("场景 B：已载图（正常工作中点【重置】）")
        print("=" * 70)
        r.call("e2e.reset")
        r.call("core.loadImage", {"sample_key": "hoya"})
        s2 = r.call("straditize.getDiagramData")
        print("  已载图：imageSrc =", str(s2.get("imageSrc"))[:24], "| rois =", len(s2.get("rois") or []))
        print("\n  ① project.new")
        reset_project(r)
        print("  ② algorithm.applyLineRemoval(roi_id=None)")
        recompose(r)
        print("\n>>> 判读：ok=False 即用户会在界面上看到失败弹框/红条。")
        return
    print("  后端 line_candidates 键存在？", "line_candidates" in st)

    print("\n  ① project.new")
    reset_project(r)
    print("  ② algorithm.applyLineRemoval(roi_id=None)   # recomposeCleanupState")
    recompose(r)

    print("\n" + "=" * 70)
    print("场景 B：已载图（正常工作中点【重置】）")
    print("=" * 70)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    st = r.call("straditize.getDiagramData")
    print("  已载图：imageSrc 前缀 =", str(st.get("imageSrc"))[:24], "| rois =", len(st.get("rois") or []))
    print("\n  ① project.new")
    reset_project(r)
    print("  ② algorithm.applyLineRemoval(roi_id=None)")
    recompose(r)

    print("\n>>> 判读：任一场景下 ok=False 即用户会在界面上看到失败弹框/红条。")


if __name__ == "__main__":
    main()
