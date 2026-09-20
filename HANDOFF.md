# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-20 09:51 | 分支 dev-v2-modern | HEAD 160b060
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤30 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `cd frontend && npm run build`
- 当前结果：lint ✓ ｜ test **143 passed + 78 subtests** ｜ `pnpm test` ✓ ｜ build ✓ ｜ ⚠️ 运行中的 8765 仍是旧进程（实测仍回 `Access-Control-Allow-Origin: *` 且放行恶意 Origin）→ **须重启 `pixi run rpc-server`** 才载入 c4aa52b 的访问控制

## [TAXADICT] 2026-09-20 11:40 — OCR 词汇表：NPP + 盘星藻 + 硅藻属 + 图版说明解析
- 词典规模 100 → **393 条**：花粉 100 + NPP 83（含盘星藻 18 个种下分类单元：simplex/duplex 变种、boryanum 复合体 longicorne type 1/2、`cf. argentinense`）+ **硅藻属 225**。硅藻来自中科院烟台海岸带所检索表（内陆 151 属 Round 1990 / 海相 114 属 金德祥 1982，并集 227，两表兼有 38）。新增 `cls`（pollen/npp/metric/custom）。
- 数据管线：`support/harvest_diatom_genera.py`（联网采集 227 属详情页 → `straditize_core/ocr/data/diatom_genera.json`）+ `support/sync_diatom_vocab.py`（离线生成 `frontend/src/core/diatomGenera.ts`，离线幂等）；`straditize_pro.spec` 已加 `ocr/data` 打包项，否则冻结版静默退回纯花粉词典。**改词典后必须跑 sync 保前后端一致。**
- 修**三类假阳性**：① 跨类 `Sordariaceae`→`Apiaceae`；② **同属内**未收录 `Pediastrum X` 被拉到 `Pediastrum boryanum`（门禁只校验共享前缀，而属名本身占 10 字符）→ 多词名改比对**属名之后的种加词**（rest_ratio≥0.80 或含包含关系）；③ **属间**（227 属后 `Navicula`/`Navicymbula`、`Gomphonema`/`Gomphoneis` 仅差 2 字符）→ 单名加 **Levenshtein ≤2** 门禁，且**模糊命中 lev≥2 一律降级 `confirm`**（`Cyclotellina` 不再被 auto 认成 `Cyclotella`）。
- 源表 13 条拼写错字（`Thalasiosira`/`Eunoita`/`Meridiom`/`Discostlla`/`Rhabdomema`/`Endictyca`/`Leudugera`…）**不作规范条目**，注册为异名并继承规范名的中文名与生境；两表兼有的属标 `both`。中文键冲突（`四棘藻属` 同时指 `Acanthoceras`/`Attheya`）改为**退回拉丁名作键**，两者都不丢，并记入 `PollenDictionary.name_collisions`。
- **图版说明解析**（`parse_taxa_text`/`extract_caption_taxa`，RPC `ocr.parseTaxaText`）：折叠空白修复属名中间硬换行、丢弃首个图版键前的标题文字、**把图版键替换为分隔符而非按它切分**（否则 `c), d)` 里 `c)` 后不接大写字母会残留孤立键）、保留 `cf.`/`var.`/`type 1`。前端不重复实现，弹窗粘贴即实时预览（`format: figure_caption|list`）。
- 自定义词表：`ocr.getTaxaDict`/`ocr.saveCustomTaxa` 持久化 `~/.straditize/taxa_custom.txt`（`STRADITIZE_TAXA_DICT` 可覆盖）；前端 `📚 词汇表` + 启动 `syncCustomTaxaToGlossary()` 同步。**生效时机**：文件导入/粘贴只填文本框，必须点「💾 保存并应用」；保存后后端**立即生效、无需重启**（`ocr_recognize_labels` 每次新建 engine 读当前文件，实测自定义条目 0→3）。修前端**覆盖/清空模式删不掉旧条目**（`addCustomTaxa` 只有追加路径，后端已清的词仍被侧边栏「批量导入」纠出，已实测复现）→ 改为 `PollenGlossary.setCustomTaxa(names,'replace')`，由不可变 `builtinMap` 重建而非逐个 delete（后者会误删被不同大小写覆盖过的内置键）；`RpcClient` 保存与启动均按 replace 重建，依据是后端 `entries` **恒为操作后全量集合**（已加契约测试锁定）。
- `pnpm test` 现含 `test-glossary.mjs`：直接 import 真实 `.ts` 模块（`node` 原生类型剥离）跑断言，补上 `test-core.js` 全为内联副本、测不到真代码的盲区。注意前端词典是**纯拉丁名**表，中文名不在其中（中文→拉丁映射只在后端 `DEFAULT_POLLEN_DICT`），已用测试固化该边界。

## [UI] 2026-09-20 09:46 — 按钮辨识度（折叠按钮不可见）
- 根因：`.icon-btn` 与 `.tool-btn` 基础态都是 `background:transparent; border:none`，且 hover 写死 `color:#fff`——日间 hover 变白字压白底，等于隐形。
- 改动：`.icon-btn` 基色 `--text-muted`→`--text-secondary` 并给强调蓝 hover；新增 `.icon-btn.panel-toggle`（28×28 + 底色 + 边框）；`Sidebar.ts:72` / `Inspector.ts:98` 折叠按钮挂该类；`.minimap-btn` 与 `.tool-btn` hover 同步（暗色主题取值不变）。
- 验证：build ✓ ｜ lint ✓ ｜ test 137 passed；实机量测 28×28、border 1px rgb(203,213,225)，截图 `verify_btn_light2.png`。后续候选（**用户 2026-09-20 明确暂缓，勿擅自开工**）：属种行内微按钮、顶栏图标按钮。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`；OCR 词典模糊匹配严禁「单候选 + ratio 阈值」直接采纳（会跨类改错名 `Sordariaceae`→`Apiaceae`），必须过前缀/长度门禁或标 `unrecognized`；
- ❌ 年代图识别严禁用「整图二值化 + 最大连通域」或「每行取最暗像素」：Bacon 云是连通实心块、Bchron 是几十条不连通细线，两种渲染都会翻车；必须逐行剖面 + 单调先验，且标定框 ≠ 数据区（轴规则常伸出到刻度之外）；
- ❌ 严禁在生产路径用替代数据掩盖后端失败（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出）；数据只能来自后端真实计算或用户【显式】演示模式；
- ❌ 年龄集合严禁「按采样点序号做 AR(1) + `maximum.accumulate` 事后排序」：前者使相关长度随重采样步长漂移（2→10cm 改 2.8×，特征层位差 4cm），后者掩盖倒转并引入与步长相关的单向偏差；必须在速率空间构造，且拟合须读图形**原生采样**而非重采样后的包络。

## 索引
- 历史归档：`HANDOFF-archive/` ｜ 规范：`AGENTS.md` ｜ 截图：`verify_logo_light.png`
