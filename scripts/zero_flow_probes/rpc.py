# -*- coding: utf-8 -*-
"""极简 JSON-RPC 探针客户端（stdlib only，不引入新依赖）。

用法：
    pixi run python scripts/zero_flow_probes/rpc.py <port> <method> ['<json-args>']

或作为模块：
    from rpc import Rpc
    r = Rpc(22940)
    r.call("straditize.getDiagramData")
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


class Rpc:
    def __init__(self, port: int = 22940, host: str = "127.0.0.1") -> None:
        self.url = f"http://{host}:{port}/rpc"
        self._id = 0

    def call(self, method: str, params: dict | list | None = None, timeout: float = 120.0):
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            body["params"] = params
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:  # pragma: no cover - 探针诊断用
            raw = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc
        if "error" in payload:
            raise RuntimeError(
                f"JSON-RPC error for {method}: {json.dumps(payload['error'], ensure_ascii=False)}"
            )
        return payload.get("result")

    def try_call(self, method: str, params: dict | list | None = None):
        """返回 (ok, result_or_error_str)，用于断言"应当失败"的路径。"""
        try:
            return True, self.call(method, params)
        except Exception as exc:  # noqa: BLE001 - 探针要看见任何失败形态
            return False, str(exc)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 22940
    method = sys.argv[2] if len(sys.argv) > 2 else "e2e.health"
    params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    r = Rpc(port)
    out = r.call(method, params)
    print(json.dumps(out, ensure_ascii=False, indent=2)[:20000])


if __name__ == "__main__":
    main()
