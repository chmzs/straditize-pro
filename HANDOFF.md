# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-30 23:45 | 分支 main | HEAD 0549efe | Tag v2.0.0
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `npm --prefix frontend test` ｜ `pixi run test-contract` ｜ `pixi run build-windows` ｜ `pixi run record-tutorials`
- 当前结果：**老版物理剥离 + 独立发行包闭环 + 8步全流程动图就位 + v2.0.0 正式发布**；代码规范 A~G 全绿，前后端契约全通，Windows 独立可执行包 0 报错拉起。

## [COLMODEL] 2026-09-30 14:45 — P0–P5 + 技术债清零 + 外部AI免Token导入助手 + 尕海湖自包含工程包
- **状态**：步骤 1–8 + 元数据/OCR/年代深度三大模态真 E2E 闭环（累计修 30 项缺陷）；单测 302 passed，Playwright 21 spec / 73 passed。
- **结构性技术债清零**：`_reindex_columns` 收口点集与 `taxa_names` 键位重排；OCR 单例缓存；`digitize()` 依自身 `roi_id` 解析边界（#30）。
- **LiPD v1.3 + AI 助手 + 尕海湖实战**：补齐野外采集人/单位/基金等标准字段；免 Token 导入助手支持网页 AI 复制回填；产出尕海湖自包含工程包。

## [RELEASE-V2] 2026-09-30 23:40 — 老版剥离 + PyInstaller修复 + 教程动图管线 + v2.0.0主分支推送
- **剥离老版与资产迁移**：物理删除 `straditize/`，`hoya` 与 `beginner` 迁入 `straditize_core/assets/tutorials/`，修复 12 处测试路径与 pyproject/pixi 配置。
- **打包与编码缺陷修复**：PyInstaller spec 接入 `collect_submodules("straditize_core")`；修复 Windows 控制台 GBK 启动编码崩溃与 `•` 特殊符。
- **教学动图全自动录制**：新增 `scripts/record_tutorials.py`（`pixi run record-tutorials`），Playwright 真实 Edge 录制 8 步全流程与三大模态动图并更新文档。
- **分支与发版**：老版封存推 `legacy`；现代版设为主分支推 `main --force` 与 `dev-v2-modern`；打标并推 `v2.0.0` 触发跨平台 GitHub Release。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；**但画布叠加层例外**（高对比+深色晕）；
- ❌ 弹窗页脚与条带禁止写死半透明黑，用 `--bg-footer`；平移规范唯一全画布一致：**右键拖拽 / 中键拖拽 / 空格+左键**三者等价；
- ❌ 严禁在生产路径用替代数据掩盖失败或缺失（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出 / **未载图时回落内置范例**）；
- ❌ ROI（取数框）与深度/年代标定**严禁互相推导或互相兜底**，未标定如实显示 `--`；线去除严禁整行/整列删除，必须带垂直厚度上限；
- ❌ 年代图识别严禁用整图二值化/每行取暗；年龄集合严禁在深度空间做 AR(1)，必须在速率空间构造且拟合原生采样；
- ❌ **同一个物理量严禁存在两条互不相通的读取链**：X 轴标度唯一解析入口为 `x_ticks`，导出与 QA 诊断严格共享，禁止各自拼兜底。

## 索引
- 历史归档：`HANDOFF-archive/`（含 `2026-09-29-e2e-playwright.md`、`2026-09-26-qa-restructure.md` 等）｜ 规范：`AGENTS.md`
- 架构设计：`docs/ARCHITECTURE.md` ｜ 测试策略：`docs/testing-strategy.md` ｜ 协议规范：`docs/JSON_RPC_SPECIFICATION.md`
