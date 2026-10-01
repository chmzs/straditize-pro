## [E2E-PLAYWRIGHT] 2026-09-29 13:10 — 步骤 1–5 逐步骤排查完（步骤 5 查出 3 真缺陷已修；收尾又补出"面板重挂吞输入/焦点"，未修待决策）
- **规模与命令**：`tests/e2e/`（12 个 .py、1451 行）已删除 → `frontend/e2e/` **16 spec / 53 用例 / 308 处断言 / 86 次真实后端读取**；`pixi run test-e2e` = `build && playwright test`；`pixi run test` 去掉 `--ignore=tests/e2e` → **277 passed / 96 subtests**；`pixi run test-contract` 只跑 5 条契约用例（**26s vs 全量 ~110s**）。
- **步骤 4 去线模型彻底换代**：旧档位模型全下线（删 `lineCorrections`/`degridStrength`/`DegridResult` + 5 个永不报错的 `?.` 死监听 `#select-inspector-degrid` 等）；画笔改走现行 `line_strokes` → `algorithm.applyLineRemoval(strokes=…)` **全量覆盖**；「擦掉误标 / 补回漏标 / 清空笔迹」三按钮恢复到 S4 `CleanupPanel`。
- **本轮共修 4 个真实缺陷**：①「清空笔迹」改走 `setLineStrokes([])`；② 清理编辑不进撤销栈；③ 工具栏导出失败改 `reportBackendFailure` 并停在原地；④ 顶栏范例移除「验证图谱」死选项。
- **全局错误门禁与墨迹门禁**：`fixtures.ts` auto fixture 捕获 console.error / 失败 RPC；`canvasInk`/`canvasColorPixels` 直读 `#geology-canvas` 像素门禁；`error-surfacing.spec.ts` 正向验证用户弹框。
