# 从零开始的花粉图上机旅程 —— 逐步记录与发现

> 任务：**模拟一个人**打开软件、上传自己的花粉图、从零开始走完八步、导出数据。
> 本文是该旅程的逐步记录，以及过程中暴露出来的真实缺陷。
>
> 证据文件：同目录 [`journey-trace.json`](./journey-trace.json)（每步一份后端权威快照）。
> 用例源码：[`frontend/e2e/from-zero-journey.spec.ts`](../../frontend/e2e/from-zero-journey.spec.ts)
> 零状态后端：[`support/serve_zero_backend.py`](../../support/serve_zero_backend.py)
> 独立配置：[`frontend/playwright.zero.config.ts`](../../frontend/playwright.zero.config.ts)

---

## 0. 一键复跑

```bash
# 在仓库根 E:\software_dev\straditize 下，Git Bash
npm --prefix frontend run build                 # 必须先 build：后端从 frontend/dist 托管界面
cd frontend
STRADITIZE_ZERO_PORT=22920 npx playwright test --config=playwright.zero.config.ts
```

实测（2026-10-19 复跑，Windows 11 + 系统 Edge）：

```
Running 2 tests using 1 worker
  ✓  1 [msedge-zero] › e2e\from-zero-journey.spec.ts:220:3 › 从零开始：…八步全走 + tar 里有真实数据行 (8.1s)
  ✘  2 [msedge-zero] › e2e\from-zero-journey.spec.ts:817:5 › …回归：重新分列与 x_ticks 标定的存亡 › ROI 边界挪动使刻度越出守卫区间后，已标定的 x_ticks 必须仍然存在（列数未变） (2.3s)

  2 passed (16.7s)
```

> **（Lead 更新，2026-10-19）** 上面是 Lead 在端口 22924 复跑的真实输出；
> 第 2 条的**标题已随判据更正而改写**（原为"列数变化的重分列…"，
> 现为"…越出守卫区间…（列数未变）"）。原文的行号 806 亦已变为 817。

**末行是 `2 passed`，不是 `1 passed`。** 第 2 条显示 `✘` 是**预期的**：它被
`test.fail()` 标注，钉住的正是已确认缺陷 **B-02**（原编号 F-4：ROI 边界挪动致刻度越出
守卫区间时，重分列会静默清空 `x_ticks`）。Playwright 把"预期失败"计入 `passed`，
所以整轮退出码为 `0`。

> 修好该缺陷之后，这条用例会以 `Expected to fail, but passed` 变红 —— 那是**期望的**
> 信号，提醒我们摘掉 `test.fail()` 并把它升格为正向回归。
> 想现在就按正向断言跑一遍（例如正在验证修复）：`STRADITIZE_EXPECT_XTICKS_FIXED=1 …`

> ⚠️ `--config` 的路径是**相对当前工作目录**解析的。在仓库根执行
> `npx --prefix frontend playwright test --config=playwright.zero.config.ts` 会报
> `playwright.zero.config.ts does not exist`（它去仓库根找了）。所以上面先 `cd frontend`。

### 0.1 这条 lane 只有**一个** spec 文件

`testMatch: /from-zero-journey\.spec\.ts/` —— 收紧到只匹配本文件。

**修过一次。** 我调试期间在 `frontend/e2e/` 放过一个临时的 `probe-zero-roi.spec.ts`
（排查 F-2 用，只 `console.log` 不带断言），并把 `testMatch` 写成
`/(from-zero-journey|probe-zero-roi)\.spec\.ts/`。后果是它被当成正式用例跑，
`Running 2 tests` 里第 2 条就是那个探针——既与文档"末行 `1 passed`"不符，
也稀释了"这条 lane 真在把关"的信号。

**处置：删掉探针文件 + `testMatch` 收紧回单一文件名**（即上面这行）。
现在这条 lane 里只有 `from-zero-journey.spec.ts`，它包含 2 条用例：旅程 + F-4 回归钉子。
临时探针一律放 `.tmp_journey/`（本文件用到的复现脚本也在那里），不进 `e2e/`。

产物位置（均在 `.gitignore` 覆盖范围内——`frontend/test-results-*/` 这一条同时覆盖下面三个）：

| 产物 | 路径 |
| --- | --- |
| 后端权威快照 | `frontend/test-results-22920-zero/journey-trace.json` |
| 失败时的截图 / trace | `frontend/test-results-22920-zero/**` |
| HTML 报告 | `frontend/test-results-22920-zero-report/` |

> 🔧 **修过一次：HTML 报告目录不能与 `outputDir` 嵌套。** 第一版把报告写在
> `test-results-<port>-zero/report`，Playwright 当场报：
>
> ```
> Configuration Error: HTML reporter output folder clashes with the tests output folder:
>     html reporter folder: <repo>/frontend/test-results-22926-zero/report
>     test results folder:  <repo>/frontend/test-results-22926-zero
> HTML reporter will clear its output directory prior to being generated,
> which will lead to the artifact loss.
> ```
>
> 真正的风险不是报错，而是**产物会丢**：reporter 生成前会清空该目录，一旦用例失败，
> `trace: 'retain-on-failure'` 留下的 trace 会被清掉——那正是排查失败唯一的东西。
> 现已改为**平级**目录 `test-results-<port>-zero-report`。
> 已验证失败时 `trace.zip` 与 `test-failed-1.png` 都保留（原布局下会被清）。

复跑后把 trace 拷回文档目录（本仓库的约定是测试不写 `docs/`）：

```bash
cp frontend/test-results-22920-zero/journey-trace.json docs/findings/journey-trace.json
```

---

## 1. 为什么必须另起一套零状态后端（而不是复用现有基线）

现有全部 70 项 e2e 跑在 `support/serve_e2e_backend.py` 上，它**启动时**：

```python
session.load_image(sample_key="hoya")                    # 预载范例图
session.detect_columns(HOYA_X_BOUNDS, HOYA_Y_BOUNDS)     # 预跑分列
```

后果是这两件事在整套测试里**零覆盖**：

1. **"打开文件"整条链路**（真实文件选择器 → `FileReader` → `core.loadImage`）；
2. **"第一次运行"**（会话里一张图都没有时，界面是否可用）。

本旅程的零状态启动器只做 `StraditizeSession()` + 注册 `e2e.health` / `e2e.reset`，
**不预载、不预跑**；`e2e.reset` 也是清回空会话（`project_new(clear_image=True)`），
并在复位后断言 `session.image is None` 且列/ROI/候选/笔迹/层位全为 0，否则 fail-fast。

零状态是被支持的：`straditize_core/rpc_methods/system.py:64` 起，`session.image is None`
时 `get_diagram_data` 显式返回 `imageSrc: null` / `rois: []`，**不回落范例**。实测：

```bash
$ curl -s -X POST http://127.0.0.1:22920/rpc -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"straditize.getDiagramData","params":{}}'
{"jsonrpc":"2.0","result":{"imageSrc":null,"imageWidth":0,"imageHeight":0,"columns":[],
 "activeTaxaId":"","selectedEntity":null,"isDesktopMode":true,"roi":null,"rois":[],
 "primaryRoiId":null,"activeRoiId":null,"calibration":{"isCalibrated":false,…
```

---

## 2. 逐步旅程

下表每行的「后端权威状态」都取自 `journey-trace.json`，**不是**前端镜像
（`window.__straditize.getState()`）。判据一律是后端。

### 步骤 0 — 零状态启动

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 双击打开软件（后端空会话） |
| 界面回应 | 完成 boot，停在第 1 步，提示"尚未载入剖面图…" |
| 后端权威状态 | `imageSrc=null`、`imageWidth=0`、`imageHeight=0`、`rois=[]`、`columns=[]` |
| 我的判断 | **零状态可用**。`window.__straditize` 就绪、`#geology-canvas` 已挂载，后端如实返回 null/[] 而非回落范例。零状态下 `#btn-goto-step2` 不渲染（没有图就没有 ROI 可划），这一点是对的。 |

### 步骤 1 — 上传真实花粉图

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 点顶栏【打开文件】→ 系统文件对话框里选中 `hoya-del-castillo.png` |
| 界面回应 | 载入进度提示 → 画布出现整幅剖面图，自动出现一个 `pollen` 数据有效区 |
| 后端权威状态 | `imageWidth=2339`、`imageHeight=1654`、`rois=[roi_1 "pollen" composition=true]`、`columns=[]` |
| 我的判断 | 上传走的是**真实 UI 链路**：`#btn-open-file` 的 handler 是 `fileInput.click()`（`frontend/src/components/Toolbar.ts:463`），Playwright 拦下 `filechooser` 后 `setFiles()` 即用户的"选中一个文件"，后续 `input.change → onOpenFile → FileLoaderService.handleOpenFile → FileReader → core.loadImage` 全部真实执行。后端尺寸等于真值，且**没有**偷偷预跑分列。 |

> 文件里的兜底：`filechooser` 事件不出现时会退化为直接给同一个 `<input type=file>`
> 塞文件（仍是 UI 的 `change` 链路，只是省掉系统对话框）。实际运行**没有**走兜底，
> 全程用的是真实 `filechooser`。

### 步骤 2 — 界定数据有效区 (ROI)

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 按 `F` 适应屏幕，拖动 `pollen` ROI 的右下角手柄到 `(1946, 1311)` |
| 界面回应 | ROI 框跟随手柄缩放，面板像素范围读数实时更新 |
| 后端权威状态 | `roi_1.xlim=[309, 1945]`、`ylim=[507, 1310]`（起点建议值 `[309,2030]×[507,1314]`） |
| 我的判断 | 右/下边界真的从建议值移到了目标（2030→1945、1314→1310，圆心误差 ≤1px 属整数取整）；左/上边界保持 `309`/`507` 未动——这是**正确**的，因为用户只抓了右下角手柄。id 未在拖拽中被换掉。 |

### 步骤 3 — Y 轴两点标定

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 填 top `511px→0`、bottom `1311px→1300`，单位 `cm`，点【应用标定】 |
| 界面回应 | 面板显示比例、HUD 提示"已标定" |
| 后端权威状态 | `calibration={isCalibrated:true, top_px:511, top_cm:0, bottom_px:1311, bottom_cm:1300, unit:"cm"}`；`rois[0].xlim` 与步骤 2 完全一致 |
| 我的判断 | 标定逐字段等于用户输入，且**没有**顺手改动 ROI —— `docs/ARCHITECTURE.md` §6「关键区分：ROI 是取数区域，不是标尺」这条不变量成立。 |

### 步骤 4 — 清理干扰线

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 进入步骤 4，等【检测候选】跑完 |
| 界面回应 | 侧栏列出候选横/竖线（橙色＝未确认） |
| 后端权威状态 | `line_candidates` 全为 `status="candidate"`；`exclusion_regions=0`；`line_strokes=0` |
| 我的判断 | 「检测与删除解耦」成立：检测只产几何、不动像素。不断言具体条数（因图而异），只断言"状态全是候选"这条**因果**。 |

### 步骤 5 — 分列与命名

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 进入步骤 5（后端真的跑一遍 `detect_columns`），在侧栏把第 2 列改名为 `JourneyTaxon` 并回车 |
| 界面回应 | 画布画出各列垂直基线；侧栏列名即时更新 |
| 后端权威状态 | `columns=28`；全部 `roi_id="roi_1"`；全部 `col_index` 为数字；被改名那列 `name="JourneyTaxon"` |
| 我的判断 | 分列产出真实列并全部归属本 ROI；改名走真实键盘并落后端。**28 列**是本图在 `[315,1946]×[511,1311]` 下的真实产物。 |

### 步骤 6 — 标定列 X 刻度

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 进入步骤 6，等【自动提取刻度】跑完 |
| 界面回应 | 面板显示两点像素与读数；画布底部出现刻度标记 |
| 后端权威状态 | 活动列 `x_ticks=[{px:322,value:0},{px:480,value:20}]`；**已标定 8 列 / 共 28 列** |
| 我的判断 | `x_ticks` 是 X 标度的**唯一解析入口**（`docs/ARCHITECTURE.md` §6.0），它真的写进后端了，两点方向正确。但**28 列里只有 8 列被标定**，剩下 20 列是被静默跳过的 —— 见下方 **F-1**。 |

### 步骤 7 — 拐点与采样层位

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 点【自动提取共识层位】 |
| 界面回应 | 侧栏列出识别出的层位行及其深度 |
| 后端权威状态 | `samples.count=111`；`depthRange=[3.25, 1295.125]` |
| 我的判断 | 层位真的落后端，且深度落在用户标定的 `0–1300 cm` 量程内 —— 说明标定真的被用上了（不是 0、不是 NaN）。`n_horizons_empty=0`。 |

### 步骤 8 — 校验与导出

| 项 | 内容 |
| --- | --- |
| 人做了什么 | 进入步骤 8 看 QA，取导出归档 |
| 界面回应 | QA 横幅给出层位数与组分和门禁结论 |
| 后端权威状态 | `qa={n_horizons:111, n_horizons_empty:0}`；`readiness={sheets:["pollen"], primary_roi:"pollen", total_rois:1}`；`export.tar` 成员 `[README.txt, data.csv, data/pollen.csv, image/original.png, manifest.json, plot_strat.R]`，`size=122880`，**`data.csv` 有 111 行数据**，最大读数 `28.9593`，`data.csv` 与 `data/pollen.csv` 逐字节相同 |
| 我的判断 | 导出**真的有数据**：111 行、有非零读数（最大 28.96%），不是只有表头。`data.csv` 归属主 ROI 这条不变式成立。 |

**旅程结论：八步全程走通，没有在任何一步卡死。** 但过程中暴露了 **4** 个真实缺陷（见下）：P1 两条（F-1 标定覆盖不全、F-4 重分列抹标定）、P2 两条（F-2 面板重挂竞态、F-3 载入半完成态）。

---

## 3. 发现（按严重度）

> 每条都注明：用户可见症状 / 根因 file:line / 我真实跑过的命令与输出。
> **没有**为了让测试变绿而放宽断言或删用例；下面的缺陷全部以"如实记录"的方式保留。

### F-4（P1，数据完整性）列数变化的重分列会**静默清空** `x_ticks`，同一像素点的读数可差 30 个百分点

> ⚠️ **Lead 追加更正（2026-10-19）——本条的判据已被 verifier 推翻，Lead 复验采纳。**
> 下文把判据写成"列数变化"，**这是错的**。真判据是 `core.py:736-746` 的**区间守卫越界**：
> 刻度像素须落在 `[min(start,end)-10, max(start,end)+10]` 内才回填，落在外则**静默丢弃**
> （不写、不报、不计）。列数变化只是**伴随现象**。
> Lead 逐像素扫描（`scripts/lead_probe/xticks_scan_decide.py`）：
> **首次被抹在 Δ=18，此时列数仍是 28→28**；首次列数变化要到 Δ=22。
> 结论以 [`bug-report.md`](./bug-report.md) **B-02** 为准；本节其余内容（症状、数据后果、
> 为何是 P1）仍然成立。保留原文以记录更正过程。

**严重度：P1。** 它不是在界面上"看起来不顺手"，而是**写出错数字**：用户标定好的列，
一旦触发一次列数变化的重分列，同一列同一像素的读数会按另一条换算链重算，
而界面上**没有任何提示**。对科研工具，这类数字会被直接写进论文。

**症状。** 用户在步骤 6 把若干列标定成 `0→20`；之后回到步骤 2 微调 ROI 边界
（只要这次微调让**列数**从 28 变成 27），再回到步骤 5 触发重分列 —— 标定全没了，
列退回"按列宽百分比估算"。

**根因。** `straditize_core/session_parts/core.py:703`：

```python
preserve_state = len(old_roi_cols) == len(detected_cols)   # 判据是列数
...
if preserve_state:
    if old_c.get("x_ticks"):                                # 列数一变，整段跳过
        t = old_c["x_ticks"]
        lo = min(col["start"], col["end"]) - 10
        hi = max(col["start"], col["end"]) + 10
        if len(t) == 2 and lo <= t[0].get("px", 0) <= hi and lo <= t[1].get("px", 0) <= hi:
            col["x_ticks"] = t
```

列数变化时新列**完全不带** `x_ticks`，随后 `resolve_column_scale` 落到 `source="legacy"`
（0–100% 按列宽）。这是 `docs/ARCHITECTURE.md` §6.0 想根除的"两条换算链"的变形：
那里是"同一列在 CSV/Parquet 与 XLSX/LiPD 不一样"，这里是**同一列在标定前后不一样**。

**我自己的复现（独立跑，非引用他人输出）。**

```bash
$ pixi run python .tmp_journey/xticks_probe.py
新区间              Δ左     Δ右  列数        x_ticks     前source     后source
[315, 1946]       0      0   28->28    保留          x_ticks     x_ticks
[315, 1930]       0    -16   28->28    保留          x_ticks     x_ticks
[330, 1946]      15      0   28->28    保留          x_ticks     x_ticks
[315, 1900]       0    -46   28->28    保留          x_ticks     x_ticks
[340, 1946]      25      0   28->27    **被抹掉**     x_ticks     legacy
[350, 1946]      35      0   28->27    **被抹掉**     x_ticks     legacy
[400, 900]       85  -1046   28->3     **被抹掉**     x_ticks     legacy
```

**数值损坏。** 像素 x=432，换算走导出/QA 同一个入口 `resolve_column_scale`
（`session_parts/export.py:129`、`session_parts/qa.py:129`、`rpc_methods/system.py:128`）：

```bash
$ pixi run python .tmp_journey/xticks_numeric.py
标定后   x_ticks=[{'px': 322.0, 'value': 0.0}, {'px': 480.0, 'value': 20.0}]
         source='x_ticks' calibrated=True      像素 x=432 读数 = 13.9241 %
重分列后 x_ticks=None
         source='legacy' calibrated=False       像素 x=432 读数 = -16.2500 %
同一个像素点，读数从 13.9241% 变成 -16.2500%（差 30.1741 个百分点）
```

百分比**变成负数**这件事本身就说明换算链已经失效。

**已钉成回归。** 本 spec 第二条用例 `回归：重新分列与 x_ticks 标定的存亡`
用 `test.fail()` 固定这一行为（缺陷在则"预期失败"；修好后会以
`Expected to fail, but passed` 强制我们摘掉标注）。详见 §4.3。

**建议修复方向（只报不改）。** 判据应从"列数相等"改为**按列 id 匹配**：只要
`old_roi_cols[k]["id"]` 仍存在，就继承它的 `x_ticks`（并保留现有的区间守卫作为
第二道防线）；列数变化时对仍存在的 id 保留、对新列置空。修复后必须同时确认
`resolve_column_scale` 的 `source` 字段仍能如实反映"这一列到底标没标定"。

---

### F-1（P1，用户可见数据质量）自动提取刻度只标定 8/28 列，另外 20 列被静默跳过且无逐列说明

**症状。** 步骤 6 点【自动提取刻度】后，HUD 只报一句
`自动检测完成：已成功识别并标定 8 个属种列的刻度齿！`。用户看不出**哪 20 列没标定**、
也看不出**为什么**。这 20 列的 X 标度随后走 legacy 兜底（0–100% 按列宽），
而那些数会被写进导出的 CSV。对科研数据而言，"未标定按列宽百分比估算"与"真的按刻度标定"
是两种完全不同性质的数字，界面上只有一句汇总，没有逐列警示。

**根因。** `frontend/src/services/InspectorBridge.ts:355-370`：

```ts
if (col && Array.isArray(item.ticks)) {
  col.detected_ticks = item.ticks;
  if (item.ticks.length >= 2) {        // ← 少于 2 个齿就整列跳过，且不计数
    …
    const calibRes = await rpcClient.calibrateColumnXTicks(…);
    col.x_ticks = calibRes.x_ticks;
    successCount++;                     // ← 只累加成功，没有"跳过"的计数器
  }
}
```

`successCount` 只统计成功数，**没有** `skipCount` / `失败原因` 的通道，
所以 20 列被跳过这件事在 UI 上没有任何痕迹。

**真实复现（后端直测，不经 UI）。**

```bash
$ pixi run python - <<'EOF'
import sys; sys.path.insert(0,'.')
from straditize_core.session import StraditizeSession
s = StraditizeSession(); s.load_image(sample_key="hoya")
s.detect_columns([315,1946],[511,1311])
res = s.detect_xticks_rpc()
per = res["per_column"]
with2 = [p for p in per if len(p.get("ticks") or []) >= 2]
skip  = [(p["column_index"], len(p.get("ticks") or [])) for p in per if len(p.get("ticks") or []) < 2]
print(f"总列数={len(s.columns)}  band={res.get('band')}")
print(f"可标定(>=2齿)={len(with2)}  被静默跳过(<2齿)={len(skip)}")
print("跳过的列(下标,齿数):", skip)
EOF
```

真实输出：

```
总列数=28  band=[1312, 1318]
可标定(>=2齿)=8  被静默跳过(<2齿)=20
跳过的列(下标,齿数): [(4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (9, 1), (10, 1), (11, 1),
 (12, 1), (13, 1), (15, 1), (17, 1), (18, 1), (20, 1), (21, 1), (22, 1), (23, 1),
 (24, 1), (25, 1), (26, 1)]
```

即：**20 列各自只检出 1 个齿**，`ticks.length >= 2` 恒假，全部静默跳过。

**这次跳过后端是诚实的**（不是缺陷的一半）：未标定列的 `resolve_column_scale`
如实返回 `source="legacy"`、`calibrated=False`：

```
col0 x_ticks=yes -> source=x_ticks calibrated=True  max_val=None
col4 x_ticks=NO  -> source=legacy   calibrated=False max_val=None
col5 x_ticks=NO  -> source=legacy   calibrated=False max_val=None
```

导出面板也如实显示"8 列已标定 / 20 列未标定 (按列宽百分比估算)"
（`frontend/src/components/steps/ExportReadinessPanel.ts:53-56,76`）。

**所以这条缺陷的准确表述是**：数据链是诚实的，**但在步骤 6 当场**用户拿不到
"哪 20 列没标定、为什么"的信息 —— 他必须走到步骤 8 打开导出面板才能看到汇总数字，
而那时已经在下游。建议：把跳过数与跳过原因（"只检出 1 个齿"）在步骤 6 就地列出，
并允许逐列一键补标定。

**违反的不变量。** `docs/ARCHITECTURE.md` §2 ——"面向用户的数据只有唯一合法来源：
后端对用户输入的真实计算；取不到就报错并停在原地"。这里没有伪造数据（后端如实标
`calibrated=False`），但**取不到逐列信息时没有就地告知用户**，与 §2 的立意不符。

---

### F-2（P2，交互竞态）步骤 3 标定面板每次提交都整块重挂：**焦点必然被摧毁**，丢值是间歇竞态

**严重度：P2（不是 P1）。** 我最初把它写成"稳定丢值"，后续 7 次定向复现**没能**稳定
复现丢值，只稳定复现了"焦点被摧毁"。诚实的表述见下面的实测。

**稳定复现的部分（7/7）。** 提交标定后焦点必然掉回 `<body>`：

```
DOM 现值 = {"topPx":"511","botPx":"1311","topVal":"0","botVal":"1300","unit":"cm","active":"BODY"}
                                                                                       ^^^^^^^^^^^^
```

用户可见后果：填完一个框按 Tab 想切下一个框，焦点已经不在任何输入框里，
接着敲的数字落不到任何地方。

**不稳定复现的部分（0/7）。** 我试了 5 次逐框 `fill()` + 3 次逐字符输入 + Tab，
后端标定值**每次都正确**：

```
后端 calibration = {"isCalibrated":true,"top_px":511,"top_cm":0,"bottom_px":1311,"bottom_cm":1300,"unit":"cm",…}
```

所以"值被吞掉"这条我**没有**独立复现出来（`docs/testing-strategy.md` §9 有更早的实测记录，
但那是别的会话在别的时序下观察到的）。**我没有把它当作已确认的丢值缺陷来定级。**

**机制（读码确认，非推测）。** 两处叠加：

1. `frontend/src/components/steps/YCalibPanel.ts:143-145` 给 5 个框都挂了
   `change → commitCalibration`，而 `commitCalibration` 只要四个数值都能解析就发请求
   （`:121-123`）→ "逐个填"会连发多次**只带部分新值**的标定请求。
2. 每次提交成功后 `applyDepthCalibration` 都调 `inspector.updateData()`
   （`frontend/src/main.ts:1687`）→ `Inspector.render()` 把 `this.element.innerHTML`
   整个换掉（`frontend/src/components/Inspector.ts:142`）→ 步骤面板重挂。

**我的处置。** 旅程改为"一次写全五个值 + 只点一次应用"（与 `step3-ycalib.spec.ts:64-112`
同一处置）。这是**规避已知竞态**，不是放宽断言：旅程要验证的是"标定能不能做对"。

**建议。** 把面板实现为 `update(data)` 而非整块重挂；或重挂时保留 focus 与未提交值。
注意不能简单"保留旧值"——后端拒绝时那样会掩盖后端的纠正。

### F-3（P2，测试可用性/诊断）`core.loadImage` 的"半完成状态"会被尺寸读到：`imageWidth` 先于 `rois` 落地

**症状（对测试与自动化的影响）。** 直觉写法"轮询到 `imageWidth == 2339` 就认为载入完成"
是**错的**：那一刻 `rois` 还是空数组。拿着这个半完成状态去断言 ROI 数量，会得到一条
与产品无关的红。

**根因。** `straditize_core/session_parts/core.py:232-236`：

```python
self.image_path = …
self.width, self.height = img.size          # ← 尺寸在这里就写好了
…
sug = self.suggest_data_region()            # ← 要跑一遍连通域分析（耗时）
self.roi_create(                          # ← ROI 在这之后才建
    name="pollen", x0=sug["xMin"], …
)
```

**真实复现。**

```bash
$ # 在 playwright 里轮询
width became truth after 84ms
immediately after width truth: rois= 0        ← 尺寸到位那一刻 ROI 还没建
rois appeared 350ms later                     ← 约 350ms 后才出现
```

**我的处置。** 把等待条件改成**被断言的那个量本身**（`{width, height, rois}` 三元组一起等），
而不是它的前驱。这正是 `docs/testing-strategy.md` §4.2 的纪律：
"一次 RPC 可能分两阶段落地，等待条件必须直接写成被断言的统计量"。

**这是产品缺陷还是设计？** 严格说不是用户可见缺陷——单次 RPC 内部的瞬时中间态，
用户感知不到。但它是**测试/自动化盲区的来源**，且反映"一次 RPC 承担了两个阶段"
这一结构性问题。登记在此，供后续把 `loadImage` 拆成"载入"与"建 ROI"两步时参考。

**建议**：低优先。若将来要支持更细粒度的载入进度，可显式返回阶段状态的约定。

---

## 4. 更正记录：我曾把「重新分列抹掉 `x_ticks`」误判为"未复现"

> 本节是**改错记录**，保留原始误判理由，因为"为什么会看错"本身有价值。

**我最初的结论（错误）**：`step6-xticks.spec.ts:117-120` 的注释称"重新分列会静默抹掉
全部列的 `x_ticks`"，我实测了**同边界**与**边界微差**两种情形，`x_ticks` 都保留，
于是判它"可能是陈旧注释"。

**错在哪**：我只变了**边界**，没意识到真正的判据是**列数是否变化**。
`session_parts/core.py:703` 起：

```python
preserve_state = len(old_roi_cols) == len(detected_cols)   # ← 判据是列数，不是边界差
...
if preserve_state:
    if old_c.get("x_ticks"):                                # ← 这块整段被跳过
        ...
```

边界差价只是**恰好没改变列数**。我试的 `[315,1900]`（Δ右 −46px）列数仍是 28，
所以标定活下来了——而那让我误以为"差 46px 都不受影响，说明跟边界无关"，
却没往"列数变了会怎样"再走一步。

### 4.1 我自己的复现（独立跑，非引用他人输出）

脚本逻辑：同一张 hoya、同一组刻度，标定第一列后**逐个区间**重分列，观察 `x_ticks`。

```bash
$ pixi run python /tmp/xticks_probe.py
新区间              Δ左     Δ右  列数        x_ticks     前source     后source
[315, 1946]       0      0   28->28    保留          x_ticks     x_ticks
[315, 1930]       0    -16   28->28    保留          x_ticks     x_ticks
[330, 1946]      15      0   28->28    保留          x_ticks     x_ticks
[315, 1900]       0    -46   28->28    保留          x_ticks     x_ticks
[340, 1946]      25      0   28->27    **被抹掉**     x_ticks     legacy
[350, 1946]      35      0   28->27    **被抹掉**     x_ticks     legacy
[400, 900]       85  -1046   28->3     **被抹掉**     x_ticks     legacy
```

结论：**列数不变 → 保留；列数一变 → 静默清空 `x_ticks`**，并退化到 `source="legacy"`。
"20px 阈值"是表象（它只是恰好改变了列数）。

### 4.2 数据损坏程度：同一点读数从 13.92% 变成 −16.25%

```bash
$ pixi run python /tmp/xticks_numeric.py
标定后   x_ticks=[{'px': 322.0, 'value': 0.0}, {'px': 480.0, 'value': 20.0}]
         source='x_ticks' calibrated=True
         像素 x=432 读数 = 13.9241 %
重分列后 x_ticks=None
         source='legacy' calibrated=False
         像素 x=432 读数 = -16.2500 %

同一个像素点，读数从 13.9241% 变成 -16.2500%（差 30.1741 个百分点）
```

换算走的是**导出与 QA 用的同一个入口** `resolve_column_scale`
（`session_parts/export.py:129`、`session_parts/qa.py:129`、`rpc_methods/system.py:128`），
所以这不是"我另算了一套"，而是导出里真的会变成那个数。**而且读数可以是负数**——
百分比不可能为负，这本身就说明换算链已经失效。

### 4.3 已钉成回归

`frontend/e2e/from-zero-journey.spec.ts` 的第二条用例
`回归：重新分列与 x_ticks 标定的存亡` 用 `test.fail()` 把这个缺陷固定下来：

* 缺陷还在 → 该用例"预期失败"，整轮仍 `2 passed`（不阻塞交付）；
* 缺陷修好 → 用例意外通过，Playwright 报 `Expected to fail, but passed`，
  **强制**摘掉 `test.fail()` 并升格为正向回归。

摘掉开关：`STRADITIZE_EXPECT_XTICKS_FIXED=1` 可以让它按正常断言跑（修好后用来验证）。

---

## 4-bis. 我特意核过、但**确认不是缺陷**的项

诚实记录，避免读者以为下面这些也被漏掉了。

| 项 | 结论 |
| --- | --- |
| 零状态白屏 / boot 失败 | **不存在**。零状态下 `window.__straditize` 正常就绪，画布正常挂载 |
| 零状态回落内置范例 | **不存在**。后端如实返回 `imageSrc: null` / `rois: []` |
| 上传后自动预跑分列 | **不存在**。载入后 `columns=[]`（已用金丝雀反向验证，见 §5） |
| ROI 与标定互相派生 | **不存在**。标定后 `rois[0].xlim` 与标定前完全一致 |
| 检测候选时动了像素 | **不存在**。检测后 `exclusion_regions=0`、`line_strokes=0` |
| 导出只有表头 | **不存在**。`data.csv` 111 行、最大读数 28.96% |
| `data.csv` 归属错 ROI | **不存在**。与 `data/pollen.csv` 逐字节相同 |
| 未标定列的换算是否被伪造 | **不存在**。`resolve_column_scale` 如实返回 `calibrated=False` / `source='legacy'`，导出面板也如实显示"N 列未标定" |
| F-2 逐框 `fill()` 是否丢值 | **未复现（见下方更正）** |

### 更正：F-2 我高估了复现率

我最初在日志里把 F-2（逐框填写丢值）写成"本用例第一版踩到了"。后续我做了 7 次定向
复现（5 次逐框 `fill()` + 3 次逐字符输入 + Tab），**值都正确落到后端**：

```
后端 calibration = {"isCalibrated":true,"top_px":511,"top_cm":0,"bottom_px":1311,"bottom_cm":1300,"unit":"cm",…}
```

**唯一稳定复现的是"焦点被摧毁"**（提交后 `document.activeElement.tagName === "BODY"`），
而不是"值被吞掉"。所以 F-2 的准确表述应是：**重挂会丢焦点（稳定复现）；
丢值是间歇竞态（我未稳定复现）**。我把 P1 降为 P2 的依据正在于此——它确实存在
（代码链清楚：`YCalibPanel.ts:143-145` 的 `change` → 提交 → `main.ts:1687`
`inspector.updateData()` → `Inspector.ts:142` 整块重挂），但不是稳定可复现的丢数。

---

## 5. 门禁自身的可信度：金丝雀

**一个从不失败的门禁等于没有门禁。** 我做了两次故意注入，确认用例真的会变红，再还原。

### 金丝雀 A：让"上传"不打后端（伪造成功响应）

```ts
// frontend/src/services/RpcClient.ts —— loadCustomImage
- const backendResult = await this.call<Record<string, unknown>, any>('core.loadImage', payload);
+ const backendResult = { suggested_roi: {…}, width, height, rois: [], … } as any; // CANARY: 不调后端
```

结果 **变红**，且红在**承重断言**上：

```
Error: 上传真实 PNG 后，后端必须同时具备：尺寸 2339×1654 **且** 自动建出 1 个 ROI（两者由同一次 core.loadImage 落地）
```

同时 `fixtures.ts` 的全局门禁抓到派生错误 `[RPC failure] 图谱倾斜检测: 前置状态未就绪 (code -32001)`。

### 金丝雀 B：让"载入时偷偷预跑分列"

```ts
// frontend/src/services/RpcClient.ts —— after applyLoadedImage
+ await this.call('core.detectColumns', { data_xlim: [315, 1946], data_ylim: [511, 1311] });
```

结果 **变红**，且正好红在目标断言上：

```
Error: 载入后绝不能自动分列（分列是步骤 5 的动作）
```

**这条注入的判别力尤其重要**：它证明了"上传不预跑分列"不是一句写在注释里的愿望，
而是被真实断住的。两次注入后均已还原，`git diff --stat` 为空，复跑恢复 `2 passed`。

### 金丝雀 C：F-4 回归钉子本身会随缺陷状态翻转（不需要注入，缺陷就是现状）

F-4 那条用例用的是 `test.fail()`，它的判别力来自**两个方向**：

| 状态 | 期望表现 | 实测 |
| --- | --- | --- |
| 缺陷还在（当前） | 用例 `✘`，但计入 `2 passed` | ✓ `2 passed (17.3s)` |
| 缺陷被修好 | 用例意外通过 → `Expected to fail, but passed` → 整轮**变红**，强制摘掉标注 | 用 `STRADITIZE_EXPECT_XTICKS_FIXED=1` 按正向断言跑即可验证该分支 |

即：这条路不需要我人为注入，**产品自己就在驱动它**。它不是"永真断言"，
因为一旦有人真把 `x_ticks` 的继承逻辑按列 id 修好，它立刻会以"预期之外地通过了"
的形式要求我们更新测试。

---

## 6. 这次旅程**没有**覆盖的范围（诚实声明）

| 未覆盖 | 原因 |
| --- | --- |
| 多 ROI 工程 | 旅程按"一个人从零做一份图"走，只建了一个 ROI。多 ROI 的归属/导出已有 `export.spec.ts` 覆盖 |
| 手工拖拽几何 / 笔刷修正（步骤 4 的增删改） | 旅程只走了"检测候选"，未确认/删除几何，也未涂抹笔迹。已有 `step4-cleanup.spec.ts` 覆盖 |
| 落盘后重载（`page.reload()`）验证持久化 | 本应用有 `beforeunload` 守卫，reload 会被 fixture 按掉（见 `docs/testing-strategy.md` §8.4 的坑）。持久化已由 `step6-xticks.spec.ts:241` 覆盖 |
| 其它格式导出（XLSX / LiPD） | 旅程只验证了 `.tar`（含 `data.csv`） |
| 项目保存 / 载入（`.tar` / `.json` 工程包） | 不在"从零到导出"主线内 |
| OCR 属种名识别 | 需要模型与人工核对，未纳入自动旅程 |
| **「改完 ROI 后重新分列」这条路径（第 5 步重跑）** | **这条恰恰是数据损坏的入口（F-4）**。上面的旅程只在步骤 2 定了 ROI、步骤 5 分了一次列，之后没再改 ROI 重新分列。我已把这条单独钉成 spec 的第二条用例 `回归：重新分列与 x_ticks 标定的存亡`（`test.fail()` 标注），但它验证的是**缺陷存在**，不是"用户能安全地改完 ROI 再分列"。**在 F-4 修复前，用户改 ROI 边界后重新分列会静默丢掉全部列标定。** |

---

## 7. 复跑检查清单（用户自证）

| 检查项 | 期望 |
| --- | --- |
| 命令退出码 | `0` |
| 输出末行 | `2 passed`（第 2 条是 `test.fail()` 钉住的已知缺陷 F-4，**预期**失败，不算失败计数） |
| `journey-trace.json` 的 `steps` 长度 | `9`（步骤 0–8） |
| 每个 step 的 `backend` 键数 | `≥ 2`（无空快照） |
| `steps[8].backend.tar.dataCsvRows` | `> 0`（本次 `111`） |
| `steps[8].backend.tar.maxCell` | `> 0`（本次 `28.9593`） |
| `steps[8].backend.tar.dataCsvEqualsPrimary` | `true` |
| 是否有 `test.skip` / `test.fixme` / 注释掉的断言 | **无**。唯一的 `test.fail()` 用于把已确认缺陷 F-4 钉成回归，语义是"我们知道它会红，修好后它会变绿并强制我们摘掉标注"，不是跳过 |
| `test.use({ allowlists })` 豁免 | **无**（本用例全程不故意触发错误路径） |
