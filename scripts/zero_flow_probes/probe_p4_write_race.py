# -*- coding: utf-8 -*-
"""探针 P4：无锁共享会话下**并发写**的丢数据（check-then-act / read-modify-write）。

P3 的朴素并发写（改名 vs 分列）没丢数据，因为那些写各自是幂等的整块赋值。
真正的危险形态是**读-改-写**：两个请求都先读到同一份旧状态，再各自把"自己那一份"
写回去，后到者覆盖先到者。本探针盯住三处最像真实操作的读-改-写：

  W1. `column.calibrateXTicks` 之间夹一次 `detectColumns`（用户 A 在标定、用户 B 在重分列）
      —— 观测 A 的标定是否消失。这是**两个标签页**最可能的组合。
  W2. `algorithm.applyLineRemoval(strokes=…)` 并发两次，每次只提交自己的那一笔
      笔迹 —— 后端语义是**全量覆盖**，两次并发必然有一笔被抹。
  W3. `project_save` 与 `e2e.reset/project_new` 并发 —— 会话被清空后保存，产物是否
      仍然是"当前这幅图"的项目。

    pixi run python scripts/zero_flow_probes/probe_p4_write_race.py 22940
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import Rpc  # noqa: E402

HOYA_X = [315, 1946]
HOYA_Y = [511, 1311]


def setup(port: int) -> Rpc:
    r = Rpc(port)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    return r


def w1_calib_interleaved(port: int, rounds: int = 6) -> dict:
    """用户 A 标定 col2；用户 B 同时重新分列。看 A 的标定最后是否还在。"""
    out = {"rounds": [], "lost": 0}
    for rd in range(rounds):
        r = setup(port)
        cols = r.call("straditize.getDiagramData").get("columns") or []
        idx = min(2, len(cols) - 1)
        c = cols[idx]
        px1 = c["startX"]
        px2 = c["tickEndX"] if c["tickEndX"] > px1 else px1 + 60
        barrier = threading.Barrier(2, timeout=20)
        errs: list[str] = []

        def a_calibrate():
            rr = Rpc(port)
            barrier.wait()
            time.sleep(0.02)
            try:
                rr.call(
                    "column.calibrateXTicks",
                    {"col_index": idx, "ticks": [{"px": px1, "value": 0}, {"px": px2, "value": 40}]},
                )
            except Exception as exc:  # noqa: BLE001
                errs.append(f"A: {exc}")

        def b_detect():
            rr = Rpc(port)
            barrier.wait()
            try:
                rr.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
            except Exception as exc:  # noqa: BLE001
                errs.append(f"B: {exc}")

        ta, tb = threading.Thread(target=a_calibrate), threading.Thread(target=b_detect)
        ta.start(); tb.start(); ta.join(30); tb.join(30)

        after = r.call("straditize.getDiagramData").get("columns") or []
        ticks = after[idx].get("x_ticks") if idx < len(after) else None
        lost = ticks is None
        if lost:
            out["lost"] += 1
        out["rounds"].append(
            {
                "round": rd + 1,
                "col": idx,
                "x_ticks_after": ticks,
                "A_calibrate_returned_ok": "A" not in " ".join(errs),
                "errors": errs,
            }
        )
    return out


def w2_strokes_overwrite(port: int, rounds: int = 6) -> dict:
    """两笔笔迹并发提交；后端语义是全量覆盖，应当有一笔被抹掉。"""
    out = {"rounds": [], "lost": 0}
    for rd in range(rounds):
        r = setup(port)
        d = r.call("straditize.getDiagramData")
        roi = d.get("activeRoiId")
        barrier = threading.Barrier(2, timeout=20)
        errs: list[str] = []

        stroke_a = [{"id": "sa", "mode": "erase", "radius": 6, "points": [[400, 800], [700, 800]]}]
        stroke_b = [{"id": "sb", "mode": "erase", "radius": 6, "points": [[1000, 800], [1300, 800]]}]

        def push(strokes, tag):
            rr = Rpc(port)
            barrier.wait()
            try:
                rr.call("algorithm.applyLineRemoval", {"roi_id": roi, "strokes": strokes})
            except Exception as exc:  # noqa: BLE001
                errs.append(f"{tag}: {exc}")

        ta = threading.Thread(target=push, args=(stroke_a, "A"))
        tb = threading.Thread(target=push, args=(stroke_b, "B"))
        ta.start(); tb.start(); ta.join(30); tb.join(30)
        time.sleep(0.2)

        after = r.call("straditize.getDiagramData")
        strokes = after.get("line_strokes") or []
        ids = sorted(s.get("id") for s in strokes)
        if len(ids) < 2:
            out["lost"] += 1
        out["rounds"].append(
            {
                "round": rd + 1,
                "strokes_after": ids,
                "both_survived": len(ids) == 2,
                "errors": errs,
            }
        )
    return out


def w3_save_during_reset(port: int) -> dict:
    """保存与新建项目并发：产物是否与"用户以为的那幅图"一致。"""
    r = setup(port)
    barrier = threading.Barrier(2, timeout=20)
    errs: list[str] = []
    box: dict = {}

    def saver():
        rr = Rpc(port)
        barrier.wait()
        try:
            box["save"] = rr.call("project.save", {"format": "json"})
        except Exception as exc:  # noqa: BLE001
            errs.append(f"save: {exc}")

    def newer():
        rr = Rpc(port)
        barrier.wait()
        try:
            rr.call("project.new", {})
        except Exception as exc:  # noqa: BLE001
            errs.append(f"new: {exc}")

    t0, t1 = threading.Thread(target=saver), threading.Thread(target=newer)
    t0.start(); t1.start(); t0.join(30); t1.join(30)

    saved = (box.get("save") or {}).get("data") or {}
    after_new = r.call("straditize.getDiagramData")
    return {
        "saved_columns": len(saved.get("columns") or []),
        "saved_rois": len(saved.get("rois") or []),
        "session_after": {
            "imageSrc": after_new.get("imageSrc"),
            "rois": len(after_new.get("rois") or []),
            "columns": len(after_new.get("columns") or []),
        },
        "errors": errs,
    }


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    print("=" * 72)
    print("W1. 标定 colN 与重新分列并发（两个标签页最可能的组合）")
    print("=" * 72)
    w1 = w1_calib_interleaved(port)
    for x in w1["rounds"]:
        print(
            f"  第 {x['round']} 轮 col{x['col']}: x_ticks_after={json.dumps(x['x_ticks_after'])}"
            f" | A 调用成功={x['A_calibrate_returned_ok']} | errors={x['errors']}"
        )
    print(f"  >>> 标定丢失轮数：{w1['lost']}/{len(w1['rounds'])}")

    print("\n" + "=" * 72)
    print("W2. 两笔笔迹并发提交（后端语义=全量覆盖）")
    print("=" * 72)
    w2 = w2_strokes_overwrite(port)
    for x in w2["rounds"]:
        print(
            f"  第 {x['round']} 轮 strokes_after={x['strokes_after']} | 两笔都在={x['both_survived']}"
            f" | errors={x['errors']}"
        )
    print(f"  >>> 笔迹被覆盖轮数：{w2['lost']}/{len(w2['rounds'])}")

    print("\n" + "=" * 72)
    print("W3. project.save 与 project.new 并发")
    print("=" * 72)
    print(json.dumps(w3_save_during_reset(port), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
