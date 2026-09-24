"""E2E test fixture launching background backend on an isolated port."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
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
