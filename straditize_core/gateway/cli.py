"""CLI runner and entry points for Straditize servers."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
import time
from typing import Any

from .lifecycle import (
    find_available_port,
    graceful_shutdown,
    is_port_in_use,
    setup_signal_handlers,
)
from ..session import StraditizeSession

logger = logging.getLogger("straditize_rpc")


def check_single_instance(lock_file: str) -> int | None:
    """Checks if an existing desktop instance is alive. Returns port or None."""
    if not os.path.exists(lock_file):
        return None
    try:
        with open(lock_file, "r", encoding="utf-8") as f:
            port = int(f.read().strip())
        import urllib.request

        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                import json

                data = json.loads(resp.read().decode("utf-8"))
                if data.get("service") == "straditize_rpc":
                    return port
    except (OSError, ValueError, Exception):
        pass

    try:
        if os.path.exists(lock_file):
            os.remove(lock_file)
    except OSError:
        pass
    return None


def start_serve_mode(args: Any) -> None:
    """Runs Straditize in headless server mode."""
    from .config import load_config
    from .rpc_server import StraditizeRpcHttpServer

    cfg = load_config()
    bind_host = (
        "0.0.0.0"
        if args.remote
        else (
            args.host
            or ("0.0.0.0" if cfg.get("remote_access_enabled", False) else "127.0.0.1")
        )
    )
    if is_port_in_use(args.port, bind_host):
        logger.error("Port %d is already in use on %s. Aborting.", args.port, bind_host)
        sys.exit(1)

    server = StraditizeRpcHttpServer(
        host=bind_host,
        port=args.port,
        is_desktop_mode=False,
        allow_origins=args.cors_origins,
    )
    setup_signal_handlers(server)
    server.start()
    print(
        f"Server mode running on http://{bind_host}:{args.port} (Press Ctrl+C to stop)"
    )
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        graceful_shutdown(server=server, exit_code=0)


def start_desktop_mode(args: Any) -> None:
    """Runs Straditize in single-instance desktop mode."""
    import tempfile
    import webbrowser
    from .config import load_config
    from .rpc_server import StraditizeRpcHttpServer

    lock_file = os.path.join(tempfile.gettempdir(), "straditize_desktop.lock")
    existing_port = check_single_instance(lock_file)
    if existing_port:
        logger.info(
            "Found running desktop instance on port %d, opening browser tab...",
            existing_port,
        )
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{existing_port}")
        return

    cfg = load_config()
    bind_host = (
        "0.0.0.0"
        if (args.remote or cfg.get("remote_access_enabled", False))
        else "127.0.0.1"
    )
    port = find_available_port(args.port or 8765, host=bind_host)

    try:
        with open(lock_file, "w", encoding="utf-8") as f:
            f.write(str(port))
    except OSError as e:
        logger.debug("Could not write single-instance lock file: %s", e)

    session = StraditizeSession()
    session.is_desktop_mode = True

    if args.image or args.sample:
        try:
            session.load_image(image_path=args.image, sample_key=args.sample)
            logger.info("Auto-loaded initial diagram: %s", args.image or args.sample)
        except Exception as ex:  # noqa: BLE001
            logger.warning("Failed to auto-load initial diagram: %s", ex)

    server = StraditizeRpcHttpServer(
        host=bind_host, port=port, session=session, is_desktop_mode=True
    )
    setup_signal_handlers(server)
    server.start()

    url = f"http://127.0.0.1:{server.actual_port}"
    logger.info("Straditize Pro running on %s", url)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        graceful_shutdown(server=server, exit_code=0)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in (
        "mcp",
        "list-tools",
        "call-tool",
        "extract",
        "run-project",
    ):
        from .cli import main as cli_main

        cli_main()
        return

    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        if sys.platform == "win32":
            try:
                import ctypes

                kernel32 = ctypes.windll.kernel32
                if kernel32.AttachConsole(-1):
                    import io

                    sys.stdout = io.TextIOWrapper(
                        open("CONOUT$", "wb"), encoding="utf-8", write_through=True
                    )  # noqa: SIM115
                    sys.stderr = io.TextIOWrapper(
                        open("CONOUT$", "wb"), encoding="utf-8", write_through=True
                    )  # noqa: SIM115
            except Exception:  # noqa: BLE001, S110
                pass

        parser = argparse.ArgumentParser(
            prog="straditize serve", description="Run Straditize in Server mode"
        )
        parser.add_argument("--port", type=int, default=8765)
        parser.add_argument("--host", type=str, default=None)
        parser.add_argument(
            "--cors-origin", action="append", dest="cors_origins", default=None
        )
        parser.add_argument("--remote", action="store_true", default=False)
        start_serve_mode(parser.parse_args(sys.argv[2:]))
        return

    if len(sys.argv) > 1 and sys.argv[1] == "stdio":
        from .rpc_server import run_stdio_server

        run_stdio_server()
        return

    parser = argparse.ArgumentParser(
        description="Straditize Modern Application Launcher"
    )
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--image", type=str, default=None)
    parser.add_argument("--sample", type=str, default=None)
    parser.add_argument("--remote", action="store_true", default=False)
    start_desktop_mode(parser.parse_args())
