"""JSON-RPC 2.0 Local Communication Server for Straditize.

Supports both Standard I/O (stdio) pipe transport and Localhost HTTP/SSE transport.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
import secrets
import sys
import threading
from typing import Any
from urllib.parse import unquote, urlparse

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

from .components import component_manager
from .gateway import (
    HttpEndpointHandler,
    ImageServiceHandler,
    SecurityMiddleware,
    StaticAssetHandler,
    check_single_instance,
    cleanup_lock_file,
    cli_main,
    find_available_port,
    find_frontend_dist,
    graceful_shutdown,
    is_port_in_use,
    register_subprocess,
    setup_signal_handlers,
    split_host,
    start_desktop_mode,
    start_serve_mode,
)
from .protocol import JsonRpcDispatcher
from .session import StraditizeSession

# Configure logging to sys.stderr so stdout stays clean for stdio JSON-RPC protocol
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s]: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("straditize_rpc")


def create_rpc_dispatcher(
    session: StraditizeSession | None = None,
) -> JsonRpcDispatcher:
    """Creates a pre-configured JsonRpcDispatcher with all methods registered."""
    from .rpc_methods import register_all

    if session is None:
        session = StraditizeSession()

    dispatcher = JsonRpcDispatcher()
    register_all(dispatcher, session)
    return dispatcher


def run_stdio_server(
    dispatcher: JsonRpcDispatcher | None = None,
    in_stream=sys.stdin,
    out_stream=sys.stdout,
) -> None:
    """Runs a line-delimited JSON-RPC server on standard input/output streams."""
    if dispatcher is None:
        dispatcher = create_rpc_dispatcher()

    logger.info("Straditize JSON-RPC 2.0 stdio server listening...")

    while True:
        try:
            line = in_stream.readline()
            if not line:
                logger.info("Stdio stream reached EOF, shutting down.")
                break

            response = dispatcher.handle_text(line)
            if response is not None:
                out_stream.write(response + "\n")
                out_stream.flush()
        except KeyboardInterrupt:
            logger.info("Stdio server interrupted by user.")
            break
        except Exception as e:  # noqa: BLE001
            logger.error("Unexpected error in stdio server loop: %s", e)


class EventBroadcaster:
    """Thread-safe event broadcaster for Server-Sent Events (SSE)."""

    def __init__(self):
        self._listeners: list[Any] = []
        self._lock = threading.Lock()

    def add_listener(self, queue_obj) -> None:
        with self._lock:
            self._listeners.append(queue_obj)

    def remove_listener(self, queue_obj) -> None:
        with self._lock:
            if queue_obj in self._listeners:
                self._listeners.remove(queue_obj)

    def broadcast(self, event_type: str, data: Any) -> None:
        msg = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        with self._lock:
            for q in list(self._listeners):
                try:
                    q.put_nowait(msg)
                except Exception as ex:  # noqa: BLE001
                    logger.debug("Broadcast queue put error: %s", ex)


class StraditizeRpcHttpRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler providing JSON-RPC 2.0 endpoint, static web files, and SSE."""

    dispatcher: JsonRpcDispatcher
    broadcaster: EventBroadcaster
    session: StraditizeSession
    dist_dir: str | None = None
    is_desktop_mode: bool = False

    def __init__(self, *args, **kwargs):
        self.security = SecurityMiddleware(self)
        self.static_handler = StaticAssetHandler(self)
        self.image_handler = ImageServiceHandler(self)
        self.endpoint_handler = HttpEndpointHandler(self)
        super().__init__(*args, **kwargs)

    def handle(self):
        self.close_connection = True
        try:
            self.handle_one_request()
            while not self.close_connection:
                self.handle_one_request()
        except (ConnectionError, BrokenPipeError, OSError):
            self.close_connection = True

    def log_message(self, format, *args):
        logger.debug(
            "%s - - [%s] %s",
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )

    def _is_host_matched(self, host: str) -> bool:
        return self.security.is_host_matched(host)

    def _host_header_allowed(self) -> bool:
        return self.security.host_header_allowed()

    def _origin_allowed(self) -> bool:
        return self.security.origin_allowed()

    def _reject_request(self, status: int, reason: str) -> None:
        self.security.reject_request(status, reason)

    def _is_loopback(self) -> bool:
        return self.security.is_loopback()

    def _is_authenticated(self) -> bool:
        return self.security.is_authenticated()

    def _is_public_path(self, path: str) -> bool:
        return self.security.is_public_path(path)

    def _reject_auth_required(self) -> None:
        self.security.reject_auth_required()

    def _guard_request(self) -> bool:
        return self.security.guard_request()

    def _send_cors_headers(self) -> None:
        self.security.send_cors_headers()

    def do_OPTIONS(self) -> None:
        if not self._guard_request():
            return
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._guard_request():
            return
        raw_path = unquote(urlparse(self.path).path)

        if raw_path in ("/health", "/status"):
            self.endpoint_handler.handle_status_get()
            return
        if raw_path in ("/events", "/sse"):
            self.endpoint_handler.handle_sse_get()
            return
        if self.image_handler.handle_image_get(raw_path):
            return
        if self.static_handler.handle_component_asset(raw_path):
            return
        self.static_handler.handle_static_file(raw_path)

    def do_POST(self) -> None:
        if not self._guard_request():
            return
        path = urlparse(self.path).path

        if path == "/shutdown":
            self.endpoint_handler.handle_shutdown_post()
            return
        if path == "/api/auth":
            self.endpoint_handler.handle_auth_post()
            return
        if path == "/api/upload":
            self.image_handler.handle_upload_post()
            return
        if path not in ("/rpc", "/mcp", "/"):
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        self._handle_rpc_post()

    def _handle_rpc_post(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length).decode("utf-8")
        response = self.dispatcher.handle_text(post_data)

        try:
            req_json = json.loads(post_data)
            if isinstance(req_json, dict) and "method" in req_json:
                b_payload: dict[str, Any] = {"method": req_json["method"]}
                if req_json["method"] in (
                    "tools/call",
                    "webmcp.callTool",
                ) and isinstance(req_json.get("params"), dict):
                    b_payload["tool"] = req_json["params"].get("name", "")
                self.broadcaster.broadcast("rpc_call", b_payload)
        except Exception as ex:  # noqa: BLE001
            logger.debug("Error parsing broadcast request: %s", ex)

        if response is None:
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
        else:
            resp_bytes = response.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(resp_bytes)


class StraditizeRpcHttpServer:
    """Wrapper around ThreadingHTTPServer for managing local JSON-RPC server lifecycle."""

    _active_instance: StraditizeRpcHttpServer | None = None

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8765,
        dispatcher: JsonRpcDispatcher | None = None,
        session: StraditizeSession | None = None,
        dist_dir: str | None = None,
        is_desktop_mode: bool = False,
        shutdown_fn: Any = None,
        allow_origins: list[str] | None = None,
    ):
        self.host = host
        self.port = port
        self.is_desktop_mode = is_desktop_mode
        self.allow_origins = {o.rstrip("/") for o in (allow_origins or [])}
        self._shutdown_fn = shutdown_fn or os._exit
        self.session = session or StraditizeSession()
        self.session.is_desktop_mode = is_desktop_mode
        self.session.server = self

        from .config import load_config

        self.config = load_config()
        self.remote_access_enabled = self.config.get("remote_access_enabled", False)
        self.remote_password = str(self.config.get("remote_password", "") or "")
        self.auth_token = secrets.token_hex(24) if self.remote_password else None
        self.user_allowed_hosts = list(
            self.config.get("allowed_hosts", ["127.0.0.1", "localhost"])
        )

        self.dispatcher = dispatcher or create_rpc_dispatcher(self.session)
        self.broadcaster = EventBroadcaster()
        self.dist_dir = dist_dir

        host_allowlist = {"localhost", "127.0.0.1", "::1"}
        bound = split_host(self.host)
        if bound and bound not in ("0.0.0.0", "::"):
            host_allowlist.add(bound)

        class BoundHandler(StraditizeRpcHttpRequestHandler):
            dispatcher = self.dispatcher
            broadcaster = self.broadcaster
            session = self.session
            dist_dir = self.dist_dir
            is_desktop_mode = self.is_desktop_mode
            _shutdown_fn = self._shutdown_fn
            allowed_origins = self.allow_origins
            allowed_hosts = host_allowlist

        self._server = ThreadingHTTPServer((self.host, self.port), BoundHandler)
        self._server.remote_access_enabled = self.remote_access_enabled
        self._server.remote_password = self.remote_password
        self._server.auth_token = self.auth_token
        self._server.allowed_hosts = self.user_allowed_hosts
        self._server.bound_host = self.host
        self._server.app_server = self
        self.actual_port = self._server.server_address[1]
        self._thread: threading.Thread | None = None

        self._component_ready_cb = lambda comp_name, meta: self.broadcaster.broadcast(
            "component.ready", meta
        )
        component_manager.register_ready_callback(self._component_ready_cb)

    def sync_config(self, new_config: dict[str, Any]) -> None:
        self.config.update(new_config)
        self.remote_access_enabled = bool(
            new_config.get("remote_access_enabled", False)
        )
        if "remote_password" in new_config:
            self.remote_password = str(new_config.get("remote_password", "") or "")
            self.auth_token = secrets.token_hex(24) if self.remote_password else None
        self.user_allowed_hosts = list(
            new_config.get("allowed_hosts", ["127.0.0.1", "localhost"])
        )
        if hasattr(self, "_server") and self._server:
            self._server.remote_access_enabled = self.remote_access_enabled
            self._server.remote_password = self.remote_password
            self._server.auth_token = self.auth_token
            self._server.allowed_hosts = self.user_allowed_hosts

    def start(self) -> None:
        StraditizeRpcHttpServer._active_instance = self
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info(
            "Straditize JSON-RPC HTTP server started at http://%s:%d/rpc",
            self.host,
            self.actual_port,
        )

    def stop(self) -> None:
        if getattr(StraditizeRpcHttpServer, "_active_instance", None) is self:
            StraditizeRpcHttpServer._active_instance = None
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("Straditize JSON-RPC HTTP server stopped.")


# Re-export CLI functions for compatibility
main = cli_main

__all__ = [
    "create_rpc_dispatcher",
    "register_subprocess",
    "cleanup_lock_file",
    "graceful_shutdown",
    "setup_signal_handlers",
    "run_stdio_server",
    "EventBroadcaster",
    "StraditizeRpcHttpRequestHandler",
    "StraditizeRpcHttpServer",
    "is_port_in_use",
    "find_available_port",
    "check_single_instance",
    "start_serve_mode",
    "start_desktop_mode",
    "main",
    "find_frontend_dist",
]

if __name__ == "__main__":
    main()
