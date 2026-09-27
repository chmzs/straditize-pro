# -*- coding: utf-8 -*-
"""页面加载后，浏览器控制台必须零 error。

为什么必须放在 e2e 层而不是单测：这一类缺陷只有真实浏览器才暴露——
`render()` 里对 broken 图片调用 `drawImage` 抛的 `InvalidStateError`、
静态资源 404，headless 的 pytest / node 自检一概看不到。

历史：
* `GeologyCanvas.loadImage` 的 `onerror` 把加载失败也标成 `isImageLoaded = true`，
  导致 `drawBackgroundDiagram` 对 broken 元素调 drawImage 并中断整条 render 管线；
* `index.html` 没有声明 icon，浏览器回退请求 `/favicon.ico` 得到 404。
两者都在每次打开应用时产生控制台 error，现已修复并由本测试钉住。
"""
from __future__ import annotations

import re

from tests.e2e.conftest import run_playwright_console


def test_initial_load_console_has_no_errors(e2e_server) -> None:
    """冷启动（未载图）不应产生任何控制台 error。"""
    out = run_playwright_console(e2e_server["url"], min_level="error")

    m = re.search(r"Errors:\s*(\d+)", out)
    assert m, f"无法从 playwright-cli console 输出解析错误计数：\n{out}"
    count = int(m.group(1))

    assert count == 0, (
        f"页面加载后控制台出现 {count} 条 error（headless 测试抓不到这类问题）：\n{out}"
    )
    # 双保险：这两条是具体回归点，即使计数解析失效也能定位
    assert "InvalidStateError" not in out, f"画布 render 对 broken 图片 drawImage：\n{out}"
    assert "404" not in out, f"存在静态资源 404：\n{out}"


# 注意：这里**没有**再断言「图片加载失败时会打 background will be skipped 告警」。
# 实测该路径只在特定恢复场景触发（普通冷启动根本不调用 loadImage），
# 在 e2e 里无法确定性复现——一条打不出来的断言只会给出假信心，故不写。
# 对 drawBackgroundDiagram 的 naturalWidth 守卫，改由 MCP 前后对照验证：
# 修复前 console 2 errors（favicon 404 + InvalidStateError），修复后 0 errors。
