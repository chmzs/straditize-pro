# 动态对抗性探针报告（零状态 → 八步 → 导出）

> 任务：task-2。角色：adversary（主动找缺陷并留证）。
> 写作用域：本文件 + `scripts/zero_flow_probes/`。**未修改任何产品源码**。
> 探针语言：Python（`pixi run python`）+ Node（`playwright` 库 API）。

> ⚠️ **Lead 追加更正（2026-10-19，经 verifier 独立复核 + Lead 亲自复验）**
> 本文件 **F-3** 对"重分列抹 `x_ticks`"的判据（"阈值 ≈ 列边界外 10px / 落在 (15,20)"）
> **方向对、数值偏大 2px**：逐像素扫描显示首次被抹在 **Δ=18**（此时列数仍是 28→28），
> 首次列数变化要到 Δ=22。真判据是**区间守卫越界**（`core.py:736-746`），列数变化只是伴随现象。
> 另：**F-1（ROI 回滚）的可达性被部分推翻**，已由 P1 降为 **P2**
> （UI 主路径 `RoiToolStrategy.ts:74 → main.ts:273 → CleanupManager.ts:148` 会同步前端镜像，
> 本文件的实测用 `page.request` 直调绕过了 `commitRoi`）；其引用的 §6:174-175 亦应改引 §2。
> 结论以 [`bug-report.md`](./bug-report.md) **B-02 / B-04** 为准。

---

## 0. 环境与一键复跑

```bash
# 1) 起零状态后端（不预载 hoya、不预跑 detect_columns）
pixi run python scripts/zero_flow_probes/zero_backend.py --port 22940

# 2) 后端侧探针 —— 每条都可单独跑，输出即证据
#    ⚠️ probe_p2 (F-4 零状态场景) 要求后端**刚启动且从未被用过**；否则脚本会如实跳过并说明。
pixi run python scripts/zero_flow_probes/probe_p2_reset.py             22940
pixi run python scripts/zero_flow_probes/probe_f3_xticks_threshold.py  22940   # F-3 阈值
pixi run python scripts/zero_flow_probes/probe_p6b_cross_image.py      22940   # F-2
pixi run python scripts/zero_flow_probes/probe_p6_project_new.py       22940   # F-5
pixi run python scripts/zero_flow_probes/probe_p3_concurrency.py       22940   # F-6
pixi run python scripts/zero_flow_probes/probe_p4_write_race.py        22940   # F-6 反面
pixi run python scripts/zero_flow_probes/probe_p5_draft.py             22940   # H-草稿分叉
pixi run python scripts/zero_flow_probes/probe_p7_roundtrip.py         22940   # 往返保真
pixi run python scripts/zero_flow_probes/probe_p1_xticks_wipe.py       22940   # 同 bounds 对照（见下）

# 3) 真实 Edge 里的 UI 探针
cd frontend
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_roi_rollback.cjs       # F-1
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_no_timer_rollback.cjs  # F-1 对照
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_control_nobrowser.py   # F-1 对照（无浏览器）
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui1_reset             # F-4/F-5 UI
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui5_two_tabs          # F-6 两标签页
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui6_two_tab_write     # F-6 反面
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui7_xticks_ui         # F-1+F-3 串联
```

> `probe_p1_xticks_wipe.py` 用的是**相同 bounds** 重分列，因此它正确地报告
> "x_ticks 未被抹"——这正是"只跑一条脚本会得出与代码注释相反的错误结论"的实例。
> 判据必须看 `probe_f3_xticks_threshold.py` 的阈值表。

环境：Windows 11 / Git Bash / pixi（Python 3.12）/ Node v24.21.0 / 系统 Edge。
配置隔离：`STRADITIZE_CONFIG_PATH` 指到临时目录，**未触碰** `~/.straditize/config.json`。
端口：22940（本任务独占 22940–22950）。

### 0.1 探针自身踩过的两个坑（写下来避免后来者重踩）

1. **`e2e.reset` 必须在 `project_new` **之前** 先 `_init_cleanup()`。**
   `StraditizeSession.__init__`（`straditize_core/session.py:60-190`）**不创建**
   `line_candidates` / `exclusion_regions` / `line_strokes` 这三个属性；
   它们只由 `CleanupMixin._init_cleanup()`（`session_parts/cleanup.py:79-91`）创建。
   而 `project_new` 之后的残留检查会读它们 → `AttributeError`。
   这就是 `support/serve_e2e_backend.py:63` 那句 `session._init_cleanup()` 为什么存在。
   → 本探针的 `zero_backend.py` 先 `_init_cleanup()` 再 `project_new()` 再 `_init_cleanup()`。

2. **`frontend/e2e/` 对我的任务只读**，所以 UI 探针不能用 `@playwright/test` 的 spec 形式：
   - 放在 `frontend/e2e/` 外做 spec → Playwright 以 CJS 加载，`import.meta.url` 直接
     `SyntaxError: Cannot use 'import.meta' outside a module`；
   - `import … from '@playwright/test'` → `Cannot find module`（本目录与 `frontend/`
     不在同一 package 边界）；
   - 给本目录加 `{"type":"module"}` → 反过来让解析跑出 `frontend/node_modules`。
   → 改用 `require(require.resolve('playwright', {paths:['<repo>/frontend']}))` 的库 API
     （`chromium.launch({channel:'msedge'})`），见 `driver.cjs`。

---

## 1. 发现汇总表

| ID | 严重度 | 一句话 | 用户可达路径 | 违反不变量 |
|---|---|---|---|---|
| **F-1** | **P1 高** | 点【下一步】重新分列时，前端把自己的**旧 ROI 镜像**当作权威传给后端，**静默回滚后端已接受的 ROI 改动** | 步骤 2 改 ROI → 步骤 5 重分列 | §2（数据来源）、§6（ROI≠标尺且两端不得互相兜底） |
| **F-2** | **P1 高** | 切图（`core.loadImage`）**不清** `line_candidates`，上一张图确认过的几何在**新图上继续剔除墨迹** | 载图 → 步骤 4 确认几何 → 换另一张图 | §7.1（几何是 ROI 内像素矩形）、§9-9 |
| **F-3** | **P2 中** | 重新分列在列边界守卫越界时**静默抹掉 `x_ticks`**；阈值 ≈ 列边界外 10px，用户无法预知 | 步骤 6 标定 → 步骤 2 缩 ROI ≥20px → 步骤 5 重分列 | §6.0（重新分列"数值保全"）、§9-4 |
| **F-4** | **P2 中** | 工具栏【重置全部操作】**必然**触发一条 `-32001` 失败并弹红框（后端 `project.new` 清零 ROI，前端随后按旧 id 重算掩膜） | 载图后点【重置全部操作】 | §2（后端失败必须冒泡——此处是"必然失败"，属错位诊断） |
| **F-5** | **P2 中** | `project.new` 不清 `line_candidates` / `line_strokes`；新建项目后残留 24 条几何 + 1 笔笔迹 | 步骤 4 编辑后点【重置】 | §2、§9-9 |
| **F-6** | **P3 低** | 无锁共享会话：两标签页并发读会拿到撕裂态（有图宽、`rois: []`）。**瞬时自愈**，单标签页测不出 | 开两个标签页，一页切图 / 上传，另一页刷新 | 不构成 §3 的"多人"违反（判定见 F-6 详证末节） |
| **F-7** | **P3 低** | `FileLoaderService` 仍保留 `verification` 范例名映射，但 `Toolbar` 已删该 option；直调 RPC 必得 `-32004` | 仅 agent / 直调可达 | 不违反（已降级为文档残留） |
| **F-8** | **P2 中** | 自动存档草稿【恢复】**只写前端镜像、不回灌后端**；恢复后界面有 28 列而后端 0 列，下一步动作即报错 | 关页/另一标签页重置后重开，点草稿横幅的【恢复】 | §2（数据只能来自后端真实计算） |

已排查但**确认无问题**的见第 5 节。

---

## 2. 逐条详证

### F-1（P1）重新分列静默回滚后端 ROI

#### 症状

用户在步骤 2 把取数区调小，**后端已接受**（`roi.update` 返回 `success: true`，
紧接着回读 `rois[0].xlim` 是**新值**）。随后在步骤 5 点【下一步】重新分列，
ROI 被**改回旧值**，且**没有任何提示**。用户看到"分列成功"，
实际分列用的是**旧的**取数区。

#### 最小复现（真实 Edge，每步回读后端）

```bash
cd frontend
STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_roi_rollback.cjs
```

真实输出（逐字粘贴）。探针在**每一步之后**都回读后端 `rois[].xlim`，
因此"哪一步改的"是可判定的，不是推测：

```text
  boot: 后端 ["roi_1:[315,1946]"]
  gotoStage(6): 后端 ["roi_1:[315,1946]"]
  UI 标定后: 后端 ["roi_1:[315,1946]"]
  roi.update 后: 后端 ["roi_1:[355,1906]"]      ← 后端真的接受了新 bounds
  gotoStage(4) 后: 后端 ["roi_1:[355,1906]"]    ← 切步骤不影响
  点【下一步】(重分列) 后: 后端 ["roi_1:[315,1946]"]  ← 被静默回滚
  前端 rois = [[315,1946]] | legacyRoi = {"xMin":315,"xMax":1946,"yMin":511,"yMax":1311}
```

**排除"后台定时器在回滚"这一竞争解释**（6 轮，每次改完等 400ms 回读）：

```bash
cd frontend && STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_no_timer_rollback.cjs
```
```text
  第1轮 set=[310,1990] 返回=[310,1990] 400ms后=[310,1990] OK
  ...
  第6轮 set=[360,1940] 返回=[360,1940] 400ms后=[360,1940] OK
>>> 回滚轮数 = 0 /6
```

→ 单次 `roi.update` 可靠；覆盖发生在**点击【下一步】重分列**那一刻。

对照：**不起浏览器**时同一步骤的 ROI 不会被回滚（说明不是后端自身行为）：

```bash
pixi run python scripts/zero_flow_probes/probe_f1_control_nobrowser.py
```
```text
初始 xlim = [315.0, 1946.0]
roi.update 后 xlim = [355.0, 1906.0]
detectColumns(新bounds) 后 roi xlim = [355.0, 1906.0] | data_xlim = {'xMin': 355.0, ...}
```

#### 根因（file:line）

`frontend/src/services/WorkflowController.ts:154-172`：

```ts
const rois = this.canvasComponent.data.rois || [];
if (rois.length > 0) {
  for (const r of rois) {
    const xMin = r.xMin ?? r.xlim?.[0] ?? this.canvasComponent.data.roi.xMin;
    const xMax = r.xMax ?? r.xlim?.[1] ?? this.canvasComponent.data.roi.xMax;
    ...
    await this.rpcClient.detectColumnsInRoi({ ...r, xMin, xMax, yMin, yMax });
  }
}
```

而 `RpcClient.detectColumnsInRoi`（`RpcClient.ts:800-812`）把这份 bounds 直接写进
`core.detectColumns` 的 `data_xlim` / `data_ylim`，后端 `detect_columns` 收到参数后
**先覆写 `self.data_xlim` 与 ROI 的 `xlim`**（`session_parts/core.py:601-619`）：

```python
self.data_xlim = [x0, x1]
self.data_ylim = [y0, y1]
if target_roi is not None:
    target_roi["xlim"] = [x0, x1]
    target_roi["ylim"] = [y0, y1]
```

于是**前端镜像**（`canvasComponent.data.rois`）成了 ROI 的权威来源，
而后端自己的 `rois[].xlim` 被这次调用**覆盖**。

关键：前端镜像在"后端已改 ROI"之后**没有任何再同步**——
`roi.update` 是直接走 `page.request` / 页面 RPC 改的后端，前端镜像仍是旧值；
即使走 UI 的 `setRoi`（`CleanupManager.commitRoi`，`CleanupManager.ts:141-152`）
也只 `syncActiveRoiBounds`（顶层 `xMin/xMax`），**不回写 `rois[]` 数组**。

#### 用户可见后果

1. 用户在步骤 2 精细调整取数区（缩小以排除边框/邻列），
   到步骤 5 一分列，**取数区被退回**，分列与后续数字化都在旧范围上算。
2. 界面**全程显示成功**（无 toast、无 `rpcErrors`、无 console error），
   用户无从发现。这是「看起来生效」型失效。
3. 导出数据的列边界与用户以为的不一致 —— 直接进论文的数值。

#### 违反的不变量

`docs/ARCHITECTURE.md` §2（第 44 行原文）：

> **面向用户的数据只有唯一合法来源：后端对用户输入的真实计算。**
> 取不到就报错并停在原地，**绝不返回替代数据**。

此处是反向：后端已被正确改动的权威值，被**前端镜像**覆盖回旧值。

§6 第 174-175 行原文：

> **ROI（数据有效区）是"取数区域"，不是标尺**。它与深度/时间标定**相互独立**：
> 标定刻度选在哪里，不得影响取数区域，反之亦然（历史上二者耦合，导致"换个标定就静默截断曲线"）。

同族耦合在此复现：**分列**动作改写了 ROI。

#### 严重度裁定

**P1**。理由：①静默（无任何提示/错误）②改的是后续所有数字化与导出的**范围**
③用户可预期会做（步骤 2 调框 → 步骤 5 分列是主路径）④`docs/testing-strategy.md`
§8.4 说的"让数据穿过系统自身的重建路径再断言"正好能抓它，而现有 e2e **抓不到**，
因为基线 `serve_e2e_backend.py` 预跑 `detect_columns`，从不经过"先改 ROI 再分列"。

---

### F-2（P1）切图后旧几何在新图上继续剔除墨迹

#### 症状

在图上确认了一条干扰线（`status: "removed"`），**换到另一张图**后，
那条几何**仍在**，且因为旧 ROI 的 id（`roi_1`）与新图 ROI 的 id **恰好同名**，
`_geometry_mask` 的 roi 过滤（`session_parts/cleanup.py:193`）挡不住它 →
**新图上被真实剔除 2400 个墨迹像素**。

#### 最小复现

```bash
pixi run python scripts/zero_flow_probes/probe_p6b_cross_image.py 22940
```

真实输出：

```text
① 在 hoya 上做清理编辑（确认一条最厚的几何）
   hoya: 确认 line_v_103(width=3) 后 final_removed_pixels = 834

② 切换到另一张图（beginner），残留几何的 roi_id 仍是 roi_1
   新图尺寸 = 1923x1796 | rois = ['roi_1']
   残留几何 = 24 条，其中 status=removed = 1 条
   removed 条目：[{"id": "line_v_103", "axis": "v", "at": 329, "width": 3, "roi_id": "roi_1", "status": "removed"}]

③ 在新图上量测：残留几何是否真的剔除了墨迹
   带残留几何: final_removed_pixels = 2400 | geometry_removed_pixels = 2400
   清空后    : final_removed_pixels = 0 | geometry_removed_pixels = 0
   >>> 残留几何在新图上多剔除了 2400 个墨迹像素
```

#### 根因（file:line）

`straditize_core/session_parts/core.py:246-269`（`load_image` 的状态清理清单）：

```python
self.foreground_mask = None
self.grid_line_mask = None
self.candidate_line_mask = None
self.degrid_line_mask = None
self.exclusion_mask = None
self.manual_restore_mask = None
self.manual_erase_mask = None
self.cleanup_stats = {}
self.cleanup_overlay_png = None
...
self._init_rois()        # ← ROI 计数器归零，新 ROI 又叫 roi_1
```

清单里**没有** `line_candidates` / `exclusion_regions` / `line_strokes`。
对比 `project_new`（`session_parts/project.py:114-157`）同样没有
（`line_corrections` 清了，`line_strokes` 没清——它已换成新模型的字段名）。

`_init_rois()`（`session_parts/roi.py:23-25`）把 `_roi_counter` 归零，
于是新图 `roi_create` 又铸出 **`roi_1`** —— 与旧几何的 `roi_id` 相同，
`_geometry_mask` 的 `if cand.get("roi_id") != roi_id: continue` 完全失效。

#### 用户可见后果

换图后数字化结果被**无提示地削掉一条竖带**。这是**直接污染读数**且
用户不可能知道（步骤 4 的候选列表会显示 24 条旧几何，
但那个列表在步骤 4 才渲染，用户换图后通常直接去步骤 5）。

#### 违反的不变量

§7.1 第 240-241 行原文：

> **geometry 是唯一几何真相**：`geometry: {type:'rect', x0,y0,x1,y1}`（**ROI 内**像素矩形）。

几何是"ROI 内像素矩形"——跨图复用一个来自另一幅图的像素矩形，
语义上就不成立。

§9 第 338-339 行原文：

> 9. 线掩膜只有一份、由后端产生（`overlay_png` = B 键所见 = 数字化所用）；
>    前端禁止自行判定"哪条是线"。

佐证同一份"单一事实源"的意图：掩膜应与当前图一致。

#### 严重度裁定

**P1**。理由：静默污染**读数**（2400 px 墨迹被剔除），
且换图是零状态旅程里最常见的动作之一。

---

### F-3（P2）重新分列静默抹掉 `x_ticks`（含触发阈值）

#### 症状

步骤 6 标定好某列的 X 刻度（`x_ticks`），之后**微调 ROI 再分列**，
`x_ticks` 变成 `null`——无任何提示。阈值取决于列边界移动量。

#### 阈值实测（本缺陷的价值全在阈值）

```bash
pixi run python scripts/zero_flow_probes/probe_f3_xticks_threshold.py 22940
```

真实输出：

```text
基准：hoya，ROI = [315,1946] x [511,1311]；标定 col0 的 x_ticks
  col0: startX=322 endX=497 tickEndX=402.0

shift |   列数 |  startX |   endX |         守卫区间 | x_ticks
--------------------------------------------------------
    0 |   28 |   322.0 |  497.0 |    [312,507] | [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}]
    5 |   28 |   322.0 |  497.0 |    [312,507] | [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}]
   10 |   28 |   325.0 |  497.0 |    [315,507] | [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}]
   15 |   28 |   330.0 |  497.0 |    [320,507] | [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}]
   20 |   28 |   335.0 |  497.0 |    [325,507] | null
   25 |   27 |   497.0 |  728.0 |    [487,738] | null
   40 |   27 |   497.0 |  728.0 |    [487,738] | null

>>> 保留的 shift = [0, 5, 10, 15]
>>> 被静默清空的 shift = [20, 25, 40]
>>> 阈值落在 (15, 20) 区间：小于阈值保留、大于等于阈值静默清空。
>>> 用户无法预知自己落在哪一侧 —— 这正是缺陷的判别特征。
```

机制可复算：刻度 `px=322` 固定，守卫下界随列起点右移而升高。
`shift=15` 时下界 320 ≤ 322 → 保留；`shift=20` 时下界 325 > 322 → **整条丢弃**。

**`shift≥25` 是更糟的一档**：列数 28→27、`startX` 直接跳到 497
（列**重新检出后整段错位**）。此时刻度更不可能落在新区间，`x_ticks` 必丢。

#### 根因（file:line）

`straditize_core/session_parts/core.py:738-751`：

```python
if preserve_state:
    old_c = old_roi_cols[k]
    ...
    if old_c.get("x_ticks"):
        t = old_c["x_ticks"]
        lo = min(col["start"], col["end"]) - 10
        hi = max(col["start"], col["end"]) + 10
        if (len(t) == 2 and lo <= t[0].get("px", 0) <= hi
                and lo <= t[1].get("px", 0) <= hi):
            col["x_ticks"] = t          # 满足才保留
        # ← 不满足时**静默丢弃**，既不报错也不返回任何信号
```

同时 `preserve_state = len(old_roi_cols) == len(detected_cols)`
（`core.py:702`）—— 列数一变（本例 28 → 27）就**整体丢弃**所有列级状态。

#### 污染程度

`x_ticks` 是 X 轴标度的**唯一解析入口**
（`session_parts/xscale.py:236-257`，`source="x_ticks"`）。
丢失后 `resolve_column_scale` 回落到 legacy 三件套
（`startValue`/`tickValue`/`tickEndX`，`xscale.py:258-300`），
值为 `0 / 20 / startX+65%列宽` —— **不是用户标定的 0→40**。

实测后果（`ui7`）：

```text
qa.uncalibrated_columns = ["col05","col06",...,"col27"]  （20 列）
qa.n_uncalibrated = 20
```

即 QA 自己承认 20 列未标定，但**只把 banner 变黄**，导出照常按 legacy 兜底值算。

#### 违反的不变量

§6.0 第 169-170 行原文：

> 2. **重新分列数值保全**：重新分列时，若本 ROI 列数不变，自动回填列级标定数值
>    并施加**区间守卫**（刻度像素落在列边界 `[start-10, end+10]` 内），
>    避免改名或重分列**静默清空标定**。

文档明确写了这条设计意图是"**避免静默清空标定**"，实现却在守卫失败时
静默清空——文档与实现相反。

§9 第 333-334 行原文：

> 4. 每列刻度值只能**人读**，不得填默认值冒充。

丢失后回落到 `0/20/startX+65%` 的合成值，即"填默认值冒充"。

#### 严重度裁定

**P2**。理由：影响导出数值（P1 级影响），但**触发需要 ROI 变化 ≥20px**，
且 QA banner 会变黄（弱提示）。比 F-1/F-2 弱一格，因为用户有微弱线索。

---

### F-4（P2）【重置全部操作】必然弹 -32001 红框

#### 症状

载图后点工具栏【重置全部操作】：确认对话框 → 立即弹出一个红色失败弹窗
「归零后重算清理掩膜失败 / 前置状态缺失：未找到 ROI 'roi_1'」。
**每一次**都会发生，不是偶发。

#### 最小复现

```bash
cd frontend && STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui1_reset
```

真实输出（B 段，摘要）：

```text
[ui1] 上传后后端 rois = [{"id":"roi_1",...}] | active = roi_1
[ui1] 重置后后端 rois = [] | active = null | imageSrc = /image/current
[ui1] 重置后前端镜像 rois = [{"id":"roi_1",...}] | active_roi_id = roi_1
[ui1] 重置后 rpcErrors = ["algorithm.applyLineRemoval [-32001] 前置状态缺失：未找到 ROI 'roi_1'。请在【步骤 2: ROI】中先创建或选取该有效区。"]
[ui1] 重置后 notices   = ["归零后重算清理掩膜失败 ... 前端执行操作时报告了以下错误或状态异常：前置状态未就绪 (code -32001) ..."]
[done] ui1_reset consoleErrors = ["[RPC failure] 归零后重算清理掩膜: Error: 前置状态未就绪 (code -32001) ..."]
```

#### 根因（file:line）

`frontend/src/services/ToolbarBridge.ts:140-167`：

```ts
p.canvasComponent.resetAllOperations();
void p.rpcClient.resetProjectState();          // ← project.new 把 ROI 清空
...
if (p.canvasComponent.data.imageSrc) {
  void p.cleanupManager.recomposeCleanupState('归零后重算清理掩膜');
}
```

`resetProjectState` → `project.new`（`RpcClient.ts:683-691`，`project.py:114`）
调 `self._init_rois()` 把 `rois` 清空、`active_roi_id` 置 `null`；
然后 `recomposeCleanupState` 用**前端镜像**的旧 `activeRoiId`（`roi_1`）
发 `algorithm.applyLineRemoval`（`CleanupManager.ts:87-88`）→
后端 `_roi_for` → `_get_roi('roi_1')` 抛 `-32001`（`session_parts/roi.py:40-46`）。

两个 RPC 是 `void`（不 await），顺序无保证 —— 但**即使顺序正确也必失败**，
因为 `project.new` 之后后端确实没有任何 ROI。

#### 用户可见后果

用户想重置，先看到一个红色错误弹窗。按弹窗文字"请在步骤 2 中先创建 ROI"去操作，
反而会**新建**一个 `roi_2`（`_roi_counter` 已归零，实际仍叫 `roi_1`？见 F-4 附注），
而不是恢复被删的那个。

#### 违反的不变量

不是直接违反某条编号不变量，而是**错位诊断**：
`docs/testing-strategy.md` §9 里"上传端点无 e2e 覆盖（已补）"那行把
"用户拿到的不是'上传失败'，而是后端的 `参数绑定失败: …`"定义为缺陷形态
（"一次**错位诊断**"）。本条的形态与之一致：用户做的是"重置"，
拿到的却是"未找到 ROI"。

#### 附注：ROI 计数器归零的真实后果（已实测，低于报告门槛）

`project.new` → `_init_rois()` 把 `_roi_counter = 0`
（`session_parts/roi.py:23-25`），新 ROI 又叫 `roi_1`。
实测 `roi.update(roi_id='roi_1')` 在重置后 **ok**（因为同名新 ROI 已存在），
所以**不会**留下悬空指针。经验证这是一条**没有问题**的路径（见第 5 节）。

---

### F-5（P2）`project.new` 残留清理编辑

#### 最小复现

```bash
pixi run python scripts/zero_flow_probes/probe_p6_project_new.py 22940
```

真实输出（N1 段）：

```text
  检出候选几何 24 条
  project.new 之前： {"columns": 28, "rois": 1, "line_candidates": 24, "line_strokes": 1, "cleanup_stats": {...}}
  project.new 之后： {"columns": 0, "rois": 0, "line_candidates": 24, "line_strokes": 1, "cleanup_stats": {}}
  >>> 清理状态残留？ 是（缺陷）
```

同一缺陷在真实 UI 路径 `onResetAll` 上可见：重置后 `line_candidates` 仍是 24 条，
只有 `cleanup_stats` 被清。因为随后 F-4 的 `-32001` 让 `applyCleanupState`
从未执行，前端镜像里那 24 条**也还在**。

#### 根因

`session_parts/project.py:114-157` 的 `project_new` 字段清单：
清了 `grid_line_mask` / `candidate_line_mask` / `exclusion_mask` /
`manual_*_mask` / `cleanup_stats` / `cleanup_overlay_png` / `line_corrections` /
`taxa_names` / `samples` / `age_depth_*` / `ensemble_tables` / `chron_events` /
`undo_stack` / `redo_stack`，**唯独没有** `line_candidates` /
`exclusion_regions` / `line_strokes`（它们属于新版清理模型，
`line_corrections` 是被下线的旧模型字段）。

#### 与 F-2 的关系

同一根因族（清理状态的三项没人清），但触发面不同：F-2 跨**图**，
F-5 是**同一图**内的"新建项目"。F-2 更严重（跨图 + 真实剔除墨迹），
F-5 在当前 UI 路径下被 F-4 的错误截断，用户暂时看不到"残留几何画在图上"，
但后端列表已经脏了 —— 一旦 F-4 被修，F-5 立刻变成用户可见。

---

### F-6（P3）无锁共享会话的并发撕裂读

#### 独立性说明

Lead 先报过这条，本任务**独立复现**（自己的脚本、自己的端口 22940）。

#### 证据 A：纯后端并发（8 轮，每轮 3 读线程）

```bash
pixi run python scripts/zero_flow_probes/probe_p3_concurrency.py 22940
```
```text
  第 1 轮：18 次读，撕裂 2 次；例：{"imageWidth": 2339, "rois": 0, "primaryRoiId": null, "activeRoiId": null}
  ...
  第 8 轮：18 次读，撕裂 10 次
  >>> 撕裂轮数：8/8
  >>> 并发结束后静态读：{"rois": 1, "primaryRoiId": "roi_1"}（自愈？）
```

#### 证据 B：两个真实标签页（真实 Edge）

**B 页**在 `page.evaluate` 里连发 60 次 `straditize.getDiagramData`（模拟用户切回
另一页时触发的数据刷新）；**A 页**同时用工具栏范例下拉切换图像
（`selectOption('#select-sample-diagram','hoya')`，走 `handleLoadSample` →
`core.loadImage`，与上传同一变更路径）。读得多是必要的：只读 8 次的版本
6 轮全部错过窗口（0/48），那会得出"无缺陷"的错误结论。

```bash
cd frontend && STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/driver.cjs ui5_two_tabs
```
```text
  第 1 轮（切换成功=true）：60 次读，撕裂 51 次；例 {"imageWidth":2339,"rois":0,"primaryRoiId":null,"activeRoiId":null}
  ...
  >>> 两个标签页合计撕裂 297 次 / 6 轮
```

#### 证据 C：单次读落在窗口内的概率

```text
D. 单次读恰好落在 loadImage 窗口内的概率（120 次随机时刻）
{"rounds": 120, "torn": 108, "rate": 0.9}
```

#### 根因（file:line）

- 每请求一线程：`straditize_core/rpc_server.py:318`
  `self._server = ThreadingHTTPServer((self.host, self.port), BoundHandler)`
- 分发器**无锁**：`straditize_core/protocol.py:240` `class JsonRpcDispatcher`，
  在 protocol.py 内 `grep -n "Lock\|threading\|RLock"` **零命中**（实测 exit 1）。
- 变更窗口：`session_parts/core.py:246` 先设 `self.image`（宽度已生效），
  到 `:269 self._init_rois()` 把 `rois` 清空，再到 `:272 self.roi_create(...)` 回填。

#### 用户可见后果（如实降级）

- **单标签页测不出**：前端把请求串行化（我 6 轮 × 8 次读，0 撕裂）。
- 两标签页能命中，但**撕裂是瞬时的、会自愈**：并发结束后静态读恢复正常。
- 我**没有**找到撕裂读数被前端渲染成错误界面并被用户看到的路径：
  `RpcClient.getDiagramData`（`RpcClient.ts:412-425`）不补 `rois`，
  而 `GeologyCanvas.updateEmptyStateVisibility`（`GeologyCanvas.ts:346-350`）
  只认 `imageSrc`，所以撕裂态下画布**显示有图、无 ROI 框**，
  下一次刷新即恢复。
- **因此不裁 P1/P2**：真实受害概率低（需要另一个标签页恰好在 0.x 秒窗口内刷新），
  且不留持久损坏。

#### 与 §3 的关系（不硬套）

`docs/ARCHITECTURE.md` §3 第 85-86 行原文：

> **为什么不做账号 / 密码 / token**：这是单用户单会话工具（`StraditizeSession` 为单例，
> 多人会互相覆盖状态）

这句说的是"**多人**"。**单用户开两个标签页**不属于"多人"，
所以本条**不构成**对 §3 的违反。它的定性是"已知设计约束下的可用性毛刺"，
不是安全或数据完整性问题。

#### 更严重的同源问题（并发写）——我**没**能证实

Lead 要求查"两个标签页同时写会不会互相覆盖"。我逐条试过，**都没能复现丢数据**：

| 实验 | 结论 |
|---|---|
| W1：A 标定 col2 `x_ticks` vs B 同时 `detectColumns`（6 轮） | 0/6 丢失，每轮 `x_ticks` 都在 |
| W2：两笔笔迹并发 `applyLineRemoval(strokes=…)`（6 轮） | **6/6 只剩最后一笔** —— 但这是**接口语义**（全量覆盖），不是竞态：前端 `setLineStrokes` 每次都发全量数组（`RpcClient.ts:657-660`），两个标签页各持不同全量数组互覆是"各自全量提交"的必然结果，属产品语义而非无锁缺陷 |
| W3：`project.save` 与 `project.new` 并发 | 保存成功，产物 0 列 0 ROI（=已被清空后的状态），与"两个动作并发"一致，无异常 |
| UI6 S1：A 页 `calibrateAxes` vs B 页 `roi.update(name)` | 两个写入**都保留**（`isCalibrated=true, top_px=600` + `roi.name=湖泊B`） |
| UI6 S2：A 页重分列 vs B 页确认几何 | 候选 24 条、removed 1 条、目标 id 仍在 |
| UI6 S3：A 页标定 X 刻度 vs B 页重分列 | `col2.x_ticks` 保留 |

→ 结论：**并发写丢数据这一假设我无法证实**，登记为未验证假设（§4）。

---

### F-7（P3）`verification` 范例名残留

#### 事实链

- `straditize_core/session_parts/core.py:41-45` 的 `sample_candidates` 仍含
  `"verification": repo_root / "verification_real_pollen_edit.png"`；
- `frontend/src/components/Toolbar.ts:252-257` 已删掉该 `<option>`（注释说明了原因：
  该 PNG 被 `.gitignore` 排除）；
- `frontend/src/services/FileLoaderService.ts:307-311` 的 `nameMap` 仍保留
  `verification: '标定验证地质图谱'`；
- 仓库里**没有**该文件：`ls straditize_core/assets/tutorials/` 只有
  `beginner-tutorial.png` / `hoya-del-castillo.png`。

#### 实测

```bash
pixi run python -c "
import sys; sys.path.insert(0,'scripts/zero_flow_probes')
from rpc import Rpc
ok,res=Rpc(22940).try_call('core.loadImage', {'sample_key':'verification'})
print('ok=',ok); print(res)"
```
```text
ok= False
JSON-RPC error for core.loadImage: {"code": -32004, "message": "内置范例图片缺失: I:\\software_dev\\straditize\\verification_real_pollen_edit.png。请确认仓库完整性。"}
```

#### 可达性

唯一到达 `handleLoadSample('verification')` 的路径是 `Toolbar` 的
`<select id="select-sample-diagram">` 的 `change` 事件（`Toolbar.ts:479-484`），
而下拉里已无该 option → **UI 不可达**。
WebMCP 的 `straditize_load_image` 工具（`mcp_server.py:45-66`）可以传任意
`sample_key`，所以 agent 可达，会得到 `-32004`（一个有引导的合理错误）。

#### 裁定

**P3 / 文档残留**，不是缺陷。记录在此是因为它属于"同一件事有三个落点"的
典型形态（后端 key 表 / 前端 nameMap / 工具栏 option），删掉 option 时漏了前两处。
`FileLoaderService.ts:309` 的映射对 `beginner` 之外的 key 永远走不到
`nameMap[key] || sampleKey` 的兜底分支。

---

### F-8（P2）自动存档草稿【恢复】只写前端镜像、不回灌后端

#### 症状

页面重开时若 localStorage 里有草稿，会弹"发现未保存的工作"横幅。
点【恢复】：界面**看起来**恢复了 28 列，但后端一列都没有。
用户接着点任何真实动作（标定列 / 导出）立刻得到 `-32001`。

#### 最小复现

```bash
pixi run python scripts/zero_flow_probes/probe_p5_draft.py 22940
```

真实输出：

```text
① 建立「有列」的会话（等价用户关页前的状态）
   后端 columns = 28 | 第 1 列 = roi_1_col01

② 另一个标签页点【重置】(等价：后端 project.new)
   后端 columns = 0 | rois = 0
   —— 前端镜像此刻仍有 28 列（草稿里保存的那份）

③ 用户点草稿【恢复】：前端只调用 loadNewDiagram，不发任何 RPC
   故后端读到的仍是：
   columns = 0 | rois = 0 | imageSrc = /image/current

④ 用户在'看起来有 28 列'的界面上继续动作，逐个看后端反应
   column.calibrateXTicks -> FAIL  {"code": -32001, "message": "前置状态缺失：列索引 0 超出范围。请先在【步骤 5: 分列】确认列切分。"}
   export.getReadiness -> ok  {"ready": false, "readiness_missing": ["pollen"]}
   export.csv -> FAIL  {"code": -32001, "message": "No digitized data available to export."}
   qa.summarize -> ok  {"n_horizons": 0, ...}

⑤ 后端权威状态（用户真正会拿到的东西）
   columns = 0 | rois = 0
```

#### 根因（file:line）

`frontend/src/main.ts:718-726`（草稿恢复按钮）：

```ts
banner.querySelector('#btn-restore-draft')?.addEventListener('click', () => {
  canvasComponent.loadNewDiagram(draft.data);      // ← 只改前端镜像
  history.reset(draft.data.columns, draft.data.activeTaxaId);
  sidebar?.updateData(canvasComponent.data);
  inspector?.updateData(canvasComponent.data);
  toolbar?.updateHistoryState();
  updateFooter();
  banner.remove();
  setHudNotice(t('draft.restored'), 3500);
});
```

整段**没有任何 RPC**。对比同一文件里所有"改后端"的动作都会 `rpcClient.*`。
而 `draft.data` 是 `canvasComponent.data` 的整份 JSON 快照
（`main.ts:102-106`），本身不含任何"如何写回后端"的信息。

#### 用户可见后果

- 用户看到"已恢复"的 toast（`draft.restored`），以为工作回来了；
- 实际后端是空的；第一次真实操作就撞 `-32001`，错误文案指向"请先在步骤 5 确认列切分"
  —— 而界面**明明**显示有列。属于**错位诊断**（与 `docs/testing-strategy.md` §9
  里"上传端点"那条修过的缺陷同型）。

#### 与 F-1 的关系

同一族的"前端镜像被当成权威"。F-1 是镜像**覆盖**后端，F-8 是镜像**替代**后端。
两者的共同根因是：`canvasComponent.data` 与后端会话之间**没有单一写入路径**。

#### 严重度裁定

**P2**。触发需要"另一标签页重置 / 后端重启过 → 再点草稿恢复"，不是每次开页都有；
但一旦触发就是"看起来有数据、其实没有"，且用户会按错误提示去新建 ROI 而丢掉草稿。

---

## 3. 交叉验证：Project 往返保真（**无缺陷**，但值得留证）

`docs/ARCHITECTURE.md` §8.4 的判据："任何'持久化了'的声明，都要让数据穿过系统
自己的重建路径再断言一次。"

```bash
pixi run python scripts/zero_flow_probes/probe_p7_roundtrip.py 22940
```
```text
保存前（后端真值）：
   {"col_index": 0, "name": "Pinus", "x_ticks": [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}], ...}
文件列0: name='Pinus' x_ticks=[{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}]
载回后（后端真值）：
   {"col_index": 0, "name": "Pinus", "x_ticks": [{"px": 322.0, "value": 0.0}, {"px": 402.0, "value": 40.0}], ...}
   ✓ 列0 逐字段一致
   ✓ 列1 逐字段一致
```

→ `project_save` / `project_load` 往返保真，**包括 `x_ticks`**。
这是 §6.0 第 3 条声明的正面证据。

---

## 4. 未验证假设（**严格分节，与上面的已确认发现不混**）

| # | 假设 | 我做了什么 | 卡在哪 |
|---|---|---|---|
| H1 | 两个标签页**并发写**会互相覆盖 / 丢数据 | P4 的 W1/W2/W3 + UI6 的 S1/S2/S3 共 6 组实验 | **未能复现丢数据**。W2 的笔迹覆盖是"全量覆盖"接口语义的必然结果，不是竞态。要证明真竞态需要更细的注入点（例如在两处 read-modify-write 之间强制 sleep），那属于改源码，本任务只读 |
| H2 | 撕裂读会让前端渲染出"有图无 ROI"的错误界面并被用户当真 | 读了 `updateEmptyStateVisibility` / `getDiagramData` 的映射逻辑 | 静态分析认为不会（只认 `imageSrc`）。**没有**构造出"用户看着错误界面停留数秒"的真实场景 |
| H3 | `Inspector` 整块重挂（`Inspector.ts:142` `innerHTML=`）会让用户在步骤 3 逐框输入时丢值（文档 §9 第 267 行声称的缺陷） | 用真实 Edge 复刻"点框 → Ctrl+A → 逐字输入 → Tab 切下一框" | **本次未复现**：后端 `calibration` 逐字段等于输入值，DOM 现值也对。**但 `activeElement` 确实变成 `<body>`**（焦点掉了）。触发条件比"逐框 fill"更窄，我未能确定最小序列 |
| H4 | 撤销（Ctrl+Z）无法回滚清理编辑 | 读 `HistoryManager.snapshot` 字段 | 文档已声明为"刻意设计（清理编辑不入栈）"，我没有构造用户路径去验证"用户会误以为能撤销"。**未验证** |
| H5 | `exaggeration_multiplier` 三处键名分裂导致"界面显示的倍数永远到不了导出" | 只读了文档 §9 第 268 行与 `xscale.py:198-215` | 需要构造完整 UI 路径（Inspector 勾选框 → 导出），本次时间不够，**未验证** |

---

## 5. 已排查但**确认无问题**的清单

| 项 | 做法 | 结果 |
|---|---|---|
| 零状态下应用能否 boot | 零状态后端 + 真实 Edge `goto('/')`，等 `window.__straditize` | **能 boot**。`getDiagramData` 返回 `imageSrc: null` / `rois: []`，画布显示空状态，无 console error |
| 零状态下点【重置】 | UI1 的 A 段 | **无错误**（后端本就没有 ROI，`recomposeCleanupState` 被 `if (data.imageSrc)` 挡住）。只有 confirm 对话框 |
| 零状态 `export.getReadiness` | 直调 | 返回 `ready: false, readiness_missing: ['pollen']`，`sheets: ['pollen']`。**`sheets` 在无 ROI 时仍列出 'pollen'** 是既有兜底（`export.py:151-153`），但它同时把 `ready=false` 与 `readiness_missing` 都给了，不构成"冒充就绪" |
| 零状态 `qa.summarize` | 直调 | 返回 `n_horizons: 0`、`violations_over: []`、`per_column_max: []`。前端 `computeBannerMeta`（`QaPanel.ts:50-73`）会显示绿色"地学校验门禁通过"—— 但三个判据全空，属"没有数据可判"，与文档 §9 第 251 行已修的"汇总失败只 console.warn"不是同一形态。**登记为观察，不算缺陷**（无数据集时"通过"不构成科学结论） |
| `roi.update` 后 ROI 是否被并发回滚 | 6 轮 `roi.update` + 400ms 回读 | **0/6 回滚**。单次 `roi.update` 是可靠的；F-1 的覆盖者**不是**后台定时器，而是步骤 5 的重分列动作 |
| `project.new` 后 ROI 计数器归零是否留下悬空指针 | 重置后 `roi.update(roi_id='roi_1')` | **ok**。新 ROI 复用同名 id，无悬空 |
| `project.save`/`load` 往返 | P7 | **保真**，含 `x_ticks`、`x_group_id`、列名 |
| `_init_rois` 清空清单 | 读 `roi.py:23-25` | 只清 `rois`/`primary_roi_id`/`active_roi_id`/`_roi_counter`，与文档一致 |
| 上传真实 PNG（`#btn-open-file` + `filechooser`） | UI1 / UI5 / UI7 | **成功**。后端 `imageWidth=2339, imageHeight=1654`，自动建 `roi_1`（`suggest_data_region` 给出 `[315,1946]×[511,1311]`），前端镜像与后端一致 |
| 范例下拉每一项都能载入 | `select-sample-diagram` 逐个 | 只有 `hoya` / `beginner` 两项，都能载入。`verification` 已不在下拉（见 F-7） |

---

## 6. 与既有文档结论的冲突（需 Lead 裁决）

1. **`frontend/e2e/step6-xticks.spec.ts:115-120` 的注释**说"重新分列目前会
   静默抹掉全部列的 x_ticks"，并称"那是另一个待决缺陷"。
   我的实测：**不是"总是"抹，而是有阈值**（列边界移动 >10px 时）。
   同 bounds 重分列 **保留**；`shift=20` 才丢。这条注释把条件说宽了。

2. **`docs/ARCHITECTURE.md` §6.0 第 169-170 行**声称重新分列"施加区间守卫…
   避免静默清空标定"。实现确实有守卫，但**守卫失败时静默清空**，
   与"避免"这一设计意图相反（F-3）。

3. **`docs/testing-strategy.md` §9 第 267 行**（步骤面板整块重挂吞掉输入）
   与我的 H3 观察部分吻合（焦点确实掉），但"写进 `#ycal-inp-bot-px` 的 1100
   在一次重挂后从 DOM 里消失"这一具体现象**本次未复现**。

---

## 6.1 不变量引用自查（防误引）

每条引用的 `docs/ARCHITECTURE.md` 原文我逐条 `sed -n` 核对过行号与文字，
避免"误引不变量"本身成为报告缺陷：

| 引用 | 实际行 | 核对结果 |
|---|---|---|
| §2 "面向用户的数据只有唯一合法来源…" | 44 | ✅ 原文一致 |
| §6 "ROI…与深度/时间标定相互独立…不得影响取数区域" | 174-175 | ✅ 原文一致 |
| §6.0-2 "重新分列数值保全…避免…静默清空标定" | 169 | ✅ 原文一致 |
| §7.1 "geometry 是唯一几何真相…（ROI 内像素矩形）" | 240 | ✅ 原文一致 |
| §9-4 "每列刻度值只能人读，不得填默认值冒充" | 333 | ✅ 原文一致 |
| §9-9 "线掩膜只有一份、由后端产生…前端禁止自行判定" | 338-339 | ✅ 原文一致 |
| §3 "单用户单会话工具（`StraditizeSession` 为单例，多人会互相覆盖状态）" | 85-86 | ✅ 原文一致（F-6 **未**据此判违反，理由见该节） |

**一处主动纠正**：F-8 我最初引了 "§9-11"，核对后发现 §9 第 11 条讲的是
"落在 ROI 之外的数据一律不存在"，与草稿恢复无关 —— 已改为只引 §2。

---

## 7. 本次**没有**覆盖的范围（诚实声明）

- 步骤 7（拐点与采样）与步骤 8（校验）的完整 UI 路径 —— 只用了后端 RPC 间接验证。
- 年龄-深度模型、OCR、PDF 分页、旋转校正、多 ROI 跨 ROI 分列的组合。
- 真实超大图（>6000px）的降采样路径。
- 并发写的真竞态（需改源码注入 sleep，超出"只读"约束）。
- `algorithm.degrid`（文档已声明前端零调用，未验证 WebMCP 直通路径）。
