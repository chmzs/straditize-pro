# -*- coding: utf-8 -*-
"""Unit tests for straditize_core structured logging and system RPC logging methods."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import tempfile

from straditize_core.logging_config import (
    clean_old_logs,
    get_log_dir,
    get_log_file_path,
    setup_logging,
)
from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import system


def test_logging_config_paths() -> None:
    """Log directory and file paths should be valid Path objects and exist."""
    d = get_log_dir()
    assert isinstance(d, Path)
    assert d.exists()
    assert d.is_dir()

    f = get_log_file_path()
    assert isinstance(f, Path)
    assert f.parent == d
    assert f.name == "straditize.log"


def test_setup_logging_rotation() -> None:
    """setup_logging must attach RotatingFileHandler with 5MB cap and 3 backups."""
    log_path = setup_logging()
    assert log_path.exists()

    root_logger = logging.getLogger()
    rotating_handlers = [
        h for h in root_logger.handlers if isinstance(h, RotatingFileHandler)
    ]
    assert len(rotating_handlers) >= 1
    handler = rotating_handlers[0]
    assert handler.maxBytes == 5 * 1024 * 1024
    assert handler.backupCount == 3


def test_clean_old_logs(monkeypatch) -> None:
    """clean_old_logs should prune log files older than retention days."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        monkeypatch.setattr("straditize_core.logging_config.get_log_dir", lambda: tmp_path)

        # Create an old rotated log and a fresh one
        old_file = tmp_path / "straditize.log.1"
        old_file.write_text("old logs", encoding="utf-8")
        fresh_file = tmp_path / "straditize.log.2"
        fresh_file.write_text("fresh logs", encoding="utf-8")
        primary_file = tmp_path / "straditize.log"
        primary_file.write_text("primary", encoding="utf-8")

        # Fake mtime: old_file 10 days ago, fresh_file 1 hour ago
        import time
        now = time.time()
        import os
        os.utime(old_file, (now - 10 * 86400, now - 10 * 86400))
        os.utime(fresh_file, (now - 3600, now - 3600))
        os.utime(primary_file, (now - 10 * 86400, now - 10 * 86400))

        clean_old_logs(max_age_days=7)

        # old_file should be deleted, fresh_file and primary should remain
        assert not old_file.exists()
        assert fresh_file.exists()
        assert primary_file.exists()


def test_system_logging_rpc_methods() -> None:
    """RPC methods getLogInfo, openLogDir, and logClientError should function."""
    dispatcher = JsonRpcDispatcher()
    fake_session = object()
    system.register(dispatcher, fake_session)

    # 1. system.getLogInfo
    info = dispatcher.handle_object({"jsonrpc": "2.0", "id": 1, "method": "system.getLogInfo"})
    assert isinstance(info, dict)
    assert "result" in info
    res = info["result"]
    assert "log_dir" in res
    assert "log_file" in res
    assert "file_size_bytes" in res
    assert isinstance(res["file_size_bytes"], int)

    # 2. system.logClientError
    log_res = dispatcher.handle_object({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "system.logClientError",
        "params": {
            "message": "Test client uncaught error",
            "stack": "Error: boom\n  at test (app.js:10:5)",
            "url": "http://127.0.0.1:8765/#step-6",
            "context": {"stage": 6, "mode": "select"},
        },
    })
    assert isinstance(log_res, dict)
    assert "result" in log_res
    assert log_res["result"] == {"logged": True}
