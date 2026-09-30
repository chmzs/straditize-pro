"""Taxa naming and OCR spatial interval alignment RPC methods (T11).

Strictly adheres to:
- Frozen Contracts v1.3 §5 (Column naming uniqueness within ROI, no auto-suffix);
- Frozen Contracts v1.3 §8 & Ticket T11 (Interval-based containment snapping and 3-category reconciliation).
"""

from __future__ import annotations

import re
from typing import Any

from ..protocol import JsonRpcError
from ..ocr.engine import snap_labels_to_columns

COLUMN_NAME_PATTERN = re.compile(r"^[\w\u4e00-\u9fa5\.\-\s]{1,63}$")


def validate_column_unique_name(
    columns: list[dict[str, Any]],
    target_col_id_or_index: int | str,
    new_name: str,
) -> None:
    """Validates that a new column name is unique within its ROI.

    Raises JsonRpcError(-32002) for naming conflict, -32001 for missing column,
    and -32602 for syntax errors.
    """
    clean_name = new_name.strip()
    if not clean_name or not COLUMN_NAME_PATTERN.match(clean_name):
        raise JsonRpcError(
            -32602,
            f"参数格式不合规：属种列名 '{new_name}' 不合法。请输入 1-63 位字母、数字、点号或汉字。",
        )

    # Find the target column to know its roi_id
    target_col = None
    target_idx = None
    if isinstance(target_col_id_or_index, int) or (
        isinstance(target_col_id_or_index, str) and target_col_id_or_index.isdigit()
    ):
        idx = int(target_col_id_or_index)
        if 0 <= idx < len(columns):
            target_col = columns[idx]
            target_idx = idx
    else:
        for idx, c in enumerate(columns):
            if c.get("id") == str(target_col_id_or_index):
                target_col = c
                target_idx = idx
                break

    if target_col is None:
        raise JsonRpcError(
            -32001,
            f"前置状态缺失：未找到目标属种列 '{target_col_id_or_index}'。请先在【步骤 5: 分列】确认列切分。",
        )

    target_roi_id = target_col.get("roi_id")
    target_id = target_col.get("id") or f"col_{target_idx}"

    for idx, c in enumerate(columns):
        c_id = c.get("id") or f"col_{idx}"
        if c_id == target_id:
            continue
        c_roi_id = c.get("roi_id")
        if c_roi_id == target_roi_id:
            c_name = (c.get("name") or c.get("species") or "").strip()
            if c_name == clean_name:
                raise JsonRpcError(
                    -32002,
                    f"命名冲突：属种列名 '{clean_name}' 在有效区 '{target_roi_id or 'default'}' 内已存在。"
                    f"列 '{target_id}' 与列 '{c_id}' 产生重名冲突，请修改名称。",
                )


def register(dispatcher: Any, session: Any) -> None:
    """Register naming.* RPC methods."""

    def rename_column(col_index: int | str, name: str) -> dict[str, Any]:
        """Renames a column ensuring strict ROI-scoped uniqueness."""
        columns = getattr(session, "columns", [])
        validate_column_unique_name(columns, col_index, name)

        # Apply update
        if isinstance(col_index, int) or (
            isinstance(col_index, str) and col_index.isdigit()
        ):
            idx = int(col_index)
            col = columns[idx]
        else:
            idx = next(
                i for i, c in enumerate(columns) if c.get("id") == str(col_index)
            )
            col = columns[idx]

        clean_name = name.strip()
        col["name"] = clean_name
        col["species"] = clean_name
        # `session.taxa_names` 是 `detect_columns` 重新分列时唯一的名字来源
        # （session.py:901-908），但它只在"载入项目"（session.py:1898）与
        # "新增列"（session.py:2168）时被填充。走"载入图片 → 自动分列"这条常规路径
        # 时它是**空的**：session.py:471 载图时清空它，而 detect_columns 只读不写。
        # 于是 `if idx < len(taxa_names)` 会**静默丢弃**这次改名 —— 名字留在
        # col["name"] 上，下一次分列立刻回到 colNN（步骤 5 e2e T2 实测：
        # 改完立刻读是 E2E_TAXA_01，重新分列后变回 col02）。
        # 这里先把 taxa_names 补齐到与 columns 等长（用各列当前名字，保证其余列
        # 不会因为补齐而改名），再写入本次改名。
        taxa_names = getattr(session, "taxa_names", None)
        if taxa_names is None:
            taxa_names = []
            session.taxa_names = taxa_names
        for i in range(len(taxa_names), len(columns)):
            taxa_names.append(
                columns[i].get("name")
                or columns[i].get("species")
                or f"col{i + 1:02d}"
            )
        taxa_names[idx] = clean_name

        record_history = getattr(session, "_record_history", None)
        if record_history:
            record_history(f"Rename column {col.get('id')} to {clean_name}")

        return {"success": True, "column": col}

    def snap_labels(
        labels: list[dict[str, Any]],
        columns: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Executes interval-based spatial column snapping for a set of OCR labels."""
        cols = columns if columns is not None else getattr(session, "columns", [])
        reconciliation = snap_labels_to_columns(labels, cols)
        return {"labels": labels, "reconciliation": reconciliation}

    dispatcher.register_method("naming.renameColumn", rename_column)
    dispatcher.register_method("naming.snapLabels", snap_labels)

    # Expose WebMCP tool inspection & Streamable HTTP MCP protocol on the JSON-RPC server
    def webmcp_list_tools(**_kwargs: Any) -> dict[str, Any]:
        from ..mcp_server import WEBMCP_TOOLS

        return {
            "tools": [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "inputSchema": t["inputSchema"],
                }
                for t in WEBMCP_TOOLS
            ]
        }

    def mcp_initialize(**_kwargs: Any) -> dict[str, Any]:
        from ..mcp_server import MCP_PROTOCOL_VERSION

        return {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "straditize-webmcp", "version": "2.0.0"},
        }

    def mcp_notifications_initialized(**_kwargs: Any) -> None:
        return None

    def mcp_ping(**_kwargs: Any) -> dict[str, Any]:
        return {}

    def mcp_tools_call(
        name: str = "",
        arguments: dict[str, Any] | None = None,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        from ..mcp_server import StraditizeWebMcpServer

        server = StraditizeWebMcpServer(
            web_rpc_url=None,
            session=session,
            dispatcher=dispatcher,
        )
        return server.call_tool(name, arguments)

    dispatcher.register_method("webmcp.listTools", webmcp_list_tools)
    dispatcher.register_method("webmcp.callTool", mcp_tools_call)
    dispatcher.register_method("initialize", mcp_initialize)
    dispatcher.register_method(
        "notifications/initialized", mcp_notifications_initialized
    )
    dispatcher.register_method("ping", mcp_ping)
    dispatcher.register_method("tools/list", webmcp_list_tools)
    dispatcher.register_method("tools/call", mcp_tools_call)
