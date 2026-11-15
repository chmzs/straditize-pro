#!/usr/bin/env python
"""禁止「已被 .gitignore 忽略、却仍被跟踪」的文件。

## 为什么需要这道门禁

`.gitignore` 对**已跟踪**的文件不生效。所以一旦某文件在忽略规则之前被提交过，
它就会一直跟着仓库走，而 `git status` 不再提示它——这是静默泄漏：

- 本仓真实事故：`.dsh/rollback/session-*.json`（本地 agent 会话快照）在
  `a64e801` 里进库，而 `.gitignore:54` 的 `.dsh/` 规则是后来才加的；
  之后任何人跑 `git status` 都看不到它们，直到有人手工 `git ls-files` 才发现。
- 同一类还有反向事故：`docs/assets/real_browser_playwright_verified.png` 被
  `real_browser_*_verified.png` 通配误伤，只因"早已被跟踪"才没丢；一旦有人
  删除后重新添加，新克隆就会缺这张站点 hero 图（页面 404）。

判定依据只有一条命令：``git ls-files -ci --exclude-standard``——它列出的是
"在索引里、但按当前 .gitignore 本不该被跟踪"的文件。非空即失败。

## 例外清单

若某个文件**故意**既要被跟踪、又匹配某条忽略规则（本仓目前只有站点 hero 图，
已在 `.gitignore` 里用 `!` 取反，因此不需要在这里列），把它加进 ``ALLOW`` 并
在紧邻注释里写明理由。**加例外必须给理由**，否则就是换个地方静默。
"""

from __future__ import annotations

import subprocess
import sys

#: 故意允许"被忽略但仍跟踪"的路径（当前为空：hero 图已用 .gitignore 的 `!` 取反）。
ALLOW: frozenset[str] = frozenset()

GUIDANCE = """\
处置方式二选一：
  1. 该文件不该入库 ⇒ `git rm --cached <path>`（保留工作区副本），提交即可；
  2. 该文件确实要入库 ⇒ 在 .gitignore 里用 `!` 取反（显式表达意图），
     或（不得已时）加进本脚本的 ALLOW 并在注释里写明理由。
"""


def main() -> int:
    proc = subprocess.run(
        ["git", "ls-files", "-ci", "--exclude-standard"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        print("git ls-files 失败，无法判定：", file=sys.stderr)
        print(proc.stderr.strip(), file=sys.stderr)
        return 2

    offenders = [
        line.strip()
        for line in proc.stdout.splitlines()
        if line.strip() and line.strip() not in ALLOW
    ]
    if not offenders:
        print("tracked-ignored: OK（没有被忽略却仍被跟踪的文件）")
        return 0

    print(
        f"✘ 有 {len(offenders)} 个文件已被 .gitignore 忽略、却仍在索引里"
        "（静默泄漏；.gitignore 对已跟踪文件不生效）：",
        file=sys.stderr,
    )
    for path in offenders:
        print(f"  - {path}", file=sys.stderr)
    print(file=sys.stderr)
    print(GUIDANCE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
