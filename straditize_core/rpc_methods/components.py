"""Component management RPC methods."""

from __future__ import annotations

import re
from typing import Any

from ..components import component_manager
from ..protocol import INVALID_PARAMS, JsonRpcError

#: 组件名直接拼进文件路径（`uninstall` 还会对它 `shutil.rmtree`），所以必须是**单一安全段**：
#: 只允许字母数字与 `._-`，不以 `.` 开头（挡掉 `..`），不含路径分隔符。
_COMPONENT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _validated_name(name: str) -> str:
    """校验组件名。非法即 -32602，**在动磁盘之前**拒绝。

    没有这道校验时，`component.uninstall(name="../..")` 会 rmtree 到组件目录之外——
    而它同时是 WebMCP 可直达的对外接口。
    """
    if not isinstance(name, str) or not _COMPONENT_NAME.match(name):
        raise JsonRpcError(
            INVALID_PARAMS,
            f"非法的组件名 {name!r}：只允许字母数字与 ._-（1–64 字符），"
            "不能含路径分隔符或 ..（该目录会被整体删除）",
        )
    return name


def register(dispatcher: Any, session: Any) -> None:
    """Register component manager operations."""
    dispatcher.register_method(
        "component.getStatus",
        lambda name="age-modeling": component_manager.get_status(_validated_name(name)),
    )
    dispatcher.register_method(
        "component.install",
        lambda name="age-modeling", custom_url=None: (
            component_manager.start_download_task(_validated_name(name), custom_url)
        ),
    )
    dispatcher.register_method(
        "component.installOfflineZip",
        lambda zip_path, name="age-modeling": component_manager.install_from_zip(
            zip_path, _validated_name(name)
        ),
    )
    dispatcher.register_method(
        "component.uninstall",
        lambda name="age-modeling": component_manager.uninstall(_validated_name(name)),
    )
