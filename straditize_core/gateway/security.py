"""Loopback-first security middleware and access control guard for HTTP gateway."""

from __future__ import annotations

import json
import logging
import os
import secrets
from typing import Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("straditize_rpc")

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def split_host(host_header: str) -> str:
    """Extract the bare host from a Host header, handling IPv6 brackets."""
    host = (host_header or "").strip()
    if host.startswith("["):
        return host[1 : host.find("]")].lower() if "]" in host else host[1:].lower()
    return host.split(":")[0].lower()


class SecurityMiddleware:
    """Host header verification, CORS enforcement, and remote token authentication."""

    def __init__(self, handler: Any):
        self.handler = handler

    @property
    def server(self) -> Any:
        return getattr(self.handler, "server", None)

    @property
    def headers(self) -> Any:
        return self.handler.headers

    def is_host_matched(self, host: str) -> bool:
        """Check whether host matches loopback, bound host, or allowed hosts config."""
        if not host:
            return False
        if host in _LOOPBACK_HOSTS:
            return True
        bound = split_host(getattr(self.server, "bound_host", ""))
        if bound and bound not in ("0.0.0.0", "::") and host == bound:
            return True
        remote_enabled = getattr(self.server, "remote_access_enabled", False)
        if not remote_enabled:
            return False
        allowed = getattr(self.server, "allowed_hosts", [])
        from ..config import is_host_allowed

        return is_host_allowed(host, allowed)

    def host_header_allowed(self) -> bool:
        """Verify the Host header matches allowed hosts (mitigating DNS rebinding)."""
        host = split_host(self.headers.get("Host", ""))
        return self.is_host_matched(host)

    def origin_allowed(self) -> bool:
        """Verify the Origin header matches allowed origins (mitigating CSRF)."""
        origin = self.headers.get("Origin")
        if not origin:
            return True  # Non-browser or same-origin navigation
        if origin in getattr(self.handler, "allowed_origins", set()):
            return True
        # Same-origin: Origin must equal http(s)://<Host>
        host_header = self.headers.get("Host", "")
        if origin.rstrip("/") in {f"http://{host_header}", f"https://{host_header}"}:
            return True
        try:
            origin_host = split_host(urlparse(origin).netloc)
            if self.is_host_matched(origin_host):
                return True
        except Exception:
            pass
        return False

    def is_loopback(self) -> bool:
        """Check if request originates from local loopback (127.0.0.1, ::1, localhost)."""
        client_ip = (
            self.handler.client_address[0]
            if hasattr(self.handler, "client_address") and self.handler.client_address
            else ""
        )
        host = split_host(self.headers.get("Host", ""))
        return (client_ip in ("127.0.0.1", "::1", "localhost")) and (
            host in _LOOPBACK_HOSTS
        )

    def is_authenticated(self) -> bool:
        """Verifies remote auth token if remote_password is set. Loopback is always authenticated."""
        if self.is_loopback():
            return True
        remote_pwd = str(getattr(self.server, "remote_password", "") or "")
        if not remote_pwd:
            return True
        expected_token = getattr(self.server, "auth_token", None)
        if not expected_token:
            return True

        # 1. Header X-Straditize-Auth or Authorization: Bearer <token>
        token = self.headers.get("X-Straditize-Auth")
        if not token:
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
        if token and secrets.compare_digest(token, expected_token):
            return True

        # 2. Query parameter ?auth=...
        try:
            query = parse_qs(urlparse(self.handler.path).query)
            q_token = query.get("auth", [None])[0]
            if q_token and secrets.compare_digest(q_token, expected_token):
                return True
        except Exception:
            pass

        # 3. Cookie header (straditize_auth_token=...)
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            try:
                import http.cookies

                cookies = http.cookies.SimpleCookie()
                cookies.load(cookie_header)
                for cookie_key in ("straditize_auth_token", "auth_token"):
                    if cookie_key in cookies:
                        c_val = cookies[cookie_key].value
                        if c_val and secrets.compare_digest(c_val, expected_token):
                            return True
            except Exception:
                pass

        return False

    def is_public_path(self, path: str) -> bool:
        """Paths that do not require an auth token (auth endpoint, status, and static assets)."""
        if path in ("/api/auth", "/status", "/health", "/favicon.ico"):
            return True
        ext = os.path.splitext(path)[1].lower()
        if ext in (
            ".html",
            ".js",
            ".css",
            ".png",
            ".jpg",
            ".jpeg",
            ".svg",
            ".ico",
            ".woff",
            ".woff2",
            ".ttf",
            ".map",
        ) or path.startswith(("/assets/", "/static/")):
            return True
        if path in ("/", ""):
            return True
        return False

    def reject_request(self, status: int, reason: str) -> None:
        """Send JSON error response and close."""
        body = json.dumps({"error": reason, "code": status}, ensure_ascii=False).encode(
            "utf-8"
        )
        self.handler.send_response(status)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler.send_header("Content-Length", str(len(body)))
        self.handler.end_headers()
        self.handler.wfile.write(body)

    def reject_auth_required(self) -> None:
        """Send 401 Authentication Required response."""
        body = json.dumps(
            {"error": "Authentication required", "auth_required": True, "code": 401},
            ensure_ascii=False,
        ).encode("utf-8")
        self.handler.send_response(401)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_cors_headers()
        self.handler.send_header("Content-Length", str(len(body)))
        self.handler.end_headers()
        self.handler.wfile.write(body)

    def guard_request(self) -> bool:
        """Validates host, origin, and authentication. Returns True to continue or False if rejected."""
        if not self.host_header_allowed():
            logger.warning(
                "Rejected request with disallowed Host header: %s",
                self.headers.get("Host"),
            )
            self.reject_request(403, "Host header not allowed")
            return False
        if not self.origin_allowed():
            logger.warning(
                "Rejected cross-origin request from: %s", self.headers.get("Origin")
            )
            self.reject_request(403, "Cross-origin request not allowed")
            return False

        path = urlparse(self.handler.path).path
        if not self.is_public_path(path) and not self.is_authenticated():
            logger.warning(
                "Rejected unauthenticated request from remote client to: %s", path
            )
            self.reject_auth_required()
            return False

        return True

    def send_cors_headers(self) -> None:
        """Send CORS response headers if origin is in allow list. Never uses wildcard '*'."""
        origin = self.headers.get("Origin")
        if not origin:
            return
        should_send = origin in getattr(self.handler, "allowed_origins", set())
        if not should_send:
            try:
                origin_host = split_host(urlparse(origin).netloc)
                if self.is_host_matched(origin_host):
                    should_send = True
            except Exception:
                pass
        if should_send:
            self.handler.send_header("Access-Control-Allow-Origin", origin)
            self.handler.send_header("Vary", "Origin")
            self.handler.send_header(
                "Access-Control-Allow-Methods", "POST, GET, OPTIONS"
            )
            self.handler.send_header("Access-Control-Allow-Headers", "Content-Type")
