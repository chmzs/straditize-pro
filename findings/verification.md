# 独立复核报告（verifier）

> 角色：独立复核者。对 `journey-log.md`、`dynamic-probes.md`、`static-audit.md`、
> `lead-measurements.md` 的**每条可判定断言**做独立复现，不复用他人脚本、不替对方修补证据。
> 写作用域：本文件 + `scripts/verify_zero_flow/`（我自己的复核脚本）。
> **本报告中所有命令与输出均由我本人跑出**，脚本源码同目录可查。

---

## 0. 本次复核的最终结论（先说结果）

**四态计数（§2 明细表共 20 条被核断言）：**

| 判定 | 条数 | 备注 |
| --- | --- | --- |
| `REPRODUCED` | **12** | 现象与结局均与我独立跑出的一致 |
| `PARTIAL` | **7** | 现象成立，但判据 / 剂量 / 可达性 / 归因之一不符 |
| `NOT_REPRODUCED` | **1** | static F-06（已证伪其代码可行性） |
| `UNCERTAIN` | **0** | 明细表内无"无法判定"项 |

另有 **8 条我明确无法复核的断言**（U1–U8），单独登记在 §4，**不计入上表**——
它们不是我判定为"不确定的缺陷"，而是"我没有独立证据"的断言，其中 U1 与 U2 直接影响
static F-06 与 dynamic-probes F-1 的最终定级。

**我推翻的断言（3 条独立结论，涉及 5 个 finding 编号，全部附反向证据）：**

1. **`static-audit.md` F-06 的前提被推翻。** 它称"未标定 Y 轴时导出预览 Depth 列 314 行全为 `0.0`"。
   我用真实产品源码（rolldown 打包 `CoordinateSystem.ts` + `SplineInterpolator.ts`）实测：
   未标定时 `getStandardDepthHorizons()` 返回 `depths.length === 0`，**不可能产出 314 行**。
   且 from-zero 旅程在第 3 步就完成了 Y 标定，**永远到不了那个状态**。F-06 应判 `NOT_REPRODUCED`（见 §3.1）。
2. **"重分列抹 `x_ticks` 的判据是列数变化"这一族结论被推翻**（涉及 3 个编号：
   `journey-log` F-4、`static-audit` F-07、`lead-measurements` §2.1）。
   我做了 0–89px 的逐像素单维扫描（只推 ROI 左边界，几何每次重建）：
   **首次被抹发生在 shift=18**（该行列数**仍是 28**，`preserve_state` 为真），
   首次列数变化在 **shift=22**。程序化判定输出：

   ```
   首次 x_ticks 被抹: shift=18  (该行 列数=28, 守卫=[323,507], px0=322)
   首次列数变化     : shift=22  (列数=27)
   首次越出守卫     : shift=18
   「列数已变但仍保留」的 shift 数 = 0
   ```

   真判据是**区间守卫越界**（`lo = col.start - 10 > 刻度 px0`），`preserve_state` 只是更大位移时的伴随结果。
   静默丢弃点在守卫的失败分支（不写、不报、不计）。三份报告的**现象**都对，**归因**都错。
3. **`dynamic-probes.md` F-3 的档位划分被推翻（阈值方向对，值不准）**。它写"阈值落在 (15,20)"——
   方向正确。精确边界我用逐像素扫描钉死（**顺序严格是"先在基准几何标定，再换几何重分列"**）：

   ```
   shift=14..17  lo=319..322  入界=True   -> 保留   ncols=28
   shift=18      lo=323       入界=False  -> None   ncols=28   ← 边界
   shift=19..21  lo=324..326  入界=False  -> None   ncols=28
   shift=22      lo=487       入界=False  -> None   ncols=27
   ```

   即边界是 **shift=18**（`lo = 322+1 = 323 > px0 = 322`，1px 之差）。它为 shift≥25 单列的
   "列数 28→27 整段错位"档是**伪独立档**：`x_ticks` 在 shift=18 就已归零，18–21 之间列数根本没变。
   真正的"列身份未迁移"是另一条缺陷（28→27 时 `col0.start` 从 322 跳到 497），不应混写。

   > 自我更正：我第一版穷举脚本把"标定"写在了"换几何分列"**之后**，于是 shift=15–17 也显示
   > `x_ticks=None`（因为标定被下一轮重建的列抹掉了），看起来像"边界在 15"。改成正确顺序后
   > 才得到 18。`v03_xticks_threshold.py` 的 C2 段顺序本来是对的，错的是我临时的一行式脚本——
   > 记录在此以免读者按错误版本复算。

**F-01 vs journey F-1 的裁决：`static-audit.md` F-01 的 Critical 定性成立，`journey-log.md` F-1 显著低估。**
关键证据（我自己跑的，见 §3.3）：同一张图、同一个 ROI、同一份几何，唯一差别是"有没有走前端那 8 次自动标定"，
两套导出 CSV 逐格比对有 **6362 个格不同、800/801 行不同、最大绝对差 31.51 个百分点**
（col02 行 172：legacy `50.75` → 编造后 `19.2417`）。这不是"覆盖不全"，是**写入从未有人读过的读数并直接改变导出数值**。

**既有门禁：全绿。** `pixi run lint` exit 0；`pixi run test` 317 passed / 3 skipped；`STRADITIZE_E2E_PORT=22961 pixi run test-contract` 5 passed。**无 P0。**

---

## 1. 环境与门禁真实输出

### 1.1 环境

```
$ git rev-parse --short HEAD
caaac01

$ pixi run python -c "import sys;print(sys.version)"
3.12.13 | packaged by conda-forge | (main, Mar  5 2026, 16:36:12) [MSC v.1944 64 bit (AMD64)]

$ node --version
v24.21.0
```

- Windows 11 Pro / Git Bash / pixi 环境 / 系统 Edge（`channel: 'msedge'`）
- 所有 Python 复核脚本都以 `STRADITIZE_CONFIG_PATH` 指向独立 `tempfile.mkdtemp()`（每次运行路径不同，
  例如 `C:\Users\chmzs\AppData\Local\Temp\verifier_cfg_pqnad4bf\config.json`），**未触碰** `~/.straditize/config.json`。
- 端口：`test-contract` 用 22961；journey 用 22921 / 22922（见 §1.4 的端口约束说明）。
- `git status --porcelain` 中**没有任何产品源码改动**（只有 4 份未跟踪的 findings 文档、1 份新 spec、
  1 份新 playwright 配置、1 个零状态启动器、3 个队友 scratch 目录）。我本人未修改任何产品源码。

### 1.2 `pixi run lint`

```
✨ Pixi task (lint-ruff): ruff check straditize_core tests: (Run ruff checks)
All checks passed!

✨ Pixi task (lint-consistency): python -X utf8 support/consistency_check.py: (...)
OK    A. 调用点 ↔ 函数签名
OK    A0. 签名源文件语法
OK    B. int|str 标注 ↔ 实现
OK    C. package-data 声明 ↔ 真实文件
OK    D. pytest python_files 覆盖
OK    E. 裸步骤数字（应走 WorkflowStage）
OK    G. 前端 RPC 方法名 ⊆ 后端注册表
OK    H. 协议层 ALL_RPC_METHODS ↔ 后端注册表
OK    I. 前端 RpcMethod 类型 ↔ 后端注册表
OK    J. pyproject.toml 依赖对账
OK    F. 注释残留旧 7 步编号

一致性核对通过
LINT_EXIT=0
```

### 1.3 `pixi run test`

```
✨ Pixi task (test): python -m pytest -q: (Run the FULL backend test suite ...)
........................................................................ [ 22%]
........................................................................ [ 45%]
........................................................................ [ 67%]
.sss..................................................... [ 85%]
..... [ 86%]
..........................................                       [100%]
317 passed, 3 skipped, 90 subtests passed in 159.04s (0:02:39)
TEST_EXIT=0
```

与 Lead 基线（317 passed / 3 skipped / 167.82s）**完全一致**，仅耗时不同。**无 P0，无既有用例变红。**

### 1.4 `STRADITIZE_E2E_PORT=22961 pixi run test-contract`

```
[WebServer] INFO [straditize_rpc]: Straditize JSON-RPC HTTP server started at http://127.0.0.1:22961/rpc
Running 5 tests using 1 worker
  ✓  1 › 加载态：getDiagramData 覆盖 DiagramData / DepthCalibration / DataRoi / Column 的必填字段 (3.0s)
  ✓  2 › 候选几何：扫描出的 LineCandidate 覆盖其必填字段 (2.4s)
  ✓  3 › 零状态：键集与加载态完全一致（遗留缺陷 ① 的回归钉子） (2.1s)
  ✓  4 › 已知别名表不得过期：后端若已直发同名字段，必须删掉表项 (2.0s)
  ✓  5 › 设计豁免表不得过期：字段一旦真的出现，必须删掉豁免 (2.1s)
  5 passed (18.4s)
CONTRACT_EXIT=0
```

### 1.5 复跑 from-zero 旅程（task-1 一键命令原样）

`frontend/playwright.zero.config.ts:28-33` 硬性只允许 `22920-22930`，超出即抛错。我先用 22965 试跑，
拿到的是配置自身的拒绝（不是我的命令写错）：

```
Error: STRADITIZE_ZERO_PORT=22965 越界：本套旅程只允许 22920-22930（避免与既有 e2e 抢后端会话）。
    at file:///E:/software_dev/straditize/frontend/playwright.zero.config.ts:30:9
```

这与 task-3 给我的"端口只用 22960-22970"冲突。**处置**：先确认 22921/22922 端口空闲
（`for p in 22921 ...; do (echo >/dev/tcp/127.0.0.1/$p) ...` → 全部 free），再在配置允许的段内复跑。
这是**已知冲突，不是任何人的缺陷**，但需要 Lead 在未来文档里统一（见 §5 裁决建议第 6 条）。

```bash
$ cd frontend && STRADITIZE_ZERO_PORT=22921 npx playwright test --config=playwright.zero.config.ts
[WebServer] [zero] backend ready on http://127.0.0.1:22921/ (zero state, no image)
Running 2 tests using 1 worker
  ✓  1 [msedge-zero] › from-zero-journey.spec.ts:215:3 › 八步全走 + tar 里有真实数据行 (8.3s)
  ✘  2 [msedge-zero] › from-zero-journey.spec.ts:806:5 › 回归：…已标定的 x_ticks 必须仍然存在 (2.4s)

  2 passed (16.6s)
JOURNEY_EXIT=0
```

**与 journey-log.md §0 报告的结果完全一致**（`2 passed`、退出码 0、8.3s vs 8.4s）。
第 2 条 `✘` 是被 `test.fail()` 标注的预期失败，语义见 §4.2。

**trace 内容复核**（我读的是这次运行**新生成**的文件，不是文档里那份）：

```
generatedAt 2026-10-19T09:26:23.409Z   steps 9
  [0] 零状态启动            backend keys=5
  [1] 上传真实花粉图          backend keys=6
  [2] 界定数据有效区 (ROI)    backend keys=2
  [3] Y 轴两点标定          backend keys=2
  [4] 清理干扰线（检测候选）    backend keys=4
  [5] 分列与命名            backend keys=3
  [6] 标定列 X 刻度          backend keys=4
  [7] 拐点与采样层位          backend keys=3
  [8] 校验与导出            backend keys=3

step5 cols: 28
step6: {"activeColumn":"roi_1_col01","xTicks":[{"px":322,"value":0},{"px":480,"value":20}],
        "calibratedColumns":8,"totalColumns":28}
tar: dataCsvRows=111 maxCell=28.9593 dataCsvEqualsPrimary=True
```

`steps` 长度 9、每步 `backend` 键数均 ≥ 2、`dataCsvRows=111>0`、`maxCell=28.9593>0`、
`dataCsvEqualsPrimary=true` —— journey-log.md §7 复跑检查清单的 6 条**逐条对上**。

> **但发现一个新缺陷（属 task-1 交付质量，不影响产品）：** `frontend/e2e/from-zero-journey.spec.ts:70`

```ts
/** trace 落盘路径。`outputDir` 由 `playwright.zero.config.ts` 按端口隔离。 */
const TRACE_PATH = join(process.cwd(), 'test-results-22920-zero', 'journey-trace.json');
```

`22920` 是**写死的字面量**，不随 `STRADITIZE_ZERO_PORT` 变化。我用 22921 跑，产物仍落在
`test-results-22920-zero/`（mtime `17:26:23` 证实是本次写入），且 `test-results-22921-zero/` 下**没有** trace。
注释声称"由 config 按端口隔离"，与实现不符。后果：两个端口并发跑会**互相覆盖**同一份 trace，
且 `cp frontend/test-results-22920-zero/journey-trace.json docs/findings/...` 这条拷贝命令
只有在用 22920 跑时才成立。建议改为读 `process.env.STRADITIZE_ZERO_PORT ?? '22920'`。
**这不影响任何缺陷判定**，但会影响用户"按我的端口复跑"时的取证。

---

## 2. 逐条复核表

判定口径（四态，无中间态）：`REPRODUCED` = 我独立跑出同一现象与同一结局；
`PARTIAL` = 现象成立但剂量/归因/判据有一项不符（在"差在哪"里写清）；
`NOT_REPRODUCED` = 我跑出的结果与断言相反或现象根本不出现；
`UNCERTAIN` = 缺某样东西无法判定，写明缺什么。

严重度裁定口径："真实用户会不会受害"。需要非用户可达调用序列 → 降级；污染导出数值 → 升级。

### 2.1 `static-audit.md`（F-01 … F-08）

| id | 报告严重度 | 我的判定 | 我的严重度裁定 | 我的证据（脚本 / 关键输出） |
| --- | --- | --- | --- | --- |
| **F-01** 进入步骤 6 自动写入从未有人读过的刻度值 | Critical | **REPRODUCED** | **Critical（维持）** | `v01_fabrication.py`：`val1=0`（字面量）、`val2=20.0`（`maxPercent`←`core.py:649-650/673-674` 硬编码 `tickValue: 20.0`）→ 8 次 `calibrate_column_xticks` 成功 → `resolve_column_scale` 全部 `source=x_ticks calibrated=True`。`v02_export_delta.py`：与"不标定"平行会话比，CSV **6362 格不同 / 800 行不同 / 最大 Δ=31.51 个百分点** |
| **F-02** 8 个"已标定"列标度互不一致 | Critical | **REPRODUCED** | **P1（降一级）** | `v01_fabrication.py`：px/1% 分布 `min=2.10 max=10.55 倍数=5.02x`。**降级理由**：F-02 是 F-01 的**同一根因的观测侧证据**，不是独立缺陷；把同一条写两遍 Critical 会虚增严重缺陷数。其"物理上不可能"的推理成立，但应作为 F-01 的佐证而非独立条目 |
| **F-03** 第 4 步几何换图后继续剔除 | High | **REPRODUCED** | **High（维持）** | `v04_cross_image.py`：只确认 1 条几何 → beginner 上 `removed_line_pixels=2400`（空白对照 `0`）；确认全部 24 条 → `13454`（对照 `0`）。归因实测：旧几何 `roi_id='roi_1'`，新图 ROI 也叫 `roi_1`，`cleanup.py` 的 roi 过滤失效 |
| **F-04** `Ctrl+Z` 把前端列清成 0 列 | High | **PARTIAL** | **High（维持）** | 后端一半成立（`v06_undo_backend.py`）：前端 `HistoryManager.reset(initialColumns=[], …)`（`FileLoaderService.ts:182`）+ `GeologyCanvas.ts:959-964` `this.data.columns = prev.columns` 整替。**差在哪**：我**没有**在真实浏览器里复现"29 列 → 0 列"这一具体数字（static 报的是浏览器实测）；我复现的是**代码链必然性**。且它需要"上传后立即撤销、期间无别的 history.push"这一时序 |
| **F-05** 撤销不覆盖 `x_ticks` | High | **REPRODUCED** | **Medium（降一级）** | `v06_undo_backend.py`：标定后 `history_undo()` → `x_ticks` 原样、栈 1→0（"状态未回退？是"）。清空后 undo → 仍 `None`。快照键 `['action','columns','control_points','data_xlim','data_ylim','taxa_names','timestamp']`，`columns[0]` 里确实带 `x_ticks` 键——但 `_record_history` 在**写入之后**才调（`xticks.py:162-164`），所以快照已是标定后的值。**降级理由**：用户看到的是"撤销没反应"，不会产出错误数值；且不丢数据（标定仍在）。定性为"撤销语义失效"，不是数据损坏 |
| **F-06** 导出预览 Depth 全 `0.0` | Medium | **NOT_REPRODUCED** | **降为"未证实"，不得进最终报告** | `v10_depth_preview.mjs`（rolldown 打包**真实** `CoordinateSystem.ts`+`SplineInterpolator.ts` 后执行）：未标定 → `calibrationBounds=null` → `depths.length=0`；"未标定但端点有值" → 同样 `null`/`0`；已标定对照 → `n=13/14`、`depthsHead=[0,100,200,…]`。**代码层面不可能产出 314 行 `0.0`**。且 `ExportModal.ts` 的 `depth` 来自 `CoordinateSystem.imageYToDepth`（未标定返回 `undefined` → `naStr`）。见 §3.1 详述 |
| **F-07** ROI 列数一变全 ROI `x_ticks` 清空 | Medium | **PARTIAL**（现象 REPRODUCED / 归因推翻） | **P1 升一级** | `v03_xticks_threshold.py`：现象成立且剂量被低估——**列数未变（28→28）的 shift=18 就已静默清空**。所以"列数变化"不是必要条件，`preserve_state=False` 更不是唯一入口；真触发点是**无提示的守卫失败**。**升级理由**：触发面比报告写的宽得多（不必改列数，挪 18px 就中），且静默 |
| **F-08** 未标定列导出用硬编码 `0→20`，与文案不符 | Low | **REPRODUCED** | **Low（维持，但归类应改）** | `v09_export_preview.py`：`resolve_column_scale` → `val0=0.0 val1=20.0 calibrated=False source=legacy`；`core.py:649-650/673-674` 硬编码 `startValue:0.0/tickValue:20.0`；文案在 `ExportReadinessPanel.ts:76` "按列宽百分比估算"。**归类**：这是 F-01 的**前置条件**（F-01 之所以能拿到 `20`，就是靠 F-08 这条 legacy 硬编码），不应当作独立 Low 条目，应并入 F-01 的根因链 |

### 2.2 `dynamic-probes.md`（F-1 … F-8）

| id | 报告严重度 | 我的判定 | 我的严重度裁定 | 我的证据 |
| --- | --- | --- | --- | --- |
| **F-1** 重分列静默回滚后端 ROI | P1 | **PARTIAL**（现象 REPRODUCED / 可达性存疑） | **P2 降一级（待 Lead 定）** | `v05_roi_rollback.py`：后端一半**完全成立**——`roi.update` → `[355,1906]`；传新 bounds 重分列 → 保持 `[355,1906]`；传旧 bounds → **退回 `[315,1946]`**。前端镜像来源 `WorkflowController.ts:154-166`（`canvasComponent.data.rois`）。**差在哪**：probes 称"前端镜像没有任何再同步"，但我在 `CleanupManager.ts:154-168` 找到 `syncActiveRoiBounds()` 会写 `list[idx] = {…, xlim:[x0,x1], …}`，而它是 `commitRoi()`（UI 改 ROI 的**唯一**入口）的必经步骤。**因此"用户正常在 UI 上拖 ROI → 步骤 5 分列"这条主路径上镜像不会滞后**，probes 的实测是用 `page.request` 直调 `roi.update` 绕过了 `commitRoi` 造出的状态。真正的残余风险只在"直调 RPC / 另一标签页改了 ROI"时存在。见 §3.4 |
| **F-2** 切图后旧几何继续剔除 | P1 | **REPRODUCED** | **P1（维持，与 static F-03 是同一问题）** | `v04_cross_image.py`：2400 px（单条）/ 13454 px（全部）。与 static F-03 数字一致，**应合并为一条** |
| **F-3** 重分列抹掉 `x_ticks`（阈值） | P2 | **PARTIAL** | **P1 升一级** | `v03_xticks_threshold.py`：首次被抹 **shift=18**（列数仍 28）、首次列数变化 **shift=22**。probes 的"阈值落在 (15,20)"**对**，但它把 shift≥25 的"列数 28→27 整段错位"当作**更糟的一档**——事实上那一档的 `x_ticks` 在 shift=18 就已经没了，不是独立档。**升级理由**：阈值比报告的 20px 更小（18px），且不需要改列数 |
| **F-4** 重置必弹 `-32001` | P2 | **REPRODUCED**（后端必然性） | **P3 降一级** | `v07_reset_draft.py`：`project.new` 后 `applyLineRemoval(roi_id='roi_1')` → `-32001 未找到 ROI 'roi_1'`，**必然失败**；对照：重置后先 `roi.create` 再重算是 `ok`。**降级理由**：用户看到的是一个错误弹窗，但**重置这个动作本身生效了**（后端 ROI 已清空、界面已复位），不损坏任何数据；错误文案虽指向"请先建 ROI"，但不会导致丢数据 |
| **F-5** `project.new` 残留清理编辑 | P2 | **REPRODUCED** | **P2（维持）** | `v04_cross_image.py` D5：`project.new` 前 `{columns:28, rois:1, line_candidates:24, line_strokes:1}` → 后 `{columns:0, rois:0, line_candidates:24, line_strokes:1}`，`cleanup_stats` 被清。**注**：`exclusion_regions` 我这两次都是 0，无法据此判断；见 §4 未复核项 |
| **F-6** 无锁会话撕裂读 | P3 | **REPRODUCED** | **P3（维持）** | `v08_race_verif.py`：`protocol.py` 中 `Lock/threading` 命中 **0**；`rpc_server.py:318` `ThreadingHTTPServer`；3 读线程 × 1 次 `load_image` → 撕裂读数 **574707 次**（`{"w":2339,"rois":0}`）；并发结束后静态回读 `imageWidth=2339 rois=1`（**瞬时自愈**）。我读线程密度远高于对方，所以次数不可横向比较，但**现象与自愈结论一致** |
| **F-7** `verification` 范例名残留 | P3 | **REPRODUCED** | **P3（维持，非缺陷）** | `v08_race_verif.py`：`core.py:43` 仍有 key、`FileLoaderService.ts:309` 仍有 nameMap、`Toolbar.ts` 只有 `hoya`/`beginner` 两个 option、`assets/tutorials/` 只有两张图、仓库根无该 png、`core.loadImage('verification')` → `-32004 内置范例图片缺失`。UI 不可达，确为死代码 |
| **F-8** 草稿恢复只写前端镜像 | P2 | **REPRODUCED**（源码 + 后端后果） | **P2（维持）** | `v07_reset_draft.py` G3/G4：`main.ts:717-726` 的恢复块内 **RPC 调用数 = 0**（全文唯一的 `rpcClient` 命中是块外的 `registerWebMcp…` 参数行）；`project.new` 后 `column.calibrateXTicks` → `-32001 列索引 0 超出范围`、`core.exportData` → `-32001 No digitized data`。与 probes ④ 段逐条一致 |

### 2.3 `journey-log.md`（F-1 … F-4）

| id | 报告严重度 | 我的判定 | 我的严重度裁定 | 我的证据 |
| --- | --- | --- | --- | --- |
| **F-1** 只标定 8/28 列、另 20 列静默跳过 | P1 | **PARTIAL**（数字对 / 定性严重低估） | **应并入 F-01，定性为 Critical** | `v01_fabrication.py`：`per_column` 28 条，`>=2齿=8`（索引 `[0,1,2,3,14,16,19,27]`）、`==1齿=20`、`==0齿=0`。**数字与文案逐字一致**。**但**：那 8 列不是"标定成功"，是**被写入了 `0` 与 `20` 两个从未有人读过的常数**。F-1 的"数据链是诚实的"这句**只对 20 列成立，对 8 列是错的** |
| **F-2** 步骤 3 面板重挂摧毁焦点 | P2 | **PARTIAL** | **P2（维持）** | 代码链成立：`YCalibPanel` 每框挂 `change` → `main.ts` `applyDepthCalibration` → `inspector.updateData()` → `Inspector.ts` 整块 `innerHTML`。**差在哪**：我**未**在浏览器里独立测"焦点掉到 BODY"与"丢值"，故只能复核代码链；对方自己也标了"丢值 0/7 未复现"。两边的诚实度都够，结论一致 |
| **F-3** `loadImage` 半完成状态可被尺寸读到 | P2 | **REPRODUCED** | **P3 降一级（且应改分类）** | `v08_race_verif.py` 副产物：`load_image` 执行期间 `{"w":2339,"rois":0}` 稳定出现。**降级理由**：对方自己已写"严格说不是用户可见缺陷"，我同意——它是**测试纪律问题**，与 F-6 同源（同一窗口），不应对同一现象在 F-3 与 F-6 里各记一次 |
| **F-4** 列数变化的重分列静默清空 `x_ticks` | P1 | **PARTIAL**（现象 REPRODUCED / 判据推翻） | **P1（维持）** | `v03_xticks_threshold.py`：现象、后果均成立（`source` 从 `x_ticks` 退化到 `legacy`；同一像素读数改变）。**但"判据是列数"被推翻**——shift=18 时列数仍是 28，已被抹。journey-log §4 的"20px 阈值是表象"这句话方向反了：**恰恰相反，阈值（18px 的守卫）才是本质，列数变化只是更大位移时的伴随结果** |

### 2.4 `lead-measurements.md`

| 断言 | 我的判定 | 说明 |
| --- | --- | --- |
| §0 门禁三连（lint / 317 passed / 5 passed） | **REPRODUCED** | 我跑出的数字完全一致（见 §1.2–1.4） |
| §2.1 判定表（列数变化 → 抹） | **PARTIAL** | **判据错误**，同 F-4 / F-07：真判据是守卫越界，shift=18 列数未变即中。表中"[315,1900] Δ右 −46px 仍保留"其实是因为**右边界右移不推动 col0 的左守卫**，与该行结论无关 |
| §2.2 读数从 13.92% → 47.62%（Lead）/ −16.25%（journey） | **PARTIAL** | 两方数字**互不相同**（47.62 vs −16.25），因为落点用的判据不同（Lead 是"列宽百分比"，journey 是"某固定像素"）。**两者的共同结论"读数会变、且可变负"成立**，但具体百分比不可互换引用 |
| §3 撕裂读（两标签页） | **REPRODUCED（机制层）** | 我未起两标签页，但在进程内用 3 读线程复现了同一窗口（574707 次）；§3.3 的"单标签页测不出、会自愈"我在 H2 中确认了自愈 |
| §7 F-01 复现（0 输入 → 8 次写入，body 含 `value:0` / `value:20`） | **REPRODUCED** | 我用**后端 payload + 复刻前端表达式**的方式得到同一组 `px/value`；我**没有**在浏览器里抓请求体（见 §4 未复核项） |

---

## 3. 未通过或存疑项的详述

### 3.1 static F-06（导出预览 Depth 全 `0.0`）—— `NOT_REPRODUCED`，**该条不得进最终报告**

**这不是"我没测到"，是"代码层面做不到"。**

我做的不是手工复刻，而是把**真实产品源码**打包执行：

```js
// scripts/verify_zero_flow/v10_depth_preview.mjs
import { CoordinateSystem } from '<FE>/src/core/CoordinateSystem.ts';
import { SplineInterpolator } from '<FE>/src/core/SplineInterpolator.ts';
```

用 `frontend/node_modules/rolldown` 转译后 `import`，喂三组输入。真实输出：

```
"a_未标定_端点全null": {
  "calibrationBounds": null,
  "withRoi": { "n": 0, "depthsHead": [], "uniqueDepthCount": 0 },
  "noRoi":   { "n": 0, "depthsHead": [], "uniqueDepthCount": 0 }
},
"b_未标定_但端点有值": {
  "calibrationBounds": null,
  "withRoi": { "n": 0, "depthsHead": [], "uniqueDepthCount": 0 },
  "noRoi":   { "n": 0, "depthsHead": [], "uniqueDepthCount": 0 }
},
"c_已标定_对照": {
  "calibrationBounds": { "topPx": 511, "bottomPx": 1311, "topValue": 0, "bottomValue": 1300 },
  "withRoi": { "n": 13, "depthsHead": [0,100,200,300,400,500], "yHead": [511,572.54,...] },
  "noRoi":   { "n": 14, "depthsHead": [0,100,200,300,400,500] }
}
```

机理：`CoordinateSystem.calibrationBounds()` 第一行就是

```ts
if (!cal || !cal.isCalibrated) return null;
```

返回 `null` 后，`SplineInterpolator.ts:142` 立刻 `return { depths: [], yPositions: [] }`。
`ExportModal.ts` 的 `depth_grid` 分支按 `depths.length` 造行 —— **`0` 行**。
static F-06 所称的"314 行、`uniqueDepths: ["0.0"]`"在数学上无法出现。

**第二重反证：那个状态在 from-zero 旅程里根本不可达。**
F-06 的前提是"未做 Y 轴标定"，但旅程第 3 步就是 Y 标定，且是主路径必经
（`journey-trace.json` `steps[3].backend.calibration = {isCalibrated: true, top_px: 511, …}`，
`steps[8]` 已产出 111 行 CSV）。static F-06 自己给的证据里写着"后端 CSV 是 507/508/509…"——
那正是 `export.py` 在**未标定**时的像素行号分支；而**同一个会话**的前端预览若真有 314 行，
说明它读到的 `calibration` 与后端不一致。更可能的解释是：static 的浏览器探针在
**`calibration` 尚未从 `core.loadImage` 的 payload 落地**时读了一次 `data.calibration`
（与 journey-log F-3 的"半完成状态"同一坑），读到的是默认对象而非"已标定"。

**结论**：静态审计自己把 F-06 的后端一半标为 U-03"未验证假设"，这是诚实的；
但 F-06 被列进了**已确认**的 findings 表（`static-audit.md:56`），这是超额声明。
**必须从最终报告移出，或降级为"未验证假设"。** 我没有它所用的 `depth_prev.js` 的完整运行环境
（脚本在 `scripts/static_audit/`，但它的探针需要它自己的后端与页面状态），所以我不替它"改证据"，
只给反向证据。

### 3.2 "重分列抹 `x_ticks`"的**判据**：三家全错，真判据是守卫

三份报告对同一缺陷给了三种判据，我用 0–89px 逐像素单维扫描（只推左边界，几何不变）钉死：

```
shift |   列数  | col0.start | 守卫lo | 刻度px0 | 入界  | x_ticks
    0 | 28->28 |      322.0 |  312.0 |   322.0 |  True | 保留
   15 | 28->28 |      330.0 |  320.0 |   322.0 |  True | 保留
   18 | 28->28 |      333.0 |  323.0 |   322.0 | False | None   ← 首次被抹，列数仍未变
   20 | 28->28 |      335.0 |  325.0 |   322.0 | False | None
   25 | 28->27 |      497.0 |  487.0 |   322.0 | False | None
   40 | 28->27 |      497.0 |  487.0 |   322.0 | False | None
```

程序化判定输出：

```
首次 x_ticks 被抹: shift=18  (该行 列数=28, 守卫=[323,507], px0=322)
首次列数变化     : shift=22  (列数=27)
首次越出守卫     : shift=18
「列数已变但仍保留」的 shift 数 = 0
```

因此：

- **journey-log F-4 / static F-07 / lead §2.1** 的"判据是列数变化（`preserve_state`）"——**错**。
  shift=18/20 两档列数都是 28，`preserve_state` 为真，`x_ticks` 照样被静默清空。
  抹除发生在那段守卫的**失败分支**：`if (len(t)==2 and lo<=t[0]<=hi and lo<=t[1]<=hi): col["x_ticks"]=t`，
  不满足时**既不写、也不报、也不计**。
- **dynamic-probes F-3** 的"阈值 ≈ 列边界外 10px / 落在 (15,20)"——**方向对，数值比实际偏大 2px**
  （真阈值是 17<shift≤18），且它把 shift≥25 的"列数 28→27 整段错位"描述成"更糟的一档"是**错的**：
  那一档的 `x_ticks` 在 shift=18 就已经归零，不是新的一档。
- "28→27 时 col0.start 从 322 跳到 497"这件事本身是真的（我实测 `28->27 时 col0.start=497.0`），
  说明重分列在列数变化时**整段错位重编号**——但那是另一个问题（列身份未按 id 迁移，
  与 journey F-4 建议的"按列 id 匹配"是同一件事），不应与"抹 `x_ticks`"混成一条。

**对最终报告的要求**：写"挪 ROI 左边界 ≥18px 即静默清空该 ROI 全部列的 `x_ticks`"，不要在标题里写"列数变化"。

### 3.3 F-01 是否真的改变导出的科学数值（Critical 定性的**决定性证据**）

这是"Critical 还是 P1 覆盖率问题"的唯一判据。我做了严格的平行对照：

- 会话 A：`hoya` + `detect_columns([315,1946],[511,1311])`，**不做任何标定**。
- 会话 B：同一张图、同一 ROI、同一份几何，**只加**复刻前端的那 8 次 `calibrate_column_xticks`。
- 两者走**同一个** `export_data(format="csv")`。

真实输出：

```
B1. 会话 A：自动标定次数 = 0   csv 行数 = 802   已标定列 = 0 / 28
B2. 会话 B：自动标定次数 = 8   csv 行数 = 802   已标定列 = 8 / 28
B3. 表头一致: True   数据行数: A=801  B=801
    有差异的行 = 800 / 801
    有差异的格 = 6362
    受影响列 = {'col02': 800, 'col03': 772, 'col04': 800, 'col15': 800,
                'col17': 800, 'col20': 800, 'col01': 795, 'col28': 795}
    最大绝对差 = 31.5083
      行172 列col02  legacy=50.75  编造后=19.2417  Δ=31.5083
```

**结论**：编造读数**直接改变了 6362 个导出数值格**，最大偏差 31.5 个百分点（该列真值被压到约 38%）。
`journal-log F-1` 的"数据链是诚实的"这句对**这 8 列不成立**：后端确实如实标 `calibrated=True`
——因为前端刚刚把一个伪造的标定写进去了。

补充证据（F-01 的 8 个值确实不是读出来的）：

```
px/1% 分布: min=2.10 max=10.55 倍数=5.02x
roi_1_col01: 编造跨度=158px  legacy 跨度=80px  (+78px)
roi_1_col02: 编造跨度=211px  legacy 跨度=80px  (+131px)
roi_1_col03: 编造跨度=126px  legacy 跨度=80px  (+46px)
```

同一张图、同一横轴、相邻属种列，`px/1%` 差 5.02 倍 —— 物理上不可能来自真实刻度读数。

**且它会污染 QA 与就绪清单**（`v11_trigger.py` K5）：

```
复刻写入 8 列
qa.n_uncalibrated = 20
uncalibrated_columns = ['col05','col06',...,'col27']
export.getReadiness.readiness_missing = []
```

即：QA 把这 8 列当作**已标定**放过，就绪清单**不再报缺**。用户在步骤 8 看到的"通过"是建立在这 8 个编造值上的。

### 3.4 dynamic-probes F-1（ROI 回滚）的可达性被我部分推翻

后端因果链我完全确认（E1–E3）：

```
E2 用新 bounds 重分列（前端镜像已刷新）: [('roi_1', [355.0, 1906.0], ...)]  <- 保持新值
E3 用旧 bounds 重分列（前端镜像未刷新）: [('roi_1', [315.0, 1946.0], ...)]  <- 被退回旧值
   >>> ROI 被回滚成旧值？ 是
```

但 probes 的关键前提——"前端镜像在 ROI 改动之后**没有任何再同步**"——**不成立**。
`CleanupManager.ts:154-168`：

```ts
public syncActiveRoiBounds(roi: DataRoi): void {
  const list = this.canvasComponent.data.rois ?? [];
  ...
  list[idx] = { ...list[idx], xMin: x0, xMax: x1, yMin: y0, yMax: y1, xlim: [x0, x1], ylim: [y0, y1] };
}
```

而 `commitRoi()`（`:141-152`）在 `await this.rpcClient.updateRoi(roi)` **之后立刻**调它。
`commitRoi` 是 UI 改 ROI 的**唯一**入口（`main.ts:495` PropertyPanel 回调、`CleanupManager.ts:136`
拖拽提交、`:191` 撤销快照回放、`InspectorBridge.ts:537`），我逐一查过，没有第二条写入路径。

**所以**：用户在 UI 上拖 ROI → `commitRoi` → `updateRoi` + `syncActiveRoiBounds` → 镜像已同步 →
步骤 5 分列传的是**新** bounds → **不回滚**。
probes 的实测用 `page.request` 直调 `roi.update`（`probe_f1_roi_rollback.cjs` 里写的是
"`roi.update` 是直接走 `page.request` / 页面 RPC 改的后端，前端镜像仍是旧值"），这是**绕过了
产品唯一的写入口**造出来的状态。

**残余风险（仍然真实，但降级）**：
1. 另一个标签页改了 ROI（两个标签页共享同一个后端会话）→ 本页镜像滞后 → 本页分列回滚。
2. WebMCP / agent 直调 `roi.update`。
3. `addRoi` / 删除 ROI 等路径是否都走 `syncActiveRoiBounds`，我没有逐条验证（列为 `UNCERTAIN`）。

据此我把 F-1 从 **P1 降到 P2**（需要非主路径操作才能触发）。**这一条请 Lead 定夺**，
因为它是四份报告中唯一一条"根因对、可达性被高估"的 P1。

### 3.5 dynamic-probes F-1 与 journey F-4 引用的 §6 段落：一条应记为**误引**

probes F-1 引 `docs/ARCHITECTURE.md:174-175`「ROI…与深度/时间标定相互独立…标定刻度选在哪里，
不得影响取数区域，反之亦然」来论证"分列改写 ROI"。

**行号与原文都精确**（我 `sed -n '172,177p'` 核过）。但这条不变量讲的是 **ROI ↔ 深度/时间标定**
不得互相影响；F-1 的问题是 **ROI ↔ 分列**。二者不是同一条约束。
`detect_columns` 用传入的 bounds 生成列，再把 bounds 写回 ROI —— 这是**同一个量**在传递，
不是"取数区与标尺耦合"。**该处应引 §2（后端权威值被前端镜像覆盖），不应引 §6。**
其余 6 处不变量引用（§2:44、§6.0-2:169、§7.1:240、§9-4:333、§9-9:338、§3:85）我逐条核对，
**行号与原文全部准确**，包括 dynamic-probes §6.1 自己的自查表——那份自查表是可信的。

### 3.6 static F-04 的浏览器侧数字我未能复现

static F-04 报的是 `fe.cols=29 → afterCtrlZ fe.cols=0`。我复现了**代码链**
（`FileLoaderService.ts:182` `reset([],'')` → `HistoryManager.reset` 把基线快照的 `columns` 钉成 `[]`
→ `GeologyCanvas.ts:961` `this.data.columns = prev.columns`），但**没有**在真实 Edge 里跑出
"29 → 0"这个具体转移，因此标 `PARTIAL` 而非 `REPRODUCED`。
原因是我把浏览器预算集中在了 task-3 明确要求的两项（复跑 journey、F-01 的写入链）上；
static F-04 的浏览器取证脚本 `undo_test4.js` 我不复用（任务要求自己写最小复现）。
**这不构成对 F-04 的否定**——代码链是必然的，只是缺我自己的浏览器字节。

---

## 4. 哪些断言我无法复核，及原因

| # | 断言 | 卡在哪 | 需要什么才能判定 |
| --- | --- | --- | --- |
| U1 | static F-06 的 `314 行全 0.0`（浏览器实拍） | 我已证伪其**可行性**（§3.1），但无法解释它当时为何看到 314 行；我不复用它写的 `depth_prev.js` | 重现它的后端 + 页面状态；或它提供该次运行的 console 与 `data.calibration` 快照 |
| U2 | dynamic-probes F-1 的 `[315,1946] → [355,1906]` 回滚**在真实 UI 拖拽下**是否发生 | 需要真实鼠标拖 ROI 手柄 → 步骤 5 分列 → 回读后端；我的 `v05` 只做了后端因果拆分 | 一次浏览器拖拽实验（`page.mouse` 拖 `#roi` 手柄，而非 `page.request` 改后端） |
| U3 | static F-03 的"步骤 4 画布琥珀色候选像素 `cand=22, amberPx=7192`" | 我是后端量测（`removed_line_pixels`），没有量画布像素 | 需要读 canvas 像素的浏览器探针 |
| U4 | static F-04 的 `fe.cols 29→0`（浏览器实跑） | 见 §3.6，只完成代码链 | 一次 `Ctrl+Z` 浏览器实验 |
| U5 | journey F-2 的"焦点掉到 `document.activeElement.tagName === 'BODY'`" | 我只复核了代码链（`YCalibPanel` `change` → `inspector.updateData()` → `innerHTML`） | 浏览器里提交标定后读 `activeElement` |
| U6 | dynamic-probes F-5 里的 `exclusion_regions` 残留 | 我两次跑都是 `exclusion_regions: 0`（写入点是真实鼠标框选，`InspectorBridge.ts:280-291`） | 一个能造出非空 exclusion region 的会话状态 |
| U7 | dynamic-probes H5（`exaggeration_multiplier` 三处键名分裂） | 对方自己标"未验证"，我也没构造完整 UI 路径 | Inspector 勾选框 → 导出的端到端实验 |
| U8 | static F-02 的"真实标度 px 322..402 → 0..40" | "真值 40%" 是**推断**（列宽 65% 处的初始刻度半径），不是从图上读出来的。我用它算过偏差，但**它不是真值** | 人工读 hoya 图刻度尺的真实满量程；在此之前 F-02 的"偏差 11–46 个百分点"是**相对量级**，不是绝对值 |

> 关于 U8 的自我约束：我在 §3.3 报告"最大偏差 31.51 个百分点"时，用的是**两套标度之间的差异**
> （legacy 50.75 vs 编造 19.2417），这个数字是**可复算的实测值**，不依赖任何"真值"假设。
> F-02 里"读数只剩真值的 18%–48%"这类表述依赖假设，**不应原样进最终报告**。

---

## 5. 给 Lead 的裁决建议

### 5.1 可以进最终报告（证据充分、我独立复现）

1. **Critical — F-01（合并 journey F-1 的 8/28 + static F-01 + static F-02 + static F-08）**
   一条讲清：进入步骤 6 → 前端自动点"自动提取刻度" → 对 8 个检出 ≥2 个齿的列，
   用字面量 `0` 与 `tickValue:20.0`（`core.py:649-650/673-674`）充当读数写入后端
   （`InspectorBridge.ts:360-363`）→ 这 8 列在导出、QA、就绪清单里**全部变成"已标定"** →
   **实测改变 6362 个 CSV 数值格，最大 31.51 个百分点**。
   违反 §2（`ARCHITECTURE.md:44-45`）与 §9-4（`:333`），**引用精确**。
   **journey-log F-1 必须改写**：它的"数据链是诚实的"只对另外 20 列成立；对 8 列而言，
   是它自己描述的那种"被写进论文的错数字"。
2. **P1 — 重分列静默清空 `x_ticks`（合并 journey F-4 + probes F-3 + static F-07）**
   **标题不要写"列数变化"**，写"**挪 ROI 左边界 ≥18px 即静默清空该 ROI 全部列 `x_ticks`，无任何提示**"。
   根因引 `core.py` 的守卫失败分支（静默 discard），`preserve_state` 只作第二层说明。
   这一条严格说**不违反** §6.0-2 的字面（文档写了"若列数不变"），是**设计缺口**；
   但引 §2 的"丢弃用户数据却静默通过"成立。
3. **P1 — 跨图 / 跨项目清理几何残留（合并 static F-03 + probes F-2 + probes F-5）**
   剂量写清：1 条残留 → 2400 px；24 条残留 → 13454 px；空白对照 0。
4. **P2 — 草稿恢复只写前端镜像（probes F-8）**：`main.ts:717-726` 整段 0 个 RPC，我确认。
5. **P2 — 重置必弹 `-32001`（probes F-4）**：后端必然性我确认；建议定性为"错误文案错位"。
6. **P2 — 撤销不覆盖 `x_ticks`（static F-05）**：我建议降为 P2/Medium，理由见 §2.1。
7. **P3 — 撕裂读（probes F-6）**、**P3 — `verification` 死代码（probes F-7）**：维持。
8. **P3 — `loadImage` 半完成状态（journey F-3）**：建议与撕裂读合并成一条"同一窗口的两面"，
   不要占两个编号。

### 5.2 必须标注存疑 / 移出

1. **static F-06（导出预览 Depth 全 0.0）→ `NOT_REPRODUCED`，移出已确认清单**（§3.1）。
   若要保留，只能写成"未验证假设"，并注明"代码路径 `calibrationBounds()` 在未标定时返回 `null`，
   预览应得 0 行，与该观察矛盾，机理待查"。
2. **dynamic-probes F-1（ROI 回滚）→ 从 P1 降到 P2，并改写可达性**
   （§3.4：`syncActiveRoiBounds` 在 UI 主路径上会同步镜像，probes 的实测绕过了 `commitRoi`）。
   若要维持 P1，需要一次**真实鼠标拖拽**的浏览器复现（U2）。
3. **static F-04 的浏览器数字 → 保留但注明"复核方只确认代码链"**（§3.6）。
4. **static F-02 的"读数只剩真值 18%–48%"→ 不得作绝对值引用**（U8：40% 是推断）。
5. **probes F-1 引用的 §6:174-175 → 改为引 §2**（§3.5）。
6. **task-1 spec 的 `TRACE_PATH` 硬编码 22920 → 建议 Lead 让 journey-runner 修或至少在文档注明**（§1.5）。

### 5.3 门禁可信度裁定（task-3 第 4 项）

我对 `frontend/e2e/from-zero-journey.spec.ts` 做了逐项审查：

| 检查 | 结果 |
| --- | --- |
| `test.skip` / `test.fixme` / `test.only` / `describe.skip` | **0 处**（`grep` 无命中） |
| 被注释掉的 `expect(...)` | **0 处**（`grep -E "^\s*//\s*(expect\|await expect)"` 无命中） |
| `test.use({ allowlists })` 豁免 | **0 处**（该 spec 全程不故意触发错误路径，故不申报豁免，**这是正确做法**） |
| 真实断言数 | **57 处 `expect(`**，且几乎每条带中文失败原因 |
| `test.fail()` 使用 | **1 处**，`from-zero-journey.spec.ts:801` |

**关于那处 `test.fail()`：判定为合法，不构成门禁弱化。** 理由是我实测了它的**双向**行为：

```bash
# 正常跑（缺陷存在）：预期失败 → Playwright 计入 passed
$ STRADITIZE_ZERO_PORT=22921 npx playwright test --config=playwright.zero.config.ts
   ✘  2 ... 列数变化的重分列之后，已标定的 x_ticks 必须仍然存在 (2.4s)
   2 passed (16.6s)                       ← 退出码 0

# 摘掉预期失败标注（模拟"已修复后按正向断言跑"）：
$ STRADITIZE_EXPECT_XTICKS_FIXED=1 STRADITIZE_ZERO_PORT=22922 npx playwright test ... -g "回归"
   Error: 列数变化的重分列把 x_ticks 静默清空了
        （标定前 [{"px":322,"value":0},{"px":480,"value":20}]，标定后 null）。…
   expect(received).toBeTruthy()
   Received: null
   1 failed
```

即：**它在缺陷存在时红、并给出真实的失败信息；在缺陷修好后会变成 `Expected to fail, but passed` 而整轮变红**，
强制摘除标注。这不是"跳过"（skip 会让断言永远不执行），也不是"放宽断言"
（`toBeTruthy()` 是正向断言，没有写成 `not.toBeTruthy()`）。**判为合法。**

唯一可挑的是**位置**：它把已知缺陷钉在**同一份交付 spec** 里，于是"这条 lane 全绿"这件事
包含了 1 条预期失败。journey-log 已在 §0 与 §7 明确交代这点（"末行是 `2 passed`，不是 `1 passed`"），
措辞诚实。**可以接受，但建议最终 README 复述这个语义，避免用户误读 `2 passed`。**

另外我确认 `playwright.zero.config.ts` 的 `testMatch: /from-zero-journey\.spec\.ts/` 已收紧到单文件，
journey-log §0.1 承认的"临时探针污染 lane"问题**已修复**，我复跑只看到 2 条用例，与文档一致。

### 5.4 给 Lead 的一句话总结

**F-01 的 Critical 定性成立，journey-log F-1 把同一缺陷写成"覆盖不全的 P1"是显著低估，
应合并重写为一条 Critical；同时 static F-06 必须从已确认清单移出（我已证伪其代码可行性），
dynamic-probes F-1 应降为 P2（其"镜像不同步"前提在 UI 主路径上被 `syncActiveRoiBounds` 打破）。
既有门禁全绿，无 P0。**

---

## 附：本报告全部复核脚本

| 脚本 | 复核对象 |
| --- | --- |
| `scripts/verify_zero_flow/vcommon.py` | 公共件（配置隔离、dispatcher、会话构造） |
| `scripts/verify_zero_flow/v01_fabrication.py` | F-01 取值链、F-02 标度发散、journey F-1 的 8/28 |
| `scripts/verify_zero_flow/v02_export_delta.py` | **F-01 的真实导出影响（决定性证据）** |
| `scripts/verify_zero_flow/v03_xticks_threshold.py` | F-4 / F-3 / F-07 的**判据**（0–89px 扫描） |
| `scripts/verify_zero_flow/v04_cross_image.py` | F-03 / F-2 / F-5 跨图与跨项目残留 |
| `scripts/verify_zero_flow/v05_roi_rollback.py` | F-1 ROI 回滚的因果拆分与可达性 |
| `scripts/verify_zero_flow/v06_undo_backend.py` | F-04 / F-05 撤销 |
| `scripts/verify_zero_flow/v07_reset_draft.py` | F-4 重置 `-32001` / F-8 草稿 |
| `scripts/verify_zero_flow/v08_race_verif.py` | F-6 撕裂读 / F-7 `verification` |
| `scripts/verify_zero_flow/v09_export_preview.py` | F-06 后端 depth / F-08 legacy 标度 |
| `scripts/verify_zero_flow/v10_depth_preview.mjs` | **F-06 的前端数学（rolldown 打包真实源码）** |
| `scripts/verify_zero_flow/v11_trigger.py` | F-01 的触发条件、`detected_ticks` 只在镜像、QA 污染 |

全部脚本只读产品源码，不修改任何产品文件。
