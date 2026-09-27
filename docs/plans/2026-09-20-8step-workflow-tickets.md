# 8 步工作流重构：任务单（执行契约）v2

> **v2 重写原因**：v1 有六类结构缺陷（文件锁 DAG 自相矛盾、多单改 RPC 无文档拥有权、
> 跨单数据模型互相矛盾、契约留"择一"、探针无 ground truth、L4 不可复现）。
> v2 的解法不是"把并行约定写得更严"，而是**用扩展点让并行不需要共享文件**（§0.5）。

- **设计依据**：`2026-09-20-8step-workflow-redesign.md`（下称"设计稿"）
- **唯一数据契约**：`2026-09-20-frozen-contracts.md`（下称"**契约 v1**"）——**字段名一律以它为准**
- **验收人**：本会话（设计稿 §10 四层证据 + 红线）
- **执行者**：其他 agent。**一张单子一次交付**；未通过的单子不得被下游依赖。

---

## 0. 通用规则

### 0.1 四条门禁（缺一即退回）

```bash
pixi run lint
pixi run test
npm --prefix frontend run build
npm --prefix frontend test
```

L4 端到端另跑（新增任务，见 §0.6）：`pixi run test-e2e`。

### 0.2 六条红线（触任一条直接退回）

1. **编造数据**：面向用户的数字必须来自后端对真实输入的计算；取不到就报错并停在原地
   （`docs/ARCHITECTURE.md` §2/§9，守卫 `tests/test_no_fabrication.py`）。
2. **静默兜底**：把"未观测"写成"确定"（`?? 默认值`、`isCalibrated: true`、未标定填 0 …）。
3. **双份真相**：前端自算一套与后端并行的结果。
4. **破坏不变量**：平移手势（右键/中键/空格+左键三者等价）；ROI ≠ 标尺。
5. **改契约不同步文档**：字段名/参数名不得偏离契约 v1；偏离即退回（v1 已明确"单子不得自行发明字段"）。
6. **碰别人的东西**：改写 `HANDOFF.md` 他人那一节；提交构建产物/缓存/他人未提交修改；破坏性 git 操作。

### 0.3 交证据格式（每单末尾附）

```
改动文件：<列表，必须与"文件拥有权"完全一致，多一个即退回>
新增/修改测试：<文件 + 测试名>
L3 真实数据：<脚本路径 + 实际输出>
L4 端到端：<tests/e2e/test_xxx.py 路径 + 实际输出>
复现命令：<验收人可原样重跑的命令序列>
```

**不可复现的一律不算通过。**

### 0.4 证据的四层（设计稿 §10）

| 层 | 要求 |
| --- | --- |
| L1 门禁 | 四条门禁的**实际输出行**（不是"应该能过"） |
| L2 测试 | 针对本单行为契约的回归测试，且**能在旧实现上失败**（禁止内联副本复刻新逻辑） |
| L3 真实数据 | 在**指定图 + 指定 sha256** 上跑出的具体数字，与契约 v1 §7/本单预期可对照 |
| L4 端到端 | **提交的 Playwright 脚本 + 其实际输出**（不是截图） |

### 0.5 并行机制：扩展点 + **写权限表**（**v2.1 的核心**）

v1 的问题是多张单子写同一文件。v2.1 先在骨架波（W2/W3）建好扩展点，之后共享文件**按如下写权限表**约束：

#### 0.5.1 扩展点一览（接口见**契约 v1.1 §8.1**）

| 扩展点 | 建于 | 之后如何扩展 | 共享文件 |
| --- | --- | --- | --- |
| `straditize_core/rpc_methods/*.py` | W2 | 目录扫描自动注册；每模块暴露 `register(dispatcher, session)` | `rpc_server.py` 只调 `register_all` |
| `straditize_core/session_parts/*.py` | W2 | `Session` 由**固定 mixin 列表**组合；各特性只填自己的 mixin 文件 | `session.py` 不再改 |
| `frontend/src/components/steps/*Panel.ts` | W3 | `import.meta.glob` 自动注册；每模块导出 `{step, render, mount}` | `Inspector.ts`/`Sidebar.ts` 只做薄路由 |
| `frontend/src/components/canvas/*Overlay.ts` | W3 | `import.meta.glob`；每模块导出 `{id, z, draw}` | `GeologyCanvas.ts` 只调 registry |
| `tests/e2e/conftest.py` | W3 | 每特性加 `tests/e2e/test_<feature>.py` | — |
| `docs/plans/contract-fragments/<T>.md` | 每单 | 各写各的片段；**W6 一张单汇总** | 特性单**不碰**两份规范文档 |

#### 0.5.2 写权限表（**取代上一版的"只读"笼统说法**）

> 上一版写"此后 `types/pollen.ts`、`Inspector.ts`、`Sidebar.ts`、`main.ts`、`GeologyCanvas.ts` 只读"，
> 却在 W4 表里把 `Sidebar.ts` 给 T11、把 `GeologyCanvas.ts` 给 T13 —— **自相矛盾**。现改为逐文件明确：

| 共享文件 | W3 之后**仍可写**的单 | 边界 |
| --- | --- | --- |
| `frontend/src/types/pollen.ts` | **无人** | W3 必须**一次性**实现契约 v1 §2 的**全部**字段；W4 单只**读**类型 |
| `frontend/src/components/Inspector.ts` | **无人** | 薄路由；不得出现具体步骤名 |
| `frontend/src/main.ts` | **无人** | 组装与接线 |
| `frontend/src/components/Sidebar.ts` | **仅 T11** | W3 **保留**遗留按钮（▲/▼、批量导入）**不做删除**；T11 负责删干净 |
| `frontend/src/components/GeologyCanvas.ts` | **仅 T13** | W3 建好 overlay registry 调用与**新阶段表**；T13 只做工具条收敛与键位表同步 |
| `frontend/src/services/RpcClient.ts` | **无人** | W3 按契约 v1 §8 写全 |
| `straditize_core/session.py` | **无人** | W2 固定 mixin 列表 |
| `straditize_core/rpc_server.py` | **无人** | W2 改为 `register_all` |

**因此 W4 七张单的并行是真的**：每张只写**新文件 + 自己的测试 + 自己的契约片段**；
上表两个例外（`Sidebar.ts`→T11、`GeologyCanvas.ts`→T13）各只被一张单写。
`support/probe_truth/check_ticket_ownership.py` 机器校验这一点（见 §0.7）。

#### 0.5.3 依赖类别（**必须区分**，否则验收人会误判独立性）

| 类别 | 含义 | 例 |
| --- | --- | --- |
| **契约依赖** | 只依赖契约 v1 里已冻结的字段/方法，而这些由 **W2/W3** 落地 | T09 依赖 `x_ticks` 字段存在（W3 落地），但**不依赖 T07 的代码** |
| **实现依赖** | 依赖**某张 W4 单已验收通过** | v2.1 中 **W4 七张单之间不存在实现依赖** |

**每条"不依赖其他特性单"的表述必须写成"契约依赖（W2/W3 已落地），无实现依赖"。**

#### 0.5.4 L4 输出 grammar（**冻结**，见契约 v1.1 §8.1.4）

```
KEY=VALUE                 # 单值
KEY=[V1,V2,...]           # 列表
KEY=null                  # 缺省
```
`KEY` 匹配 `^[A-Z][A-Z0-9_]*$`；一行一个 KEY；同一脚本内不重复；
**禁止** `KEY=(a|b)` 这类元变量——枚举须在脚本里选定实际值再打印。

### 0.6 L4 端到端契约（**必须脚本化**）

- 端口：环境变量 `STRADITIZE_E2E_PORT`，未设则由 `conftest.py` 取空闲端口。
  **禁止占用或杀死用户的 8765**。
- 图像：脚本必须**断言当前会话图像的 sha256** 等于 `tests/probe_truth/index.json` 中登记的值；
  不等则 fail（防止拿别的图冒充）。
- 产物：脚本把观察值**打印成结构化行**（`KEY=VALUE`），验收人据此核对；
  截图只作辅助，**不作为通过依据**。
- 运行：`pixi run test-e2e`（新增 pixi 任务，W3 建立）。

### 0.7 机器校验（**发单前必须先跑通**）

```bash
pixi run python support/probe_truth/check_ticket_ownership.py
```

校验三件事：① W4 七张单的文件集合**两两不相交**；② §0.5.2 的两个例外文件（`Sidebar.ts`/`GeologyCanvas.ts`）
**未被其它单声明**；③ **无任何 W4 单声明 §0.5.2 里"无人可写"的文件**。
**校验不过，不得发单。**

---

## 阶段总览：文件锁 DAG

```
W0 探针（3 张并行；只读生产代码，只写 support/probe_*.py）
        │  结论必须回写契约 v1 §7
        ▼
W1 契约冻结（设计者；只改 docs/plans/2026-09-20-frozen-contracts.md）
        │
        ├──────────────────────────────┐
        ▼                              ▼
W2 后端骨架 + 模型（T01，串行）   W3 前端骨架 + 模型 + E2E 夹具（T02，串行）
        │                              │
        └──────────┬───────────────────┘
                   ▼
W4 特性（7 张并行，文件两两不相交 —— 见分配表）
   T05 清理后端/前端   T07 刻度   T08 采样   T09 QA   T10 导出
   T11 命名（独占 Sidebar.ts / ocr/engine.py）   T12 分层
                   │
                   ▼
W5 收口（T13：删 panels 残留、工具条按步、全量回归）
                   │
                   ▼
W6 文档合并（T14：contract-fragments → ARCHITECTURE / JSON_RPC_SPEC）
                   │
                   ▼
W7 验收（本会话按四层证据逐单核）
```

| 波 | 单 | 依赖 | 说明 |
| --- | --- | --- | --- |
| W0 | T00-a ⏸️延后 / **T00-b ✅已完成** / T00-c ✅已裁决 | — | T00-b 通过；T00-a 延后；T00-c 裁决剔除 D 类 |
| W1 | — | W0 完成 | **✅已完成**：冻结契约 v1.3，裁除 D 类，T12 延后 |
| W2 | T01 | W1 | **后 `session.py`/`rpc_server.py` 只读** |
| W3 | T02 | W1 | **后 `Inspector.ts`/`Sidebar.ts`/`main.ts`/`GeologyCanvas.ts`/`types/pollen.ts` 只读** |
| W4 | T05,T07,T08,T09,T10,T11（T12 延后） | W2+W3 | **六张并行**（T12 作为算法增强延后）；T11 与 T10 各独占一个文件 |
| W5 | T13 | W4 | 单线程收口 |
| W6 | T14 | W5 | 文档合并 |
| W7 | — | W6 | 验收 |

---

# W0 探针（3 张并行）

## 通用要求（T00-a / T00-b / T00-c）

- 只**读**生产代码（`import` 即可），**不得修改**任何 `straditize_core/` 文件；
- 只写：`support/probe_<name>.py`（探针本体）+ `tests/test_probe_<name>.py`（可复跑的断言）；
- **ground truth 只能读 `tests/probe_truth/`**，且这些文件**不由探针单生成**
  （拥有权见下表）——**探针作者不得自行标注**，否则等于自己判自己；
- **必须报敏感性/裕度**，不得调参到"刚好通过"；
- **允许得出"不可行"**——那是合格产出。

### T00 系列的 ground truth 工件与拥有权（**补上一版的缺口**）

| 工件 | 状态 | 拥有权 |
| --- | --- | --- |
| `support/probe_truth/gen_ground_truth.py` | **已存在**（本次会话产出，已在工作区） | **W1**（设计者）；探针单**只读** |
| `support/probe_truth/check_ticket_ownership.py` | **已存在**（同上） | **W1**；每次发单前必须跑通 |
| `tests/probe_truth/*.json`（含 `index.json`） | **已存在**（由上面的脚本生成，含图像 sha256） | **W1**；探针单**只读** |

> **上一版缺口**：文档说"探针作者不得自行标注"，却没指派谁标注。
> 现明确：**ground truth 与校验脚本属 W1（设计者）产出，探针单只读**。
> 若探针提出需要**新增** GT（如 T00-c 的 D 类），必须**回 W1** 申请，由 W1 生成后探针方可使用。

## T00-a exaggeration 分层

| 项 | 内容 |
| --- | --- |
| 问题 | 深浅两层能否**逐像素**稳定分离？ |
| 输入 | `tests/probe_truth/exaggeration_bell__exaggeration_layers.json`、`composite_cluster__exaggeration_layers.json` |
| 已知 | 契约 v1 §7 的五条事实（含"单阈值无解"的证明与裕度） |
| 通过判据 | 在**两张** exaggeration 图上，**按色相分组 + 组内双峰/聚类**后：<br>① 每个色系的 `true` 层保留率 **≥99%**；② `exag` 层混入率 **≤1%**；<br>③ 报告两层的**判别裕度**（灰度/色度间距）；④ 报告失败图型（若有）与降级路径 |
| 产出 | `support/probe_exaggeration.py`、`tests/test_probe_exaggeration.py`、结论段 |
| gate | **决定 T12 是否可开、范围多大** |

## T00-b 刻度线几何检测 —— ✅ **已完成并通过**（2026-09-20）

**产出**：`support/probe_x_ticks.py`、`tests/test_probe_x_ticks.py`
（**已入 `pixi run test`**，门禁 179 → **187 passed / 96 subtests**）。
结论已并入契约 **v1.2 §7.1**。

### 结果（gate 组 2 张）

| 图 | 组 | 自动条带 | 手动条带 | 召回 | 误检 |
| --- | --- | --- | --- | --- | --- |
| `type2_exaggeration_bell.png` | **gate** | `[907,916]` | `[907,916]` | **1.0000** | **0** |
| `type6_composite_zonation_cluster.png` | **gate** | `[839,848]` | `[839,848]` | **1.0000** | **0** |
| `type1_filled_silhouette_aber.png` | 非 gate | `None` | — | 如实报 0 | 0 |
| `hoya-del-castillo.png` | 非 gate | `None` | — | 如实报 0 | 0 |

逐列守卫（`n<2 → unusable 且带 reason`）通过；逐列间距中位均匀率 **1.0000**。

### 探针查出的 GT 缺陷（已修 `gen_ground_truth.py`）

v1 的条带规则只要求"列暗度双峰"，于是把**穿过条带的列基线**当成了刻度：

| 图 | GT v1 "刻度"数 | 实测中位游程 | 最大游程 | 真相 |
| --- | --- | --- | --- | --- |
| `filled_silhouette` | 35 | **64 px** | 333 px | **无刻度尺**（是列基线） |
| `hoya` | 13 | **149 px** | 1162 px | **无刻度尺**（是列基线） |

现规则追加"**每条笔画列的绝对竖直游程 ≤ 12px**"（短孤立笔画），两张图如实报
`has_tick_ruler=false` / 0 条。**给没有刻度尺的图编出刻度，正是本探针要抓的缺陷。**
→ **gate 组由 3 张改为 2 张**。

### 三条实现结论（已固化为测试，**勿重试**）

1. **候选条带不能按"笔画数"打分**：数据区每列基线在 9 行窗口内都是"窄短笔画"——
   bell 图数据区 **228** 条 vs 真刻度尺 **80** 条，按笔画数必然选中数据区。
   判据必须是**绝对竖直游程**（数据区 >12px、刻度尺 ≤12px）。
2. **2-D 连通域不可用**：刻度尺常有**连接横线**把所有刻度连成一个**超宽**分量，
   被宽度过滤全数拒绝（探针第一版因此一条都检不出）。必须用**逐列 1-D**。
3. **间距均匀性只在列内成立**：bell 间隔 `20,20,20,20,19,14,20,13,20,24`，13/14 在列边界
   ——刻度尺**逐列画**。全局 0.72/0.75，**逐列中位 = 1.0000**（GT 规则完全不使用间距，故这是独立佐证）。

### gate 结论

**T07 启用几何路径**（设计稿 §5.3.1 路径 ①）。冻结 API 保持原样：

```python
def detect_xticks(gray, band=None, *, tick_band_height=9, dark_threshold=160,
                  columns=None) -> dict
# 返回 {band, ticks, per_column:[{column_index, ticks, n, usable, reason}],
#        auto_band, spacing}
```
（`columns` 为可选追加参数，用于逐列分组与守卫；`band` 仍是"用户手动条带"的**唯一**模拟入口。）

## T00-c C/D 类（列内线）判据 —— ✅ **W1 裁决已完成（剔除 D 类）**

依契约 v1.3 §7.2 裁决：D 类（列内横线）从契约中正式删除（连带删 `kind:"D"`、T05 对应 D 类项），以保证主干工作流不受复杂列内先验拖慢。C 类列内竖线继续保留在 T05 范围中。

---

# W1 契约冻结（设计者，非执行单）—— ✅ **已完成（契约 v1.3）**

**文件拥有权**：`docs/plans/2026-09-20-frozen-contracts.md`、
`support/probe_truth/gen_ground_truth.py`、`support/probe_truth/check_ticket_ownership.py`、
`tests/probe_truth/*`。

**内容**

1. 契约 v1.3 已固化，结论写入其 §7。
2. **硬约束①（已完成）**：从契约中删除 `kind:"D"`。
3. **硬约束②（已完成）**：`T00-b` 已通过 → T07 **启用几何路径**；契约 v1.2 §7.1 已记录。
4. **硬约束③（已完成）**：T00-a 与 T12（Exaggeration 双层分离）延后（Deferred），优先跑通 8 步工作流闭环。
5. **硬约束④（已完成）**：扩展点接口（§8.1）与 L4 grammar 已在契约 v1.1 冻结。

**W2 及以后一律以该契约版本为准。** 本波不产产品代码。

---

# W2 后端骨架 + 多 ROI 模型（T01）

**目标**：建立**后端扩展点**并落地契约 v1 的模型；**此后 `session.py` / `rpc_server.py` 只读**。

**前置**：W1。

**文件拥有权（全部，之后不再由特性单修改）**

| 文件 | 动作 |
| --- | --- |
| `straditize_core/session.py` | 改为：核心状态 + 生命周期 + **固定 mixin 列表**（见契约 v1.1 §8.1.2） |
| `straditize_core/rpc_server.py` | 改为：静态服务 + 只调 `register_all(dispatcher, session)`；**不得出现任何具体方法名** |
| `straditize_core/rpc_methods/__init__.py` | 新增（`register_all`：`pkgutil.iter_modules` 扫描 + 逐个 `register`） |
| `straditize_core/rpc_methods/roi.py` | 新增（本单自己的方法） |
| `straditize_core/session_parts/__init__.py` | 新增 |
| `straditize_core/session_parts/{roi}.py` | 新增（本单自己的 mixin） |
| `straditize_core/session_parts/{cleanup,xticks,samples,layers,qa,export}.py` | **新增空占位 mixin**，由 W4 各单填充 |
| `tests/test_multi_roi.py` | 新增 |
| `docs/plans/contract-fragments/T01.md` | 新增 |

> **占位清单必须覆盖全部 W4 特性**（上一版漏了 `qa` 与 `export`）：
> W4 里 T09 要 `session_parts/qa.py`、T10 要 `session_parts/export.py`；
> 而 `session.py` 在 W2 之后不可改，**漏建 = 执行者只能违反只读或破坏分层**。
> 清单以契约 v1.1 §8.1.2 的组合列表为准：
> `CoreMixin, RoiMixin, CleanupMixin, XTicksMixin, SamplesMixin, LayersMixin, QaMixin, ExportMixin`。

**行为契约**（字段名一律见契约 v1 §2–§5，本单不得改名）

1. `DataRoi` 全字段 + `name_source` + `columns_stale`(per ROI) + `form_defaults`。
2. `Column`：`roi_id` + `x_ticks` + 逐列具体设置 + `mult_source`；
   **不得出现 `override` / 列级 `startValue`/`tickValue` / `scaleCalib`**。
3. `DiagramData`：`primary_roi_id` / `active_roi_id` / 四个扁平列表。
4. RPC：`roi.create|update|remove|list|setActive|setPrimary|applyFormDefaults`、
   `algorithm.detectColumns(roi_id)`、`column.update`（契约 v1 §8）。
5. **`applyFormDefaults` 是写动作**：逐字段写入该 ROI 全部列并返回 `changed` diff；
   **不建立任何继承关系**。
6. 校验规则按契约 v1 §5（重名/非法名 → `-32602`，**不自动加后缀**）。
7. **Y 标定保持全局**：任何 `roi.*` 调用不得触碰 `depth_calib`。
8. **`columns_stale` 只影响它所归属的 ROI**：改 ROI A 的清理不得让 ROI B 变脏。

**验收标准**

- `tests/test_multi_roi.py`：
  1. 建三 ROI（charcoal/pollen/concentration 的 x 区间），`detectColumns(roi_id=…)` **只改该 ROI 的列**，
     另两 ROI 的列**逐字段不变**；
  2. `applyFormDefaults` 写入后各列**字段值等于**表单值，且返回的 `changed` 条数 = 列数 × 字段数；
     再改表单**不影响**已应用的列（证明无继承）；
  3. 重名 / 含 `/` / 超 31 字符 → `-32602`；
  4. 删 ROI → 其列一并消失，其它 ROI 无影响；
  5. 标定后连续调 `roi.*` → `depth_calib` **逐字段不变**；
  6. `columns_stale` 为 **per-ROI**：设置 A 后 B 仍为 `False`；
  7. **扩展点自检**：`rpc_methods/__init__.py` 在 `rpc_methods/` 下新增一个临时模块后，
     其 `register` 被自动调用（用 monkeypatch 记录），**证明无需改 `rpc_server.py`**。
- **附加产出（必交）**：一份**"删除方法清单"**——W2 重构 `session.py` / `rpc_server.py` 时从旧文件里
  移走或删除的每个方法名 + 它移到了哪个 mixin/模块。验收人据此逐条确认**没有误删**
  （§0.3 要求"改动文件必须与拥有权一致"，但删掉的方法不在文件清单里）。
- **附加自检**：`python -c "import straditize_core.session"` 后，
  `StraditizeSession.__mro__` 里必须出现契约 v1.1 §8.1.2 列出的**全部 8 个 mixin**。
- L3：在内置 Hoya（sha256 `f94196e6…1c1f`）上建三 ROI，报出三者列数。
- L4：不适用（无 UI）；改由 W3 的夹具在 T02 验证。

**禁止**

- 不得保留 `override` / `effective_column_settings`（契约 v1 §3 已删除）。
- 不得让 `rpc_server.py` 出现任何具体方法名（否则特性单必须再改它）。

---

# W3 前端骨架 + 模型 + E2E 夹具（T02）

**目标**：冻结前端类型、建立**步骤/叠加层扩展点**与 **E2E 夹具**；
**此后 `types/pollen.ts`、`Inspector.ts`、`Sidebar.ts`、`main.ts`、`GeologyCanvas.ts` 只读**。

**前置**：W1。

**文件拥有权**

| 文件 | 动作 |
| --- | --- |
| `frontend/src/types/pollen.ts` | 按契约 v1 §2 冻结；**删除 `DiagramPanel`/`panels`/`activePanelId`** |
| `frontend/src/types/workflow.ts` | 8 步重排（设计稿 §1），**去导出阶段** |
| `frontend/src/services/RpcClient.ts` | 契约 v1 §8 的方法 |
| `frontend/src/core/Commands.ts` / `HistoryManager.ts` | 快照含 `rois`/`primaryRoiId`/`activeRoiId` |
| `frontend/src/components/steps/_registry.ts` | 新增（`import.meta.glob('./*Panel.ts')`） |
| `frontend/src/components/canvas/_registry.ts` | 新增（`import.meta.glob('./*Overlay.ts')`） |
| `frontend/src/components/Inspector.ts` | 改为薄路由：按 stage 取 registry 里的 panel；**移除 `Inspector.ts:886` 的"追加子有效区"按钮** |
| `frontend/src/components/Sidebar.ts` | 改为薄路由 + 步骤清单容器；**保留**遗留按钮（▲/▼、批量导入）**不做删除**——那属 T11 |
| `frontend/src/components/GeologyCanvas.ts` | render 时调用 overlay registry；`getAllowedTools` 按新阶段表 |
| `frontend/src/main.ts` | 组装 + 回调接线（含 `columnsStale` 提示入口） |
| `tests/e2e/conftest.py` | 新增（端口/哈希断言/浏览器夹具） |
| `tests/e2e/test_smoke.py` | 新增（步骤条 8 步、无导出阶段、**顶栏导出按钮仍在**、左栏随步切换） |
| `pixi.toml` | 新增 `test-e2e` 任务 |
| `frontend/test-roi-model.mjs` | 新增 |
| `docs/plans/contract-fragments/T02.md` | 新增 |

**行为契约**

1. 类型严格按契约 v1 §2；**不得自造字段**；`DiagramData` 上不存在 `panels`。
   **W3 必须一次性实现契约 v1 §2 的**全部**字段**（含 `Column.x_ticks`、`mult_source`、`name_source`、
   `primary_roi_id`、`per-ROI columns_stale`、四个扁平列表）——因为此后 **`types/pollen.ts` 无人可写**，
   T07/T09/T12 都只**读**它。
2. `getAllowedTools(stage)` 为唯一事实源；浮动工具条**只渲染当前阶段可用工具**。
3. 两个 registry 的模块接口按**契约 v1.1 §8.1.3** 实现（`{step, render, mount}` / `{id, z, draw}`）。
4. `HistoryManager` 撤销/重做必须同时还原 `rois` / `primaryRoiId` / `activeRoiId`。
5. E2E 夹具：`STRADITIZE_E2E_PORT`（默认取空闲端口）、启动后端、等 `/status`、
   断言 `/image/current` 的 sha256 与 `tests/probe_truth/index.json` 一致。
6. **遗留按钮保留**：`Sidebar.ts` 里的 ▲/▼ 与「批量导入」由 T11 删除，**W3 不动它们**；
   W3 只把 `Sidebar.ts` 改成薄路由 + 步骤清单容器。

**验收标准**

- `frontend/test-roi-model.mjs`（**直接 import 真 `.ts`**）：
  1. `'panels' in data === false`；
  2. `HistoryManager` push/undo/redo 一轮后 `rois`+`primaryRoiId`+`activeRoiId` 深比较还原；
  3. registry 的 glob 契约：临时放一个假 panel 模块能被收集到（用同一 glob 表达式断言）。
- **契约字段完整性自检（新增，防第一条类冲突复发）**：用脚本核对
  **契约 v1 §2 列出的每个字段名都能在编译后的类型定义里找到**（贴脚本与输出）。
  缺任一字段 → 本单不通过。
- L4：`pixi run test-e2e` 实跑 `tests/e2e/test_smoke.py`，输出必须是 §0.5.4 的 grammar，含
  ```
  IMAGE_SHA256=<与 index.json 一致>
  STEPS=8
  EXPORT_STAGE=absent
  TOPBAR_EXPORT_BUTTON=present
  SIDEBAR_TITLE_STEP1=<步骤1左栏标题>
  LEGACY_SWAP_BUTTONS=present
  LEGACY_BULK_IMPORT=present
  ```
  （后两项断言 W3 **没有**越权删 T11 的按钮）
- L1：四条门禁 + `pixi run test-e2e` 全绿。

**禁止**

- 不得让 `Inspector.ts`/`Sidebar.ts` 保留任何**具体步骤**的 UI 代码（否则特性单仍需改它们）。
- 不得改动 `types/pollen.ts` 之外的 RPC 契约。

---

# W4 特性（7 张并行）—— **文件分配表（零重叠）**

| 单 | 后端新增文件 | 前端新增文件 | 独占的既有文件 | 测试 | 契约片段 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| **T05** 清理 | `lines.py`, `session_parts/cleanup.py`, `rpc_methods/cleanup.py` | `steps/CleanupPanel.ts`, `canvas/CleanupOverlay.ts` | — | `tests/test_line_removal_v2.py` | `T05.md` | 契约（W2/W3）+ **T00-c 已通过** |
| **T07** 刻度 | `xticks.py`, `session_parts/xticks.py`, `rpc_methods/xticks.py` | `steps/XTicksPanel.ts`, `canvas/XTickOverlay.ts` | — | `tests/test_x_ticks.py` | `T07.md` | 契约（W2/W3）+ **T00-b 已通过** |
| **T08** 采样 | `session_parts/samples.py`, `rpc_methods/samples.py` | `steps/SamplesPanel.ts`, `canvas/SampleOverlay.ts` | — | `tests/test_sample_horizons.py` | `T08.md` | 契约（W2/W3） |
| **T09** QA | `qa.py`, `session_parts/qa.py`, `rpc_methods/qa.py` | `steps/QaPanel.ts` | — | `tests/test_qa_summary.py` | `T09.md` | 契约（W2/W3）**——依赖 `x_ticks` 字段存在，不依赖 T07 代码** |
| **T10** 导出 | `session_parts/export.py`, `rpc_methods/export.py`, `metadata/exporter_xlsx.py`, `metadata/exporter_lipd.py` | `steps/ExportReadinessPanel.ts` | **`components/PropertyPanel.ts`** | `tests/test_multi_roi_export.py` | `T10.md` | 契约（W2/W3）**——依赖 `primary_roi_id` 语义已由 W2 `roi.setPrimary` 落地，不依赖任何 W4 单** |
| **T11** 命名 | `rpc_methods/naming.py` | `steps/NamingPanel.ts` | **`components/Sidebar.ts`**（删遗留按钮）, **`ocr/engine.py`**（改归属） | `tests/test_label_snapping.py` | `T11.md` | 契约（W2/W3） |
| **T12** 分层 | `layers.py`, `session_parts/layers.py`, `rpc_methods/layers.py` | `steps/LayersPanel.ts` | — | `tests/test_exaggeration.py` | `T12.md` | 契约（W2/W3）+ **T00-a 已通过** |

**依赖类别**（按 §0.5.3）：上表所有"契约（W2/W3）"都是**契约依赖**；
**W4 七张单之间不存在实现依赖**——任何一张的通过都不以另一张的代码为前提。
唯一的外部前置是**已通过的对应探针**（T05←T00-c、T07←T00-b、T12←T00-a）。

**冲突说明**：`Sidebar.ts` 与 `PropertyPanel.ts` 各只被一张单碰（§0.5.2 的写权限表）；
其余文件要么是新文件，要么在 W2/W3 后不可写。**因此七张单可真正并行。**

---

## T05 清理：四类判据 + 候选线 + 排除区

**前置**：W2+W3；**且 T00-c 已通过**（若 T00-c 判定 D 类不可做，本单按契约 v1 的修订版**不做 D**）。

**行为契约**（字段见契约 v1 §2.4；判据见设计稿 §3.1）

1. `detect_line_candidates(ink, roi, columns=None, *, line_fraction, line_width_min, line_width_max)`
   → `List[LineCandidate]`（**只返回候选，不返回掩膜**）。
   两个独立旋钮；`line_width_max` 关闭时不过滤上限；**竖线在启用上限时必须 ≤2px**。
2. `detectXTicks` 之外**不得**在本单里做刻度相关逻辑。
3. 掩膜合成严格按契约 v1 §6 的公式与优先级（`exclusion` 作用于 `ink`，与 `line_mask` 不同对象）。
4. `LineMaskStroke` 复用 `image.py: rasterize_strokes` 的既有结构（**不许新造字段**）。
5. `Roi.columns_stale` 由本单置位；**只置所属 ROI**。
6. 叠加层四色：白=保留 / 红=A+B / 黄=C+D / 灰斜纹=排除区。

**验收标准**

- `tests/test_line_removal_v2.py`：
  1. 合成图分类**恰好** `A=1,B=1,C=2,D=0`；
  2. 钟形实心区被误删 **≤5 px**；
  3. 只选 A 时 B/C 像素**一个不少**；
  4. `line_width_max=2` 时 3px 竖线**不入候选**；关闭上限时入候选；
  5. **排除区绝对优先**（契约 v1.1 §6.1）：把排除区盖在某候选线上，`final_ink` 在该区域**全为 0**；
     再在同一区域加 `restore` 笔迹，**结果仍为 0**（restore 救不回）；
     同时断言 UI 层会**拒绝或提示**该笔迹（不得静默无效）；
  6. **真实 Hoya 回归**（sha256 `f94196e6…1c1f`）：`line_fraction 0.75/0.30`、`width 1..2`
     时 A 类 **0 行**、B 类 **4 列**；Pinus 列（x 490–660）剔除比例 **<1%**；
  7. `columns_stale` 只置所属 ROI。
- L3：上表六条的实际数字。
- `tests/e2e/test_cleanup.py` 输出必须符合 §0.5.4 grammar，例：
  ```
  CANDIDATES_A=0
  CANDIDATES_B=4
  RED_PIXELS_BEFORE=342
  RED_PIXELS_AFTER_DESELECT=77
  EXCLUSION_REGION_PIXELS=1024
  RESTORE_INSIDE_EXCLUSION_EFFECTIVE=false
  ```

---

## T07 X 轴标定：几何优先 + 两刻度端点 + 显性可见

**前置**：W2+W3；**T00-b 已通过（契约 v1.2 §7.1）→ 启用几何路径**。

**行为契约**（字段见契约 v1 §2.3/§4；设计稿 §5.3）

1. `x_ticks` 是标度**唯一事实源**；构造公式见契约 v1 §4（**不得假设列基线 = 0**）。
2. 几何路径：`algorithm.detectXTicks(roi_id, band?)` → `{band, per_column:[{column_index, ticks, n}]}`；
   `n < 2` → 明说不成功。
3. `px_per_unit` **只作提示**，UI 文案必须含"**离群未必是错——不同列可以用不同刻度区间**"；
   **严禁**据此判错/纠正/阻断。唯一可靠的自动检查是"刻度端点落在列边界外 → 疑似分列切错"。
4. 三级可见性 + 「标定总览」；同 ROI 其它列显迷你刻度齿。
5. **标定态自动隐藏去线叠加层与排除区遮罩**（设计稿 §5.7）。
6. 检测到的刻度线**画在画布上**，逐列显示"检测到 N 条刻度"。

**验收标准**

- `tests/test_x_ticks.py`：
  1. 两端点任意顺序都可建立正确映射；像素相同 → 拒绝；越界 → 拒绝；
  2. **刻度区间值不同**（5 与 10）的两列 `px_per_unit` 差 2 倍**且不报警**；
  3. `n_ticks == 1` → 拒绝并提示；
  4. **不假设列基线 = 0**：构造"第一刻度 ≠ 0 且基线不在刻度序列上"的用例；
  5. **固化旧公式会误报**：断言 `tickValue/列宽` 对 2 区间列与 7 区间列给出 **0.606 vs 0.490**
     （差 >20%），且**该量不得出现在任何校验路径**（用 grep 断言源码中无此式）。
- L3：用 `tests/probe_truth/exaggeration_bell__x_ticks.json`（65 条刻度），
  以"起始 10 / 步长 10"推出全部列的 `x_ticks`，报出各列 `value` 与 `px_per_unit`。
- L4：`tests/e2e/test_xticks.py` 输出符合 §0.5.4 grammar：
  ```
  TICKS_BAND=[905,914]
  COL4_BADGE=0-20
  COL15_BADGE=0-40
  COL7_BADGE=0-70
  OVERLAY_HIDDEN_IN_CALIB=true
  OUT_OF_BOUNDS_REJECTED=true
  TICKS_ZERO_COLUMNS=0
  ```

---

## T08 采样层位

**前置**：W2+W3。

**行为契约**（字段见契约 v1 §2.5）

1. `samples.set|list|clear(roi_id)`；`depth` 未标定必须为 `null`；`source` 必须存活到导出。
2. 『自动识别』接**已有** `algorithm.extractHorizonConsensus`，产出项 `source='auto'`。
3. 图上编辑：每层一条水平线，左键拖 / **右键单击删** / Shift+左键加；
   右键**拖拽**仍是平移（不变量，见红线 4）。
4. 导出就绪清单与元数据中必须注明行轴来源。

**验收标准**

- `tests/test_sample_horizons.py`：
  1. Hoya 上识别层位 > 0 且落在 ROI 的 y 内；
  2. `set`/`list` 逐字段一致；`clear` 后为空；
  3. **未标定 → `depth is None`**（断言不是 0）；
  4. 标定后与 `CoordinateSystem` 换算交叉一致；
  5. `source == 'auto'` 且能在导出的就绪清单/元数据里找到该标记（**不得丢失**）。
- L4：`tests/e2e/test_samples.py` 输出符合 §0.5.4 grammar：
  ```
  HORIZONS_AUTO=74
  AFTER_DRAG_DEPTH=132.5
  AFTER_RIGHTCLICK_COUNT=73
  ```

---

## T09 校验后端 `qa.summarize`

**前置**：W2+W3。**依赖类别**：契约依赖——依赖 `x_ticks` **字段已由 W3 落地**，
**不依赖 T07 的代码**（本单测试自行在 session 对象上设 `x_ticks` 即可）。**无实现依赖。**

**行为契约**（字段见契约 v1 §2.7；语义见设计稿 §6.2）

1. `declared_max` 必须由契约 v1 §4 的 **`declaredMax(col)` 派生**，
   **不得**读任何"存起来的满刻度值"（v1 已删除该字段）。
2. `composition == False` → 不做 `>100%` 判定（`violations_over` 为空），但仍返回 `sum`。
3. `sum` 统计**必须包含全零层位**；全零层位单独列在 `empty_horizons` 并带 `reason`。
4. 三层语义：🔴 `sum > 100+tolerance` / 🟡 单列峰值 > `declared_max` / ⚪ `shortfall` 与空层位（信息，不报警）。

**验收标准**

- `tests/test_qa_summary.py`：
  1. 层位 `Σ = 96, 103.5, 0` → `violations_over` **恰好**含 103.5；`empty_horizons` **恰好**含 0；
  2. `composition=False` 且值 48000 → `violations_over` 为空，`sum` 如实返回；
  3. 某列峰值 108 > `declared_max` 100（由 `x_ticks` 派生）→ 该列 `over=True`；
     **并断言该判断不依赖任何存储字段**（改 `x_ticks` 后 `declared_max` 随之变）；
  4. 空 ROI → 结构完整、计数为 0，不抛异常也不编数；
  5. `tolerance` 生效：`101.0 / 2.0` 不违规，`101.0 / 0.5` 违规。
- L3：Hoya pollen ROI 上跑一遍，报 `N_HORIZONS / SUM_MIN / SUM_MAX / SHORTFALL_MEAN / N_EMPTY`。
- L4：`tests/e2e/test_qa.py` 输出符合 §0.5.4 grammar：
  ```
  BANNER_LEVEL=red
  N_HORIZONS=76
  SUM_MAX=103.2
  SHORTFALL_MEAN=4.0
  N_EMPTY=2
  ```

---

## T10 导出：每 ROI 一张表

**前置**：W2+W3。**依赖类别**：契约依赖——依赖 `primary_roi_id` 的语义**已由 W2 的 `roi.setPrimary` 落地**，
**不依赖任何 W4 单**。**无实现依赖。**

**行为契约**（契约 v1 §2.6 的 `primary_roi_id`；设计稿 §4.2）

1. `.tar`：`data/<roi名>.csv` 每 ROI 一份；**`data.csv` 用 `primary_roi_id`**（**不得**隐式取第一个或活动 ROI）。
2. XLSX：每 ROI 一张 sheet，sheet 名 = ROI 名。
3. LiPD：`paleoData[*].paleoMeasurementTable[*].tableName = ROI 名`（替换硬编码 `"pollen_data"`）。
4. `plot_strat.R`：每 ROI 一段。
5. 就绪清单在**导出对话框**（`PropertyPanel.ts` 内）逐项列出；判断"是否已命名"读
   `DataRoi.name_source`（**不得**靠"名字是否等于 pollen"猜）。
6. **导出入口是既有顶栏按钮**（T02 只删了工作流里的"导出阶段"，未删该按钮）——本单**不得**新增或移动入口。

**验收标准**

- `tests/test_multi_roi_export.py`：
  1. 两 ROI → XLSX 的 sheet 名集合**恰好**等于 ROI 名集合（`openpyxl` 读回）；
  2. LiPD 的 `tableName` 集合恰好等于 ROI 名集合；
  3. `.tar` 内有 `data/<roi>.csv` 且 `data.csv` 存在；`data.csv` 内容 = `primary_roi_id` 那份（**改主 ROI 后内容随之变**）；
  4. 每个 CSV 的列名**不含 ROI 前缀**；
  5. ROI 名为中文（`花粉`）时 sheet 名与文件名都正确。
- L3：三 ROI 导出，报 sheet 名列表、LiPD tableName 列表、`data/` 清单。
- L4：`tests/e2e/test_export.py` 点**顶栏导出按钮**（其存在性由 W3 的 `test_smoke.py` 的
  `TOPBAR_EXPORT_BUTTON=present` 保证）→ 输出符合 §0.5.4 grammar：
  ```
  SHEETS=[pollen,charcoal,concentration]
  PRIMARY_ROI=pollen
  DATA_CSV_EQUALS_PRIMARY=true
  READINESS_MISSING=[concentration]
  ```
  （未命名的 ROI 必须出现在 `READINESS_MISSING` 里）
- **禁止**静默改名冲突 ROI；无列 ROI **必须在就绪清单里列出**而非静默跳过。

---

## T11 命名：OCR + 区间归属

**前置**：W2+W3。**独占** `Sidebar.ts` 与 `ocr/engine.py`。

**行为契约**

1. **`_snap_labels_to_columns` 改为区间归属**（契约 v1 §8）：
   标签取 `anchor_x`，落在 `[startX, endX)` 者归属该列；**数量不一致不做配对**；
   返回三类对账 `columns_without_label` / `labels_without_column` / `ambiguous`。
   **删除**贪心最近邻 + 45px 绝对阈值 + `used_col_indices` 独占。
2. **删除**左栏 ▲/▼ 与批量导入：`openPasteTaxaModal`、`onBatchImportTaxa`、`batchUpdateTaxa` 调用路径、
   `onSwapTaxaNames` 与 `main.ts` 处理器。
   **`PollenGlossary` 纠错能力保留**（OCR 审核仍用）；后端 `core.batchSetTaxa` 是公共 API，**不删**，
   但在契约片段里注明"前端已不使用"。
3. 列名唯一性按契约 v1 §5（重名报错、不加后缀）。
4. **OCR 整体失败的兜底是"逐列点名"，不是顺序配对**：左栏列出**全部列**（x 升序），
   每列一个输入框，**输入框绑定 `column.id`**；获得焦点时画布高亮该列。
   因此每个名字都是**对着可见的列**输入的，**不含任何顺序假设**。

**验收标准**

- `tests/test_label_snapping.py`：
  1. 标签数 = 列数且一一落区间 → 全部正确；
  2. **标签数 ≠ 列数**（少 1 / 多 1）→ **不配对**，三类对账内容正确；
  3. 一个标签横跨两列 → 归 `anchor_x` 所在列并进 `ambiguous`；
  4. 标签在列范围外 → 进 `labels_without_column`；
  5. **顺序无关性**：把同一批标签**打乱顺序**输入，输出**逐字段相同**（直接锁死旧实现的顺序敏感）；
  6. 重名列 → `-32602` 并指出冲突列。
- `grep -rn "onSwapTaxaNames\|swap-up\|swap-down\|openPasteTaxaModal\|onBatchImportTaxa" frontend/src`
  **无结果**（贴命令与输出）。
- L4：`tests/e2e/test_naming.py` 输出符合 §0.5.4 grammar：
  ```
  LABEL_ASSIGN=[label_001=col_3,label_002=col_4]
  WITHOUT_LABEL=[col_7]
  WITHOUT_COLUMN=[]
  SEQUENTIAL_MODE_HIGHLIGHT=col_7
  ```

---

## T12 exaggeration 分层与倍数管理

**前置**：W2+W3；**且 T00-a 必须已通过**。若 T00-a 得出"某类图型做不到"，本单范围相应收缩为
"支持可做的图型 + **明确拒绝**其余"，并把拒绝路径写成测试。

**行为契约**（契约 v1 §2.3 的 `exaggeration_mult`/`mult_source`）

1. **禁止**单一全局阈值：按色相分组 → 组内双峰/聚类定阈 → 返回**真实层/放大层各自的 mask**。
2. `exaggeration_mult` 由用户确认或由分层结果推断，**必须记 `mult_source`**（`user`|`inferred`）；
   **不得静默猜倍数**。
3. 进导出元数据（供审稿审计）。
4. 与 `qa.per_column_max` 的越界告警**联动**（倍数搞反是该告警的典型成因）。
5. 分层失败 → **报错并停在原地**；**不得**回落成"用全部墨迹当数据"（红线 2）。

**验收标准**

- `tests/test_exaggeration.py`（输入 sha256 必须与 `tests/probe_truth/index.json` 一致）：
  1. 在 **bell + composite** 两张图上，每色系 `true` 层保留率 **≥99%**、`exag` 层混入率 **≤1%**；
  2. **固化"单阈值无解"**：断言"在扫描范围内**不存在**满足 `true_yellow 保留>95% 且 exag_green 混入<5%`
     的阈值"——即对 `thr` 全扫描后断言**解集为空**（不是写一句 `assertFalse(...)`）；
  3. `true_yellow` 保留率从当前 **0.0%** 提升到 **≥99%**（对照值写进测试注释）；
  4. 分层失败路径：两层同色系的构造图 → **必须报错**；
  5. `mult_source` 两条路径取值正确。
- L3：四层保留/混入百分比与裕度。
- L4：`tests/e2e/test_layers.py` 输出符合 §0.5.4 grammar：
  ```
  TRUE_LAYER_PX=45539
  EXAG_LAYER_PX=21330
  MULT_SOURCE=user
  ```

---

# W5 收口（T13）

**前置**：W4 全部通过。

**文件拥有权**：`frontend/src/components/steps/_registry.ts`（若需排序）、
`frontend/src/components/Toolbar.ts`、`frontend/src/components/GeologyCanvas.ts`、
`docs/plans/contract-fragments/T13.md`；以及**删除** W3 留下的 `panels` 残留（若有）。

**内容**

1. 工具条按阶段收敛（与 `getAllowedTools` 一致）；键位表与 `docs/ARCHITECTURE.md` 一致。
2. 全量回归：四门禁 + `test-e2e` 全绿；跨特性交叉检查（例：改清理 → `columns_stale` →
   刻度面板是否提示重分列）。
3. **不做新功能**。

**验收标准**：四门禁 + `test-e2e` 全绿；贴出**跨特性交叉用例**的实际输出。

---

# W6 文档合并（T14）

**前置**：W5。

**文件拥有权**：`docs/ARCHITECTURE.md`、`docs/JSON_RPC_SPECIFICATION.md`、
`docs/tutorials/01_quickstart.md`、
**新增** `docs/plans/contract-fragments/_merge_map.csv`、
**新增** `support/check_merge_map.py`。
`docs/plans/contract-fragments/T01..T13.md` **只读**。

**内容**：把各片段合并进两份规范文档 + 教程，并产出**机器可校验**的映射表。

**映射表格式（冻结）** `docs/plans/contract-fragments/_merge_map.csv`

```csv
fragment_file,fragment_line,spec_file,spec_line
T01.md,12,docs/JSON_RPC_SPECIFICATION.md,320
T01.md,13,docs/JSON_RPC_SPECIFICATION.md,321
```

- 表头固定为上述四列，顺序固定；路径相对仓库根；行号从 1 起；
- **每个片段行必须恰好出现一次**（无遗漏、无重复）；
- 片段里**非契约内容**（说明、理由）允许映射到 `spec_file=SKIP`（仍须有一行），
  以证明"无遗漏"是逐行核对而非抽样。

**验收标准**

- `pixi run python support/check_merge_map.py` 通过（校验：覆盖全部片段行、无重复、
  `spec_file` 存在、`spec_line` 在文件行数内、`SKIP` 行必须给出理由列——故 CSV 增列
  `skip_reason`，仅 `SKIP` 行非空）。
- **双向核对**：契约 v1 §2/§8 里的每个字段名与方法名都能在规范文档里 grep 到；反之亦然（贴命令与输出）。
- 合并后 `pixi run lint` 仍绿；`npm --prefix frontend run build` 仍绿（证明文档改动未破坏仓库）。

---

# W7 验收（本会话）

按 §0.4 四层证据逐单核；退回时给出**具体不合格层 + 复现命令**。
单子通过后，验收人在该单末尾**追加一行**（只追加，不改写执行者原文）：

```
✅ 验收通过 <日期> <commit>
❌ 退回 <日期> <不合格层> <原因摘要>
```
