"""Unit tests for remote settings, config persistence, dynamic whitelist, and access control."""

from __future__ import annotations

import json
import os
import socket
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from straditize_core.config import (
    DEFAULT_CONFIG,
    is_host_allowed,
    load_config,
    match_host_pattern,
    save_config,
)
from straditize_core.rpc_server import (
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
)
from straditize_core.session import StraditizeSession


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(autouse=True)
def isolate_test_config(monkeypatch, tmp_path):
    """Enforce complete test isolation; never touch ~/.straditize/config.json."""
    config_file = tmp_path / "isolated_config.json"
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(config_file))


def test_config_defaults_and_persistence(monkeypatch, tmp_path):
    """Test loading defaults, saving, and persisting config."""
    config_file = tmp_path / ".straditize" / "config.json"
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(config_file))

    # Initial load returns defaults
    cfg = load_config()
    assert cfg["remote_access_enabled"] is False
    assert "127.0.0.1" in cfg["allowed_hosts"]
    assert cfg["locale"] == "zh-CN"
    assert cfg["theme"] == "light"

    # Save updates
    updated = save_config({
        "remote_access_enabled": True,
        "allowed_hosts": ["192.168.1.*", "100.*", "my-workstation.lan"],
        "locale": "en",
        "theme": "dark",
    })
    assert updated["remote_access_enabled"] is True
    assert "192.168.1.*" in updated["allowed_hosts"]
    assert updated["locale"] == "en"
    assert updated["theme"] == "dark"

    # Load again to verify file persistence
    reloaded = load_config()
    assert reloaded["remote_access_enabled"] is True
    assert reloaded["allowed_hosts"] == ["192.168.1.*", "100.*", "my-workstation.lan"]
    assert reloaded["locale"] == "en"
    assert reloaded["theme"] == "dark"


def test_host_pattern_matching():
    """Test wildcard and exact host matching."""
    assert match_host_pattern("192.168.1.50", "192.168.1.*") is True
    assert match_host_pattern("192.168.2.50", "192.168.1.*") is False
    assert match_host_pattern("100.80.20.1", "100.*") is True
    assert match_host_pattern("my-workstation.lan", "my-workstation.lan") is True
    assert match_host_pattern("foo.my-workstation.lan", "*.my-workstation.lan") is True
    assert match_host_pattern("127.0.0.1", "127.0.0.1") is True

    allowed = ["127.0.0.1", "localhost", "192.168.1.*", "100.*"]
    assert is_host_allowed("192.168.1.100", allowed) is True
    assert is_host_allowed("100.1.2.3", allowed) is True
    assert is_host_allowed("172.16.0.1", allowed) is False


def test_rpc_system_config_methods(monkeypatch, tmp_path):
    """Test system.getConfig and system.updateConfig RPC endpoints."""
    config_file = tmp_path / "config.json"
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(config_file))

    session = StraditizeSession()
    dispatcher = create_rpc_dispatcher(session)

    # 1. system.getConfig
    req_get = json.dumps({"jsonrpc": "2.0", "method": "system.getConfig", "id": 1})
    res_get = json.loads(dispatcher.handle_text(req_get))
    assert "result" in res_get
    cfg = res_get["result"]
    assert cfg["remote_access_enabled"] is False
    assert cfg["locale"] == "zh-CN"
    assert cfg["theme"] == "light"
    assert "rpc_endpoint" in cfg
    assert cfg["webmcp_endpoint"] == "/mcp"

    # 2. system.updateConfig
    req_up = json.dumps({
        "jsonrpc": "2.0",
        "method": "system.updateConfig",
        "params": {
            "remote_access_enabled": True,
            "allowed_hosts": "192.168.1.*, 100.*",
            "locale": "en",
            "theme": "dark",
        },
        "id": 2,
    })
    res_up = json.loads(dispatcher.handle_text(req_up))
    assert res_up["result"]["success"] is True
    saved_cfg = res_up["result"]["config"]
    assert saved_cfg["remote_access_enabled"] is True
    assert saved_cfg["allowed_hosts"] == ["192.168.1.*", "100.*"]
    assert saved_cfg["locale"] == "en"
    assert saved_cfg["theme"] == "dark"


def test_http_remote_access_blocking_and_dynamic_whitelist(monkeypatch, tmp_path):
    """Test that remote_access_enabled: false blocks external hosts (403),
    and enabling whitelist dynamically permits matching hosts while rejecting others.
    """
    config_file = tmp_path / "config.json"
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(config_file))

    port = get_free_port()
    session = StraditizeSession()
    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        session=session,
        is_desktop_mode=False,
    )
    server.start()

    time.sleep(0.2)

    def make_request(host_header: str, origin: str | None = None) -> tuple[int, dict | str]:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/status",
            headers={"Host": host_header} if host_header else {},
        )
        if origin:
            req.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8")

    try:
        # 1. When remote_access_enabled is False:
        # Loopback is allowed
        status, body = make_request(f"127.0.0.1:{port}")
        assert status == 200

        status, body = make_request(f"localhost:{port}")
        assert status == 200

        # External Host header is blocked with 403
        status, body = make_request(f"192.168.1.100:{port}")
        assert status == 403
        assert "Host header not allowed" in body

        status, body = make_request(f"attacker.com:{port}")
        assert status == 403

        # 2. Dynamically update config via system.updateConfig
        req_up = json.dumps({
            "jsonrpc": "2.0",
            "method": "system.updateConfig",
            "params": {
                "remote_access_enabled": True,
                "allowed_hosts": ["192.168.1.*", "100.*", "my-workstation.lan"],
            },
            "id": 10,
        })
        res_up = json.loads(server.dispatcher.handle_text(req_up))
        assert res_up["result"]["success"] is True

        # 3. Whitelisted external hosts now penetrate (200 OK)
        status, body = make_request(f"192.168.1.100:{port}")
        assert status == 200

        status, body = make_request(f"100.64.0.1:{port}")
        assert status == 200

        status, body = make_request(f"my-workstation.lan:{port}")
        assert status == 200

        # Non-whitelisted hosts remain blocked (403)
        status, body = make_request(f"172.16.0.5:{port}")
        assert status == 403

        status, body = make_request(f"evil.com:{port}")
        assert status == 403

        # Cross-origin request with whitelisted Origin gets CORS headers
        req_cors = urllib.request.Request(
            f"http://127.0.0.1:{port}/status",
            headers={
                "Host": f"192.168.1.100:{port}",
                "Origin": "http://192.168.1.100:5173",
            },
        )
        with urllib.request.urlopen(req_cors, timeout=1.0) as resp:
            assert resp.status == 200
            assert resp.headers.get("Access-Control-Allow-Origin") == "http://192.168.1.100:5173"

    finally:
        server.stop()

