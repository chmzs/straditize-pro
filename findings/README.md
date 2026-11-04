# 从零开始的花粉图数字化：上机旅程 + 缺陷审计（交付文档集）

> 目的：回答三个问题 ——
> ① **怎么模拟人类操作**，对一份花粉图从零开始用软件提取数据、走完全部流程；
> ② 这样做**发现了哪些 bug**；
> ③ 留下**可核验的工程文档**，让任何人都能自己复跑、验证我没有偷懒。
>
> 日期：2026-10-19 ｜ 分支 `main` @ `caaac01` ｜ 环境：Windows 11 + Git Bash + pixi + 系统 Edge
>
> **2026-10-23 追补**：本文件原只覆盖 10-19 的从零旅程审计。10-20 → 10-22 又发生三轮实质修复
> （B-03 跨图几何残留 / 双轴分层 / 按列单双层语义），对应文档已补进 §1 导航表，
> §2.4 与 §5 里过期的 `317 passed` 已更正为实测值。
>
> **2026-10-23 团队修复轮再追补**：当日又完成 10 条缺陷修复（B-11 / B-02 / B-08 / B-07 / B-04 /
> B-05 / C1d / C1e / B-12+provenance / B-06 / G-01a），门禁从 `398` 升至 **`512 passed`**
> （详见 `docs/findings/production-gate-2026-10-23.md` 与 `HANDOFF.md` 的 `[TEAM-SYNC-2]` 节）。

---

> **脚本归档说明（2026-11-04）**：本目录各文档里引用的 `scripts/...` 复跑命令，
> 除 [`probe-index.md`](probe-index.md)「存续件」表里列出的 12 个之外，其余脚本已从工作树
> 移出（211 个），完整快照在 tag **`audit-2026-11-04`**：
> `git show audit-2026-11-04:scripts/<路径> > /tmp/probe.py`。
> 各探针当初"在问什么"见 `probe-index.md` 的目录索引。
>
> **注意**：下面各文档的结论、实测数字、判据全部仍然有效（它们是历史记录，不改写）；
> 只有"再跑一遍那个脚本"这条路径改走 tag。

## 1. 文档导航

| 文件 | 谁写的 | 作用 | 是否可复跑 |
| :--- | :--- | :--- | :--- |
| [`journey-log.md`](./journey-log.md) | journey-runner（队友） | **方法主体**：从零上传 → 八步 → 导出的逐步记录，每步"人做了什么 / 界面回应 / 后端权威状态 / 判断" | ✅ |
| [`journey-trace.json`](./journey-trace.json) | 同上 | 上表的**原始证据**：9 步后端权威快照（机器可读） | ✅ |
| [`dynamic-probes.md`](./dynamic-probes.md) | bug-prober（队友） | 对抗性动态探针：主动破坏该流程，8 条发现 + 未验证假设分节 | ✅ |
| [`static-audit.md`](./static-audit.md) | 静态审计子代理 | 只读审计：8 条发现（含 2 条 Critical）+ 已澄清项 + 未验证假设 | ✅ |
| [`lead-measurements.md`](./lead-measurements.md) | **Lead（本会话）** | Lead 亲手跑过并复核的原始证据（含独立复现的 Critical 条） | ✅ |
| [`verification.md`](./verification.md) | verifier（队友） | **独立复核**：逐条四态判定（REPRODUCED / NOT_REPRODUCED / PARTIAL / UNCERTAIN）+ 严重度裁定 | ✅ |
| [`bug-report.md`](./bug-report.md) | **Lead** | **统一缺陷报告**：合并三份来源、按严重度分级、标注复核结论；§0.5 是**修复记录** | — |
| [`production-readiness.md`](./production-readiness.md) | **Lead** | **投产验收**：工程包往返保真、提取产出打通、本轮修掉的 3 个缺陷、以及"距离生产还差什么" | ✅ |
| [`agent-mcp-design.md`](./agent-mcp-design.md) | **Lead** | **MCP/Agent 设计**：怎样让机器自动提取**可信**数据（provenance / 能力边界 / 可拒性） | — |

### 1.1 10-20 之后新增的修复文档（2026-10-23 追补）

| 文件 | 谁写的 | 作用 | 是否可复跑 |
| :--- | :--- | :--- | :--- |
| [`metric-luminance-vs-colour.md`](./metric-luminance-vs-colour.md) | Lead（文内自述"Lead 实测"，无署名行） | **判据理论**：为什么"最深 N%"、纯亮度、纯颜色三者都不可用；给出色度+亮度双轴正解与失效边界 | ✅ §7 两条 `pixi run python -c` |
| [`fix-two-axis-layering.md`](./fix-two-axis-layering.md) | `layer-fixer`（task-9） | **双轴分层修复**：中灰 182 覆盖 0%→100%；可分离组合 60.7%→97.4%、多读 86→0；含 16 张合成图扫描与 4 处真实缺陷 | ✅ `pixi run python scripts/benchmark_two_axis.py` |
| [`fix-cross-image-cleanup.md`](./fix-cross-image-cleanup.md) | Lead（接手 `cleanup-fixer` 中断的任务） | **B-03 修复**：换图/新建项目后清理几何残留 → 0 条；两层防御（主动清空 + `_geometry_scope()` 纵深防御） | ✅ `tests/unit/test_cross_image_cleanup.py`（7 项） |
| [`spec-column-semantics.md`](./spec-column-semantics.md) | Lead | **设计规格**：按列判定单层/双层，消除"单层灰列被当阴影"；定 V1–V7 验收判据 | —（规格文档，判据可复跑见 §6） |
| [`impl-column-semantics.md`](./impl-column-semantics.md) | 实现者（task-12，文档未署名） | **实现报告**：V1–V7 全 PASS，单层灰列 0%→100%；三处关键改动 + 踩坑记录 | ✅ §6 三条命令 |
| [`qa-column-semantics.md`](./qa-column-semantics.md) | QA 复核者（`scripts/qa_column_semantics/`，文档未署名） | **独立验收**：自建脚本不复用实现者基准；四态计数 7 PASS，7 场景对抗矩阵 + 10 项敌意探测 | ✅ §6 四条命令 |
| [`software-issues-verified.md`](./software-issues-verified.md) | 核实者（文档未署名，核实时间 2026-10-20） | **逐条核实**：8 条仍是问题 / 3 条已修 / 6 条作者自认度量错误；§六 为 10-20 14:30 修复状态更新 | ✅ §五 两条 `pixi run python -c` |

复现脚本（按来源分目录，互不覆盖）：

| 目录 | 归属 | 内容 |
| :--- | :--- | :--- |
| `scripts/lead_probe/` | Lead | 零状态后端 + 上传驱动 + 撕裂读复现 + Lead 自己的复核脚本 |
| `scripts/zero_flow_probes/` | bug-prober | 8 个后端探针 + `driver.cjs`（真实 Edge UI 探针）+ 零状态启动器 |
| `scripts/static_audit/` | 静态审计子代理 | 20 个 Python 实验 + 19 个 JS 取证脚本 + 原始 JSON 输出 |
| `scripts/verify_zero_flow/` | verifier | 独立复核脚本（不复用他人实现） |

---

## 2. 一键复跑

### 2.1 端口约定（**必读，否则命令会直接抛错**）

各 lane 的端口段是**互斥**的，跑错段会立刻失败：

| 用途 | 端口段 | 约束来源 |
| :--- | :--- | :--- |
| 从零旅程（`playwright.zero.config.ts`） | **22920 – 22930**（硬性） | 配置里有越界即抛错的守卫；用 22960 会报 `越界` |
| 既有 e2e 基线（`playwright.config.ts`） | 8799（默认，可换） | `STRADITIZE_E2E_PORT` |
| 契约 lane | 任意空闲（本文用 22901） | 同上 |
| 本次审计的临时探针 | 23000 – 23100（静态审计）、22940-22950（probes）、22910-22916（Lead） | 各自脚本内写死，见对应 README |

> ⚠️ verifier 曾在 22960-22970 跑旅程并直接抛错（`playwright.zero.config.ts:28-33` 的守卫）。
> 旅程**只能用 22920-22930**。

### 2.2 环境前提

```bash
# 仓库根：E:\software_dev\straditize（Git Bash）
# 需要：pixi 环境、Node ≥ 20、系统已装 MS Edge
pixi install                       # 首次
npm --prefix frontend run build     # 必须先 build：后端从 frontend/dist 托管界面
```

### 2.3 从零旅程（核心交付）

```bash
cd frontend
STRADITIZE_ZERO_PORT=22920 npx playwright test --config=playwright.zero.config.ts
```

**期望**（Lead 独立复跑实测，端口 22927）：

```
Running 2 tests using 1 worker
  ✓  1 [msedge-zero] › …八步全走 + tar 里有真实数据行 (8.4s)
  ✘  2 [msedge-zero] › 回归：重新分列与 x_ticks 标定的存亡 › …x_ticks 必须仍然存在 (2.4s)
  2 passed (16.8s)      ← exit 0
```

> 第 2 条**故意**用 `test.fail()` 钉住已知缺陷 F-4：缺陷在则"预期失败"计入 passed；
> 一旦修好，它会以 `Expected to fail, but passed` 变红，**强制**把标注摘掉。
> 想按"已修复"的正向语义跑：加 `STRADITIZE_EXPECT_XTICKS_FIXED=1`。

复跑后把 trace 拷回文档目录：

```bash
cp frontend/test-results-22920-zero/journey-trace.json docs/findings/journey-trace.json
```

### 2.4 既有门禁（确认本次改动没破坏任何东西）

```bash
pixi run lint                                          # ruff + 11 项跨文件一致性
pixi run test                                          # 512 passed / 3 skipped / 92 subtests（Lead 实测 2026-10-23 03:4x）
STRADITIZE_E2E_PORT=22901 pixi run test-contract        # 5 passed（真实 Edge）
```

> ⚠️ 本节原写 `317 passed / 3 skipped`（2026-10-19 的基线），历经两次更正：先 `398`（10-23 00:0x），
> 再 **`512`**（10-23 03:4x，团队修复轮收口复跑，`512 passed, 3 skipped, 92 subtests passed in 702.01s`）。
> 两次数字均为 **Lead 在本机实测**，不是本文档作者自己跑出来的。
>
> **测试数演进（各数字均来自对应文档自述，非本次统一复跑）**：
> `317`（10-19 审计基线）→ `331`（`step6-ruler-assist.md`，+14）→ `342`（`fix-foreground-two-layer.md` / `qa-review-real-figure.md`）
> → `382`（`fix-cross-image-cleanup.md` / `fix-two-axis-layering.md`，+40）→ `398`（`impl-column-semantics.md` / `qa-column-semantics.md`）。
> 其中 382 与 398 与 Lead 实测 2026-10-23 的 398 **一致**；331 / 342 只出现在各自的阶段性文档里，未被本轮复跑。

### 2.5 复现具体缺陷（示例）

```bash
# Critical：进入步骤 6 时前端自己写入从未有人读过的刻度值
STRADITIZE_ZERO_PORT=22915 pixi run serve-zero &            # 零态后端（pixi 任务 serve-zero）
STRADITIZE_ZERO_PORT=22915 pixi run verify-f01              # 复跑 F-01（pixi 任务 verify-f01）

# P1：重分列抹掉 x_ticks 的触发条件表（判据是"列数是否变化"）
pixi run python scripts/lead_probe/xticks_wipe_threshold.py   # 阈值探针（三态输出，见 probe-index.md）

# P1：换图后旧几何在新图上继续剔除墨迹
pixi run python scripts/lead_probe/verify_f2_cross_image.py

# P1：重分列静默回滚后端已接受的 ROI
pixi run python scripts/lead_probe/verify_f1_roi_rollback.py
```

---

## 3. 方法：怎么"模拟人类操作"（这是本次的核心方法学）

### 3.1 为什么必须另起零状态基线

现有 70 项 e2e 全部跑在 `support/serve_e2e_backend.py` 上，而它**启动时**就：

```python
session.load_image(sample_key="hoya")                 # 预载范例图
session.detect_columns(HOYA_X_BOUNDS, HOYA_Y_BOUNDS)  # 预跑分列
```

后果：「打开文件」整条链路与「第一次运行」在整套测试里**零覆盖**。
所以本次另起 `support/serve_zero_backend.py`（不预载、不预跑），
**不动**既有基线（它被 70 项用例依赖）。

### 3.2 人怎么被"模拟"

| 环节 | 做法 | 为什么这样做 |
| :--- | :--- | :--- |
| 打开文件 | `page.waitForEvent('filechooser')` + 点 `#btn-open-file` | 走真实系统文件对话框 → `input.change` → `FileReader` → `core.loadImage`，整条前端链路真实执行 |
| 推进步骤 | 真实点击 `#btn-wf-next` 等按钮 | 不用 `gotoStage` 跳过业务动作（那会绕过被测逻辑） |
| 画布操作 | 真实 `mouse.down/move/up` 拖手柄 | 覆盖拖拽提交路径 |
| 输入 | 真实键盘逐字符 + `Enter` | `fill()` 会掩盖"聚焦重渲染导致输入框被替换"这类缺陷 |
| 判据 | 一律读**后端权威状态** | 读前端镜像会让"前端改了、后端没改"恰恰变绿 |

### 3.3 三条方法学纪律（本次实际抓到缺陷的原因）

1. **等待条件必须是被断言的那个量本身。**
   Lead 自己踩过：`page.waitForFunction(async () => …)` 传入 async 函数返回 Promise，
   **永远为真值**，于是根本没等待。教训与 `docs/testing-strategy.md` §4.2 一致。
2. **一次 RPC 可能分两阶段落地。**
   `core.loadImage` 先写 `width/height`、约 350ms 后才建 ROI。轮询"尺寸到位"就断言 ROI 数量，
   会得到与产品无关的红（该现象已登记为 F-3）。
3. **让数据穿过系统自身的重建路径再断言。**
   改完 ROI 再重新分列、标定后退回上一步再前进 —— 缺陷正是藏在这些"重建"里
   （F-1/F-4 都是这样抓到的）。

### 3.4 门禁自身的可信度（金丝雀）

一个从不失败的门禁等于没有门禁。journey-runner 做了两次**故意注入**再还原，确认用例真的会红：
① 让上传不打后端（伪造成功响应）→ 红在承重断言上；
② 让载入时偷偷预跑分列 → 红在"载入后绝不能自动分列"上。
两次注入后 `git diff --stat` 为空（Lead 已独立核实：**当前 `git diff --stat` 为空，零产品源码改动**）。

---

## 4. 本次发现的缺陷（摘要）

完整分级与证据见 [`bug-report.md`](./bug-report.md)；独立复核结论见 [`verification.md`](./verification.md)。

| 严重度 | 数量 | 代表 |
| :--- | :--- | :--- |
| **Critical** | **1** | 进入步骤 6 时前端**自己**写入从未有人读过的刻度值（字面量 `0` + 硬编码 `20`），实测改变 6362 个导出数值格、最大偏差 31.51 个百分点 |
| P1 | 2 | 挪 ROI 边界 ≥18px 即静默清空全部列的 `x_ticks`；换图后旧清理几何仍在新图上剔除墨迹（2400 px） |
| P2 | 4 | 前端旧 ROI 镜像可静默回滚后端改动；草稿恢复只写前端镜像；撤销不覆盖 `x_ticks`；重置必弹 `-32001` |
| P3 | 3 | 两标签页撕裂读（瞬时自愈）；`verification` 范例名残留；`loadImage` 半完成状态 |

合计 **10 条**（另有 1 条 `static F-06` 被 verifier **证伪**、8 条未验证假设，均不计入）。

> 计数口径：本表与 [`bug-report.md`](./bug-report.md) §1 的表逐行一致（Lead 用脚本核对过）。
> 注意 `bug-report.md` 里 `B-01` 合并了 journey-log F-1 与 static F-01/F-02/F-08 ——
> 那是**同一处代码**的多个侧面，不是多个缺陷；按缺陷本体计数才是 10 条。

**修复进度（2026-10-23 追补，本表是 10-19 的发现清单，不代表现状）**：

| 条目 | 现状 | 依据 |
| :--- | :--- | :--- |
| Critical（B-01 编造读数） | ✅ 已修 | [`software-issues-verified.md`](./software-issues-verified.md) §一.1：`calibrateXTicks` 请求数 8 → 0 |
| P1 换图后清理几何残留（B-03） | ✅ 已修 | [`fix-cross-image-cleanup.md`](./fix-cross-image-cleanup.md)：24 条 → 0 条，绕过清理仍剔除 0 px |
| P1 `x_ticks` 静默清空（B-02） | ❌ 未修 | [`software-issues-verified.md`](./software-issues-verified.md) §六「仍未修」 |
| P2 重置弹 `-32001`（B-07） / 旧 ROI 镜像回滚（B-04） / 草稿恢复只写前端（B-05） | ❌ 未修 | 同上；由本轮 frontend-fixer 认领中 |
| P3 并发无锁（B-08） | ❌ 未修 | 同上；由本轮 backend-fixer 认领中 |

> 中灰填充（原「问题 2」）不在上表 10 条内，但 10-20 已由双轴分层修复（覆盖率 0.0% → 100.0%），
> 见 [`fix-two-axis-layering.md`](./fix-two-axis-layering.md)。

---

## 5. 用户如何自证"没有偷懒"

按顺序做这 6 步，每步都有**期望输出**；任何一步不符即可判定本次工作有问题：

| # | 命令 | 期望 | 说明 |
| :--- | :--- | :--- | :--- |
| 1 | `git diff --stat` | **空输出** | 本次零产品源码改动（审计只报不改）。⚠️ **该期望只对 10-19 那轮审计成立**：截至 2026-10-23 03:4x，工作区有 30+ 个改动文件（10-19 → 10-23 全部修复**仍未提交**），故现在跑必然非空，不是回归 |
| 2 | `pixi run lint` | `一致性核对通过`，exit 0 | 11 项跨文件一致性 |
| 3 | `pixi run test` | `512 passed, 3 skipped, 92 subtests`（Lead 实测 2026-10-23 03:4x） | 既有后端测试无回归。⚠️ 原写 `317`（10-19 基线）→ `398`（10-23 00:0x）→ `512`（10-23 03:4x 收口） |
| 4 | `cd frontend && STRADITIZE_ZERO_PORT=22920 npx playwright test --config=playwright.zero.config.ts` | `2 passed`，exit 0 | 从零旅程可复跑 |
| 5 | `python -c "import json;d=json.load(open('docs/findings/journey-trace.json',encoding='utf-8'));print(len(d['steps']), d['steps'][8]['backend']['tar']['dataCsvRows'])"` | `9 111` | 9 步快照齐全；导出真有 111 行数据（不是空壳） |
| 6 | `pixi run verify-f01`（先 `pixi run serve-zero &`） | `"calibrateXTicks_请求数": 8` 且请求体里 `value` 恰为 `0` 与 `20` | 独立复现最严重的缺陷 |

**自查清单**（回答"这些是不是编的"）：

- [ ] 每份发现的**每条**都有"真实命令 + 真实输出"两段，不是"读代码觉得不对"。
- [ ] 查不清的条目单独列在"未验证假设"节，**不混进**已确认发现。
- [ ] 三份报告**互相独立**：journey-runner（走通）、bug-prober（破坏）、静态审计（只读），
      且存在**真实分歧**（见 §6）——分歧本身证明没有人抄别人。
- [ ] 至少一条发现被**独立复现两次**（Lead 与 verifier 各自用不同实现）。
- [ ] 至少一条**被推翻或降级**（bug-prober 把撕裂读降为 P3、把自己的 F-2 降为"未复现"）。
- [ ] 门禁做过**金丝雀注入**验证，确认它会红。

---

## 6. 报告之间的真实分歧（有价值的部分）

**同一段代码，两份报告给了不同定级** —— `frontend/src/services/InspectorBridge.ts:361-363`：

- `journey-log.md` F-1（P1）："自动提取刻度只标定 8/28 列，另外 20 列被静默跳过" —— 框架是**覆盖率不足 / 提示不够**。
- `static-audit.md` F-01（Critical）："前端**自己**为 8 列写入从未有人读过的刻度值" —— 框架是**伪造科研数据**，违反 §2。

两者不可能同时正确。Lead 独立复现支持 **Critical 框架**：

```
用户操作：只点了 5 次【下一步】，从未填过任何标定输入框
结果    ：后端收到 8 次 column.calibrateXTicks
          每个请求体的两个读数恰为字面量 value: 0 与 value: 20
根因    ：InspectorBridge.ts:361-363 的 `?? 0` / `?? 20`
          + WorkflowController.ts:204 的自动点击
          + session_parts/core.py:650,674 硬编码 tickValue: 20.0
```

即 F-1 的"少标定了 20 列"是表象；**真正严重的是"补上的那 8 列用的是编造读数"**。
该分歧的最终裁定见 [`verification.md`](./verification.md)。

---

## 7. 本次**没有**覆盖的范围（诚实声明）

| 未覆盖 | 原因 |
| :--- | :--- |
| 多 ROI 工程包的保存/载入往返 | 主线是"一个人从零做一份图"，只建一个 ROI |
| 步骤 4 的手工增删改几何与笔刷修正 | 旅程只走了"检测候选"；已有 `step4-cleanup.spec.ts` 覆盖 |
| OCR 属种名识别 | 需要模型与人工核对 |
| 年代-深度模型（Bacon/Bchron）从零路径 | 不在八步主线内 |
| 其它导出格式（XLSX / LiPD） | 旅程只验证 `.tar`（含 `data.csv`） |
| 离线/断网态、超限大图降采样分支 | 需构造特殊环境 |
| 真实扫描件（数千 px、粗分区线） | 只用内置两张教程图；静态审计登记为 U-05 |
| 并发**写**竞态是否真丢数据 | 6 组实验均无损，未能证实也未能证伪（登记为 H1） |

---

## 8. 修复优先级（详见 `static-audit.md` §7）

1. **先修 Critical**：`InspectorBridge.ts:361-363` 的 `?? 0` / `?? 20` 必须去掉 ——
   取不到读数就**拒绝标定并告知用户**，而不是填默认值（符合 §2"取不到就报错并停在原地"）。
2. **修 P1 清理状态残留**：`project_new`（`project.py:114`）与 `load_image`（`core.py:212`）
   都应调用 `self._init_cleanup()`；`support/serve_e2e_backend.py:51-63` 已证明这是正确做法，
   只是没进产品路径。
3. **修 P1 ROI 回滚**：`WorkflowController.ts:154-172` 不得用前端旧镜像构造分列参数。
4. **修 P1 x_ticks 静默清空**：守卫失败（刻度像素越出 `[start-10, end+10]`）时要么尽力迁移 `x_ticks`，要么**显式告知**用户标定已清空。
