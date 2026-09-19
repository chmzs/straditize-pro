## [INTERACTION] 2026-09-20 03:20 — 交互统一 / 一键重置 / 阶段门禁（已提交 d1afb4b）
- 键位收敛（别名全删）：`Ctrl+[` 左栏、`Ctrl+]` 右栏、`F1` 帮助、`Delete` 删除、`Ctrl+Y` 重做；WPD 规范 A/S/D/C。
- 一键重置 `#btn-reset-all` → `GeologyCanvas.resetAllOperations()`；缩放区新增 `⛶适应`/`1:1`。
- 阶段→工具唯一事实源 `getAllowedTools()`/`guardTool()`（GeologyCanvas.ts:~2299），堵住 select 模式点击绕门禁的漏洞。
- 实机复核：重置 29→0 列回 S1；S3 按 A 被拦、S5 按 A 可加点。
