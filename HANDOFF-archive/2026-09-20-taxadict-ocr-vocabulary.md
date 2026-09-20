# 归档：OCR 词汇表（NPP + 盘星藻 + 硅藻属 + 图版说明解析）

> 从 `HANDOFF.md` 移出（2026-09-20，因新增 ROI/标定解耦节超出 50 行上限）。
> 内容逐字保留，只增不减。

## [TAXADICT] 2026-09-20 11:40 — OCR 词汇表：NPP + 盘星藻 + 硅藻属 + 图版说明解析
- 词典规模 100 → **393 条**：花粉 100 + NPP 83（含盘星藻 18 个种下分类单元：simplex/duplex 变种、boryanum 复合体 longicorne type 1/2、`cf. argentinense`）+ **硅藻属 225**。硅藻来自中科院烟台海岸带所检索表（内陆 151 属 Round 1990 / 海相 114 属 金德祥 1982，并集 227，两表兼有 38）。新增 `cls`（pollen/npp/metric/custom）。
- 数据管线：`support/harvest_diatom_genera.py`（联网采集 227 属详情页 → `straditize_core/ocr/data/diatom_genera.json`）+ `support/sync_diatom_vocab.py`（离线生成 `frontend/src/core/diatomGenera.ts`，离线幂等）；`straditize_pro.spec` 已加 `ocr/data` 打包项，否则冻结版静默退回纯花粉词典。**改词典后必须跑 sync 保前后端一致。**
- 修**三类假阳性**：① 跨类 `Sordariaceae`→`Apiaceae`；② **同属内**未收录 `Pediastrum X` 被拉到 `Pediastrum boryanum`（门禁只校验共享前缀，而属名本身占 10 字符）→ 多词名改比对**属名之后的种加词**（rest_ratio≥0.80 或含包含关系）；③ **属间**（227 属后 `Navicula`/`Navicymbula`、`Gomphonema`/`Gomphoneis` 仅差 2 字符）→ 单名加 **Levenshtein ≤2** 门禁，且**模糊命中 lev≥2 一律降级 `confirm`**（`Cyclotellina` 不再被 auto 认成 `Cyclotella`）。
- 源表 13 条拼写错字（`Thalasiosira`/`Eunoita`/`Meridiom`/`Discostlla`/`Rhabdomema`/`Endictyca`/`Leudugera`…）**不作规范条目**，注册为异名并继承规范名的中文名与生境；两表兼有的属标 `both`。中文键冲突（`四棘藻属` 同时指 `Acanthoceras`/`Attheya`）改为**退回拉丁名作键**，两者都不丢，并记入 `PollenDictionary.name_collisions`。
- **图版说明解析**（`parse_taxa_text`/`extract_caption_taxa`，RPC `ocr.parseTaxaText`）：折叠空白修复属名中间硬换行、丢弃首个图版键前的标题文字、**把图版键替换为分隔符而非按它切分**（否则 `c), d)` 里 `c)` 后不接大写字母会残留孤立键）、保留 `cf.`/`var.`/`type 1`。前端不重复实现，弹窗粘贴即实时预览（`format: figure_caption|list`）。
- 自定义词表：`ocr.getTaxaDict`/`ocr.saveCustomTaxa` 持久化 `~/.straditize/taxa_custom.txt`（`STRADITIZE_TAXA_DICT` 可覆盖）；前端 `📚 词汇表` + 启动 `syncCustomTaxaToGlossary()` 同步。**生效时机**：文件导入/粘贴只填文本框，必须点「💾 保存并应用」；保存后后端**立即生效、无需重启**（`ocr_recognize_labels` 每次新建 engine 读当前文件，实测自定义条目 0→3）。修前端**覆盖/清空模式删不掉旧条目**（`addCustomTaxa` 只有追加路径，后端已清的词仍被侧边栏「批量导入」纠出，已实测复现）→ 改为 `PollenGlossary.setCustomTaxa(names,'replace')`，由不可变 `builtinMap` 重建而非逐个 delete（后者会误删被不同大小写覆盖过的内置键）；`RpcClient` 保存与启动均按 replace 重建，依据是后端 `entries` **恒为操作后全量集合**（已加契约测试锁定）。
- `pnpm test` 现含 `test-glossary.mjs`：直接 import 真实 `.ts` 模块（`node` 原生类型剥离）跑断言，补上 `test-core.js` 全为内联副本、测不到真代码的盲区。注意前端词典是**纯拉丁名**表，中文名不在其中（中文→拉丁映射只在后端 `DEFAULT_POLLEN_DICT`），已用测试固化该边界。
