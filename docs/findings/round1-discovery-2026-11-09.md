# 第一轮「主动发现未知缺陷」报告（2026-11-09）

> 范围：只做第 1 步（盲区审计）与第 2 步（黑盒探索 + 缺陷裁定）。**未修改任何产品代码**，未放宽任何断言，未加 sleep，未 mock 后端。
> 角色隔离：Explorer（黑盒、不读源码）→ Triage（独立复现，不采信 Explorer 结论）→ Lead（本轮只做汇总与门禁）。
> 本轮共产生 3 个新文档：本文件、`docs/findings/coverage-map-2026-11-09.md`、`docs/findings/adjudication-2026-11-09.md`。

## 0 一句话结论

自动测试守住的是「八步 happy path + 已知缺陷回归」，**没守住「存档-接着干」「撤销与后端真值的一致性」「面板与后端读数的同一性」**。本轮黑盒探索 8 条候选 → 裁定 **6 条新缺陷**（2 条高危）、1 条已知产品决策问题、3 条需求未定义；其中「保存项目」产物**根本无法被「打开项目」打开**（自家往返失败），这是任何现有测试层都不会红的失效。

---

## 1 当前测试盲区图

完整表在 `docs/findings/coverage-map-2026-11-09.md`（497 行，按用户任务 × 状态转换组织）。口径先修正三处已漂移的旧数字：

| 旧说法 | 实测 | 证据 |
| --- | --- | --- |
| 45 个 spec | **43 个 `.spec.ts`**（45 = 43 + helpers + fixtures） | `ls frontend/e2e/*.spec.ts` |
| 16 spec / 53 用例 / 308 断言 / 86 处后端读取 | **43 spec / 130 处 `test(`（运行时 132）/ 872 处 `expect(` + 107 处 `.poll(` / 178 处后端读取** | 复算命令见覆盖图 §4 |
| 「只应有 error-surfacing 一个 spec 不读后端」 | **8 个 spec 零后端读取** | 同上 |

### 1.1 状态转换覆盖（九状态机）

| 转换 | 覆盖 | 关键缺口 |
| --- | --- | --- |
| ∅→EMPTY→IMAGE_LOADED（真实文件选择器） | ✅ 仅 zero lane | `from-zero-journey` 被主门禁 `testIgnore` 排除 |
| →ROI_READY→Y_CALIBRATED | ✅ | — |
| **Y_CALIBRATED→ROI_READY→Y_CALIBRATED（阶段往返）** | ❌ | 标定后改 ROI、再回步骤 3，一条用例都没有 |
| **CLEANED→（返回）→CLEANED** | ❌ | 笔迹/几何跨步是否存活无断言 |
| **X_CALIBRATED→ROI_READY→X_CALIBRATED（切 ROI 再切回）** | ❌ | 多 ROI 下标重排只有后端 pytest 覆盖，且 `testing-strategy.md:320` 自认结构性未修 |
| COLUMNS_DETECTED→重新检测 | ⚠️ 单 ROI | 多 ROI 名称/标定存活未覆盖 |
| →SAMPLES_READY→EXPORT_READY | ✅ 强（tar 字节 + data.csv == 主 ROI） | — |
| **EXPORT_READY→保存→重开→EXPORT_READY** | ❌ **零覆盖** | 只有后端 golden 守序列化格式，守不到用户按钮 |

### 1.2 Top 10 盲区（细节见覆盖图 §5）

1. 保存项目→重开旧项目：按钮存在、e2e 一次没点过（**本轮已证为真缺陷，见 T-05**）
2. Ctrl+Z 撤销/重做：几乎零断言，且「清理编辑不入栈」这个决策没有任何钉子（**见 T-03 / T-04**）
3. 连击/双击「下一步」：`dblclick|clickCount` 全仓 0 命中
4. Y 标定逐框输入：测试自己绕开（用 `el.value` 不派发事件），缺陷既没修也没钉
5. 多 ROI 重新分列的下标重排：亲口说结构性未修，e2e 零覆盖
6. 阶段往返（三条重建路径）：一条用例都没有
7. 换图/新建的清理几何残留：两个启动器都靠额外 `_init_cleanup()` 替产品擦屁股
8. 缩放 ≠ fit 时的画布操作：唯一用例只断言「视口没被打回 fit」
9. 安装包/Portable：零覆盖（webServer 跑的是源码后端）
10. 模态框开着时切步骤 / Esc：`grep Escape` 0 命中

---

## 2 探索执行记录

| 项 | 值 |
| --- | --- |
| 应用 | `http://127.0.0.1:23900/`，**零状态真实后端**（`support/serve_zero_backend.py`：不预载图、不预跑分列、无 ROI） |
| 浏览器 | 系统真实 Microsoft Edge 157.0.0.0（Playwright MCP 驱动，channel=msedge 等价） |
| 视口 | 主 1680×1050 @dpr=1；补 1366×768 @dpr=1 |
| 图版（3 张，结构不同） | hoya 2339×1654（高清现代图版）／muricuo 双 Y 多色 2251×1203／中文扫描件 1807×745（含复印黑边、水平采样线） |
| 载图方式 | 全部经真实 `<input type=file>`（`browser_file_upload` / `fileChooser.setFiles`），**未用 RPC 摆放状态** |
| 只读权威探针 | `POST /rpc` → `straditize.getDiagramData` / `roi.list`；**仅读，未用于改状态** |
| 动作日志 | `.scratch/exploration/20261109-1642/`（index.md + F-00…F-07，52 文件） |
| 裁定证据 | `.scratch/triage/F-01…F-07/` |

### 2.1 十类操作序列覆盖

| # | 序列 | 状态 | 落点 / 结果 |
| --- | --- | --- | --- |
| 1 | 空项目首启 → 真实文件选择器载图 | 完成 | hoya 载入成功，前后端尺寸/ROI 一致；首启截图因目录未建丢失，文字证据在 `F-00/actions.jsonl` |
| 2 | 两 ROI → 改名 → 切主 → 删当前主 ROI | 完成 | 删主 ROI 后 primary/active 正确回落，无悬挂；**发现 F-07 名源错误、F-06 重复写** |
| 3 | Y 标定 → 回步骤 2 改 ROI → 再进步骤 3 | 完成 | 标定保留；改 ROI 后标定零点落在 ROI 顶部之上且无提示（未列为独立发现，进「未验证假设」） |
| 4 | 分列 + 列命名 → 重新检测分列 | 完成 | 29 列；列名 `松属A1` 重分列后保留，标定保留（单 ROI） |
| 5 | X 标定 → 切 ROI → 切回 | **未完成** | 只到步骤 6 入口（`标定进度 0/29`） |
| 6 | 画笔迹 → 清空 → 撤销 → 返回再进入 | 完成 | 跨步存活 OK；**撤销不恢复笔迹（F-03）** |
| 7 | 快速双击 / 两动作 <100ms | **部分** | 3 连击未观察到崩溃或重复对象，但按钮在重渲染后定位漂移，证据不足→不入表 |
| 8 | 逐字符输入触发面板刷新 | 完成（无缺陷） | ROI 名、列名（中文+ASCII 混输）焦点/光标/未丢字/无重复提交均正常 |
| 9 | 保存 → 继续改 → 重开 → 比对 | 完成 | **重开直接失败（F-05，高危）** |
| 10 | 换图/新建后的残留 | 完成（无残留） | 换 muricuo 后列/标定/笔迹/候选线清零，仅 1 个自动 ROI；有「未保存修改」确认拦截 |

### 2.2 环境矩阵

| 项 | 状态 | 结论 |
| --- | --- | --- |
| 1680×1050 / 1366×768 | 完成 | 布局无重叠（`env-1366x768.png`） |
| 中文文件名 + 带空格路径（`中文 图版 A.png`） | 完成 | 上传成功，1807×745 正常 |
| 无网络（`context.setOffline`） | 完成 | 提示清晰、拒绝返回替代数据，**该路径无缺陷** |
| 1920×1080 / 125% / 150% 缩放 | 未做 | 未受控 |
| 安装包 / Portable | 本轮不可得 | `.scratch`、`dist/` 下无交付包（`dist/` 只有前端产物） |

### 2.3 工具链障碍（影响后续轮次，必须先解决）

- `ops_bash` 全程 `EXECUTOR_UNAVAILABLE`：`dsh-ops` 把 `winuxcmd` 复制到 `%TEMP%` 时 link 失败（提示 0.5.1 并发缺陷，需 0.5.2+）。**停电重启后仍不可用**，故不是瞬时并发问题，需升级 dsh-ops 或换宿主。绕行通道：`terminal_*`（PowerShell，>9 字符的命令行会被逐字符回显打乱，只能用短命令 + 预置 `.ps1`）、以及 `ego_cli` 里的 `node:child_process`（单次 120 s 上限）。
- Playwright MCP 的截图/上传只允许写 `C:\Users\chmzs` 与 `C:\Users\chmzs\.playwright-mcp`，证据需二次拷贝。
- 探索中途本机意外停电，23900 后端与三条角色会话全部非正常终止。重启后端命令：
  `STRADITIZE_ZERO_PORT=23900 pixi run python support/serve_zero_backend.py`（零状态，不预载图、不预跑分列）。
  已落盘的证据（`.scratch/exploration/`、`.scratch/triage/`）不受影响；未落盘的现场需按 `actions.md` 重走。

---

## 3 缺陷裁定表（详见 `docs/findings/adjudication-2026-11-09.md`）

| ID | 缺陷 | 裁定 | 尝试/命中 | 首次状态分叉 | 严重度 | 已知/新 |
| --- | --- | --- | --- | --- | --- | --- |
| **T-05** | 「保存项目」产物无法被「打开项目」打开：包内只有 `manifest.json`（无 `straditize.json`），提示「未在 .tar 归档中找到项目数据 JSON 文件。」，`project.load` 发出 0 条 | REPRODUCED | 3/3 + 对照 | 第 5 步点「打开项目」后 `project.load` 0 条（应为 1），工作区零变化 | **高** | 新 |
| **T-04** | 撤销后步骤 3 面板否定后端已确认的标定：面板「尚未完成 Y 轴标定」+ Ratio `--`，同刻后端 `isCalibrated=true / 556 / 1320` | REPRODUCED | 2/3，机制已定位可主动构造 | 点「撤销」后前端 `calibration.isCalibrated` true→false（后端未变） | **高** | 新 |
| T-01 | 页脚「缩放:」读数冻结（徽标 100%、页脚 56%），此后不收敛 | REPRODUCED | 3/3 | 点「1:1」后页脚 56%→56%（应 100%） | 中 | 新 |
| T-02 | 四个 Y 标定框为空时点「应用标定」：0 RPC、0 提示、0 变化；占位符 `556/0/1320/1500` 是字面量常量，`1320` 甚至超出 745 高的图 | REPRODUCED | 3/3 | 点按钮后请求数 0（应 1）、提示数 0（应 1） | 中 | 新 |
| T-03 | 「清空笔迹」后点「撤销」：笔迹不恢复，撤销消耗在与当前值相同的 `roi.update` 上 | PARTIAL（笔迹 4/4，「撤销改写 ROI 几何」0/2） | 4 | 点「撤销」后 `line_strokes` 0→0（应 1），随后 `#btn-undo` 置灰 | 中 | 已知（`testing-strategy.md:319`） |
| T-06 | 一次提交连发 2~3 条逐字相同的写请求（`roi.update` 3/3、`core.calibrateAxes` 4/4） | REPRODUCED | 7 | Tab 失焦后写请求 1→2 | 低（有条件升级） | 新 |
| T-07 | 系统默认 ROI 名（`roi_2/roi_3`）被标成 `name_source="user"` | REPRODUCED | 3/3 | 点「+ 新建 ROI」后 `name_source=user`（应 `default`） | 低 | 新 |

### 3.1 两条高危的判别力说明（为什么现有测试一定红不了）

- **T-05**：e2e 从未点过「保存项目」按钮（覆盖图 §2-9）；后端 `project.save` 的 golden 测的是**另一个接口**的产物，那个产物含 `straditize.json`、能正常打开。所以「后端接口正确」与「用户按钮能用」之间没有任何一层连着。
- **T-04**：`step3-ycalib.spec.ts` 每次都从「未标定」开始走 happy path，从不先制造一条标定前快照再撤销；而 `journey.spec.ts` 的撤销用例不读 `calibration`。两侧各自绿。

### 3.2 需求未定义（不进缺陷表）

1. 撤销是否应覆盖清理编辑（现决策：不入栈，回收出口是「清空笔迹」）——T-03 的体验问题是该决策的副作用。
2. 「+ 新建 ROI」的初始边界：现为克隆当前 ROI（3/3 得到 100% 重叠），且 UI 无提示。
3. 「保存项目」应导出工程包还是数据包——**这一条不定，T-05 的修法方向无法确定**。

### 3.3 未验证假设（不进缺陷表，摘要）

- U-01 撤销会真实回退 ROI 几何：0/2 未复现。
- U-03 两个 100% 重叠 ROI 是否污染导出求和：未验证（需 29 列 + 双 ROI 同面导出）。
- U-04 `calibrateAxes` 第 3 条请求的触发路径：未定。
- U-05 页脚冻结是否影响导出数值：不成立的风险方向（纯展示）。
- 其余见裁定文档 §2。

---

## 4 新增回归测试

**本轮未新增**（第 3 步未授权，按任务书要求先出证据与裁定）。下一步的两条候选与「在什么错误实现上会红」的设计：

| 目标 | 拟挂位置 | 会在什么错误实现上红 |
| --- | --- | --- |
| T-05 | `frontend/e2e/project-roundtrip.spec.ts`（新 spec，zero lane） | 保存仍走 `export.tar`（包内无 `straditize.json`）时红；断言必须是「同一 tar 被 `project.load` 接受且 ROI 名/标定逐值恢复」，而不是「按钮点了没报错」 |
| T-04 | `frontend/e2e/step3-ycalib.spec.ts` 追加用例 | 撤销把 `HistorySnapshot.calibration` 写回前端时红；判据必须同时读面板文案与后端 `calibration`，且**先断言后端仍为已标定**，防止顺序短路 |

两条都要求：真实按钮、后端权威状态断言、经过一次重建路径（重新分列 / 阶段往返 / 保存重开）、反向验证（恢复错误实现后必须变红）。

---

## 5 Discovery lane（设计，未实现）

保留现有 regression lane，只新增一条轻量状态机探索器（复用 Playwright + msedge，不引入第二框架）：

- 状态：`EMPTY / IMAGE_LOADED / ROI_READY / Y_CALIBRATED / CLEANED / COLUMNS_DETECTED / X_CALIBRATED / SAMPLES_READY / EXPORT_READY`。
- 动作生成：从合法动作集里按前置条件过滤后随机取样，权重偏向「返回、重做、删除、切换、保存重开、快速连击」；序列长度 10–30；每序列记录 `seed`。
- 失败产物：`seed / 动作序列 / trace / 截图 / console / 失败 RPC / 前后状态摘要`，目录 `.scratch/discovery/<seed>/`；同 seed 必须完全重放（同一 RNG + 同一动作表）。
- 计划：夜间 20 个 seed；PR 只跑「最近失败过的固定 seed 列表」；追踪状态转换与行为覆盖，不追代码覆盖率百分比。

## 6 诊断记录器（设计 + 改动清单，需确认后实施）

最小开发模式版本，不做正式 UI：前端单例 recorder（仅 `?diag=1` 或 `localStorage.diag=1` 启用）挂在 RPC 客户端与通知层外侧。

- 记录：`timestamp / stage / action(类型+DOM 目标或画布坐标) / RPC(method+参数摘要+code+耗时) / 操作前后后端状态摘要 / console.error / 用户可见通知 / 截图 / 版本+commit+系统+浏览器+viewport+DPI`。
- 导出：`bug-report-<ts>.zip` = `actions.jsonl / rpc.jsonl / console.jsonl / state-before.json / state-after.json / screenshot.png / environment.json`（`project.tar` 与原图**默认不附带**，需用户显式勾选）。
- 隐私边界：参数日志按 2 KB 截断 + 敏感键（路径、用户名）脱敏；不记录文件正文、不记录完整图片。
- 改动范围（预估）：新增 `frontend/src/services/DiagnosticsRecorder.ts`（约 200 行）、在 `RpcClient` 出口加一层旁路（不改语义）、新增一个开发命令 `npm --prefix frontend run diag:export`。**属前端新增，不动后端契约**。等待确认后实施。

## 7 门禁结果（真实输出）

| 命令 | 输出摘要 | exit code |
| --- | --- | --- |
| `git status --short` | 空（工作区干净，本轮只新增 docs 与 `.scratch` 产物） | 0 |
| `pixi run lint` | `一致性核对通过`；`§4A matches the code.`；检查 D/E/F/G/H/I/J/K 全 OK | **0** |
| `pixi run python -m pytest -q`（全量） | 进程可启动，`--collect-only -q` **764 tests collected in 3.36 s**；但**执行速度与文档记录的 187 s 不符**：实测 `tests/integration` 68 条用掉 95 s，全量跑到 `[ 9%]` 用掉 4 min（线性外推约 40 min）。本轮未等它跑完（放弃等绿，不宣告通过） | 未完成（不宣告通过） |
| 单文件定点基线 | `.pixi\envs\default\python.exe -m pytest -q tests/unit/test_zero_point_measurable.py` → `3 passed in 9.42s` | **0** |
| `pixi run test-e2e` | **本轮未跑**：一是本轮不改产品代码；二是 e2e 需独占 8799 端口与一份后端会话，会与本机另一个会话（8765）冲突；三是本轮目标不是「全绿」 | — |

## 8 未解决问题

**产品决策（阻塞修复方向）**
1. 「保存项目」应导出工程包（`straditize.json`）还是数据包（`export.tar`）？——决定 T-05 修法。
2. 撤销是否覆盖清理编辑；若不覆盖，按钮在此时应禁用还是提示。
3. 「+ 新建 ROI」的初始边界：空区域 / 内缩副本 / 允许共面。

**环境问题**
4. `ops_bash` 全通道不可用（dsh-ops 0.5.1 并发缺陷），停电重启后依旧；影响后续所有需要长命令的取证，需升级 dsh-ops 或换宿主。
5. 全量 `pytest` 在本机当前约需 40 min（`[ 9%]`/4 min 线性外推），而 `docs/testing-strategy.md:13` 记的是 187 s。原因未查（停电后 I/O？OCR 模型？），**在恢复前不能拿"全绿"当门禁证据**，也不能据此判断"套件变慢是新缺陷"。

**未验证假设**（不得当缺陷用）
6. 多 ROI 重新分列的名称/下标重排（文档自认未修，本轮未实测多 ROI 重分列）。
7. 双 100% 重叠 ROI 对导出求和的影响。
8. 阶段往返（T3r/T4r/T6r）三条重建路径本轮只覆盖了第 3 条的一部分。

## 9 下一步原子动作

先拍板 §8 第 1 条（保存应导出工程包还是数据包），然后在 `frontend/e2e/` 新增 `project-roundtrip.spec.ts` 并确认它在当前实现上稳定变红——这是本轮最高危、判别力最明确、且不依赖任何前端设计决策之外的东西的一条。
