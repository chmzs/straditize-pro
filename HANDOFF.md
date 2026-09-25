# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-25 14:30 | 分支 dev-v2-modern | HEAD cb832e4
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**顶栏瘦身与全局设置弹窗（语言/外观/网关白名单/WebMCP）完成**；单元测试与 Edge E2E 测试全绿。

## [ERROR-PDF-START] 2026-09-25 11:20 — 错误体系整改、PDF多页指定与启动收敛
- 拒绝偷懒 -32602：严格区分 语法(-32602)、状态缺失(-32001)、命名冲突(-32002)、算法中断(-32003)、文件错误(-32004)。
- 修复引导透传：前端 `tError` 彻底保留后端修复引导并结构化显示；杜绝“参数不合法”单一弹窗。
- 图片与单页/多页PDF：`load_image` 支持 Base64 上传；选 PDF 时弹窗输入页码，指定提取哪一页图版并渲染。
- 启动收敛唯一化：统一为 `pixi run start`（固定 8765 端口/自动打开浏览器/同源 /mcp 与 SSE/顶栏退出按钮）。
- 门禁验证：`test_error_guidance_and_pdf.py` 4/4 PASS；全量测试与拥有权全绿。

## [GOLDEN-JOURNEY-T14] 2026-09-25 15:15 — 8步面板齐备、视觉纠偏与纯DOM Golden Journey 完成 (T14)
- 补齐面板干掉弹窗：新建 `RoiPanel.ts` (S2) 与 `YCalibPanel.ts` (S3) 常驻侧栏；物理删除 `openYCalibrationDialog` 等弹窗与 `Minimap.ts`。
- 消除步骤精神分裂：`main.ts` 严格对齐 1→8 步递进，清理 `Inspector.ts` 400行 `renderS0..S7` 死代码；铲除画布黄色半透明遮罩与越界横线。
- 零摆拍纯DOM旅程：`test_golden_journey.py` 完全由 MS Edge 真实 DOM 点击走通 1→8 步并导出解包 `.tar`，`test_corpus_robustness.py` 7/7 全过。
- 门禁全绿：`tests/e2e/` 全套 9 项 Edge E2E 测试 9/9 PASS；`pixi run lint` / `npm run build` / `npm test` / 拥有权全过。

## [TOPBAR-SETTINGS] 2026-09-25 14:35 — 顶栏瘦身、全局设置弹窗与退出一致性完成
- 顶栏与启动收敛：唯一主入口定为 `pixi run app`；顶栏右侧仅留 [OCR] [年代] [导出] [⚙ 设置] [退出]；`graceful_shutdown` 单一清理。
- 全局设置模态框：`SettingsModal.ts` 整合通用偏好（i18n即时重绘/暗黑深浅主题）、远程网关（开关/通配符白名单）、后端与WebMCP端点。
- 后端配置持久化：`config.py` 持久化 `~/.straditize/config.json`；`system.getConfig`/`system.updateConfig` 动态热更新内网/Tailscale 白名单。
- 自动化门禁测试：`tests/test_remote_settings.py` 4/4 PASS（403严格拦截/白名单动态穿透）；`tests/e2e/test_settings.py` Edge E2E 验证全绿。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；**但画布叠加层例外**——它叠在任意用户图上，主题色会消失，须用固定高对比色 + 深色光晕；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`；OCR 词典模糊匹配严禁「单候选 + ratio 阈值」直接采纳（会跨类改错名 `Sordariaceae`→`Apiaceae`），必须过前缀/长度门禁或标 `unrecognized`；
- ❌ 年代图识别严禁用「整图二值化 + 最大连通域」或「每行取最暗像素」：Bacon 云是连通实心块、Bchron 是几十条不连通细线，两种渲染都会翻车；必须逐行剖面 + 单调先验，且标定框 ≠ 数据区（轴规则常伸出到刻度之外）；
- ❌ 严禁在生产路径用替代数据掩盖失败或缺失（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出 / **未载图时回落内置范例** / **有状态的图片端点默认给样例**），也严禁把「未观测」写成「确定」（缺包络不得默认成零宽＝声称精确、退化模型不得返回 `age=depth` 占位、外推点须逐行标记、**gap 插值覆盖率守卫必须在插值前量**，之后恒 100%）；数据只能来自后端对用户输入的真实计算，否则报错并停在原地；
- ❌ 平移规范唯一且**全画布一致**：**右键拖拽 / 中键拖拽 / 空格+左键**三者等价，主画布与所有辅助画布（OCR 框选、旋转预览、年代弹窗）均须支持；严禁任何画布只支持其中一部分，也严禁再出现「黑名单禁辅助画布右键」这类已废弃说法（该说法曾导致年代弹窗长期与主画布行为不一致）；
- ❌ 年龄集合严禁「按采样点序号做 AR(1) + `maximum.accumulate` 事后排序」：前者使相关长度随重采样步长漂移（2→10cm 改 2.8×，特征层位差 4cm），后者掩盖倒转并引入与步长相关的单向偏差；必须在速率空间构造，且拟合须读图形**原生采样**而非重采样后的包络；
- ❌ ROI（取数框）与深度/年代标定**严禁互相推导或互相兜底**：`top_px ?? dataYMin`、由 `data_ylim` 反算 `top/bottom_cm`、拿 ROI 边界当刻度端点，全属此列；未标定必须在界面上如实显示 `--`，`CoordinateSystem.calibrationBounds()` 是唯一判定入口；
- ❌ 线去除严禁按「整行/整列占据率」整条删除——必须带**垂直于线方向的厚度上限**（实心花粉轮廓被线穿过处厚达数十像素，必须豁免）；且掩膜只允许后端产生（`overlay_png` 即 B 键所见 = 数字化所用），前端不得另算一套"看起来像去线"的显示逻辑；`strength:"off"` 必须主动清空会话掩膜；
- ❌ 契约字段只能来自 `docs/plans/2026-09-20-frozen-contracts.md`（**单子不得自行发明字段**）；ROI 上的表单值/继承值严禁被当作事实源；特性单严禁写"无人可写"的共享文件（`support/probe_truth/check_ticket_ownership.py` 机器校验，发单前必须跑通）；掩膜优先级**排除区绝对优先**，restore 落在排除区内必须拒绝或提示，**不得静默无效**。

## 索引
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-topbar-slimming.md`、`2026-09-20-agedepth-fabrication-audit.md`、`2026-09-20-taxadict-ocr-vocabulary.md`、`2026-09-20-ui-button-visibility.md`、`2026-09-20-agedepth-median-channels.md`、`2026-09-20-roi-calib-decoupling.md`、`2026-09-24-t08-samples.md`、`2026-09-24-t09-qa-summary.md`、`2026-09-24-t10-export.md`、`2026-09-25-t11-naming.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.1（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
