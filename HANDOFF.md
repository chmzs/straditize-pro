# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-29 08:30 | 分支 dev-v2-modern | HEAD f6c5ee5
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**8步工作流全闭环 + 5大审查病灶清零 + Y1/Y2靶心反馈 + 顶栏i18n全绿**；后端全量 266 项**全绿（0 failed / 0 xfailed，隔离区已清空）** + 前端 4 组自检，四条门禁 PASS —— 逐条数字见 [QA-RESTRUCTURE] 节（原"44项单测"为白名单口径的旧数，已更正）。

## [E2E-PLAYWRIGHT] 2026-09-29 08:25 — 错误双向量证 + 画布墨迹门禁 + 金丝雀纪律（策略文档第 2 轮）
- **结构性变更与规模**：`tests/e2e/`（12 个 .py、1451 行）已删除 → `frontend/e2e/` **11 spec / 28 用例 / 191 条 `expect` / 67 次真实后端读取**；`pixi run test-e2e` = `build && playwright test`（**必须先构建**：后端从 `frontend/dist` 托管 SPA，跳过就对着旧产物跑、改了源码照样全绿）；`pixi run test` 去掉 `--ignore=tests/e2e` → **276 passed / 96 subtests**；`pixi run test-contract` 只跑 5 条契约用例（**26s vs 全量 ~110s**）。
- **全局错误门禁，正反两向都要证**：`fixtures.ts` 是 auto fixture（所有 spec 一律从它取 `test`/`expect`），teardown 断言 `console.error`、未捕获异常、**前端自己发起的失败 RPC**、原生弹窗为空；本后端 JSON-RPC 错误是 `HTTP 200 + body.error`，只看 status 会漏掉全部应用级错误。新增 `error-surfacing.spec.ts` 补**正向**：用 `page.route` 只让 `export.csv` 失败，断言用户**真的看见弹框** —— 只有反向那一半时，一个把错误全吞进 `console.warn` 的实现能让门禁全绿。
- **豁免 API 换代（修掉一个潜伏缺陷）**：原来三个数组型 option 是错的 —— Playwright 把数组形式的 fixture 值当成 `[value, options]` 元组，`test.use({ rpcErrorAllowlist: [/x/] })` 交付的是**那个正则本身** → `matches()` 直接 `allow.some is not a function`；因白名单从未被任何用例触发过，一直没暴露。现统一为 `test.use({ allowlists: { rpcError: [...], dialog: [...] } })`（单个对象选项 + `Partial` 键），豁免必须写在用例文件里可见。
- **画布墨迹门禁（层注册 ≠ 真的画了）**：`helpers.ts` 新增 `canvasInk`/`canvasColorPixels`，直接读 `#geology-canvas` 的 `getImageData`（零新依赖、零基线文件）；`step-visibility.spec.ts` 只做**同轮内步骤间不等式**，阈值按实测信噪比（层间差 ~19 万 px vs 轮间噪声 ~1700 px）留足余量。
- **金丝雀纪律（`docs/testing-strategy.md` §8；两个新门禁都实测弄红过）**：① 让 `drawRoiOverlay` 无条件提前 `return` → 墨迹差 193600→13395 变红，而三条 `renderedLayers` 结构断言**全绿**（正是旧断言的盲区）；② 把 `PropertyPanel.ts:639` 的 `alert` 换成 `console.warn` → 正向用例红（`Received string: ""`）。反方向同证：**负向对照必须为 0** ——「ROI 蓝」探针因此被否掉（叠加层 `RoiOverlay` 与管线 `roi` 层共用 `#0284c7`，像素不可区分，只能当阶段级信号）。
- **层门禁真值表与用例隔离（实测非推导）**：`renderedLayers` 混装"管线层"与 4 个**每帧无条件绘制**的 overlay id（`roi-indicator`/`cleanup-lines-and-exclusions`/`xticks-ruler-overlay`/`sample-horizons-overlay`），按 stage 断言前必须先过滤；overlay `draw()` 抛异常被 `render()` **静默吞掉**（id 不入列），故加"4 个 overlay 必须全在场"的报警。每条用例前 `e2e.reset` 复位到 hoya 基线，且启动器**断言复位后确实干净**（有残留即 `RuntimeError`）；`locale:'zh-CN'` 必须钉死（`devices['Desktop Edge']` 会强制 en-US → 中文断言在非中文系统假红）。
- **并发隔离 + 只报不改 + 下一步**：多会话并发必须 `STRADITIZE_E2E_PORT=22600` 且 `reuseExistingServer:false`；**坑**：端口不可按 `process.pid` 随机化（Playwright 在**每个 worker 重新求值配置**，实测后端起 20988 而 worker 连 22652 → 25 条全 `ECONNREFUSED`）。只报不改：① `frontend/src/main.ts:1922` 捕 `core.exportData` 失败后**只 `console.warn` + 打开一个空导出面板** —— 违反不变量 1，且 `console.warn` 不在门禁覆盖内 → 现状**没有任何一层会红**（正确写法是同文件 `main.ts:63` 的 `reportBackendFailure`）；② `PropertyPanel.ts:617` 空载荷静默回退 `textarea.value`（与历史 `x_bounds`/`data_xlim` 事故同型）；连同 `ExportReadinessPanel.ts:41` 硬编码、`QaPanel.triggerSummarize` 只 warn，全部登记在 `docs/testing-strategy.md` §9。**下一步原子动作**：P2 收尾 —— 归并 `docs/JSON_RPC_SPECIFICATION.md`、把 4 处裸 `fetch`（`AgeDepthModal.ts:1295`、`MetadataModal.ts:290`、`QaPanel.ts:315`/`247`、`Toolbar.ts:392`）收进 `RpcClient`、Step 4 恢复「灵敏度/阈值」控件。

## [STEP4-CLEANUP] 2026-09-29 05:15 — Step4 五件套 + 遗留四项清零（真实浏览器逐条实测）
- P1–P3 键位与手柄：Step4 仅 `Delete`/`Backspace` 删几何、`D` 不再删；`↑↓←→` 1px、`Shift` 10px；拖本体位移落库；选中画白方块（端点/长度）+ 青圆点（中边/厚度），拖青点对边锚定不动。`CleanupOverlay.bandOf()` 修竖线 1px 塌陷（`const w`→`let w`）。nudge 有 500ms 防抖，<400ms 读后端会读到旧值。
- P4–P5 新能力：`algorithm.setLineThickness`（`straditize_core/session_parts/cleanup.py`）按选中/全 ROI 统一厚度且中心行不动，非法值标红不发 RPC；工具栏新增「测量 (M)」。契约已同步 `docs/ARCHITECTURE.md`（键位表 + §7.1 + Step4 RPC 表）。
- **三处工具模式展示缺陷（前两条是"工具栏缺了微调(S)""几何没视觉显示""自动检测是假的"的总根因）**：① `frontend/src/main.ts` 进 Step4 硬写 `setToolMode('linefix')` —— 用户一进第 4 步手上是橡皮笔刷，点候选线是涂改不是选中，白/青手柄永远够不着，改 `'select'`；② `setWorkflowStage` 直调 `toolModeManager.setMode()` 绕过 `setToolMode()`，高亮与页脚双双卡旧值；③ 同函数在"当前工具恰好等于该步默认工具"时整段跳过，冷启动页脚停在第 1 步写死的「选择 (V)」而高亮在 `pan` —— 抽出 `syncToolModeUi()`，模式仍按门控切、展示每次强制同步。①②已入黑名单节。
- 四遗留已修：① `straditize_core/rpc_methods/system.py` 抽出 `cleanup_payload()`，零状态分支与载图分支共用同一形状（探针实测键集完全一致、18 键无缺，此前零状态只回 `lineRemoval`）；② 候选 id 改会话级单调计数器 `line_{axis}_{n}`/`manual_{axis}_{n}`，不再把 `at`/`width` 烤进身份（旧 `line_h_819_2px` 改厚度后即说谎），且跨 ROI、跨删除唯一（旧 `manual_{axis}_{len+1}` 删除后撞号）；③ 点画布空白补 `setSelectedGeometryId(null)`（实测 `data-selected-cand-id` 转空、apply-selected 自动禁用）；④ 微调防抖改 `pendingGeometryNudge` 载荷 + `flushPendingGeometryEdits()`。
- **④ 实测复现了"几何复活"**：微调后 60ms 内删几何，旧实现删除先落地（22→21）、500ms 后延迟 upsert 到达使其**原地复活**（21→22，`at` 还是微调后的 819）。根因：只堵了画布入口而侧栏删除走 RPC 直连，且同步 flush 无法保证顺序。改为 `onGeometryCommit` 可 await + `runCleanupAction`（Step4 全部几何写操作唯一入口）先 `await flushPendingGeometryEdits()` 再执行 —— 同一脚本 `resurrected` 由 `true` 转 `false`，正常微调仍落库（1128→1129）。
- 验证：`pixi run test` **276 passed / 96 subtests**｜`pixi run lint` PASS（含 6 项一致性核对）｜`npm --prefix frontend run build` PASS｜`npm --prefix frontend test` PASS。**下一步原子动作**：Step4 恢复「灵敏度/阈值」控件；候选 id 换代须 `pixi run app` **重启后端**才生效（旧会话仍是 `line_h_819_2px` 式 id）。

## [QA-RESTRUCTURE] 2026-09-26 — 门禁改全量、测试三层分目录、配置并入 pyproject
- 门禁真跑：`pixi run test` 原是手写 16 文件白名单（只覆盖 196/248，且自身 7 红），已改为全量（现 266 项）；CI 补 `npm test`（前端测试此前从不执行）。
- 隔离区 `tests/quarantine.txt` **已清空（0 条）**：13 项逐个溯源后全部修复 —— [A] tar 返回 base64 测试补解码 ｜ [B] `load_image` 自动建默认 ROI 致同名冲突/坐标漂移，测试改断言不变量 ｜ [C] `73e73b7` 改 LiPD/XLSX API 与结构，`session.py` 调用方与测试断言同步 ｜ [D] 关停闩锁为进程级全局致跨测试污染，改 per-server ｜ [E] 新发现 `detect_columns` 不同步 ROI 记录，`roi_update` 用旧 xlim 覆盖（产品补同步）。
- 结构：`tests/{unit 21, integration 6, e2e, data/{figures,truth,corpus}}`；6 个非测试脚本移 `scripts/`；12 文件去 sys.path 样板改由 `tests/conftest.py` 注入；`ruff.toml` 并入 `pyproject.toml`；根目录 3 张验证截图已 git rm。
- 验证（headless + 真实浏览器两套）：`pixi run lint` PASS（8 项一致性核对）｜ `pixi run test` **276 passed / 96 subtests** ｜ `npm --prefix frontend test` PASS（5 组）｜ `npm --prefix frontend run build` PASS ｜ `pixi run test-e2e` **25 passed**（真实 Edge Playwright 套件）。
- 已修（打包与假测试）：`test-core.js` 5 个复刻类全改 `await import` 真模块；`session.py` 范例改读 `straditize_core/assets/age_models/`（已入 package-data 与 PyInstaller datas）；`pyproject` 的 `exclude=["straditize*"]` 因 fnmatch 也匹配 `straditize_core` 致 **wheel 里 0 个 .py**、外加漏配 `ocr/data` 词表——均已修并实测（wheel 55 个 .py + 全部资产）。
- **真实浏览器逐条取证修复 6 个核心交互/渲染缺陷**：① `onerror` 把加载失败标成已加载 → broken 图 `drawImage` 中断整条 render；② `commitRoi` 不回写 `data.rois[]`；③ `drawYAxisCalibration >=4` 导致 Y 标定无即时反馈；④ `drawPollenCurves >=5` 导致分列早出曲线；⑤ **ROI 与选点全局缺少图谱尺寸钳位**：拖拽/选点/插列可延伸至负数或 2898px 虚空（已在前后端全链路加上物理钳位，29 属种 100% 精确落回图谱内）；⑥ **Step 1 未载图时画布背景误显示「正在载入」大字**：`drawBackgroundDiagram` 增加 `!imageSrc` 拦截，消除空路径 `loadImage` 警告。
- 本轮新增三道防线与交互层级治理：① 步骤→能力映射收敛到 `core/WorkflowStage.ts`（8 步单一源），配 `test-workflow-stage.mjs` 6 组断言，修 `drawDepthGrid` 守卫；② `window.__straditize` 调试句柄挂载；③ `consistency_check.py` 8 项一致性核对并入 lint；④ **UI 交互层级重构**：修复 `.primary-btn` 样式脱落（灰方块→实体蓝胶囊）、次要操作按钮实体化、纯展示信息框去操作化、属种形态微按钮加 `▾` 下拉线索。**技术债**：111/255 API 零覆盖、21 个 RPC 端点零引用、`project_new` docstring 超范围、18 处非 `import type`。

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
- ❌ 严禁用 junction/symlink 把 worktree 的 `frontend/node_modules` 指回主仓库来复用依赖：`git worktree remove --force` 会顺着 reparse point 递归删进去，**直接清空主仓库的包目录**（2026-09-27 实测踩中，靠 `npm ci` 从 lockfile 还原）。worktree 需要依赖就单独 `npm ci`；临时复用完必须先摘链接再 `git worktree remove`。
- ❌ 步骤切换/工作流推进处**严禁硬写画布工具模式**（如进 Step4 直接 `setToolMode('linefix')`），必须走 `getAllowedTools(stage)[0]` 这一单一事实源，且只能经 `setToolMode()` 落地；直调 `toolModeManager.setMode()` 会跳过 active-mode 高亮与页脚「模式:」同步。硬写曾致用户一进第 4 步手上是橡皮笔刷、点线成涂改、白/青手柄永远够不着，被误判成"工具栏缺了微调(S)""几何没有视觉显示""自动检测是假的"（2026-09-28 实测定位）。

## 索引
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-*`、`2026-09-24-t08/t09/t10`、`2026-09-25-t11-naming.md`、`2026-09-25-error-pdf-start.md`、`2026-09-25-audit-fix-ux.md`、`2026-09-26-topbar-settings.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.3（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
