"""E2E test fixture launching background backend on an isolated port."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from typing import Generator

import pytest

from straditize_core.rpc_server import StraditizeRpcHttpServer, create_rpc_dispatcher
from straditize_core.session import StraditizeSession

PLAYWRIGHT_CLI = r"D:\Program Files\nodejs\node_global\node_modules\@playwright\cli\playwright-cli.js"


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def e2e_server() -> Generator[dict, None, None]:
    """Starts an isolated Straditize Pro server with Hoya loaded for E2E tests."""
    port_env = os.environ.get("STRADITIZE_E2E_PORT")
    port = int(port_env) if port_env else get_free_port()

    # Isolate test config path so E2E tests never pollute user's ~/.straditize/config.json
    temp_config_dir = tempfile.mkdtemp(prefix="straditize_e2e_cfg_")
    temp_config_path = os.path.join(temp_config_dir, "config.json")
    with open(temp_config_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "remote_access_enabled": False,
                "allowed_hosts": ["127.0.0.1", "localhost"],
                "locale": "zh-CN",
                "theme": "light",
            },
            f,
            indent=2,
        )
    old_cfg_env = os.environ.get("STRADITIZE_CONFIG_PATH")
    os.environ["STRADITIZE_CONFIG_PATH"] = temp_config_path

    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns([315, 1946], [511, 1311])
    session.is_desktop_mode = True

    dispatcher = create_rpc_dispatcher(session)
    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()

    # Wait for server ready
    ready = False
    for _ in range(50):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1.0) as resp:
                if resp.status == 200:
                    ready = True
                    break
        except Exception:
            time.sleep(0.1)

    if not ready:
        server.stop()
        raise RuntimeError(f"E2E test server failed to start on 127.0.0.1:{port}")

    yield {
        "port": port,
        "url": f"http://127.0.0.1:{port}/",
        "session": session,
    }

    server.stop()
    if old_cfg_env is not None:
        os.environ["STRADITIZE_CONFIG_PATH"] = old_cfg_env
    else:
        os.environ.pop("STRADITIZE_CONFIG_PATH", None)
    try:
        if os.path.exists(temp_config_path):
            os.remove(temp_config_path)
        os.rmdir(temp_config_dir)
    except OSError:
        pass


def run_playwright_eval(url: str, js_code: str, session_name: str = "e2e_session") -> str:
    """Run JS in real MS Edge browser via playwright-cli session and return raw evaluated result."""
    # Ensure any stale session is killed first
    subprocess.run(
        ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "close"],
        capture_output=True,
        check=False,
    )

    open_cmd = [
        "node",
        PLAYWRIGHT_CLI,
        f"-s={session_name}",
        "open",
        "--browser=msedge",
        url,
    ]
    open_res = subprocess.run(open_cmd, capture_output=True, text=True, encoding="utf-8", check=False)
    if open_res.returncode != 0:
        raise RuntimeError(f"Failed to open msedge at {url}: {open_res.stdout}\n{open_res.stderr}")

    try:
        # Wait a short moment for front-end Vite bundle to initialize DOM components
        time.sleep(1.5)

        # Evaluate JavaScript expression inside page
        eval_cmd = [
            "node",
            PLAYWRIGHT_CLI,
            f"-s={session_name}",
            "eval",
            f"() => {{ {js_code} }}",
        ]
        eval_res = subprocess.run(eval_cmd, capture_output=True, text=True, encoding="utf-8", check=False)
        if eval_res.returncode != 0:
            raise RuntimeError(f"Failed to evaluate code in browser: {eval_res.stdout}\n{eval_res.stderr}")

        output = eval_res.stdout
        # Extract the content from playwright-cli's markdown result block
        m = re.search(r"### Result\s*\n(.*?)(?:\n###|\Z)", output, re.DOTALL)
        if m:
            raw_val = m.group(1).strip()
            # If wrapped in JSON string quotes, decode it
            if raw_val.startswith('"') and raw_val.endswith('"'):
                try:
                    return json.loads(raw_val)
                except Exception:
                    return raw_val[1:-1]
            return raw_val

        return output.strip()
    finally:
        subprocess.run(
            ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "close"],
            capture_output=True,
            check=False,
        )


def run_playwright_console(
    url: str, min_level: str = "error", session_name: str = "e2e_console"
) -> str:
    """打开真实浏览器加载页面，取回该会话的控制台消息。

    与 `run_playwright_eval` 同源，但走 `console` 子命令——用来断言
    「页面加载后控制台有/没有 N 条 error」，这类缺陷 headless 单测抓不到。
    """
    subprocess.run(
        ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "close"],
        capture_output=True,
        check=False,
    )
    open_res = subprocess.run(
        ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "open", "--browser=msedge", url],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if open_res.returncode != 0:
        raise RuntimeError(f"Failed to open msedge at {url}: {open_res.stdout}\n{open_res.stderr}")

    try:
        # 冷启动时 Edge + bundle 初始化可能远超固定延时，控制台还没产生消息就去
        # 读会读到 0 条——改成轮询：只要还在出消息就继续等，最多 ~10s。
        result = ""
        for _ in range(10):
            time.sleep(1.0)
            res = subprocess.run(
                ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "console", min_level],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            result = f"{res.stdout or ''}\n{res.stderr or ''}"
            m = re.search(r"Total messages:\s*(\d+)", result)
            if m and int(m.group(1)) > 0:
                # 至少拿到一条消息；再等一拍把可能的尾随消息收齐
                time.sleep(1.0)
                res2 = subprocess.run(
                    ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "console", min_level],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    check=False,
                )
                return f"{res2.stdout or ''}\n{res2.stderr or ''}"
        return result
    finally:
        subprocess.run(
            ["node", PLAYWRIGHT_CLI, f"-s={session_name}", "close"],
            capture_output=True,
            check=False,
        )
