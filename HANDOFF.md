# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-24 22:30 | 分支 dev-v2-modern | HEAD c2ab0b1
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**W4 (T09) 校验门禁与质量诊断已完成**；主工作流 8 步闭环全线打通；`tests/test_qa_summary.py` 6/6 PASS ｜ `tests/e2e/test_qa.py` Edge L4 PASS ｜ 全量门禁全绿。

## [ROI-CALIB] 2026-09-20 13:35 — ROI 与 Y 轴标定解耦 + 去线重做（含人工修正笔刷）
- **缺陷**：ROI 与深度共用一个 `DepthCalibration`，前端 `imageYToDepth` 写 `top_px ?? dataYMin`、后端 `project_save` 由 `data_ylim` 反算 `top/bottom_cm` —— 拖一下取数框就静默改写时间轴；S2 面板还直接摆着「顶界/底界深度」输入框。
- **拆法**（无迁移负担，未投用）：前端 `DiagramData.roi` 与 `.calibration`（`top_px/top_cm/bottom_px/bottom_cm`，未标定四端点为 `null`）；`CoordinateSystem.calibrationBounds()` 是**唯一判定入口**，未标定一律 `--`。后端 `session.depth_calib` 与 `data_*lim` 互不派生。`frontend/test-roi-calibration.mjs` 直接 import 真 `.ts` 守住这条不变量。
- **Y 标定交互**：新 `ToolMode` `ycalib`（`Y` 键）/ S4 面板「🎯 开始两点标定」→ 画布上点两个**像素行** → 弹窗填真实值 → `core.calibrateAxes(y_marks, unit)`（`unit` 为自由文本）；S4 另有「⌨ 手动输入像素/数值」兜底。两点 `val` 可递增向上（年代）或向下（深度）。
- **去线重做 + 单一事实源**：`image.py` 判据改为「**够长 + 够薄**」（`GRID_LINE_PRESETS` 弱/中/强 → `max_thickness` 2/3/5，开运算核按 ROI 跨度取比例），**横竖同时判**。实测内置 Hoya（ROI 315,511–1946,1311）：误删 **55.4% → 0.64%**，*Pinus* 列 **99% → <1%**；该图 ROI 内横向贯穿行数本来就是 **0**，旧标记全是误标。同时删掉前端 `GeologyCanvas.generateBinaryCache` 自算的一套（只影响显示、不参与提取，正是误标元凶），改为后端 `algorithm.degrid` 返回 `overlay_png`（白=保留墨迹、红=实际剔除像素），B 键透视与数字化用同一批像素。
- **人工修正**：`LineMaskStroke{mode,radius,points}` **折线笔迹**（非位图，改档位/改 ROI 后仍可重放）→ 后端 `rasterize_strokes` 合成，随 `straditize.json` 的 `line_removal.corrections` 持久化。新 `ToolMode` `linefix`（`K` 键，进入时强制打开 B 叠加层）+ S2 面板「🧽 擦掉误标 / 🖌 补回漏标 / 清空修正」。
- **契约同步**（文档已改 `docs/ARCHITECTURE.md` §5/§6.1/§7.1/§9、`docs/JSON_RPC_SPECIFICATION.md` §4.1/4.4/4.6/4.7/4.8、`docs/tutorials/01_quickstart.md` 步骤3/5）：`core.loadImage` 返回 `suggested_roi`（删 `suggested_calibration`）；`roi.update` 只动 ROI 并作废线掩膜；`algorithm.degrid` 参数/返回全变（`strength:"off"` 会**主动清空**会话掩膜）；`straditize.getDiagramData` 分 `roi`/`calibration`/`lineRemoval` 三键；`digitize` 对**整列落在 ROI 外**报 `-32602` 而非产静默 0。
- **停滞断点/下一步**：① 竖线在「强」档会连真实细竖数据一起剔（Hoya strong = 3.20%），现靠 `K` 笔刷兜底；② **虚线网格**因形态学开运算检不出，只能手工补——要全自动需先做笔画宽度/拓扑先验；③ 只对 `grid_line_mask` 做了 ROI 约束，`detect_columns` 仍只做横向去线（未接竖线）。
- **验证**：`pixi run lint` ✓ ｜ `pixi run test` **179 passed + 84 subtests** ｜ `npm --prefix frontend run build` ✓ ｜ `npm --prefix frontend test` ✓ ｜ 浏览器实测（临时 8899，已关）：Pinus 白色保留、仅剩 2 条真竖线红标、ROI 511/1311 与标定 524/1327 **并存互不影响**、涂抹 342→77→清空恢复 342。

## [8STEP-W4-T08] 2026-09-24 21:35 — 采样层位与拐点提取完成 (T08)
- 实体与未标定守卫：`SampleHorizon`齐备`row_px/depth/source`；未标定时`depth`严格为`None`绝不填0；标定后自动精确换算。
- 共识提取与粘贴：`samples_extract_consensus`打通多属种拐点曲率极值聚类；`samples_paste_depths`支持Excel层位逆映射到像素行。
- 扩展点落地：`SamplesPanel.ts`挂载Step 7；`SampleOverlay.ts`完成三色水平虚线（自动绿/粘贴蓝/手工橙）与深度标签绘制。
- 门禁验收：`tests/test_sample_horizons.py` 4/4全过；`tests/e2e/test_samples.py`真实Edge L4通过；全量测试与拥有权全绿。
- 下一步：开启T09（校验门禁与异常诊断），打通Step 8地学校验。

## [8STEP-W4-T09] 2026-09-24 22:30 — 校验门禁与质量诊断完成 (T09)
- 诊断实体契约：`QaSummary`严格实现组分总和门禁（≤100%+tolerance）、空层位排查与单列满刻度一致性诊断。
- 单一事实源派生：`declared_max`严格由`x_ticks`派生，物理剔除遗留存储字段；非组分数据如实豁免总和门禁。
- 界面与诊断闭环：`QaPanel.ts`挂载Step 8，呈现三级状态横幅（🔴红/🟡黄/🟢绿）、四宫格指标卡及超标异常清单。
- 验收门禁通过：`test_qa_summary.py` 6/6全绿（含L3真数据）；`test_e2e/test_qa.py` Edge真实L4全通过。
- 阶段意义：主工作流全部 8 个步骤（载入/ROI/Y标定/清理/分列/标定列/拐点采样/校验）闭环全线贯通！

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
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-topbar-slimming.md`、`2026-09-20-agedepth-fabrication-audit.md`、`2026-09-20-taxadict-ocr-vocabulary.md`、`2026-09-20-ui-button-visibility.md`、`2026-09-20-agedepth-median-channels.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.1（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
