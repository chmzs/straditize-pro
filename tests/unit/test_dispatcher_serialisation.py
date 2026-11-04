# -*- coding: utf-8 -*-
"""`JsonRpcDispatcher` 必须串行化同 session 请求的回归钉子（B-08）。

## 缺陷本体

服务端每请求一线程（`rpc_server.py` 的 `ThreadingHTTPServer`），所有线程共享
**同一个** session。`load_image` 是多步写：先写 `width/height`，再 `_init_rois()`
清空 `rois`，再 `roi_create()` 回填。中间窗口被另一线程读到就是
"有图宽、但 `rois: []`"的撕裂态。

## 为什么锁必须是 `RLock` 而不是 `Lock`

dispatch **真的会重入**，不是理论可能：

    tools/call → naming.py:mcp_tools_call
               → StraditizeWebMcpServer.call_tool
               → _call_rpc(web_rpc_url=None)
               → dispatcher.handle_object(...)   # 同线程再进 execute_request

`threading.Lock` 会在第二次 `acquire()` 自锁，而且锁在请求线程里、`release`
永远到不了，整个服务端**永久挂死**。本文件用带超时的方式钉这一条：
自锁会表现为"线程 join 超时"，而不是崩溃。

## 灵敏度必须自证

`tests/unit` 里只钉"加锁后不撕裂"是不够的——若这条测试本身压不到撕裂窗口，
它恒绿且零信息量。故本文件先跑一次**无锁对照**（把 `_request_lock` 换成空实现），
断言该对照**确实**能观测到撕裂，再断言加锁后为 0。两者缺一，这条钉子就是假的。

（HTTP 层的完整压测（含重入与并发写）在
`scripts/lock_probe/probe_b08_dispatcher_lock.py`（2026-11-04 已归档，见 tag `audit-2026-11-04`），
那是投产验收用的独立脚本。）
"""
from __future__ import annotations

import contextlib
import threading

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession


def _torn_snapshot(session: StraditizeSession) -> dict:
    """读一次会撕裂的状态：图像尺寸 vs ROI 存在性。"""
    return {
        "imageWidth": session.width or 0,
        "rois": len(getattr(session, "rois", []) or []),
        "primaryRoiId": getattr(session, "primary_roi_id", None),
    }


def _is_torn(snapshot: dict) -> bool:
    return bool(snapshot["imageWidth"]) and (
        snapshot["rois"] == 0 or snapshot["primaryRoiId"] is None
    )


@contextlib.contextmanager
def _unlocked_control(dispatcher):
    """临时把请求锁换成空实现，用于证明探针对撕裂敏感。"""

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


def _race_reads_during_image_switch(
    dispatcher,
    session: StraditizeSession,
    *,
    rounds: int = 2,
    minimum_reads: int = 20,
) -> dict:
    """一边换图一边读，统计撕裂读数。

    判据用 `execute_request` 的真实入口（`handle_object`），走的是 HTTP 层
    完全相同的代码路径。`minimum_reads` 保证采样量：不加锁时读线程会迅速
    抢到窗口，加锁后每个读请求排队在写请求后面，样本太少则"0 撕裂"无意义。
    """
    torn_total = 0
    reads_total = 0
    stuck: list[threading.Thread] = []
    for _ in range(rounds):
        session.project_new(clear_image=True)
        session.load_image(sample_key="hoya")
        observed: list[dict] = []
        writer_done = threading.Event()

        def writer() -> None:
            try:
                dispatcher.handle_object(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "core.loadImage",
                        "params": {"sample_key": "beginner"},
                    }
                )
            finally:
                writer_done.set()

        def reader() -> None:
            reads = 0
            while not writer_done.is_set() or reads < minimum_reads:
                dispatcher.handle_object(
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "straditize.getDiagramData",
                        "params": {},
                    }
                )
                observed.append(_torn_snapshot(session))
                reads += 1

        threads = [threading.Thread(target=writer)] + [
            threading.Thread(target=reader) for _ in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=90)
        stuck.extend(thread for thread in threads if thread.is_alive())

        reads_total += len(observed)
        torn_total += sum(1 for snapshot in observed if _is_torn(snapshot))
    return {"torn": torn_total, "reads": reads_total, "stuck": len(stuck)}


class TestRequestSerialisation:
    def test_unlocked_control_can_observe_tearing(self) -> None:
        """灵敏度证明：无锁时本测试**必须**能观测到撕裂，否则下面那条是假绿。"""
        session = StraditizeSession()
        session._init_cleanup()
        dispatcher = create_rpc_dispatcher(session)

        with _unlocked_control(dispatcher):
            outcome = _race_reads_during_image_switch(dispatcher, session)

        assert outcome["torn"] > 0, (
            "无锁对照没有观测到撕裂 —— 本文件对 B-08 不敏感，"
            "'加锁后 0 撕裂' 将毫无信息量（压测压不到窗口）"
        )

    def test_locked_dispatcher_shows_no_tearing(self) -> None:
        """正钉：同一个压测，加锁后撕裂必须为 0。"""
        session = StraditizeSession()
        session._init_cleanup()
        dispatcher = create_rpc_dispatcher(session)

        outcome = _race_reads_during_image_switch(dispatcher, session)

        assert outcome["stuck"] == 0, "读/写线程未在超时内结束 —— 疑似死锁"
        assert outcome["reads"] > 0, "前置：应有读数"
        assert outcome["torn"] == 0, (
            f"加锁后仍观测到 {outcome['torn']}/{outcome['reads']} 次撕裂读数 —— "
            "同一 session 的请求未被串行化（B-08）"
        )

    def test_final_state_is_self_consistent(self) -> None:
        """并发结束后静态回读必须自洽（新图 + 恰好一个 ROI）。"""
        session = StraditizeSession()
        session._init_cleanup()
        dispatcher = create_rpc_dispatcher(session)

        _race_reads_during_image_switch(dispatcher, session)

        final = _torn_snapshot(session)
        assert final["imageWidth"] == 1923, "应停在 beginner（1923px 宽）"
        assert final["rois"] == 1
        assert final["primaryRoiId"] == "roi_1"


class TestReentrancyDoesNotDeadlock:
    """`Lock` 会让这两条**挂死**而不是失败，故用带超时的线程 join 判定。"""

    def _assert_returns_within(self, dispatcher, method: str) -> None:
        outcome: dict = {}

        def call() -> None:
            outcome["response"] = dispatcher.handle_object(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": {"name": "straditize_get_status", "arguments": {}},
                }
            )

        worker = threading.Thread(target=call, daemon=True)
        worker.start()
        worker.join(timeout=30)

        assert not worker.is_alive(), (
            f"{method} 在 30s 内未返回 —— dispatcher 用 Lock 而非 RLock 时会自锁死；"
            "锁在请求线程里，release 永远到不了，整个服务端永久挂死"
        )
        response = outcome.get("response")
        assert response is not None, f"{method} 返回了空响应"
        assert "result" in response, f"{method} 未返回 result：{response}"

    def test_tools_call_reenters_without_deadlock(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        self._assert_returns_within(create_rpc_dispatcher(session), "tools/call")

    def test_webmcp_call_tool_reenters_without_deadlock(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        self._assert_returns_within(create_rpc_dispatcher(session), "webmcp.callTool")


class TestLockIsReentrantAndPerDispatcher:
    def test_lock_is_an_rlock(self) -> None:
        """直接钉锁的类型：换成 `threading.Lock` 时这条立刻变红。"""
        dispatcher = create_rpc_dispatcher(StraditizeSession())
        assert hasattr(dispatcher, "_request_lock"), (
            "dispatcher 没有请求锁 —— B-08 又回到了无锁状态"
        )
        assert type(dispatcher._request_lock).__name__ == "RLock", (
            "请求锁不是 RLock —— tools/call 的重入链会自锁死"
        )

    def test_two_dispatchers_do_not_block_each_other(self) -> None:
        """锁是**每 dispatcher 一把**：两个独立服务不该互相排队。"""
        first = create_rpc_dispatcher(StraditizeSession())
        second = create_rpc_dispatcher(StraditizeSession())
        assert first._request_lock is not second._request_lock

        # 一个 dispatcher 持锁的同时，另一个必须能正常执行。
        acquired = threading.Event()
        release = threading.Event()

        def hold_first() -> None:
            with first._request_lock:
                acquired.set()
                release.wait(timeout=30)

        holder = threading.Thread(target=hold_first, daemon=True)
        holder.start()
        assert acquired.wait(timeout=10), "前置：应能获取第一个 dispatcher 的锁"
        try:
            response = second.handle_object(
                {"jsonrpc": "2.0", "id": 1, "method": "system.ping", "params": {}}
            )
            assert "result" in response
        finally:
            release.set()
            holder.join(timeout=10)


class TestExceptionsStillReleaseTheLock:
    """锁必须用 `with` 保证异常路径也释放，否则一次报错就永久锁死。"""

    @pytest.mark.parametrize(
        "method",
        ["no.such.method", "core.detectColumns"],  # 未注册 / 前置状态缺失
    )
    def test_failed_request_leaves_dispatcher_usable(self, method: str) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        dispatcher = create_rpc_dispatcher(session)

        failed = dispatcher.handle_object(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": {}}
        )
        assert failed is not None and "error" in failed, "前置：该请求应当失败"

        # 同一个 dispatcher 必须还能继续服务（没有把锁留在已持有状态）
        outcome: dict = {}

        def call() -> None:
            outcome["response"] = dispatcher.handle_object(
                {"jsonrpc": "2.0", "id": 2, "method": "system.ping", "params": {}}
            )

        worker = threading.Thread(target=call, daemon=True)
        worker.start()
        worker.join(timeout=15)
        assert not worker.is_alive(), (
            f"{method} 失败后 dispatcher 被永久锁住 —— 异常路径没有释放锁"
        )
        assert "result" in outcome["response"]
