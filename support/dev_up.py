# -*- coding: utf-8 -*-
"""一条命令起「后端 + vite dev」的开发栈，用于热更新调试。

## 它解决的两个真实陷阱

1. **`--port` 会被静默改**：`gateway/cli.py` 的 `start_desktop_mode` 用
   `find_available_port(args.port or 8765)`，8765 被占时后端会自己跑到 8766，
   而 `frontend/vite.config.ts` 的代理目标写死 `STRADITIZE_BACKEND ?? 8765`
   —— 于是"前后端连不上"，实际只是端口漂了。本脚本**先探测再启动**，
   并把你指定的端口透传给 vite 的代理，端口永不漂。

2. **单实例锁会让新进程静默退出**：已有桌面实例活着时，`start_desktop_mode`
   直接 `return`（只开个浏览器标签）。本脚本先看 `%TEMP%\\straditize_desktop.lock`：
   若已有活实例，就**复用**它并说明原因，而不是假装起了一个新后端。
   确实要并行第二份时用 `--mode serve`（`serve` 子命令不走单实例分支）。

## 用法

    pixi run python support/dev_up.py              # 后端 8765 + vite 5173
    pixi run python support/dev_up.py --mode serve # 绕开单实例锁（可多开）
    pixi run python support/dev_up.py --sample hoya   # 起后端时顺带载入范例图
    pixi run python support/dev_up.py --no-vite     # 只起后端（自己另跑前端）

Ctrl+C 一次性收掉两个子进程（含 npm 派生的 node）。
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.35) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def backend_healthy(port: int) -> bool:
    """后端就绪的判据是 /health 返回本服务，而不是"端口通了"。"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.0) as resp:
            return b"straditize" in resp.read(4096).lower()
    except (urllib.error.URLError, OSError):
        return False


def read_desktop_lock() -> int | None:
    lock = Path(tempfile.gettempdir()) / "straditize_desktop.lock"
    if not lock.exists():
        return None
    try:
        return int(lock.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def wait_until(predicate, timeout: float, interval: float = 0.4) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def kill_tree(pid: int) -> None:
    """Windows 上必须按进程树杀：npm 会派生 node，只杀 npm 会留下孤儿。"""
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:  # pragma: no cover - 本机是 Windows，仅保留可移植路径
        try:
            os.kill(pid, 15)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="起 Straditize 开发栈（后端 + vite dev）")
    parser.add_argument("--backend-port", type=int, default=8765)
    parser.add_argument("--mode", choices=("desktop", "serve"), default="desktop",
                        help="desktop=真实桌面后端（单实例）；serve=无单实例约束，可多开")
    parser.add_argument("--sample", default=None, help="起后端时载入内置范例（如 hoya）")
    parser.add_argument("--image", default=None, help="起后端时载入指定图片")
    parser.add_argument("--no-vite", action="store_true", help="只起后端")
    args = parser.parse_args()

    if shutil.which("pixi") is None:
        print("[FAIL] 找不到 pixi（项目环境必需）", file=sys.stderr)
        return 1

    procs: list[tuple[str, subprocess.Popen]] = []
    backend_reused = False

    try:
        # ---------- 后端 ----------
        if backend_healthy(args.backend_port):
            print(f"[reuse] {args.backend_port} 上已有健康的 Straditize 后端，直接复用")
            backend_reused = True
        else:
            if port_open(args.backend_port):
                print(
                    f"[FAIL] {args.backend_port} 被占用但不是 Straditize（先释放，或换 --backend-port）",
                    file=sys.stderr,
                )
                return 1

            lock_port = read_desktop_lock()
            if args.mode == "desktop" and lock_port and backend_healthy(lock_port):
                print(
                    f"[FAIL] 已有桌面实例在 {lock_port}：desktop 模式会静默并入它，"
                    f"--backend-port 不生效。要并行请用 --mode serve",
                    file=sys.stderr,
                )
                return 1

            base = [sys.executable, "-m", "straditize_core.rpc_server"]
            if args.mode == "serve":
                cmd = [*base, "serve", "--port", str(args.backend_port)]
            else:
                cmd = [*base, "--no-browser", "--port", str(args.backend_port)]
                if args.sample:
                    cmd += ["--sample", args.sample]
                if args.image:
                    cmd += ["--image", args.image]

            print(f"[start] 后端({args.mode}) : {' '.join(cmd[1:])}")
            procs.append(("backend", subprocess.Popen(cmd, cwd=str(REPO))))

            if not wait_until(lambda: backend_healthy(args.backend_port), timeout=90):
                print("[FAIL] 后端 90 s 内未就绪（看上面的后端输出）", file=sys.stderr)
                return 1
            print(f"[ok] 后端就绪 http://127.0.0.1:{args.backend_port}/")

        # ---------- vite ----------
        if args.no_vite:
            print("\n后端已在跑。前端请另起：npm --prefix frontend run dev")
            print(f"（vite 代理目标需指向本后端）STRADITIZE_BACKEND=http://127.0.0.1:{args.backend_port}")
        else:
            npm_exe = shutil.which("npm")
            if npm_exe is None:
                print("[FAIL] 找不到 npm", file=sys.stderr)
                return 1
            env = dict(os.environ)
            # 端口不写死：让 vite 代理跟着本次的后端端口走
            env["STRADITIZE_BACKEND"] = f"http://127.0.0.1:{args.backend_port}"
            print("[start] vite dev (npm --prefix frontend run dev)")
            # Windows 上 npm 是 npm.CMD：必须用 which 解析出的**带扩展名**路径，
            # 否则 CreateProcess 不做 PATHEXT 解析，直接 FileNotFoundError[WinError 2]。
            try:
                procs.append(
                    ("vite", subprocess.Popen([npm_exe, "run", "dev"], cwd=str(FRONTEND), env=env))
                )
            except OSError as exc:
                print(f"[FAIL] 起 vite 失败：{exc}", file=sys.stderr)
                return 1
            if not wait_until(lambda: port_open(5173) or port_open(5174), timeout=90):
                print("[FAIL] vite 90 s 内未就绪", file=sys.stderr)
                return 1
            vite_port = 5173 if port_open(5173) else 5174
            print(
                f"[ok] 前端就绪 http://127.0.0.1:{vite_port}/ "
                f"（代理 → 后端 {args.backend_port}；改 src 即热更新）"
            )

        print("\n调试入口：")
        print(f"  RPC      POST http://127.0.0.1:{args.backend_port}/rpc")
        print(f"  健康     GET  http://127.0.0.1:{args.backend_port}/health")
        print("  句柄     window.__straditize（getState / gotoStage / rpc）")
        print("\nCtrl+C 结束（会连带收掉 npm 派生的 node）\n")

        while True:
            for name, proc in procs:
                code = proc.poll()
                if code is not None:
                    print(f"[exit] {name} 退出，code={code}；一并收尾", file=sys.stderr)
                    return 1 if code else 0
            time.sleep(1.0)

    except KeyboardInterrupt:
        print("\n[stop] 收到 Ctrl+C，正在收尾…")
        return 0
    finally:
        for name, proc in reversed(procs):
            if proc.poll() is None:
                kill_tree(proc.pid)
                print(f"[stop] {name} 已终止 (pid={proc.pid})")
        if backend_reused:
            print("[stop] 复用的后端实例保持运行（本脚本不负责停它）")


if __name__ == "__main__":
    sys.exit(main())
