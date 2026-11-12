# -*- coding: utf-8 -*-
"""开发/测试环境自检（只读）。

## 为什么要这个脚本

本机踩过的环境故障都属于"不报错、只表现成别的问题"这一类：

* `pixi run pytest` 报 `uv trampoline failed to canonicalize script path`
  （pip 装的 console script 坏了），而 `python -m pytest` 正常 —— 看着像测试挂了；
* `straditize serve`/桌面模式在 8765 被占时会 **静默换端口**
  （`gateway/cli.py` 的 `find_available_port`），而 vite 代理写死 8765 ——
  看着像"前后端连不上"，其实是后端跑到 8766 去了；
* 已有桌面实例存活时，新起的 `app` 会**立刻返回**（只开一个浏览器标签，
  `start_desktop_mode` 的 single-instance 分支）—— 看着像"命令没执行"；
* ego 浏览器的 profile 锁被活 Edge 持有 → 所有 `ego_*` 工具 `EBUSY`；
* `timeout <npx …>` 直接 exit 126（`timeout` 不能执行 `.cmd` shim）。

本脚本把这些一次性摊开，给一张 PASS/WARN/FAIL 表。**只读**：不启停任何服务、
不杀进程、不删文件。

## 用法

    pixi run python support/dev_doctor.py          # 人读
    pixi run python support/dev_doctor.py --json   # 机读（CI / 脚本消费）
    pixi run python support/dev_doctor.py --tsc    # 额外跑 tsc 类型检查（约 30 s）

退出码：0 = 无 FAIL；1 = 至少一项 FAIL（WARN 不影响退出码）。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"
DEFAULT_BACKEND_PORT = 8765
VITE_PORT = 5173
# e2e 并发时用的端口段（见 docs/dev-playbook.md）
E2E_PORT_HINT = (23010, 23015)
# zero lane 的端口被 playwright.zero.config.ts 硬校验在 22920-22930
ZERO_PORT_RANGE = (22920, 22930)

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"
rows: list[tuple[str, str, str]] = []


def add(item: str, status: str, detail: str) -> None:
    rows.append((item, status, detail))


def run(cmd: list[str], *, cwd: Path | None = None, timeout: float = 60.0) -> tuple[int, str]:
    """跑到结束并回收输出；任何异常都折成 (非零, 文本)，不抛。"""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or REPO),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, f"{type(exc).__name__}: {exc}"


def first_line(text: str) -> str:
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return ""


# ---------------------------------------------------------------------------
# 1 Python / pytest
# ---------------------------------------------------------------------------
def check_python() -> None:
    env_py = REPO / ".pixi" / "envs" / "default" / "python.exe"
    if env_py.exists():
        code, out = run([str(env_py), "-V"])
        add("python(项目 env)", PASS if code == 0 else FAIL, first_line(out) or f"exit={code}")
    else:
        add("python(项目 env)", FAIL, f"缺 {env_py}（先跑 pixi install）")

    code, out = run([sys.executable, "-c", "import straditize_core; print(straditize_core.__file__)"])
    add("import straditize_core", PASS if code == 0 else FAIL, first_line(out) or f"exit={code}")

    # 裸 pytest 入口是否坏（坏也不致命，只要知道该走 -m）
    bare = REPO / ".pixi" / "envs" / "default" / "Scripts" / "pytest.exe"
    if not bare.exists():
        add("pytest 裸入口", SKIP, "env 内无 pytest.exe")
    else:
        code, out = run([str(bare), "--version"], timeout=30)
        if code == 0:
            add("pytest 裸入口", PASS, first_line(out))
        else:
            add(
                "pytest 裸入口",
                WARN,
                "坏了（uv trampoline）；等价替代：`pixi run python -m pytest`",
            )

    code, out = run([sys.executable, "-m", "pytest", "--version"], timeout=60)
    add("python -m pytest", PASS if code == 0 else FAIL, first_line(out) or f"exit={code}")


# ---------------------------------------------------------------------------
# 2 Node / 前端
# ---------------------------------------------------------------------------
def check_node(*, tsc: bool) -> None:
    for label, cmd in (("node", ["node", "-v"]), ("npm", ["npm", "-v"])):
        exe = shutil.which(cmd[0])
        if exe is None:
            add(label, FAIL, "不在 PATH")
            continue
        code, out = run([exe, cmd[1]], timeout=60)
        add(label, PASS if code == 0 else FAIL, first_line(out) or f"exit={code}")

    dist_index = FRONTEND / "dist" / "index.html"
    if not dist_index.exists():
        add("frontend/dist", WARN, "缺 dist/index.html：后端无法托管界面，先 `npm --prefix frontend run build`")
    else:
        newest_src = 0.0
        for pattern in ("src/**/*.ts", "src/**/*.css", "index.html"):
            for path in FRONTEND.glob(pattern):
                newest_src = max(newest_src, path.stat().st_mtime)
        dist_mtime = dist_index.stat().st_mtime
        if newest_src > dist_mtime:
            add(
                "frontend/dist",
                WARN,
                f"dist 比 src 旧 {int(newest_src - dist_mtime)} s：正在跑的是旧产物，先 build",
            )
        else:
            add("frontend/dist", PASS, f"index.html {time.strftime('%m-%d %H:%M', time.localtime(dist_mtime))}")

    npx = shutil.which("npx") or "npx"
    code, out = run([npx, "playwright", "--version"], cwd=FRONTEND, timeout=120)
    add("playwright", PASS if code == 0 else FAIL, first_line(out) or f"exit={code}")

    edge = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    add("系统 Edge(channel=msedge)", PASS if edge.exists() else FAIL, str(edge) if edge.exists() else "未找到")

    if not tsc:
        add("tsc 类型检查", SKIP, "加 --tsc 才跑（约 30 s）")
        return
    for label, proj in (("tsc src", "tsconfig.json"), ("tsc e2e", "tsconfig.e2e.json")):
        code, out = run([npx, "tsc", "-p", proj, "--noEmit"], cwd=FRONTEND, timeout=600)
        add(label, PASS if code == 0 else FAIL, "clean" if code == 0 else first_line(out))


# ---------------------------------------------------------------------------
# 3 端口与服务
# ---------------------------------------------------------------------------
def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.35) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def pid_on_port(port: int) -> str:
    """用 netstat 反查 LISTENING 的 PID；查不到返回 '?'。"""
    code, out = run(["netstat", "-ano"], timeout=30)
    if code != 0:
        return "?"
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[3] == "LISTENING" and parts[1].endswith(f":{port}"):
            return parts[4]
    return "?"


def describe_port(port: int) -> tuple[bool, str]:
    if not port_open(port):
        return False, "空闲"
    return True, f"被占用 (PID {pid_on_port(port)})"


def check_ports() -> None:
    busy, detail = describe_port(DEFAULT_BACKEND_PORT)
    add(f"端口 {DEFAULT_BACKEND_PORT} 后端", WARN if busy else PASS, detail)

    busy, detail = describe_port(VITE_PORT)
    add(f"端口 {VITE_PORT} vite dev", WARN if busy else PASS, detail)

    lo, hi = E2E_PORT_HINT
    taken = [f"{p}({pid_on_port(p)})" for p in range(lo, hi + 1) if port_open(p)]
    add(
        f"端口 {lo}-{hi} e2e",
        WARN if taken else PASS,
        f"被占：{', '.join(taken)}" if taken else "全空闲",
    )


def check_desktop_lock() -> None:
    """桌面模式单实例锁：存在且端口活着 ⇒ 新起的 `app` 会静默并入旧实例。"""
    lock = Path(tempfile.gettempdir()) / "straditize_desktop.lock"
    if not lock.exists():
        add("desktop 单实例锁", PASS, "无（下次 `app` 会正常起）")
        return
    try:
        port = int(lock.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        add("desktop 单实例锁", WARN, f"存在但内容不可解析：{lock}")
        return
    if port_open(port):
        add(
            "desktop 单实例锁",
            WARN,
            f"有活实例在 {port}：再跑 `app` 只会开个浏览器标签就退出；`--port` 不生效",
        )
    else:
        add("desktop 单实例锁", WARN, f"残留锁指向 {port}（已无监听）；下次启动会自愈")


def check_ego() -> None:
    """ego 浏览器 profile 锁：只报占用者，绝不删锁/杀进程。"""
    profile_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "ego-lite-linux" / "profile"
    lock = profile_dir / "lockfile"
    cast = profile_dir.parent / "ego-cast.json"
    if not lock.exists():
        add("ego profile 锁", PASS, "无 lockfile")
        return
    holder = ""
    if cast.exists():
        try:
            info = json.loads(cast.read_text(encoding="utf-8"))
            pid = int(info.get("pid") or 0)
            alive = run(["tasklist", "/FI", f"PID eq {pid}"], timeout=30)[1]
            holder = f"，ego-cast pid={pid}{'（活）' if str(pid) in alive else '（已退）'}"
        except (OSError, ValueError):
            holder = "，ego-cast.json 不可解析"
    add(
        "ego profile 锁",
        WARN,
        f"lockfile {lock.stat().st_size} B, mtime "
        f"{time.strftime('%m-%d %H:%M', time.localtime(lock.stat().st_mtime))}{holder}"
        "；被活 Edge 持有时 ego_* 会 EBUSY（属别的会话，别删别杀）",
    )


# ---------------------------------------------------------------------------
# 4 磁盘
# ---------------------------------------------------------------------------
def check_disk() -> None:
    for label, path in (("C:", "C:\\"), ("E:", "E:\\")):
        try:
            usage = shutil.disk_usage(path)
        except OSError as exc:
            add(f"磁盘 {label}", WARN, str(exc))
            continue
        free_gb = usage.free / 1024**3
        status = PASS if free_gb > 5 else FAIL
        add(f"磁盘 {label}", status, f"可用 {free_gb:.0f} G / {usage.total / 1024**3:.0f} G")


# ---------------------------------------------------------------------------
# 5 仓库约定（轻量）
# ---------------------------------------------------------------------------
def check_repo() -> None:
    for name in ("pixi.toml", "frontend/package.json", "support/serve_e2e_backend.py"):
        path = REPO / name
        if not path.exists():
            add(f"仓库文件 {name}", FAIL, "缺失")
            return
    add("仓库骨架", PASS, "pixi.toml / frontend / support 启动器齐备")

    zero_cfg = FRONTEND / "playwright.zero.config.ts"
    if zero_cfg.exists():
        add(
            "zero lane 端口约束",
            PASS,
            f"STRADITIZE_ZERO_PORT 必须落在 {ZERO_PORT_RANGE[0]}-{ZERO_PORT_RANGE[1]}（越界配置期直接抛错）",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Straditize 开发/测试环境自检（只读）")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--tsc", action="store_true", help="额外跑 tsc 类型检查（约 30 s）")
    args = parser.parse_args()

    check_python()
    check_node(tsc=args.tsc)
    check_ports()
    check_desktop_lock()
    check_ego()
    check_disk()
    check_repo()

    fails = [r for r in rows if r[1] == FAIL]
    warns = [r for r in rows if r[1] == WARN]

    if args.json:
        print(
            json.dumps(
                {
                    "repo": str(REPO),
                    "rows": [{"item": i, "status": s, "detail": d} for i, s, d in rows],
                    "fail": len(fails),
                    "warn": len(warns),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        width = max(len(r[0]) for r in rows)
        print(f"\n=== Straditize 环境自检 @ {REPO} ===")
        for item, status, detail in rows:
            print(f"[{status:<4}] {item:<{width}}  {detail}")
        print(f"\n合计 {len(rows)} 项：PASS {len(rows) - len(fails) - len(warns)} / WARN {len(warns)} / FAIL {len(fails)}")
        if fails:
            print("FAIL 项：" + "；".join(f"{i}（{d}）" for i, _, d in fails))
        if warns:
            print("WARN 多为并发占用/历史残留，不阻塞；详见 docs/dev-playbook.md")

    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
