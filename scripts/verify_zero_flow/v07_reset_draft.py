# -*- coding: utf-8 -*-
"""独立复核 G：probes F-4（重置必弹 -32001）、probes F-8（草稿恢复只写前端）。

F-4 的因果在**前端**（两个 void RPC 的竞态 + 顺序），我在这里做的是
**后端可判定的一半**：`project.new` 之后 `algorithm.applyLineRemoval(roi_id='roi_1')`
是否必然 -32001？若"必然"，则 F-4 的"即使顺序正确也必失败"成立。

F-8 同样是前端行为（草稿横幅按钮整段无 RPC）。后端可判定的一半是：
"后端 project.new 之后，列的写操作是否都 -32001"。若成立，则 F-8 的
"界面有 28 列但第一次真实动作就撞错"成立。

运行：
    pixi run python scripts/verify_zero_flow/v07_reset_draft.py
"""
from __future__ import annotations

import json

from vcommon import banner, hoya, isolate_config, make_dispatcher, new_session, rpc_call  # noqa: E402

CFG = isolate_config()


def call(methods, name, params=None):
    try:
        return ("ok", rpc_call(methods, name, params))
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "code", None)
        msg = getattr(e, "message", str(e))
        return ("fail", {"code": code, "message": msg})


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("G1. probes F-4：project.new 后按旧 roi_id 重算清理掩膜")
    s = hoya(new_session())
    d, M = make_dispatcher(s)
    print(f"  重置前 rois = {[(r['id'], r.get('xlim')) for r in s.rois]}")
    st, _ = call(M, "project.new", {"clear_image": False})
    print(f"  project.new -> {st}")
    print(f"  重置后 rois = {[(r['id'], r.get('xlim')) for r in s.rois]}  "
          f"active_roi_id = {s.active_roi_id}")
    st2, res2 = call(M, "algorithm.applyLineRemoval", {"roi_id": "roi_1"})
    print(f"  applyLineRemoval(roi_id='roi_1') -> {st2} {json.dumps(res2, ensure_ascii=False)}")
    print(f"  >>> 必然失败？ {'是' if st2 == 'fail' else '否'}")

    banner("G2. 对照：重置后**先**建新 ROI 再重算，是否成功")
    s2 = hoya(new_session())
    d2, M2 = make_dispatcher(s2)
    call(M2, "project.new", {"clear_image": False})
    st, _ = call(M2, "roi.create", {"name": "pollen", "x0": 315, "x1": 1946,
                                    "y0": 511, "y1": 1311})
    print(f"  roi.create -> {st}  rois={[r['id'] for r in s2.rois]}")
    st3, res3 = call(M2, "algorithm.applyLineRemoval", {"roi_id": s2.rois[0]["id"]})
    print(f"  applyLineRemoval -> {st3}")
    print("  （说明：F-4 的根因是前端在 project.new 之后按旧 id 发请求，"
          "不是后端拒绝重算。）")

    banner("G3. probes F-8：project.new 之后，前端以为存在的列还能不能操作")
    s3 = hoya(new_session())
    d3, M3 = make_dispatcher(s3)
    n_before = len(s3.columns)
    call(M3, "project.new", {"clear_image": False})
    print(f"  重置前列数 = {n_before}  重置后后端列数 = {len(s3.columns)}")
    for method, params in (
        ("column.calibrateXTicks", {"col_index": 0,
                                    "ticks": [{"px": 322, "value": 0},
                                              {"px": 402, "value": 40}], "unit": "%"}),
        ("core.exportData", {"format": "csv"}),
        ("export.getReadiness", {}),
        ("qa.summarize", {}),
    ):
        st, res = call(M3, method, params)
        if st == "fail":
            print(f"  {method:<28} -> {st} code={res['code']} {res['message'][:80]}")
        else:
            brief = json.dumps(res, ensure_ascii=False)[:110]
            print(f"  {method:<28} -> {st} {brief}")
    print("  >>> 与 probes F-8 的 ④ 段一致吗：见上面 column.calibrateXTicks / "
          "export.csv 是否 -32001")

    banner("G4. 前端草稿恢复是否真的不发 RPC（源码核对）")
    from pathlib import Path

    src = Path("frontend/src/main.ts").read_text(encoding="utf-8").splitlines()
    hit = None
    for i, ln in enumerate(src, 1):
        if "btn-restore-draft" in ln:
            hit = i
            break
    if hit:
        seg = src[hit - 1:hit + 30]
        rpc_calls = [ln.strip() for ln in seg if "rpcClient" in ln or "await " in ln]
        print(f"  main.ts:{hit} 起的草稿恢复块：")
        for j, ln in enumerate(seg, hit):
            print(f"    :{j}  {ln.rstrip()}")
        print(f"\n  该块内 RPC/await 调用数 = {len(rpc_calls)}  {rpc_calls}")


if __name__ == "__main__":
    main()
