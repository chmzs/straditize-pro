"""Gateway package for Straditize HTTP middleware, static hosting, and image streaming."""

from __future__ import annotations

from .cli import (
    check_single_instance,
    main as cli_main,
    start_desktop_mode,
    start_serve_mode,
)
from .endpoints import HttpEndpointHandler
from .image_handler import ImageServiceHandler
from .lifecycle import (
    cleanup_lock_file,
    cleanup_subprocesses,
    find_available_port,
    graceful_shutdown,
    is_port_in_use,
    register_subprocess,
    setup_signal_handlers,
)
from .security import SecurityMiddleware, split_host
from .static_handler import StaticAssetHandler, find_frontend_dist

__all__ = [
    "SecurityMiddleware",
    "StaticAssetHandler",
    "ImageServiceHandler",
    "HttpEndpointHandler",
    "find_frontend_dist",
    "split_host",
    "register_subprocess",
    "cleanup_subprocesses",
    "cleanup_lock_file",
    "graceful_shutdown",
    "setup_signal_handlers",
    "is_port_in_use",
    "find_available_port",
    "check_single_instance",
    "start_serve_mode",
    "start_desktop_mode",
    "cli_main",
]
