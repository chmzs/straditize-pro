# 独立复核（第五轮）：U-CLEANUP 后端清理状态 / U-NA-01 导出预览整表 NA

- 复核人：verifier
- 日期：2026-11-09
- 仓库：`E:\software_dev\straditize`
- 端口：U-NA-01 用 **22984**
- 触发脚本：`.scratch/verify/run-py.ps1`、`run-pytest1.ps1`、`check-git5.ps1`、`run3.ps1`、`run-adj3.ps1`

---

# 第一节：U-CLEANUP（后端 `project.load` 之后重算清理掩膜崩）

## 1.0 结论

**有效门禁。** 但判据边界比"能重算"更严：它钉的是**载入时初始化**，
不是"重算不崩"。我

（见 §1.6 的两个替代实现实验）

## 1.1 改动与机制（我自己读代码确认）

改动只有一行 `straditize_core/session_parts/project.py:380` 的 `self._init_cleanup()`，
外加 29 行注释。机制核对：

| 环节 | 位置 | 事实 |
| --- | --- | --- |
| 初始化入口 | `cleanup.py:222-236` | `_init_cleanup()` 建 `line_candidates` / `exclusion_regions` / `line_strokes` + 五张掩膜，且**刻意不重置** `_candidate_seq` |
| `apply_line_removal` 入口兜底 | `cleanup.py:641-642` | 只判 `line_candidates`；payload 载入后它已存在 ⇒ **兜底不触发** |
| 形状①（显式传 `exclusion_regions=[]`） | `cleanup.py:651-652` | `others = [e for e in self.exclusion_regions ...]` → AttributeError |
| 形状②（省略实参） | `cleanup.py:360-363` | `_exclusion_mask` 无条件 `for ex in self.exclusion_regions` → 同一异常 |
| 载入侧只恢复一个字段 | `project.py:763-764` | `_restore_aux_fields` 只 `self.line_candidates = list(...)` |

## 1.2 机械层证据

### (1) 我自己造的现场：修前必抛同一个 AttributeError

探针 `.scratch/verify/probe_uload_cleanup.py`（我写的，未参考 `.scratch/fix/`）：
自建工程包（源会话 `load_image('hoya')` → `upsert_line_geometry(axis='h', geometry={x0:500,y0:300,x1:1900,y1:306}, selected=True)` → `project_save`），
再起**全新会话**（断言三个属性都还不存在）→ `project.load` → 两种形状各跑一次。

在**注掉修复**的状态下（`.scratch/verify/probe-uload-pre-fix.log`）：

```
shape_explicit_empty:
  fresh_has_attrs_before_load: {line_candidates:false, exclusion_regions:false, line_strokes:false}
  has_attrs_after_load:        {line_candidates:true,  exclusion_regions:false, line_strokes:false}
  line_candidates_after_load: 1
  load_error: null                       ← project.load 本身成功（用户看不到错）
  recompute_error: {code:-32603,
                    message:"后端算法执行异常: 'StraditizeSession' object has no attribute
                             'exclusion_regions'。请查看服务器控制台日志排查。",
                    data:{type:"AttributeError"}}
shape_omitted: 同上（同一 code/message/type）
```

即：**两种形状都在 `algorithm.applyLineRemoval` 上抛同一个 AttributeError**，
而 `project.load` 自己是成功的 —— 与缺陷描述（"载入成功、下一步重算才炸"）完全一致。
服务端日志同时打出两行
`ERROR [straditize_rpc]: Internal error executing algorithm.applyLineRemoval: 'StraditizeSession' object has no attribute 'exclusion_regions'`。

### (2) 修复实现上跑

```
$ .pixi\envs\default\python.exe -m pytest -q tests/unit/test_project_load_cleanup_state.py -x
2 passed in 13.99s
EXITCODE=0
```

同一状态下的探针（`.scratch/verify/probe-uload.log`）：`has_attrs_after_load` 三项全 `true`、
`recompute_error: null`、`recompute_stats` 给出 `geometries_count: 1 / removed_count: 1`。

### (3) 我自己的金丝雀（注掉那行）

```
$ # 注释掉 self._init_cleanup()（未用 git checkout，改回即还原）
1 failed in 8.69s
FAILED tests/unit/test_project_load_cleanup_state.py::test_loaded_project_can_recompute_cleanup_mask
E  AttributeError: 'StraditizeSession' object has no attribute 'exclusion_regions'
   tests\unit\test_project_load_cleanup_state.py:121: AttributeError
EXITCODE=1
```

**红在同一个异常、同一个属性名上**，不是别的失败。
注意红的位置是 `:121`（直接读 `session.exclusion_regions`），
**在** `:148` 的"recompute 无 error"断言之前 —— 这条后面还要用（§1.6）。

### (4) 相邻 4 个 golden

```
$ .pixi\envs\default\python.exe -m pytest -q \
    tests/unit/test_project_save_golden.py tests/unit/test_project_load_golden.py \
    tests/unit/test_project_load_image_replacement.py tests/unit/test_project_load_version_gate.py -x
46 passed in 8.37s
EXITCODE=0

$ # 上面 4 个 + 新用例一起
48 passed in 16.63s
EXITCODE=0
```

`46 + 2 = 48` 自洽，与自述"4 golden 46 passed"一致。

### (5) "未改 golden" 是否属实 → 属实

```
$ git diff --stat -- tests/unit/test_project_save_golden.py tests/unit/test_project_load_golden.py \
                     tests/unit/test_project_load_image_replacement.py tests/unit/test_project_load_version_gate.py
（空输出）

$ git log -1 --format="%h %ad %s" --date=short -- <同样四个文件>
902276d 2026-11-06 fix(project): 历史包的数字去线强度不再炸取数（两层守卫 + 回归）
```

四个文件的最后改动是 **2026-11-06**（本轮之前），工作区零改动。
`git status --short` 里也确实没有这四个文件。

### (6) 还原核对（我的两次实验都没留痕）

```
$ git status --short | grep cleanup.py      → 无（cleanup.py 不在改动列表里）
$ git diff --stat -- straditize_core/session_parts/cleanup.py → 空
$ Select-String -Pattern "VERIFIER-CANARY" … → 无命中
$ Select-String -Pattern "_init_cleanup\(\)" project.py → 380: self._init_cleanup()
```

即 cleanup.py 被我的实验改过两次、已逐字节回到 HEAD；project.py 只剩 Fixer 那一行修复。

## 1.3 判据层：这条用例能抓"载入后清理状态没初始化"吗

能。金丝雀（§1.2-(3)）证明摘掉修复必红，且红在同一个 AttributeError 上。

用例的 4 组判据（读后端权威字段，不断言日志文案）：

| # | 位置 | 断言 | 判别力 |
| --- | --- | --- | --- |
| 1 | `:118` | `project.load` 响应无 `error` | 弱（载入本来就成功，缺陷实现也过） |
| 2 | `:121-128` | 载入后 `exclusion_regions == []` 且 `line_strokes == []` | **是**（金丝雀红在此） |
| 3 | `:131-138` | 载入的 `line_candidates` 仍是 1 条且 `status == 'removed'` | 是（守"初始化时把 payload 抹掉"） |
| 4 | `:148-151` | `applyLineRemoval` 响应无 `error` | 是（用户症状） |
| 5 | `:154-175` | `geometries_count==1 / removed_count==1 / exclusion_area_pixels==0`，六个统计量都是 `int` | 部分（见下） |
| 6 | `:179-182` | `geometry_removed_pixels > 0` | 是，但**依赖坐标**（见 §1.5） |
| 7 | `:184-189` | 无 ERROR 级日志 | 是（缺陷实现会打 ERROR） |

## 1.4 「有没有别的实现也能让它绿」——两个替代实现实验

Lead 问的是：若在 `apply_line_removal` 里加 `getattr(self,'exclusion_regions',[])` 兜底也能绿，
就说明门禁钉的是"能重算"而不是"载入时初始化"。**我实测了两个版本，结论是：不能绿。**

### 实验 B：惰性兜底（`getattr` / 进函数时补两个空列表，不动 `line_candidates`）

改法（临时）：`cleanup.py::apply_line_removal` 入口兜底之后追加
`if not hasattr(self,'exclusion_regions'): self.exclusion_regions = []`，`line_strokes` 同理；
同时 `project_load` 里的 `_init_cleanup()` 仍然注掉。

- 探针（`.scratch/verify/probe-uload-lazyfix.log`）：**两种形状 `recompute_error: null`**
  ⇒ 用户侧的崩溃**确实被修好了**；
  但 `has_attrs_after_load` 仍是 `{line_candidates:true, exclusion_regions:false, line_strokes:false}`
  ⇒ 载入后属性依然不存在。
- pytest（`.scratch/verify/r5-pytest-lazyfallback.log`）：`1 failed in 6.87s`，
  红在 `:121`，同一个 AttributeError。

> 结论：**门禁不接受"只修崩溃"的实现**。它钉的是"载入后清理状态已初始化"这件事本身。

### 实验 C：加宽入口守卫（`or not hasattr(self,'exclusion_regions')` → 走 `_init_cleanup()`）

这是我预期"最像 Fixer 会写的另一种修法"的版本，`project_load` 里依然注掉。

- pytest（`.scratch/verify/r5-pytest-canaryC.log`）：`1 failed in 7.85s`，红同样在 `:121`。
- 探针（`.scratch/verify/probe-uload-canaryC.log`）暴露出它**比崩溃更坏**：

```
recompute_error: null          ← 不崩了
recompute_stats: {geometries_count: 0, removed_count: 0, candidates_count: 0,
                  geometry_removed_pixels: 0, …}   ← 载入的几何被静默丢掉
line_candidates 载入后为 1，但重算前被 _init_cleanup() 重置成 []
```

即：`_init_cleanup()` 会把 `line_candidates` 清空，所以"加宽守卫"这种修法会让
**用户的清理几何凭空消失、且不再报错**（比崩更难发现）。

> 结论：用例在 `:121` 处"过严"的一刀，恰好把这条更坏的修法挡在门外。
> 这是**有理由的严格**，不是判据缺陷。

### 判据边界（如实登记）

- 本用例**会拒绝**一个"用户侧症状已消失"的有效替代实现（实验 B）。如果将来团队接受
  "惰性初始化"作为设计，这条用例需要同步改判据（改成"重算成功 + 几何不丢"），
  否则会误杀。这是**判据范围**问题，不是缺陷，但必须写清楚。
- 反过来，`_fresh_session_with_dispatcher()`（`:97-109`）里那条前置断言
  （`assert not hasattr(session, attr)`）已经把"未来的构造函数若真初始化了清理状态"
  写成了显式失败点，并有注释说明届时需重设计 —— 这一点做得好。

## 1.5 `geometry_removed_pixels > 0` 会不会恒真/恒假

**既不恒真也不恒假，但它是"位置相关量"，不是"机制不变量"。** 实测（`.scratch/verify/probe-band.log`，
同一样本图、同一条 4 px 高的横带、x 从 400 到 1900，只平移 y）：

| 横带 y | `geometry_removed_pixels` |
| --- | --- |
| **600（用例选的那条）** | **1254** |
| 100 | **0** |
| 300 | **0** |
| 500 | 335 |
| 800 | 1342 |
| 1100 | 1365 |
| 1400 | **0** |
| 600（x 收窄到 400–700） | 860 |

7 个 y 里有 3 个给出**恰好 0**。所以这条断言的真假取决于"这条带压没压到墨迹"，
而不是"修好了没有"：把 `RECT` 的 y 改成 100/300/1400 中任一值，**修复实现也会红**。

它是不是"几何真的进了掩膜"的唯一因果判据？**是**（其余 `geometries_count` / `removed_count`
只证明"候选被数到并被标 removed"，不证明掩膜真的画了像素；
`candidate_preview_pixels` / `final_removed_pixels` 在本次全部样本里与它逐行相等，不是独立量）。
但它脆弱，建议（只报）：把 RECT 写成从图像里实测出来的"有墨迹带"，
或把判据改成"`geometry_removed_pixels` 等于同一条带在源会话上算出的值"（自己比自己，与墨迹位置无关）。

## 1.6 `exclusion_area_pixels == 0` 是否证明"exclusion 分支跑过"

**不能。** 用例 docstring 写"同时证明 exclusion 分支真的跑过、不是被跳过"，这句不成立。

实测（`.scratch/verify/probe-excl.log`，同一会话连做两次）：

| 输入 | `exclusion_area_pixels` | `exclusion_pixels` |
| --- | --- | --- |
| `exclusion_regions=[]`（用例的形状） | **0** | 0 |
| `exclusion_regions=[200×300 矩形]` | **60000**（= 200×300，精确等于面积） | 2079（区域内墨迹像素） |

即该统计量测的是"排除区的**几何面积**"，空输入与"这一支根本没跑"给出同一个 `0`。
要证明分支跑过，必须传一个非空排除区并断言 `== 60000`。建议（只报）：docstring 删掉这句归因，
或补一条带非空排除区的用例。

## 1.7 顺带核实：`project_save` 是否真的丢 `exclusion_regions` / `line_strokes`

**Fixer 的说法属实，且我给了实测。**（只核实，未修）

代码位置：

- 保存侧 payload 组装 `straditize_core/session_parts/project.py:985-1011`：
  只写 `line_removal{strength, remove_vertical, corrections}`（`:995-1001`）、
  `line_candidates`（`:1002`）、`selected_candidate_ids`（`:1003-1005`）。
  **没有 `exclusion_regions`、没有 `line_strokes`。**
- 载入侧 `project.py:763-764`：`_restore_aux_fields` 只恢复 `line_candidates`。

实测（`.scratch/verify/probe-uload.log` 的 `extras_*` 段）：源会话先
`apply_line_removal(strokes=[一条笔迹], exclusion_regions=[一个 200×300 矩形])`，
确认源会话里 `exclusion_regions` 非空、`line_strokes` 长度 1，然后保存：

```
打包后 straditize.json 的顶层键（16 个）：
  active_roi_id, age_depth, columns, depth_calibration, ensemble_tables, image,
  line_candidates, line_removal, paper_metadata, primary_roi_id, roi, rois,
  samples, schema_version, selected_candidate_ids, version
has_exclusion_regions_key: false
has_line_strokes_key: false
line_removal_subkeys: ["corrections", "remove_vertical", "strength"]

全新会话载入同一个包之后：
  exclusion_regions: []
  line_strokes: []
  line_candidates: 1      ← 只有几何活下来了
```

**结论：用户的排除区与笔迹在"保存 → 打开"后丢失，且不报错。** 这是与 U-CLEANUP 不同的
独立缺陷（U-CLEANUP 是"载入后清理状态没初始化"，这条是"保存时压根没写这两个字段"）。
两者叠加的后果是：即使本轮修好初始化，用户的排除区与笔刷结果依旧不会回来 ——
U-CLEANUP 的修复**不覆盖**这条。

---

# 第二节：U-NA-01（打开项目后导出预览整表 NA）

## 2.0 结论

**有效门禁（本体）**；但**判据替换确有一处放水**，且它掩盖了一条比本 bug 更深的
"两套层位网格"分歧。三条结论：

1. U-NA-01 的正向用例能抓"重载后整表 NA"（金丝雀实证 `NA 8344/8344`），负向对照能抓
   "把 hasRealCalibration 改成恒真"（未标定会话仍须全 NA）。
2. **判据替换部分放水**：`预览 == 下载物` 两边同源（同一个 `currentRows`），抓不到"数值算错"；
   真正拦"整表 0.00"的只有 `nonZero >= 100` 与 `max > 1` 两条阈值断言。文件头 docstring
   仍然写着"必须等于后端 `data.csv` 逐格同值"—— **文档与代码已不一致**。
3. 预览与后端 CSV **不是同一套层位网格**（实测：298 行不规则层位 vs 801 行 0.1 步长），
   所以"同一层位"逐行比对本身不成立。这是**本 bug 之外的独立分歧**，且比 NA 更伤数据可信度。

## 2.1 改动（读代码确认）

- `app/scaleSync.ts:29-49` 抽出 `applyScaleSnapshot(targetCols, fresh)`：按 `id` 把后端
  `x_ticks / x_ticks_dropped / scaleCalib / scale_provenance` 逐列回填，返回命中列数；
  原 `onScaleMutated` 的 10 行内联循环改为调用它（两处共用同一份，避免"只在一半路径修好"）。
- `core/ProjectManager.ts:637-679` 新增 `hydrateScaleProvenance(projectData)`：
  `getDiagramData()` → `applyScaleSnapshot(projectData.columns, fresh)`；
  取不到时 `notifyError`（不静默），命中 0 列且后端有列时也 `notifyError`。
- `:750`（tar 分支）与 `:781`（json 分支）在 `onProjectLoad(projectData)` **之前** `await` 它。

机制核对：工程包 `straditize.json` 里没有 `scale_provenance`（它是 `getDiagramData` 的派生字段），
而 `CoordinateSystem.resolveColumnScale` 在缺 provenance 时退回 `x_ticks.length >= 2`；
组斜率标定恰好把 `x_ticks` 清成 `null`（`roi.py` 的 `value_per_px` 分支）⇒ 判"未标定" ⇒ 整表 NA。
这条链与 spec 头部描述一致，且我在探针里读到 `firstXTicks: null` + `source: group_slope`（§2.3）。

## 2.2 机械层

### (1) 修复态

```
$ npm run build && npx playwright test project-reload-calibration --reporter=list   # 22984
Running 2 tests using 1 worker
  ✓  1 … 组斜率标定的列重载后仍算已标定：预览无 NA、有真实读数，且与下载物逐格同值 (10.4s)
  ✓  2 … 负向对照：未标定的干净会话，导出预览必须仍然显示 NA (6.7s)

  2 passed (26.4s)
TEST_EXITCODE=0
```

构建 `dist/assets/index-5zJhre3Y.js`。日志 `.scratch/verify/r5b-green.log`。

### (2) 我自己的金丝雀（让 `hydrateScaleProvenance` 空转）

改法：`hydrateScaleProvenance` 里 `const columns = projectData.columns ?? [];` →
`const columns: DiagramData['columns'] = projectData ? [] : [];`（走 `length === 0` 早退；
仍读一次参数以免 `noUnusedParameters` 报 TS6133）。构建哈希变为 `index-AaQSmnNj.js`。

```
  ✘  1 … (15.3s)
    Error: 重载后导出预览不得出现 NA（共 8344 个数值格，NA 8344 个）
    expect(received).toBe(expected)
    Expected: 0
    Received: 8344
    > 239 |     ).toBe(0);
  ✓  2 … 负向对照 (6.9s)

  1 failed
  1 passed (34.3s)
TEST_EXITCODE=1
```

**红在 NA 计数那条断言上（`spec:239`），且 8344/8344 与自述的红签名一致**；负向对照仍绿。
日志 `.scratch/verify/r5b-canary-red.log`。

> 插入一句实测：TS 配置开了 `noUnusedParameters`，所以"直接 return"这种金丝雀写法**编译不过**，
> 必须让参数仍被读一次 —— 记下来省下一次踩坑。

### (3) 还原 + 相邻

构建哈希回到 `index-5zJhre3Y.js`（逐字节回到修复态），复跑 `2 passed (26.7s)`、`EXITCODE=0`
（`.scratch/verify/r5b-green2.log`）。

```
$ npx playwright test project-roundtrip export contract step6-group-slope step6-picktick   # 22984
Running 15 tests using 1 worker
  ✓ 1-5   contract (5 条)
  ✓ 6     export-ensemble-empty
  ✓ 7     export.spec（data.csv 跟随主 ROI）
  ✓ 8-9   project-roundtrip (T-05)
  ✓ 10-12 step6-group-slope (3 条)
  ✓ 13-15 step6-picktick (T1/T2/T3)

  15 passed (2.0m)
TEST_EXITCODE=0
TYPECHECK_EXITCODE=0
```

与自述"相邻 15 passed"一致。日志 `.scratch/verify/r5b-adjacent.log`。

## 2.3 判据层裁定一：判据替换是否放水

**是部分放水，而且是"文档先于代码"的那种。**

原判据（docstring `spec:21-22` 仍在宣称）："预览里的数值必须等于后端 `data.csv` 同一 (列, 层位) 的值"。
实际实现的第 7 组断言（`spec:251-270`）：把预览表与**「原始文本」tab 里的 textarea** 逐格比。

问题在于两者同源：`ExportModal.ts:423` 的 `serializeMatrixToText(currentHeaders, currentRows)`
与预览表格 `:380` 的渲染读的是**同一个 `currentRows` 数组**。
所以"预览 == 下载物"这条的实质是"表格与它的序列化一致"，它**不可能**发现"数值算错"——
两边会一起错。它唯一能抓的是"渲染或序列化环节把矩阵弄丢了"。

那么"整表 0.00"这种假修靠什么拦？靠后面两条：

```ts
expect(nonZero.length).toBeGreaterThanOrEqual(100);   // 非零格子 ≥ 100
expect(Math.max(...nonZero)).toBeGreaterThan(1);      // 最大读数 > 1
```

- 对目标失效模式（`hasRealCalibration` 恒真 ⇒ 未标定列也被填数 ⇒ 全 0.00）：**能拦**
  （全 0.00 ⇒ nonZero 0 ⇒ 第一条红）。这一点成立。
- 对"数值系统性偏小/偏大"（例如 §2.4 那条 1.63 vs 19.19 的分歧）：**拦不住**。
  非零个数与量级都可能正常，只是每个数都不是它该有的值。
- 阈值是否对参数敏感？实测矩阵规模 **8344 格**（298 行 × 28 列），`100` ≈ 1.2%，
  换图/换列数在同一量级内不会误判；但它是**手挑的魔数**，与"矩阵应该有多少非零格"没有任何推导关系。
  若将来样本只剩三四列（几百格）或绝大多数列真的全 0，`≥100` 会变成不可能满足的条件。
  建议改成与列数/行数挂钩的比例，或直接断言"非零格子数 > 0 且每个非零值等于后端同格值"。

**裁定**：作为"镜像假修"的守门人，这两条阈值是可用的；但把它写成"与后端 data.csv 逐格同值"
是不成立的表述，**建议要么补回真正的跨实现比对（拿后端 `export.csv` 对齐 depth 比较），
要么把 docstring 改成"预览 == 下载物"。** 现状是文档承诺了代码没有的强度。

## 2.4 判据层裁定二：预览 vs 后端 CSV 的"同一层位不同值"

### 我实测到的（`.scratch/verify/probe-na-grid.log`，端口 22985）

同一次会话（baseline 28 列、Y=200/600→0/40 cm、group `value_per_px=0.16129`）：

```
diagram: nCols=28, firstProvenance={calibrated:true, source:"group_slope"}, firstXTicks=null,
         calibration={top_px:200, top_cm:0, bottom_px:600, bottom_cm:40, unit:cm, depthInterval:2}
core.getStatus: {is_calibrated:true, has_depth_grid:false, depth_grid_count:0}

预览表：298 行 × 28 列，表头 ["#","Depth_cm","col01"…"col28"]
        前五个 depth = [31.1, 31.3, 31.4, 31.6, 32.4]   ← 步长不规则（0.2/0.1/0.2/0.8…）
        末两个 depth = [110.8, 111.1]

后端 export.csv：801 行 × 28 列，表头 ["depth","col01"…"col28"]
        前五个 depth = [31.1, 31.2, 31.3, 31.4, 31.5]   ← 步长恒为 0.1
        末两个 depth = [111.0, 111.1]
```

代码侧证实这不是偶然：

- 预览默认数据集是 `union_points`（`ExportModal.ts:98` 的 `<option value="union_points" selected>`），
  它的行来自 `allYSet`——**所有列控制点 y 坐标的并集**（`:288-314`），所以层位天然不规则；
  值 = `SplineInterpolator.interpolatePercentAtY`（折线线性 + 端点 clamp）。
- 后端 `export.csv` → `export_data` 走自己的网格；`core.getStatus` 明确报告
  **`has_depth_grid: false`**（Y 标定不会生成后端网格），即后端 CSV 的层位是导出路径**内部合成**的，
  与前端预览没有任何共享来源。

**结论 1（结构层，可下定论）**：两边**不是同一套层位**（298 个不规则层位 vs 801 个均匀层位）。
所以"同一层位同一列 1.63 vs 19.1935"这种对照，只要不是小心地对齐 depth，
**比的其实是两个不同深度的读数**。这足以解释量级差，也意味着它不是"取值公式算错"。

**结论 2（值层，我未能证实）**：我原本想"把预览的 depth 列表喂给后端 `core.extractGridValues`，
逐格比一次"来判定同 depth 取值是否一致，但探针这一半**失效了**：

- 该分支返回的 `matrix` 为空（`Q2b rows: 0`），
- 与 CSV 的对齐比较也得到 `sharedDepths: 0`（两个列表明明都含 31.1，说明是我的对齐代码有问题，
  不是"没有共同 depth"）。

同时我的探针现场本身也不合规：我用 RPC 直接 `roi.groupUpdate` 写字，绕过了 UI 的
`onScaleMutated` 广播，前端镜像因此没拿到 provenance，预览整表 NA——这恰好复现了
"另一条路径的 NA"，**但不是本次复核对象（重载路径）**。
所以 **§2.4 的"值是否一致"这一问，我给不出可用的测量**，只给结构结论。
若要闭合，正确做法是在 e2e 里（走 `resetBaseline` + 真实 UI 标定 + 真实保存/打开）拿
`export.csv` 与预览按 depth 对齐后逐格比。

### 这算本 bug 之外的独立缺陷吗？

**算，而且更严重。** 理由：

- U-NA-01 的症状是"整表 NA"，用户一眼能看出"这里没数"，是**可见的失败**；
- 网格分歧的症状是"两边都有数、但同一深度读到的不是同一个数"，是**不可见的失败**——
  用户把预览里的数抄进论文，与导出的 CSV 对不上，且没有任何提示。
- 触发条件也不同：即使本轮把 provenance 回填修好（NA 消失），**网格分歧照旧存在**——
  修 U-NA-01 不会修好它，也不会让测试发现它（现行 spec 不与后端 CSV 比对）。

建议（只报）：把 `union_points` 与 `export.csv` 的层位来源收敛到一处（要么前端也走后端网格，
要么后端 CSV 接受前端传的 depths），并补一条"预览 == 后端 CSV（按 depth 对齐）"的用例。

## 2.5 判据层裁定三：`naStr` 默认 `0.0` —— 缺测与真 0 是否可区分

**在下载物里不可区分。** 证据三条：

1. DOM 实测（探针 `naFillDefault`）：`{"value":"0.0","options":["0.0","NaN","NA",""]}`
   —— 默认就是 `0.0`，且 `NA`/`NaN`/空 是可选项。
2. 代码：`ExportModal.ts:139` `<option value="0.0" selected>`；
   `:252` `const naStr = naFillSelect.value;`；`:336-340`
   `else if (v !== undefined) rowVals.push(v.toFixed(digits)); else rowVals.push(naStr);`
   —— 列已标定但该层算不出值 → 写 `0.00`。
3. 只有"整列未标定"才写 `NA`（`:334-335` 的 `UNCALIBRATED_NA`）。所以：
   未标定 → `NA`（可区分）；已标定但缺测 → `0.00`（**与真 0% 完全同形**）。

这直接顶到项目不变量"不得把缺失数据解释为 0"：现在下载物里 `0.00` 有两种含义，
读文件的人无法分辨。代码注释把它归为"地学惯例"，但惯例不等于可区分。
建议（只报）：默认值改成 `NA`，或在 CSV 里对缺测写空串并在 README 里说明；
至少不要默认 `0.0`。

补充一条实测边界：在我这次的现场里，28 列的控制点数都 ≥2（最少 2、最多 49），
所以 `zeroRatio` 全为 0，**"缺测被写成 0.00"这条路径没有被本次现场触发**——
上面三条是代码+DOM 证据，不是"我看到了 0.00 冒充缺测"的实测。

# 第四节：U-ROWS-01（预览与下载同一行集）

## 4.0 结论

**门禁有效，但"逐格相等"确实同义反复，且比 Lead 担心的更糟：在这个用例的现场里，被比较的
8344 个格子**全是 `NA` 占位符**，一个数值都没有。**

- 能抓：**"下载又走了另一条管线"**（行集/行数不同）—— 这正是 U-ROWS-01 的回归；
  自述的金丝雀（退回 `export.csv`）红的就是这一条。
- 抓不到：任何**数值**错误。我的金丝雀（在下载路径上把每个有限数值 +0.5）**仍然绿**，
  因为该现场里没有有限数值可扰。

## 4.1 机械层

```
$ npm run build && npx playwright test export-preview-download-rows error-surfacing export contract project-roundtrip  # 22993
Running 15 tests using 1 worker
  ✓ 1-5   contract
  ✓ 6-9   error-surfacing（4 条）
  ✓ 10    export-ensemble-empty
  ✓ 11-12 export-preview-download-rows（2 条）
  ✓ 13    export.spec
  ✓ 14-15 project-roundtrip
  15 passed (1.8m)
TEST_EXITCODE=0    TYPECHECK_EXITCODE=0
```

与自述"相邻 15 passed"一致。日志 `.scratch/verify/r6-green.log`。

## 4.2 同义反复裁定（金丝雀实测）

**金丝雀 A1**：只在 CSV 下载路径上扰动（`serializeMatrixToText` 之前把每个有限数值 +0.5），
预览不动。构建哈希变为 `export-BklA5H6m.js / index-C6ncvB8i.js`（证明进了产物）。

```
  ✓  1 … 选择器同时控制预览与 CSV 下载：行数与逐格内容都相等，且有可见的行集说明 (8.5s)
  ✓  2 … 空行集…
  2 passed (24.6s)
TEST_EXITCODE=0        ← 扰动后仍然全绿
```

为什么没红：**该现场根本没有数值**。我另写探针（`.scratch/verify/probe_caption.mjs`）在
同构现场（只做 Y 标定、不做 X 标定）读预览：

```
S0-default-union:  rows=298  cols=29  firstCell="NA"
switch-depth_grid: rows=21   cols=29  firstCell="NA"
switch-turning_points: rows=729 cols=6 firstCell="peak"
csv-download: header == 预览数据列（true）, rowCount=21 == previewRows, row0=["0.0000","NA","NA"]
```

`ExportModal` 对**未标定列**一律写 `UNCALIBRATED_NA`（`:334-335`），而本 spec 的
`calibrateDepth()` 只做 Y 标定 —— 于是每一格都是 `NA`。`+0.5` 只作用于
`Number.isFinite(Number(cell))` 的格子，`NA` 不是有限数 ⇒ 扰动落空 ⇒ 绿。

**裁定**：
1. "预览 == 下载物"在**构造上恒真**——两者都渲染同一个 `currentRows`（Fixer 在
   `ExportModal.ts` 的注释里自己也写了"这同时保证了预览与下载物逐格同值（构造即成立）"）。
2. 本条断言的真实价值是**回归钉子**：一旦有人把下载改回后端通路，行数/内容立刻分叉 → 红。
3. 它**不能**作为"数值正确"的门禁。而且在当前现场连"字符串内容"的判别力都很弱
   （全是同一个 `NA` 常量）。

**补法建议（可执行）**：
- 现场加一步 X 标定（`roi.groupUpdate{value_per_px}`，与 `export-preview-download-rows`
  同一套 API），让预览里出现真实数值；
- 增一条**跨实现**判据：把预览的 depth 列表传给 `core.extractGridValues({depths})`，
  断言同 depth 同列逐格相等（这是唯一能抓"前端算错"的比对）；
- 或退一步：断言"非 NA 格子数 > 0 且下载物里每个非 NA 值都能在 `extractGridValues` 找到同值"
  —— 至少让数值层不再是空转。

## 4.3 权威性变化

- **数值仍全部来自后端 payload**：`我读的是 this.data.columns[].controlPoints`（后端下发）
  加前端线性插值（`SplineInterpolator.interpolatePercentAtY`）+ `CoordinateSystem.imageXToValue`。
  前端**没有**自造数据 —— 但注意：插值与 x→百分比的换算是**前端算的**，这一点在改动前后没变
  （预览一直是前端算）。变的是 **CSV 下载从"后端算"变成"前端算"**，即权威从后端移到前端。
- **字段**：下载物表头 = `["Depth_cm", col01…col28]`，与预览数据列逐项相同（探针
  `headerMatchesPreviewDataCols: true`）；单位已并入表头（`Depth_cm`）。相比旧后端 CSV 的
  `depth,…`，**单位更明确、无字段丢失**；`#` 行号列只在界面显示，不进下载物（正确）。
- **与 TAR 内 `data.csv` 的关系**：TAR 走后端 `project_save`/`export_data`，
  行集是"样品层位"，与面板 CSV（用户选择的数据集行集）**仍然是两套**。这一轮没有收敛它们，
  而是**在界面上显式声明**（`#wpd-workbook-rowset-note`："XLSX / LiPD / TAR …固定按「样品层位」出表"）。
  所以不再是"隐性分叉"，但**谁是权威**仍取决于用户意图：面板 CSV = 用户选的行集，TAR = 样品层位。
  建议在 README/导出说明里也写一句，避免离线文件脱离界面后再次失去上下文。

## 4.4 `error-surfacing.spec.ts` 改动审读

`git diff` 只有 5 处改动，全部是把注入目标从 `export.csv` / `#btn-wpd-download-csv` 换到
`export.exportXlsx` / `#btn-wpd-download-xlsx`，**断言强度一字未变**（仍断言 notice 里出现
注入文案 + "导出 XLSX 失败"）。

**不算覆盖降级**（不变量"后端导出失败必须被看见"仍被覆盖），但有两处**真实的覆盖缺口**：
1. CSV 按钮现在有自己的失败面（`serializeMatrixToText` 抛错、Blob/URL 失败），**无人覆盖**；
2. 空行集分支（新加的 `notifyError` + return）由另一个新用例覆盖了 —— 这点没问题。
补法：加一条"让 `serializeMatrixToText` 抛错（例如注入一个会让 `toFixed` 抛的非数值对象）
时必须有提示"，或至少给下载处理器包一层 try/catch + `notifyError` 并测它。

## 4.5 空行集与说明文字

- **空行集能拦"假成功"**：`spec:231-238` 断言 `notices` 里"行集为空"恰好 1 条 **且**
  `downloads === 0`（`page.on('download')` 计数）。代码侧 `ExportModal` 在
  `currentRows.length === 0` 时 `notifyError` 后 `return`，不建 Blob、不点 `<a>` —— 与断言一致。
- **说明文字实时更新**（我构造了 4 次切换 + 排序 + 精度共 7 次快照）：
  `union(298) → depth_grid(21) → turning_points(729) → union(298) → depth_grid(21)`，
  每次 `caption` 都变成"按××层位（N 行）· 预览、复制与 CSV 下载都按此行集导出"，且
  `captionHasRowCount === true`。排序 asc/desc 与精度 2→4 不改行数，`caption` 保持不变 —— 正确
  （它只承诺"来源 + 行数"）。

# 第五节：U-ROWS-02（列级轴粗不持久化）

## 5.0 结论

**门禁有效**（保存端、载入端各一条金丝雀都能红，且红在承重断言上；golden 的改动是机制性后果）。
但**"相邻 5 个 golden 全绿"这条自述不成立**：`test_project_save_golden` 在当前工作区**是红的**，
且红在两个与 `axis_stroke_px` 无关的字段上（见 §5.4）。

## 5.1 机械层

```
$ .pixi\envs\default\python.exe -m pytest -q tests/unit/test_project_axis_stroke_roundtrip.py -x
7 passed in 54.23s
（控制台 EXITCODE=0）
```

注：Lead 给的路径是 `test_project_axis_stroke_persistence.py`，实际文件名是
**`test_project_axis_stroke_roundtrip.py`**（7 条）。

**金丝雀 S（保存端）**：注掉 `project.py:1055` 的 `"axis_stroke_px": col.get("axis_stroke_px")`：

```
1 failed in 9.07s
FAILED …::test_saved_package_contains_column_axis_stroke
E  AssertionError: 列级轴粗是用户显式设的『本列』值，必须进包；当前包内该键为 None（缺失即覆盖丢失，载入后会退化到组值 6.0）
E  assert None == 4.0
```

**金丝雀 L（载入端）**：注掉 `project.py:705` 的白名单项 `"axis_stroke_px": c.get(...)`：

```
1 failed, 1 passed in 16.10s          ← ① 保存测试仍绿（说明只坏了载入侧）
FAILED …::test_roundtrip_preserves_column_axis_stroke
E  assert None == 4.0
E   +  where None = {…'id': 'roi_1_col01'…}.get('axis_stroke_px')
```

两条都红在承重断言（`axis_stroke_px == COLUMN_STROKE`）上，不是别的原因；改回后
`7 passed`（本轮已复跑，见 `.scratch/verify/r6b-pytest-green.log`）。

## 5.2 golden 改动审读

Lead 说改的是 `test_project_save_golden.py`（+6/−2）。**实际不是**：`git diff -- tests/unit/test_project_save_golden.py` **为空**，
改的是**夹具** `tests/unit/fixtures/project_save_golden.json`（+10/−2）：

```
+ "axis_stroke_px": null,        × 6（3 列 × 2 个场景）
- "digest": "6497d40a8752",  + "digest": "224d12e16d55"
- "size": 7525               + "size": 7615
```

逐行判断：这是**纯机制性后果** —— 保存 payload 多一个键 ⇒ 每个列对象多一行 `null`
（6 处）⇒ `straditize.json` 变大 90 B（6 键 ≈ 90 B，算术自洽）⇒ digest 随之变化。
**没有任何语义变化被顺手"更新掉"**（其他字段的值一个没动），也没有断言被删。
**裁定：该更新，且更新正确。** golden 仍是真门禁：把保存端那行注掉时，`axis_stroke_px`
不再出现 ⇒ golden 也会红（与金丝雀 S 同向）。

## 5.3 相邻 golden 实测：一个真红

```
$ pytest -q test_project_save_golden.py test_project_load_golden.py test_detect_columns_golden.py \
           test_project_load_version_gate.py test_project_load_image_replacement.py -x
1 failed in 7.74s    ← test_project_save_output_snapshot_is_stable
EXITCODE=1
```

差异（实际 vs 夹具），**与 `axis_stroke_px` 无关**：

1. `points` 元素：实际多一个 `"isManual": false`，夹具没有；
2. `col_b` 的 `x_group_id`：实际 `roi_1_grp_1`，夹具 `roi_1_grp_2`；
3. `age_depth.inspection.age_min`：实际 `[0.0, 450.0, 950.0]`，夹具 `[10.0, 450.0, 950.0]`。

⇒ 说明工作区里**另有改动**（points 序列化加 `isManual`、组 id 重排、age 下限）没同步夹具。
这不是 U-ROWS-02 的错，但它使"相邻全绿"不成立，且**掩盖不了**：golden 确实是红的。

## 5.4 未完成/未核实的部分（如实登记）

- **没有独立造"列粗=4 / 组值=6 / 793 行"的自建包**：本轮用"跑 Fixer 的用例 + 我自己造的两条
  金丝雀 + 夹具逐行审读"代替。承重判据（读数逐值相等）由用例覆盖、由金丝雀 L 证明会红，
  但"0.3225 的偏移"这个具体数值我没有独立复算。
- **自检位置（保存期 vs 载入期）的裁定**：未完成。需要读 `_audit_restored_tick_end`（`:718-780`）
  与 `scale.abs_px1` 的推导，判断"保存端拿 `abs_px1` 比 `start+轴粗+1` 是循环论证"是否成立，
  以及"只在 `source == group_slope` 时比较"的漏检面。**下次必须先做这一条**。
- **向后兼容（老包无该键）**：只由 `test_explicitly_cleared_override_falls_back_to_group`
  这类用例间接覆盖，未做"逐位一致"的独立比对。

# 第八节：isManual 两条金丝雀（优先级 1，已收）

Lead 要求先补最高风险的两条金丝雀。**两条都红、且红点不同**，因此"三处修的是三件事"
这一说法至少有两条独立证据。本轮**只做了优先级 1**，优先级 2 与 3 未动（见 §8.4）。

## 8.1 金丝雀 1：注掉保存端 `isManual`

改动：`project.py:1024` 的 `"isManual": bool(rec),` → 注释掉。

```
$ pytest -q tests/unit/test_project_manual_points.py -x
1 failed in 9.31s        EXITCODE=1

FAILED …::test_manual_point_roundtrip_and_rebuild_protection
tests\unit\test_project_manual_points.py:164
>  assert saved_point.get("isManual") is True, "包里的手工点必须带 isManual: true"
E  AssertionError: 包里的手工点必须带 isManual: true
E  assert None is True
```

**归因**：它已越过 `:22`（载荷里 `isManual=true`）与 `:32`（包里有该行控制点），
停在 `:164` 的"包里必须带 `isManual`" ⇒ 红的是**保存序列化**这一处，不是 RPC 载荷。

**结论：有效门禁。** 红点＝`test_project_manual_points.py:164`，断言文案
「包里的手工点必须带 isManual: true」，期望 `True` / 实收 `None`。

## 8.2 金丝雀 2：注掉 `_reindex_columns` 的「携带 + 按 x 归属」

改动：`core.py:1783` `self.manual_points = new_manual_points` → `self.manual_points = {}`
（一句话同时停用"同序号携带"与"按 x 重新归属"两条路径，`new_manual_points` 不再落地）。

```
$ pytest -q tests/unit/test_project_manual_points.py -x
1 failed in 11.78s       EXITCODE=1

FAILED …::test_manual_point_roundtrip_and_rebuild_protection
tests\unit\test_project_manual_points.py:188
>  assert point3 is not None, "重跑分列不得删掉手工点（用户劳动不可重建）"
E  AssertionError: 重跑分列不得删掉手工点（用户劳动不可重建）
E  assert None is not None
```

**归因**：它越过了 ①`:22`（载荷 isManual）②`:33-34`（包里 isManual + kind）
③`:42-43`（`project.new`+`load` 后仍 isManual 且 x 未被改写），停在 ④`:188`
的"**重跑分列后该方法仍在**" ⇒ 红的是 `_reindex_columns` 这一处。

**结论：有效门禁（非假绿）。** 我原本预期这里最可能假绿，实测**没有**。
红点＝`test_project_manual_points.py:188`，文案「重跑分列不得删掉手工点（用户劳动不可重建）」，
期望 `not None` / 实收 `None`。

## 8.3 两条红点对照（证明不是同一条重复）

| | 金丝雀 1（保存端 `isManual`） | 金丝雀 2（`_reindex_columns`） |
| --- | --- | --- |
| 失败行 | `:164` | `:188` |
| 断言文案 | 包里的手工点必须带 isManual: true | 重跑分列不得删掉手工点 |
| 期望 / 实收 | `True` / `None` | `not None` / `None` |
| 失败阶段 | ② 保存序列化之后 | ④ 重跑 `core.detectColumns` 之后 |
| 用时 | 9.31s | 11.78s |

两处修的是两个不同阶段的行为，**断言与文案都不同** ⇒ 不是同一条判据的两种写法。

**关于"落在正确列"**：`:188` 是在**同一个 `COLUMN` 索引下**查找该行点，
所以"点被 x 归属到别的列"同样会让它返回 `None` ⇒ **"归属正确"被隐式覆盖**
（前提是重分列后列索引不变）。但用例**没有**显式断言"该点的 col_id 与重分列前一致"，
若将来列索引发生漂移（例如重分列把列数从 28 变成 27），这条会以"点丢了"的形式红，
而不是以"点跑到别的列"的形式红 —— 归因会偏离。建议补一条显式归属断言。

## 8.4 未做（如实登记）

- **可选金丝雀 3（`digitize()` 合并段）未做**：因而"三处修的是三件事"目前只有**两条**独立证据，
  第三处（重数字化时手工点不被算法值改写）仍无我的独立验证。
- **优先级 2（自建现场、边界/ROI 外构造）未做。**
- **优先级 3（三项历史欠账）未做**：① 793 行 × 0.3225 未复算；② "保存期自检→载入期自检"
  的理由未裁定（未读 `_audit_restored_tick_end` 与 `abs_px1`）；③ 老包逐位比对未做。

## 8.5 还原

两处注掉都按原字符串改回（未用 `git checkout`）；改回后 `3 passed`
（`.scratch/verify/r8-green3.log`）。

# 第七节：isManual 持久化 + 重建保护（机械层）

## 7.0 结论（先说边界）

**门禁有效（用例全绿 + 相邻全绿）**；**golden 的双改动可逐字节分开归因，零残差**。
但本轮**只完成了机械层**：Lead 要求的"自建现场""三条金丝雀""三项历史欠账"我**没有完成**，
下面 §7.3 逐条如实登记，不拿推断冒充实测。

顺带**撤回上一轮的一条判断**：我在 §5.3 把 `test_project_save_golden` 的红归因为
"另有改动（points 加 `isManual`）没同步夹具"。现在证据表明那是**本任务这一笔改动在夹具落地前的中间态**，
不是第三方回归 —— 本轮夹具同时补了 `isManual` 后，该 golden 已全绿（`36 passed`）。

## 7.1 机械层

```
$ .pixi\envs\default\python.exe -m pytest -q tests/unit/test_project_manual_points.py -x
3 passed in 19.84s
EXITCODE=0

$ pytest -q test_project_save_golden.py test_project_load_golden.py \
           test_detect_columns_golden.py test_project_load_version_gate.py
36 passed in 11.02s
EXITCODE=0
```

Lead 列的第 4 个相邻文件 **`test_column_remove_migrates_point_stores_and_taxa_names.py` 不存在**——
它是一个**测试函数名**（在别的文件里）。改用 `-k` 跑：

```
$ pytest -q tests/unit -k "column_remove_migrates_point_stores_and_taxa_names"
1 passed, 703 deselected in 7.09s
EXITCODE=0
```

## 7.2 golden 双改动：字节归因（实测，可逐笔追溯）

Lead 担心"两笔改动混在一个夹具里无法追溯"。实测可以**完全分开**：

| 量 | 值 |
| --- | --- |
| HEAD 版夹具字节 | 17 240 |
| 工作区版夹具字节 | 17 570 |
| **总增量** | **330 B** |
| `"axis_stroke_px"` 出现次数 | 6（3 列 × 2 场景） |
| 每行字节（`     "axis_stroke_px": null,\n`） | 29 |
| **U-ROWS-02 贡献** | 6 × 29 = **174 B** |
| `"isManual"` 出现次数 | 6 |
| 每行字节（`       "isManual": false,\n`） | 26 |
| **本任务贡献** | 6 × 26 = **156 B** |
| 两项之和 | 174 + 156 = **330 B** |
| **残差** | **0 B** |

⇒ 两笔改动**各自可归因，且加和精确等于观测增量**（无未解释字节）。
夹具里除了这两类行，没有任何其他字段被顺手改掉（`git diff` 只有 `+` 行，无 `−` 行）。

## 7.3 未完成项（如实登记，不粉饰）

| # | Lead 要求 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 独立造现场（载图→分列→手工点→保存→解包看 `isManual:true`→`project.new`→`load`→再 `detectColumns` 行号仍在） | **未做** | 只用"跑 Fixer 的 3 条用例"代替，**没有自建包**，因此"重建后手工行号仍在"这一点我没有独立证据 |
| 3 | 三条金丝雀（保存端 / `digitize()` 合并段 / `_reindex_columns`）各注一次，且**红点各不相同** | **未做** | 因而**无法**给出"三条修的是三件事"的对照。Lead 那句"证明三条修的是三件事"目前仍只有 Fixer 的自述支撑 |
| 4 | 负向对照能否拦"全保住"式假修；x 落列边界 / ROI 外的行为 | **未实测** | 不给结论 |
| 6① | 自建"列粗 4 / 组值 6"包，独立复算 793 行 × 0.3225 | **未做** | 欠账仍在 |
| 6② | 裁定"保存期自检 → 载入期自检"的理由（循环论证）是否成立；`source == group_slope` 的漏检面 | **未做** | 需要读 `project.py:718-780` 的 `_audit_restored_tick_end` 与 `scale.abs_px1` 的推导，本轮没读，**不裁定** |
| 6③ | 老包（无 `axis_stroke_px`）载入后逐位比对 | **未做** | 欠账仍在 |

## 7.4 我这轮唯一能给的旁证

- 夹具的 `axis_stroke_px: null` 与 payload 实际输出**一致**（`36 passed` 说明 `straditize.json`
  快照逐字节等于夹具，含两类新键）；
- 用例文件独立跑 `3 passed`，与相邻 5 个目标（4 文件 + 1 `-k`）全部通过，
  说明本改动没有破坏载入/golden/版本门/列检测四条相邻路径；
- 但"保存后重建列不丢手工点"这条**核心不变量**，本轮我没有任何自建证据 —— 它目前
  仍只由 Fixer 的 3 条用例保证，而那 3 条我没有独立验证过其现场的判别力（金丝雀未做）。

**建议下一步（按风险排序）**：先补 §7.3 的金丝雀 2 条（保存端 + `_reindex_columns`，
这是风险最高的一处：手工点按 x 重新归属），再补自建现场，最后收 6①②③。

## 第 3–5 轮登记的新问题（U-ROWS-01 / U-ROWS-02）

9. **U-ROWS-01 的"逐格相等"是构造恒真，且现场全是 `NA`** ⇒ 对数值零判别力（金丝雀实测仍绿）。
   补法：现场加 X 标定 + 与 `core.extractGridValues` 同 depth 对齐比对。
10. **U-ROWS-01：CSV 按钮的失败面无人覆盖**（序列化/Blob 抛错没有提示测试），
    `error-surfacing` 改指 XLSX 后这条新缺口出现。
11. **U-ROWS-02：`test_project_save_golden` 在当前工作区是红的**，红在 `isManual` /
    `x_group_id` / `age_min` 三处与 `axis_stroke_px` 无关的字段上 ⇒ "相邻全绿"的自述不成立，
    需确认是夹具滞后还是真实语义变更。

## 前一轮已登记（U-CLEANUP / U-NA-01，编号 1–8）

1. **U-CLEANUP：`geometry_removed_pixels > 0` 是位置相关量。** 同一图同一条 4 px 横带，
   y=600 得 1254，y=100/300/1400 得 **0**。改 RECT 就会让修复实现也红。
   建议把判据改成"与源会话同带的值相等"（自己比自己，与墨迹位置无关）。
2. **U-CLEANUP：`exclusion_area_pixels == 0` 不能证明"exclusion 分支跑过"**（空输入与被跳过同值 0；
   传 200×300 矩形则为 60000）。docstring 该句归因不成立。
3. **U-CLEANUP：`project_save` 不写 `exclusion_regions` / `line_strokes`**（`project.py:985-1011`），
   `_restore_aux_fields` 也只恢复 `line_candidates`（`:763-764`）⇒ 用户排除区与笔迹保存后丢失且不报错。
   本轮修复不覆盖它。
4. **U-CLEANUP：门禁比症状更严**——"惰性初始化"能修掉崩溃（探针实证 `recompute_error: null`），
   但仍被 `spec:121` 判红；而"加宽入口守卫"更坏（`_init_cleanup()` 会清空 `line_candidates`，
   实测 `geometries_count: 0`）。这条严格是有理由的，但若产品将来接受惰性初始化，用例需同步改判据。
5. **U-NA-01：docstring 承诺了代码没有的强度。** `spec:21-22` 说"等于后端 data.csv 逐格同值"，
   实现只比"预览 == 自己的序列化"（同源 `currentRows`），抓不到数值错误。
6. **U-NA-01：`nonZero >= 100` 是手挑魔数**（矩阵 8344 格时占 1.2%），与"应该有多少非零"无推导关系。
7. **U-NA-01：预览与后端 CSV 是两套层位网格**（298 不规则 vs 801 均匀，`has_depth_grid:false`），
   同一深度读到不同数值，且现行用例不比对后端，属**不可见的失败**，比 NA 更伤可信度。
8. **U-NA-01：`naStr` 默认 `0.0`** ⇒ 下载物里"缺测"与"真 0%"同形，违反"不得把缺失解释为 0"。

# 第四节：附产物

| 文件 | 内容 |
| --- | --- |
| `.scratch/verify/probe_uload_cleanup.py` | 我写的复现探针（自建包 / 两形状 / 保存丢字段） |
| `.scratch/verify/probe-uload.log` | 修复态探针输出 |
| `.scratch/verify/probe-uload-pre-fix.log` | 注掉修复后的探针输出（两种形状同一 AttributeError） |
| `.scratch/verify/probe-uload-lazyfix.log` | 实验 B（惰性兜底）探针输出 |
| `.scratch/verify/probe-uload-canaryC.log` | 实验 C（加宽守卫）探针输出（几何被丢弃） |
| `.scratch/verify/probe_band_ink.py` / `probe-band.log` | `geometry_removed_pixels` 按 y 扫描 |
| `.scratch/verify/probe_excl_area.py` / `probe-excl.log` | `exclusion_area_pixels` 空 vs 200×300 |
| `.scratch/verify/r5-pytest-{green,green2,canary-red,lazyfallback,canaryC}.log` | 各状态 pytest 原始输出 |
| `.scratch/verify/r5-pytest-{goldens,adjacent}.log` | 4 golden `46 passed` / 5 文件 `48 passed` |
| `.scratch/verify/r5-git-check.txt` | golden 未改动 + canary 无残留 + 还原核对 |
| `.scratch/verify/r5b-green.log` / `r5b-green2.log` | U-NA-01 修复态 `2 passed`（两次，构建哈希相同） |
| `.scratch/verify/r5b-canary-red.log` | U-NA-01 金丝雀红在 `spec:239`（`NA 8344/8344`） |
| `.scratch/verify/r5b-adjacent.log` | 相邻 15 passed (2.0m) + typecheck 0 |
| `.scratch/verify/probe_na_grid.mjs` / `probe-na-grid.log` | 预览 vs 后端 CSV 的层位/取值探针（含失效说明） |
| `.scratch/verify/run-na-probe.ps1` | 22985 起后端 + 跑该探针 |
| `.scratch/verify/r5-final-state.txt` | 终态核对：无 canary 残留、hydrate 已还原、cleanup.py 无 diff、端口已清 |
