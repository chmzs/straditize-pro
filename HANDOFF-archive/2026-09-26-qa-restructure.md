# HANDOFF 归档：[QA-RESTRUCTURE] 2026-09-26

> 自 `HANDOFF.md` 全文达到 50 行上限时整段移入，只增不减，日常不加载。

## [QA-RESTRUCTURE] 2026-09-26 — 门禁改全量、测试三层分目录、配置并入 pyproject
- 门禁真跑：`pixi run test` 原是手写 16 文件白名单（只覆盖 196/248，且自身 7 红），已改为全量（现 266 项）；CI 补 `npm test`（前端测试此前从不执行）。
- 隔离区 `tests/quarantine.txt` **已清空（0 条）**：13 项逐个溯源后全部修复 —— [A] tar 返回 base64 测试补解码 ｜ [B] `load_image` 自动建默认 ROI 致同名冲突/坐标漂移，测试改断言不变量 ｜ [C] `73e73b7` 改 LiPD/XLSX API 与结构，`session.py` 调用方与测试断言同步 ｜ [D] 关停闩锁为进程级全局致跨测试污染，改 per-server ｜ [E] 新发现 `detect_columns` 不同步 ROI 记录，`roi_update` 用旧 xlim 覆盖（产品补同步）。
- 结构：`tests/{unit 21, integration 6, e2e, data/{figures,truth,corpus}}`；6 个非测试脚本移 `scripts/`；12 文件去 sys.path 样板改由 `tests/conftest.py` 注入；`ruff.toml` 并入 `pyproject.toml`；根目录 3 张验证截图已 git rm。
- 验证（headless + 真实浏览器两套）：`pixi run lint` PASS（8 项一致性核对）｜ `pixi run test` **276 passed / 96 subtests** ｜ `npm --prefix frontend test` PASS（5 组）｜ `npm --prefix frontend run build` PASS ｜ `pixi run test-e2e` **25 passed**（真实 Edge Playwright 套件）。
- 已修（打包与假测试）：`test-core.js` 5 个复刻类全改 `await import` 真模块；`session.py` 范例改读 `straditize_core/assets/age_models/`（已入 package-data 与 PyInstaller datas）；`pyproject` 的 `exclude=["straditize*"]` 因 fnmatch 也匹配 `straditize_core` 致 **wheel 里 0 个 .py**、外加漏配 `ocr/data` 词表——均已修并实测（wheel 55 个 .py + 全部资产）。
- **真实浏览器逐条取证修复 6 个核心交互/渲染缺陷**：① `onerror` 把加载失败标成已加载 → broken 图 `drawImage` 中断整条 render；② `commitRoi` 不回写 `data.rois[]`；③ `drawYAxisCalibration >=4` 导致 Y 标定无即时反馈；④ `drawPollenCurves >=5` 导致分列早出曲线；⑤ **ROI 与选点全局缺少图谱尺寸钳位**：拖拽/选点/插列可延伸至负数或 2898px 虚空（已在前后端全链路加上物理钳位，29 属种 100% 精确落回图谱内）；⑥ **Step 1 未载图时画布背景误显示「正在载入」大字**：`drawBackgroundDiagram` 增加 `!imageSrc` 拦截，消除空路径 `loadImage` 警告。
- 本轮新增三道防线与交互层级治理：① 步骤→能力映射收敛到 `core/WorkflowStage.ts`（8 步单一源），配 `test-workflow-stage.mjs` 6 组断言，修 `drawDepthGrid` 守卫；② `window.__straditize` 调试句柄挂载；③ `consistency_check.py` 8 项一致性核对并入 lint；④ **UI 交互层级重构**：修复 `.primary-btn` 样式脱落（灰方块→实体蓝胶囊）、次要操作按钮实体化、纯展示信息框去操作化、属种形态微按钮加 `▾` 下拉线索。**技术债**：111/255 API 零覆盖、21 个 RPC 端点零引用、`project_new` docstring 超范围、18 处非 `import type`。
