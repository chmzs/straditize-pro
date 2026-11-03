# 仓库结构审视（2026-11-03）

## 结论摘要

**要治，但只治 3 处，不动源码目录结构。**

1. `tests/unit/test_two_axis_layering.py:340` 指向被 gitignore 的 `output/han2026_ngamring/fig3_raw.jpeg`，
   而同一张图早已入库到 `tests/data/figures/real_plates/fig3_raw.jpeg`（sha256 同为 `927231034b9865bb`）。
   该类的 3 条真实验收用例（337-392 行）在 CI 上一直静默 skip。我按测试自身的断言逻辑
   在 `tests/data/` 那张图上预演过：中灰 6427 px、覆盖率 100.0%，包络泄漏 0.0%，实心覆盖 100.0%
   —— **改完是绿的**（注意：这是手算预演，不是跑 pytest）。改 1 行路径，零风险。
2. `scripts/` 223 个入库文件里只有 2 个挂进了 pixi 任务，其余是 10-19→10-23 已收口的审计探针，
   含 45 个 PNG/JSON/log 产物，共 4.5 MB。**这是本仓库唯一的真实膨胀源**（占全部入库文件 33%）。
3. `docs/plans/` 被 `.gitignore` 排除，但 6 处代码/测试/文档仍在引用，其中
   `support/probe_truth/check_ticket_ownership.py:16` 会**读文件、运行时崩**。要么放行该目录，要么删引用。

**确认不用动**：`session_parts/` 与 `rpc_methods/` 的边界、`frontend/src/core/tools/` 与
`components/canvas/` 的划分、`.gitignore` 对本地产物的覆盖 —— 三者实测都干净，不在问题清单里。

---

## A 该在但不在

### A-1（最该修）真实图版测试指向 gitignore 目录，CI 上永久静默 skip

`tests/unit/test_two_axis_layering.py:340`：

```python
class TestRealFigureAcceptance(unittest.TestCase):
    FIGURE = 'output/han2026_ngamring/fig3_raw.jpeg'
```

`output/` 在 `.gitignore` 第 68 行，CI 上不存在；`_load()` 走 `self.skipTest(...)`。
所以 `TestRealFigureAcceptance`（337-392 行）的 3 条用例从未在 CI 跑过。

而同一张图**已经**入库：

```
$ .pixi/envs/default/python.exe -c "sha256 …"
output/han2026_ngamring/fig3_raw.jpeg        1226159  927231034b9865bb
tests/data/figures/real_plates/fig3_raw.jpeg 1226159  927231034b9865bb
```

→ **改法**：`FIGURE = 'tests/data/figures/real_plates/fig3_raw.jpeg'`。无行为变化，只是让用例真的会跑。

改完会不会红？用测试自身的断言逻辑在入库那张图上预演（`split_by_colour_and_luminance` 同一函数、
同一阈值、同一色键）：

```
中灰 182：n=6427   覆盖率 100.0%   (需 >1000 且 ≥95%)
pink/blue/light-grey：leaked 0.0% / captured 100.0%   (需 leaked==0 且 captured>99%)
deep-red/deep-blue/black：coverage 100.0%             (需 ==100%)
```

3 条全绿。⚠️ 这是**手算预演**，不是 `pytest` 跑出来的 —— 落地时仍应跑一次该文件确认。

### A-2 同类风险的漏网者：`test_ocr_label_band.py` 依赖 Zotero 绝对路径

`tests/unit/test_ocr_label_band.py:131-133`：

```python
REAL_PDF = ("F:/Zotero/storage/HV4FXL63/"
            "Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf")
```

`TestRealPlatePairing` 用 `@pytest.mark.skipif(not os.path.exists(REAL_PDF))` 包着。
后果不只"CI 上不跑"：**任何非本机环境都不跑**，包括换一台机器、换一个 Zotero storage key 之后。
这是入库测试里唯一一处机器绝对路径（`git grep -E "[\"'][A-Za-z]:[/\\\\]" -- tests/` 的其余两条
`I:/does_not_exist/…`、`E:/someone-elses/hoya.png` 是故意的负向 fixture）。

→ **改法**：该 PDF 有版权、不能入库，所以不是"补文件"能解决的。二选一：
(a) 改为显式 `@pytest.mark.skip(reason="需本地 Han2026 PDF（版权限制不入库）")` + 在 `docs/testing-strategy.md`
注明这条只在作者机能跑；(b) 若判定该用例价值不足以付这项代价，直接删。
**推荐 (a)** —— 至少让"为什么跳过"变成可见事实，而不是靠文件存在性碰运气。

### A-3 `docs/plans/` 被忽略，但仍有 6 处在引用（其中 1 处会崩）

`.gitignore`：

```
# Internal agent guidelines, handoff states & private design plans (keep local only)
docs/plans/
```

磁盘上 `docs/plans/` 只剩 1 个文件（`2026-10-07-ui-design-system-refresh.md`）。仍在引用它的：

| 位置 | 引用对象 | 后果 |
|---|---|---|
| `support/probe_truth/check_ticket_ownership.py:16` | `docs/plans/2026-09-20-8step-workflow-tickets.md` | **`DOC.read_text()` 直接抛 FileNotFoundError** |
| `straditize_core/session_parts/cleanup.py:3` | `docs/plans/2026-09-28-step4-cleanup-redesign.md` | 设计依据不可查 |
| `frontend/src/core/WorkflowStage.ts:8` | `docs/plans/2026-09-20-8step-workflow-redesign.md` | 同上 |
| `tests/unit/test_xscale_unification.py:5` | `docs/plans/2026-09-29-column-groups-design.md` §3.3 | 测试契约依据不可查 |
| `tests/unit/test_xticks_rpc_contract.py:3` | `docs/plans/2026-09-29-per-step-usage-audit.md` §4 | 同上 |
| `docs/testing-strategy.md:269` | `docs/plans/2026-09-29-column-groups-design.md` §4 | 文档死链 |

→ **改法**：二选一，不要留在中间态。
(a) `.gitignore` 改为 `docs/plans/*` + `!docs/plans/` 下几个被代码引用的具体文件（需确认这些文件还在不在历史里，
`git log --all -- docs/plans/` 没查，属待确认）；
(b) 承认这些计划已废弃，在 5 处把"见 docs/plans/x.md §N"改成内联一句结论，并删掉 `check_ticket_ownership.py`
（该脚本面向已完成的工单分配表，本身也没有消费者）。

⚠️ `docs/` 是 GitHub Pages 的 `publish_dir`（`.github/workflows/pages.yml`），放行 `docs/plans/` 会把内部设计稿
发布到公开站点。倾向 (b)。

### A-4（附注，非缺陷）`AGENTS.md` / `HANDOFF.md` 不在版本库

```
$ git ls-files | grep -v /     # 只有 10 个根文件，AGENTS.md 与 HANDOFF.md 都不在
.gitattributes .gitignore LICENSE README.md app.py pixi.lock pixi.toml pyproject.toml
start_straditize.bat start_straditize_server.bat
```

这是 `.gitignore` 里**显式声明**的策略（"Internal agent guidelines, handoff states … keep local only"）。
但后果要清楚：**全新 clone 拿不到这两个文件**，`AGENTS.md` 里的 pixi/npm 约定、`HANDOFF.md` 里的断点全部丢失，
新人（或未来的自己）只能靠 README 反推。这不是"放错位置"，是"要不要公开"的决策，**留给用户判断**，本次不动。

---

## B 不该在但在

### B-1 `scripts/` 是最大的存量问题：223 个入库文件，2 个有用

```
$ git ls-files scripts | wc -l
223
$ git ls-files | wc -l
664          # scripts/ 占全部入库文件的 33%
```

按目录：

| 文件数 | 目录 | 是否有消费者 |
|---:|---|---|
| 54 | `scripts/qa_review/` | 无（其中 30 个是产物） |
| 53 | `scripts/static_audit/` | 无（其中 13 个是产物） |
| 32 | `scripts/prod_gate/` | 无 |
| 24 | `scripts/lead_probe/` | 无 |
| 16 | `scripts/zero_flow_probes/` | 无 |
| 12 | `scripts/verify_zero_flow/` | 无 |
| 9 | `scripts/fix_probe/` | 无 |
| 5 | `scripts/product_journey/` | 无 |
| 2 | `scripts/truth/` | 无 |
| 2 | `scripts/qa_column_semantics/` | 无 |
| 1 | `scripts/lock_probe/` | 无 |
| 1 | `scripts/cross_image_probe/` | 无 |

实测只有 **2 个**文件挂进了构建/门禁：

```
pixi.toml:17   record-tutorials = "python scripts/record_tutorials.py"
pixi.toml:85   cmd = "python -X utf8 scripts/check_rpc_spec_drift.py"
```

其余 221 个是 2026-10-19 → 10-23 那几轮审计的一次性探针。`docs/findings/README.md` 确实为其中
4 个目录（`lead_probe` / `zero_flow_probes` / `static_audit` / `verify_zero_flow`）写了"复现脚本"说明，
但那是**为已收口的审计留下的复现路径**，不是长期维护的资产；另外 8 个目录（`qa_review` 54 / `prod_gate` 32 /
`fix_probe` 9 / `product_journey` 5 / `truth` 2 / `qa_column_semantics` 2 / `lock_probe` 1 / `cross_image_probe` 1，
共 106 个文件）不在那张表里。

→ **改法**（不动产品代码，风险可控）：`scripts/` 只保留"挂进 pixi/CI 的" + "被 docs 或 tests 明确引用的"，
其余整体移到仓库外或 `docs/findings/archive/`（后者会进 Pages，见 A-3 的 ⚠️）。

### B-2 `scripts/` 里入库了 45 个产物文件

```
$ git ls-files scripts | grep -cE '\.(png|jpg|jpeg|json|txt|log|csv)$'
45
```

具体：`scripts/qa_review/` 27 个 PNG（`lab0-3.png`、`lbl_320.png`、`top_rot_45.png` …）+ 3 个 `out_*.json`；
`scripts/static_audit/` 10 个 JSON（`baseline1.json`、`dom1.json` …）+ 3 个 `*.log`；
`scripts/prod_gate/HEAD.txt`、`hashes-baseline.txt`。（27+3+10+3+2 = 45）

这些是**探针的输出**，不是探针。它们的价值已由 `docs/findings/*.md` 里的结论摘要承担。
`scripts/` 总计 4.5 MB，其中绝大部分是这些。

### B-3 `scripts/static_audit/serve_zero_backend.py` —— 自我声明"绝不进仓库"却在仓库里

该文件 docstring 第 1 行：

```
AUDIT SCRATCH — 只读审计用，不属于产品代码。放在 /tmp 下，绝不进仓库。
```

而它已入库，并且是被引用的那份 `support/serve_zero_backend.py` 的**分叉副本**：

| | `support/serve_zero_backend.py`（活） | `scripts/static_audit/serve_zero_backend.py`（副本） |
|---|---|---|
| 消费者 | `frontend/playwright.zero.config.ts:99` | 无 |
| `sys.path` 注入 | `Path(__file__).resolve().parents[1]` | **`Path(r"E:/software_dev/straditize")`** |
| 注册方法名 | `e2e.health` / `e2e.reset` | `audit.health` / `audit.resetZero` |
| 默认端口 | 22920 | 23050 |
| `_reset()` | 有，且**断言残留为零、失败即抛** | 无（只调 `project_new` + `_init_cleanup`） |

即：副本既不可移植，又丢掉了活版本后来补的 fail-fast 复位。**删掉副本，不需要任何迁移。**

### B-4 40 个入库文件含硬编码绝对路径（不可移植）

```
$ git grep -n -E "[\"'][A-Za-z]:[/\\\\]" -- '*.py' '*.ts' '*.mjs' '*.cjs'
```

`E:/software_dev/straditize` 出现 20 余次（`scripts/static_audit/exp{2,3,…,18}.py` 每个文件顶部都写一遍）、
`F:/Zotero/storage/HV4FXL63/…` 出现 10 次（`scripts/prod_gate/*.py`、`scripts/product_journey/*.py`）。
产品代码 `straditize_core/` 与 `frontend/src/` 只有 `age_depth_model.py:1546-1552` 的 Rscript 候选路径，
那是合理兜底，不算问题。

→ 与 B-1/B-2 同一处置：这些文件本就不该入库，删了路径问题自动消失。

### B-5 `tests/data/truth/` 有 4 个只写不读的 golden 文件

```
$ git grep -n "exaggeration_layers"
support/probe_truth/gen_ground_truth.py:221:  with open(OUT / f"{key}__exaggeration_layers.json", "w", …)
```

全仓库**只有这一行**，是写入。没有任何 test 或 script 读 `*__exaggeration_layers.json`。
对应 4 个入库文件（`composite_cluster__` / `exaggeration_bell__` / `filled_silhouette__` / `hoya__`）为死数据。

同目录的 `*__x_ticks.json` 是活的（`tests/unit/test_probe_x_ticks.py:52,62,79,240` 动态拼名读取）。

→ 删 4 个 `__exaggeration_layers.json`，或补上读它的测试。**不要两个都不做**。

### B-6 两个未跟踪的重复图片（一旦 `git add -A` 就会入库）

```
$ git status --porcelain
?? tests/data/figures/benchmark_types/beginner-tutorial.png
?? tests/data/figures/benchmark_types/hoya-del-castillo.png
```

与 `straditize_core/assets/tutorials/` 下的权威副本**逐字节相同**：

```
3fc0324d9094  tests/data/figures/benchmark_types/beginner-tutorial.png
3fc0324d9094  straditize_core/assets/tutorials/beginner-tutorial.png
f94196e6a816  tests/data/figures/benchmark_types/hoya-del-castillo.png
f94196e6a816  straditize_core/assets/tutorials/hoya-del-castillo.png
```

引用者为零（`git grep "benchmark_types/beginner-tutorial"` 命中 0；全部 e2e 引用都指向
`straditize_core/assets/tutorials/…`，见 `frontend/e2e/from-zero-journey.spec.ts:54,197`）。

→ 直接删本地副本。**它们现在还没入库，是最便宜的时候。**

### B-7 两个入口的批处理，README 只认一个

`start_straditize.bat` 与 `start_straditize_server.bat` 的唯一实质行都是 `pixi run app`，差别只在 `echo` 的横幅文字。
`README.md:178` 只提 `start_straditize.bat`。`start_straditize_server.bat` 引用数 = 0。

→ 删 `start_straditize_server.bat`。

---

## C 归属错

### C-1 `scripts/` 把三类东西混在一个目录

现状：一次性探针（`fix_probe/probe2.py`、`probe3.py`）、已收口审计（13 个子目录）、活工具
（`check_rpc_spec_drift.py`、`record_tutorials.py`、`benchmark_two_axis.py`、`bench_golden.py`、
`download_benchmark_figures.py`）平铺在同一层。

→ 活工具留 `scripts/`（5 个），其余按 B-1 处置。判据不用猜：`grep -rl <basename> pixi.toml pyproject.toml .github/workflows/` 命中即为活。

### C-2 `docs/handoff-2026-11-01-step6.md` 放错层

单项交接稿放在 `docs/` 根，而本仓库的交接制度是：热状态卡 `HANDOFF.md`（根，实测 50 行，符合 ≤50 行规范）、
冷历史 `HANDOFF-archive/`。这份 8.9 KB 的 step6 交接稿两处都不属于。

→ 移入 `HANDOFF-archive/`（该目录已 gitignore，等于从公开仓库撤下）。

### C-3 `frontend/` 根目录躺着 12 个测试文件

`frontend/test-core.js` + `frontend/test-{glossary,roi-calibration,roi-model,workflow-stage,ui-consistency,
ocr-match-notice,suspect-block,agedepth-sync,ruler-geometry,calibration-display}.mjs` 共 12 个，
和 `package.json`/`vite.config.ts`/`tsconfig.json` 平级。`package.json:11` 的 `test` 脚本因此是一条 12 段 `&&` 长链。

→ 收进 `frontend/test/`，`test` 脚本改为一次 glob。⚠️ 注意这些文件里有 `import '../src/…'` 的相对路径
（`test-core.js` 等），移动后需同步改 import 层级 —— 所以**这条不是纯机械移动**，要连同 `package.json` 一起改并跑
`npm test` 验证。建议排在最后做。

### C-4 `frontend/src/ui/feedback.ts` 单文件目录

`ui/` 下只有 `feedback.ts` 一个文件，而同级 `services/`（9 个文件）、`styles/`（1 个 `tokens.ts`）都有明确职责名。
`ui/` 这个名字和 `components/` 语义重叠（"UI"就是组件）。

→ 并入 `services/` 或 `styles/`（看 `feedback.ts` 实际职责），删空目录。影响面小但会改 import 路径，
需跑 `npm run build`。

### C-5 `straditize_core/session_parts/layers.py` 是空 mixin

全文件 11 行，唯一成员：

```python
class LayersMixin:
    def _init_layers(self) -> None:
        """Initialize layers state."""
        pass
```

它存在的唯一理由是 `session.py:20,51` 的 MRO 列表和 `tests/integration/test_multi_roi.py:40` 的 mixin 清单断言。
没有任何 `layers_*` 方法。一个只有 `pass` 的 mixin 不是"粒度合理"，是**空壳**。

→ 并入 `CoreMixin`，同步改 3 处引用。⚠️ `test_multi_roi.py:40` 断言的是 mixin 名单，
删 `LayersMixin` 会让它变红 —— 这是**预期内的**，一起改。

### C-6 `straditize_core/twolayer_detect.py` 无任何产品调用方

```
$ git grep -n "twolayer" -- '*.py'
scripts/prod_gate/_util.py:78:  "straditize_core/twolayer_detect.py",   # 仅作 hash 清单
```

产品代码、测试、前端均为 0 引用。该模块自己的设计文档也承认：
`docs/findings/fix-foreground-two-layer.md:25` —— "自动识别双层图…（**当前未被默认路径调用**，见卡点）"。

→ 要么接进默认路径，要么删。**「写了但没接线」是最坏状态**：它让 `docs/findings` 的结论看起来比实际更完整。

---

## D 命名不一致

### D-1 `product-*` 与 `production-*` 四份文档，一对近形词

```
docs/findings/product-readiness-2026-10-23.md     # "产品就绪度"
docs/findings/production-readiness.md             # "投产验收"
docs/findings/production-gate-2026-10-23.md       # "投产门禁"
docs/findings/production-gate-open-items.md       # "投产门禁待补项"
```

`product` 与 `production` 差 2 个字符，指两件不同的事。搜索 "readiness" 会同时命中前三份，无法一眼判断该读哪份。

→ 建议：`product-readiness-*` 改名 `product-readiness-2026-10-23.md` → 在其标题内首次出现处说明与
`production-*` 的区别；或统一成 `gate-*` / `readiness-*` 两个前缀。

### D-2 `docs/findings/` 33 份 md 里只有 2 份带日期

```
$ ls docs/findings/*.md | wc -l
33
$ ls docs/findings/*-2026-*.md | wc -l
2
```

带日期的只有 `product-readiness-2026-10-23.md`、`production-gate-2026-10-23.md`。
其余 31 份（`bug-report.md`、`static-audit.md`、`verification.md`、`qa-review-real-figure.md` …）无日期。
而这些文档内部大量写着"317 passed → 398 → 512"这类**时间点相关**的结论，过半年无法判断哪份是当前的。

→ 命名规范建议：`<类别>-<YYYY-MM-DD>-<主题>.md`（`fix-` / `spec-` / `qa-` / `gate-` / `bench-`）。
⚠️ 重命名会打断 9 个测试文件里的 `docs/findings/…` 引用（见 D-2 附注），收益低于成本，**建议只对新文件生效**。

附注（影响面，供决策参考）：

```
$ git grep -l "docs/findings" -- 'tests/**' | wc -l
9
$ git grep -l "docs/findings" -- 'straditize_core/**' 'frontend/src/**' | wc -l
4            # image.py / ruler.py / session_parts/export.py / session_parts/xscale.py
```

### D-3 归档用「文件名后缀」而不是目录

`docs/findings/xticks-ground-truth-ARCHIVED-v1.md` 与 `docs/findings/xticks-ground-truth.md` 并排躺在一起，
靠文件名里的 `ARCHIVED-v1` 区分。而仓库根部已经有了正确的范式：`HANDOFF-archive/`（目录）。
两套归档方式并存。

→ 建 `docs/findings/archive/`，把 `*-ARCHIVED-*` 与 B-1 的历史文档一并放入。
⚠️ `docs/` 是 Pages 发布目录，`archive/` 会一起公开 —— 若不想公开，应移到 `HANDOFF-archive/`。

### D-4 两套前端测试命名与两套 runner

```
frontend/e2e/*.spec.ts        34 个   playwright test
frontend/test-*.mjs           12 个   node --experimental-strip-types
frontend/test-core.js          1 个   node --experimental-strip-types
```

同一件事（前端断言）两种命名三种运行方式，`npm test` 只覆盖后 13 个，`npm run test:e2e` 覆盖前 34 个，
而 CI 两者都跑（`.github/workflows/ci.yml` 的 "Run Frontend Tests" 与 "Run E2E Browser Tests"）。
文件名的 `test-` 前缀 vs `.spec.ts` 后缀并存，看不出哪套是"单测"哪套是"e2e"。

→ 与 C-3 合并处理：移动即改名为 `frontend/test/*.test.mjs`，保留 `e2e/` 现行 `.spec.ts`。

### D-5 探针脚本用数字后缀

```
scripts/fix_probe/probe2.py
scripts/fix_probe/probe3.py
scripts/fix_probe/band_probe.py
scripts/fix_probe/key_numbers.py
scripts/fix_probe/measure.py
scripts/fix_probe/truth.py
```

同目录 6 个文件，3 个用动宾短语，2 个用数字，1 个叫 `truth.py`（看不出测什么）。
同类问题：`scripts/static_audit/exp1…exp18`（18 个纯数字）。

→ 与 B-1 一起处置即可，不值得单独改名。

---

## E 重复实现

### E-1 零状态后端起两份，且副本更弱

见 B-3 的对照表。`support/serve_zero_backend.py`（活）vs `scripts/static_audit/serve_zero_backend.py`（副本）。
副本的 `_reset()` 缺活版本后来补的残留断言，且 `sys.path` 写死本机路径。

→ 删副本。**这是本清单里唯一一处"同一个功能两个入口"的硬证据。**

### E-2 `bench-diatom.md` / `bench-pollen.md` 各存在两份，内容不同

```
$ diff docs/findings/bench-diatom.md docs/findings/bench-issues/bench-diatom.md
DIFFERENT
  360 docs/findings/bench-diatom.md
  255 docs/findings/bench-issues/bench-diatom.md
  265 docs/findings/bench-pollen.md
  185 docs/findings/bench-issues/bench-pollen.md
```

`bench-issues/` 子目录只有这 2 个文件，且与父目录同名文件内容不同（不是副本，是**两个版本**）。
没有任何指针说明哪份是权威。而 `tests/unit/test_curve_reader_columns.py:2,33,57` 同时引用
`docs/findings/bench-issues/bench-pollen.md` 和 `docs/findings/bench-pollen.md` —— 连测试都不确定该认哪份。

→ 保留较新/较全的一份（360 行那份），另一份加一行 `> 已被 ../bench-diatom.md 取代`，或直接删。
**不能两份都留、都不标注。**

### E-3 阶段→工具映射表写了两遍（改一处只红一半）

权威实现：`frontend/src/components/GeologyCanvas.ts:2639` `getAllowedTools()`。
平行副本：`frontend/e2e/workflow-panels.spec.ts:54-61`：

```ts
const expectations: Record<number, { visible: string[]; active: string | null }> = {
  1: { visible: ['pan'], active: 'pan' },
  …
  7: { visible: ['addPoint', 'eraser', 'pan', 'select'], active: 'select' },
};
```

这是一份**手抄**的表。改 `getAllowedTools` 后，只有跑 e2e（约 110s）才会红；`npm test` 与 `pixi run test` 都不红。
同文件注释还引用了两个已失效的行号（`GeologyCanvas.ts:3016`、`:2902`，实际分别是 2639 和别处）。

→ 短期：把 `expectations` 的注释改为"与 `getAllowedTools()` 逐行对应，改动必须同步"。
长期：让 `getAllowedTools` 从 `core/WorkflowStage.ts` 导出，e2e 直接 import 而不是手抄。
⚠️ 后者需要把 `GeologyCanvas` 的方法提到 `core/`，属真重构，**本次不建议动**。

### E-4 「期望值」资产分两套目录、两套生成器

| 系统 | 路径 | 生成器 | 消费者 |
|---|---|---|---|
| golden | `tests/data/figures/benchmark_types/golden/{abernethy_pollen,rlgh_diatom}.json` | `scripts/bench_golden.py:30` | `tests/unit/test_curve_reader_columns.py:30` |
| truth | `tests/data/truth/{key}__{x_ticks,exaggeration_layers}.json` + `index.json` | `support/probe_truth/gen_ground_truth.py:221,239` | `tests/unit/test_probe_x_ticks.py:52,62,79,240`、`test_x_ticks.py:106` |

两者测的对象不同（曲线读数 vs 刻度几何），**合并并非必要**；问题是两个目录各有一个 manifest
（`truth/index.json` 有 sha256+size；`golden/` 没有 manifest），两种命名（`<fig>__<feature>.json` vs `<fig>.json`），
两个生成器（一个在 `scripts/`、一个在 `support/`）。

→ 建议在 `docs/testing-strategy.md` 加一节「两类期望值资产的区别」，并统一 manifest 约定。
**不建议合并目录** —— 语义确实不同，合并会制造假相等。

### E-5 `docs/tutorials/*.md` 与 `*.html` 无构建链同步

```
01_quickstart.md (09-30)  →  01_quickstart.html (10-09)
02_…_calibration.md (09-30) → 02_…_calibration.html (10-10)
03_export_and_riojaplot.md (09-30) → 03_…_html (10-11)
```

3 组「同内容两格式」，HTML 比 MD 晚 9-11 天生成，但仓库里**没有生成器**
（`git grep "html" scripts/record_tutorials.py` → 0 命中；`record_tutorials.py` 只产 GIF/PNG）。
即：改 `.md` 不会更新 `.html`，两者会静默漂移，而 Pages 发布的是 `docs/`（两份都公开）。

→ 要么把 HTML 生成步骤补进 `pixi run record-tutorials`，要么只保留 `.md` 并让 Pages 侧渲染。
**这是 D 与 E 的交界**，因为"重复的是生成物而不是逻辑"，风险低于 E-1/E-2。

---

## 待确认（无证据的直觉）

以下几条我**没有**拿到"两条以上独立证据"，故不进入上面的判据表。列在这里避免被当成已确认结论。

1. **`frontend/src/components/GeologyCanvas.ts` 2843 行是 God object。**
   实测方法数 60+，混了 DOM 构造（`createFloatingToolbar`/`createDropOverlay`）、事件（`onMouseDown`/`onKeyDown`）、
   命中测试（`findHitColumn`/`findHitAnchor`/`findHitBoundary`）、12 个 `draw*`、阶段门禁。
   **但"大"不等于"重复"** —— 我原本预期 `core/tools/` 与 `components/canvas/` 有逻辑重叠，
   `grep "^export"` 逐条比对后**没有发现同名或同职责的导出**（tools = 输入策略，canvas = 绘制覆盖层），
   划分是干净的。所以这条属于"C 归属"的候选而非 E，且拆分成本高，**建议不动**。

2. **`getAllowedTools()`（阶段→工具）在 `GeologyCanvas`，`visibleLayers()`（阶段→图层）在 `core/WorkflowStage.ts`。**
   同一个"步骤编号"两个轴写在两个文件，其中图层轴有 `frontend/test-workflow-stage.mjs` 钉住，
   工具轴只有 e2e 的手抄副本（E-3）。我**没有**确认 `test-workflow-stage.mjs` 是否覆盖 `getAllowedTools`
   （grep 该文件无命中，但它可能间接覆盖）。若要合并，需先补这条覆盖。

3. **`docs/index.html`（48 KB）与 `docs/tutorials/*.html` 是否同源。**
   前者是站点首页，后者是教程页；两者都是手写 HTML 且都发布到 Pages。
   没有找到生成器，也没找到"必须手写"的理由。**可能**应该合并成一套静态站点生成流程，但这是产品决策。

4. **`tests/data/figures/benchmark_types/data/`（含 `export_aber.R`、`riojaPlot_Demo.R` 等 R 脚本）放在 tests 下是否合适。**
   这些是"生成 benchmark 图的原始数据与脚本"，与 `tests/` 的"测试依赖"语义不完全一致。
   但在没有第二个消费者之前，放这里也说不上错 —— 只是**测试目录里混进了生产数据**这一点需要知情。

5. **`docs/findings/` 是否会无限膨胀。**
   现状 33 份 md，全部在 2026-10-23 与 11-02 两个时间点新增（`git log --diff-filter=A --date=short`）。
   按这个速率（11 天内 33 份：10-23 有 29 份、11-02 有 4 份），半年后会到 500 份量级。**推测**需要分层（`findings/` 只留当前有效结论，
   历史移 `archive/`），但目前 33 份还读得动，不构成紧急问题。

---

## 建议的治理顺序（含每步的影响面与风险）

按「风险从低到高、收益从高到低」排序。第 0 步可以今天就做，第 3 步需要单独评审。

### 第 0 步：修 A-1（1 行，零风险）

改动：`tests/unit/test_two_axis_layering.py:340` 的 `FIGURE` 常量。
影响面：仅该文件；`TestRealFigureAcceptance` 的 3 条用例从"静默 skip"变为"真的会跑"。
风险：已用测试自身的断言逻辑预演，3 条全绿（详见 A-1），所以**不会把 CI 打红**。
落地时仍建议跑一次 `pixi run test tests/unit/test_two_axis_layering.py` 确认（这一步 2 秒，不占端口）。
这与用户已知的历史事故（`output/han2026_ngamring/fig3_raw.jpeg` 未入库导致 CI 必红，后修）
是同一类问题的**漏网者** —— 那次修了 3 个测试文件，漏了这 1 个。

### 第 1 步：清理本地未跟踪垃圾（B-6，1 分钟）

改动：删除 `tests/data/figures/benchmark_types/beginner-tutorial.png` 与 `hoya-del-castillo.png`。
影响面：零（引用数 0，权威副本在 `straditize_core/assets/tutorials/`）。
风险：零。唯一注意点是**不要用 `git add -A` 误提交**它们。

### 第 2 步：删 B-3 / E-1 / B-7 三个死入口

改动：
- 删 `scripts/static_audit/serve_zero_backend.py`（E-1、B-3）
- 删 `start_straditize_server.bat`（B-7）
- 删 4 个 `tests/data/truth/*__exaggeration_layers.json`（B-5）

影响面：`support/consistency_check.py` 的检查 C/D 会遍历 `support/` 与 `tests/`，删文件后需跑
`pixi run lint-consistency` 确认零豁免仍成立（该脚本的设计目标就是"tests 下每个 .py 都能被 pytest 收集"，
删的是数据不是 .py，应无影响，但要验证）。
风险：低。**删完必须跑 `pixi run lint`**（CI 执行的三条之一）。

### 第 3 步：`scripts/` 瘦身（收益最大，但需要单独评审）

改动：只保留 5 个活脚本（`check_rpc_spec_drift.py`、`record_tutorials.py`、`benchmark_two_axis.py`、
`bench_golden.py`、`download_benchmark_figures.py`），221 个探针文件迁出。
影响面：
- `docs/findings/README.md` §1 有一张"复现脚本按来源分目录"表，指向 `scripts/{lead_probe,zero_flow_probes,static_audit,verify_zero_flow}` —— 迁移后这张表要改。
- `docs/findings/` 里至少 5 份文档以 `pixi run python scripts/…` 形式给出复跑命令（README §2.5 有 4 条）。
- `git ls-files scripts` 减少 221 条，仓库体积减少约 4.5 MB。

风险：⚠️ **这是唯一一处会"打断已完成文档的可复跑性"的改动**。
建议保留补救路径：把探针目录整体打一个 `git tag`（如 `audit-2026-10-23`）再删，
文档里的 `pixi run python scripts/...` 改成 `git show audit-2026-10-23:scripts/...` 或直接标注"该轮审计已收口，脚本见 tag"。
**不要在没有 tag 的情况下直接删** —— 那会让 README §5「用户如何自证没有偷懒」整节失效。

### 第 4 步：修 A-3（docs/plans 的死引用）

改动：5 处 `docs/plans/x.md` 引用改为内联结论；删 `support/probe_truth/check_ticket_ownership.py`
（它面向的工单分配表已随 `docs/plans/` 一起消失，本身也无消费者）。
影响面：`straditize_core/session_parts/cleanup.py`（仅 docstring）、`frontend/src/core/WorkflowStage.ts`（仅注释）、
2 个测试文件（仅 docstring）、`docs/testing-strategy.md`（正文）。
风险：⚠️ `support/` 下删 .py 会影响 `consistency_check.py` 的检查 D（"tests 下每个 .py 都能被 pytest 收集"）
与检查 C（package-data）；`probe_truth/check_ticket_ownership.py` 在 `support/` 不在 `tests/`，
按 `probe_truth` 目录现有 2 个文件判断应在豁免范围内，但**必须跑 `pixi run lint` 确认**。
另：`gen_ground_truth.py` 留在 `support/probe_truth/`（它是 B-5 的生成器，若保留它是为了可再生 truth 数据，则不应删）。

### 第 5 步：C-3 / D-4 前端测试归位（机械性最强，但改 import）

改动：`frontend/test-*.mjs` + `test-core.js` → `frontend/test/`，`package.json` 的 `test` 脚本改为一条。
影响面：12 个文件的 `import '../src/…'` 层级全部 +1；`package.json:11`；CI 的 "Run Frontend Tests" 步骤命令不变（`npm test`）。
风险：⚠️ **不是纯移动**，改 import 层级容易漏。验收：`npm --prefix frontend test` 全绿。
建议排在 `scripts/` 之后，因为它的收益（可读性）低于第 0-3 步。

### 第 6 步：C-2 / D-3 文档归位（低风险）

改动：`docs/handoff-2026-11-01-step6.md` → `HANDOFF-archive/`；
`docs/findings/xticks-ground-truth-ARCHIVED-v1.md` → `docs/findings/archive/`。
影响面：`docs/` 是 Pages 发布目录（`publish_dir: ./docs`），移入 `HANDOFF-archive/`（gitignore）等于从公开站点撤下。
风险：低，但要接受"这些内容不再公开"。**若需保留公开访问，就别移，只在 `docs/findings/README.md` 加索引说明。**

### 不建议做

- **重命名 `docs/findings/*.md`（D-2）**：会打断 9 个测试文件的引用，收益低于成本。只对新文件套用新规范。
- **拆 `GeologyCanvas.ts`（待确认 1）**：2843 行的规模是问题，但没有重复实现作为抓手，
  拆分属真重构，且该文件被 34 个 e2e spec 间接覆盖，回归成本高。
- **合并 `golden/` 与 `truth/`（E-4）**：两者测的物理量不同，合并会制造"看起来相等"的假象。
- **动 `AGENTS.md` / `HANDOFF.md` 的入库策略（A-4）**：这是公开程度的决策，不是结构问题。

---

## 附：本次审视的取证清单（可复跑）

```bash
git ls-files | wc -l                                    # 664
git ls-files scripts | wc -l                            # 223
git ls-files scripts | grep -cE '\.(png|json|log|txt|csv)$'   # 45
git ls-files | awk -F/ '{print $1}' | sort | uniq -c | sort -rn
git grep -n -E "[\"'][A-Za-z]:[/\\\\]" -- '*.py' '*.ts' '*.mjs'   # 40 处硬编码绝对路径
git grep -n "docs/plans"                                # 6 处，文件均已不存在
git grep -n "twolayer"                                  # 仅 1 处，且是 hash 清单
git grep -n "exaggeration_layers"                       # 仅 1 处，且是写入
grep -rl <script> pixi.toml pyproject.toml .github/workflows/  # 判"活/死"脚本
```

本次未执行：任何测试（`pixi run test` / `test-e2e`）、任何写操作（除本文件）。
