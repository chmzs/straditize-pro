# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-20 03:20 | 分支 dev-v2-modern | HEAD 4551447
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤30 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `cd frontend && npm run build`
- 当前结果：lint ✓ ｜ build ✓ ｜ test **88/88 passed (100% 通过)**

## [INTERACTION] 2026-09-20 02:40 — 交互统一 / 一键重置 / 快捷键收敛
- 键位收敛（仅保留规范键，别名全删）：`Ctrl+[` 左栏、`Ctrl+]` 右栏、`F1` 帮助、`Delete` 删除选中、`Ctrl+Y` 重做。
- 新增一键重置：`重置` 按钮（Toolbar `#btn-reset-all`）→ `GeologyCanvas.resetAllOperations()`（GeologyCanvas.ts:~2250）。
- 缩放区新增 `⛶适应`(`#btn-fit`/F) 与 `1:1`(`#btn-100`/`Ctrl+1`)；缩放徽标点击回 100%。
- 实机复核（8917 隔离实例）：29 列 → 重置后 badge 0 / S1 / undo 禁用 / footer 回落 `--`；截图 `verify_reset_*.png`。

## [GATING] 2026-09-20 03:20 — 接手阶段门禁（原会话停工）
- 阶段→工具表收敛为唯一事实源：`GeologyCanvas.getAllowedTools()` / `isToolAllowed()` / `guardTool()`（约 :2299）。
- 修复可绕过漏洞：S3/S4 下 `select` 模式点击画布仍会隐式加锚点（原守卫只管 A 键）→ 鼠标路径同受门禁。
- `updateFloatingToolbarForStage`、键盘 A/C/D/R 守卫、Delete 删除全部改走同一张表；C 由 <2 收紧为 <3（对齐按钮置灰）。
- 顺带修复：`onToolModeChange` 未接线导致页脚「模式:」经画布切工具后长期停留在旧值（main.ts:296）。
- 实机复核（8921 隔离实例）：S3 按 A 被拦且模式不变、点击锚点数 0→0；S5 按 A 成功、锚点 0→1。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`。

## 索引
- 历史归档：`HANDOFF-archive/` ｜ 规范：`AGENTS.md` ｜ 截图：`verify_logo_light.png`
