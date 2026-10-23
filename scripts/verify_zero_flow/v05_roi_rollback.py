# -*- coding: utf-8 -*-
"""独立复核 E：probes F-1（重分列静默回滚后端 ROI）。

对方的因果链是：前端用**自己的旧 ROI 镜像**构造 `core.detectColumns` 的 bounds，
后端收到后覆写 `self.data_xlim` 与 ROI 的 `xlim`。

我在**后端层面**做最严格的拆分：
- E1：证明 `detect_columns(bounds)` 确实会覆写 ROI（后端自身行为，不含前端）；
- E2：证明若传**新** bounds，ROI 保持新值（后端不会自己回滚）；
- E3：证明若传**旧** bounds，ROI 被退回旧值（这正是前端镜像造成的后果）；
- E4：读前端源码确认镜像来源（`WorkflowController.ts`），并指出它**没有**
  在 `roi.update` 之后刷新 `data.rois` 的代码路径。

运行：
    pixi run python scripts/verify_zero_flow/v05_roi_rollback.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, new_session  # noqa: E402

CFG = isolate_config()


def rois(s):
    return [(r["id"], list(r.get("xlim") or []), list(r.get("ylim") or [])) for r in s.rois]


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("E1. 后端自身：detect_columns(bounds) 是否覆写 ROI 几何")
    s = hoya(new_session())
    print(f"  分列后: {rois(s)}  data_xlim={s.data_xlim} data_ylim={s.data_ylim}")

    banner("E2. 用**新** bounds 重分列（等价于前端已刷新镜像）")
    s2 = hoya(new_session())
    s2.roi_update("roi_1", x0=355, x1=1906)
    print(f"  roi.update 后: {rois(s2)}")
    s2.detect_columns([355, 1906], [511, 1311])
    print(f"  detectColumns(新 bounds) 后: {rois(s2)}  <- 保持新值")

    banner("E3. 用**旧** bounds 重分列（等价于前端镜像未刷新）")
    s3 = hoya(new_session())
    s3.roi_update("roi_1", x0=355, x1=1906)
    print(f"  roi.update 后（后端已接受新值）: {rois(s3)}")
    old = [315, 1946]  # 前端镜像里的旧值
    s3.detect_columns(old, [511, 1311])
    print(f"  detectColumns(旧 bounds {old}) 后: {rois(s3)}")
    back = rois(s3)[0][1] == old
    print(f"  >>> ROI 被回滚成旧值？ {'是' if back else '否'}")

    banner("E4. 前端源码：镜像来源与刷新路径")
    import re
    from pathlib import Path

    wf = Path("frontend/src/services/WorkflowController.ts")
    txt = wf.read_text(encoding="utf-8")
    lines = txt.splitlines()
    print("  WorkflowController.ts 中构造 detectColumnsInRoi 参数的位置：")
    for i, ln in enumerate(lines, 1):
        if "canvasComponent.data.rois" in ln or "detectColumnsInRoi" in ln:
            print(f"    :{i}  {ln.strip()}")
    print("\n  RpcClient 中 roi.update 后是否回填 data.rois：")
    rc = Path("frontend/src/services/RpcClient.ts").read_text(encoding="utf-8")
    for i, ln in enumerate(rc.splitlines(), 1):
        if re.search(r"rois\s*=", ln) and "data" in ln:
            print(f"    RpcClient.ts:{i}  {ln.strip()}")
    for i, ln in enumerate(rc.splitlines(), 1):
        if "applyLoadedImage" in ln:
            print(f"    RpcClient.ts:{i}  {ln.strip()}")
    print("\n  CleanupManager.commitRoi（UI 改 ROI 的唯一入口）：")
    cm = Path("frontend/src/services/CleanupManager.ts").read_text(encoding="utf-8")
    for i, ln in enumerate(cm.splitlines(), 1):
        if "commitRoi" in ln or "syncActiveRoiBounds" in ln:
            print(f"    CleanupManager.ts:{i}  {ln.strip()}")


if __name__ == "__main__":
    main()
