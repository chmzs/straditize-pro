# -*- coding: utf-8 -*-
"""B-08 并发压测：证明 `JsonRpcDispatcher` 加锁后撕裂读消失，且不死锁。

## 压的是哪条路径

不是自己起线程调 session 方法——那样测的是"session 有没有锁"，而缺陷的定位是
**服务端每请求一线程，而所有线程共享同一个 session**
（`rpc_server.py` 的 `ThreadingHTTPServer` + 同一个 `dispatcher`）。
所以本脚本起真实的 `StraditizeRpcHttpServer`，用 `urllib` 并发打 HTTP `/rpc`，
走的是浏览器走的那条完整路径：HTTP → `handle_text` → `handle_object` →
`execute_request`。

## 判据

**撕裂态**（照 `docs/findings/dynamic-probes.md` F-6 的可观测形态）：
一次读 `straditize.getDiagramData` 同时满足 `imageWidth > 0` 且 `rois == []`
（或 `primaryRoiId is None`）。

成因是 `load_image` 的多步写入：先写 `width/height`，再 `_init_rois()` 清空
`rois`，再 `roi_create()` 回填。中间窗口被另一线程读到就是撕裂。

`load_image` 一个来回要几百毫秒，撕裂窗口有几百毫秒宽，所以这里用**一个写线程 +
多个读线程**的方式持续压，而不是靠碰运气。

## 三个子实验

A. **撕裂压测**：切换图像的同时狂读，统计撕裂次数。加锁前应稳定出现，加锁后必须 0。
A'. **无锁对照（灵敏度证明）**：把 `_request_lock` 换成空实现，重跑 A。
    没有这一步，"torn=0" 无法区分"锁修好了"与"探针根本测不出来"——
    探针的灵敏度必须自己证明，否则结论不可信。
B. **重入保活**：`tools/call` 会在同一线程再次进 `execute_request`
   （`rpc_methods/naming.py` → `StraditizeWebMcpServer.call_tool` → `handle_object`）。
   用 `threading.Lock` 会自锁死；用 `RLock` 必须正常返回。本项直接打 HTTP，
   并带超时——挂死会表现成超时而不是崩溃，故超时要单独算失败。
C. **并发写不互相覆盖**：两个"用户"同时标定不同列，两方写入都必须存活。

用法：
    pixi run python scripts/lock_probe/probe_b08_dispatcher_lock.py            # 默认端口 22960
    pixi run python scripts/lock_probe/probe_b08_dispatcher_lock.py 22961 8    # 指定端口与轮数
"""
from __future__ import annotations

import contextlib
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from straditize_core.rpc_server import (  # noqa: E402
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
    find_available_port,
)
from straditize_core.session import StraditizeSession  # noqa: E402

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]
BEGINNER_X, BEGINNER_Y = [200, 1700], [200, 1600]

#: HTTP 超时。挂死表现为超时，必须当作失败统计，不能让它静默拖到最后。
TIMEOUT_SECONDS = 20.0


def _call(port: int, method: str, params: dict | None = None) -> dict:
    """POST one JSON-RPC request to the live server; return the whole envelope."""
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/rpc",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _result(port: int, method: str, params: dict | None = None):
    envelope = _call(port, method, params)
    if envelope.get("error"):
        raise RuntimeError(f"{method} failed: {envelope['error'].get('message')}")
    return envelope.get("result")


def _tear_snapshot(port: int) -> dict:
    """One read of the state that tears: image size vs. ROI presence."""
    data = _result(port, "straditize.getDiagramData")
    return {
        "imageWidth": data.get("imageWidth") or 0,
        "rois": len(data.get("rois") or []),
        "primaryRoiId": data.get("primaryRoiId"),
    }


def _is_torn(snapshot: dict) -> bool:
    return bool(snapshot["imageWidth"]) and (
        snapshot["rois"] == 0 or snapshot["primaryRoiId"] is None
    )


def _reset_to(port: int, sample_key: str) -> None:
    _result(port, "project.new", {"clear_image": True})
    _result(port, "core.loadImage", {"sample_key": sample_key})


@contextlib.contextmanager
def _unlocked_control(dispatcher) -> "object":
    """临时把请求锁换成空实现，用于证明探针对撕裂是敏感的。

    这是**反向对照**：无锁时若探针仍报 0 撕裂，说明"压测压不到撕裂窗口"，
    那么加锁后的 0 也就毫无信息量。只在对照实验里开，跑完立刻还原。
    """

    class _NoLock:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

    original = dispatcher._request_lock
    dispatcher._request_lock = _NoLock()
    try:
        yield dispatcher
    finally:
        dispatcher._request_lock = original


def experiment_a_torn_reads(
    port: int, rounds: int, readers: int, min_reads_per_reader: int = 12
) -> dict:
    """A. 写线程换图，读线程狂读 —— 撕裂必须为 0。

    `min_reads_per_reader` 不能省：加锁后每个读请求都会**排队**在写请求后面，
    写线程一结束就退出循环只会采到两三次样本。样本太少时"0 撕裂"是弱证据，
    所以要保证每个读线程至少读够 N 次（写作结束后继续读完）。
    """
    outcome: dict = {"rounds": rounds, "readers": readers, "torn_rounds": 0, "samples": []}
    for round_index in range(rounds):
        _reset_to(port, "hoya")
        observed: list[dict] = []
        errors: list[str] = []
        writer_done = threading.Event()

        def writer() -> None:
            try:
                _result(port, "core.loadImage", {"sample_key": "beginner"})
            except Exception as exc:  # noqa: BLE001
                errors.append(f"writer: {type(exc).__name__}: {exc}")
            finally:
                writer_done.set()

        def reader(name: str) -> None:
            reads = 0
            while not writer_done.is_set() or reads < min_reads_per_reader:
                try:
                    observed.append(_tear_snapshot(port))
                    reads += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{name}: {type(exc).__name__}: {exc}")
                    return
                time.sleep(0.001)

        threads = [threading.Thread(target=writer)] + [
            threading.Thread(target=reader, args=(f"reader-{i}",)) for i in range(readers)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=120)
        stuck = [t for t in threads if t.is_alive()]

        torn = [s for s in observed if _is_torn(s)]
        if torn:
            outcome["torn_rounds"] += 1
        outcome["samples"].append(
            {
                "round": round_index,
                "reads": len(observed),
                "torn": len(torn),
                "example_torn": torn[0] if torn else None,
                "errors": errors,
                "stuck_threads": len(stuck),
            }
        )
    # 收尾静态回读：并发结束后状态必须自洽
    outcome["final"] = _tear_snapshot(port)
    return outcome


def experiment_b_reentrant_call(port: int) -> dict:
    """B. 重入链必须返回而不是自锁。`threading.Lock` 会让这里超时。"""
    started = time.monotonic()
    try:
        nested = _result(
            port, "tools/call", {"name": "straditize_get_status", "arguments": {}}
        )
        direct = _result(
            port, "webmcp.callTool", {"name": "straditize_get_status", "arguments": {}}
        )
        return {
            "ok": True,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "tools_call_has_content": bool(nested and nested.get("content")),
            "webmcp_call_has_content": bool(direct and direct.get("content")),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "error": f"{type(exc).__name__}: {exc}",
        }


def experiment_c_concurrent_writes(port: int) -> dict:
    """C. 两个线程同时标定不同列，两方写入都必须存活。"""
    _reset_to(port, "hoya")
    _result(port, "core.detectColumns", {"data_xlim": HOYA_X, "data_ylim": HOYA_Y})
    data = _result(port, "straditize.getDiagramData")
    columns = data.get("columns") or []
    if len(columns) < 2:
        return {"ok": False, "error": f"前置失败：只分列出 {len(columns)} 列"}

    barrier = threading.Barrier(2, timeout=60)
    errors: list[str] = []

    def calibrate(col_index: int, tick_value: float) -> None:
        column = columns[col_index]
        start, end = float(column["startX"]), float(column["endX"])
        try:
            barrier.wait()
            _result(
                port,
                "column.calibrateXTicks",
                {
                    "col_index": col_index,
                    "ticks": [
                        {"px": start + 20, "value": 0.0},
                        {"px": end - 20, "value": tick_value},
                    ],
                    "unit": "%",
                },
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"col{col_index}: {type(exc).__name__}: {exc}")

    threads = [
        threading.Thread(target=calibrate, args=(0, 40.0)),
        threading.Thread(target=calibrate, args=(1, 55.0)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)

    after = (_result(port, "straditize.getDiagramData").get("columns") or [])
    first_ticks = after[0].get("x_ticks")
    second_ticks = after[1].get("x_ticks")
    return {
        "ok": bool(first_ticks) and bool(second_ticks) and not errors,
        "first_column_ticks": first_ticks,
        "second_column_ticks": second_ticks,
        "errors": errors,
    }


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22960
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    session = StraditizeSession()
    session._init_cleanup()
    dispatcher = create_rpc_dispatcher(session)
    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=find_available_port(port),
        dispatcher=dispatcher,
        session=session,
    )
    server.start()
    live_port = server.actual_port
    print(f"[lock_probe] server up on http://127.0.0.1:{live_port}/rpc", flush=True)

    try:
        print("\n=== A. 撕裂压测（换图 vs 狂读） ===", flush=True)
        experiment_a = experiment_a_torn_reads(live_port, rounds, readers=3)
        for sample in experiment_a["samples"]:
            print(
                f"  round {sample['round']}: reads={sample['reads']:3d} "
                f"torn={sample['torn']:3d} stuck={sample['stuck_threads']} "
                f"errors={len(sample['errors'])}",
                flush=True,
            )
            if sample["example_torn"]:
                print(f"    torn example: {sample['example_torn']}", flush=True)
        print(f"  >>> 撕裂轮次: {experiment_a['torn_rounds']}/{rounds}", flush=True)
        print(f"  >>> 收尾静态回读: {experiment_a['final']}", flush=True)

        print("\n=== A'. 无锁对照（证明探针能测出撕裂） ===", flush=True)
        with _unlocked_control(dispatcher):
            experiment_a_control = experiment_a_torn_reads(
                live_port, max(2, rounds // 2), readers=3
            )
        control_torn_total = sum(s["torn"] for s in experiment_a_control["samples"])
        control_reads_total = sum(s["reads"] for s in experiment_a_control["samples"])
        print(
            f"  无锁时: 撕裂轮次 {experiment_a_control['torn_rounds']}"
            f"/{len(experiment_a_control['samples'])}  "
            f"撕裂读数合计 {control_torn_total}/{control_reads_total}",
            flush=True,
        )
        if experiment_a_control["samples"]:
            example = experiment_a_control["samples"][0].get("example_torn")
            if example:
                print(f"    torn example: {example}", flush=True)

        print("\n=== B. 重入保活（tools/call → 再进 execute_request） ===", flush=True)
        experiment_b = experiment_b_reentrant_call(live_port)
        for key, value in experiment_b.items():
            print(f"  {key}: {value}", flush=True)

        print("\n=== C. 并发写不互相覆盖 ===", flush=True)
        experiment_c = experiment_c_concurrent_writes(live_port)
        for key, value in experiment_c.items():
            print(f"  {key}: {value}", flush=True)

        torn_total = sum(s["torn"] for s in experiment_a["samples"])
        stuck_total = sum(s["stuck_threads"] for s in experiment_a["samples"])
        error_total = sum(len(s["errors"]) for s in experiment_a["samples"])
        # 判据必须**双向**成立：
        #   加锁后 torn=0 且 无锁对照 torn>0 —— 否则"0"可能只是探针压不到窗口。
        sensitivity_proven = control_torn_total > 0
        verdict_ok = (
            torn_total == 0
            and sensitivity_proven
            and stuck_total == 0
            and error_total == 0
            and experiment_b["ok"]
            and experiment_c["ok"]
        )
        print("\n=== 结论 ===", flush=True)
        print(f"  加锁后 torn_total={torn_total}  stuck_threads={stuck_total}  errors={error_total}")
        print(f"  无锁对照 torn_total={control_torn_total}（灵敏度证明={'成立' if sensitivity_proven else '不成立'})")
        print(f"  reentrant_ok={experiment_b['ok']}  concurrent_writes_ok={experiment_c['ok']}")
        print(f"  {'PASS' if verdict_ok else 'FAIL'}", flush=True)
        return 0 if verdict_ok else 1
    finally:
        server.stop()


if __name__ == "__main__":
    raise SystemExit(main())
