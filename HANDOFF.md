# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-24 21:05 | 分支 dev-v2-modern | HEAD c6d3d47
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**W4 (T05) 清理面板与排除区全链路已完成**；`pixi run test-e2e` **PASS** ｜ `tests/test_line_removal_v2.py` 5/5 PASS（Pinus误删0.00%）｜ 排除区绝对优先通过 ｜ lint/build ✓。

## [AGEDEPTH] 2026-09-20 12:20 — 彩色中位线 + 通道覆盖 + 编造路径清查（已提交 160b060/93084b1/8a93b92）
- 识别加**色度通道**：投影到图形自身主色方向（**不是** HSV chroma——虚线+灰云混合使 chroma 逐行在 0~114 间跳，而 `R−mean(G,B)` 阈值 12 即恢复 843 行中的 777 行）；自动按「**贯穿行数**」选通道（红线达暗度的 70%、Bchron 蓝色测年条仅 23%，切 55%），另可强制 `curve_channel`。独立参考（逐行 `R−max(G,B)` argmax）误差 **median 0.00% / p95 1.69%**（n=733）。入口 `age_depth.py:extract_age_depth_model`；界面加**通道下拉 + 原因显示**，三曲线分色（中位蓝/上界紫/下界橙）+ 深色光晕，年龄标定手柄改黄避免撞色。**画布叠加层刻意用固定色**（主题色会消失在一张浅色图上，与黑名单第 1 条的区别已入代码注释）。
- **清查并清除 7 条编造路径**（静默换图源×2 / 占位数字×3 / 编造曲率×1 / 静默赋值覆盖×1），细节 `HANDOFF-archive/2026-09-20-agedepth-fabrication-audit.md`，守卫 `tests/test_no_fabrication.py`。关键：`observed_row_fraction` 守卫**必须在 gap 插值之前量**（插值后按构造恒 100%）；`observed_depth_range` 报**原生** traced span。
- **更正一条已废弃的数字**：色度修复前我报过该图「+34% 误差」，那是**我目测读图读错**，不是提取错误。改用独立参考（逐行 `R−max(G,B)` argmax，无追踪）比对后真实误差为 median **0.00%**。见到旧的 +34% 数字请忽略。
- **已修（891c347）**：搜索区曾按「标定框外扩 `retain_frac`」夹紧 → **标定刻度选得不同就静默截断曲线**（实测同一张图：`3000/0` 得深度 0–160、`2000/1000` 只得 64.6–148.8 丢掉上 65cm、`1500/500` 得 25.7–140.3）。现搜索区**直接取轴规则跨度，与标定无关**；`retain_frac` 只作取不到规则时的兜底，`model.roi_source` 如实记录用了哪种依据。
- **已修（1c356c1）**：弹窗原手搓 `canvasToImage` 逆变换（`findMarkerAt` 里还抄了第二遍 scale），**无缩放/平移/DPR**；现复用 `core/Viewport`，叠加层改在世界坐标画（**代码净减少**），滚轮/±/`⛶适应`/`1:1` 与主画布同约定，平移**中键/空格+左键**（当时所依据的那条「禁辅助画布右键」黑名单规则**已废弃**：右键现可平移，见下方黑名单平移条），手柄/线宽/光晕/交点均除以 scale 保持屏幕尺寸。实机验证：适应 79% 点真实刻度世界坐标读出 **693 px**（真值 693.5，精确往返）；109% 下 400 CSS px 位移读出 **367 px** = 400/1.09（缩放正确）；中键平移生效；`ResizeObserver` 重排自适应。window 级按键监听经 `disposers` 在 `close()` 释放。
- **停滞断点**：(a) **下一步就是它**：中位线/包络的手工控制点尚未做——需 ① 复用 `Viewport` 命中测试（已完成）② 复用 `HistoryManager` 得撤销 ③ 后端拆轻量 `agedepth.applyManualCurve`（否则拖点要等提取+1000 集合 1–6s）④ 只标中位线时包络按 auto 偏移跟随（`min = user_median − (auto_median − auto_min)`），0 点击时行为不变；(b) 中位线与包络**都是灰**且描边更暗时无硬保证（靠垂直支撑度+连续性，`bacon_szek.png` 属此类），修法是笔画宽度/拓扑先验，**颜色救不了**；(c) WebR 引擎未实现，`AgeDepthModal.ts` 如实拒绝——但**那个 40MB 自定义包不需要存在**：WebR 官方仓库已有 rbacon 3.5.2 + 完整依赖链 WASM（~10MB），在线直接 `installPackages`，仅离线才需自建 bundle；(d) `_median_rate` 无插值器时返回全 1 哑值（已被上游拒绝，不可达）。
- 下一步原子动作：**做中位线/包络手工标点（辅助修正，非纯手工）**——自动结果当底稿，用户加点/拖点；只标中位线时包络按 auto 偏移跟随，0 点击时行为不变。需复用已完成的世界坐标命中测试 + `HistoryManager` 撤销，后端拆轻量 `agedepth.applyManualCurve`（否则拖点要等提取+1000 集合 1–6s）。**缩略图（Minimap）用户明确不需要，勿加。**

## [ROI-CALIB] 2026-09-20 13:35 — ROI 与 Y 轴标定解耦 + 去线重做（含人工修正笔刷）
- **缺陷**：ROI 与深度共用一个 `DepthCalibration`，前端 `imageYToDepth` 写 `top_px ?? dataYMin`、后端 `project_save` 由 `data_ylim` 反算 `top/bottom_cm` —— 拖一下取数框就静默改写时间轴；S2 面板还直接摆着「顶界/底界深度」输入框。
- **拆法**（无迁移负担，未投用）：前端 `DiagramData.roi` 与 `.calibration`（`top_px/top_cm/bottom_px/bottom_cm`，未标定四端点为 `null`）；`CoordinateSystem.calibrationBounds()` 是**唯一判定入口**，未标定一律 `--`。后端 `session.depth_calib` 与 `data_*lim` 互不派生。`frontend/test-roi-calibration.mjs` 直接 import 真 `.ts` 守住这条不变量。
- **Y 标定交互**：新 `ToolMode` `ycalib`（`Y` 键）/ S4 面板「🎯 开始两点标定」→ 画布上点两个**像素行** → 弹窗填真实值 → `core.calibrateAxes(y_marks, unit)`（`unit` 为自由文本）；S4 另有「⌨ 手动输入像素/数值」兜底。两点 `val` 可递增向上（年代）或向下（深度）。
- **去线重做 + 单一事实源**：`image.py` 判据改为「**够长 + 够薄**」（`GRID_LINE_PRESETS` 弱/中/强 → `max_thickness` 2/3/5，开运算核按 ROI 跨度取比例），**横竖同时判**。实测内置 Hoya（ROI 315,511–1946,1311）：误删 **55.4% → 0.64%**，*Pinus* 列 **99% → <1%**；该图 ROI 内横向贯穿行数本来就是 **0**，旧标记全是误标。同时删掉前端 `GeologyCanvas.generateBinaryCache` 自算的一套（只影响显示、不参与提取，正是误标元凶），改为后端 `algorithm.degrid` 返回 `overlay_png`（白=保留墨迹、红=实际剔除像素），B 键透视与数字化用同一批像素。
- **人工修正**：`LineMaskStroke{mode,radius,points}` **折线笔迹**（非位图，改档位/改 ROI 后仍可重放）→ 后端 `rasterize_strokes` 合成，随 `straditize.json` 的 `line_removal.corrections` 持久化。新 `ToolMode` `linefix`（`K` 键，进入时强制打开 B 叠加层）+ S2 面板「🧽 擦掉误标 / 🖌 补回漏标 / 清空修正」。
- **契约同步**（文档已改 `docs/ARCHITECTURE.md` §5/§6.1/§7.1/§9、`docs/JSON_RPC_SPECIFICATION.md` §4.1/4.4/4.6/4.7/4.8、`docs/tutorials/01_quickstart.md` 步骤3/5）：`core.loadImage` 返回 `suggested_roi`（删 `suggested_calibration`）；`roi.update` 只动 ROI 并作废线掩膜；`algorithm.degrid` 参数/返回全变（`strength:"off"` 会**主动清空**会话掩膜）；`straditize.getDiagramData` 分 `roi`/`calibration`/`lineRemoval` 三键；`digitize` 对**整列落在 ROI 外**报 `-32602` 而非产静默 0。
- **停滞断点/下一步**：① 竖线在「强」档会连真实细竖数据一起剔（Hoya strong = 3.20%），现靠 `K` 笔刷兜底；② **虚线网格**因形态学开运算检不出，只能手工补——要全自动需先做笔画宽度/拓扑先验；③ 只对 `grid_line_mask` 做了 ROI 约束，`detect_columns` 仍只做横向去线（未接竖线）。
- **验证**：`pixi run lint` ✓ ｜ `pixi run test` **179 passed + 84 subtests** ｜ `npm --prefix frontend run build` ✓ ｜ `npm --prefix frontend test` ✓ ｜ 浏览器实测（临时 8899，已关）：Pinus 白色保留、仅剩 2 条真竖线红标、ROI 511/1311 与标定 524/1327 **并存互不影响**、涂抹 342→77→清空恢复 342。

## [8STEP-W4-T05] 2026-09-24 21:05 — 清理面板与排除区全链路完成 (T05)
- 算法与分类：`lines.py`准确检测A/B/C三类线；`line_width_max=2`抗粗线误删；Hoya图A类0行、Pinus误删0.00%。
- 排除区绝对优先：`cleanup.py`落实优先级规则（排除区覆盖处墨迹恒为0，restore笔迹完全无效）；局部置脏仅标记所属ROI。
- 扩展点落地：`CleanupPanel.ts`挂载Step 4；`CleanupOverlay.ts`双色高亮与灰虚线遮罩绘制；RPC接口注册。
- 测试验收：`tests/test_line_removal_v2.py` 5/5全过；`tests/e2e/test_cleanup.py`真实Edge渲染L4通过；全量门禁与所有回归绿灯。
- 下一步：开启T07（X轴刻度几何提取与标定），打通Step 6列标度提取。

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
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-topbar-slimming.md`、`2026-09-20-agedepth-fabrication-audit.md`、`2026-09-20-taxadict-ocr-vocabulary.md`、`2026-09-20-ui-button-visibility.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.1（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
