"""Lifecycle management, shutdown hooks, and process cleanup for Straditize servers."""

from __future__ import annotations

import logging
import os
import signal
import socket
import tempfile
import threading
import time
from typing import Any

logger = logging.getLogger("straditize_rpc")

_registered_subprocesses: set[Any] = set()
_shutdown_lock = threading.Lock()
_shutdown_started: dict[int, Any] = {}
_is_shutting_down = False


def register_subprocess(proc: Any) -> None:
    """Register a subprocess to be cleaned up on graceful shutdown."""
    _registered_subprocesses.add(proc)


def cleanup_subprocesses() -> None:
    """Terminate all tracked child processes (e.g. background R scripts, headless instances)."""
    for proc in list(_registered_subprocesses):
        try:
            if hasattr(proc, "poll") and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    proc.kill()
        except Exception as e:
            logger.debug("Error terminating subprocess during cleanup: %s", e)
    _registered_subprocesses.clear()


def cleanup_lock_file(lock_file_path: str | None = None) -> None:
    """Safely remove the desktop single-instance lock file."""
    path = lock_file_path or os.path.join(
        tempfile.gettempdir(), "straditize_desktop.lock"
    )
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.debug("Removed desktop single-instance lock: %s", path)
    except OSError as e:
        logger.debug("Could not remove lock file %s: %s", path, e)


def graceful_shutdown(
    server: Any = None,
    exit_code: int = 0,
    delayed_seconds: float = 0.0,
    shutdown_fn: Any = None,
) -> None:
    """Unified graceful shutdown hook (Single Source of Truth for exit cleanup)."""
    from ..rpc_server import StraditizeRpcHttpServer

    resolved = server or getattr(StraditizeRpcHttpServer, "_active_instance", None)
    key = id(resolved) if resolved is not None else 0

    def _do_shutdown() -> None:
        global _is_shutting_down
        with _shutdown_lock:
            if resolved is None:
                if _is_shutting_down:
                    return
                _is_shutting_down = True
            elif key in _shutdown_started:
                return
            else:
                _shutdown_started[key] = resolved

        if delayed_seconds > 0:
            time.sleep(delayed_seconds)

        logger.info(
            "Executing unified graceful shutdown (cleaning single source of truth)..."
        )
        cleanup_lock_file()

        srv = resolved
        if srv is not None:
            try:
                srv.stop()
            except Exception as e:
                logger.debug("Error stopping HTTP server during shutdown: %s", e)

        cleanup_subprocesses()

        fn = (
            shutdown_fn
            or (getattr(srv, "_shutdown_fn", None) if srv else None)
            or os._exit
        )
        logger.info("Graceful shutdown completed. Exiting.")
        try:
            fn(exit_code)
        except TypeError:
            fn()

    if delayed_seconds > 0:
        threading.Thread(target=_do_shutdown, daemon=True).start()
    else:
        _do_shutdown()


def setup_signal_handlers(server: Any = None) -> None:
    """Register SIGINT and SIGTERM handlers to trigger unified graceful_shutdown."""

    def _on_signal(signum, frame):
        logger.info(
            "Captured signal %d (SIGINT/SIGTERM), triggering graceful shutdown...",
            signum,
        )
        graceful_shutdown(server=server, exit_code=0, delayed_seconds=0.0)

    try:
        signal.signal(signal.SIGINT, _on_signal)
    except (ValueError, AttributeError):
        pass
    try:
        signal.signal(signal.SIGTERM, _on_signal)
    except (ValueError, AttributeError):
        pass


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a network port is currently open/bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def find_available_port(
    start_port: int = 8765, max_attempts: int = 50, host: str = "127.0.0.1"
) -> int:
    """Find the next available port on host starting from start_port."""
    for p in range(start_port, start_port + max_attempts):
        if not is_port_in_use(p, host):
            return p
    raise RuntimeError(
        f"No available port found in range {start_port}-{start_port + max_attempts}"
    )
