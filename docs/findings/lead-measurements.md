# Lead 独立实测记录（原始证据）

> 本文件只记录 **Lead 本人亲自跑过** 的实验与真实输出，不含转述。
> 目的：让用户可以只凭本文件复算 Lead 下过的每一个结论。
> 复跑前提：仓库根 `E:\software_dev\straditize`，Windows 11 + Git Bash + pixi 环境 + 系统 Edge。

---

## 0. 环境与门禁基线（2026-10-19）

```bash
$ pixi run lint
All checks passed!
OK  A. 调用点 ↔ 函数签名        OK  A0. 签名源文件语法
OK  B. int|str 标注 ↔ 实现      OK  C. package-data 声明 ↔ 真实文件
OK  D. pytest python_files 覆盖 OK  E. 裸步骤数字（应走 WorkflowStage）
OK  G. 前端 RPC 方法名 ⊆ 后端注册表
OK  H. 协议层 ALL_RPC_METHODS ↔ 后端注册表
OK  I. 前端 RpcMethod 类型 ↔ 后端注册表
OK  J. pyproject.toml 依赖对账   OK  F. 注释残留旧 7 步编号
一致性核对通过          → exit 0

$ pixi run test
317 passed, 3 skipped, 90 subtests passed in 167.82s (0:02:47)   → exit 0

$ STRADITIZE_E2E_PORT=22901 pixi run test-contract
5 passed (20.0s)                                                 → exit 0
```

---

## 1. 零状态可用性（Lead 实测）

零状态后端：`scripts/lead_probe/serve_zero.py`（不预载图、不预跑分列）。

```bash
$ STRADITIZE_ZERO_PORT=22910 pixi run python scripts/lead_probe/serve_zero.py
[lead-probe] ZERO-STATE backend ready on http://127.0.0.1:22910/

$ curl -s http://127.0.0.1:22910/status
{"status":"ok","service":"straditize_rpc","version":"2.0","is_desktop_mode":true,
 "has_image":false,"width":0,"height":0,"columns_count":0,"is_calibrated":false,
 "taxa":[],"auth_required":false,"has_remote_password":false}
```

**结论**：零状态可用。界面能完成 boot（`window.__straditize` 就绪、画布挂载），
后端如实返回 `imageSrc: null` / `rois: []`，**不回落内置范例**（符合 §2 不变量）。

真实文件选择器上传（`drive_zero_upload4.mjs`，完整 RPC 时序）：

```
core.loadImage → {success:true, w:2339, h:1654, rois:1, names:["pollen"], primary:"roi_1"}
image.detectDeskew → {has_skew, suggested_rotation_angle}
straditize.getDiagramData → {w:2339, h:1654, rois:1, primaryRoiId:"roi_1", activeRoiId:"roi_1"}
前端镜像 → stage:1, rois:1
dialogs:[], notices:[], consoleErrors:[]
```

**结论**：真实上传链路正确落地（尺寸等于真值、自动建 1 个 `composition=true` 的 pollen ROI、停在第 1 步）。

### 1.1 一个必须记住的探针陷阱（Lead 自己踩过）

`page.waitForFunction(async () => {...})` 传入 **async 函数**时返回 Promise，**永远为真值**，
waitForFunction 立即返回、根本没等待。Lead 第一版探针因此误判成"上传后仍是 0×0"，
重启后端用加固版（Node 侧轮询）才拿到正确结果。教训：**等待条件必须是被断言的那个量本身**。

---

## 2. 【P1】重新分列静默抹掉 `x_ticks`，同一读数换算值改变

> ⚠️ **本节的判据归因已被更正（2026-10-19，由 verifier 推翻，Lead 已亲自复验）**。
> Lead 最初把判据写成"列数是否变化"——**这是错的**。真判据是**区间守卫越界**：
> 刻度像素落在新区间 `[min(start,end)-10, max(start,end)+10]` 之外时被丢弃，
> 且该守卫的丢弃分支**静默**（无任何提示）。列数变化只是**伴随现象**，不是判据。
> Lead 的决定性实验见 §2.0（`xticks_scan_decide.py`：首次被抹在 Δ=18，此时列数仍是 28→28）。
> 原文保留在下方，以示更正过程；**结论以 §2.0 为准**。

### 2.0 更正后的决定性实验（判据 = 区间守卫）

```bash
$ pixi run python scripts/lead_probe/xticks_scan_decide.py
   Δ左        列数     保留?      守卫通过?   tick_px
    0   28->28        是         是     322.0
   ...
   17   28->28        是         是     322.0
   18   28->28        否         否     322.0  ← 首次被抹（列数未变！）
   19   28->28        否         否     322.0
   22   28->27        否         否     322.0  ← 列数才首次变化
首次被抹出现在 Δ左 = 18
```

**判据明确**：守卫通过 → 保留；守卫不通过 → 抹掉。首次被抹（Δ=18）时列数**仍是 28→28**，
证明"列数变化"不是判据。守卫的实际边界来自 `session_parts/core.py:742-746`：
`lo = min(start,end) - 10`，`hi = max(start,end) + 10`，`tick_px` 落在此区间外即被丢弃。

### 2.1 触发条件（不是"边界差 20px"，而是**列数是否变化**）

```bash
$ pixi run python scripts/lead_probe/xticks_wipe_threshold.py     # 纯进程内，逐区间重分列
新区间        Δ左  Δ右    列数        x_ticks 结果
[315,1946]     0    0   28->28      保留
[315,1940]     0   -6   28->28      保留
[320,1946]     5    0   28->28      保留
[315,1930]     0  -16   28->28      保留
[330,1946]    15    0   28->28      保留
[315,1900]     0  -46   28->28      保留     ← 边界差 46px 仍保留
[340,1946]    25    0   28->27      **被抹掉** ← 列数一变即抹
[350,1946]    35    0   28->27      **被抹掉**
[400,1946]    85    0   28->27      **被抹掉**
[400,900]     85 -1046  28->3       **被抹掉**
```

**（已作废的）原始判据**：列数不变 → 保留；列数变化 → 静默清空。
**更正**：此归因错误。上表里"列数变化"与"被抹"高度相关，只是因为改边界到一定程度
会同时触发守卫越界与列数变化；用更细的逐像素扫描（§2.0）即可分离二者。
真判据是**区间守卫越界**，静默丢弃点在守卫失败分支。

### 2.2 数据完整性后果（同一物理读数换算值改变）

```bash
$ pixi run python scripts/lead_probe/xticks_wipe_impact.py
=== 标定后（x_ticks 生效） ===
  x_ticks : [{'px': 322.0, 'value': 0.0}, {'px': 480.0, 'value': 20.0}]
  scale   : ColumnScale(abs_px0=322.0, val0=0.0, abs_px1=480.0, val1=20.0, unit='%',
                        plot_type='area', scale_type='linear', exaggeration_mult=None,
                        calibrated=True, source='x_ticks')
  该列最大像素宽度 = 110.0px
  → 按 x_ticks 换算 = 13.9241 %

=== 列数变化重分列后 ===
  x_ticks : None
  scale   : ColumnScale(abs_px0=497.0, val0=0.0, abs_px1=577.0, val1=20.0, unit='%',
                        plot_type='area', scale_type='linear', exaggeration_mult=None,
                        calibrated=False, source='legacy')
  → 同一像素宽度按 legacy 列宽百分比换算 = 47.6190 %
```

**结论**：用户标定好的列，一旦触发列数变化的重分列，**同一个物理读数从 13.92% 变成 47.62%**，
且界面**无任何提示**。违反 `docs/ARCHITECTURE.md` §6.0「列分组与标度统一解析源」
（其立意正是杜绝"同一列在不同导出路径得到不同数值"），此处形态更糟：**同一列在标定前后得到不同数值**。

### 2.3 更正一条错误的既有结论

`journey-log.md` 第 4 节曾把此条判为"未复现、可能是陈旧注释"。该结论**错误**：
它只试了同边界与微小差边界（列数都没变）。`frontend/e2e/step6-xticks.spec.ts:117-120`
的原始警告**仍然成立**。

---

## 3. 【P1】JSON-RPC 层无并发互斥 → 撕裂读；两标签页并发可复现

### 3.1 机制（file:line）

- 服务端每请求一线程：`straditize_core/rpc_server.py:318` → `ThreadingHTTPServer((self.host, self.port), BoundHandler)`
- 分发器**无任何锁**：`straditize_core/protocol.py:240` `class JsonRpcDispatcher`；
  在 protocol.py 内 `grep -n "Lock\|threading"` → **零命中**
- 变更窗口：`straditize_core/session_parts/core.py` — `load_image()` 先写
  `self.width/height/image`，随后 `:269 self._init_rois()`（`session_parts/roi.py:23-25`
  把 `rois=[]`、`primary_roi_id=None`、`active_roi_id=None`），再 `:272 self.roi_create(...)` 回填。
  窗口内并发读 `getDiagramData` 即拿到 `imageWidth>0` 但 `rois:[]`。

### 3.2 强度实测（8 轮）

```bash
$ pixi run python scripts/lead_probe/race_strength.py
round 0: torn reads = 14/15      round 4: torn reads = 6/15
round 1: torn reads = 8/15       round 5: torn reads = 11/15
round 2: torn reads = 14/15      round 6: torn reads = 12/15
round 3: torn reads = 7/15       round 7: torn reads = 9/15
出现撕裂的轮次: 8 / 8
```

### 3.3 用户可达性（关键：单标签页测不出，两标签页能）

```bash
$ STRADITIZE_ZERO_PORT=22913 node scripts/lead_probe/race_ui.mjs      # 单标签页 6 轮
round 0..5: backend w=2339 rois=1     后端撕裂读数 0 次

$ STRADITIZE_ZERO_PORT=22913 node scripts/lead_probe/realistic_race.mjs  # 上传期间在途并发读
torn: 0

$ STRADITIZE_ZERO_PORT=22913 node scripts/lead_probe/twotab.mjs       # 两标签页：A 上传 + B 轮询
round 0..5: final w=2339 rois=1
torn: 30   [{"w":2339,"rois":0,"tab":"B"}, ...]   ← 6 轮 × 5 次
```

**结论**：单标签页前端把请求串行化了，**测不出**；但用户开两个标签页（真的会这么干）
就稳定复现。撕裂是**瞬时**的，并发结束后静态回读恢复
（`rois:1, primaryRoiId:"roi_1"`），因此是**瞬时错读**而非永久损坏——严重度据此定级，
不夸大成"数据永久丢失"。

---

## 4. Lead 复核 teammates 产出时的程序性发现

| 项 | 事实 | 影响 |
| :--- | :--- | :--- |
| HTML reporter 与产物目录嵌套 | 按 `playwright.zero.config.ts` 原样复跑，Playwright 报 `Configuration Error: HTML reporter output folder clashes with the tests output folder`（`test-results-22926-zero/report` vs `test-results-22926-zero`） | 失败时 `trace: 'retain-on-failure'` 的 trace 会被 reporter 清掉，正是排查唯一依据 |
| lane 被他人探针污染 | `testMatch` 含 `probe-zero-roi`，实测 `Running 2 tests`（第 2 条为无断言的 `console.log` 探针），与文档"末行 1 passed"不符 | 门禁信号被稀释；文档与事实不一致 |
| 归属误判（Lead 自身错误） | Lead 曾把 `probe-zero-roi.spec.ts` 归给 bug-prober；bug-prober 以 `grep` 零命中 + mtime 同刻证据否认，Lead 核对确认系 journey-runner 所写 | 已发更正；记录在此以示不自掩 |

---

## 5. 一键复跑

```bash
# 1. 门禁三连
pixi run lint && pixi run test
STRADITIZE_E2E_PORT=22901 pixi run test-contract

# 2. 从零旅程（Lead 独立复跑实测 1 passed / 9.3s）
npm --prefix frontend run build
cd frontend && STRADITIZE_ZERO_PORT=22926 npx playwright test --config=playwright.zero.config.ts

# 3. Lead 自己下过结论的两条复现
pixi run python scripts/lead_probe/xticks_wipe_threshold.py     # x_ticks 触发条件表
pixi run python scripts/lead_probe/race_strength.py         # 撕裂读强度
```

---

## 6. Lead 对 teammates 两条 P1 发现的**独立复现**（用自己的脚本，不复用对方实现）

### 6.1 【P1】换图后旧几何在新图上继续剔除墨迹（对应 dynamic-probes.md 的 F-2）

Lead 独立脚本：`scripts/lead_probe/verify_f2_cross_image.py`（纯进程内，不依赖对方脚本）。

```bash
$ pixi run python scripts/lead_probe/verify_f2_cross_image.py
① hoya 上确认 line_v_7(width=3) 后 geometry_removed_pixels = 834
② 切到 beginner: 尺寸=1923x1796 新ROI id='roi_1'
   残留几何=24 条（切图前 24 条），其中 status=removed=1 条
   残留 removed 条目: [{'id': 'line_v_7', 'roi_id': 'roi_1'}]
   ⚠️ 新 ROI id 与旧几何 roi_id 是否同名: True
③ 新图上（带残留几何）: geometry_removed_pixels = 2400
   清空几何后            : geometry_removed_pixels = 0
   >>> 残留几何在新图上多剔除 = 2400 像素
```

**结论**：与对方报告的数字（2400 px）一致。根因已用源码核对：
`session_parts/core.py:246-269` 的 `load_image` 清理清单**不含** `line_candidates` /
`exclusion_regions` / `line_strokes`（awk 抽取该段后 grep 这三者 = 0 命中）；
`session_parts/roi.py:23-25` 的 `_init_rois()` 把 `_roi_counter` 归零 → 新图 ROI 又铸 `roi_1`；
`session_parts/cleanup.py:193` 的 `if cand.get("roi_id") != roi_id: continue` 因此失效。

### 6.2 【P1】重分列静默回滚后端已接受的 ROI（对应 dynamic-probes.md 的 F-1）

Lead 独立脚本：`scripts/lead_probe/verify_f1_roi_rollback.py`。
该脚本**刻意分成两组对照**，以排除"后端自身行为"这一竞争解释：

```bash
$ pixi run python scripts/lead_probe/verify_f1_roi_rollback.py
A 后端 roi.update 后     : [355.0, 1906.0]
A 重分列(传新bounds)后   : [355.0, 1906.0] ← 保持新值，非后端自身回滚

B 后端 roi.update 后     : [355.0, 1906.0] （旧镜像仍是 [315.0, 1946.0]）
B 重分列(传旧bounds)后   : [315.0, 1946.0] ← **被回滚**
   >>> 用户改的 ROI 被静默退回旧值，且无任何错误/提示
```

**结论**：后端**不会**自己回滚；回滚只在"前端把旧 bounds 传进 `core.detectColumns`"时发生。
这精确坐实了对方的因果归因。前端侧的旧镜像来源已用源码核对：
`frontend/src/services/WorkflowController.ts:154-172` 用 `this.canvasComponent.data.rois`
（前端镜像）构造 `detectColumnsInRoi` 参数。

### 6.3 Lead 复核意见（对 F-6 撕裂读的定级）

对方把 F-6 从 P2 降为 **P3**，理由：撕裂态下前端只表现为"有图无 ROI 框"，下一次刷新即恢复，
未能构造出"用户看着错误界面停留并误判"的场景。**Lead 同意该降级**，理由与 Lead 自己的
实测一致（§3.3：撕裂瞬时自愈，并发结束后静态回读已恢复为 `rois:1, primaryRoiId:"roi_1"`）。
不把它写成"数据永久损坏"是对的。

---

## 7. 【Critical】Lead 独立复现：进入步骤 6 时前端**自己**写入从未有人读过的刻度值

> 这是本次审计中**最严重**的一条：它直接撞上 `docs/ARCHITECTURE.md` §2 第一条不变量
> 「面向用户的数据只有唯一合法来源：后端对用户输入的真实计算」。
> Lead 用**自己的脚本**独立复现（未复用静态审计子代理的实现）。

### 7.1 复现（真实 Edge，全程零用户标定输入）

```bash
$ STRADITIZE_ZERO_PORT=22915 pixi run python scripts/lead_probe/serve_zero.py &
$ STRADITIZE_ZERO_PORT=22915 node scripts/lead_probe/verify_f01_fabricated_ticks.mjs
  advance#1 -> stage=2
  advance#2 -> stage=3
  advance#3 -> stage=4
  advance#4 -> stage=5
  advance#5 -> stage=6
{
  "stage": 6,
  "用户填过的标定输入框次数": 0,
  "calibrateXTicks_请求数": 8,
  "请求体前3个": [
    { "col_index": 0, "ticks": [ {"px": 322, "value": 0}, {"px": 493, "value": 20} ], "unit": "%" },
    { "col_index": 1, "ticks": [ {"px": 497, "value": 0}, {"px": 722, "value": 20} ], "unit": "%" },
    ...
  ],
  "后端已标定列数": 8,
  "后端总列数": 29
}
```

用户的操作只有"点 5 次【下一步】"，**从未填过任何标定输入框**。
但后端收到了 **8 次** `column.calibrateXTicks`，且每个请求体的两个读数**恰好是字面量 `0` 与 `20`**。

### 7.2 根因（file:line，Lead 已核对源码）

- **触发**：`frontend/src/services/WorkflowController.ts:204` —— 进入步骤 6 时若发现没有任何列
  有 `detected_ticks`，就 `queueMicrotask(() => document.querySelector('#btn-detect-xticks').click())`，
  **自动**替用户点了"自动提取刻度"按钮。
- **伪造值**：`frontend/src/services/InspectorBridge.ts:361-363` —— 构造读数时：

  ```ts
  const val1 = col.x_ticks?.[0]?.value ?? 0;                 // ← 没有就填 0
  const val2 = col.x_ticks?.[1]?.value ?? col.maxPercent ??
               (item.ticks.length > 2 ? (item.ticks.length - 1) * 10 : 20);  // ← 没有就填 20
  ```

  即：**当用户从未标定时，前端拿 `0` 与 `20` 两个硬编码字面量冒充"用户的读数"**，
  再通过 `rpcClient.calibrateColumnXTicks(...)` 写进后端。

### 7.3 为什么这是 Critical（而不是"自动标定很方便"）

1. 这**不是**"算法检测刻度位置"——像素位置（`px`）确实来自图像分析，那部分是真的。
   被伪造的是**读数（`value`）**：`0` 与 `20` 不是从图上读出来的，是写死的常量。
2. 这两个数直接决定导出 CSV 里该属种的百分比换算。`docs/ARCHITECTURE.md` §9.4 原文：
   「每列刻度值只能人读，不得填默认值冒充」——此处的实现正是"填默认值冒充"。
3. 界面**全程显示成功**（HUD 报"已成功识别并标定 8 个属种列的刻度齿"），
   用户无从分辨"这 8 列是真标定还是系统替他填的"。
4. 静态审计子代理另测到：这 8 个"已标定"列的标度互不一致（2.45 ~ 11.25 px/1%），
   进一步证明它们不可能来自任何真实的统一读数。

**这一条与 journey-runner 的 F-1（"刻度只标定 8/28 列"）是同一处代码的两个不同侧面**：
F-1 看的是"覆盖率不全"，本条看的是"补上的那 8 列用的是伪造读数"。后者严重得多。

### 7.4 处置建议（只报不改，交用户决断）

最小修法：`InspectorBridge.ts:361-363` 的 `?? 0` / `?? 20` 应改为**取不到就拒绝标定并告知用户**
（例如跳过该列并累计"待人工标定"计数），而不是填默认值。这与 §2 的"取不到就报错并停在原地"一致。
`WorkflowController.ts:204` 的自动点击本身可以保留（自动**检测位置**是合理的），
但检测结果**不得**被自动升格为"已标定"。

---

## 8. Lead 对三条争议的最终裁决（含承认自己的错误）

### 8.1 裁决 A：x_ticks 被抹的判据 —— **verifier 正确，Lead 错误**

verifier 推翻了 Lead 与两位队友共同的归因（"判据是列数变化"）。Lead 亲自复验
（`scripts/lead_probe/xticks_scan_decide.py`，逐像素扫描左边界 0→29）：

```
首次被抹出现在 Δ左 = 18（此时列数仍是 28->28，preserve_state 为真）
列数首次变化出现在 Δ左 = 22
```

**结论**：真判据是 `session_parts/core.py:742-746` 的**区间守卫越界**
（`lo = min(start,end)-10`，`hi = max(start,end)+10`，`tick_px` 落在区间外即丢弃），
列数变化只是伴随现象。verifier 用更细的扫描粒度把两者分离，方法上胜出。
Lead 已在 §2 加更正标注。**这正是设置独立复核的价值：连 Lead 的结论也被推翻。**

### 8.2 裁决 B：static F-06（导出预览 Depth 全 0.0）—— **verifier 证伪，采纳其结论**

verifier 用 rolldown 打包**真实产品源码**（`CoordinateSystem.ts` + `SplineInterpolator.ts`）
执行，证明未标定时 `calibrationBounds()` 首行 `if (!cal || !cal.isCalibrated) return null`
→ `getStandardDepthHorizons()` 返回空数组，**代码层面不可能产出 314 行 `0.0`**；
且 from-zero 旅程第 3 步就完成 Y 标定，**永远到不了该状态**。

**结论**：该条从"已确认"移入"未复现/证伪"。静态审计子代理已中断，无法追问其观测细节，
按"证据不足者不得进已确认清单"处理。

### 8.3 裁决 C：probes F-1（ROI 回滚）严重度 —— **采纳 verifier 的降级建议：P1 → P2**

Lead 核对源码确认 verifier 的论据成立：

- `frontend/src/core/tools/RoiToolStrategy.ts:74` —— 用户拖 ROI 手柄时 `ctx.callbacks.onRoiCommitted(...)`
- → `frontend/src/main.ts:273-277` → `void cleanupManager.commitRoi(roi)`
- → `frontend/src/services/CleanupManager.ts:148` `this.syncActiveRoiBounds(roi)`
- → `CleanupManager.ts:154-170` 里 `list[idx] = { ...list[idx], xMin, xMax, yMin, yMax, xlim: [x0, x1] }`

即 **UI 主路径会同步前端镜像**（`commitRoi` 的两个调用点：`main.ts:495`、`InspectorBridge.ts:537`）。
对方的最小复现用 `page.request` 直调 `roi.update`，**绕过了 `commitRoi`**，因此测到的
"镜像从不同步"在真实 UI 路径上不成立。

**但缺陷本体不消失**：Lead 独立复现证明，只要把**旧 bounds** 传给 `core.detectColumns`，
后端就会用参数覆写 `rois[].xlim`（`session_parts/core.py:601-619`），把已接受的 ROI 改回旧值
（§6.2 的 A/B 对照：传新 bounds 保持新值，传旧 bounds 被回滚）。真实危害取决于
"镜像何时会与后端不一致"——存在这个窗口，但不像对方描述的那样无条件发生。

**结论**：定 **P2**（条件性失效，需镜像与后端失同步才触发），并保留"后端会用参数覆写 ROI"
这一结构性问题（它是这条缺陷的放大器）。

---

## 9. Lead 独立复核其余 P2/P3 断言（本报告发布的每条都由 Lead 亲验）

### 9.1 B-05 草稿恢复只写前端镜像 —— **确认**

`frontend/src/main.ts:717-726`（`#btn-restore-draft` 的 click handler）逐行核对：
`canvasComponent.loadNewDiagram` / `history.reset` / `sidebar.updateData` / `inspector.updateData` /
`toolbar.updateHistoryState` / `updateFooter` —— **零个 RPC**（对该段 grep `rpcClient|\.call\(|await this\.rpc` = **0 命中**）。
即恢复只把前端镜像换成草稿内容，后端会话完全没动。

### 9.2 B-07 重置必然产生 -32001 —— **确认（Lead 真实 Edge 实测）**

```bash
$ STRADITIZE_ZERO_PORT=22916 node scripts/lead_probe/verify_b07_reset_error.mjs
{
  "重置前列数": 0, "重置前列数_rois": 1,
  "重置后列数": 0, "重置后rois": 0,
  "重置触发的失败RPC": [
    "algorithm.applyLineRemoval [-32001] 前置状态缺失：未找到 ROI 'roi_1'。请在【步骤 2: ROI】中先创建或选取该有效区。"
  ]
}
```

**结论**：点【重置全部操作】必然产生**恰好一条** `-32001`，方法名是 `algorithm.applyLineRemoval`。
因果链：`ToolbarBridge.ts:131-141` → `p.rpcClient.resetProjectState()`
（`RpcClient.ts:683-691`，内部 `await this.call('project.new', {})`）→ 后端清零 ROI
（`session_parts/project.py:114`）→ 前端随后仍按旧 id 重算掩膜 → 命中"未找到 ROI 'roi_1'"。
重置**本身生效**（rois 1 → 0），所以这是**错误文案与真实原因错位**，不是"重置坏了"。

### 9.3 报告引用更正

`bug-report.md` 的 B-05 原引 `main.ts:717-726`（与 verifier 一致），
Lead 实测该段确实是草稿恢复的 click handler（`sed -n '710,732p'` 可核）。

### 9.4 B-06 撤销覆盖不到 `x_ticks` —— **确认（Lead 实验证明）**

```bash
$ pixi run python scripts/lead_probe/verify_b06_undo_xticks.py
标定前 col0.x_ticks = None
标定后 col0.x_ticks = [{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]
undo 栈深度 = 2
history_undo -> {'success': True, 'action': 'Calibrate X-Ticks for col01'}
undo 后 col0.x_ticks = [{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]

>>> 撤销后 x_ticks 是否仍在（若在 => 撤销覆盖不到它）: True
```

**精确机制（Lead 源码核对）**：`xticks.py:161-163` 在**写完 `col["x_ticks"]` 之后**
才调 `_record_history("Calibrate X-Ticks for …")`；而 `_record_history`
（`project.py:29-54`）用 `[dict(c) for c in self.columns]` 做的是**浅拷贝快照**，
此时 `x_ticks` 已被写入 → 快照里带着**标定后**的值。
`history_undo`（`project.py:83`）随后 `self.columns = prev["columns"]` 恢复的正是那份"标定后"快照。

**所以撤销动作的语义是坏的**：它返回 `success: True` 且 `action` 名字正确
（`Calibrate X-Ticks for col01`），但**实际什么都没回退**——用户的 `x_ticks` 原样保留，
而一格撤销栈被消耗掉。这比"撤销不可用"更难察觉：栈确实在动，只是动的不是用户以为的那个东西。

**修复方向**：`_record_history` 必须在**写入之前**调用（或改为深拷贝 + 显式带 `x_ticks` 字段）。
