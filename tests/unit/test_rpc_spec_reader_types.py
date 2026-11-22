# -*- coding: utf-8 -*-
"""接口规范与代码的**枚举一致性**检查。

为什么需要这条：`pixi run lint` 里的 `lint-rpc-doc` 只核对 `agedepth.*` / `ensemble.*`
两族（见 `scripts/check_rpc_spec_drift.py`），其余接口的文档写错了不会变红 ——
`core.digitize` 的 `reader_type` 就曾写成复数 `"bars"`、默认 `"line"`，
与底层 `digitize_column` / `plot_type` 的单数 `"bar"`、默认 `"area"` 自相矛盾，
直接导致 `bar` 在代码里落进 else 分支走均值（P-04，柱状图读数只有真值一半）。

文档是契约的单一事实源：文档写错，代码就会跟着分叉。
"""
from __future__ import annotations

import re
from pathlib import Path

from straditize_core.session_parts.digitize import READER_TYPES

SPEC = Path(__file__).resolve().parent.parent.parent / "docs/JSON_RPC_SPECIFICATION.md"
KNOWN = {"area", "line", "bar", "bars", "area_exaggerated"}


def _digitize_section() -> str:
    text = SPEC.read_text(encoding="utf-8")
    start = text.index("### 4.4 `core.digitize`")
    end = text.index("### 4.5", start) if "### 4.5" in text[start:] else start + 2000
    return text[start:end]


def test_documented_reader_types_match_code() -> None:
    """§4.4 声明的**规范取值**必须与 `READER_TYPES` 完全一致。

    只取「规范名四个」那句里的名字，别把紧跟着的「历史别名 `bars`」也算成受支持取值
    —— 别名恰好是要禁止出现在规范里的东西。

    取值里带下划线（`area_exaggerated`）: 字符类必须写 `[a-z_]+`，
    否则新值被正则静默漏掉，这条会给出"文档少一个"的误导性失败。
    """
    section = _digitize_section()
    m = re.search(r"\*\*规范名四个\*\*：(.+?)。", section)
    assert m, "§4.4 必须有一句列出规范取值"
    documented = set(re.findall(r'`"([a-z_]+)"`', m.group(1))) & KNOWN
    assert documented == set(READER_TYPES), (
        f"文档声明 {sorted(documented)}，代码支持 {sorted(READER_TYPES)} —— "
        "两套名字并存会让某个取值静默走错分支"
    )
    assert "bars" not in documented, "别名 `bars` 不得作为受支持取值写进文档"


def test_documented_default_matches_code_default() -> None:
    """§4.4 声明的默认值必须与 `digitize()` 的签名默认值一致。

    默认值在 2026-11 由字面量 `"area"` 改成 `null`：不传读法时取**该列自己声明的**
    `reader_type`（`column.update` 写、工程包持久化）。默认值一旦写错，
    "列上设了 `area_exaggerated` 却按 `area` 导出"这种漂移不会变红。
    """
    import inspect

    from straditize_core.session import StraditizeSession

    sig = inspect.signature(StraditizeSession.digitize)
    default = sig.parameters["reader_type"].default
    section = _digitize_section()
    m = re.search(r"默认\s*`([A-Za-z_\"]+)`", section)
    assert m, "文档必须写明默认值"
    documented = m.group(1).strip('"')
    if default is None:
        assert documented == "null", (
            f"代码默认是 None（取列声明），文档却写 {documented!r}"
        )
    else:
        assert documented == default, f"文档默认 {documented!r}，代码默认 {default!r}"
