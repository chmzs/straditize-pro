"""JSON-RPC 2.0 Local Communication Server for Straditize.

Supports both Standard I/O (stdio) pipe transport and Localhost HTTP/SSE transport.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import mimetypes
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

from .protocol import JsonRpcDispatcher
from .session import StraditizeSession
from .components import component_manager


def find_frontend_dist(custom_path: str | None = None) -> str | None:
    """Locate the frontend/dist directory if it exists."""
    if custom_path is not None:
        if custom_path and os.path.isdir(custom_path):
            return os.path.abspath(custom_path)
        return None

    candidates = [
        os.environ.get("STRADITIZE_FRONTEND_DIST", ""),
        os.path.abspath(os.path.join(getattr(sys, "_MEIPASS", ""), "frontend", "dist")),
        os.path.abspath(os.path.join(getattr(sys, "_MEIPASS", ""), "dist")),
        os.path.abspath(os.path.join(os.getcwd(), "frontend", "dist")),
        os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
        ),
        os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
        ),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "dist")),
    ]
    for cand in candidates:
        if cand and os.path.isdir(cand):
            return os.path.abspath(cand)
    return None


# Configure logging to sys.stderr so stdout stays clean for stdio JSON-RPC protocol
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [straditize_rpc] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("straditize_rpc")


def create_rpc_dispatcher(
    session: StraditizeSession | None = None,
) -> JsonRpcDispatcher:
    """Creates a JsonRpcDispatcher with registered Straditize core methods."""
    session = session or StraditizeSession()
    dispatcher = JsonRpcDispatcher()

    # Dynamic registration via auto-discovery (frozen contracts v1.3 §8.1.1)
    from .rpc_methods import register_all

    register_all(dispatcher, session)
    return dispatcher


# ============================================================================
# Centralized Graceful Shutdown & Resource Cleanup Hook
# ============================================================================

_registered_subprocesses: set[Any] = set()
_shutdown_lock = threading.Lock()
_is_shutting_down = False


def register_subprocess(proc: Any) -> None:
    """Register a subprocess to be cleaned up on graceful shutdown."""
    _registered_subprocesses.add(proc)


def _cleanup_subprocesses() -> None:
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
    path = lock_file_path or os.path.join(tempfile.gettempdir(), "straditize_desktop.lock")
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
    """Unified graceful shutdown hook (Single Source of Truth for exit cleanup).

    1. Removes single-instance lock file (straditize_desktop.lock)
    2. Safely stops HTTP Listener to immediately release port
    3. Terminates any spawned child processes (R scripts, headless browsers)
    4. Exits process cleanly
    """
    def _do_shutdown() -> None:
        global _is_shutting_down
        with _shutdown_lock:
            if _is_shutting_down:
                return
            _is_shutting_down = True

        if delayed_seconds > 0:
            time.sleep(delayed_seconds)

        logger.info("Executing unified graceful shutdown (cleaning single source of truth)...")

        # 1. 移除单例锁文件
        cleanup_lock_file()

        # 2. 安全关闭 Web 服务的 HTTP Listener，立即释放端口
        srv = server or getattr(StraditizeRpcHttpServer, "_active_instance", None)
        if srv is not None:
            try:
                srv.stop()
            except Exception as e:
                logger.debug("Error stopping HTTP server during shutdown: %s", e)

        # 3. 杀掉可能派生的子进程 (如后台运行的 R 脚本或 headless 浏览器实例)
        _cleanup_subprocesses()

        # 4. 退出进程
        fn = shutdown_fn or (getattr(srv, "_shutdown_fn", None) if srv else None) or os._exit
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
    import signal

    def _on_signal(signum, frame):
        logger.info("Captured signal %d (SIGINT/SIGTERM), triggering graceful shutdown...", signum)
        graceful_shutdown(server=server, exit_code=0, delayed_seconds=0.0)

    try:
        signal.signal(signal.SIGINT, _on_signal)
    except (ValueError, AttributeError):
        pass
    try:
        signal.signal(signal.SIGTERM, _on_signal)
    except (ValueError, AttributeError):
        pass


# ============================================================================
# Stdio Server Implementation
# ============================================================================


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
                # EOF reached
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


# ============================================================================
# Localhost HTTP & SSE Server Implementation
# ============================================================================


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


# ==============================================================================
# 跨源访问控制 (Loopback-first security)
# ==============================================================================
# 默认策略：只接受来自本机回环的请求。
#   1. Host 必须是回环地址（或显式绑定的主机）—— 阻断 DNS rebinding：
#      攻击者域名解析到 127.0.0.1 时，Origin 与 Host 都是攻击者域名，
#      仅比对 Origin/Host 会被绕过，因此必须单独校验 Host。
#   2. Origin 若存在，必须与请求自身的 Host 同源，或在显式白名单内 —— 阻断 CSRF。
#         浏览器自 2020 起对同源 POST 也会发送 Origin，所以同源必须放行。
#   3. 不发送 Access-Control-Allow-Origin: *。
#      历史上该头是 *，意味着用户浏览的任意网页都能读写本机后端
#      （CORS 允许读取响应），既可窃取载入的图谱与数字化数据，也可篡改会话。
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _split_host(host_header: str) -> str:
    """Extract the bare host from a Host header, handling IPv6 brackets."""
    host = (host_header or "").strip()
    if host.startswith("["):
        return host[1 : host.find("]")].lower() if "]" in host else host[1:].lower()
    return host.split(":")[0].lower()


class StraditizeRpcHttpRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler providing JSON-RPC 2.0 endpoint, static web files, and SSE."""

    dispatcher: JsonRpcDispatcher
    broadcaster: EventBroadcaster
    session: StraditizeSession
    dist_dir: str | None = None
    is_desktop_mode: bool = False

    def handle(self):
        """Handle multiple requests if necessary, suppressing client disconnect errors."""
        self.close_connection = True
        try:
            self.handle_one_request()
            while not self.close_connection:
                self.handle_one_request()
        except (ConnectionError, BrokenPipeError, OSError):
            self.close_connection = True

    def log_message(self, format, *args):
        # Redirect request logs to module logger (sys.stderr)
        logger.debug(
            "%s - - [%s] %s",
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )

    # ------------------------------------------------------------------
    # 访问控制
    # ------------------------------------------------------------------
    def _is_host_matched(self, host: str) -> bool:
        if not host:
            return False
        if host in _LOOPBACK_HOSTS:
            return True
        bound = _split_host(getattr(self.server, "bound_host", ""))
        if bound and bound not in ("0.0.0.0", "::") and host == bound:
            return True
        remote_enabled = getattr(self.server, "remote_access_enabled", False)
        if not remote_enabled:
            return False
        allowed = getattr(self.server, "allowed_hosts", [])
        from .config import is_host_allowed

        return is_host_allowed(host, allowed)

    def _host_header_allowed(self) -> bool:
        host = _split_host(self.headers.get("Host", ""))
        return self._is_host_matched(host)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True  # 非浏览器 / 同源导航
        if origin in getattr(self, "allowed_origins", set()):
            return True
        # 同源：Origin 必须等于 http://<请求的 Host>
        host_header = self.headers.get("Host", "")
        if origin.rstrip("/") in {f"http://{host_header}", f"https://{host_header}"}:
            return True
        try:
            origin_host = _split_host(urlparse(origin).netloc)
            if self._is_host_matched(origin_host):
                return True
        except Exception:
            pass
        return False

    def _reject_request(self, status: int, reason: str) -> None:
        body = json.dumps({"error": reason, "code": status}, ensure_ascii=False).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _guard_request(self) -> bool:
        """返回 True 表示请求可以继续；否则已回写 403 并返回 False。"""
        if not self._host_header_allowed():
            logger.warning(
                "Rejected request with disallowed Host header: %s",
                self.headers.get("Host"),
            )
            self._reject_request(403, "Host header not allowed")
            return False
        if not self._origin_allowed():
            logger.warning(
                "Rejected cross-origin request from: %s", self.headers.get("Origin")
            )
            self._reject_request(403, "Cross-origin request not allowed")
            return False
        return True

    def _send_cors_headers(self) -> None:
        """仅为显式白名单内的跨源来源回显 CORS 头；绝不使用通配符。

        同源请求（后端自带前端、或经 SSH 隧道访问 127.0.0.1）本就不需要 CORS 头。
        """
        origin = self.headers.get("Origin")
        if not origin:
            return
        should_send = origin in getattr(self, "allowed_origins", set())
        if not should_send:
            try:
                origin_host = _split_host(urlparse(origin).netloc)
                if self._is_host_matched(origin_host):
                    should_send = True
            except Exception:
                pass
        if should_send:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        """Handle CORS pre-flight requests (only for explicitly allowed origins)."""
        if not self._guard_request():
            return
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        """Handle health check, status, current image, SSE stream, and static web files."""
        if not self._guard_request():
            return
        parsed = urlparse(self.path)
        raw_path = unquote(parsed.path)

        # 1. Health and status endpoints
        if raw_path in ("/health", "/status"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            has_img = False
            img_w, img_h = 0, 0
            cols_cnt = 0
            is_calib = False
            taxa_list = []
            if hasattr(self, "session") and self.session:
                has_img = self.session.image is not None
                img_w = self.session.width
                img_h = self.session.height
                cols_cnt = len(self.session.columns)
                is_calib = self.session.is_calibrated
                taxa_list = getattr(self.session, "taxa_names", [])

            body = json.dumps(
                {
                    "status": "ok",
                    "service": "straditize_rpc",
                    "version": "2.0",
                    "is_desktop_mode": getattr(self, "is_desktop_mode", False),
                    "has_image": has_img,
                    "width": img_w,
                    "height": img_h,
                    "columns_count": cols_cnt,
                    "is_calibrated": is_calib,
                    "taxa": taxa_list,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.wfile.write(body)
            return

        # 2. Server-Sent Events endpoint
        if raw_path in ("/events", "/sse"):
            import queue

            q: queue.Queue = queue.Queue(maxsize=100)
            self.broadcaster.add_listener(q)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._send_cors_headers()
            self.end_headers()

            # Send initial connected notification
            try:
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
            except (ConnectionError, BrokenPipeError, OSError):
                self.broadcaster.remove_listener(q)
                return

            try:
                while True:
                    try:
                        msg = q.get(timeout=2.0)
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        # Send keep-alive comment
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
            except (ConnectionError, BrokenPipeError, OSError):
                pass
            finally:
                self.broadcaster.remove_listener(q)
            return

        # 3. Current loaded image preview endpoint
        if raw_path in ("/image/slice", "/api/image/slice"):
            if (
                hasattr(self, "session")
                and self.session
                and self.session.image is not None
            ):
                qs = parse_qs(parsed.query)
                x = int(qs.get("x", [0])[0])
                y = int(qs.get("y", [0])[0])
                w = int(qs.get("w", [512])[0])
                h = int(qs.get("h", [512])[0])
                max_dim = int(qs.get("max_dim", [0])[0]) or None

                slice_img = self.session.get_image_slice(x, y, w, h, max_dim=max_dim)
                bio = io.BytesIO()
                slice_img.save(bio, format="PNG")
                img_data = bio.getvalue()

                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_data)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_resp)
            return

        # Age-depth diagram image endpoint (read-only)
        if raw_path in ("/image/agedepth", "/api/image/agedepth"):
            # This endpoint deliberately does NOT load anything. It used to accept
            # ?sample=bacon|bchron and fall back to the bacon sample when a session had no
            # diagram, which both mutated extraction state as a side effect of a plain image
            # GET and silently substituted a different figure. The displayed pixels and the
            # pixels the extractor operates on could then diverge with nothing to signal it.
            # Loading happens only through `agedepth.loadModelDiagram`.
            session = getattr(self, "session", None)
            if session and session.age_depth_image is not None:
                bio = io.BytesIO()
                session.age_depth_image.save(bio, format="PNG")
                img_bytes = bio.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_bytes)))
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_bytes)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "error": "No age-depth diagram loaded in this session.",
                            "hint": "Call agedepth.loadModelDiagram first.",
                            "code": -32001,
                            "status": "not_found",
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                )
            return

        if raw_path in ("/image/current", "/api/image", "/image/preview"):
            if (
                hasattr(self, "session")
                and self.session
                and self.session.image is not None
            ):
                qs = parse_qs(parsed.query)
                is_preview_req = raw_path == "/image/preview" or "preview" in qs
                req_full = "full" in qs or "raw" in qs
                is_huge = (self.session.width * self.session.height) > 16_000_000

                if (is_preview_req or is_huge) and not req_full:
                    img_to_send = self.session.get_image_preview(max_dim=2048)
                else:
                    img_to_send = self.session.image

                bio = io.BytesIO()
                img_to_send.save(bio, format="PNG")
                img_data = bio.getvalue()

                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_data)))
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_resp)
            return

        # 3.5. Component static assets (WASM/JS/Data for WebR and extension packages)
        if raw_path.startswith(("/components/", "/webr/")):
            from .components.manager import get_base_components_dir

            base_comp_dir = os.path.abspath(str(get_base_components_dir()))

            if raw_path.startswith("/components/"):
                rel_path = raw_path[len("/components/") :].lstrip("/")
            else:
                rel_path = "webr/" + raw_path[len("/webr/") :].lstrip("/")

            target_file = os.path.abspath(os.path.join(base_comp_dir, rel_path))
            if not os.path.exists(target_file):
                alt_file = os.path.abspath(
                    os.path.join(base_comp_dir, "age-modeling", rel_path)
                )
                if os.path.exists(alt_file):
                    target_file = alt_file

            # Security check: prevent directory traversal outside base_comp_dir
            if not target_file.startswith(base_comp_dir):
                self.send_response(403)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(
                    b"Forbidden: Path traversal outside components directory"
                )
                return

            if os.path.isfile(target_file):
                content_type, _ = mimetypes.guess_type(target_file)
                if not content_type:
                    if target_file.endswith(".wasm"):
                        content_type = "application/wasm"
                    elif target_file.endswith((".js", ".mjs")):
                        content_type = "application/javascript"
                    elif target_file.endswith(".json"):
                        content_type = "application/json"
                    elif target_file.endswith(".data"):
                        content_type = "application/octet-stream"
                    elif target_file.endswith(".css"):
                        content_type = "text/css"
                    else:
                        content_type = "application/octet-stream"

                with open(target_file, "rb") as f:
                    content = f.read()

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
                self.send_header("Cache-Control", "public, max-age=3600")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_resp = json.dumps(
                    {
                        "error": f"Component asset not found: {rel_path}",
                        "code": -32002,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_resp)
                return

        # 4. Frontend static files or diagnostic guidance
        dist_dir = find_frontend_dist(getattr(self, "dist_dir", None))
        if dist_dir:
            # Normalize requested relative path
            clean_path = raw_path.lstrip("/")
            if not clean_path or clean_path == "index.html":
                clean_path = "index.html"

            target_file = os.path.abspath(os.path.join(dist_dir, clean_path))
            # Security check: disallow escaping frontend/dist
            if not target_file.startswith(dist_dir):
                self.send_response(403)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b"Forbidden")
                return

            if os.path.isdir(target_file):
                target_file = os.path.join(target_file, "index.html")

            if os.path.isfile(target_file):
                content_type, _ = mimetypes.guess_type(target_file)
                if not content_type:
                    if target_file.endswith((".js", ".mjs")):
                        content_type = "application/javascript"
                    elif target_file.endswith(".css"):
                        content_type = "text/css"
                    elif target_file.endswith(".html"):
                        content_type = "text/html; charset=utf-8"
                    elif target_file.endswith(".json"):
                        content_type = "application/json"
                    elif target_file.endswith(".png"):
                        content_type = "image/png"
                    elif target_file.endswith((".jpg", ".jpeg")):
                        content_type = "image/jpeg"
                    elif target_file.endswith(".svg"):
                        content_type = "image/svg+xml"
                    else:
                        content_type = "application/octet-stream"

                with open(target_file, "rb") as f:
                    content = f.read()

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return

            # Single Page Application (SPA) fallback: if no file extension, serve index.html
            index_path = os.path.join(dist_dir, "index.html")
            if not os.path.splitext(target_file)[1] and os.path.isfile(index_path):
                with open(index_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return

            # Static asset not found
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        # 5. Friendly diagnostic page when frontend/dist is not built yet
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._send_cors_headers()
        self.end_headers()
        diag_data = {
            "status": "frontend_not_built",
            "message": "Straditize Web Frontend is ready for connection, but production assets (frontend/dist) were not found.",
            "hint": "Please build the production frontend or start the Vite development server.",
            "quick_start": {
                "dev_server": "cd frontend && npm run dev (accessible at http://localhost:5173)",
                "build_static": "cd frontend && npm run build (compiles to frontend/dist/)",
            },
            "available_endpoints": {
                "gui": "/",
                "health": "/health",
                "status": "/status",
                "events": "/events",
                "image": "/image/current",
                "upload": "/api/upload",
                "rpc": "/rpc",
            },
            "timestamp": time.time(),
        }
        self.wfile.write(
            json.dumps(diag_data, indent=2, ensure_ascii=False).encode("utf-8")
        )

    def do_POST(self) -> None:
        """Handle JSON-RPC 2.0 requests, file uploads, and graceful shutdown."""
        if not self._guard_request():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        # 0. Graceful shutdown endpoint (only permitted in desktop mode)
        if path == "/shutdown":
            if not getattr(self, "is_desktop_mode", False):
                self.send_response(403)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "error": "Shutdown is only permitted in desktop mode.",
                            "code": 403,
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                )
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"success": True, "message": "Server shutting down..."},
                    ensure_ascii=False,
                ).encode("utf-8")
            )
            self.wfile.flush()

            # 触发统一 graceful_shutdown 单一事实源清理钩子
            app_server = getattr(self.server, "app_server", None)
            shutdown_fn = getattr(self, "_shutdown_fn", None)
            graceful_shutdown(
                server=app_server,
                exit_code=0,
                delayed_seconds=0.5,
                shutdown_fn=shutdown_fn,
            )
            return

        # 1. Image upload endpoint
        if path == "/api/upload":
            content_length = int(self.headers.get("Content-Length", 0))
            content_type = self.headers.get("Content-Type", "")
            post_bytes = self.rfile.read(content_length)

            try:
                target_path: str | None = None
                if "application/json" in content_type:
                    payload = json.loads(post_bytes.decode("utf-8"))
                    if "path" in payload:
                        target_path = payload["path"]
                    elif "image_path" in payload:
                        target_path = payload["image_path"]
                    elif "image_base64" in payload:
                        b64_str = payload["image_base64"]
                        if "," in b64_str:
                            b64_str = b64_str.split(",", 1)[1]
                        raw_bytes = base64.b64decode(b64_str)
                        suffix = payload.get("suffix", ".png")
                        with tempfile.NamedTemporaryFile(
                            suffix=suffix, delete=False
                        ) as tf:
                            tf.write(raw_bytes)
                            target_path = tf.name
                    else:
                        raise ValueError(
                            "Missing 'path' or 'image_base64' in upload request."
                        )
                elif "multipart/form-data" in content_type:
                    boundary = None
                    for part in content_type.split(";"):
                        part = part.strip()
                        if part.startswith("boundary="):
                            boundary = (
                                part.split("=", 1)[1].strip('"').encode("latin-1")
                            )
                            break
                    if not boundary:
                        raise ValueError(
                            "Invalid multipart/form-data: missing boundary header."
                        )

                    delimiter = b"--" + boundary
                    parts = post_bytes.split(delimiter)
                    file_bytes = None
                    for p in parts:
                        if b"Content-Disposition" in p:
                            if b"\r\n\r\n" in p:
                                _header_part, body_part = p.split(b"\r\n\r\n", 1)
                            elif b"\n\n" in p:
                                _header_part, body_part = p.split(b"\n\n", 1)
                            else:
                                continue
                            file_bytes = body_part.rstrip(b"\r\n").rstrip(b"--")
                            break

                    if file_bytes is None:
                        raise ValueError(
                            "No file content found in multipart/form-data."
                        )

                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                        tf.write(file_bytes)
                        target_path = tf.name
                else:
                    # Treat raw binary payload as image file
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                        tf.write(post_bytes)
                        target_path = tf.name

                if not hasattr(self, "session") or self.session is None:
                    raise RuntimeError("Server session instance is not available.")

                res = self.session.load_image(target_path)
                self.broadcaster.broadcast("image_loaded", res)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                resp_bytes = json.dumps(
                    {
                        "success": True,
                        "message": "Image loaded successfully into session.",
                        "result": res,
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(resp_bytes)
                return
            except Exception as ex:  # noqa: BLE001
                logger.error("Error during image upload: %s", ex)
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_bytes = json.dumps(
                    {
                        "success": False,
                        "error": str(ex),
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_bytes)
                return

        # 2. JSON-RPC 2.0 & Streamable HTTP MCP requests at /rpc, /mcp, or /
        if path not in ("/rpc", "/mcp", "/"):
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length).decode("utf-8")

        response = self.dispatcher.handle_text(post_data)

        # Broadcast event notification on significant operations (including WebMCP tool calls)
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
            # Notification or empty response
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
        # 跨源白名单：默认空 = 拒绝一切跨源请求（同源与 SSH 隧道访问不受影响）
        self.allow_origins = {o.rstrip("/") for o in (allow_origins or [])}
        self._shutdown_fn = shutdown_fn or os._exit
        self.session = session or StraditizeSession()
        self.session.is_desktop_mode = is_desktop_mode
        self.session.server = self

        from .config import load_config

        self.config = load_config()
        self.remote_access_enabled = self.config.get("remote_access_enabled", False)
        self.user_allowed_hosts = list(
            self.config.get("allowed_hosts", ["127.0.0.1", "localhost"])
        )

        self.dispatcher = dispatcher or create_rpc_dispatcher(self.session)
        self.broadcaster = EventBroadcaster()
        self.dist_dir = dist_dir

        # Build custom handler class with injected dependencies
        # 允许的 Host：回环始终允许；若显式绑定非回环地址，则该地址也允许。
        # 注意变量名不能与类体内属性同名：类体中的赋值会让右侧解析为类局部名而 NameError。
        host_allowlist = {"localhost", "127.0.0.1", "::1"}
        bound = _split_host(self.host)
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
        self._server.allowed_hosts = self.user_allowed_hosts
        self._server.bound_host = self.host
        self._server.app_server = self
        self.actual_port = self._server.server_address[1]
        self._thread: threading.Thread | None = None

        # Wire component_manager ready notifications to SSE broadcaster
        self._component_ready_cb = lambda comp_name, meta: self.broadcaster.broadcast(
            "component.ready", meta
        )
        component_manager.register_ready_callback(self._component_ready_cb)

    def sync_config(self, new_config: dict[str, Any]) -> None:
        """Dynamically update in-memory access control from config."""
        self.config.update(new_config)
        self.remote_access_enabled = bool(new_config.get("remote_access_enabled", False))
        self.user_allowed_hosts = list(
            new_config.get("allowed_hosts", ["127.0.0.1", "localhost"])
        )
        if hasattr(self, "_server") and self._server:
            self._server.remote_access_enabled = self.remote_access_enabled
            self._server.allowed_hosts = self.user_allowed_hosts

    def start(self) -> None:
        """Starts the HTTP server in a background thread."""
        StraditizeRpcHttpServer._active_instance = self
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info(
            "Straditize JSON-RPC HTTP server started at http://%s:%d/rpc",
            self.host,
            self.actual_port,
        )

    def stop(self) -> None:
        """Stops the HTTP server and joins thread."""
        if getattr(StraditizeRpcHttpServer, "_active_instance", None) is self:
            StraditizeRpcHttpServer._active_instance = None
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("Straditize JSON-RPC HTTP server stopped.")


# ============================================================================
# Mode Helpers & CLI Entry Point
# ============================================================================


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a network port is currently open/bound."""
    import socket

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
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("service") == "straditize_rpc":
                    return port
    except (OSError, ValueError, urllib.error.URLError):
        pass

    try:
        if os.path.exists(lock_file):
            os.remove(lock_file)
    except OSError:
        pass
    return None


def main() -> None:
    # 0. WebMCP & Headless CLI commands (mcp, list-tools, call-tool, extract, run-project)
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

    # 1. Server mode: straditize serve [--port N]
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        if sys.platform == "win32":
            try:
                import ctypes

                kernel32 = ctypes.windll.kernel32
                if kernel32.AttachConsole(-1):
                    # Attach standard output and error to parent console
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
            prog="straditize serve",
            description="Run Straditize in Server mode (fixed port, exit button disabled)",
        )
        parser.add_argument(
            "--port",
            type=int,
            default=8765,
            help="Port to listen on (default: 8765)",
        )
        parser.add_argument(
            "--host",
            type=str,
            default=None,
            help="Host to bind (default: 127.0.0.1 or 0.0.0.0 when remote access is enabled)",
        )
        args = parser.parse_args(sys.argv[2:])

        from .config import load_config

        cfg = load_config()
        bind_host = args.host or (
            "0.0.0.0" if cfg.get("remote_access_enabled", False) else "127.0.0.1"
        )
        target_port = args.port
        if is_port_in_use(target_port, "127.0.0.1"):
            print(
                f"Error: Port {target_port} is already in use. Exiting.",
                file=sys.stderr,
            )
            sys.exit(1)

        session = StraditizeSession()
        session.is_desktop_mode = False
        dispatcher = create_rpc_dispatcher(session)
        server = StraditizeRpcHttpServer(
            host=bind_host,
            port=target_port,
            dispatcher=dispatcher,
            session=session,
            is_desktop_mode=False,
        )
        server.start()
        print(f"服务已启动：http://{bind_host}:{server.actual_port}")

        setup_signal_handlers(server)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n正在停止 Straditize 服务...")
            graceful_shutdown(server=server, exit_code=0, delayed_seconds=0.0)
        return

    # 2. Standard I/O pipe mode
    if "--stdio" in sys.argv:
        dispatcher = create_rpc_dispatcher()
        run_stdio_server(dispatcher=dispatcher)
        return

    # 3. Explicit HTTP flag (for backward compatibility and test suites)
    if "--http" in sys.argv:
        parser = argparse.ArgumentParser(
            description="Straditize JSON-RPC 2.0 Communication Server"
        )
        parser.add_argument("--http", action="store_true")
        parser.add_argument("--host", type=str, default="127.0.0.1")
        parser.add_argument("--port", type=int, default=8765)
        args = parser.parse_args()

        session = StraditizeSession()
        session.is_desktop_mode = False
        dispatcher = create_rpc_dispatcher(session)
        server = StraditizeRpcHttpServer(
            host=args.host,
            port=args.port,
            dispatcher=dispatcher,
            session=session,
            is_desktop_mode=False,
        )
        server.start()
        print(f"服务已启动：http://127.0.0.1:{server.actual_port}")
        setup_signal_handlers(server)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n正在停止 Straditize 服务...")
            graceful_shutdown(server=server, exit_code=0, delayed_seconds=0.0)
        return

    # 4. Desktop / Default One-Click Mode
    if getattr(sys, "frozen", False) and sys.platform == "win32":
        try:
            import ctypes

            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 0)
        except (ImportError, AttributeError, OSError):
            pass

    lock_file = os.path.join(tempfile.gettempdir(), "straditize_desktop.lock")
    existing_port = check_single_instance(lock_file)
    if existing_port is not None:
        import webbrowser

        print(f"检测到已有运行实例，正在打开浏览器：http://127.0.0.1:{existing_port}/")
        webbrowser.open(f"http://127.0.0.1:{existing_port}/")
        sys.exit(0)

    chosen_port = find_available_port(8765, max_attempts=50, host="127.0.0.1")
    try:
        with open(lock_file, "w", encoding="utf-8") as f:
            f.write(str(chosen_port))
    except OSError:
        pass

    from .config import load_config

    cfg = load_config()
    bind_host = "0.0.0.0" if cfg.get("remote_access_enabled", False) else "127.0.0.1"

    session = StraditizeSession()
    session.is_desktop_mode = True
    dispatcher = create_rpc_dispatcher(session)
    server = StraditizeRpcHttpServer(
        host=bind_host,
        port=chosen_port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()

    print(
        f"\n=================================================================\n"
        f"  Straditize Pro 已启动！\n"
        f"  • 浏览器访问：http://127.0.0.1:{server.actual_port}/\n"
        f"  • AI WebMCP 端点：http://127.0.0.1:{server.actual_port}/mcp\n"
        f"  • 关闭方式：网页右上角点击 [退出] 或在终端按 Ctrl+C\n"
        f"=================================================================\n"
    )

    import webbrowser

    webbrowser.open(f"http://127.0.0.1:{server.actual_port}/")

    setup_signal_handlers(server)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在停止 Straditize 服务...")
        graceful_shutdown(server=server, exit_code=0, delayed_seconds=0.0)
    finally:
        cleanup_lock_file(lock_file)


if __name__ == "__main__":
    main()
