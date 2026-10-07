"""Image slice streaming, diagram preview, and file upload endpoints."""

from __future__ import annotations

import base64
import io
import json
import logging
import tempfile
from typing import Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("straditize_rpc")


class ImageServiceHandler:
    """Handles image slicing, previewing, age-depth image serving, and uploads."""

    def __init__(self, handler: Any):
        self.handler = handler

    @property
    def session(self) -> Any:
        return getattr(self.handler, "session", None)

    def handle_image_get(self, raw_path: str) -> bool:
        """Process GET requests for /image/slice, /image/agedepth, /image/current, /image/preview."""
        parsed = urlparse(self.handler.path)

        # 1. Image slice endpoint
        if raw_path in ("/image/slice", "/api/image/slice"):
            if self.session and self.session.image is not None:
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

                self.handler.send_response(200)
                self.handler.send_header("Content-Type", "image/png")
                self.handler.send_header("Content-Length", str(len(img_data)))
                self.handler.send_header("Cache-Control", "public, max-age=3600")
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(img_data)
            else:
                self.handler.send_response(404)
                self.handler.send_header(
                    "Content-Type", "application/json; charset=utf-8"
                )
                self.handler._send_cors_headers()
                self.handler.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.handler.wfile.write(err_resp)
            return True

        # 2. Age-depth diagram image endpoint (read-only)
        if raw_path in ("/image/agedepth", "/api/image/agedepth"):
            session = self.session
            if session and session.age_depth_image is not None:
                bio = io.BytesIO()
                session.age_depth_image.save(bio, format="PNG")
                img_bytes = bio.getvalue()
                self.handler.send_response(200)
                self.handler.send_header("Content-Type", "image/png")
                self.handler.send_header("Content-Length", str(len(img_bytes)))
                self.handler.send_header("Cache-Control", "no-cache, must-revalidate")
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(img_bytes)
            else:
                self.handler.send_response(404)
                self.handler.send_header(
                    "Content-Type", "application/json; charset=utf-8"
                )
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(
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
            return True

        # 3. Main image preview and raw image
        if raw_path in ("/image/current", "/api/image", "/image/preview"):
            if self.session and self.session.image is not None:
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

                self.handler.send_response(200)
                self.handler.send_header("Content-Type", "image/png")
                self.handler.send_header("Content-Length", str(len(img_data)))
                self.handler.send_header("Cache-Control", "no-cache, must-revalidate")
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(img_data)
            else:
                self.handler.send_response(404)
                self.handler.send_header(
                    "Content-Type", "application/json; charset=utf-8"
                )
                self.handler._send_cors_headers()
                self.handler.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.handler.wfile.write(err_resp)
            return True

        return False

    def handle_upload_post(self) -> bool:
        """Process POST /api/upload request."""
        content_length = int(self.handler.headers.get("Content-Length", 0))
        content_type = self.handler.headers.get("Content-Type", "")
        post_bytes = self.handler.rfile.read(content_length)

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
                    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
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
                        boundary = part.split("=", 1)[1].strip('"').encode("latin-1")
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
                    raise ValueError("No file content found in multipart/form-data.")

                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                    tf.write(file_bytes)
                    target_path = tf.name
            else:
                # Treat raw binary payload as image file
                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                    tf.write(post_bytes)
                    target_path = tf.name

            if not self.session:
                raise RuntimeError("Server session instance is not available.")

            res = self.session.load_image(target_path)
            self.handler.broadcaster.broadcast("image_loaded", res)

            self.handler.send_response(200)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            resp_bytes = json.dumps(
                {
                    "success": True,
                    "message": "Image loaded successfully into session.",
                    "result": res,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.handler.wfile.write(resp_bytes)
            return True
        except Exception as ex:  # noqa: BLE001
            logger.error("Error during image upload: %s", ex)
            self.handler.send_response(400)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            err_bytes = json.dumps(
                {
                    "success": False,
                    "error": str(ex),
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.handler.wfile.write(err_bytes)
            return True
