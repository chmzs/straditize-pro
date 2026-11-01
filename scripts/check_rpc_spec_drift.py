"""Checks the §4A table against the code, so the doc cannot drift silently.

Two directions of drift matter:
  1. a registered agedepth/ensemble method missing from the doc  (under-documented)
  2. a method documented in §4A that is no longer registered       (stale doc)

And the field-level facts this round changed (three-state age_increases_downcore,
metadata.age_direction_reason) must actually appear, because a doc that claims a
contract the code no longer honours is worse than no doc.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "JSON_RPC_SPECIFICATION.md"


def registered_family_methods() -> set[str]:
    names: set[str] = set()
    for path in (ROOT / "straditize_core" / "rpc_methods").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for match in re.finditer(r'register_method\(\s*["\']([^"\']+)["\']', source):
            name = match.group(1)
            if name.startswith(("agedepth.", "ensemble.")):
                names.add(name)
    return names


def documented_methods(text: str) -> set[str]:
    """Method names from the §4A subsection headings only.

    The heading is ``## 4A. 年代-深度模型与年代集合`` and its children are
    ``### 4A.N `method.name```, so the slice has to anchor on the full heading, not on
    the bare ``## 4A.`` prefix (which also matches its own title line and yields nothing).
    """
    start = text.find("## 4A.")
    if start < 0:
        return set()
    end = text.find("\n## 5.", start)
    section = text[start:] if end < 0 else text[start:end]
    return set(re.findall(r"### 4A\.\d+ `([a-zA-Z]+\.[a-zA-Z]+)`", section))


def main() -> int:
    text = DOC.read_text(encoding="utf-8")
    registered = registered_family_methods()
    documented = documented_methods(text)

    failures: list[str] = []

    missing = sorted(registered - documented)
    if missing:
        failures.append(f"registered but not documented: {missing}")

    stale = sorted(documented - registered)
    if stale:
        failures.append(f"documented but not registered: {stale}")

    # The three-state contract must be stated, not just implied.
    if "bool \\| null" not in text and "bool | null" not in text:
        failures.append("age_increases_downcore three-state type not documented")
    for token in ("age_direction_reason", "age_increases_downcore"):
        if token not in text:
            failures.append(f"{token} missing from the spec")
    if "两两斜率" not in text:
        failures.append("the curve-derived deduction is not explained")

    # The method count must match reality (it said 97 while 105 were registered).
    count_match = re.search(r"后端当前注册 \*\*(\d+)\*\* 个方法", text)
    if not count_match:
        failures.append("method count sentence not found")
    else:
        claimed = int(count_match.group(1))
        if claimed < 105:
            failures.append(f"doc claims {claimed} methods, at least 105 are registered")

    print(f"registered family methods: {len(registered)}")
    print(f"documented family methods: {len(documented)}")
    if failures:
        print("\nFAILURES:")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("\n§4A matches the code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
