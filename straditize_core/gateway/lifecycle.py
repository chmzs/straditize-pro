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


def detect_local_ips() -> list[str]:
    """Detect local machine non-loopback IPv4 addresses across network interfaces."""
    ips: list[str] = []

    # 1. Primary outbound interface via UDP routing check
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            primary_ip = s.getsockname()[0]
            if (
                primary_ip
                and not primary_ip.startswith("127.")
                and primary_ip != "0.0.0.0"
            ):
                ips.append(primary_ip)
    except Exception:
        pass

    # 2. Hostname resolution for all bound interface IPs (including LAN, VPN, Tailscale)
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip and not ip.startswith("127.") and ip != "0.0.0.0" and ip not in ips:
                ips.append(ip)
    except Exception:
        pass

    return ips


def get_remote_display_urls(
    allowed_hosts: list[str] | None, port: int
) -> list[str]:
    """Generate display URLs (e.g. http://100.64.0.1:8765) for whitelisted remote hosts.

    Excludes loopback addresses (127.0.0.1, localhost, ::1, 0.0.0.0, ::).
    For wildcard patterns (e.g. 192.168.0.* or *), resolves matched local interface IPs.
    """
    from ..config import match_host_pattern

    if not allowed_hosts:
        return []

    urls: dict[str, None] = {}
    loopback_hosts = {"127.0.0.1", "localhost", "::1", "0.0.0.0", "::"}
    local_ips: list[str] | None = None

    for raw_host in allowed_hosts:
        host = raw_host.strip()
        if not host:
            continue

        # Extract host, safely handling IPv6 brackets and bare addresses
        if host.startswith("["):
            idx = host.find("]")
            clean_host = host[1:idx].strip().lower() if idx != -1 else host[1:].strip().lower()
        elif host.count(":") >= 2:
            clean_host = host.lower()
        else:
            clean_host = host.split(":")[0].strip().lower()

        if not clean_host or clean_host in loopback_hosts:
            continue

        if "*" in clean_host:
            if local_ips is None:
                local_ips = detect_local_ips()
            for local_ip in local_ips:
                if match_host_pattern(local_ip, clean_host):
                    urls[f"http://{local_ip}:{port}"] = None
        else:
            if ":" in clean_host:
                urls[f"http://[{clean_host}]:{port}"] = None
            else:
                urls[f"http://{clean_host}:{port}"] = None

    return list(urls.keys())


