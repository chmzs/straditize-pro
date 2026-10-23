# Straditize Pro 缺陷报告（从零旅程审计）

> 本报告**合并**四份独立来源的发现，并经第五方独立复核后定级。
> 生成日期：2026-10-19 ｜ 分支 `main` @ `caaac01` ｜ 环境：Windows 11 + pixi + 系统 Edge
>
> **证据原则**：每条发现都必须有"真实命令 + 真实输出"。
> 复核结论引用 [`verification.md`](./verification.md) 的四态判定
> （`REPRODUCED` / `NOT_REPRODUCED` / `PARTIAL` / `UNCERTAIN`）。
> **未验证的怀疑一律不列入本报告正文**，集中在 §4。

---

## 0. 来源与合并关系

| 来源 | 产出 | 发现的编号 |
| :--- | :--- | :--- |
| journey-runner（走通旅程） | [`journey-log.md`](./journey-log.md) | F-1 … F-4 |
| bug-prober（对抗性破坏） | [`dynamic-probes.md`](./dynamic-probes.md) | F-1 … F-8 |
| 静态审计子代理（只读） | [`static-audit.md`](./static-audit.md) | F-01 … F-08 |
| **Lead 本人实测** | [`lead-measurements.md`](./lead-measurements.md) | §2、§3、§6、§7 |
| **verifier 独立复核** | [`verification.md`](./verification.md) | 四态判定 + 推翻 3 条 |

**去重说明**：同一缺陷常被多方独立发现。本报告按"缺陷本体"合并，标注全部来源编号。
例如"步骤 6 编造读数"被 journey-log F-1 与 static F-01/F-02/F-08 分别撞到，
它们是**同一处代码的不同侧面**，合并为 **B-01**。

---

## 0.5 修复状态（2026-10-19 晚，本轮已改代码）

> 本节是**修复**记录。下面 §2 的发现正文保留"发现时"的原始描述（含当时的证据），
> 不追写；修复内容集中记在这里，便于核对「改了什么 / 怎么验证」。

| 缺陷 | 状态 | 改动位置 | 验证 |
| :--- | :--- | :--- | :--- |
| **B-01 编造刻度读数（Critical）** | ✅ **已修** | `straditize_core/session_parts/xticks.py`（刻度带搜索夹到 ROI 内）+ `frontend/src/services/InspectorBridge.ts`（去掉 `?? 0`/`?? 20`，无读数则只记齿位、不写 `x_ticks`） | 零输入实测 `calibrateXTicks_请求数: 8 → 0`；hoya 检出 `band=None, ticks=0`（真值一致）；有刻度尺的图仍检出 65/120 齿；回归钉子 `workflow-panels.spec.ts` |
| 步骤 8 导出按钮不可点（新发现） | ✅ **已修** | `frontend/src/components/steps/QaPanel.ts`（`onDataChange` 加摘要指纹，打断 `mount→summarize→onDataChange→render→mount` 无限重挂） | `journey.spec.ts` 由红转绿；全量 e2e 中 `qa.spec`/`step4-cleanup` 的连锁红一并消失 |
| 测试基建：lane 串跑 | ✅ **已修** | `frontend/playwright.config.ts`（`testIgnore` 排除零状态 spec）+ `frontend/playwright.zero.config.ts` + `pixi run test-e2e-zero` | `--list` 验证：基线 lane 0 条、零状态 lane 2 条 |
| 测试基建：视口顺序污染 | ✅ **已修** | `frontend/e2e/helpers.ts`（`resetBaseline` 后按 `F` 复位视口） | `step6-xticks + step-visibility` 组合 11 项全绿（此前稳定红，Received `-392776`） |

**根因链（B-01 完整版，比 §2 更深一层）**：
`detect_xticks_rpc` 的刻度带搜索窗口是 `range(y_bottom-4, y_bottom+16)`，
**允许越出 ROI 下方 16px**；于是在 ROI 之外抓到了列框线（长竖线，实际 run 最长 1162px，
远超 `TICK_MAX_RUN=12`），对一张**没有刻度尺**的图报出 53 个伪齿、8 列"可用"。
前端再拿 `0`/`20` 当读数写进后端 → 导出数值被污染。
修法：搜索窗口夹到 ROI 纵向范围内（越界候选直接跳过）。

**当前门禁（本轮实测）**：
`pixi run lint` exit 0 ｜ `pixi run test` 317 passed / 3 skipped ｜
`pixi run test-e2e` **85 passed**（修复前 82 passed / 5 failed）｜
`pixi run test-e2e-zero` 2 passed。

---

## 1. 结论摘要

| ID | 严重度 | 一句话 | 复核结论 | 来源 |
| :--- | :--- | :--- | :--- | :--- |
| **B-01** | **Critical** | 进入步骤 6 时前端**自己**为 8 个列写入从未有人读过的刻度值（字面量 `0` + 硬编码 `20`），**实测改变 6362 个导出数值格，最大偏差 31.51 个百分点** | REPRODUCED | journey F-1、static F-01/F-02/F-08、Lead §7 |
| **B-02** | **P1** | 挪 ROI 左边界 ≥18px 即**静默清空**该 ROI 全部列的 `x_ticks`，无任何提示；同一读数换算值随之改变 | REPRODUCED（判据经 verifier 更正） | journey F-4、probes F-3、static F-07、Lead §2 |
| **B-03** | **P1** | 换图/新建项目后旧清理几何残留并在**新图**上继续剔除墨迹（1 条残留 → 2400 px；24 条 → 13454 px） | REPRODUCED | static F-03、probes F-2/F-5、Lead §6.1 |
| **B-04** | **P2** | 重分列时前端把旧 ROI 镜像当权威传给后端，可静默回滚后端已接受的 ROI 改动 | PARTIAL（可达性被降级） | probes F-1、Lead §6.2/§8.3 |
| **B-05** | **P2** | 自动存档草稿【恢复】只写前端镜像：界面显示 28 列而后端 0 列 | REPRODUCED | probes F-8 |
| **B-06** | **P2** | 撤销不覆盖 `x_ticks`：标定后 `Ctrl+Z` 状态不动却消耗一格撤销栈；`Ctrl+Z` 还可把前端列清成 0 列而后端仍 29 列 | PARTIAL | static F-04/F-05 |
| **B-07** | **P2** | 【重置全部操作】**必然**触发一条 `-32001` 失败并弹红框（错误文案与真实原因错位） | REPRODUCED | probes F-4 |
| **B-08** | **P3** | 无锁共享会话：两标签页并发读会拿到撕裂态（瞬时自愈，单标签页测不出） | REPRODUCED（降级为 P3） | probes F-6、Lead §3 |
| **B-09** | **P3** | `FileLoaderService` 保留 `verification` 范例名映射，但工具栏已删该选项（仅直调可达） | REPRODUCED | probes F-7 |
| **B-10** | **P3** | `loadImage` 的"半完成状态"（尺寸先落地、ROI 后落地约 350ms）是测试盲区来源 | REPRODUCED | journey F-3 |

**已证伪 / 移出**：static F-06（导出预览 Depth 全 `0.0`）→ `NOT_REPRODUCED`，见 §3。

**既有门禁状态**：全绿，无 P0。`pixi run lint` exit 0；`pixi run test` 317 passed / 3 skipped；
`STRADITIZE_E2E_PORT=22901 pixi run test-contract` 5 passed（Lead 实测），
verifier 在 22961 独立复跑同为 5 passed。**本次审计未修改任何产品源码**（`git diff --stat` 为空）。

---

## 2. 详细发现

### B-01【Critical】步骤 6 自动写入从未有人读过的刻度值，直接改变导出科研数值

**用户可见症状。** 用户在步骤 5 分完列、点【下一步】进入步骤 6。界面**立刻**显示
8 个列"已标定"、进度 `8 / 29 列`、并提示"自动检测完成：已成功识别并标定 8 个属种列的刻度齿！"。
用户**从未填过任何读数输入框、也从未在图上点过刻度齿**。这 8 列的标度随后直接决定导出 CSV 的百分比。

**最小复现（Lead 独立实测，真实 Edge，零用户标定输入）**

```bash
STRADITIZE_ZERO_PORT=22915 pixi run python scripts/lead_probe/serve_zero.py &
STRADITIZE_ZERO_PORT=22915 node scripts/lead_probe/verify_f01_fabricated_ticks.mjs
```

**真实输出**

```
  advance#1 -> stage=2 … advance#5 -> stage=6
{
  "stage": 6,
  "用户填过的标定输入框次数": 0,
  "calibrateXTicks_请求数": 8,
  "请求体前3个": [
    { "col_index": 0, "ticks": [ {"px": 322, "value": 0}, {"px": 493, "value": 20} ], "unit": "%" },
    { "col_index": 1, "ticks": [ {"px": 497, "value": 0}, {"px": 722, "value": 20} ], "unit": "%" },
    …
  ],
  "后端已标定列数": 8,
  "后端总列数": 29
}
```

用户操作只有"点 5 次【下一步】"，却产生 **8 次** `column.calibrateXTicks`，
每个请求体的两个读数**恰为字面量 `0` 与 `20`**。

**根因（file:line，Lead 与 verifier 均已核对）**

| 环节 | 位置 | 事实 |
| :--- | :--- | :--- |
| 自动触发 | `frontend/src/services/WorkflowController.ts:204` | 进入步骤 6 若没有任何列有 `detected_ticks`，`queueMicrotask` **自动点击** `#btn-detect-xticks` |
| 编造读数 | `frontend/src/services/InspectorBridge.ts:361-363` | `val1 = col.x_ticks?.[0]?.value ?? 0`；`val2 = … ?? col.maxPercent ?? (item.ticks.length > 2 ? (item.ticks.length-1)*10 : 20)` |
| 常量来源 | `straditize_core/session_parts/core.py:649-650, 673-674` | `detect_columns` 硬编码 `"startValue": 0.0` / `"tickValue": 20.0` → 作为 `maxPercent` 流到前端 |

**关键区分**：像素位置（`px`）确实来自图像分析，那部分是真的；
被伪造的是**读数（`value`）**——`0` 与 `20` 不是从图上读出来的，是写死的常量。

**为什么是 Critical —— 决定性证据（verifier 平行对照实验）**

两个会话唯一差别是"有没有走那 8 次自动标定"，走**同一个** `export_data`：

```
会话 A：自动标定次数 = 0   csv 行数 = 802   已标定列 = 0 / 28
会话 B：自动标定次数 = 8   csv 行数 = 802   已标定列 = 8 / 28
有差异的行 = 800 / 801
有差异的格 = 6362
最大绝对差 = 31.5083
  行172 列col02  legacy=50.75  编造后=19.2417  Δ=31.5083
px/1% 分布: min=2.10 max=10.55 倍数=5.02x
```

同一张图、同一横轴、相邻属种列的 `px/1%` 差 **5.02 倍** —— 物理上不可能来自真实刻度读数。

**它还会污染 QA 与就绪清单**（verifier `v11_trigger.py` K5）：

```
复刻写入 8 列
qa.n_uncalibrated = 20
export.getReadiness.readiness_missing = []
```

即 QA 把这 8 列当作**已标定**放过，就绪清单**不再报缺**。
用户在步骤 8 看到的"通过"，建立在这 8 个编造值上。

**违反的不变量**

- `docs/ARCHITECTURE.md:44-45`（§2）：「面向用户的数据只有唯一合法来源：后端对用户输入的真实计算。取不到就报错并停在原地，**绝不返回替代数据**。」
- `docs/ARCHITECTURE.md:333`（§9.4）：「每列刻度值只能人读，不得填默认值冒充。」

**⚠️ 合并说明：journey-log F-1 的表述必须改写。**
它把这同一处代码描述为"自动提取刻度只标定 8/28 列，另外 20 列被静默跳过"，
并称"数据链是诚实的"。verifier 明确裁定：**F-1 显著低估**——
"数据链是诚实的"这句只对**另外 20 列**成立；对这 8 列，正是它自己描述的那种"会被写进论文的错数字"。
两者不是两个缺陷，是同一缺陷的两种叙述，**以 Critical 叙述为准**。

**修复建议（只报不改，交用户决断）。** 方案 A（推荐）：
`InspectorBridge.ts:361-363` 的 `?? 0` / `?? 20` **必须去掉**，取不到读数就**拒绝标定并告知用户**
（跳过该列并累计"待人工标定"计数），符合 §2 的"取不到就报错并停在原地"。
自动**检测位置**可以保留（合理），但检测结果**不得**被自动升格为"已标定"。

---

### B-02【P1】挪 ROI 边界 ≥18px 即静默清空全部列的 `x_ticks`

**用户可见症状。** 用户在步骤 6 标定了若干列，之后（回步骤 2 微调 ROI 手柄，
或退回步骤 5 重新分列）只要挪动幅度足够，**该 ROI 所有列的标定值全部消失**，
面板进度回到 `0 / N`，且**没有任何提示**。用户只能重标一遍。

**最小复现（Lead 决定性实验）**

```bash
pixi run python scripts/lead_probe/xticks_scan_decide.py
```

**真实输出（逐像素扫描左边界）**

```
   Δ左        列数     保留?      守卫通过?   tick_px
    0   28->28        是         是     322.0
   17   28->28        是         是     322.0
   18   28->28        否         否     322.0  ← 首次被抹（列数未变！）
   19   28->28        否         否     322.0
   22   28->27        否         否     322.0  ← 列数才首次变化
首次被抹出现在 Δ左 = 18
```

**判据（经 verifier 更正，Lead 已复验采纳）**：真判据是**区间守卫越界**。
守卫来自 `straditize_core/session_parts/core.py:742-746`：
`lo = min(start,end) - 10`、`hi = max(start,end) + 10`，刻度像素落在区间外即被丢弃。
首次被抹（Δ=18）时列数**仍是 28→28**，证明"列数变化"不是判据——
列数变化（Δ=22 起）只是更大位移下的**伴随现象**。

> **更正记录（Lead 自身的错误）**：Lead 最初把判据写成"列数是否变化"，
> journey-log F-4 与 static F-07 也持同样归因。verifier 用更细的扫描粒度把两者分离后推翻，
> Lead 亲自复验确认，已在 [`lead-measurements.md`](./lead-measurements.md) §2 与 §8.1 加更正标注。
> **三份报告的现象都对，归因都错。** 这正是独立复核的价值。

**数据完整性后果（同一物理读数换算值改变）**

```bash
pixi run python scripts/lead_probe/xticks_wipe_impact.py
```

```
标定后   x_ticks=[{px:322,value:0},{px:480,value:20}]  source='x_ticks' calibrated=True
         同一像素宽度 110px → 按 x_ticks 换算 = 13.9241 %
重分列后 x_ticks=None                                  source='legacy'   calibrated=False
         同一像素宽度 110px → 按 legacy 列宽百分比换算 = 47.6190 %
```

**违反的不变量。** `docs/ARCHITECTURE.md:44-45`（§2）的反向违反：
系统**丢弃了用户已有的数据**却静默通过。
注意 §6.0-2（`:169`）字面写的是"若本 ROI 列数不变…自动回填"——
文档如实描述了当前实现，所以这**不是实现违反文档，而是设计缺口**；
但守卫失败时"不写、不报、不计"的静默丢弃，与 §2 的立意冲突。

**附带确认**：`frontend/e2e/step6-xticks.spec.ts:117-120` 的注释早已记录此开放缺陷
（"重新分列目前会静默抹掉全部列的 x_ticks"）。**该注释仍然成立**，
本报告为它补上精确触发阈值（≥18px）与根因行号。

**修复建议**：守卫失败时要么按索引/相对位置尽力迁移 `x_ticks`，要么**显式告知**用户
"列数/边界已变化，标定已清空"。

---

### B-03【P1】换图后旧清理几何在新图上继续剔除墨迹

**用户可见症状。** 用户在图 A 上做了步骤 4 清理（确认了干扰线几何）。随后**直接上传图 B**，
步骤 4 的几何清单被原样带到图 B，其中 `status="removed"` 的继续在新图上剔除像素。
用户从未在图 B 上确认过任何几何。

**最小复现（Lead 独立实测）**

```bash
pixi run python scripts/lead_probe/verify_f2_cross_image.py
```

**真实输出**

```
① hoya 上确认 line_v_7(width=3) 后 geometry_removed_pixels = 834
② 切到 beginner: 尺寸=1923x1796 新ROI id='roi_1'
   残留几何=24 条（切图前 24 条），其中 status=removed=1 条
   残留 removed 条目: [{'id': 'line_v_7', 'roi_id': 'roi_1'}]
   ⚠️ 新 ROI id 与旧几何 roi_id 是否同名: True
③ 新图上（带残留几何）: geometry_removed_pixels = 2400
   清空几何后            : geometry_removed_pixels = 0
   >>> 残留几何在新图上多剔除 = 2400 像素
```

**剂量**（verifier 交叉确认）：1 条残留 → **2400 px**；24 条残留 → **13454 px**；空白对照 **0**。

**根因（file:line）**

- `straditize_core/session_parts/core.py:246-269` —— `load_image` 的状态清理清单里
  **没有** `line_candidates` / `exclusion_regions` / `line_strokes`
  （Lead 实测：抽取该段后 grep 这三者 = **0 命中**）。
- `straditize_core/session_parts/roi.py:23-25` —— `_init_rois()` 把 `_roi_counter` 归零，
  于是新图 ROI **又叫 `roi_1`**，与旧几何的 `roi_id` 同名。
- `straditize_core/session_parts/cleanup.py:193` —— `if cand.get("roi_id") != roi_id: continue`
  因此**完全失效**（本该挡住跨图几何的过滤条件被同名 id 绕过）。

**违反的不变量**：`docs/ARCHITECTURE.md:44-45`（§2）、§9-9（`:338`，"线掩膜只有一份、由后端产生"）。

**修复建议**：`project_new`（`session_parts/project.py:114`）与 `load_image`
（`session_parts/core.py:212`）都应调用 `self._init_cleanup()`。
`support/serve_e2e_backend.py:51-63` 已经证明了这是正确做法，只是没进产品路径。

---

### B-04【P2】重分列时前端旧 ROI 镜像可静默回滚后端已接受的改动

**症状。** 用户改小取数区（后端已接受、回读是新值），随后在步骤 5 点【下一步】重新分列，
ROI 可能被**改回旧值**且无任何提示。用户看到"分列成功"，实际分列用的是旧取数区。

**后端因果链（Lead 独立复现，A/B 对照）**

```bash
pixi run python scripts/lead_probe/verify_f1_roi_rollback.py
```

```
A 后端 roi.update 后     : [355.0, 1906.0]
A 重分列(传新bounds)后   : [355.0, 1906.0] ← 保持新值，非后端自身回滚

B 后端 roi.update 后     : [355.0, 1906.0] （旧镜像仍是 [315.0, 1946.0]）
B 重分列(传旧bounds)后   : [315.0, 1946.0] ← **被回滚**
```

**结论**：后端**不会**自己回滚；回滚只在"前端把旧 bounds 传进 `core.detectColumns`"时发生。
后端侧放大器：`session_parts/core.py:601-619` 收到参数后**覆写** `rois[].xlim`。

**⚠️ 可达性被 verifier 部分推翻 —— 严重度定为 P2（原报 P1）**

probes F-1 称"前端镜像没有任何再同步"。verifier 与 Lead 共同核对源码，**该说法不成立**：

```
frontend/src/core/tools/RoiToolStrategy.ts:74  ctx.callbacks.onRoiCommitted?.({...roi})   ← 拖拽手柄
  → frontend/src/main.ts:273-277              void cleanupManager.commitRoi(roi)
  → frontend/src/services/CleanupManager.ts:148  this.syncActiveRoiBounds(roi)
  → CleanupManager.ts:154-170                  list[idx] = { ...list[idx], …, xlim: [x0, x1] }
```

即 **UI 主路径会同步前端镜像**（`commitRoi` 的调用点：`main.ts:495`、`InspectorBridge.ts:537`）。
对方的实测用 `page.request` 直调 `roi.update`，**绕过了 `commitRoi`**，故测到的
"镜像从不同步"在真实 UI 路径上不成立。

**定级理由**：缺陷本体仍在（只要镜像与后端失同步就触发），但不像原报告描述的那样无条件发生，
属**条件性失效**，故 P1 → **P2**。若要维持 P1，需要一次**真实鼠标拖拽**的浏览器复现。

**误引不变量更正**：probes F-1 引 §6:174-175（ROI↔深度/时间标定不得耦合）来论证
"分列改写 ROI"，二者不是同一约束。**应改引 §2**（`:44-45`）。

---

### B-05【P2】自动存档草稿【恢复】只写前端镜像

**症状。** 从自动存档草稿恢复后，界面显示 28 列，而后端仍是 0 列——用户对着一个
后端并不存在的状态继续操作。

**根因**：`frontend/src/main.ts:717-726` 恢复草稿的整段代码**零个 RPC**（verifier 确认）。
违反 §2（`:44-45`）。

**复核**：REPRODUCED（probes F-8；verifier 确认 `main.ts:717-726` 无 RPC）。
**更正记录**：probes F-8 最初引 §9-11，核对后该条讲"ROI 外数据"，与草稿无关，
已改为只引 §2（`dynamic-probes.md` §6.1 有自查表）。

---

### B-06【P2】撤销不覆盖 `x_ticks`；`Ctrl+Z` 可把前端列清成 0 列

**症状（两个侧面）。**
① 标定后 `Ctrl+Z`，标定状态**纹丝不动**，却照样消耗一格撤销栈；
② `Ctrl+Z` 可把前端列数组清成 **0 列**，而后端仍是 29 列 —— 用户看到曲线消失、
侧栏与面板进入空态，实际后端数据完好。

**根因（file:line，Lead 实验 + 源码核对）**：`xticks.py:161-163` 在**写完 `col["x_ticks"]` 之后**
才调 `_record_history(...)`；而 `_record_history`（`session_parts/project.py:29-54`）
用 `[dict(c) for c in self.columns]` 做**浅拷贝快照**，此时 `x_ticks` 已被写入，
快照里带的是**标定后**的值。`history_undo`（`project.py:83`）恢复的正是那份"标定后"快照。

**Lead 实验证明（纯进程内）**

```bash
pixi run python scripts/lead_probe/verify_b06_undo_xticks.py
```

```
标定前 col0.x_ticks = None
标定后 col0.x_ticks = [{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]
undo 栈深度 = 2
history_undo -> {'success': True, 'action': 'Calibrate X-Ticks for col01'}
undo 后 col0.x_ticks = [{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]   ← 原样保留
```

**语义坏在哪**：撤销返回 `success: True` 且 `action` 名字正确，但**实际什么都没回退**，
却消耗掉一格撤销栈。这比"撤销不可用"更难察觉——栈确实在动，只是动的不是用户以为的那个东西。

**修复方向**：`_record_history` 必须在**写入之前**调用（或改深拷贝 + 显式携带 `x_ticks`）。

**复核**：PARTIAL —— 代码链与上述实验由 Lead 确认；浏览器侧 `Ctrl+Z` 清空列的观测数字
由静态审计子代理提供，verifier 只确认了代码链（未复跑其浏览器步骤，登记为其 U 项）。

---

### B-07【P2】【重置全部操作】必然触发 `-32001` 失败并弹红框

**症状。** 用户点【重置全部操作】，**每次**都会弹出一个后端失败红框（`-32001`），
但重置本身其实生效了 —— 错误文案与真实原因错位，用户会以为操作失败。

**根因**：后端 `project.new` 清零 ROI（`session_parts/project.py:114`），
前端随后**按旧 id** 重算清理掩膜，于是必然命中"前置状态缺失"。

**复核**：REPRODUCED（probes F-4；verifier 确认后端必然性）。
**建议定性**：不是"重置坏了"，而是"错误文案错位"——应改为不报错或报有意义的提示。
违反 §2（后端失败必须冒泡——此处是"必然失败"，属错位诊断）。

---

### B-08【P3】无锁共享会话导致撕裂读（瞬时自愈）

**症状。** 用户开两个标签页（一页切图/上传、另一页刷新），后一页可能读到
"有图宽、但 `rois: []`"的撕裂状态。**下一次刷新即恢复。**

**机制（file:line）**

- 服务端每请求一线程：`straditize_core/rpc_server.py:318` → `ThreadingHTTPServer(...)`
- 分发器**无任何锁**：`straditize_core/protocol.py:240` `class JsonRpcDispatcher`；
  在 protocol.py 内 grep `Lock|threading` → **零命中**
- 变更窗口：`session_parts/core.py` 先写尺寸，`:269 self._init_rois()`
  （`session_parts/roi.py:23-25` 清空 `rois`/`primary_roi_id`），再 `:272 self.roi_create(...)` 回填

**强度实测（Lead）**

```bash
pixi run python scripts/lead_probe/race_strength.py      # 8 轮，8/8 出现撕裂，6~14 次/轮
STRADITIZE_ZERO_PORT=22913 node scripts/lead_probe/twotab.mjs   # 两标签页：30 次撕裂
```

**可达性关键**：单标签页**测不出**（前端把请求串行化了，Lead 实测 6 轮 0 次）；
两标签页稳定复现（verifier 独立跑到 **297/360**）。

**为何是 P3 而非更高**：撕裂**瞬时自愈**（Lead 实测并发结束后静态回读恢复为
`rois:1, primaryRoiId:"roi_1"`）；且 verifier 静态分析确认前端不会把它渲染成误导界面
（`RpcClient.getDiagramData` 不补 `rois`，`GeologyCanvas.updateEmptyStateVisibility` 只认 `imageSrc`），
**未能构造出"用户看着错误界面停留并误判"的场景**。据此降级，不夸大为"数据永久损坏"。

**不构成 §3 违反**：§3（`:85`）原文说的是"多人"会互相覆盖，单用户开双标签页不是多人。

---

### B-09【P3】`verification` 范例名残留（文档残留）

`frontend/src/services/FileLoaderService.ts` 仍保留 `verification` 的显示名映射，
但 `frontend/src/components/Toolbar.ts` 已删除该 `<option>`（它需要的图片被 `.gitignore`
排除、全新克隆拿不到）。仅直调 RPC 可达，必得 `-32004`。**不违反**任何不变量，属文档残留。

---

### B-10【P3】`loadImage` 的"半完成状态"是测试盲区来源

`session_parts/core.py` 里 `load_image` 先写 `width/height`，跑完 `suggest_data_region()`
（连通域分析）后才 `roi_create`。实测尺寸到位时 `rois` 仍为空，**约 350ms 后** ROI 才出现。
用户感知不到（单次 RPC 内部瞬时态），但"轮询尺寸就断言 ROI 数量"会得到与产品无关的红。
建议与 B-08 合并理解为"同一窗口的两面"，不各占一个编号。

---

## 3. 已证伪 / 移出已确认清单

### static F-06「导出预览 Depth 全 `0.0`（314 行）」→ `NOT_REPRODUCED`

verifier 用 rolldown 打包**真实产品源码**（`CoordinateSystem.ts` + `SplineInterpolator.ts`）执行：

- `CoordinateSystem.calibrationBounds()` 首行 `if (!cal || !cal.isCalibrated) return null`；
- 返回 `null` 后 `SplineInterpolator.ts:142` 立即 `return { depths: [], yPositions: [] }`；
- `ExportModal.ts` 的 `depth_grid` 分支按 `depths.length` 造行 → **0 行**。

即 static F-06 所称的"314 行、`uniqueDepths: ["0.0"]`"在**代码层面无法出现**。
**第二重反证**：该状态的前提是"未做 Y 轴标定"，而 from-zero 旅程第 3 步就完成 Y 标定
（`journey-trace.json` `steps[3].backend.calibration = {isCalibrated: true, top_px: 511, …}`），
**主路径永远到不了那个状态**。

**处置**：移出已确认清单。若要保留，只能写成"未验证假设"，并注明
"代码路径在未标定时应得 0 行，与该观察矛盾，机理待查"。
（静态审计子代理自己已把其后端一半标为 U-03"未验证假设"，这是诚实的；
但把它列进了**已确认** findings 表，属超额声明。）

---

## 4. 未验证假设（**不得与上述确认发现混用**）

| ID | 假设 | 为何未验证 |
| :--- | :--- | :--- |
| H1 | 两标签页并发**写**会丢数据 | 6 组实验全部无损（标定 vs 重分列 0/6 丢；save vs new 正常），既证实不了也证伪不了；需源码注入 sleep，超出只读约束 |
| H2 | 撕裂读会让用户当真 | 静态分析认为不会（见 B-08），未能构造出场景 |
| H3 | `Inspector` 整块重挂吞掉正在输入的值 | **未复现**：后端 `calibration` 逐字段正确；稳定复现的只有**焦点被摧毁**（`activeElement` 恒为 `BODY`）。最小触发序列未确定 |
| H4 | `Ctrl+Z` 撤销不了清理编辑 | 文档称刻意设计，未构造用户路径 |
| H5 | `exaggeration_multiplier` 三处键名分裂致 UI 倍数到不了导出 | 未走完 UI 路径 |
| U-01 | `exclusion_regions` 载荷形状与前端 `CleanupOverlay` 期望不一致 | 两条路都没能造出非空 `exclusion_regions` 的会话 |
| U-02 | 顶栏【撤销】按钮同样会因空基线清空列 | 只复现了键盘 `Ctrl+Z` 路径 |
| U-05 | 真实扫描件下 B-01 的自动提取可能命中更多列，污染面更大 | 只有内置两张教程图可用 |

---

## 5. 修复优先级（按"阻止错误科研数值流出"排序）

1. **B-01（Critical）必须先修**：去掉 `InspectorBridge.ts:361-363` 的 `?? 0` / `?? 20`，
   取不到读数就拒绝标定并告知用户；自动检测**不得**自动升格为"已标定"。
2. **B-03（P1）**：`project_new` 与 `load_image` 都调用 `self._init_cleanup()`。
3. **B-02（P1）**：守卫失败时尽力迁移 `x_ticks`，或显式告知标定已清空。
4. **B-04（P2）**：`WorkflowController.ts:154-172` 不得用前端旧镜像构造分列参数；
   或让 `core.detectColumns` 不再覆写 `rois[].xlim`。
5. **B-06/B-07（P2）**：撤销栈覆盖 `x_ticks`；重置不再必然报错。
6. **B-05（P2）**：草稿恢复改为真正调后端。

---

## 6. 一句话总结

**从零旅程本身是通的**（空态可用、上传成功、八步全走、导出 111 行真实数据），
但过程中在"系统替用户写标定值"这条链上发现了一条 **Critical**：
前端用硬编码的 `0` 与 `20` 冒充用户读数写进后端，实测改变 6362 个导出数值格、最大偏差 31.51 个百分点，
而界面、QA 与就绪清单**全部显示"已标定 / 通过"**。
