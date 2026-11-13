# 独立复核：T-05「保存项目」出口改为工程包

- 复核人：verifier（独立复核，未采信 Fixer 的 `.scratch/fix/` 自述证据）
- 日期：2026-11-09
- 仓库：`E:\software_dev\straditize`
- 复核基线：工作区未提交改动（`frontend/src/core/ProjectManager.ts` 等），e2e 端口 22952

---

## 0 结论

**有效门禁。**

T-05 这条用例在错误实现上**变红且红在「往返还原」这件事本身**（`roiNames` 轮询 30 s 超时，
期望 `往返测试A`、实收 `往返测试B`），在修复实现上为绿；回滚后构建产物哈希逐字节回到修复态，
重跑仍绿。负向对照独立成立（后端状态逐字段零变化 + 用户可见报错 + 无失败 RPC）。
另有三条与 T-05 无关的新问题（见 §4），均只报不改。

---

## 1 机械层证据

### 1.1 读代码：改动范围

`git status --short`（节选相关行）：

```
 M frontend/src/core/ProjectManager.ts
 M frontend/src/main.ts
 M frontend/package.json
 M docs/testing-strategy.md
?? frontend/e2e/project-roundtrip.spec.ts
?? frontend/src/devtools/
?? frontend/e2e/discovery/
```

T-05 的实际改动只有 `ProjectManager.ts::saveProjectFile` 三处：

```diff
-      const res = await this.rpcClient.call<any, any>('export.tar');
+      const res = await this.rpcClient.call<any, any>('project.save');
...
-      throw new Error('export.tar 返回的数据不合法');
+      throw new Error('project.save 返回的数据不合法');
...
-      console.error('后端 export.tar 导出失败:', err);
+      console.error('后端 project.save 导出失败:', err);
```

外加一段说明为何不能走 `export.tar` 的注释。**没有**动 `openProjectFile`、**没有**动后端。

同一工作区里 `frontend/src/main.ts`（诊断记录器两行挂载）、`package.json`（discovery 脚本）、
`docs/testing-strategy.md`（§10 Discovery lane）属于**其他 lane 的未提交改动**，不构成 T-05 的
范围外溢（它们不触碰被测路径，见 §1.4 的相邻结论）。

唯一出口确认：`#btn-save-project` → `Toolbar.ts:437` → `ProjectManager.saveProjectFile` → 该 RPC。
`ExportModal.ts` / `ToolbarBridge.ts` / `PropertyPanel.ts` 只是转发到同一函数，无第二条实现。

### 1.2 新 spec 自检（有没有放水）

对 `frontend/e2e/project-roundtrip.spec.ts` 检索：
`waitForTimeout|test.(skip|fixme|slow)|.skip(|mock|toBeTruthy|toBeDefined|toBeNull()` → **0 命中**。

断言强度逐条（全部是具体值 equality，没有 existence 型断言）：

| 断言 | 形态 |
| --- | --- |
| ROI 名 | `expect.poll(...).toEqual([ROI_SAVED])` |
| 标定是否已标定 | `.toBe(true)` |
| 标定五字段 | `.toEqual({top_px, top_cm, bottom_px, bottom_cm, unit})` 整对象 |
| 列数 | `.toBe(columnsBeforeSave)` |
| 归档成员 | `[...keys()].some(n => n.endsWith('straditize.json')) === true`，失败时打印实际成员串 |
| 意外通知 | `telemetry.notices.filter(...)` `.toEqual([])` / `.toBe(1)` |
| 后端状态快照 | 整对象 `.toEqual(dirtied)` 且 `.not.toEqual(before)` |

状态读取全部走 `straditize.getDiagramData`（`helpers.ts:305` → `rpc(page, ...)`），即**后端权威载荷**，
不读 DOM 文案、不读前端镜像。负向用例的豁免用 `test.use({ allowlists: { notice: [/未在 \.tar 归档中找到项目数据 JSON 文件/] } })`
**窄口径**声明，不是关掉门禁（`fixtures.ts:154-162` 仍会对任何其他通知报错）。

### 1.3 在修复实现上跑（绿）

命令（写成 `.scratch/verify/run-roundtrip.ps1` 触发，内容等价）：

```powershell
cd frontend; npm run build
$env:STRADITIZE_E2E_PORT='22952'; npx playwright test project-roundtrip --reporter=list
```

`npm run build` = `tsc && vite build`，`tsc` 无输出即通过。日志全文见 `.scratch/verify/T-05-green.log`。

关键原文：

```
[WebServer] [e2e] backend ready on http://127.0.0.1:22952/

Running 2 tests using 1 worker

  ✓  1 [msedge] › e2e\project-roundtrip.spec.ts:222:3 › T-05 保存项目 → 打开项目 往返 › 「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原 (9.5s)
  ✓  2 [msedge] › e2e\project-roundtrip.spec.ts:314:3 › T-05 负向对照：缺 straditize.json 的 tar 必须明确报错且后端零变化 › 不含 straditize.json 的 tar：明确报错、后端状态零变化（不静默、不半载入） (7.0s)

  2 passed (25.6s)

TEST_EXITCODE=0
```

构建产物哈希（后续用于证明回滚逐字节还原）：`index-CbaVe8lJ.js` / `export-Bhk-eR2Q.js`。

### 1.4 相邻路径

```powershell
$env:STRADITIZE_E2E_PORT='22952'; npx playwright test export contract --reporter=list
npm run test:e2e:typecheck
```

`.scratch/verify/adjacent.log` 原文摘要：

```
Running 7 tests using 1 worker
  ✓ 1 contract.spec.ts:212 › 加载态：getDiagramData 覆盖 DiagramData / DepthCalibration / DataRoi / Column 的必填字段 (6.3s)
  ✓ 2 contract.spec.ts:243 › 候选几何：扫描出的 LineCandidate 覆盖其必填字段 (5.9s)
  ✓ 3 contract.spec.ts:259 › 零状态：键集与加载态完全一致（遗留缺陷 ① 的回归钉子） (5.8s)
  ✓ 4 contract.spec.ts:279 › 已知别名表不得过期 (5.6s)
  ✓ 5 contract.spec.ts:288 › 设计豁免表不得过期 (5.4s)
  ✓ 6 export-ensemble-empty.spec.ts:20 › 没有集成表时，勾选框禁用且理由可见 (7.2s)
  ✓ 7 export.spec.ts:177 › data.csv 严格跟随主 ROI…就绪清单与面板显示一致 (5.9s)

  7 passed (51.7s)
ADJACENT_EXITCODE=0

npm notice run tsc -p tsconfig.e2e.json
TYPECHECK_EXITCODE=0
```

即「导出」这条仍然走 `export.tar` 的相邻路径未被 T-05 改动破坏。

### 1.5 我自造的金丝雀（红）

**操作**：仅把 `ProjectManager.ts:401` 的 `'project.save'` 改回 `'export.tar'`（一处，字面量级回退），
重新 `npm run build` + 同一条 playwright 命令。

**先证明改动真的进了产物**：构建哈希从 `index-CbaVe8lJ.js` / `export-Bhk-eR2Q.js`
变为 `index-Ist5EHNR.js` / `export-CA3qE2cx.js` —— 不是"忘了重编译"的假对照。

日志全文：`.scratch/verify/T-05-canary-red.log`。关键原文：

```
Running 2 tests using 1 worker

  ✘  1 [msedge] › e2e\project-roundtrip.spec.ts:222:3 › T-05 保存项目 → 打开项目 往返 › 「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原 (40.3s)
  ✓  2 [msedge] › e2e\project-roundtrip.spec.ts:314:3 › T-05 负向对照… (7.5s)

  1) … › 「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原

    Error: 打开项目包后，后端 ROI 名必须恢复为保存时的名字
    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Array [
    -   "往返测试A",
    +   "往返测试B",
      ]

    Call Log:
    - Timeout 30000ms exceeded while waiting on the predicate

      252 |         timeout: 30_000,
      253 |       })
    > 254 |       .toEqual([ROI_SAVED]);

    Error: 出现了未预期的用户通知（共 1 条）
      1. 未在 .tar 归档中找到项目数据 JSON 文件。
      > 162 |       ).toEqual([]);

  1 failed
    [msedge] › e2e\project-roundtrip.spec.ts:222:3 › …
  1 passed (1.1m)

TEST_EXITCODE=1
```

判读：红灯落在 `project-roundtrip.spec.ts:254` 的 **往返还原断言**上（ROI 名未恢复），
并伴随 `fixtures.ts:162` 的**意外用户通知**（同一根因：打开时找不到工程 JSON）。
不是语法错、不是构建错、不是端口/超时类的无关红。
另外注意：`✘` 用时 40.3 s = 30 s 轮询超时后的语义失败，符合预期。

### 1.6 回滚后重跑（绿），并证明回滚是逐字节还原

回滚方式按要求**不用** `git checkout --`，而是再编辑一次把 `'export.tar'` 改回 `'project.save'`。

- 源码复核：`Select-String` 结果只剩 `const res = await this.rpcClient.call<any, any>('project.save');`，
  其余两处文案亦为 `project.save`（`export.tar` 仅出现在注释里作为历史说明）。
- **构建产物哈希回到 `index-CbaVe8lJ.js` / `export-Bhk-eR2Q.js`**，与 §1.3 首次绿完全一致
  ⇒ 回滚把代码恢复到与修复态逐字节同一输入，不存在"残留半改"。

重跑原文（`.scratch/verify/T-05-green.log`）：

```
  ✓  1 … 「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原 (9.5s)
  ✓  2 … 不含 straditize.json 的 tar：明确报错、后端状态零变化（不静默、不半载入） (7.0s)

  2 passed (25.6s)
TEST_EXITCODE=0
```

### 1.7 我自己的产物核对（不依赖 spec 自述）

绿色运行后 Playwright 会清空 `outputDir`，`saved-project.tar` 不留存，故我另起 22953 端口的
e2e 后端直连 `project.save` 取一次真实产物（`.scratch/verify/projectsave-probe.log`）：

```
reset: {"jsonrpc": "2.0", "result": {"ok": true}, "id": 1}
project.save RESULT KEYS: ['tar_base64', 'size', 'success', 'data_csv_placeholder', 'data_csv_placeholder_reason']
TAR BYTES: 122880
MEMBER COUNT: 6
   member: manifest.json
   member: straditize.json
   member: image/original.png
   member: data.csv
   member: plot_strat.R
   member: README.txt
HAS_STRADITIZE_JSON: True
```

（零状态无 ROI，故无 `data/<roi>.csv`；有 ROI 时为 7 个成员，与 `.scratch/triage/F-05/project-save-list.txt` 一致。）

---

## 2 判据层证据（四问）

### Q1 这条用例凭什么区分错误实现与正确实现？哪个断言先红？

先说产品事实（我从代码自己核对的，不看 Fixer）：

- `saveProjectFile` 的出口决定产物的**成员集合**：`project.save` 含 `straditize.json`，
  `export.tar` 只有 `manifest.json`（`.scratch/triage/F-05/tar-list.txt`）。
- `openProjectFile`（`ProjectManager.ts:666-687`）遍历 tar，只把
  `straditize.json` / `wpj.json` / 「任何不是 `manifest.json`、`info.json` 的 `.json`」当成项目数据；
  找不到就走 `ProjectManager.ts:715` 的 `notifyError('未在 .tar 归档中找到项目数据 JSON 文件。')`，
  **并且一次 `project.load` 都不发**（同步分支，`jsonContent` 为 null）。
- 所以错误实现的唯一可观测后果是：**后端状态完全不动**，用户只看到一条红字提示。

**第一个红的断言是 `project-roundtrip.spec.ts:254`**（金丝雀实测）：

```
expect.poll(() => roiNames(page), { timeout: 30_000 }).toEqual([ROI_SAVED])
→ Expected ["往返测试A"] / Received ["往返测试B"]
```

它读的是后端 `rois[].name`，而这个值在打开前已被故意改成 `往返测试B`；错误实现下 `project.load`
没发，后端自然还是 `往返测试B`。**期望值来自"保存那一刻"，观测值来自"打开之后的后端"**，
两者只有在工程包真的被载入时才可能相等 —— 对象同一（同一个后端字段、同一个语义）。

同时（同一根因的第二条红）`fixtures.ts:162` 捕获到 1 条未被豁免的通知
`未在 .tar 归档中找到项目数据 JSON 文件。` —— 这条是**用户症状**的直接钉子。

### Q2 有没有可能它在错误实现上也绿？逐条断言过一遍

逐条问"在 `export.tar` 实现上这条会怎样"：

| # | 断言 | 错误实现上的结果 | 对 T-05 有判别力？ |
| --- | --- | --- | --- |
| 1 | `columnsBeforeSave > 0` | 通过（前置守卫） | 否（**设计如此**，防止"列数还原"是空断言） |
| 2 | 弄脏后 `top_px === 700` | 通过（前置守卫） | 否（**设计如此**，防止还原断言恒真） |
| 3 | `roiNames == [ROI_SAVED]` | **失败**（实测先红） | **是** |
| 4 | `isCalibrated === true` | **通过**（弄脏标定也是已标定） | **否** |
| 5 | 标定五字段 `== SAVED_CALIB` | **失败**（实收 700/0/1100/50） | **是** |
| 6 | `columns.length == columnsBeforeSave` | **通过**（后端没动，列数自然不变） | **否**（只抓"半载入丢列"） |
| 7 | tar 成员含 `straditize.json` | **失败**（实收 manifest.png/csv/R/README） | **是** |
| 8 | 无 `未在 .tar 归档中找到项目数据 JSON 文件` 通知 | **失败** | **是** |

结论：**不会在错误实现上全绿** —— 有 4 条独立判别点（#3 #5 #7 #8），且 #3 是最先触发的那条。
但必须如实登记：#4 与 #6 对 T-05 **零判别力**，它们钉的是"半载入 / 丢列"这类别的失效模式。
整条用例的强度来自 #3/#5/#7/#8，不来自 #4/#6。这不是放水（没有用 `toBeTruthy()` 之类替代具体值），
但读代码的人容易把 8 条断言误当成 8 倍强度，值得在注释里标一句。

另外一条重要的诚实记录：**负向对照用例在金丝雀下仍然是绿的**（见 §1.5 的 `✓ 2`）。
它测的是"打开端遇到坏包时不许半载入"，与"保存端走了哪个出口"正交 ——
所以它对 T-05 本身没有判别力，T-05 的全部判别力由正向往返用例承载。这一点写清了就不构成缺陷。

### Q3「弄脏现场」是否真的让断言有判别力？

保存时的现场与弄脏后的现场是两组**互不重叠**的值：

| 量 | 保存时 | 弄脏后 |
| --- | --- | --- |
| ROI 名 | `往返测试A` | `往返测试B` |
| top_px / top_val | 611 / 7.5 | 700 / 0 |
| bottom_px / bottom_val | 1198 / 42.5 | 1100 / 50 |
| unit | `m` | `m`（这一项**没有区分度**，见下） |

且有前置断言 `expect((await backendCal(page)).top_px).toBe(DIRTY_CALIB.topPx)`（`spec:241`）
**证明弄脏真的写进了后端**（不是只改了 DOM）。所以"打开后回到 611 / 7.5 / 1198 / 42.5 / 往返测试A"
只能由 tar 载入产生 —— 从内存里"恢复"只会恢复成弄脏值，断言会失败。判别力成立。

两点如实保留：

1. `unit` 在两组里都是 `m`，这一项对判别力无贡献（在五字段 equality 里是搭车的，不影响整体强度）。
2. 弄脏只覆盖 ROI 名 + Y 标定，**没有**弄脏列定义（列数在保存/弄脏两态相同）。
   因此 §Q2 的 #6（列数还原）在本次构造下**天然恒等**，这条断言在当前用例里近乎摆设；
   要让它有判别力，需要在保存后删除/重检出列。这是可改进点，不是错误。

### Q4 负向对照是否真的证明「后端零变化」？读的是什么量？

读的量：`straditize.getDiagramData` 的
`{ rois[].name, columns.length, primaryRoiId, calibration{isCalibrated, top_px, top_cm, bottom_px, bottom_cm, unit} }`
（`spec:337-350` 的 `stateOf`）。**是后端权威载荷，不是前端镜像、不是 DOM。**

三重论证：

1. `before` = 保存后（未弄脏）快照；`dirtied` = 改名后快照，并有 `expect(dirtied.roiNames).toEqual([ROI_DIRTY])`
   证明"零变化"不是因为本来就没变（**假对照自查通过**）。
2. `after`（打开坏包之后）与 `dirtied` **逐字段深等**；同时 `after` **不等于** `before`，
   排除"悄悄回退成保存时状态"这种半载入。
3. 用户可见通道：`notices` 里该条提示恰好 1 条（`toBe(1)`，既不多也不少）；
   `telemetry.rpcErrors` 为空 —— 证明这条路径上**没有失败的后端 RPC 被静默吞掉**，
   错误由客户端同步分支明确说出（`ProjectManager.ts:715`）。

**范围声明（不夸大）**：这里的"零变化"指上述 diagram 载荷字段零变化。它**不**覆盖
撤销栈深度、原始图片字节、清理层几何等未被 `getDiagramData` 暴露的量。
但对照缺陷语义（"静默吞掉 / 半载入"）而言，选这几个量是充分的：任何一次真实 `project.load`
都会改变 `rois` 或 `calibration`。

---

## 3 次对象核验（诊断记录器 + 两行挂载）

我按 `.scratch/diag/README.md` 复跑（自起 22970 零状态后端 + 22971 vite dev），
再用**自己写的** zip 检查器验证内容（自述脚本只断言条目名/数量/screenshot/console，
**不断言脱敏**，所以脱敏必须由我独立验证）。

### 3.1 默认关闭（无 `?diag=1`）

`node .scratch/diag/verify-off.mjs` → `VERIFYOFF_EXITCODE=0`，原文：

```json
{
  "state": {
    "hasHandle": true,
    "enabled": false,
    "exportIsFunction": true,
    "statsPresent": false,
    "fetchPatched": false,
    "canvasReady": true
  },
  "exportThrows": "page.evaluate: Error: 诊断记录器未启用：请用 ?diag=1 打开页面，或执行 localStorage.setItem('straditize.diag','1') 后刷新",
  "pageErrors": []
}
[OK] 默认关闭：无包装、无缓冲、export 明确报错
```

对照源码 `diagRecorder.ts:371-381`：未启用时**立即 return**（不包装 fetch、不建缓冲），
只挂一个 `{enabled:false, export(){throw}}` 的门面。行为与声明一致。
"`__straditizeDiag` 不存在"这一说法准确讲是"存在但 `enabled===false` 且 `fetch` 未被包装"——两种表述都满足验收意图。

### 3.2 `?diag=1` 导出 7 条目（我自己解压核对）

`node .scratch/diag/verify.mjs` → `VERIFY_EXITCODE=0`；
我的独立检查器（`.scratch/verify/inspect_zip.py`）对最新 zip：

```
ZIP: bug-report-2026-11-09T10-36-10-071.zip 157789 bytes
ENTRY_COUNT: 7
ENTRIES: ['actions.jsonl', 'rpc.jsonl', 'console.jsonl', 'state-before.json', 'state-after.json', 'environment.json', 'screenshot.png']
  SIZE actions.jsonl 8485 / rpc.jsonl 6601 / console.jsonl 173 / state-before.json 569
  SIZE state-after.json 771 / environment.json 2045 / screenshot.png 138395
INSPECT_OK
```

### 3.3 `rpc.jsonl` 有真实 method 与耗时

我从 zip 里逐行解析（`.scratch/verify/rpc-dump.log`），9 条记录，字段
`{seq, timestamp, stage, rpc{method, params, code, durationMs}, stateBefore, stateAfter, consoleError}`：

```
seq=1  system.ping                          code=0  durationMs=14.7
seq=2  straditize.getDiagramData            code=0  durationMs=6.9
seq=3  ocr.getTaxaDict                      code=0  durationMs=131.9
seq=8  core.loadImage                       code=0  durationMs=1604.6
seq=9  image.detectDeskew                   code=0  durationMs=79.4
seq=14 roi.update                           code=0  durationMs=24
seq=16 algorithm.applyLineRemoval           code=0  durationMs=1611.3
seq=19 diag.redactionProbe                  code=-32601 durationMs=14.2
seq=21 straditize.getDiagramData            code=0  durationMs=10.8
```

method 是真实后端方法名（含负数错误码 `-32601` 的原样透传），耗时是非整数的实测毫秒，
不是伪造常量。

### 3.4 参数脱敏 / 不泄漏图片正文

同一条 `core.loadImage` 与脱敏探针的 `params` 原文：

```json
core.loadImage   {"file_name":"<redacted:hoya-del-castillo.png>","width":2339,"height":1654,"page_number":1,"image_data":"<redacted:binary(95298)>"}
diag.redactionProbe {"path":"<redacted:hoya.png>","file":"<redacted:pollen-counts.xlsx>","dir":"<redacted:roi>",
                     "token":"<redacted>","keep":"this-visible-value","note":"xxxx…(truncated)"}
```

我对整包文本做的机械检查（不靠肉眼）：

```
REDACTION_CHECKS: {"no_token_literal": true, "no_abs_path_literal": true, "has_redacted_marker": true,
                   "no_long_base64": true, "no_data_image_uri": true, "keep_value_visible": true}
```

即：无 `abc123secret` 字面量、无 `C:\Users\chmzs` 绝对路径、含有 `<redacted:` 标记、
**整包不含 ≥800 字符的 base64 串**、不含 `data:image/` URI、白名单字段 `keep` 原样保留。
`state-after.json` 里图片只留 `"srcBase": "current"`，无 data URI、无查询串。

**次对象结论：成立。** 默认关闭、`?diag=1` 七条目、rpc 真实方法与耗时、二进制正文与路径/凭据脱敏，
四项均由我在自己的进程与自己写的检查器上复现，不依赖 `.scratch/diag/` 的自述结论。

---

## 4 新发现的问题（只报不改）

1. **`openProjectFile` 的 JSON 识别面过宽（相邻脆弱点，非本轮缺陷）。**
   `ProjectManager.ts:671` 的条件是「任何 `.json`，只要不是 `manifest.json` / `info.json`」。
   数据包今天是靠"只有 manifest.json"这一个偶然事实才报"未找到项目数据 JSON"。
   一旦导出包多出任何别的 `.json`（`metadata.json`、`stats.json`…），用户会看到
   `解包成功，但未在 JSON 中找到合法的 columns 或 calibration 字段`，
   归因从"这不是工程包"漂移到"这个工程包坏了"；本 spec 的负向对照也会因此失效。
   建议（未改）：把接受面收窄为显式白名单 `straditize.json` / `wpj.json`。

2. **两条断言对 T-05 无判别力，建议在注释里标明。**
   `spec:257` 的 `isCalibrated === true` 与 `spec:281` 的列数相等，在 `export.tar` 实现上同样为真
   （金丝雀已实证）。它们抓的是"半载入/丢列"，与该用例标题承诺的"往返还原"不是同一件事。
   另：`SAVED_CALIB.unit` 与 `DIRTY_CALIB.unit` 都是 `m`，该字段对判别力无贡献；
   列数在"保存后"与"弄脏后"相同，使"列数还原"在当前构造下恒等。
   若要让列数这条真正有判别力，需在保存后删除或重检出列。

3. **注释里的工程包成员清单不全。**
   `ProjectManager.ts` 新注释列出 6 个成员，实际是 6（零状态）/ 7（有 ROI，多 `data/<roi>.csv`
   与 `data.csv.PLACEHOLDER.md`）。纯文档不精确，不影响行为。

4. **测试产物不留存，削弱事后可复核性。**
   绿色运行后 Playwright 清理 `test-results-22952/`，`saved-project.tar` 与 `no-project-json.tar`
   都不落盘，事后无法回看"保存出来的到底是什么包"（我因此改用直连 `project.save` 复核）。
   建议（未改）：把产物写到 `outputDir` 之外的固定目录，或在 spec 里留一条 `attach`。

---

## 5 附：本次复核用到的我自己的文件

| 文件 | 内容 |
| --- | --- |
| `.scratch/verify/T-05-green.log` | 修复实现上 2 passed 原文（含 BUILD/TEST exit code） |
| `.scratch/verify/T-05-canary-red.log` | 金丝雀 1 failed / 1 passed 原文（红在 spec:254） |
| `.scratch/verify/adjacent.log` | `export contract` 7 passed + typecheck exit 0 |
| `.scratch/verify/diag-rerun.log` | verify.mjs / verify-off.mjs 复跑输出 |
| `.scratch/verify/inspect_zip.py` / `diag-inspect.log` | 我写的 zip 独立检查器与其输出 |
| `.scratch/verify/dump_rpc.py` / `rpc-dump.log` | rpc.jsonl 逐行 dump（method/durationMs/params） |
| `.scratch/verify/probe_projectsave.py` / `projectsave-probe.log` | 直连 `project.save` 取真实工程包成员清单 |
| `.scratch/verify/run-roundtrip.ps1` / `run-adjacent.ps1` / `run-diag.ps1` | 触发脚本（避免长命令） |
