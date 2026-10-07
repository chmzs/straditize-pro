"""HTTP handler helper endpoints for SSE, status, auth, and shutdown."""

from __future__ import annotations

import json
import queue
import secrets
import time
from typing import Any

from .lifecycle import graceful_shutdown


class HttpEndpointHandler:
    """Dispatches status queries, SSE streams, authentication, and graceful shutdown."""

    def __init__(self, handler: Any):
        self.handler = handler

    @property
    def server(self) -> Any:
        return getattr(self.handler, "server", None)

    @property
    def session(self) -> Any:
        return getattr(self.handler, "session", None)

    def handle_status_get(self) -> None:
        """Process GET /health and /status."""
        self.handler.send_response(200)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler._send_cors_headers()
        self.handler.end_headers()
        has_img, img_w, img_h, cols_cnt, is_calib, taxa_list = False, 0, 0, 0, False, []
        if self.session:
            has_img = self.session.image is not None
            img_w, img_h = self.session.width, self.session.height
            cols_cnt = len(self.session.columns)
            is_calib = self.session.is_calibrated
            taxa_list = getattr(self.session, "taxa_names", [])

        remote_pwd = str(getattr(self.server, "remote_password", "") or "")
        auth_required = (
            bool(remote_pwd)
            and (not self.handler._is_loopback())
            and (not self.handler._is_authenticated())
        )

        body = json.dumps(
            {
                "status": "ok",
                "service": "straditize_rpc",
                "version": "2.0",
                "is_desktop_mode": getattr(self.handler, "is_desktop_mode", False),
                "has_image": has_img,
                "width": img_w,
                "height": img_h,
                "columns_count": cols_cnt,
                "is_calibrated": is_calib,
                "taxa": taxa_list,
                "auth_required": auth_required,
                "has_remote_password": bool(remote_pwd),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.handler.wfile.write(body)

    def handle_sse_get(self) -> None:
        """Process GET /events and /sse."""
        q: queue.Queue = queue.Queue(maxsize=100)
        self.handler.broadcaster.add_listener(q)
        self.handler.send_response(200)
        self.handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.handler.send_header("Cache-Control", "no-cache")
        self.handler.send_header("Connection", "keep-alive")
        self.handler._send_cors_headers()
        self.handler.end_headers()
        try:
            self.handler.wfile.write(b": connected\n\n")
            self.handler.wfile.flush()
        except (ConnectionError, BrokenPipeError, OSError):
            self.handler.broadcaster.remove_listener(q)
            return

        try:
            while True:
                try:
                    msg = q.get(timeout=2.0)
                    self.handler.wfile.write(msg.encode("utf-8"))
                    self.handler.wfile.flush()
                except queue.Empty:
                    self.handler.wfile.write(b": keep-alive\n\n")
                    self.handler.wfile.flush()
        except (ConnectionError, BrokenPipeError, OSError):
            pass
        finally:
            self.handler.broadcaster.remove_listener(q)

    def handle_shutdown_post(self) -> None:
        """Process POST /shutdown (only in desktop mode)."""
        if not getattr(self.handler, "is_desktop_mode", False):
            self.handler.send_response(403)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(
                json.dumps(
                    {
                        "error": "Shutdown is only permitted in desktop mode.",
                        "code": 403,
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
            )
            return

        self.handler.send_response(200)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler._send_cors_headers()
        self.handler.end_headers()
        self.handler.wfile.write(
            json.dumps(
                {"success": True, "message": "Server shutting down..."},
                ensure_ascii=False,
            ).encode("utf-8")
        )
        self.handler.wfile.flush()
        graceful_shutdown(
            server=getattr(self.server, "app_server", None),
            exit_code=0,
            delayed_seconds=0.5,
            shutdown_fn=getattr(self.handler, "_shutdown_fn", None),
        )

    def handle_auth_post(self) -> None:
        """Process POST /api/auth."""
        content_length = int(self.handler.headers.get("Content-Length", 0))
        post_bytes = self.handler.rfile.read(content_length)
        try:
            payload = json.loads(post_bytes.decode("utf-8")) if post_bytes else {}
        except Exception:
            payload = {}
        password = str(payload.get("password", "") or "")
        remote_pwd = str(getattr(self.server, "remote_password", "") or "")

        if not remote_pwd:
            self.handler.send_response(200)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(
                json.dumps({"authenticated": True, "token": ""}).encode("utf-8")
            )
            return

        if secrets.compare_digest(password, remote_pwd):
            token = getattr(self.server, "auth_token", "") or ""
            self.handler.send_response(200)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(
                json.dumps({"authenticated": True, "token": token}).encode("utf-8")
            )
        else:
            time.sleep(0.5)
            self.handler.send_response(401)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(
                json.dumps(
                    {"authenticated": False, "error": "访问密码错误，请重新输入"}
                ).encode("utf-8")
            )
