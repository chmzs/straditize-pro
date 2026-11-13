# 独立复核（第四轮）：T-02 空输入必须报错 / 决策③ 新建 ROI = 待框选空区域

- 复核人：verifier（未采信 Fixer 的 `.scratch/fix/T-02-*`，仅当线索）
- 日期：2026-11-09
- 仓库：`E:\software_dev\straditize`，端口 **22965**（探针用 22966）
- 触发脚本：`.scratch/verify/run3.ps1` / `run-adj3.ps1` / `run-probe*.ps1`

---

## 0 结论

| 对象 | 结论 |
| --- | --- |
| **A：T-02 空输入点「应用标定」必须明确报错** | **有效门禁** |
| **B：决策③ 新建 ROI = 待框选空区域** | **有效门禁** |
| **`journey.spec.ts` 的改动** | **放水：否。48 行全为新增、0 行删除；只补了一次真实用户动作（框选），断言一字未动** |

两个金丝雀都在错误实现上变红、且红在缺陷本体：

- A：把「应用标定」改回 `commitCalibration(false)` → `ycalib-empty-input` 第 1 条红在
  `spec:131`，`Expected: 1 / Received: 0`（连一条错误提示都没有，正是 T-02 的"零反应"）。
- B：把 `InspectorBridge` 的新建改回"克隆当前 ROI + 传 name" →
  `roi-create-empty` 红在 `spec:124`，`Expected: 0 / Received: 1304800`，
  实际落库 `xlim=[315,1946] ylim=[511,1311]`（克隆缺陷的指纹）。

两次改动均已还原，构建哈希逐字节回到本轮基线 `index-C2h7sglR.js`。

---

## 1 机械层证据

### 1.1 改动范围

```
 M frontend/e2e/journey.spec.ts                 (48+/0-)
 M frontend/src/components/canvas/hitTest.ts    (+11)
 M frontend/src/components/steps/RoiPanel.ts    (+15)
 M frontend/src/components/steps/YCalibPanel.ts (+62/-15)
 M frontend/src/i18n/locales/en.ts              (+2)
 M frontend/src/i18n/locales/zh-CN.ts           (+2)
 M frontend/src/services/InspectorBridge.ts     (+21/-16)
```

### 1.2 先审 `journey.spec.ts` 是否放水（这是本轮第一顺位）

机械事实，不是判断：

```
$ git diff --numstat -- frontend/e2e/journey.spec.ts
48	0	frontend/e2e/journey.spec.ts
```

**48 行新增、0 行删除**。diff 里除 hunk 头外没有任何 `-` 行 —— 意味着原有断言、等待、
步骤序列**逐字未动**。新增的只有三样东西：

1. `RoiSummary` 接口补两个可选字段 `xlim?/ylim?`、`DiagramData` 补 `activeRoiId?`（纯类型）；
2. 新增 helper `frameActiveRoi(page, wx, wy)`（`:90-129`）：从活动 ROI 的左上角手柄真实按下 →
   24 步移动 → 抬起，然后**轮询后端**直到该 ROI 的宽度 > 0（`toBeGreaterThan(0)`）；
3. 在 `:173` 插一行 `await frameActiveRoi(page, 1900, 1300);`，位置在原有用例
   "点 `.btn-set-primary` 提升主区"之后、`#btn-apply-roi-next` 之前。

我逐行核对过上下文（`journey.spec.ts:120-209`）：`expect(roiName).toHaveValue(/roi_2/)`、
"两个 ROI 的新名字都要进后端"、`primaryRoiId` 断言、步骤 3 的四个框 + 两点标定 +
`calibration.isCalibrated/top_px/bottom_px/unit` 断言，全部原样保留，没有放宽等待（
`waitStage` 参数未改）、没有 `test.skip/fixme`、没有新增 `waitForTimeout`、没有把
`toEqual` 降级成 `toBeTruthy`。

**判定：这是"补真实用户动作"，不是放宽判据。** 而且它让 journey 变**更强**了：
改前 journey 依赖"新建 ROI 自带边界"这个已被决策③改掉的行为；改后它必须真的把区域画出来，
多走了一段此前零覆盖的路径。唯一的副作用是 `frameActiveRoi(…, 1900, 1300)` 把目标点写死为
世界坐标，换成别的样本图时需同步调整（见 §5-6）。

### 1.3 A：T-02 修复实现上跑（绿）

```
[WebServer] [e2e] backend ready on http://127.0.0.1:22965/
Running 2 tests using 1 worker
  ✓  1 … 四个数值框全空时点「应用标定」：报错点名缺失字段、零写请求、后端仍未标定 (6.5s)
  ✓  2 … 填齐四个值后点「应用标定」：正好 1 次写请求且后端逐字段等于输入 (6.6s)

  2 passed (23.2s)
TEST_EXITCODE=0
```

构建产物 `dist/assets/index-C2h7sglR.js`。日志：`.scratch/verify/r4-T-02-green.log`。

### 1.4 A 金丝雀：`commitCalibration(false)`（红）

改法（我自己造的，与 Fixer 无关）：`YCalibPanel.ts` 里「应用标定」的监听
`() => commitCalibration(true)` → `() => commitCalibration(false)`。
构建哈希 `index-C2h7sglR.js → index-VNpdL4iz.js`（证明改动真的进了产物）。

```
  ✘  1 … 四个数值框全空时点「应用标定」 (16.2s)
  ✓  2 … 填齐四个值后点「应用标定」 (5.9s)

  1) …
    Error: 空输入点「应用标定」必须给出用户可见的错误（不能零反应）
    expect(received).toBe(expected) // Object.is equality
    Expected: 1
    Received: 0
    Call Log:
    - Timeout 10000ms exceeded while waiting on the predicate
    > 131 |       .toBe(1);

  1 failed
  1 passed (34.5s)
TEST_EXITCODE=1
```

红在"提示条数必须为 1"，收到 0 —— 即完全无反应，与 T-02 症状同形。
第 2 条（负向对照）仍绿，说明红的不是"提交能力被破坏"。日志：`.scratch/verify/r4-T-02-canary-red.log`。

### 1.5 B：决策③ 修复实现上跑（绿）

```
Running 1 test using 1 worker
  ✓  1 [msedge] › e2e\roi-create-empty.spec.ts:98:1 › 新建 ROI 是待框选的空区域，且框选后边界等于用户画的 (8.4s)

  1 passed (18.0s)
TEST_EXITCODE=0
```

日志：`.scratch/verify/r4-T-02B-green.log`。

### 1.6 B 金丝雀：改回"克隆当前 ROI + 传 name"（红）

改法：`InspectorBridge.ts` 的 `roi.create` 调用处恢复成
`{ name: 'roi_'+(n+1), x0, x1, y0, y1, composition: true }`，边界取当前 ROI
（`data.roi.xMin/xMax/yMin/yMax`，与旧实现一致）。构建哈希 `→ index-ZTjFiWqv.js`。

```
  ✘  1 … 新建 ROI 是待框选的空区域，且框选后边界等于用户画的 (6.5s)

  1) …
    Error: 新建 ROI 必须是零面积的"待框选"区域，实际边界 xlim=[315,1946] ylim=[511,1311]
    expect(received).toBe(expected) // Object.is equality
    Expected: 0
    Received: 1304800

    > 124 |   ).toBe(0);

  1 failed
TEST_EXITCODE=1
```

红在"判据 A：面积为 0"，实收 1304800 px²（= 1631×800），失败信息把克隆边界原样打出来。
日志：`.scratch/verify/r4-T-02B-canary-red.log`。

### 1.7 还原后复跑（两条一起）

构建哈希回到 **`index-C2h7sglR.js`**（与 §1.3 基线一致 ⇒ 逐字节回到修复态）。

```
Running 3 tests using 1 worker
  ✓  1 roi-create-empty (7.9s)
  ✓  2 ycalib-empty-input 正向 (5.4s)
  ✓  3 ycalib-empty-input 负向对照 (5.7s)

  3 passed (29.5s)
TEST_EXITCODE=0
TYPECHECK_EXITCODE=0
```

源码终态核对：`InspectorBridge.ts` 该区块的 revision 与金丝雀之前一致
（`a72da855…`），`YCalibPanel.ts` 中「应用标定」监听已是 `commitCalibration(true)`。

### 1.8 相邻（含被改的 journey）

```
npx playwright test step3-ycalib undo-calibration step2-roi journey workflow-panels project-roundtrip --reporter=list
```

```
Running 18 tests using 1 worker
  ✓  1 journey.spec.ts:136 › 走完 8 步后，ROI/标定/分列/采样与导出的 tar 都必须与后端状态一致 (20.2s)
  ✓  2-3 project-roundtrip (T-05)                9.5s / 7.2s
  ✓  4-6 step2-roi 三条                          6.7s / 8.8s / 6.1s
  ✓  7-11 step3-ycalib 五条                      5.7s / 5.4s / 5.9s / 5.6s / 6.2s
  ✓ 12-13 undo-calibration (T-04)                8.7s / 7.3s
  ✓ 14-18 workflow-panels 五条                   8.1s / 8.5s / 7.9s / 4.9s / 5.0s

  18 passed (2.5m)
TEST_EXITCODE=0
TYPECHECK_EXITCODE=0
```

日志：`.scratch/verify/r4-adjacent.log`。**journey 20.2s 通过**，说明"补框选"这条改动
在真实旅程里成立，且没有掩盖任何后续步骤的断言。

---

## 2 判据层证据 —— 对象 A（T-02）

### 2.1 逐条断言

| # | 位置 | 断言 | 错误实现上 | 判别力 |
| --- | --- | --- | --- | --- |
| 1 | `:106-112` | 四个框 `inputValue() === ''` | 通过 | 否（前置守卫：证明占位符不算值） |
| 2 | `:113-116` | 后端 `isCalibrated === false` | 通过 | 否（前置守卫） |
| 3 | `:123-131` | `notices` 里含错误前缀的条数 `=== 1` | **失败**（收到 0） | **是**（金丝雀红在此） |
| 4 | `:132-138` | 错误文案逐个包含四个字段名 | 失败（没有文案） | **是** |
| 5 | `:141` | `core.calibrateAxes` 请求数 `=== 0` | 通过（本来就不发） | 否（守"提示了但照样乱写"） |
| 6 | `:142-147` | 后端 `isCalibrated=false` 且端点 `null` | 通过 | 否（同上，守"被占位符 556/1320 写成真值"） |
| 7 | 负向 `:161` | 「应用标定」`toBeEnabled` | 通过 | 否（守"改成永远 disabled"） |
| 8 | 负向 `:167-172` | 填齐后后端 `isCalibrated === true` | 通过 | 否（守"改成永远报错"） |
| 9 | 负向 `:173-182` | 后端四字段 `toMatchObject` 用户输入 | 通过 | 否（同上） |
| 10 | 负向 `:183-186` | 写请求数**正好 1** | 通过 | 否（守"重复提交"） |

**判别力集中在 #3/#4 两条，其余 8 条全是前置守卫或"守另一种错修"。** 这是合理分工：
#5/#6 与 #8/#9/#10 一起把"永远不报错"与"永远报错/永远 disabled/重复提交"四类偷懒实现都堵住。
正向用例带 `test.use({ allowlists: { notice: [/^Y 轴标定未提交/] } })`，负向 describe **没有**豁免
⇒ 负向路径若冒出任何通知会直接红。

### 2.2 「报错文案是否真的点名缺失字段」（我自己加测）

spec 只测了"四个全空"，那种情况下"一律列举四个"的偷懒实现也能过。所以我另写探针
（`.scratch/verify/probe_ycalib_partial.mjs`，读 DOM 里的 `.ui-toast--danger` 文本）：

```
只缺「Y2 数值」：
  toast: "Y 轴标定未提交：请先填 Y2 数值（四个数值框都必须有数字）。"
  mentions_bot_val: true,  leaks_other_labels: []      ← 没有把另外三个也列出来

字段值是 "-"（打了但不是数字）：
  toast: "Y 轴标定未提交：请先填 Y1 数值（四个数值框都必须有数字）。"

change（逐框填写后失焦）：
  toast 数 = 0                                          ← 自动提交保持静默（设计如此）

点「下一步」：
  toast 数 = 0，后端 isCalibrated 前后都是 false         ← 静默跳过（设计如此）
```

**结论：文案确实点名到"哪个框"，不是泛泛的"参数错误"，也不是一律列举四个。**
实现比 spec 钉住的更强 —— spec 这一层反而弱于实现（见 §5-1）。

### 2.3 「零写请求」读的是什么量

`spec:60-68`：`page.on('request')` → 只取 `url().includes('/rpc')` → 读
`req.postData()` 里是否含 `core.calibrateAxes`。

这是**真实 HTTP 请求体**，不是 toast、不是前端镜像、不是 RPC 客户端的返回值。
它计的是"发出去的意图"，比"成功落库"更严（发了失败也算 1），所以对"不得发请求"这条结论
是充分强。而"后端未变"另由 #6 从 `straditize.getDiagramData` 独立读一次，两者不是同一个量。

### 2.4 负向对照能否区分「永远报错」这种假修

能，而且是三面夹：

- 「永远报错」→ 填齐后后端不会变 true → #8 的 15s 轮询超时红；
- 「永远 disabled」→ #7 `toBeEnabled` 直接红；
- 「报错但仍乱写」→ #5 请求数 ≠ 0 红。

同时它自己还排除了"撤销/清空把状态弄脏"的可能：负向 describe 没有豁免，任何意外通知都会红。
**金丝雀②的角色由 `undo-calibration` 那种"假修复"承担过；这里对偶的假修复（永远报错）由 #8 承担，
我复核时未再造第三条金丝雀，因为 #8 的失败路径是可从代码直接判定的（`isCalibrated=true` 只能由
真实 `core.calibrateAxes` 成功产生）。**

---

## 3 判据层证据 —— 对象 B（决策③）

### 3.1 五条判据的判别力（克隆实现下会怎样）

| 判据 | 读什么 | 克隆实现下 | 有判别力 |
| --- | --- | --- | --- |
| **A 面积 = 0**（`:121-124`） | 后端 `roiArea(fresh)` | **失败**（实测 1304800） | **是**（金丝雀红在此） |
| **B 与既有 ROI 交集 = 0**（`:127-130`） | 后端两矩形交集面积 | 失败（整块重合） | **形式上被 A 蕴含**：面积恒 0 ⇒ 交集恒 0，A 通过时 B 不可能失败。**无独立判别力**，只是把同一个事实换个可复算的表述（spec 注释自己也承认这点） |
| **C `name_source === 'default'`**（`:133-136`） | 后端 `name_source` | 失败（传 name → `user`） | **是**，且与 A 完全独立（后端 `roi.py:68-77` 由 `name is None` 决定） |
| **D `activeRoiId === fresh.id`**（`:139`） | 后端 `activeRoiId` | **通过**（克隆实现也会 `roi.setActive`） | **否**（两边都绿） |
| **E 提示可见 + 含"框选/拖" + 框选后消失**（`:142-144, :171`） | `.roi-empty-hint` | 失败（非空 ROI 不渲染该块） | **是**（依赖"空"这一条件） |

所以真正承重的三条是 **A / C / E**；B 是冗余（无害），D 无判别力（守的是"新建后要自动激活"，
与决策③正交）。

### 3.2 「提示可见」会不会恒真

不会，判断依据是渲染条件而不是"出现在哪个时刻"：

`RoiPanel.ts:19-25` 在**每次 render 时**按 `activeRoi` 的 `xlim/ylim` 现算
`isEmptyRoi = roiW === 0 || roiH === 0`，只有为真才输出 `[data-roi-empty-hint]` 块。
所以它是"空⇒有、非空⇒无"的派生量，不是"新建时插一次、之后不再管"。

spec 也真的把后半段钉住了：`:171` 在框选落库后断言 `toHaveCount(0)`。
若提示写成"永远渲染"，这一条会红——我在**金丝雀 B** 的失败日志里看到它实际生效（克隆实现下
A 先红，说明提示确实没出现）；而正向运行时它又确实先出现后消失，两半都验到了。

### 3.3 空 ROI 落在 (0,0)：抓手看得见吗？平移离开再回来呢？

我自己量的（`.scratch/verify/probe_empty_roi_pan.mjs` / `probe-empty-roi-pan.log`）：

```
[probe] empty-roi: {"id":"roi_2","xlim":[0,0],"ylim":[0,0],"name_source":"default"}
[probe] corner-screen-pos: {"scale":0.4360837964942283,"panX":60,"panY":110.85870029927321,
                            "corner":{"x":340,"y":190},
                            "canvas":{"x":280,"y":79,"w":1140,"h":943},
                            "insideCanvas":true}
[probe] pan-away:  {"pan":{"panX":280,"panY":270.86},"corner":{"x":560,"y":350}}
[probe] pan-back:  {"pan":{"panX":60,"panY":110.85870029927321},"corner":{"x":340,"y":190},
                    "cornerDeltaVsStart":{"dx":0,"dy":0},"panDeltaVsStart":{"dx":0,"dy":0}}
```

- **(0,0) 不会让抓手不可见**：默认 fit（scale≈0.436）下它落在画布内 `(340,190)`，
  距画布左边 60 px、上边 111 px —— 不是贴边、不在侧栏底下、也没被顶栏盖住。
- **平移离开再回来，位置逐像素复原**（`dx=dy=0`），节点坐标只是
  `world × scale + pan` 的纯变换，不存在"平移后抓手丢失"的状态。
- 但要注意：`(0,0)` 是**图像原点**，若用户先放大/平移到图像别处再点新建，这个点可能落在视口外，
  产品没有"新建后自动把抓手带进视野"的动作（见 §5-5）。

### 3.4 探针局限（如实声明，不含糊）

我在同一批探针里尝试"平移回来后再拖一次，看能不能把空 ROI 画开"，**结果没能拖开**。
但在把控制组补齐后，我判定**这是探针失效而不是产品缺陷**，证据两条：

1. `probe_handle_isolation*.mjs` 里，对**普通 ROI（roi_1）的真实手柄**做同样的拖拽，
   `roi.update` 请求数同样是 **0**、边界也不变 —— 失效的是这个裸脚本的整体鼠标手势通道，
   不是空 ROI 特有；
2. 同一脚本里 `.roi-item-card` 选择器超时找不到（而 `journey` 里它能正常用），说明该页面的
   UI 与测试 harness 建立的页面不是同一状态（我没走 harness 的 `resetBaseline`/`openApp`）。

因此"抓手能不能拖"这一点我不以探针作证，改用**已经通过的 e2e 用例**作证：
`roi-create-empty` 断言框选后的右/下边界等于拖拽终点 ±5 px（`:161-168`）且面积 > 0（`:151-157`），
它是从 `(0,0)` 那个重合点起手拖的 —— 这条只有在"抓手真的可命中、真的能画开"时才可能绿。
**探针负责回答"在哪、会不会丢"，e2e 负责回答"能不能拖"，两者分工写清。**

---

## 4 `journey.spec.ts` 改动的审读结论（单独成节）

- **没有变弱任何断言**：`git diff --numstat` = `48 / 0`，除 hunk 头外零 `-` 行；
  我另外通读了 `:120-209` 的正文，改名/双 ROI/主区切换/两点标定/后端标定三字段断言原样在内。
- **没有放宽等待**：`waitStage` 调用与 timeout 未改；新增轮询 only 用于"框选是否落库"，
  且是 `toBeGreaterThan(0)` 的**新**前置条件，不是替代旧断言。
- **没有跳过步骤**：`#btn-apply-roi-next` 与后续 3→4→…→8 的推进路径逐行未动。
- **只补了真实用户动作**：一次 `mouse.down → 24 步 move → up`，与真实用户拖手柄等价，
  且用后端事实（宽度 > 0）确认动作真的落地，而不是只看 DOM。
- 唯一可批评点：目标世界坐标 `(1900, 1300)` 写死（§5-6）。

---

## 5 新发现的问题（只报不改）

1. **A 的 spec 只覆盖"四个全空"，"点名到具体字段"未被钉住。**
   按现状，一个"缺啥都打印四个名字"的实现也能过（我的探针证明真实实现不是这样，但门禁没钉）。
   建议加一条"只缺 Y2 数值"的用例，断言文案包含「Y2 数值」且**不含**其余三个标签。

2. **A 的「下一步」仍是零反馈跳过。**
   `#btn-apply-ycalib-next` 用 `commitCalibration(false)`，空输入时**不提示、不写后端**直接进步骤 4。
   探针实测：toast 0 条、`isCalibrated` 前后都是 false。这是本轮明确的设计选择
   （"下一步仍静默跳过"），但它与 T-02 属同一失败家族：用户以为标定过了，其实没有。
   建议至少给一条 `warning` 级提示（非阻断）或把按钮置灰。

3. **B 的判据 B（交集 = 0）在数学上被判据 A 蕴含**，不提供独立判别力；
   判据 D（active 切换）在克隆实现下同样成立，也不提供判别力。
   两者都不算错（前者是"可复算表述"，后者守的是另一条需求），但读者容易误当五重保险。
   建议在注释里标明"A 通过 ⇒ B 必通过；D 与决策③正交"。

4. **B 的 `expect(created, …).toBeTruthy()`（`:117`）是存在性断言**，
   本身无判别力（紧跟着的 A/C/D/E 都读具体值，所以整体强度不受影响）。
   但它会掩盖"`created` 是错的那个 ROI"这类定位错误 —— 后面每条都重新 `find` 一次，风险很低。

5. **新建空 ROI 不会把它带进视野。**
   实测默认 fit 下 `(0,0)` 在画布内 `(340,190)`，可见；但若用户先放大/平移到图像别处再点新建，
   `(0,0)` 可能落在视口外，抓手不可见也没有任何提示。建议新建后 `panIntoView` 或临时 fit。

6. **`journey.spec.ts` 的框选目标写死世界坐标 `(1900, 1300)`。**
   该点必须落在图内、且画出的矩形要足够大以支撑后续分列；换示例图或改默认缩放后可能静默失效
   （框选仍"成功"但后续分列失败，失败信息会伪装成别的问题）。建议按图像尺寸的比例取点。

7. **`hitTest.ts` 的退化分支返回 `'br'`，而提示文案说"按住该区域左上角的手柄"。**
   行为上两者是同一个点（零面积时 8 个手柄重合），用户不会察觉；但代码与文案的措辞不一致，
   后来者容易以为左上角手柄被改坏了。建议注释或文案统一成"重合点/右下方向打开"。

---

## 6 附：本轮产物

| 文件 | 内容 |
| --- | --- |
| `.scratch/verify/r4-T-02-green.log` | A 修复态 `2 passed (23.2s)` |
| `.scratch/verify/r4-T-02-canary-red.log` | A 金丝雀 `1 failed/1 passed`，红在 `spec:131` |
| `.scratch/verify/r4-T-02B-green.log` | B 修复态 `1 passed (18.0s)` |
| `.scratch/verify/r4-T-02B-canary-red.log` | B 金丝雀红在 `spec:124`（`Received 1304800`） |
| `.scratch/verify/r4-restore-green.log` | 还原后 `3 passed (29.5s)` + typecheck 0 |
| `.scratch/verify/r4-adjacent.log` | 相邻 `18 passed (2.5m)`（含 journey 20.2s）+ typecheck 0 |
| `.scratch/verify/probe-ycalib-partial.log` | 文案点名实测（只缺 Y2 数值 / `-` / change 静默 / 下一步静默） |
| `.scratch/verify/probe-empty-roi-pan.log` | (0,0) 抓手屏幕坐标、canvas 盒子、平移往返 delta |
| `.scratch/verify/probe-handle-isolation{,2,3}.log` | 拖拽探针的三次迭代（含控制组失效证据） |
| `.scratch/r4-journey.diff` / `r4-prod.diff` | journey 与产品代码的完整 diff |
| `.scratch/verify/run3.ps1` / `run-adj3.ps1` / `run-probe1b.ps1` / `run-probe1c.ps1` / `run-probe1d.ps1` | 触发脚本 |
