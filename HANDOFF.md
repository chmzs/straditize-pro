# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-25 10:45 | 分支 dev-v2-modern | HEAD 73e73b7
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**W4 (T11 + WebMCP) 属种命名、旧债务清理与 WebMCP 接入已完成**；8 步工作流全拼图闭环；`tests/test_label_snapping.py` 7/7 PASS ｜ 全套 7 个 Edge E2E 测试 PASS。

## [8STEP-W4-T09] 2026-09-24 22:30 — 校验门禁与质量诊断完成 (T09)
- 诊断实体契约：`QaSummary`严格实现组分总和门禁（≤100%+tolerance）、空层位排查与单列满刻度一致性诊断。
- 单一事实源派生：`declared_max`严格由`x_ticks`派生，物理剔除遗留存储字段；非组分数据如实豁免总和门禁。
- 界面与诊断闭环：`QaPanel.ts`挂载Step 8，呈现三级状态横幅（🔴红/🟡黄/🟢绿）、四宫格指标卡及超标异常清单。
- 验收门禁通过：`test_qa_summary.py` 6/6全绿（含L3真数据）；`test_e2e/test_qa.py` Edge真实L4全通过。
- 阶段意义：主工作流全部 8 个步骤（载入/ROI/Y标定/清理/分列/标定列/拐点采样/校验）闭环全线贯通！

## [8STEP-W4-T10] 2026-09-24 23:30 — 顶栏导出体系与就绪清单完成 (T10)
- 多 ROI 规范导出：XLSX 每 ROI 一张 sheet（支持中文），LiPD 每 ROI 一张 measurementTable，列名无前缀。
- 主 ROI 绑定：`.tar` 内 `data.csv` 严格绑定 `primary_roi_id`（改主 ROI 随之变），各 ROI 独立为 `data/<roi>.csv`。
- 导出就绪清单：`PropertyPanel.ts` 与 `ExportReadinessPanel.ts` 接入顶栏总出口，自动扫描未命名/无列 ROI。
- 门禁验收：`tests/test_multi_roi_export.py` 6/6 全过；`tests/e2e/test_export.py` Edge L4 真机全通过。
- 战略进展：主工作流 8 步闭环 + 顶栏数据交付总出口全线打通！

## [8STEP-W4-T11] 2026-09-25 10:45 — 属种命名、区间归属、旧债务清零与 WebMCP 完成 (T11)
- 区间归属对账：`ocr/engine.py` 实现 `[startX, endX)` 区间包含与乱序无关性，数量不等拒绝配对并报三类对账。
- 旧债务物理清零：`Sidebar.ts` 与 `main.ts` 彻底删除 `▲/▼` 与批量导入（`grep` 检出为 0）；同 ROI 重名报 `-32602`。
- Step 5 与逐列点名：`NamingPanel.ts` 挂载 Step 5；左栏输入框绑定 `col.id`，获焦时画布即时高亮对应列。
- CLI 升级 WebMCP：`mcp_server.py` 与 `cli.py` 提供 14 个 8 步工作流 MCP 工具，支持活体 Web 会话桥接与 `window.webMCP`。
- 门禁验收：`test_label_snapping.py` 7/7 全过；`test_e2e/test_naming.py` 等全套 7 项 Edge E2E 全绿。

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
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-topbar-slimming.md`、`2026-09-20-agedepth-fabrication-audit.md`、`2026-09-20-taxadict-ocr-vocabulary.md`、`2026-09-20-ui-button-visibility.md`、`2026-09-20-agedepth-median-channels.md`、`2026-09-20-roi-calib-decoupling.md`、`2026-09-24-t08-samples.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.1（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
