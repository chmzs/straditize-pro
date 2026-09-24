"""E2E test fixture launching background backend on an isolated port."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
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


def run_playwright_eval(url: str, js_code: str) -> str:
    """Run JS in browser via playwright-cli and return result string."""
    run_cmd = [
        "node",
        PLAYWRIGHT_CLI,
        "run-code",
        f"async (page) => {{ await page.goto('{url}'); await page.waitForLoadState('networkidle'); return await page.evaluate(() => {{ {js_code} }}); }}",
    ]
    res = subprocess.run(run_cmd, capture_output=True, text=True, encoding="utf-8", check=False)
    return res.stdout.strip()
