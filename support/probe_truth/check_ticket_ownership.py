"""Verify the ticket file-ownership table has no cross-ticket overlaps.

Run:  pixi run python support/probe_truth/check_ticket_ownership.py

This is a self-check of the ticket document: if two tickets in the same wave
claim the same file, the parallel plan is broken and the document must be fixed
before any ticket is handed out.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DOC = Path(__file__).resolve().parents[2] / "docs/plans/2026-09-20-8step-workflow-tickets.md"

# Only the W4 allocation table is machine-checkable; W2/W3 run alone by design.
ROW = re.compile(r"^\|\s*\*\*(T\d+)\*\*[^|]*\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|\s*$")
FILE = re.compile(r"`([^`]+\.(?:py|ts|mjs|toml|md))`")


def main() -> int:
    text = DOC.read_text(encoding="utf-8")
    lines = text.splitlines()

    start = next(i for i, l in enumerate(lines) if "W4 特性（7 张并行）" in l)
    rows: dict[str, set[str]] = {}
    exclusive: dict[str, set[str]] = {}
    for line in lines[start:]:
        if line.startswith("# ") and rows:
            break
        m = ROW.match(line)
        if not m:
            continue
        ticket, back, front, excl, tests, frag = m.groups()
        files = set(FILE.findall(back)) | set(FILE.findall(front)) | set(FILE.findall(tests)) | set(FILE.findall(frag))
        rows[ticket] = files
        # the "独占的既有文件" column: em-dash means none
        excl_files = set(FILE.findall(excl))
        if excl_files:
            exclusive[ticket] = excl_files

    if not rows:
        print("FAIL: could not parse the W4 allocation table")
        return 1

    print(f"解析到 {len(rows)} 张 W4 单子")
    for t, files in sorted(rows.items()):
        print(f"  {t}: {len(files)} 个文件")

    problems = []
    # 1) exclusive files must not appear in any other ticket's set
    for t, ex in exclusive.items():
        for other, files in rows.items():
            if other == t:
                continue
            bad = ex & files
            if bad:
                problems.append(f"{t} 的独占文件被 {other} 同时声明: {sorted(bad)}")

    # 2) no file may appear in two tickets' full sets
    seen: dict[str, str] = {}
    for t, files in sorted(rows.items()):
        for f in sorted(files):
            if f in seen:
                problems.append(f"文件 {f} 同时出现在 {seen[f]} 与 {t}")
            else:
                seen[f] = t

    # 3) files that nobody may write after W3 (tickets doc §0.5.2)
    nobody = [
        "types/pollen.ts",
        "components/Inspector.ts",
        "src/main.ts",
        "services/RpcClient.ts",
        "straditize_core/session.py",
        "straditize_core/rpc_server.py",
    ]
    # 4) files writable by exactly one named ticket after W3
    one_writer = {
        "components/Sidebar.ts": "T11",
        "components/GeologyCanvas.ts": "T13",
    }
    for t, files in sorted(rows.items()):
        for f in sorted(files):
            if any(f.endswith(ro) for ro in nobody):
                problems.append(f"{t} 声明了 §0.5.2 里'无人可写'的文件: {f}")

    # 5) the two single-writer files must only appear under their named ticket
    for f, owner in one_writer.items():
        for t, files in sorted(rows.items()):
            if t == owner:
                continue
            if any(x.endswith(f) for x in files):
                problems.append(f"{f} 属 {owner} 独占，却被 {t} 声明")

    if problems:
        print("\nFAIL: 文件拥有权存在冲突")
        for p in problems:
            print("  -", p)
        return 1

    print("\nOK: W4 七张单子的文件集合两两不相交")
    print("OK: 独占文件（Sidebar.ts→T11 / GeologyCanvas.ts→T13）未被他人声明")
    print("OK: 未触碰 §0.5.2 里'无人可写'的共享文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
