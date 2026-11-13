# 独立复核（第三轮）：T-04 撤销不得否定 Y 标定 / T-01 页脚缩放同源

- 复核人：verifier（未采信 Fixer 的 `.scratch/fix/T-04-*`，仅当线索读）
- 日期：2026-11-09
- 仓库：`E:\software_dev\straditize`
- 端口：A = 22955，B = 22956；每次运行前均 `npm run build`（`tsc && vite build`）
- 触发脚本：`.scratch/verify/run3.ps1`（单 spec）/ `run-adj3.ps1`（多 spec + typecheck）

---

## 0 结论

| 对象 | 结论 |
| --- | --- |
| **A：T-04 撤销不得否定后端已确认的 Y 标定** | **有效门禁** |
| **B：T-01 页脚缩放读数与徽标同源** | **有效门禁**（附一条措辞需收窄的越权声明） |

两个对象都由我自己造的金丝雀验证过"错误实现上必红、且红在缺陷本体"：

- A 金丝雀①（恢复整体回写 `data.calibration`）→ 正向用例红在 `undo-calibration.spec.ts:232`
  「后端 isCalibrated=true 时，步骤 3 面板不得显示『尚未完成 Y 轴标定』」，且**先越过了**
  `:225` 的"后端标定逐值不变"断言 —— 说明红的是前端镜像否定后端真值，不是后端被改。
- A 金丝雀②（`YCalibPanel` 恒 `isCalibrated=true`，即"假修复"）→ **负向对照**红在 `:359`
  「未标定就必须如实显示未标定」，实收「✓ Y 轴标定生效中」，正向用例仍绿。
- B 金丝雀（删掉 `ToolbarBridge.syncZoomReadouts()` 里的 `p.updateFooter()`）→ 红在 `footer-zoom.spec.ts:87`
  「点『1:1』后页脚缩放必须也是 100%」，`Expected "100%" / Received "44%"`。

两次改动都已逐字节还原（见 §1.6 的构建哈希证据）。

---

## 1 机械层证据

### 1.1 改动范围

`git status --short` 中的相关项：

```
 M frontend/src/main.ts
 M frontend/src/services/CleanupManager.ts
 M frontend/src/services/ToolbarBridge.ts
?? frontend/e2e/undo-calibration.spec.ts
?? frontend/e2e/footer-zoom.spec.ts
```

A 的产品改动只有 `CleanupManager.ts::applyHistorySnapshot`：

```diff
     if (snapshot.calibration) {
-      this.canvasComponent.data.calibration = { ...snapshot.calibration };
+      this.canvasComponent.data.calibration = {
+        ...this.canvasComponent.data.calibration,
+        depthInterval: snapshot.calibration.depthInterval,
+        depthGridEnabled: snapshot.calibration.depthGridEnabled,
+      };
     }
```

B 的产品改动两处同构：`ToolbarBridge.ts:52-55` 新增 `syncZoomReadouts()` 并把 4 个回调
（`onFit` / `onReset100` / `onZoomIn` / `onZoomOut`）改为调用它；`main.ts:634-639` 同构一份用于
`wheel` 监听与初始 `fitToScreen` 后的刷新。

机制核对（我自己读代码确认，不看 Fixer 说明）：
`CoordinateSystem.ts:113` `if (!cal || !cal.isCalibrated) return null;` —— 镜像里 `isCalibrated`
被打回 false 后，面板 `YCalibPanel.ts:12-13`（`Boolean(bounds)`）、Ratio（`:26`）、
深度换算（同一 `calibrationBounds`）会一起判"未标定"。与缺陷现象一致。

B 的取值链：徽标 `Toolbar.ts:132-137` 写 `Math.round(scale * 100)%`；
页脚 `app/footer.ts:32` 写 `Math.round(canvasComponent.viewport.scale * 100)%`。
**两处各自读 `viewport.scale`，互不抄写、不读任何常量。**

### 1.2 A 修复实现上跑（绿）

```
[WebServer] [e2e] backend ready on http://127.0.0.1:22955/
Running 2 tests using 1 worker
  ✓  1 … 拖过 ROI → 完成标定 → 撤销：后端标定逐值不变，面板仍须认定已标定 (8.5s)
  ✓  2 … 负向对照：未标定的会话里撤销，面板仍须如实显示未标定 (7.0s)

  2 passed (26.1s)
TEST_EXITCODE=0
```

构建产物：`dist/assets/index-Dn06JWA-.js`。日志：`.scratch/verify/T-04-green.log`。

### 1.3 A 金丝雀①：恢复整体回写 `data.calibration`（红）

我自己的造法（与 Fixer 无关）：把 `applyHistorySnapshot` 改回
`this.canvasComponent.data.calibration = { ...snapshot.calibration };`，重建后同命令跑。

构建哈希 `index-Dn06JWA-.js → index-D4jhkjhy.js`（证明改动真的进了产物，不是忘编译）。

```
  ✘  1 … 拖过 ROI → 完成标定 → 撤销：后端标定逐值不变，面板仍须认定已标定 (19.3s)
  ✓  2 … 负向对照 (7.7s)

  1) …
    Error: 后端 isCalibrated=true 时，步骤 3 面板不得显示「尚未完成 Y 轴标定」
    expect(locator).not.toContainText(expected) failed
    Received string: " … 尚未完成 Y 轴标定 … Ratio: -- … "
    > 232 |     ).not.toContainText('尚未完成 Y 轴标定');

  1 failed
  1 passed (38.7s)
TEST_EXITCODE=1
```

**归因关键**：失败点在 `:232`，即它**已经跑过** `:225` 的
`expect(await backendCal(page)).toEqual(calibrated)` —— 后端标定在这一刻仍是
`true / 556 / 0 / 1320 / 1500 / cm`，红的是前端面板否定后端。这正是 T-04 本体，
不是"后端被改"、不是语法/构建/超时。日志：`.scratch/verify/T-04-canary1-red.log`。

### 1.4 A 金丝雀②：`YCalibPanel` 恒 `isCalibrated = true`（负向对照红）

改法：`frontend/src/components/steps/YCalibPanel.ts:13`
`const isCalibrated = Boolean(bounds);` → `const isCalibrated = true;`
（最小化实现"永远显示已标定"这一假修复；`ratioStr` 仍走 `bounds`，所以只有状态条被伪造。）

构建哈希 `→ index-BGpSXQwq.js`。

```
  ✓  1 …（正向用例仍绿，因为它本来就期望"生效中"）
  ✘  2 … 负向对照：未标定的会话里撤销，面板仍须如实显示未标定 (17.8s)

    Error: 未标定就必须如实显示未标定
    expect(locator).toContainText(expected) failed
    - 尚未完成 Y 轴标定
    +       ✓ Y 轴标定生效中
    > 359 |     await expect(panel, '未标定就必须如实显示未标定').toContainText('尚未完成 Y 轴标定');

  1 failed
  1 passed (37.7s)
TEST_EXITCODE=1
```

即：**负向对照确实能识别"把修复写成永远显示已标定"**。日志：`.scratch/verify/T-04-canary2-negative-red.log`。

### 1.5 A 判据敏感性实测：新容差是否仍"对参数敏感"

Lead 特别要求核实 Fixer 声称的"修掉了一处 <1 px 量化容差的敏感判据"。
我用一个**测量探针**而不是口头核验：把 `undo-calibration.spec.ts:253`
`const quantTol = 2 * pxToCm;` 临时改为 `0 * pxToCm`，让断言把实测值打印出来（产品代码不动、`dist` 不重建）。

```
Error: 两点深度差必须与线性模型一致（模型差 750.00 cm，实测差 751.87 cm）
expect(received).toBeLessThanOrEqual(expected)
Expected: <= 0
Received:    1.8674040000000787

  > 294 |     ).toBeLessThanOrEqual(quantTol);
```

换算：1 px = 1.9634 cm，**实测差分误差 = 1.8674 cm ≈ 0.951 px**。结论三条：

1. 旧判据 `expectedDepth - 1`（1 cm）确实**低于噪声底**（实测 1.87 cm），必红 ——
   Fixer 的"过度敏感"说法被实测**证实**，不是托词。
2. 新判据 `quantTol = 2 px = 3.9268 cm`，实测 1.867 cm ⇒ **余量 2.1×**。
   而且 2 px 是"两点各自量化误差之和"的**最坏界**（1 px + 1 px），不是拟合出来的数。
3. 主判据（`L290-294`）是**结构关系**而非参数量：`|两行深度差 − 线性模型差| ≤ 容差`，
   信号 750 cm、误差 1.87 cm（0.25%）—— 常量读数、半量程读数、翻号都会红
   （金丝雀①里这条没机会跑到，因为它前面的 `depthAt` 轮询在 `--` 上就先超时红了）。

**判定：可当门禁。** 唯一保留意见：余量 2 倍不算宽，建议把 `2` 提成显式常量并在注释里
写明"实测 0.951 px"（只报不改，见 §4-3）。

### 1.6 还原（两次金丝雀都改回，未用 `git checkout --`）

还原后重建，构建哈希 **回到 `index-Dn06JWA-.js`**，与 §1.2 首次绿完全一致 ⇒ 逐字节回到修复态。
重跑结果：

```
  ✓  1 … (8.2s)
  ✓  2 … (7.7s)

  2 passed (26.3s)
TEST_EXITCODE=0
```

源码终态核对（`.scratch/verify/final-state.txt`）：

```
CleanupManager: 188 depthInterval: snapshot.calibration.depthInterval
                189 depthGridEnabled: snapshot.calibration.depthGridEnabled
YCalibPanel  :  13 const isCalibrated = Boolean(bounds);
spec         : 253 const quantTol = 2 * pxToCm;
git diff -- frontend/src/components/steps/YCalibPanel.ts   → 空（该文件已完全回到 HEAD）
```

### 1.7 A 相邻路径

```
npx playwright test step3-ycalib workflow-panels project-roundtrip --reporter=list   (22955)
```

```
Running 12 tests using 1 worker
  ✓ 1-2  project-roundtrip (T-05)              10.1s / 6.9s
  ✓ 3-7  step3-ycalib 5 条                      6.4s / 5.0s / 5.2s / 4.9s / 4.9s
  ✓ 8-12 workflow-panels 5 条                   7.2s / 7.0s / 8.1s / 4.9s / 5.0s

  12 passed (1.4m)
TEST_EXITCODE=0
```

`npm run test:e2e:typecheck` → `TYPECHECK_EXITCODE=0`。日志：`.scratch/verify/T-04-adjacent2.log`。

### 1.8 B 修复实现上跑（绿）

```
Running 1 test using 1 worker
  ✓  1 [msedge] › e2e\footer-zoom.spec.ts:65:3 › 载图 / 1:1 / 适应 / 滚轮四条路径下，徽标与页脚缩放必须始终同值且形状合法 (6.7s)

  1 passed (15.9s)
TEST_EXITCODE=0
```

日志：`.scratch/verify/T-01-green.log`。

### 1.9 B 金丝雀：删掉 `updateFooter()` 调用（红）

改法：`ToolbarBridge.ts:52-55` 的 `syncZoomReadouts` 只保留 `updateScale`，删掉 `p.updateFooter();`。
构建哈希 `index-Dn06JWA-.js → index-Dvhiz28S.js`。

```
  ✘  1 … (16.9s)

  1) …
    Error: 点「1:1」后页脚缩放必须也是 100%（不能冻在旧值）
    expect(received).toBe(expected) // Object.is equality
    Expected: "100%"
    Received: "44%"
    > 87 |       .toBe('100%');

  1 failed
TEST_EXITCODE=1
```

这正是 T-01 的原症状（徽标跟着走、页脚冻在旧值）：**44% 是载图后的适应比例，页脚停在这里**。
日志：`.scratch/verify/T-01-canary-red.log`。

### 1.10 B 还原后重跑（绿）

构建哈希回到 `index-Dn06JWA-.js`，重跑 `1 passed (17.6s)`、`TEST_EXITCODE=0`
（`.scratch/verify/T-01-green2.log`）。

### 1.11 B 相邻路径

```
npx playwright test issue8-fit-to-screen ui-layout --reporter=list   (22956)
Running 8 tests using 1 worker
  ✓ C1 容器 1140×943 下【适应屏幕】：scale 与公式一致、panX 使图居中 (6.6s)
  ✓ C2 容器变大后无需按 F，视口自动重新适配 (6.6s)
  ✓ C3 折叠抽屉同样触发重新适配 (6.6s)
  ✓ C4 用户手动缩放后，容器变化不得把视口打回 fit (7.4s)
  ✓ ui-layout 1366×768 / 1920×1080 / 1280×720 三条 (4.6s / 5.9s / 6.0s)
  ✓ 底图滤镜入口下拉真的存在 (5.6s)

  8 passed (59.5s)
TEST_EXITCODE=0
TYPECHECK_EXITCODE=0
```

日志：`.scratch/verify/T-01-adjacent.log`。

---

## 2 判据层证据 —— 对象 A

### 2.1 逐条断言判别力（正向用例）

| # | 位置 | 断言 | 在错误实现上 | 对 T-04 有判别力？ |
| --- | --- | --- | --- | --- |
| 1 | `:165` | 基线 `isCalibrated === false` | 通过 | 否（前置守卫：保证历史栈里存在"标定前"快照） |
| 2 | `:174-179` | 拖拽后后端 `ylim[1]` 变化 | 通过 | 否（前置守卫：保证撤销栈里真的压了一条快照） |
| 3 | `:185-190` | 提交后后端 `isCalibrated === true` | 通过 | 否（前置守卫） |
| 4 | `:193-200` | 后端四端点 `toMatchObject` 用户输入 | 通过 | 否（前置守卫） |
| 5 | `:201` | `yCalibMarks.length === 2` | 通过 | 否（前置守卫） |
| 6 | `:205` | `#btn-undo` `toBeEnabled` | 通过 | 否（前置守卫） |
| 7 | `:211-216` | 撤销后 `yCalibMarks.length === 0` | 通过 | 否（"撤销已执行"的机械证据） |
| 8 | `:217` | 后端 `ylim` 未被撤销改写 | 通过 | **否**（守"把撤销做成向后端写回"这种错修） |
| 9 | `:222-225` | 后端 calibration 逐值 `toEqual(calibrated)` | 通过 | **否**（错误实现里后端本来就没变；守"错修成清后端"） |
| 10 | `:229-232` | 面板 `not.toContainText('尚未完成 Y 轴标定')` | **失败** | **是**（金丝雀①红在此） |
| 11 | `:233` | 面板 `toContainText('Y 轴标定生效中')` | **失败** | **是** |
| 12 | `:236-239` | `#lbl-ycal-ratio` `toHaveText(expectedRatio(calibrated))` | **失败**（`--`） | **是** |
| 13 | `:261-282` | 悬停时页脚深度必须变成有限数值 | **失败**（`--` → 轮询超时） | **是** |
| 14 | `:290-294` | 两行深度差 == 线性模型差（±2 px） | **失败** | **是** |
| 15 | `:295-302` | 每点深度 == 模型（±2 px） | **失败** | **是** |
| 16 | `:303-306` | 页脚深度含 `cm` | 失败（`--`） | 弱（形状） |

要点两条：

- **判别力来自 10–15**，共 6 条互相独立的观测面（状态条文案 / Ratio / 深度读数的存在性 /
  深度读数的线性关系）。**#1–#9 全是前置守卫或"守另一种错修"**，在错误实现上照样通过。
- `:222-225` 那句"先断后端"的真实作用不是判别力，而是**失败信息排序**（保证失败信息停在
  "面板否定后端"而不是退化成"文案 bug"）。spec 头部注释的说法是对的，但容易被读成
  "后端断言是判据" —— 建议注释里补一句"此条在缺陷实现上恒真，作用是错误归因而非判别"。

### 2.2 逐条断言判别力（负向对照）

| # | 位置 | 断言 | 作用 |
| --- | --- | --- | --- |
| 1 | `:321` | 干净会话 `isCalibrated === false` | 前置守卫 |
| 2 | `:326-331` | 拖拽真的落库 | **假对照自查**（证明"有事可撤"） |
| 3 | `:333` | undo 可用 | 前置守卫 |
| 4 | `:338-343` | 撤销后后端 `ylim` 回到拖前 | **假对照自查**（证明撤销真的发生了，否则面板断言恒真） |
| 5 | `:344` | `marksBefore === 0` | 形状 |
| 6 | `:347-350` | 后端仍未标定 | 前提 |
| 7 | `:356` | 先 `gotoStage(3)` 再读面板 | 修"断言查错对象"（撤销发生在步骤 2，`data-step="3"` 当时未挂载） |
| 8 | `:359` | 面板 `toContainText('尚未完成 Y 轴标定')` | **是**（金丝雀②红在此） |
| 9 | `:360-363` | `#lbl-ycal-ratio` `toHaveText('--')` | **是** |

负向对照的假对照自查是到位的：`:338-343` 先把"撤销确实把 ROI 退回"钉住，
否则"面板说未标定"可能只是因为撤销是空操作。我实测它在金丝雀②下确实独立变红，
在正向金丝雀（①）下不红 —— 与预期一致。

### 2.3 这条用例凭什么能区分"修对了"与"错误实现"

一句话：**它把"后端真值"与"前端三个消费者（面板状态条 / Ratio / 页脚深度）"放在同一次撤销之后同时读出**，
并要求两者不冲突。

- 错误实现：`applyHistorySnapshot` 把 `isCalibrated=false` 的旧快照写回镜像 →
  `calibrationBounds` 返回 null → 三个消费者一起否定后端。而**后端一次 RPC 都没收到**
  （缺陷背景已由 `.scratch/triage/F-04/observations.md` 的 undo RPC 记录确认：
  只有 `roi.update` + `applyLineRemoval`，没有 `calibrateAxes` 清除）。
- 正确实现：撤销只回写前端自有的显示偏好（`depthInterval` / `depthGridEnabled`），
  端点与 `isCalibrated` 不动，三个消费者继续读后端真值。

而 #10–#15 恰好覆盖了这三个消费者，且各自读后端（面板读 `diagramData` 派生的 `bounds`、
Ratio 由后端四端点算出、深度由悬停探针读页脚）。**任何"只在其中一处打补丁"的修法都会留下
另一处红**：例如只改面板文案不改 `calibrationBounds`，`Ratio` 与深度仍会是 `--`。

### 2.4 新容差是否仍"对参数敏感"

见 §1.5 实测：实测量 0.951 px，最坏界 2 px，余量 2.1×；主判据是结构关系（750 cm 上的 1.87 cm）。
**不构成"对参数敏感的量当门禁"**。保留意见只到"余量不宽，建议常量化 + 注释实测值"。

---

## 3 判据层证据 —— 对象 B

### 3.1 逐条断言

| # | 位置 | 断言 | 判别力 |
| --- | --- | --- | --- |
| 1 | `:69` | 载图后两处同值 | 弱（两处都由载图路径写过；且两处都硬编码 100% 时也过） |
| 2 | `:71` | 载图徽标形状 `/^\d+%$/` | 形状 |
| 3 | `:75-80` | 1:1 后徽标 `=== '100%'` | **绝对锚点**（把 `viewport.scale` 钉成 1） |
| 4 | `:82-87` | 1:1 后页脚 `=== '100%'` | **是**（金丝雀红在此：`100%` vs `44%`） |
| 5 | `:88` | 1:1 后两处同值 | 不变量 |
| 6 | `:92-97` | 适应后徽标 `=== initialZoom` | **绝对锚点**（ denial："适应没生效"） |
| 7 | `:98-103` | 适应后页脚 `=== initialZoom` | **是** |
| 8 | `:104` | 适应后两处同值 | 不变量 |
| 9 | `:110-115` | 滚轮后徽标 `!== initialZoom` | **绝对锚点**（唯一能抓"两处同时冻结"的一条） |
| 10 | `:116` | 滚轮后两处同值 | **是**（滚轮路径） |
| 11 | `:120-121` | 两处形状都合法 | 形状（否认退化成 `--`） |

### 3.2 是否真能在"任意缩放路径"上抓到分歧

**能抓到"两条读数之一没刷新"，抓不到"两条一起没刷新"。** 逐条说明：

产品侧有 5 条缩放入口（1:1 / 适应 / 放大 / 缩小 / 滚轮）+ 载图路径。我在代码上逐个核对了
"刷新是否成对"：

```
ToolbarBridge.ts:52-55  syncZoomReadouts = updateScale + updateFooter   ← 覆盖 onFit/onReset100/onZoomIn/onZoomOut
main.ts:634-639         syncZoomReadouts = updateScale + updateFooter   ← 覆盖 wheel + 初始 fit 后
FileLoaderService.ts:115/120、189/194、300/305    updateScale 后紧跟 updateFooter
main.ts:438/439                                   updateScale 后紧跟 updateFooter
ToolbarBridge.ts:217/222                          updateScale 后紧跟 updateFooter
```

即当前代码里**没有任何一条"只刷徽标不刷页脚"的路径**（除金丝雀人造的那一条）。
所以只要出现"只刷新一处"，两读数就会分叉，`expectSameZoom` 必然抓到。

盲点在另一侧：若某条新路径**改了 `viewport.scale` 但两个刷新都不调**，两处读数会一起停在
旧值，"同值"成立 → 不过红。要抓这种，需要"读数必须反映 `viewport.scale`"这条更强的不变量，
而本 spec 只对 1:1 / 适应 / 滚轮三条已覆盖路径做了绝对锚点。
**因此 spec 头部那句"任何『新加一条缩放路径却忘了刷新页脚』都会红"应改为"忘了刷新其中之一"**（见 §4-6）。
`onZoomIn` / `onZoomOut`（放大/缩小按钮）在本 spec 里**没有被点击**，它们仅靠代码同构保证。

### 3.3 有没有可能"两处都错却相等"（例如都读同一个写死的常量）

代码核对**排除**了常量同源：

- 徽标：`Toolbar.updateScale(scale)` → `this.currentScaleText = Math.round(scale*100)+'%'`（`Toolbar.ts:132-137`），
  入参由调用方传 `canvasComponent.viewport.scale`。
- 页脚：`footer.ts:32` → `Math.round(canvasComponent.viewport.scale * 100)+'%'`。
- 两者**不共享变量、不互相读对方 DOM、不读任何常量**（只有 `dom.ts:82` 的初始占位 `100%` 与
  `Toolbar.currentScaleText` 的初始值，都在第一次刷新后被覆盖）。

若 `viewport.scale` 本身错，测试还有三道绝对锚点兜底：1:1 必须 `100%`（钉死 scale=1）、
适应必须回到 `initialZoom`、滚轮必须改变读数。

**残留的一个退化条件**（实测可算）：若初始适应比例**恰好等于 100%**（视口足够大而图足够小），
则 `initialZoom === '100%'`，三条锚点（#3 #6 #7）会退化成恒真，只剩 #9/#10（滚轮）还能抓
"整体冻结"。当前样本（hoya 2339×1654）实测 `initialZoom = 44%`，不触发。建议加一条前置守卫
`expect(initialZoom).not.toBe('100%')`（只报不改，见 §4-7）。

---

## 4 新发现的问题（只报不改）

1. **A 的"撤销已执行"探针绑在实现细节上。**
   `undo-calibration.spec.ts:211-216` 用"`yCalibMarks` 被清零"证明撤销落地，
   而清零来自 `applyHistorySnapshot` 里的 `clearYCalibMarks()`。若将来把清标记挪到别处
   （例如渲染层统一清），这条会红，且失败信息会误导成"撤销没执行"。
   建议改成不依赖该行的观测（例如后端历史的 undo 计数，或 ROI 边界回到拖前）。

2. **A 的"撤销标定"语义缺口仍在**（Fixer 交接单 §遗留风险 2 已自陈，我确认属产品缺口）。
   前端没有"清除标定"的 RPC，`applyHistorySnapshot` 现在完全不碰端点，所以用户点撤销
   **不会**撤销标定。用例标题正确地只钉了"不得否定"，没有假装"能撤销" —— 这点没有夸大。
   但用户体验上"标定不可撤销"仍是缺陷（与 T-03 同族），需产品决策。

3. **A 的深度容差余量只有 2 倍。** 实测差分误差 0.951 px，上限 2 px。
   建议把 `2` 提成显式常量（如 `MAX_PROBE_QUANT_PX = 2`）并在注释写实测值，
   让后人一眼知道还剩多少余量，而不是看到一个来路不明的 `2 * pxToCm`。

4. **A 的 spec 头部"先断后端"理由容易被误读。** 实际效果是"失败信息排序"，
   而 `:222-225` 那条在缺陷实现上恒真。建议注释显式写"此条无判别力，作用是错误归因"。

5. **B 的 spec 头部有一处越权声明。** "任何『新加一条缩放路径却忘了刷新页脚』都会红" ——
   实际只能抓"忘刷其中一处"；"两处都忘刷"不会红（读数一起停在旧值，仍然相等）。
   建议改成"忘了刷新其中之一"，或补一条"读数必须等于 `viewport.scale` 的百分比"的断言。

6. **B 的两条缩放路径未被本 spec 覆盖。** `onZoomIn` / `onZoomOut`（放大/缩小按钮）
   没有被点击，只靠代码同构保证。若要闭合，加两行点击 + `expectSameZoom` 即可。

7. **B 的判据在"初始恰好 100%"时会部分退化。** 见 §3.3；建议加
   `expect(initialZoom).not.toBe('100%')` 作为前置守卫，把退化条件挡在门口。

---

## 5 附：本次复核产物

| 文件 | 内容 |
| --- | --- |
| `.scratch/verify/T-04-green.log` / `T-04-green2.log` | A 修复态绿（两次，构建哈希相同） |
| `.scratch/verify/T-04-canary1-red.log` | A 金丝雀①：`1 failed / 1 passed`，红在 `spec:232` |
| `.scratch/verify/T-04-canary2-negative-red.log` | A 金丝雀②：负向对照红在 `spec:359` |
| `.scratch/verify/T-04-tol-probe.log` | 容差实测探针：`Received: 1.867404`（=`0.951 px`） |
| `.scratch/verify/T-04-adjacent2.log` | 12 passed (1.4m) + typecheck 0 |
| `.scratch/verify/T-01-green.log` / `T-01-green2.log` | B 修复态绿（两次，构建哈希相同） |
| `.scratch/verify/T-01-canary-red.log` | B 金丝雀：红在 `spec:87`（`100%` vs `44%`） |
| `.scratch/verify/T-01-adjacent.log` | 8 passed (59.5s) + typecheck 0 |
| `.scratch/verify/final-state.txt` | 还原后的源码终态核对（含 `YCalibPanel` 的 `git diff` 为空） |
| `.scratch/verify/run3.ps1` / `run-adj3.ps1` / `check-final.ps1` | 触发脚本（避免长命令） |
