# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-25 21:35 | 分支 dev-v2-modern | HEAD a8f450c
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤50 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `pixi run test-e2e` ｜ `npm --prefix frontend run build` ｜ `npm --prefix frontend test` ｜ `pixi run python support/probe_truth/check_ticket_ownership.py`
- 当前结果：**8步工作流全闭环 + 5大审查病灶清零 + Y1/Y2靶心反馈 + 顶栏i18n全绿**；后端全量 266 项**全绿（0 failed / 0 xfailed，隔离区已清空）** + 前端 4 组自检，四条门禁 PASS —— 逐条数字见 [QA-RESTRUCTURE] 节（原"44项单测"为白名单口径的旧数，已更正）。

## [QA-RESTRUCTURE] 2026-09-26 — 门禁改全量、测试三层分目录、配置并入 pyproject
- 门禁真跑：`pixi run test` 原是手写 16 文件白名单（只覆盖 196/248，且自身 7 红），已改为全量（现 266 项）；CI 补 `npm test`（前端测试此前从不执行）。
- 隔离区 `tests/quarantine.txt` **已清空（0 条）**：13 项逐个溯源后全部修复 —— [A] tar 返回 base64 测试补解码 ｜ [B] `load_image` 自动建默认 ROI 致同名冲突/坐标漂移，测试改断言不变量 ｜ [C] `73e73b7` 改 LiPD/XLSX API 与结构，`session.py` 调用方与测试断言同步 ｜ [D] 关停闩锁为进程级全局致跨测试污染，改 per-server ｜ [E] 新发现 `detect_columns` 不同步 ROI 记录，`roi_update` 用旧 xlim 覆盖（产品补同步）。
- 结构：`tests/{unit 21, integration 6, e2e, data/{figures,truth,corpus}}`；6 个非测试脚本移 `scripts/`；12 文件去 sys.path 样板改由 `tests/conftest.py` 注入；`ruff.toml` 并入 `pyproject.toml`；根目录 3 张验证截图已 git rm。
- 验证（headless + 真实浏览器两套）：`pixi run lint` PASS ｜ `pixi run test` **266 passed / 0 failed / 0 xfailed** ｜ `npm --prefix frontend test` PASS ｜ `npm --prefix frontend run build` PASS ｜ `pytest tests/e2e` **10 passed**（真实 Edge，含新增 console 零 error 断言）。
- 已修（原"范围外待决策"两项）：① `frontend/test-core.js` 5 个复刻类（History/Viewport/Display/Glossary/Caption）+ UStar 本地实现全部改为 `await import` 真 `.ts` 模块，diatom 改用真实导出而非 readFileSync 抠文本，仅剩 2 处就地标注的非模块断言；② `session.py` 范例改读 `straditize_core/assets/age_models/`，已入 package-data 与 PyInstaller datas。
- 连带挖出并修复：`pyproject` 的 `exclude = ["straditize*"]` 因 fnmatch 也匹配 `straditize_core`，**wheel 里 0 个 .py、只剩 dist-info**（pip install 形同虚设）；同时漏配的 `ocr/data/diatom_genera.json` 也补进 package-data。现 wheel 55 个 .py + age_models 3 + ocr/models 3 + ocr/data 1，已实测。
- 已入库 7 个 commit。**MCP+真实浏览器逐条取证修复（每条都在界面上实测过）**：① `GeologyCanvas.onerror` 把加载失败标成已加载 → 对 broken 图 `drawImage` 抛 `InvalidStateError` 中断整条 render（控制台 2 errors→0，含 favicon 404）；② `commitRoi` 只发 RPC 不回写 `data.rois[]`、且面板重绘跑在 `await` 之前 → 分列拿旧 ROI 盖回后端（实测拖到 `[161,798]` 后 9 列 startX 全落 161~728 内）；③ `drawYAxisCalibration` 守卫 `>=4` 而选点守卫是 `===3` → 步骤 3 点完两点画布无反应（改 `>=3`，截图确认 Y1/Y2 即时出现）；④ `drawPollenCurves/Anchors` 守卫 `>=5` 是旧 7 步编号「S5=拐点」，8 步后 5=分列 → 一分列就描好轮廓（改 `>=7`，注释一并换现行编号）。**待查**：脚本切到步骤 5 后约 1s 自动跳回 3（`evaluate` 报 S5、随即截图是 S3）；`test_settings` e2e 仅在并发操作浏览器时偶发。**技术债**：111/255 公开 API 零覆盖、21 个 RPC 端点零引用、`project_new` docstring 超范围、18 处非 `import type` 类型导入。

## [TOPBAR-SETTINGS] 2026-09-26 00:30 — 导出拦截与左栏文字间距两大体验瑕疵优化完成
- 导出拦截温和化：未提取数据时点击顶栏 [💾 导出]，彻底消除后端原生 -32001 弹窗，平滑打开导出面板并在就绪清单清晰标出待完善项。
- 属种栏空状态排版：重构 `sidebar-empty-hint` 为弹性纵向布局，设置独立文本容器与 `gap: 10px`，彻底杜绝图标与引导文字挨近重叠。
- 门禁全绿：Ruff lint PASS，前端打包与自检通过，60 项核心单测 PASS，MS Edge E2E 自动化测试 100% 通过。

## [AUDIT-FIX-UX] 2026-09-25 21:35 — 5大病灶清零、Y1/Y2选点靶心反馈与浮动工具条收敛
- 病灶清零：网格外推至完整 `[roi.yMin, roi.yMax]`（`SplineInterpolator.ts:183`）；`conftest.py` 隔离临时配置；Step 4 排除区/画笔接线与分列防抖 Loading 完成；`PropertyPanel.ts` 直连后端 `export.tar/csv/r`。
- Y1/Y2 强视觉反馈：`GeologyCanvas.ts:1968` 绘制 Y1(橙)/Y2(绿) 双环靶心 + 深色胶囊铭牌 + 鼠标实时准星预览；`YCalibPanel.ts` 支持单点/双点实时回填与画布双向联动。
- 浮动工具栏收敛：移除左下角冗余 `标定(Y)` 与 `ROI(R)`，按当前步骤 `display:none` 动态显隐（`GeologyCanvas.ts:2530`）。
- 停滞断点：W1–W5 主干（T01–T11, T14）已全部竣工；仅剩延后增强项 T12（`straditize_core/layers.py` 双层放大曲线分层）与年代弹窗手工控制点（`AgeDepthModal.ts`）。
- 下一步原子动作：若开启 T12，新建 `straditize_core/layers.py` 与 `frontend/src/components/steps/LayersPanel.ts` 实现色相分组双峰阈值分层；否则直接进入发版打包验收（`pixi run build-windows`）。

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

## 索引
- 历史归档：`HANDOFF-archive/`（含 `2026-09-20-*`、`2026-09-24-t08/t09/t10`、`2026-09-25-t11-naming.md`、`2026-09-25-error-pdf-start.md`）｜ 规范：`AGENTS.md`
- 设计规范：`docs/ARCHITECTURE.md`（§6.1 ROI/标定数据模型、§7.1 线去除）｜ 协议：`docs/JSON_RPC_SPECIFICATION.md`（§4.6–4.8）
- **8 步重构三件套**：设计稿 / **冻结契约 v1.3（唯一字段事实源）** / 任务单 v2.1 —— 均在 `docs/plans/2026-09-20-*`
