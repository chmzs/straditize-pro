# -*- coding: utf-8 -*-
"""放大倍数只许有一个键：`exaggeration_mult`。

## 缺口（docs/testing-strategy.md §9 第三条）

同一个「局部放大倍数」在仓库里有四个名字、三条通道：

| 名字 | 谁写 | 谁读 |
| --- | --- | --- |
| `exaggeration_mult` | column.update / calibrateXTicks / project.load | 换算（px_to_value 除以它）、导出、payload |
| `exaggeration_multiplier` | column.update / detect_columns 种子 5.0 | `_resolve_exaggeration` 的历史分支 |
| `has_exaggeration` | column.update / project.save | 同上 |
| `mult_source`（'user' / 'inferred'） | column.update / calibrateXTicks | **无人读，也从不下发** |

两个后果：
1. 三份状态可以互相打架（一份说 5、一份说 False、一份说 None）；
2. 前端 `|| 5` / `?? 5` 兜底一旦写回，就把「没设放大」变成「放大 5 倍」——
   而 `px_to_value` 真的会除以它，读数因此**缩小 5 倍**。

## 收敛后的约定

- 存储与传输**只有** `exaggeration_mult: float | None`（>1 才有意义，null = 无放大）；
- 布尔一律由它推导（`is not None`），不再单独存；
- 旧名字只在**入口**被接受（column.update 的入参、老工程包的字段），立刻归一，不落库；
- `mult_source` 删除。

## 反向验证

把任一处的归一写回（例如 column.update 里重新写 `exaggeration_multiplier`）→ 对应的
「只有这一个键」断言立刻红。
"""

from __future__ import annotations

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import cleanup as cleanup_methods
from straditize_core.rpc_methods import columns as columns_methods
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
ALIASES = ("exaggeration_multiplier", "has_exaggeration", "mult_source")


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def _dispatcher(session: StraditizeSession) -> JsonRpcDispatcher:
    dispatcher = JsonRpcDispatcher()
    columns_methods.register(dispatcher, session)
    system_methods.register(dispatcher, session)
    cleanup_methods.register(dispatcher, session)
    return dispatcher


def _call(dispatcher: JsonRpcDispatcher, method: str, **params):
    response = dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )
    assert "error" not in response, response["error"]
    return response["result"]


def _column(session: StraditizeSession, index: int = 0) -> dict:
    return session.columns[index]


def _assert_single_key(column: dict, expected: float | None) -> None:
    assert column.get("exaggeration_mult") == expected, column.get("exaggeration_mult")
    leftovers = [k for k in ALIASES if k in column]
    assert leftovers == [], (
        f"库里还留着 {leftovers}：一个概念存多份，迟早互相打架"
    )


def test_update_stores_only_the_canonical_key() -> None:
    session = _session()
    _call(_dispatcher(session), "column.update", col_index=0, updates={"exaggeration_mult": 5})

    _assert_single_key(_column(session), 5.0)


def test_null_clears_the_multiplier() -> None:
    session = _session()
    dispatcher = _dispatcher(session)
    _call(dispatcher, "column.update", col_index=0, updates={"exaggeration_mult": 4})
    _call(dispatcher, "column.update", col_index=0, updates={"exaggeration_mult": None})

    _assert_single_key(_column(session), None)


def test_value_not_above_one_counts_as_unset() -> None:
    session = _session()
    _call(_dispatcher(session), "column.update", col_index=0, updates={"exaggeration_mult": 1.0})

    _assert_single_key(_column(session), None)


def test_legacy_input_names_still_normalise() -> None:
    for legacy in ("exaggerationMult", "exaggeration_multiplier"):
        session = _session()
        _call(
            _dispatcher(session),
            "column.update",
            col_index=0,
            updates={legacy: 7},
        )
        _assert_single_key(_column(session), 7.0)


def test_payload_exposes_only_the_canonical_key() -> None:
    session = _session()
    dispatcher = _dispatcher(session)
    _call(dispatcher, "column.update", col_index=0, updates={"exaggeration_mult": 5})

    column = _call(dispatcher, "straditize.getDiagramData")["columns"][0]

    assert column["exaggeration_mult"] == 5.0
    assert "exaggerationMult" not in column, (
        "payload 同时发两个名字，前端就只能靠约定记住读哪个"
    )
    assert "hasExaggeration" not in column, "布尔可由 exaggeration_mult 是否为 null 推出"


def test_project_save_does_not_write_the_boolean() -> None:
    session = _session()
    _call(_dispatcher(session), "column.update", col_index=0, updates={"exaggeration_mult": 5})

    payload = session.project_save(format="json")["data"]

    saved = payload["columns"][0]
    assert saved["exaggeration_mult"] == 5.0
    assert "has_exaggeration" not in saved
    assert "exaggeration_multiplier" not in saved


def test_project_load_normalises_a_legacy_pack() -> None:
    session = _session()
    payload = session.project_save(format="json")["data"]
    payload["columns"][0].pop("exaggeration_mult", None)
    payload["columns"][0]["has_exaggeration"] = True
    payload["columns"][0]["exaggeration_multiplier"] = 7.0

    fresh = StraditizeSession()
    fresh._init_cleanup()
    fresh.load_image(image_path=PLATE)
    fresh.project_load(payload)

    _assert_single_key(fresh.columns[0], 7.0)
