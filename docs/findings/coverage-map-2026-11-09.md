# 行为覆盖图：自动测试 ↔ 真实用户操作（2026-11-09）

> 只读审计。未修改任何代码、未运行 e2e、未做 git 操作。
> 全部结论绑定 `file:line`；读不到的写「未核实」。
>
> **不变量编号口径**：任务书提到的「用户给的 15 条不变量」未随本次任务下发，本文件
> 一律引用仓库内的权威编号 `docs/ARCHITECTURE.md:438-475`（§9 不变量速查，当前
> 共编号 1–20，其中 1–15 覆盖任务书所指的同一批语义）。若 Lead 手上是另一套 15 条
> 编号，请指出映射关系，本文件的诊断不依赖编号本身。

---

## 0 先修正三处口径偏差（影响后面所有数字）

| 说法 | 实测 | 证据 |
| --- | --- | --- |
| 「45 个 spec」 | **43 个 `.spec.ts`**；`frontend/e2e/` 下共 45 个 `.ts` = 43 spec + `helpers.ts` + `fixtures.ts` | `ls frontend/e2e/*.spec.ts` → 43 |
| 「16 spec / 53 用例 / 308 断言 / 86 处真实后端读取」 | 已过期。现为 **43 spec / 130 处 `test(` 声明（运行时 132 条）/ 872 处 `expect(` + 107 处 `.poll(` / 178 处 rpc 读取** | `docs/testing-strategy.md:16` vs §4 复算命令 |
| 「只应有 error-surfacing.spec.ts 一次后端都不读」 | 已过期。现为 **8 个 spec 零后端读取** | `docs/testing-strategy.md:123-127` vs §4 |

过期本身不是缺陷，但它是**门禁自我认知漂移**的证据：`testing-strategy.md:117-127`
把「只增不减」写成了纪律，而数字已经在无人更新中涨了一倍。

---

## 1 状态机与状态转换覆盖表

状态定义按任务书；与 UI 步骤号的映射（权威步骤号见 `docs/ARCHITECTURE.md:129-132`）：

```
EMPTY(步骤1前) → IMAGE_LOADED(步骤1) → ROI_READY(2) → Y_CALIBRATED(3)
→ CLEANED(4) → COLUMNS_DETECTED(5) → X_CALIBRATED(6) → SAMPLES_READY(7) → EXPORT_READY(8)
```

断言级别四档：**DOM** / **镜像**（`getState()` 前端镜像）/ **RPC**（`getDiagramData`
等后端权威）/ **导出物**（tar / CSV 字节）。

| # | 转换 | 覆盖 | 覆盖它的 spec:line | 断言级别 | 是否经过重建路径 |
| --- | --- | --- | --- | --- | --- |
| T0 | ∅ → EMPTY（首次启动零状态） | ✅ | `from-zero-journey.spec.ts:229-276` | RPC（`imageSrc=null`/`rois=[]`/`columns=[]`）+ DOM（面板文案） | 不适用；`e2e.reset` 每次回到零态，`support/serve_zero_backend.py:64-91` 复位后 fail-fast 自检 |
| T1 | EMPTY → IMAGE_LOADED | ✅ **仅 zero lane** | `from-zero-journey.spec.ts:286-333`（真实 `#btn-open-file` → `filechooser` → `chooser.setFiles`；`:296` 有 `setInputFiles` 兜底） | RPC（`imageWidth/Height`、`rois.length===1`、`rois[0].composition===true`）+ 反断言「不得自动分列」`:333` | 否 |
| T1b | IMAGE_LOADED → IMAGE_LOADED²（换图） | ⚠️ 部分 | `step1-load.spec.ts:43`（范例下拉每一项）、`:74`（拖拽真实 PNG） | RPC（尺寸真值） | 否；**基线已预载 hoya**（`support/serve_e2e_backend.py:46-47`），所以基线 lane 里「首次载图」从不发生 |
| T2 | IMAGE_LOADED → ROI_READY | ✅ | `from-zero-journey.spec.ts:357-438`（真实鼠标拖手柄，`RoiToolStrategy` 驱动） | RPC（`xlim/ylim` 因果层 + 目标层 ±8px，`:387-412`） | 否 |
| T3 | ROI_READY → Y_CALIBRATED | ✅ | `step3-ycalib.spec.ts:181-235`（逐字段 `toMatchObject`）、`from-zero-journey.spec.ts:452-482`、`journey.spec.ts:146-159` | RPC + **镜像对账**（`step3-ycalib.spec.ts:24-25` 明说要钉「前端宣称权威值」） | 否；反检测的是「同像素二次提交被拒」（`:325-365`）与覆盖语义（`:236-287`） |
| T3r | Y_CALIBRATED → ROI_READY（回步骤 2 改 ROI 再回 3） | ❌ | 无 | — | **这条重建路径在 e2e 里完全不存在**（见 §2-3） |
| T4 | Y_CALIBRATED → CLEANED | ✅ | `step4-cleanup.spec.ts:168`（确认/撤回）、`:243`（删除真删）、`:264`（手画几何 axis）、`:327`（厚度中心）、`:421-480`（清空本步）、`workflow-panels.spec.ts:65/127`、`from-zero-journey.spec.ts:503-533` | RPC（`geometry_removed_pixels` 因果、`manual_erase_pixels`、`line_strokes`、`exclusion_regions`） | 部分：`:421` 是「清空」，不是「返回再进入」 |
| T4r | CLEANED →（返回步骤 3）→ CLEANED | ❌ | 无 | — | 无（阶段往返后几何/笔迹是否还在，没有用例） |
| T5 | CLEANED → COLUMNS_DETECTED | ✅ | `from-zero-journey.spec.ts:541-558`、`journey.spec.ts:166-168`、`step5-naming.spec.ts:121` | RPC（`columns.length>0`、`roi_id` 归属、`col_index` 是数字） | 否（首次分列） |
| T5r | COLUMNS_DETECTED → COLUMNS_DETECTED（**重新**检测分列） | ⚠️ 单 ROI 覆盖，多 ROI 未覆盖 | `step5-naming.spec.ts:146-154`（真实 `core.detectColumns`，名字必须存活）、`x-ticks-dropped.spec.ts:422`（越界重分列后 `x_ticks_dropped`）、`regressions-b04-b05-b07.spec.ts:178-233`（重分列不得回滚 ROI） | RPC（`name` 逐列、`scale_provenance`） | 是 —— 本仓库唯一被反复使用的重建路径。但**多 ROI 下标重排**只有后端 pytest 覆盖，且 `docs/testing-strategy.md:320` 明说结构性未修 |
| T6 | COLUMNS_DETECTED → X_CALIBRATED | ✅ | `from-zero-journey.spec.ts:591-664`（先证「自动检测不得写读数」`:602-605`，再由人填 0/40）、`step6-picktick.spec.ts:419`、`step6-group-slope.spec.ts:35` | RPC（`x_ticks` 两点、`scale_provenance.source=group_slope`） | 是（`step6-group-slope.spec.ts:63` 用 `page.reload()` 证伪「只活在内存里」） |
| T6L | X_CALIBRATED → COLUMNS_DETECTED（重分列后标定存亡） | ⚠️ **断言的是已知缺陷** | `from-zero-journey.spec.ts:844-906` 用 `test.fail(...)` 把「刻度越出守卫区间后 `x_ticks` 被静默清空」钉成**预期红** | RPC | 是 |
| T6r | X_CALIBRATED → ROI_READY → X_CALIBRATED（切 ROI 再切回） | ❌ | 无 | — | 无 |
| T7 | X_CALIBRATED → SAMPLES_READY | ✅ | `from-zero-journey.spec.ts:671-697`（`samples.list`，深度必须有限且 ≤1300）、`workflow-panels.spec.ts:287`、`step7-8-audit.spec.ts:25`、`step7-paste-depths.spec.ts:31` | RPC（注意 `data.samples` 是 client-owned，必须走 `samples.list`，见 `docs/testing-strategy.md:315`） | 部分（`:287` 提取→清空往返） |
| T8 | SAMPLES_READY → EXPORT_READY | ✅ 强 | `from-zero-journey.spec.ts:718-798`（`qa.summarize` + `export.getReadiness` + `export.tar` 解包，`data.csv` 逐字节 == 主 ROI 分表 `:765`，且非零读数 `:770-773`）、`export.spec.ts:177-249`、`journey.spec.ts:184-199` | **导出物**（tar 字节、CSV 行/首列/最大值） | 是（换主 ROI 再导一次 `export.spec.ts:240-249`） |
| T9 | 任意 → EMPTY（`project.new` / 重置） | ⚠️ 后端层有，e2e 弱 | `regressions-b04-b05-b07.spec.ts:105`（重置后不得产生 -32001、后端 ROI/列归零）、`console.spec.ts:47`、`contract.spec.ts:264` | RPC | 否 |
| T10 | EXPORT_READY → 保存项目 → 重开旧项目 → EXPORT_READY | ❌ **e2e 零覆盖** | 无 e2e；仅后端 `tests/unit/test_project_save_golden.py`、`test_project_load_golden.py`、`test_project_load_version_gate.py`、`test_project_load_image_replacement.py` | （后端 golden） | 无 |

**这张表最重要的一行是 T3r / T4r / T6r / T10。** 前三条是「阶段往返」这条重建路径
（`docs/testing-strategy.md:230-235` 亲自把它列为四条必备重建路径之一），在 e2e 里
一条都没有；T10 是用户最常做的「存档-接着干」，e2e 一条都没有。

---

## 2 操作维度覆盖表（按用户任务）

图例：✅ 已覆盖 / ⚠️ 部分覆盖 / ❌ 未覆盖。

### 2-1 空项目首次启动 → 真实文件选择器载图

**⚠️ 部分覆盖 —— 只在 zero lane，且基线 lane 永远走不到。**

- 最接近的用例：`from-zero-journey.spec.ts:286-297`。它点 `#btn-open-file`，等
  `page.waitForEvent('filechooser')`，再 `chooser.setFiles(REAL_POLLEN_IMAGE)`。**确实
  走的是真实文件选择器**，不是直调 RPC。
- 断言了什么：`:312-324` 同时等「尺寸 2339×1654 **且** rois=1」（并且 `:299-311` 记录了
  「等 imageWidth 会拿到半完成状态」的实测教训）；`:327-333` 断言 `imageSrc` 真、
  自动建 pollen ROI、`columns` 必须为空。
- 漏了什么：
  1. **兜底分支是被静默吞掉的**。`:292-297` 的 `catch` 会把 filechooser 失败降级成
     `setInputFiles`，只把降级写进 trace 的 `humanAction` 字符串。门禁不会因此变红 ——
     也就是说「系统文件选择器根本没弹出来」这个真实缺陷可以让用例全绿，只在 trace
     JSON 里留一句话。
  2. 该 spec 被基线配置**显式排除**（`frontend/playwright.config.ts:43`
     `testIgnore: /from-zero-journey\.spec\.ts/`），只由另一条 lane 跑
     （`frontend/playwright.zero.config.ts:39`）。主门禁 `pixi run test-e2e` **不覆盖它**。
  3. 基线 lane（43 spec 里的 42 个）全部建立在「hoya 已预载 + 已预分列」之上
     （`support/serve_e2e_backend.py:44-48`）。`step1-load.spec.ts:43/74` 虽然也走 UI 载图，
     但那是**在已有图上换图**，不是首次启动。

### 2-2 创建两个 ROI / 改名 / 切主 ROI / 删除当前主 ROI

**✅ 已覆盖，且四条都有后端权威断言。**

- 创建两个 + 两次改名 + 切主：`journey.spec.ts:96-126`。断言 `rois[].name` 排序后等于
  两个新名（`:113-116`），断言 `.btn-set-primary` 属于谁（`:121-125` 还顺手纠正了旧注释
  的语义错误）。
- 删除同时是「活动区 + 主区」的 ROI：`step2-roi.spec.ts:59-113`。这是最有判别力的一条：
  `:98-104` 等 `rois` 变短，`:107-111` **另外**断言 `primaryRoiId`/`activeRoiId` 必须重指派 ——
  只断言「变短」抓不到悬挂指针。
- 切活动 ROI 后面板必须跟随：`:157-179` 逐轮回切三次，同时断言复选框与名字框等于
  **该 ROI 的后端真值**；`:181-201` 再加一次 `page.reload()` 冷启动对照。
- 漏了什么：
  1. 改名走的是 `fill()`（`journey.spec.ts:98/107`、`step2-roi.spec.ts:132/227`），而
     `step5-naming.spec.ts` 已经证明「`fill()` 会掩盖聚焦被重渲染吃掉」
     （`from-zero-journey.spec.ts:1022-1025` 记录了实测）。列名那边改用了真实键盘
     （`from-zero-journey.spec.ts:1038-1052`），**ROI 名这边没有跟进**。
  2. 「删除主 ROI」只测了「删掉那个同时是活动+主区的」，没测「删掉一个**非活动**的主区之后，
     用户当前正在编辑的 ROI 是否会话被换掉」。

### 2-3 Y 标定后返回步骤 2 改 ROI 再回步骤 3

**❌ 未覆盖。**

- 最接近的用例：`regressions-b04-b05-b07.spec.ts:178-233`（改 ROI → 重分列），它证的是
  「后端 ROI 不得被分列回滚」，**不是「Y 标定是否在 ROI 变更后仍然有效」**。
- 另一条近似：`step3-ycalib.spec.ts:236-287`（第二次标定覆盖第一次），但它在**同一步内**
  重复提交，没有离开过步骤 3。
- 漏了什么：`docs/ARCHITECTURE.md:442-443`（不变量 3「ROI ≠ 标尺」）与 `:477-482`
  （`from-zero-journey.spec.ts:478-482` 断言的是「标定不得改 ROI」，即**反方向**）。
  「先标定、后改 ROI，标定是否仍然成立」这个方向**没有任何断言**，而它正是用户最容易
  撞上的顺序（先随手标一下，发现取数区没框对，回去重框）。

### 2-4 分列+列命名后重新检测分列（名称/标定是否保留；多 ROI 下标重排）

**⚠️ 单 ROI 名称保留 ✅；标定保留 ❌（已钉成预期红）；多 ROI 重排 ❌。**

- 名称保留：`step5-naming.spec.ts:121-156`。它先改名并等后端字段变（`:130-136`），
  再**真的发一次** `core.detectColumns`（`:146-150`），然后断言名字仍是用户改的那个
  （`:152-154`，并带「必须真的变过」的反空转断言）。`docs/testing-strategy.md:222-235`
  说这是本仓库第一个把「持久化声明要穿过系统自身重建路径」讲清楚的用例，属实。
- 标定保留：`from-zero-journey.spec.ts:844-906` 用 `test.fail()` 声明**这是已知缺陷**
  （`docs/findings/bug-report.md` B-02）。`x-ticks-dropped.spec.ts:183-255` 覆盖的是
  「被丢弃后界面必须显式告知」—— 这是**症状层**的正确处理，不是「不该丢」。
- 多 ROI 下标重排：**e2e 零覆盖**。后端只有
  `tests/integration/test_multi_roi.py` 级别的
  `test_multi_roi_column_names_follow_global_col_index`，而
  `docs/testing-strategy.md:320` 亲自写明「未修的半边（结构性）：`col_index` 由
  `merged_cols = other_cols + detected_cols` 现场重排，换个 ROI 重新分列会让**所有**列的
  下标平移；扁平列表无论如何都对不上」。也就是说：**已知必然失效的路径，e2e 一条都没测**。

### 2-5 X 标定后切 ROI 再切回

**❌ 未覆盖。**

- 最接近的用例：`step2-roi.spec.ts:157-179` 的 ROI 来回切 —— 但它只断言 `composition`
  与 `name` 两个字段，**不涉及任何标定/几何/列状态**。
- `export.spec.ts:183-188/240` 切过 `roi.setPrimary`，而且是**走 RPC 不走 UI 按钮**；
  它断言的是 `data.csv` 跟随主 ROI（导出物级，很强），但不涉及「切回之后画布上标定
  是否还在」。
- 漏了什么：这条路径同时暴露不变量 14（`docs/ARCHITECTURE.md:459-461` 标度唯一真相源）
  与不变量 11（`:452` ROI 之外的数据一律不存在）的交互。切 ROI 后 `x_ticks` /
  `line_candidates` / `samples` 是否跟随，**没有任何断言**。

### 2-6 画清理笔迹 → 清空 → 撤销 → 返回再进入

**⚠️ 前三段 ✅，撤销 ❌，返回再进入 ❌。**

- 画 → 清空：`workflow-panels.spec.ts:127-232` 是全场最强的一条笔刷用例。它 `:151`
  先清空建立「从零」起点、`:175-191` 断言笔迹落库 + `manual_erase_pixels>0`、`:194-206`
  清空后 `[line_strokes, manual]` 必须 `[0,0]`、`:209-228` 补回笔走另一半通道且
  **不得**增长 `manual_erase`。`step4-cleanup.spec.ts:421-480` 覆盖「清空本步全部」
  三项齐零 + 面板计数归零。
- 撤销：**零覆盖**。`grep -rn "Control\+z|undo|撤销" frontend/e2e/` 只有两处命中，都不是
  驱动撤销：`regressions-b04-b05-b07.spec.ts:77`（注释解释 `beforeunload` 守卫）与
  `ui-layout.spec.ts:75`（只断言「顶栏应含撤销/重做控件」，数控件个数 ≥6）。
  而 `docs/testing-strategy.md:319` 明确记录了「Ctrl+Z 撤销不了清理编辑」的完整缺陷史，
  现行结论是「清理编辑不再 push 历史，回收出口是本步显式按钮」。**这个产品决策本身
  从未被任何断言固定住** —— 一旦有人重新接上 undo-push，没有任何一层会红。
- 返回再进入：**零覆盖**。没有任何用例在做完清理后 `gotoStage(3)`/`gotoStage(5)` 再回到 4。

### 2-7 快速双击「下一步」/ 连续点击两个动作 / 同一按钮连击

**❌ 未覆盖。**

- `grep -rn "dblclick|clickCount" frontend/e2e/` → **0 命中**。
- 所有推进都经过 `advanceByRealUi`（`from-zero-journey.spec.ts:167-172`）：先
  `toBeEnabled`、再单次 `click()`、再轮询 stage。这套写法**结构上排除了连击**：
  它在每一步之间插了等待。
- 漏了什么：`journey.spec.ts:93` 与 `from-zero-journey.spec.ts:357` 都是「点一次按钮」
  的理想路径。真实用户会连点。而本应用有两处已知的「重挂窗口」（`docs/testing-strategy.md:237-247`
  §8.3：`applyCleanupState → Inspector.updateData → render() → mount()` 整块替换 DOM），
  连点正好把点击打进这个窗口。这条盲区与 §2-8 是同一个根因。

### 2-8 输入框逐字符输入时触发界面刷新（焦点、选区、IME、未提交文本）

**⚠️ 部分 —— 而且两条主线都**主动绕开**了这个路径。**

- 已覆盖的一处：`inspector-focus.spec.ts:43-`（属种名输入框：重渲染后焦点、值、光标都还在），
  它用 `data-epoch` 标记证明确实发生了重渲染（否则判据会假绿），做法正确。
- 被主动绕开的两处：
  1. Y 标定五个框：`step3-ycalib.spec.ts:97-115` 与 `from-zero-journey.spec.ts:926-945`
     都是 `page.evaluate` 直接写 `el.value` + **不派发任何事件**，最后点一次应用。
     `:69-95` 的注释说明理由：逐框 `fill` 会因 `change` → 自动提交 + 面板重挂而丢值，
     且「那条路径目前**就会偶发丢值**……把它钉成断言只会得到一条稳定的红灯」。
     **结论：`YCalibPanel` 的「改一个框就自动落库」这条真实交互路径，是已知会丢数据的，
     而测试策略是绕开它。** 这是本仓库最严重的一处「测试写了但故意不测」。
  2. 列名行内改名：`from-zero-journey.spec.ts:1038-1052` 用 `fill('')` + 断言真为空 +
     逐字 `keyboard.type` + 断言值完整 + `Enter`。这条**做得对**（还记录了
     `Control+a` 会落在被替换节点上的实测）。
- 漏了什么：IME 组合输入（`docs/testing-strategy.md:321` 明说「IME 组合输入中被重建仍丢
  组合串」）；ROI 名输入框（`#inp-roi-name`）用的是裸 `fill()`，而
  `docs/testing-strategy.md:321` 记录过「对全部输入恢复 focus 会让 `#inp-roi-name` 的聚焦
  再次触发 `onRenameActiveRoi`，把 step2-roi 整条打成 60s 超时」—— 说明这个框的
  聚焦有副作用，但**没有任何用例钉住这个副作用是否存在**。

### 2-9 保存项目 → 继续修改 → 重开旧项目（状态与导出内容）

**❌ 未覆盖（e2e 零；后端 golden 有）。**

- 顶栏确有这些控件：`ui-layout.spec.ts:75` 的断言文案是「打开图谱/保存项目/打开项目/
  示例/重置/撤销/重做 等控件」，且要求 `leftContentCount >= 6`。**所以功能存在、
  按钮存在、但从未被点过。**
- `grep -rn "project\.save|project\.load|saveProject|loadProject" frontend/e2e/` → **0 命中**
  （`project.load` 唯一出现处是 `regressions-b04-b05-b07.spec.ts:357` 的**豁免白名单**，
  即「我们知道它会失败」的拒绝路径）。
- 唯一近似的重建路径是**自动存档草稿**：`regressions-b04-b05-b07.spec.ts:246-350`
  （浏览器 `localStorage` 草稿 → 恢复 → 后端列数/几何/`x_ticks`/列名逐项对账），以及
  `:361-420`（草稿尺寸不符必须拒绝、后端列状态不得被污染）。这条做得很好，但它是
  **自动存档**，不是用户主动「保存项目 → 关掉 → 明天打开」。
- 后端层有 4 份 golden：`tests/unit/test_project_save_golden.py`、
  `test_project_load_golden.py`、`test_project_load_version_gate.py`、
  `test_project_load_image_replacement.py`。它们守的是**序列化格式与版本门**，
  守不到「保存 → 继续改 → 重开」这条**时序**，也守不到导出内容在重开之后是否仍然一致。

### 2-10 换图 / 新建项目后的上一张图残留（ROI、列、清理几何、标定、样品）

**⚠️ 后端层有，e2e 端到端无。**

- 后端有专项：`tests/unit/test_cross_image_state_leak.py`、
  `tests/unit/test_cleanup_pipeline.py`、`tests/unit/test_cross_image_cleanup.py`，
  以及两处启动器的 fail-fast 自检（`support/serve_e2e_backend.py:71-84` 与
  `support/serve_zero_backend.py:77-91` 都在复位后**断言**残留为零并抛错）。
- 两个启动器的 docstring 都点名了同一个已知缺口：
  「`project_new` 会重置各种 mask，但**不重置** `line_candidates` / `exclusion_regions` /
  `line_strokes`」（`support/serve_e2e_backend.py:53-59`、`support/serve_zero_backend.py:35-39`）。
  **测试基础设施是通过「额外补一次 `_init_cleanup()`」绕过这个产品缺口，而不是把缺口
  钉成判据。** 用户点「新建项目 / 重置」时走的是产品那条路（没有那次额外调用）。
- e2e 侧最接近的是 `regressions-b04-b05-b07.spec.ts:105`（重置后不得产生 -32001、
  ROI/列归零）与 `console.spec.ts:43`（零状态下重新加载零 error）。两条都只覆盖
  「ROI + 列」，**不覆盖清理几何、标定、样品**。
- `docs/findings/fix-cross-image-cleanup.md` 存在，说明这个问题历史上被处理过；
  但**处理完之后没有留下一条 e2e 判据**。

### 2-11 模态框未关闭时切换步骤

**❌ 未覆盖。**

- `grep -rn "Escape" frontend/e2e/` → **0 命中**（连"用 Esc 关模态"都没测）。
- 所有模态框用例都是「打开 → 断言 → 用专属关闭按钮关掉」，例如
  `modal-primitive.spec.ts:287`（`#export-modal-close`）、`:242`（`#modal-close`）、
  `export.spec.ts:188`（打开 `.wpd-export-dialog` 后从头到尾不关）。
- 没有任何用例在模态框开着的时候点工作流步骤按钮（`#btn-wf-next` / `.workflow-step-btn`）。
- 漏了什么：模态框是否**阻断**了底层画布/快捷键（`docs/ARCHITECTURE.md:141-146` 的
  工具模式与键盘守卫），以及模态框开着时切步骤会不会留下一个「孤儿模态」。
  `ui-layout.spec.ts:83-86` 断言了工作流条在第二行、步骤按钮全部可见 —— 也就是说
  它们在模态框开着时**仍然可点**，但没人验证点下去会发生什么。

### 2-12 不同缩放倍率下操作

**⚠️ 仅一处，且只断言「视口没被重置」。**

- `issue8-fit-to-screen.spec.ts:174-190`（C4）：`page.keyboard.press('=')` 手动放大，
  然后 resize 容器，断言视口**不得**被打回 fit。这是唯一触碰「非 fit 缩放」的用例。
- 所有其它操作类用例都在 `resetBaseline` 里被强制 `F` 归零到 fit
  （`helpers.ts:234-240`）。`from-zero-journey.spec.ts:976` 也在拖 ROI 前先按 `F`。
- 漏了什么：在 200%/300% 缩放下 —— 画布点击命中半径（`from-zero-journey.spec.ts:972`
  指出 `ROI_HANDLE_SIZE_SCREEN + 2`）、清理笔刷的 `radius` 换算、点齿命中、缩放后的
  `canvasColorPixels` 探针阈值 —— **全部只在 fit 缩放下验证过**。不变量 12
  （`docs/ARCHITECTURE.md:453-457` 叠加层必须在世界坐标下绘制，屏幕恒定尺寸要用
  `1/vp.scale` 反算）的失效形态**恰好在缩放 ≠ 1 时才显形**，而测试永远把缩放压成 fit。

---

## 3 环境矩阵覆盖表

| 环境维度 | 触达 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1680×1050（默认） | ✅ 全部 | `frontend/playwright.config.ts:63/80`、`playwright.zero.config.ts:78/92` | 所有 43 spec 的默认视口 |
| 1366×768 | ⚠️ 仅几何 | `ui-layout.spec.ts:18`（`SIZES`）+ `:25`（`setViewportSize`）+ `:66-107`（只断顶栏几何/步骤按钮可见） | **只测布局不测操作**：该尺寸下没有一个功能用例 |
| 1920×1080 | ⚠️ 仅几何 | `ui-layout.spec.ts:19` | 同上 |
| 1280×720（设计下限） | ⚠️ 仅几何 | `ui-layout.spec.ts:20` | 同上 |
| Windows 125% 缩放 | ❌ | `grep -rn "deviceScaleFactor" frontend/e2e/` → 0 命中；`devices['Desktop Edge']` 展开后未覆盖 DPR | 未触达。所有坐标断言都假定 CSS px == 设备 px |
| Windows 150% 缩放 | ❌ | 同上 | 未触达 |
| 中文路径 | ❌ | 唯一真实载图路径 `from-zero-journey.spec.ts:54`：`join(REPO_ROOT, 'straditize_core/assets/tutorials/hoya-del-castillo.png')` —— 全 ASCII | 未触达 |
| 带空格路径 | ❌ | 同上（路径中无空格） | 未触达 |
| 中文文件名 | ❌ | 同上；`smoke.spec.ts:88` 只校验内置样本 sha256 | 未触达 |
| 无网络 | ❌ | `grep -rn "setOffline" frontend/e2e/` → 0 命中。最接近的是**单点故障注入**：`error-surfacing.spec.ts:73/133/179` 用 `page.route` 让某一个 RPC 失败 | 整机断网 / 首次启动离线（OCR 模型、`component.*` 安装包）未触达 |
| 安装包 / Portable 交付物 | ❌ | `frontend/playwright.config.ts:87`：`command: 'pixi run python support/serve_e2e_backend.py'`；`playwright.zero.config.ts:99` 同理 | **跑的是源码 dev server**，不是 `pixi run build-windows` 的产物。PyInstaller 打包路径（`find_frontend_dist()`、资源拷贝、相对路径）零覆盖 |
| 深色主题 | ✅ | `contrast.spec.ts:184`、`modal-primitive.spec.ts:111`、`settings.spec.ts:65`、`legend-and-axis-stroke.spec.ts:195/209` | 覆盖良好 |
| 英文 / i18n | ✅ | `settings.spec.ts:65`（切英文后浏览器与后端两侧生效） | 覆盖 |
| 并发（两会话共用后端） | ✅ 设计层 | `helpers.ts:210-222` 注释、`playwright.config.ts:26-32`（`workers:1` + `reuseExistingServer:false`） | 已用端口隔离防住，非环境矩阵项 |

**这一整张表最刺眼的是最后两行**：交付物（安装包/Portable）和 Windows 缩放。前者是
「用户到底拿到什么」的问题，后者是「用户屏幕上坐标对不对」的问题。两者零覆盖，
而应用是 canvas 重交互 + 桌面分发。

---

## 4 机械统计（可复算命令 + 实测数字，2026-11-09）

| 指标 | 命令 | 实测 |
| --- | --- | --- |
| spec 数 | `ls frontend/e2e/*.spec.ts \| wc -l` | **43** |
| e2e 目录文件数 | `ls frontend/e2e/*.ts \| wc -l` | **45**（43 spec + `helpers.ts` + `fixtures.ts`） |
| `test(` 声明数 | `grep -c "^\s*test(" frontend/e2e/*.spec.ts \| awk -F: '{s+=$2} END{print s}'` | **130** |
| 运行时用例数 | 130 + `ui-layout.spec.ts:24` 的 `for…of SIZES` 展开（1 声明 → 3 条） | **132** |
| 条件性跳过 | `test.fail(!process.env.STRADITIZE_EXPECT_XTICKS_FIXED, …)` `from-zero-journey.spec.ts:844-847`；`test.skip(...)` `x-ticks-dropped.spec.ts:468` | 1 条预期失败（B-02） + 1 条条件跳过 |
| `expect(` 断言点 | `grep -ho "expect(" frontend/e2e/*.spec.ts \| wc -l` | **872** |
| `.poll(` 轮询断言点 | `grep -cE "^\s*\.poll\(|expect\.poll\(" frontend/e2e/*.spec.ts` | **107**（26 个文件里） |
| 断言点合计 | 872 + 107 | **979** |
| 真实后端读取 | `grep -rhoE '\b(rpc\|backendRpc\|diagramData)\s*[<(]' frontend/e2e/*.spec.ts \| wc -l` | **178** |
| `getState()` 用量（前端镜像） | `grep -rho "getState()" frontend/e2e/*.spec.ts \| wc -l` | **35**，分布于 18 个 spec |
| 一次后端都不读的 spec | 43 − 35（含 rpc 的 spec 数） | **8 个**（见下） |
| 固定 sleep | `grep -rn "waitForTimeout" frontend/e2e/` | **25 处**，跨 15 个文件（含 `helpers.ts:239` 的 120ms） |
| 模态框相关用例 | 4 个 modal 主题 spec 共 18 条（`modal-primitive` 7 / `agedepth-modal` 6 / `metadata-modal` 3 / `ocr-modal` 2）+ `step5-naming.spec.ts:212`（开 OCR 模态）+ `export.spec.ts:177`（开导出对话框） | **20 条**；另有 `error-surfacing.spec.ts` 4 条以 `#rpc-error-modal` 为断言对象 |
| node 层断言点 | `frontend/test-*.mjs`（13 个文件）内的 test/assert 调用 | **85** |
| 后端 pytest 文件 | `tests/**/*.py`（去掉 `conftest.py` / `_dispatcher_race_probe.py` / `verify_straditize_pro_e2e.py`） | **93** 个 `test_*.py` |

**8 个零后端读取的 spec**（须区分「合理」与「危险」）：

| spec | 它读什么 | 定性 |
| --- | --- | --- |
| `error-surfacing.spec.ts` | `telemetry.notices` + DOM 文案 | **合理**：它测的就是「用户看得见什么」 |
| `contrast.spec.ts` | `getComputedStyle` + 自建对比度公式 | **合理**：纯视觉量 |
| `modal-primitive.spec.ts` | computed style / 元素 id | **合理**：原语契约 |
| `ui-layout.spec.ts` | `getBoundingClientRect` | **合理**：几何 |
| `export-ensemble-empty.spec.ts` | DOM 禁用态 + 理由文案 | **合理**：但「勾选框禁用」这条最好也读一次 `export.getReadiness` 对账 |
| `issue9-tool-description.spec.ts` | 页脚文本 / `data-fmode` | **偏危险**：它断言「页脚与调色板一致」，但两者都是前端自述；`helpers.ts:453-460` 已把「两处必须一致」抽象成 `activeTool()`，仍然没有后端锚点 |
| `issue8-fit-to-screen.spec.ts` | `getState().viewport`（镜像） | **危险**：视口是纯前端量，可接受；但它用 `:181` `press('=')` 造缩放后**没有断言任何一次真实操作** |
| `inspector-focus.spec.ts` | DOM 焦点/值/选区 | **偏危险**：焦点类断言只能读 DOM；但它**没有**同时断言「重渲染后写回后端的那一份值也正确」（`docs/testing-strategy.md:245-247` 自己警告过 `settle()` 只证明行数对上） |

**另一项需要点名的统计：`getState()`（前端镜像）在 3 处被当作业务断言的全量来源**
（而不是"界面到了这一步"的屏障）：
`journey.spec.ts:141-144`（`yCalibMarks.length`）、`step6-picktick.spec.ts`（4 处）、
`step7-tool-modes.spec.ts`（3 处）。`from-zero-journey.spec.ts:148-150` 的注释把正确
用法写得很清楚（「只当屏障，不做业务断言」），这三处没有遵守。

---

## 5 盲区排名（Top 10）

排序依据：**用户撞上的概率 × 失效的隐蔽性 × 现有门禁是否真的会红**。

### 1. 保存项目 → 重开旧项目（T10）在 UI 层完全不存在

- **为什么危险**：这是「跨天工作」的唯一路径。用户的所有劳动成果都靠它。
- **失效的不变量**：不变量 1（`ARCHITECTURE.md:440`，数据只能来自真实计算）——
  重开时若某个字段回落到默认值（如未标定列被写成 legacy 占位），导出会**静默出数**。
  `docs/testing-strategy.md:317` 已经记录过一次同型事故
  （`draftToProjectPayload` 把 legacy 占位写成标定端点，实测导出 `233,68.4211,67.5676`）。
- **最小补法**：一条 e2e —— 走完步骤 1–6，导出 tar 存字节；点「保存项目」拿下载物；
  `e2e.reset` 清空；点「打开项目」载入；**再导一次 tar，与第一次逐字节比对**。
  断言落在导出物上，不需要新增任何前端探针。
- **证据**：`ui-layout.spec.ts:75`（按钮存在）、`grep project.save frontend/e2e/` → 0、
  `tests/unit/test_project_save_golden.py`（仅后端）。

### 2. Ctrl+Z / 撤销重做零覆盖

- **为什么危险**：撤销栈的深度与内容由前端自创（上游原版完全没有撤销机制，
  `docs/testing-strategy.md:319`）；现行产品决策是「清理编辑不入栈」。这个决策
  只写在文档里，**没有任何断言**。一旦有人把 undo-push 加回去，用户会看到
  「撤销按钮可按、按了没效果」——`docs/testing-strategy.md:319` 描述的原缺陷形态。
- **失效的不变量**：不变量 1（前端宣称的状态与后端真值脱钩）。
- **最小补法**：一条 e2e —— 涂抹一笔（后端 `manual_erase_pixels>0`）→ 按 `Control+z`
  → 断言 `manual_erase_pixels` **仍 > 0**（即「撤销不覆盖清理编辑」这个现行语义被钉住）。
  这是**负向**判据，但它把产品决策变成了可执行契约。
- **证据**：`grep -rn "undo\|撤销" frontend/e2e/` → 只有 `ui-layout.spec.ts:75` 与
  `regressions-b04-b05-b07.spec.ts:77`。

### 3. 连击 / 双击「下一步」

- **为什么危险**：`docs/testing-strategy.md:237-247`（§8.3）已经证明存在「RPC 成功但界面
  正在整块重挂」的窗口，点击落进去会**静默无操作**。连击把点击概率性打进这个窗口。
  症状是「我点了一下没反应，又点了一下」→ 用户看到的可能是停住，也可能是跳两步。
- **失效的不变量**：不变量 6（`ARCHITECTURE.md:446`，阶段→工具表只有一份）与
  阶段推进的原子性（跨步会漏掉该步的业务动作，`from-zero-journey.spec.ts:164` 明确说
  `gotoStage()` 会跳过业务动作）。
- **最小补法**：一条 e2e —— 对 `#btn-apply-ycalib-next` 连点 3 次（`clickCount:3` 或
  三次不等 `click()`），断言最终 `stage===4` **且** 后端 `columns`/`calibration` 是
  一次动作的结果（不是零次或两次）。
- **证据**：`grep -rn "dblclick\|clickCount" frontend/e2e/` → 0 命中；
  所有推进都被 `from-zero-journey.spec.ts:167-172` 的「等一下再点」结构保护着。

### 4. Y 标定输入框「改一个框就自动落库」这条真实路径被已知丢数据而且不测

- **为什么危险**：`step3-ycalib.spec.ts:69-95` 自述实测载荷序列
  `[{611,7.5},{1198,42.5}] → [{700,7.5},…] → [{700,0},…]`，终态取决于哪一发最后落库，
  而往返只有 3–5 ms。**这是「测试写得再绿、用户仍会得到错标定」的教科书形态。**
  测试的应对是绕开（`el.value` 不派发事件），于是这条缺陷既没被修，也没被钉。
- **失效的不变量**：不变量 1（标定值必须来自用户输入的真实计算）与不变量 15
  （`ARCHITECTURE.md:462` 未标定列一律不给数——半提交的中间态会让某一列按错标定出数）。
- **最小补法**：一条 e2e —— 逐框 `fill()`（真实 `input`/`change`），最后点应用，
  断言后端 `calibration` 四个字段**同时**等于最后填的那一组；若当前实现必然红，
  用 `test.fail()` 显式登记成「已知缺陷」，与 `from-zero-journey.spec.ts:844` 同一手法。
- **证据**：`step3-ycalib.spec.ts:97-115`、`from-zero-journey.spec.ts:926-945`。

### 5. 多 ROI 下重新分列的列名/下标重排（已知结构性未修，零 e2e）

- **为什么危险**：`docs/testing-strategy.md:320` 亲口说「换个 ROI 重新分列会让**所有**列的
  下标平移；扁平列表无论如何都对不上，'名字跟着列走'在多 ROI 下无法保证」。
  后果是**导出串列**（张冠李戴的属种名配错的百分比）。
- **失效的不变量**：不变量 1、不变量 14（`ARCHITECTURE.md:459` 标度唯一真相源）。
- **最小补法**：一条 e2e —— 建 ROI_A/ROI_B，各分列，给 B 的某列改成可识别名，
  对 A 重新分列，断言 B 的那列名**不被 A 的列名污染**。若必红，`test.fail()` 登记。
- **证据**：`step5-naming.spec.ts:121-156` 只测单 ROI；
  `tests/integration/test_multi_roi.py` 只钉住「全局 col_index」这半边。

### 6. 阶段往返（标定后回步骤 2 改 ROI 再回来 / 切 ROI 再切回）

- **为什么危险**：`docs/testing-strategy.md:230-235` 把「阶段往返 / 换 ROI 再切回」列为
  四条必备重建路径中的两条，而 e2e 里**一条都没有**。这两条恰好是「两个存储不一致」
  类缺陷的唯一暴露口。
- **失效的不变量**：不变量 3（ROI ≠ 标尺）、不变量 11（ROI 之外的数据一律不存在）、
  不变量 14。
- **最小补法**：一条 e2e —— 标定 → 记下 `calibration` 与 `columns[].scale_provenance` →
  `gotoStage(2)` 把 ROI 缩窄 20px → `gotoStage(3)` →
  断言「标定要么被显式清掉并告知用户，要么保持不变」，**二者之一，不得静默变成 legacy**。
- **证据**：`regressions-b04-b05-b07.spec.ts:178-233` 证的是「分列不回滚 ROI」，
  不是「ROI 变更后标定如何」。

### 7. 换图 / 新建项目后的清理几何与标定残留

- **为什么危险**：**两个启动器都在替产品擦屁股**。
  `support/serve_e2e_backend.py:53-63` 与 `support/serve_zero_backend.py:35-39` 都自述
  「`project_new` **不重置** `line_candidates` / `exclusion_regions` / `line_strokes`，
  所以显式补一次 `_init_cleanup()`」。测试基建的复位干净了，用户点「重置」时没有那一步。
- **失效的不变量**：不变量 9（`ARCHITECTURE.md:449` 线掩膜只有一份、由后端产生）——
  上一张图的排除区留在掩膜里，新图的数字化结果被一张不存在的图污染。
- **最小补法**：一条 e2e —— 在步骤 4 造几何+笔迹+排除区 → 点顶栏「重置」→
  断言 `line_candidates`/`exclusion_regions`/`line_strokes` 三项归零。
  **注意：不得通过 `e2e.reset` 提供这一步**，必须点产品的按钮。
- **证据**：两个启动器的 docstring + `docs/findings/fix-cross-image-cleanup.md`（历史处理过，
  但没留 e2e 判据）。

### 8. 缩放 ≠ fit 时的所有画布操作

- **为什么危险**：不变量 12（`ARCHITECTURE.md:453-457`）说叠加层必须在世界坐标下绘制、
  屏幕恒定尺寸要用 `1/vp.scale` 反算，并点名 `CleanupOverlay` / `XTickOverlay` /
  `SampleOverlay` 三个层都犯过此错。这类错误的**失效形态恰好在缩放 ≠ 1 时才显形**，
  而 `helpers.ts:234-240` 的 `resetViewport` 把每个用例的缩放强制归到 fit。
- **失效的不变量**：不变量 12、不变量 7（`ARCHITECTURE.md:447` 叠加层固定高对比色）。
- **最小补法**：一条 e2e —— 进步骤 4，`press('=')` 放大到 ~250%，用
  `helpers.ts:400` 的 `canvasColorPixels` 数掩膜特征色像素，与 fit 下的计数做**不等式**
  （缩放后应显著增加，因为线更粗）；再缩小到 50%，应显著减少。
  不存基线、不比绝对值（沿用 `docs/testing-strategy.md:111` 的同轮不等式纪律）。
- **证据**：`issue8-fit-to-screen.spec.ts:174-190` 是唯一触碰非 fit 缩放的用例，且只断言
  「视口没被打回 fit」。

### 9. 交付物（安装包 / Portable）零覆盖

- **为什么危险**：`frontend/playwright.config.ts:87` 跑的是
  `pixi run python support/serve_e2e_backend.py`，即**源码 dev server**。
  `pixi run build-windows` 的 PyInstaller 产物里 `find_frontend_dist()`
  （`straditize_core/rpc_server.py:686`）、`straditize_core/assets/` 的内置样本、
  相对路径解析，**一条都没跑过**。
  `docs/testing-strategy.md:165` 记录过一次同型事故：范例下拉的「验证图谱」指向一个被
  `.gitignore` 排除的文件，「全新克隆必失败」—— 那是**源码**侧的缺失；打包侧的同类问题
  连发现机制都没有。
- **失效的不变量**：不变量 1（取不到就报错）——打包后资源缺失时用户拿到的是
  `-32004 内置范例图片缺失` 还是白屏，无人知道。
- **最小补法**：`smoke.spec.ts` 加一条运行在**打包产物**上的最小用例（起
  `dist/Straditize*.exe`，只断言 `/status` 可达 + 零状态 `imageSrc=null` + 范例可载）。
  这是新 lane，不是新框架。
- **证据**：`playwright.config.ts:87`、`playwright.zero.config.ts:99`。

### 10. 模态框开着时切步骤 / 键盘守卫

- **为什么危险**：`ui-layout.spec.ts:83-106` 证明「8 个步骤按钮在 1366×768 下全部完整可见」，
  也就是说模态框开着时它们**依然可点**。模态框是否阻断底层交互、开着模态切步会不会
  留下孤儿模态或半提交状态，零断言。此外 `grep Escape` → 0 命中，连「Esc 关模态」
  都没测。
- **失效的不变量**：不变量 6（阶段→工具表只有一份）——切步后 `getAllowedTools()` 变了，
  但模态框持有的旧回调可能仍按旧阶段行事。
- **最小补法**：一条 e2e —— 打开导出模态（`export.spec.ts:188` 的 `.wpd-export-dialog`）
  → 点 `#btn-wf-next` → 断言「模态框已关闭 且 stage 已推进」或「模态框仍在且 stage 未变」，
  二者之一，不得出现「模态框在、stage 也变了」。
- **证据**：`grep -rn "Escape" frontend/e2e/` → 0；模态框用例全部只走「打开→断言→专属关闭按钮」。

---

## 6 附：本次审计的方法学与局限

1. **未运行任何 e2e**（任务明确禁止，且端口被其它会话占用）。因此 §1/§2 的「已覆盖」
   一律指「存在用例且断言了该行所述的对象」，**不指「该用例当前是绿的」**。
   唯一的红灯信息来自源码里的显式声明：`from-zero-journey.spec.ts:844` 的 `test.fail()`。
2. **未读 `frontend/src/`**（不在允许清单内）。因此所有关于产品行为的判断都以**测试
   注释与 docs 的自述**为依据；凡涉及具体实现行号的引用，都是测试注释转述的
   （例如 `docs/testing-strategy.md:321` 引 `Inspector.ts:142`），本文件已在引用处标明来源。
   我**没有**独立核实这些行号。
3. **环境维度有两项「未核实」而非「未覆盖」**：
   - 安装包/Portable 是否在别处（如 `pixi run build-windows` 后的手工验收）有覆盖
     —— 我只能确认 e2e 里没有。
   - Windows 125%/150% 是否在人工验收清单里 —— 我只能确认配置文件没设 `deviceScaleFactor`。
4. **两个启动器提供的 `e2e.reset` 是本次审计最重要的发现来源**：它把产品的已知缺口
   （`project_new` 不清清理状态）在测试基建里补掉，并写成 fail-fast 自检。这是
   「门禁因为绕开缺陷而无法发现缺陷」的典型 —— 建议把它单列进
   `docs/testing-strategy.md` §9，因为它目前只活在两份 docstring 里。
