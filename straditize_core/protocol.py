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
import threading
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

#: Authoritative contract inventory of all registered backend RPC methods (104 methods).
#:
#: 这份清单只保证「后端注册表 ↔ 声明」一致（consistency_check 的 H 门禁），**不**表示每条都有
#: 前端入口。已知的纯对外 / agent 面（前端零调用，用途由 spec 声明）：`core.getShadowLayer`、
#: `algorithm.degrid`、`core.reset`、`ensemble.add`、`webmcp.listTools`。按调用量删这些方法是错的——先看
#: `docs/rpc-call-evidence.json` 里的调用证据与判据。
ALL_RPC_METHODS: tuple[str, ...] = (
    "agedepth.checkREnvironment",
    "agedepth.extractAndInspect",
    "agedepth.generateBaconScript",
    "agedepth.generateEnsemble",
    "agedepth.generateGeoChronRScript",
    "agedepth.getInspection",
    "agedepth.loadModelDiagram",
    "agedepth.runBaconModeling",
    "agedepth.runLocalBacon",
    "agedepth.updateModel",
    "algorithm.applyLineRemoval",
    "algorithm.clearCleanupEdits",
    "algorithm.degrid",
    "algorithm.deleteLineGeometry",
    "algorithm.detectColumns",
    "algorithm.detectLineCandidates",
    "algorithm.detectXTicks",
    "algorithm.measureRuler",
    "algorithm.extractHorizonConsensus",
    "algorithm.extractTurningPoints",
    "algorithm.setGeometryStatus",
    "algorithm.setLineThickness",
    "algorithm.upsertLineGeometry",
    "column.add",
    "column.calibrateXTicks",
    "column.clearXTicks",
    "column.remove",
    "column.update",
    "component.getStatus",
    "component.install",
    "component.installOfflineZip",
    "component.uninstall",
    "core.applyDepthGrid",
    "core.batchSetTaxa",
    "core.calibrateAxes",
    "core.detectColumns",
    "core.digitize",
    "core.exportData",
    "core.extractForeground",
    "core.extractGridValues",
    "core.getShadowLayer",
    "core.getStatus",
    "core.loadImage",
    "core.reset",
    "core.updateControlPoint",
    "ensemble.add",
    "ensemble.list",
    "export.csv",
    "export.exportLipd",
    "export.exportXlsx",
    "export.getReadiness",
    "export.r",
    "export.tar",
    "history.redo",
    "history.undo",
    "image.detectDeskew",
    "image.load",
    "image.rotate",
    "image.switchPdfPage",
    "initialize",
    "metadata.extractFromPdf",
    "metadata.fetchByDoi",
    "metadata.get",
    "metadata.parseExternalText",
    "metadata.update",
    "naming.renameColumn",
    "naming.snapLabels",
    "notifications/initialized",
    "ocr.applyLabels",
    "ocr.getTaxaDict",
    "ocr.parseTaxaText",
    "ocr.recognizeLabels",
    "ocr.saveCustomTaxa",
    "ping",
    "point.add",
    "point.move",
    "point.remove",
    "project.load",
    "project.new",
    "project.save",
    "qa.summarize",
    "roi.create",
    "roi.groupCreate",
    "roi.groupRemove",
    "roi.groupUpdate",
    "roi.list",
    "roi.remove",
    "roi.setActive",
    "roi.setPrimary",
    "roi.update",
    "samples.clear",
    "samples.extractConsensus",
    "samples.list",
    "samples.pasteDepths",
    "samples.set",
    "shutdown",
    "straditize.getDiagramData",
    "system.getConfig",
    "system.ping",
    "system.updateConfig",
    "tools/call",
    "tools/list",
    "webmcp.callTool",
    "webmcp.listTools",
)


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
    """Manages method registration and handles execution of JSON-RPC 2.0 requests.

    ## 为什么这里必须有一把锁（B-08）

    服务端每请求一线程（`rpc_server.py` 的 `ThreadingHTTPServer`），而所有线程
    共享**同一个** session 对象。session 的方法都是"读-改-写"多步：`load_image`
    先写 `width/height`、再 `_init_rois()` 清空 `rois`、再 `roi_create()` 回填。
    中间任何一刻被另一个线程读到，就是"有图宽、但 `rois: []`"的撕裂态——
    实测两标签页并发稳定复现（8/8 轮，每轮 6~14 次），单标签页测不出
    （前端把请求串行化了）。

    ## 为什么是 RLock 而不是 Lock

    dispatch **会重入**，不是理论上的可能性，是一条真实注册链：

        tools/call  →  naming.py:mcp_tools_call
                    →  StraditizeWebMcpServer.call_tool
                    →  _call_rpc(web_rpc_url=None)
                    →  dispatcher.handle_object(...)   ← 同一线程再进 execute_request

    `webmcp.callTool` 同理。用 `threading.Lock` 会在第二个 `acquire()` 上自锁，
    而且因为锁在请求线程里、`release` 永远到不了，整个服务端**永久挂死**。
    RLock 允许同一线程重复获取，正是这条链需要的语义。

    ## 粒度：整个请求一把锁

    session 没有更细的锁边界（也没有事务），只在 `execute_request` 外层加锁是
    唯一能保证"一个 RPC 对它看到的 session 状态是原子的"的位置。代价是并发度：
    同一进程里的请求变成串行。这是有意的取舍——宁可慢，也不能让用户读到
    撕裂态并据此做判断。
    """

    def __init__(self):
        self._methods: dict[str, Callable[..., Any]] = {}
        #: Serialises every request against the shared session. See class docstring:
        #: reentrant because ``tools/call`` re-enters the dispatcher on the same thread.
        self._request_lock = threading.RLock()

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
        """Executes a single validated request, serialised against the session."""
        with self._request_lock:
            return self._execute_request_locked(request)

    def _execute_request_locked(
        self, request: JsonRpcRequest
    ) -> dict[str, Any] | None:
        """The body of :meth:`execute_request`; caller already holds the lock."""
        if request.method not in self._methods:
            if request.is_notification:
                return None
            return {
                "jsonrpc": "2.0",
                "error": JsonRpcError(
                    METHOD_NOT_FOUND,
                    f"Method not found: 后端未提供接口 '{request.method}'。请检查方法名拼写或接口版本。",
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
                    PARSE_ERROR, f"Parse error: JSON 语法解析失败: {e!s}。请核对请求字符串。"
                ).to_dict(),
                "id": None,
            }
            return json.dumps(err_resp, ensure_ascii=False)

        res = self.handle_object(payload)
        if res is None:
            return None
        return json.dumps(res, ensure_ascii=False)
