# -*- coding: utf-8 -*-
"""探针 P3：JSON-RPC 无锁 → 并发读撕裂 / 并发写互相覆盖。

独立实现（不引用 Lead 的脚本），只用 stdlib + 本项目探针的 `rpc.py`。

三个子实验：
  A. 纯并发：一个线程 `core.loadImage`，其余线程狂读 `straditize.getDiagramData`。
  B. 并发写（更严重）：两个"用户"同时对同一会话写 —— ROI 改名 / 分列 / 清理几何，
     看是否互相覆盖或丢数据。
  C. 并发写：两个线程同时 `column.calibrateXTicks` 不同列，看是否有一方的写入消失。

    pixi run python scripts/zero_flow_probes/probe_p3_concurrency.py 22940
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


def tear(r: Rpc) -> dict:
    """一次读：只要「已有图像尺寸」但「没有任何 ROI」就是撕裂态。"""
    d = r.call("straditize.getDiagramData")
    return {
        "imageWidth": d.get("imageWidth"),
        "rois": len(d.get("rois") or []),
        "primaryRoiId": d.get("primaryRoiId"),
        "activeRoiId": d.get("activeRoiId"),
    }


def is_torn(s: dict) -> bool:
    return bool(s["imageWidth"]) and (s["rois"] == 0 or s["primaryRoiId"] is None)


def experiment_a(port: int, rounds: int = 8, readers: int = 3, per_reader: int = 6) -> dict:
    """并发 loadImage vs 狂读。"""
    out = {"rounds": rounds, "torn_rounds": 0, "samples": []}
    for rd in range(rounds):
        r0 = Rpc(port)
        r0.call("e2e.reset")
        results: list[dict] = []
        stop = threading.Event()
        errs: list[str] = []

        def writer():
            try:
                Rpc(port).call("core.loadImage", {"sample_key": "hoya"})
            except Exception as exc:  # noqa: BLE001
                errs.append(f"writer: {exc}")
            finally:
                stop.set()

        def reader(name: str):
            rr = Rpc(port)
            for _ in range(per_reader):
                if stop.is_set():
                    return
                try:
                    results.append(tear(rr))
                except Exception as exc:  # noqa: BLE001
                    errs.append(f"{name}: {exc}")
                time.sleep(0.0015)

        threads = [threading.Thread(target=writer)] + [
            threading.Thread(target=reader, args=(f"r{i}",)) for i in range(readers)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        torn = [s for s in results if is_torn(s)]
        if torn:
            out["torn_rounds"] += 1
        out["samples"].append(
            {
                "round": rd,
                "reads": len(results),
                "torn": len(torn),
                "example_torn": torn[0] if torn else None,
                "errors": errs,
            }
        )
    # 收尾：并发结束后静态读一次，确认能自愈
    r = Rpc(port)
    out["self_heal"] = {
        "rois": len(r.call("straditize.getDiagramData").get("rois") or []),
        "primaryRoiId": r.call("straditize.getDiagramData").get("primaryRoiId"),
    }
    return out


def experiment_b(port: int) -> dict:
    """并发写：两个"用户"同时对同一会话做 ROI 改名 + 分列 + 加清理几何。"""
    r = Rpc(port)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    d = r.call("straditize.getDiagramData")
    roi_id = d.get("activeRoiId")
    out: dict = {"roi_id": roi_id, "writes": {}}

    errors: list[str] = []
    barrier = threading.Barrier(2, timeout=20)

    def user_a():
        rr = Rpc(port)
        barrier.wait()
        for name in ("A1", "A2", "A3"):
            try:
                rr.call("roi.update", {"roi_id": roi_id, "name": name})
            except Exception as exc:  # noqa: BLE001
                errors.append(f"A rename {name}: {exc}")

    def user_b():
        rr = Rpc(port)
        barrier.wait()
        for _ in range(3):
            try:
                rr.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
            except Exception as exc:  # noqa: BLE001
                errors.append(f"B detectColumns: {exc}")

    ta, tb = threading.Thread(target=user_a), threading.Thread(target=user_b)
    ta.start(); tb.start(); ta.join(30); tb.join(30)

    final = r.call("straditize.getDiagramData")
    out["final_roi_name"] = (final.get("rois") or [{}])[0].get("name")
    out["final_columns"] = len(final.get("columns") or [])
    out["errors"] = errors
    return out


def experiment_c(port: int) -> dict:
    """并发写：两个线程同时标定不同列的 X 刻度，检查两次写入是否都留存。"""
    r = Rpc(port)
    r.call("e2e.reset")
    r.call("core.loadImage", {"sample_key": "hoya"})
    r.call("core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    cols = r.call("straditize.getDiagramData").get("columns") or []
    if len(cols) < 2:
        return {"skipped": f"本图只分出 {len(cols)} 列（<2），无法做双列并发标定"}
    out: dict = {"columns": len(cols), "errors": []}
    barrier = threading.Barrier(2, timeout=20)

    def cal(idx: int, val: float):
        rr = Rpc(port)
        c = cols[idx]
        px1, px2 = c["startX"], (c["tickEndX"] if c["tickEndX"] > c["startX"] else c["startX"] + 60)
        barrier.wait()
        try:
            rr.call(
                "column.calibrateXTicks",
                {"col_index": idx, "ticks": [{"px": px1, "value": 0}, {"px": px2, "value": val}]},
            )
        except Exception as exc:  # noqa: BLE001
            out["errors"].append(f"col{idx}: {exc}")

    t0 = threading.Thread(target=cal, args=(0, 40.0))
    t1 = threading.Thread(target=cal, args=(1, 55.0))
    t0.start(); t1.start(); t0.join(30); t1.join(30)

    after = r.call("straditize.getDiagramData").get("columns") or []
    out["col0_ticks"] = after[0].get("x_ticks")
    out["col1_ticks"] = after[1].get("x_ticks")
    out["both_present"] = bool(after[0].get("x_ticks")) and bool(after[1].get("x_ticks"))
    return out


def experiment_d(port: int, rounds: int = 120) -> dict:
    """量测「真用户动作恰好落在窗口内」的概率：一次读恰在 loadImage 进行中发出。

    模拟两个标签页：B 页发一次读（例如用户切回 B 页触发刷新），A 页同时在 loadImage。
    用随机抖动把读的发射时刻摊在 loadImage 的整个时长上，统计撕裂率。
    """
    import random

    torn = 0
    for _ in range(rounds):
        r0 = Rpc(port)
        r0.call("e2e.reset")
        delay = random.uniform(0, 0.35)
        res: dict = {}

        def reader():
            time.sleep(delay)
            try:
                res["read"] = tear(Rpc(port))
            except Exception as exc:  # noqa: BLE001
                res["error"] = str(exc)

        t = threading.Thread(target=reader)
        t.start()
        try:
            Rpc(port).call("core.loadImage", {"sample_key": "hoya"})
        except Exception:  # noqa: BLE001
            pass
        t.join(30)
        if "read" in res and is_torn(res["read"]):
            torn += 1
    return {"rounds": rounds, "torn": torn, "rate": round(torn / rounds, 3)}


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    print("=" * 72)
    print("A. 并发 loadImage vs 狂读 getDiagramData（纯后端，无 UI）")
    print("=" * 72)
    a = experiment_a(port)
    for s in a["samples"]:
        print(
            f"  第 {s['round'] + 1} 轮：{s['reads']} 次读，撕裂 {s['torn']} 次"
            + (f"；例：{json.dumps(s['example_torn'], ensure_ascii=False)}" if s["example_torn"] else "")
            + (f"；错误 {s['errors']}" if s["errors"] else "")
        )
    print(f"  >>> 撕裂轮数：{a['torn_rounds']}/{a['rounds']}")
    print(f"  >>> 并发结束后静态读：{json.dumps(a['self_heal'], ensure_ascii=False)}（自愈？）")

    print("\n" + "=" * 72)
    print("B. 并发写：A 连续改名 ROI，B 同时连续重新分列")
    print("=" * 72)
    b = experiment_b(port)
    print(json.dumps(b, ensure_ascii=False, indent=2))

    print("\n" + "=" * 72)
    print("C. 并发写：两列同时标定 X 刻度")
    print("=" * 72)
    c = experiment_c(port)
    print(json.dumps(c, ensure_ascii=False, indent=2))

    print()
    print("=" * 72)
    print("D. 单次读恰好落在 loadImage 窗口内的概率（120 次随机时刻）")
    print("=" * 72)
    d = experiment_d(port)
    print(json.dumps(d, ensure_ascii=False))


if __name__ == "__main__":
    main()
