"""JSON-RPC 2.0 Protocol specification and dispatcher for Straditize.

Standard Error Codes (-32700 to -32600):
- PARSE_ERROR (-32700): Invalid JSON received.
- INVALID_REQUEST (-32600): The JSON sent is not a valid Request object.
- METHOD_NOT_FOUND (-32601): The method does not exist / is not available.
- INVALID_PARAMS (-32602): Invalid method parameter(s) (syntax/types).
- INTERNAL_ERROR (-32603): Internal JSON-RPC error.

Application-Specific Error Codes (-32000 to -32099):
- STATE_ERROR (-32001): Prerequisite state missing (e.g. image not loaded, uncalibrated Y axis).
- CONFLICT_ERROR (-32002): Naming or business entity conflict (e.g. duplicate ROI/column name).
- ALGORITHM_ERROR (-32003): Algorithmic computation/extraction failed or out of bounds.
- FILE_ERROR (-32004): File not found, unreadable, or corrupted.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import inspect
import json
import logging
import traceback
from typing import Any

logger = logging.getLogger("straditize_rpc")

# Standard JSON-RPC 2.0 Error Codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Application-specific Server Error Codes (-32000 to -32099)
STATE_ERROR = -32001  # Prerequisite state missing (tell user which step to complete)
CONFLICT_ERROR = -32002  # Naming / business entity conflict (unique name required)
ALGORITHM_ERROR = (
    -32003
)  # Algorithmic calculation / extraction failure or boundary violation
FILE_ERROR = -32004  # File not found, format corrupted, or unreadable

# Backward compatibility aliases
FILE_NOT_FOUND_ERROR = FILE_ERROR
CALIBRATION_ERROR = ALGORITHM_ERROR
EXPORT_ERROR = STATE_ERROR

ERROR_MESSAGES = {
    PARSE_ERROR: "Parse error",
    INVALID_REQUEST: "Invalid Request",
    METHOD_NOT_FOUND: "Method not found",
    INVALID_PARAMS: "Invalid params",
    INTERNAL_ERROR: "Internal error",
    STATE_ERROR: "Prerequisite state missing",
    CONFLICT_ERROR: "Naming or entity conflict",
    ALGORITHM_ERROR: "Algorithmic computation error",
    FILE_ERROR: "File error",
}


class JsonRpcError(Exception):
    """Exception carrying JSON-RPC 2.0 error attributes with human remediation guidance."""

    def __init__(
        self,
        code: int,
        message: str | None = None,
        data: Any | None = None,
    ):
        super().__init__(message or ERROR_MESSAGES.get(code, "Unknown error"))
        self.code = code
        self.message = message or ERROR_MESSAGES.get(code, "Unknown error")
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            err["data"] = self.data
        return err


@dataclass
class JsonRpcRequest:
    """Represents a validated JSON-RPC 2.0 request or notification."""

    method: str
    params: dict[str, Any] | list[Any] | None
    id: str | int | float | None
    is_notification: bool = False

    @classmethod
    def from_dict(cls, data: Any) -> JsonRpcRequest:
        if not isinstance(data, dict):
            raise JsonRpcError(INVALID_REQUEST, "Request must be a JSON object")

        if data.get("jsonrpc") != "2.0":
            raise JsonRpcError(
                INVALID_REQUEST,
                "Invalid JSON-RPC version, expected 'jsonrpc': '2.0'",
            )

        method = data.get("method")
        if not isinstance(method, str) or not method:
            raise JsonRpcError(
                INVALID_REQUEST,
                "The 'method' field must be a non-empty string",
            )

        params = data.get("params")
        if params is not None and not isinstance(params, (dict, list)):
            raise JsonRpcError(
                INVALID_PARAMS,
                "The 'params' field must be a structured object or array",
            )

        has_id = "id" in data
        req_id = data.get("id")
        if has_id and not (isinstance(req_id, (str, int, float)) or req_id is None):
            raise JsonRpcError(
                INVALID_REQUEST,
                "The 'id' field must be string, number, or null",
            )

        return cls(
            method=method,
            params=params,
            id=req_id if has_id else None,
            is_notification=not has_id,
        )


class JsonRpcDispatcher:
    """Manages method registration and handles execution of JSON-RPC 2.0 requests."""

    def __init__(self):
        self._methods: dict[str, Callable[..., Any]] = {}

    def register_method(self, name: str, func: Callable[..., Any]) -> None:
        """Register a callable under a JSON-RPC method name."""
        self._methods[name] = func

    def method(self, name: str | None = None) -> Callable:
        """Decorator for registering methods."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            method_name = name or func.__name__
            self.register_method(method_name, func)
            return func

        return decorator

    def execute_request(self, request: JsonRpcRequest) -> dict[str, Any] | None:
        """Executes a single validated request."""
        if request.method not in self._methods:
            if request.is_notification:
                return None
            return {
                "jsonrpc": "2.0",
                "error": JsonRpcError(
                    METHOD_NOT_FOUND,
                    f"后端未提供接口 '{request.method}'。请检查方法名拼写或接口版本。",
                ).to_dict(),
                "id": request.id,
            }

        func = self._methods[request.method]
        try:
            # Bind parameters with flexible kwargs support
            if request.params is None:
                result = func()
            elif isinstance(request.params, dict):
                sig = inspect.signature(func)
                has_varkw = any(
                    p.kind == inspect.Parameter.VAR_KEYWORD
                    for p in sig.parameters.values()
                )
                if has_varkw:
                    result = func(**request.params)
                else:
                    # Filter parameters accepting only known keywords if func does not take **kwargs
                    valid_params = {}
                    for k, v in request.params.items():
                        if k in sig.parameters:
                            valid_params[k] = v
                    try:
                        sig.bind(**valid_params)
                    except TypeError as te:
                        raise JsonRpcError(
                            INVALID_PARAMS,
                            f"参数绑定失败: {te}。请核对接口传参要求。",
                        ) from te
                    result = func(**valid_params)
            elif isinstance(request.params, list):
                sig = inspect.signature(func)
                try:
                    sig.bind(*request.params)
                except TypeError as te:
                    raise JsonRpcError(
                        INVALID_PARAMS,
                        f"位置参数数量不匹配: {te}。请检查参数列表。",
                    ) from te
                result = func(*request.params)
            else:
                raise JsonRpcError(
                    INVALID_PARAMS, "参数类型不支持，必须为 JSON 对象或数组。"
                )

            if request.is_notification:
                return None

            return {"jsonrpc": "2.0", "result": result, "id": request.id}

        except JsonRpcError as jre:
            if request.is_notification:
                return None
            return {"jsonrpc": "2.0", "error": jre.to_dict(), "id": request.id}
        except Exception as ex:  # noqa: BLE001
            logger.error("Internal error executing %s: %s", request.method, ex)
            logger.debug(traceback.format_exc())
            if request.is_notification:
                return None
            return {
                "jsonrpc": "2.0",
                "error": {
                    "code": INTERNAL_ERROR,
                    "message": f"后端算法执行异常: {ex!s}。请查看服务器控制台日志排查。",
                    "data": {"type": type(ex).__name__},
                },
                "id": request.id,
            }

    def handle_object(
        self, payload: Any
    ) -> dict[str, Any] | list[dict[str, Any]] | None:
        """Handles parsed JSON data (either a single request or a batch array)."""
        if isinstance(payload, list):
            if not payload:
                return {
                    "jsonrpc": "2.0",
                    "error": JsonRpcError(
                        INVALID_REQUEST, "批量请求列表不能为空。"
                    ).to_dict(),
                    "id": None,
                }
            responses = []
            for item in payload:
                try:
                    req = JsonRpcRequest.from_dict(item)
                    resp = self.execute_request(req)
                    if resp is not None:
                        responses.append(resp)
                except JsonRpcError as jre:
                    req_id = item.get("id") if isinstance(item, dict) else None
                    responses.append(
                        {"jsonrpc": "2.0", "error": jre.to_dict(), "id": req_id}
                    )
                except Exception as ex:  # noqa: BLE001
                    req_id = item.get("id") if isinstance(item, dict) else None
                    responses.append(
                        {
                            "jsonrpc": "2.0",
                            "error": {
                                "code": INVALID_REQUEST,
                                "message": f"请求对象格式错误: {ex}",
                            },
                            "id": req_id,
                        }
                    )
            return responses if responses else None

        if isinstance(payload, dict):
            try:
                req = JsonRpcRequest.from_dict(payload)
                return self.execute_request(req)
            except JsonRpcError as jre:
                req_id = payload.get("id") if isinstance(payload, dict) else None
                return {"jsonrpc": "2.0", "error": jre.to_dict(), "id": req_id}
            except Exception as ex:  # noqa: BLE001
                req_id = payload.get("id") if isinstance(payload, dict) else None
                return {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": INVALID_REQUEST,
                        "message": f"请求解析异常: {ex}",
                    },
                    "id": req_id,
                }

        return {
            "jsonrpc": "2.0",
            "error": JsonRpcError(
                INVALID_REQUEST, "请求载荷必须是 JSON 对象或数组。"
            ).to_dict(),
            "id": None,
        }

    def handle_text(self, text: str) -> str | None:
        """Parses a raw text string and returns the JSON-RPC response as a JSON string, or None."""
        text = text.strip()
        if not text:
            return None

        try:
            payload = json.loads(text)
        except Exception as e:  # noqa: BLE001
            err_resp = {
                "jsonrpc": "2.0",
                "error": JsonRpcError(
                    PARSE_ERROR, f"JSON 语法解析失败: {e!s}。请核对请求字符串。"
                ).to_dict(),
                "id": None,
            }
            return json.dumps(err_resp, ensure_ascii=False)

        res = self.handle_object(payload)
        if res is None:
            return None
        return json.dumps(res, ensure_ascii=False)
