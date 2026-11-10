# 第二轮：修复 + 两条新门禁（2026-11-09）

> 承接 `round1-discovery-2026-11-09.md`（第 1/2 步）与 `adjudication-2026-11-09.md`（裁定）。
> 本轮做了三件事：修 T-05 并交付一条**经金丝雀验证有效**的回归门禁；落地 Discovery lane；落地开发模式诊断记录器。
> 产品决策（用户 2026-11-09 拍板）：① 保存项目 = 导出工程包；② 撤销应覆盖清理编辑；③「+ 新建 ROI」初始边界 = 空区域。

---

## 1 已修缺陷：T-05「保存项目」出口改到工程包

### 1.1 改动（4 处，1 处实质）

| 文件:行 | 改动 | 理由 |
| --- | --- | --- |
| `frontend/src/core/ProjectManager.ts:389-398` | 重写 `saveProjectFile` 注释 | 原注释写「包含 …straditize.json」，与实现相反 —— 正是误实现能长期存活的直接原因 |
| `frontend/src/core/ProjectManager.ts:401` | `rpcClient.call('export.tar')` → `('project.save')` | **唯一实质改动**；两者返回同形 `{tar_base64,size,success}`，下载链路无需改 |
| `:421` / `:423` | 报错文案与 `console.error` 前缀同步到 `project.save` | 否则报错把排查引向错误的方法名 |
| `frontend/e2e/project-roundtrip.spec.ts` | 新文件 377 行，2 条用例 | 见 §2 |

`openProjectFile`（`:637-744`）一行未改 —— 它本来就只认工程包，行为正确。

### 1.2 先红 → 后绿 → 金丝雀再红（Verifier 独立复跑，不采信 Fixer）

| 阶段 | 命令 | 输出 | exit |
| --- | --- | --- | --- |
| 旧实现 + 新用例 | build + `npx playwright test project-roundtrip`（22950/22952） | `✘ 1 … 打开项目包后，后端 ROI 名必须恢复为保存时的名字 - "往返测试A" / + "往返测试B"`，叠加意外通知 `未在 .tar 归档中找到项目数据 JSON 文件。`；`1 failed / 1 passed` | 1 |
| 修复后 | 同上 | `✓ 1 (9.5s)` / `✓ 2 (7.0s)` → `2 passed (25.6s)` | **0** |
| 金丝雀（只把 `project.save` 改回 `export.tar`） | 同上 | 红在 `spec:254` 同一条断言；构建哈希 `index-CbaVe8lJ → index-Ist5EHNR` 证明真编译进去了 | 1 |
| 回滚后再跑 | 同上 | 构建哈希逐字节回到 `index-CbaVe8lJ.js`，`2 passed (25.6s)` | 0 |

### 1.3 相邻路径（防修 A 坏 B）

| 命令 | 结果 | exit |
| --- | --- | --- |
| `npx playwright test export contract`（22952） | `7 passed (51.7s)` | 0 |
| `npm run test:e2e:typecheck` | 静默通过 | 0 |

事实核对：`export.tar` 在前端**只被 `saveProjectFile` 调用过**（其余只剩类型联合），「导出」按钮走 `export.csv/json/r`，与 tar 无关；后端 `export.tar` 仍被 `export.spec.ts` 直接覆盖。故本次改动没有削弱导出能力。

---

## 2 新增回归测试与判别力

`frontend/e2e/project-roundtrip.spec.ts`

1. `「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原`
2. `不含 straditize.json 的 tar：明确报错、后端状态零变化（不静默、不半载入）`

设计要点：保存后**故意弄脏现场**（改名 `往返测试B` + 把标定重设为 `700/0 · 1100/50`），否则「打开后不变」在保存前后恒等、零判别力。等待条件就是被断言的量（`expect.poll` 读 `straditize.getDiagramData`），无 `waitForTimeout`、无 mock、无 skip。

**判别力逐条过审（Verifier）**：8 条断言里 **4 条真有判别力**（ROI 名、标定五字段、tar 成员、无提示），最先红的是 ROI 名轮询。**另 4 条对 T-05 零判别力**（`isCalibrated===true`、列数相等、`unit` 两态同为 `m`、`data.csv` 存在）——金丝雀已实证它们在错误实现上同样为真。负向对照读的是后端 `getDiagramData` 载荷，`before ≠ dirtied`、`after ≡ dirtied` 排除了"没变"与"半载入"两种误判。

**结论：有效门禁。** 待办（已登记，未改）：给那 4 条无判别力断言加注释说明，避免后人误以为它们在守 T-05。

---

## 3 Discovery lane（已实现）

### 3.1 结构

`frontend/e2e/discovery/`

| 文件 | 作用 |
| --- | --- |
| `states.mjs` | 9 状态常量、`inferState()`（从后端权威载荷推断）、`TRANSITIONS` 动作表（前置状态 / 后继 / 危险标记 / 权重）、`legalActionIds()` |
| `actions.mjs` | 29 个动作 + 29 个 `ready_*` 可行性判定，全部走真实 UI；只读 RPC 白名单运行时强制 |
| `invariants.mjs` | 6 条机检（异常/console、活动 ROI 一致、primary/active 指向存在 ROI、列归属、删除后不复活、保存重开一致）+ 2 条观测项 + 6 条 `MANUAL_ONLY` 及不机检理由 |
| `run.mjs` | mulberry32 确定性 RNG、加权选择、逐 step 记录、产物落盘/裁剪、重放比对、`known-failures.json` 维护 |

`frontend/package.json` 新增 `discovery` / `discovery:replay`；`docs/testing-strategy.md` 追加 §10（只追加）。

### 3.2 命令与产物

```bash
# 随机探索（夜间 20 seed 的形态）
npm --prefix frontend run discovery -- --seeds=1-20 --steps=10-30 --port=22960
# 失败 seed 重放
npm --prefix frontend run discovery:replay -- --seed=2 --port=22960
```

产物：`.scratch/discovery/<seed>/` —— `seq.json`（seed、动作序列、每步前后状态、失败项）、`trace.zip`、`shot-*.png`、`console.jsonl`、`rpc.jsonl`、`state-before/after.json`、`steps/<n>/*`。通过时只留 `seq.json`。

### 3.3 实测

| 项 | 结果 |
| --- | --- |
| 冒烟 seed 1–3（10 步） | 3/3 PASS，走过 EMPTY→IMAGE_LOADED→ROI_READY→Y_CALIBRATED（seed 3 到 COLUMNS_DETECTED） |
| 深序列 seed 7（26 步） | 26/26 PASS，触达 SAMPLES_READY |
| **同 seed 重放** | `--replay` 读盘比对 actions 数组，seed 1/2/3 全部 `replayMatch=true`，逐条相同（10/10） |
| 故意失败试验（I4 恒假） | 精确报 `INVARIANT_VIOLATION step 8 commit_ycalib invariants:["I4"]`，31 个产物全保留（trace 10.5 MB、8 张截图、逐 step 状态）；恢复后自动重跑 PASS 并把目录裁剪回只剩 `seq.json` |

踩到的两个真实坑（已修，写进注释）：均匀随机会让 10 步里一步都走不出第 1 步（推进动作被 20+ 候选稀释）；漏了 `#btn-goto-step2` 会导致第 2 步面板根本不在 DOM 里、物理上到不了 ROI_READY。

已知局限（诚记账）：10–26 步仍可能整轮绕过 `CLEANED / X_CALIBRATED / EXPORT_READY`；列删除、笔刷涂抹、排除区拖框、年龄-深度弹窗、OCR 审阅、导出下载六类入口未进动作表；六条不变量只能人检（理由在 `invariants.mjs`）。

---

## 4 诊断记录器（开发模式版，已实现）

- 新增 `frontend/src/devtools/zipStore.ts`（自写 STORE+CRC32，零新依赖）、`frontend/src/devtools/diagRecorder.ts`；`frontend/src/main.ts` 加 2 行（`bootstrap()` 首行安装，否则漏掉启动时的 `getDiagramData`）。
- **默认关闭**：仅 `?diag=1` 或 `localStorage['straditize.diag']==='1'` 启用；关闭时 `window.fetch` 未被包装、无缓冲、`export()` 明确抛错（Verifier 独立复跑过这四条）。
- 导出 `bug-report-<ts>.zip` 7 条目：`actions.jsonl / rpc.jsonl / console.jsonl / state-before.json / state-after.json / environment.json / screenshot.png`。
- 隐私：路径类只留 basename、`token/password/secret` 整体抹掉、字符串 >200 字符截断、**二进制正文（如 `image_data` 的 base64）落盘为 `<redacted:binary(95298)>`**。自审时发现第一版真把 base64 前 200 字符写进报告，已修。
- 实测：`core.loadImage 1289.9 ms`、`roi.update 26.7 ms`、`algorithm.applyLineRemoval 1611.3 ms` 等真实耗时；7 条目与 CRC 经 7-Zip + Python `zipfile.testzip()` 三方核对。

已知限制：逐动作 `stateAfter` 多为 null（前端定向 RPC 后不重拉全景，记录器拒绝注入额外 RPC 以免改变时序，故 `state-after.json` 用导出瞬间补的一次真实往返）；`screenshot.png` 只有画布、不含工具栏/弹窗；`commit` 取不到（写 null 不猜）；未记录 `pointermove`。

---

## 5 门禁结果（真实命令 + 输出 + exit code）

| 命令 | 输出摘要 | exit |
| --- | --- | --- |
| `pixi run lint` | `一致性核对通过`；D/E/F/G/H/I/J/K 全 OK；`§4A matches the code.`；`EXIT=0` | **0** |
| `npx playwright test project-roundtrip`（22950） | `2 passed (27.1s)` | **0** |
| `npx playwright test project-roundtrip`（22952，Verifier 独立） | `2 passed (25.6s)` | **0** |
| 金丝雀（`project.save`→`export.tar`） | `1 failed / 1 passed`，红在 spec:254 | 1（**预期**） |
| `npx playwright test export contract` | `7 passed (51.7s)` | **0** |
| `npm run test:e2e:typecheck` | 静默通过 | **0** |
| `npx tsc --noEmit -p tsconfig.json`（诊断记录器） | 无诊断输出 | **0** |
| `pytest -q` 全量 | **未完成**：`--collect-only` 764 tests / 3.36 s 正常，但执行阶段 `[9%]`/4 min（外推 ~40 min），本轮放弃等绿。**不宣告通过** | — |
| `pixi run test-e2e` 全量 | **未跑**：会与并发会话抢 8799/后端会话；本轮只跑定向 spec | — |

---

## 6 未解决问题

**Verifier 新报（只报不改）**
1. `ProjectManager.ts:671` 的项目 JSON 识别面过宽（任何非 manifest/info 的 `.json` 都当项目数据）；数据包今天能报对错误，靠的是"包里只有 manifest.json"这一偶然事实。
2. 新 spec 里 4 条断言对 T-05 零判别力（见 §2），需加注释。
3. `saveProjectFile` 新注释的成员清单不全（有 ROI 时实为 7 项）。
4. 绿色运行后 Playwright 清理 `test-results-*`，`saved-project.tar` 不留证（Verifier 改用直连 `project.save` 复核）。

**待修缺陷（已裁定，本轮未动）**
5. **T-04（高）** 撤销后步骤 3 面板否定后端已确认的标定 —— 下一优先。
6. T-01 页脚缩放冻结 / T-02 空标定静默 / T-06 重复写请求 / T-07 `name_source` 错标。
7. T-03 与产品决策 ②「撤销应覆盖清理编辑」：现在是「不入栈 + 按钮可按」的错配，改法是扩大撤销栈覆盖清理编辑（属结构性改动，需单独一轮）。

**产品决策 ③ 未落地**：「+ 新建 ROI」应给空区域 —— 当前仍是克隆当前 ROI（100% 重叠）。

**环境**
8. `ops_bash` 仍 `EXECUTOR_UNAVAILABLE`（dsh-ops 0.5.1 缺陷），本轮全程靠 `terminal_*` + `ego_cli` 的 `child_process`。
9. 全量 pytest 在本机 ~40 min（文档记 187 s），原因未查；恢复前不能拿"全绿"当门禁。

---

## 7 下一步原子动作

按严重度接 T-04：先在 `frontend/e2e/` 写一条「拖 ROI → 标定 → 撤销 → 面板与后端必须同真值」的用例，确认它在当前实现上稳定变红，再动 `HistoryManager` / `applyHistorySnapshot`。
