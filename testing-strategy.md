# 测试策略

> 判据来源：知乎《[大型 ToB 项目的前端自动化测试实践](https://zhuanlan.zhihu.com/p/546647225)》
> 与《[契约测试实践篇](https://zhuanlan.zhihu.com/p/514909521)》。两篇的结论并非照搬，
> 下文在每一处标注了「本仓库的落点」与「为什么不适用」。命令与规模实测于 2026-09-29。

## 1 分层与职责边界

每一层守一类失效，**不重复**另一层的主要职责。唯一有意的跨层重复是契约（§3）。

| 层 | 命令 | 规模（实测） | 守什么失效 | 反馈代价 |
| --- | --- | --- | --- | --- |
| 后端逻辑 | `pixi run test` | 277 passed + 96 subtests | 计算正确性；数据来源不变量（`tests/integration/test_no_fabrication.py` 是守卫测试，不得放宽） | ~187 s |
| 前端模块 | `npm --prefix frontend test` | 5 个 node 脚本 | 纯函数 / 模型 / 注册表 / 阶段映射 / 契约字段完整性 | ~2 s |
| 跨文件一致性 | `pixi run lint` | 8 项检查 | 签名↔调用点、类型标注↔实现、package-data、pytest 收集、裸步骤数字、**前端 RPC 方法名 ⊆ 后端注册表** | ~1 s |
| 端到端 | `pixi run test-e2e` | 16 spec / 53 用例 / 308 处断言，含 **86 处真实后端读取** | 真实浏览器里的集成事实：画布渲染管线、手势、i18n、错误冒泡 | ~205 s |
| 契约快速 lane | `pixi run test-contract` | 5 用例 | 同上，只取契约部分 | 26 s |

> **本表数字的重算命令**（数字会漂，口径写下来才可复算）：
> - 用例数：`grep -c "^\s*test(" frontend/e2e/*.spec.ts | awk -F: '{s+=$2} END{print s}'`
> - 断言数：`grep -ho "expect(" frontend/e2e/*.spec.ts | wc -l` + `grep -ho "expect\.poll(" frontend/e2e/*.spec.ts | wc -l`
> - 后端读取：`grep -rhoE '\b(rpc|backendRpc|diagramData)[[:space:]]*[<(]' frontend/e2e/*.spec.ts | wc -l`
>   —— 只算**真的打到后端**的辅助函数。注意 `getState()` **不算**：它读的是
>   `window.__straditize.getState()`，即前端自己的镜像状态，不是后端真值。

`pixi run test-e2e` 与 `test-contract` 都会**先 build SPA**：后端通过
`find_frontend_dist()` 从 `frontend/dist` 托管界面（`straditize_core/rpc_server.py:686`），
跳过 build 就会对着上一次的产物跑——改了 `frontend/src` 而用例照样全绿，等于没测。

## 2 为什么是这几层，而不是教科书的三层

知乎那篇明确说：前端里「单元测试」与「集成测试」的边界本就模糊，硬分三层过于繁琐，
他们**只做单元 + E2E**。本仓库同理，且更强：

* 前端的跨模块组合由 E2E 承担。真相在真实浏览器里——canvas 渲染管线、右键/中键/空格
  三种等价平移手势、`renderedLayers` 词汇表、i18n 整站生效，这些在 jsdom 里根本无法
  成立，写"前端的集成层"只会得到一层绿色谎言。
* `tests/integration/` 是**后端**的集成层（真 RPC + 真算法），不是前端层。
* 不套用流传的 7:2:1 金字塔配比。配比应由**失效分布**决定：本仓库是 canvas 重交互 + 薄
  业务逻辑，历史缺陷集中在渲染管线、阶段可见性、契约字段，因此 E2E 的权重高于教科书。

## 3 契约是最高危的一类失效

历史事故：前端发 `x_bounds` 而后端要 `data_xlim`，被静默兜底掩盖很久（`AGENTS.md`）。
这类失效不会让任何一层变红——DOM 正常、后端正常，只有两端对不上。

现在同一件事被**三处独立钉子**守住，任何一处发现不一致都会红：

1. 前端 node 层：`test-roi-model.mjs` 做契约 v1.3 字段完整性机器核对（`DataRoi 9/9`、
   `Column 14/14`、`DiagramData 10/10`）。
2. `frontend/e2e/contract.spec.ts`：拿**后端真实返回的 payload** 对 TS 声明验
   `返回键集 ⊇ 声明字段`，并额外钉住零状态键集与加载态完全一致（遗留缺陷 ①）、
   别名表与设计豁免表不得过期。这是唯一"两端一起看"的检查，因此不可被 node 层替代。
3. `support/consistency_check.py` 检查 G：前端 RPC 方法名 ⊆ 后端注册表。

**不上 Pact / Pact Broker。**《契约测试实践篇》自己的结论是：契约测试失败的主因是
"规模和痛点不够大"，成功前提是团队足够痛 + 懂契约测试。本仓库前后端同仓、单一后端、
无多团队并行发布，引入契约制品 + Broker 只会多一份需要同步维护的东西（该文也警告
契约测试会变成负担），而它想解决的"一端改了另一端不知道"已经被上面第 2 条以**真实
payload** 的方式解决——比 Pact 的 mock 更接近真相。

改契约的动作顺序：改后端 → `pixi run test-contract`（26 s）→ 同步前端 TS / 文档 / 本文件
→ 跑完整五门禁。

## 4 E2E 的八条纪律（每条都有具体落点）

1. **错误必须冒泡，且两个方向都要证。** 反向：`frontend/e2e/fixtures.ts` 提供 auto
   fixture，控制台 `error`、未捕获异常、**前端自己发起的失败 RPC**、原生弹窗，一律在
   teardown 断言为空——之前的 10 条 spec 里有 3 条完全没有监听，另外 7 条靠用例末尾
   手写，用例中途失败就永远走不到那一行。正向：`frontend/e2e/error-surfacing.spec.ts`
   用 `page.route` 只让某个 RPC 失败，断言用户**真的看见了**弹框文案。
   只有反向那一半时，一个"把错误全吞进 `console.warn`"的实现能让门禁全绿。
   注意本后端的 JSON-RPC 错误是 `HTTP 200 + body.error`，只看 status 会漏掉全部应用级错误；
   故意触发异常的用例在文件里用 `test.use({ allowlists: { rpcError: [...], dialog: [...] } })`
   显式声明豁免。
2. **断言后端权威状态，而不是 DOM 文本。** DOM 正常而状态机错乱（"删除后几何复活"）
   对纯 DOM 断言完全隐形。
3. **零固定 sleep；`expect.poll` 的条件要选"最终会变的那一个量"，不能是复合状态。**
   `waitForTimeout` 是 E2E 假绿的第一来源，等待一律走 Playwright 的智能等待或 `expect.poll`。
   另一半同样致命：一次 RPC 可能**分两阶段落地**。例：`algorithm.applyLineRemoval` 先写
   `line_strokes`，再跑 `_recompose`（内含一次 overlay PNG 编码）才写 `cleanup_stats`。
   此时"等 `line_strokes.length === 1`"会被**半完成状态**满足，紧接着读到的统计仍是上一轮的
   0——实测后端日志已算出 `manual_erase_pixels = 4424`，而并发 `getDiagramData` 读到 0
   （把同一笔迹重放一次立刻得 4424）。故等待条件直接写成被断言的那个统计量
   （`statOf('manual_erase_pixels') > 0`），让"何时算完成"与"断言什么"是同一个量。
4. **选择器用 `id` / `data-*` / label 文本，禁位置依赖。** `nth-child` / `:last-child`
   会在任何一次元素插入后失效；断言整颗元素的文本而非某个子 span。
5. **用例间必须隔离，且隔离本身要被断言。** 每条用例前 `e2e.reset` 复位后端，启动器
   `support/serve_e2e_backend.py` 随后**断言复位后状态真的干净**（残留则 fail-fast 抛错）。
   旧套件 4 failed / 10 passed、单跑却通过，就是 session 级共享会话导致的污染。
6. **不 mock 后端，只用真 Edge。** `channel: 'msedge'` + 真实后端；固定不变的只有基线
   图像（hoya）与真值文件。mock 越多，测试的信心越低、维护成本越高。
7. **用例粒度按"行为的完整性"，不按"单元的独立性"。** 一个用例走完一条用户路径；
   过度拆分会重复付出页面渲染与 RPC 往返的代价。
8. **并发靠端口隔离，不靠共享。** 后端是单会话，故 `workers: 1`；多会话并发时用
   `STRADITIZE_E2E_PORT=22600 pixi run test-e2e` 错开端口与产物目录，而不是
   `reuseExistingServer`。共享同一后端会让两边的 `e2e.reset` 交错，产生与代码无关的随机红。

9. **不允许长期下线（`fixme` / 无条件 `skip`）**。功能删了就删测试；判据还成立就按
   新契约重写。「待重写 + `test.fixme(true, ...)`」不是中间态，是遗忘——
   实测事故：`step6-xticks.spec.ts` 整文件 6 条全部 fixme（断言的是已删除的单列
   两点标定控件），于是面板里 **7 处绑到不存在元素上的 handler** 活了两轮无人发现，
   最后靠元素 id 门禁才抓出来。机械门禁：`frontend/check-e2e-skips.mjs`（挂 `npm test`）。
   条件性 `test.skip(cond, reason)` 允许——它表达的是「当前环境缺前置」而不是
   「这条不打算跑」，但必须带 reason 字符串。

## 5 明确不做的事

| 不做 | 理由 |
| --- | --- |
| 视觉/截图回归（`toMatchSnapshot` **基线比对**） | 跨 OS 字体/抗锯齿差异会让基线图在 Windows 本地与 CI Linux 之间抖动，那篇文章也把"噪音处理/基线维护"列为 E2E 的成本。但**"不看像素"是错的**：`renderedLayers` 只证明某个 `drawXxx()` 被调用过，绘制函数提前 `return` 时层名照样进集合（已用金丝雀实测：让 `drawRoiOverlay` 无条件提前返回后，三条结构断言全绿、画布上一个像素都没画）。改用**同轮内步骤间的像素不等式**（`step-visibility.spec.ts` 的「画布墨迹」用例）：不存基线、不比绝对值，只问"这一层有没有让墨迹变多"，阈值按实测信噪比（层间差 ~19 万 px vs 轮间噪声 ~1700 px）留足余量。 |
| Pact / Pact Broker | 见 §3。 |
| 追覆盖率百分比 | 覆盖率不区分"断言了后端权威状态"和"断言了 DOM 没报错"。替代判据见下表后的两行命令，都可机检。 |
| 引入第二个 E2E 框架 | 一个真浏览器驱动就够；多一套框架等于多一套 flaky 与依赖。 |
| 为"将来可能复用"抽测试工具层 | 只有一处调用的抽象是负债。 |

覆盖率的替代判据（**只增不减**，当前实测值写在注释里）：

```bash
# ① 后端读取总次数 —— 当前 83（15 spec / 48 用例）
grep -oE '\b(rpc|backendRpc|diagramData)\s*[<(]' frontend/e2e/*.spec.ts | wc -l

# ② 一次后端都不读的 spec —— 当前只应有 error-surfacing.spec.ts
for f in frontend/e2e/*.spec.ts; do
  grep -qE '\b(rpc|backendRpc|diagramData)\s*[<(]' "$f" || echo "$f"
done
```

## 6 新增测试该放哪一层

| 我要断言的东西 | 落点 | 顺带要跑 |
| --- | --- | --- |
| 纯函数 / 坐标换算 / 注册表 / 阶段映射 | `frontend/test-*.mjs` | `npm --prefix frontend test` |
| 后端算法 / 数据来源不变量 | `tests/`（根因在 `straditize_core`） | `pixi run test` |
| 两处必须一致的跨文件事实 | `support/consistency_check.py` 加一项检查 | `pixi run lint` |
| 后端返回的字段名 / 键集 | `frontend/e2e/contract.spec.ts` | `pixi run test-contract` |
| **某个 RPC 方法的参数名是否被后端接受** | `tests/integration/test_rpc.py`（真 dispatcher + `call_rpc`，方法名写成字面量） | `pixi run test` |
| 真实浏览器里的用户可见行为 | `frontend/e2e/<主题>.spec.ts`（新 spec） | `pixi run test-e2e` |

新 spec 从 `./fixtures` 取 `test` / `expect`（**不要**直接从 `@playwright/test` 取，
否则丢掉全局错误门禁）；需要故意触发错误路径时，用
`test.use({ allowlists: { rpcError: [/方法名/], dialog: [/文案/] } })` 在用例文件里显式
声明豁免，不允许关掉门禁。

## 7 门禁

提交前：`pixi run lint`、`pixi run test`、`npm --prefix frontend run build`；
改了前端逻辑加 `npm --prefix frontend test`；改了 RPC 契约或界面行为加
`pixi run test-e2e`。CI（`.github/workflows/ci.yml`）跑的就是这些，外加 e2e 类型检查
（`npm --prefix frontend run test:e2e:typecheck`），失败时上传 Playwright 报告。

## 8 门禁自身的可信度：金丝雀纪律

**一个从不失败的门禁等于没有门禁。** 新增或修改门禁后，必须**故意制造它要抓的那种失效**
并确认它真的变红，再还原。本文件里的数字与结论都经过了这一步：

| 门禁 | 金丝雀（怎么弄红） | 实测结果 |
| --- | --- | --- |
| 契约 lane | 把后端 `rpc_methods/system.py` 的 `line_candidates` 改名 | 5 用例中 3 条红，报"真实 payload 缺少 DiagramData 的必填字段" |
| 画布墨迹 | 让 `drawRoiOverlay` 无条件提前 `return` | 墨迹差值 193600 → 13395，用例红；而三条 `renderedLayers` 结构断言**全绿** |
| 错误冒泡（正向） | 把 `PropertyPanel.ts:639` 的 `alert` 换成 `console.warn` | 用例红：`Received string: ""`（一个弹框都没有）；同文件第二条用例仍绿 |
| 错误冒泡（面板 banner） | 把 `QaPanel.triggerSummarize` 还原成"只 `console.warn`" | 用例红：banner 仍是 `🟢 地学校验门禁通过`，未出现注入的失败文案 |
| 上传失败不喂 `undefined` | 把 `RpcClient.uploadFile` 的 `!res.ok` 与路径校验拆掉 | 用例红：`component.installOfflineZip` 被调用，后端回 `-32602 missing a required argument: 'zip_path'` |
| 步骤 4 笔刷落库 / 清空 | **不是注入的**——这是一次真实缺陷：`onClearLineFix` 只清前端镜像，再发一次**不带 `strokes`** 的 `refreshCleanup`（后端语义 `strokes is None` → 保持原值） | 旧实现下用例红并卡在 `[1, 4424]`（清空无效）；改走 `setLineStrokes([])` 后绿（7.2 s）。这条用例的判别力正在于它区分"按钮看起来生效（HUD 提示 + 镜像瞬时归零）"与"后端掩膜真的变了" |
| 范例下拉每一项都能载入 | **不是注入的**——真实缺陷：下拉里的「验证图谱」指向 `verification_real_pollen_edit.png`，该文件是 `scripts/verify_real_pollen_edit.py` 的产物且被 `.gitignore` 排除，全新克隆必失败 | 先实测三选项：`hoya` ✔ 2339×1654、`beginner` ✔ 1923×1796、`verification` ✘ `-32004 内置范例图片缺失`。把死选项从下拉移除后绿；随后**注入**回该选项复核门禁变红（`下拉出现未知选项 'verification'`），再还原到 sha256 逐字节一致 |
| 步骤 2 删除 ROI 的级联重指派 | 把 `session_parts/roi.py` `roi_remove` 里 `if self.primary_roi_id == roi_id:` 改成 `if False and …`，令主指针留在已删除的 id 上 | 用例红：`删掉主区后主指针必须重指派到存活 ROI，绝不能留在已删除的 id 上`。**判别力**：删前该 ROI 同时是活动区与主区，只断言 `rois` 变短会漏掉悬挂指针 |
| 步骤 2 组分是局部更新 | 在 `roi_update` 的 `composition` 分支后追加 `roi["name"] = name or ""` / `name_source = "default"`，模拟"未传即清空" | 用例红：`Expected "湖泊B" / Received ""`（`只改组分不能把名字清掉`）。这条正是"局部更新把未传字段一起抹掉"这一经典缺陷的钉子 |
| 步骤 2 面板必须跟随活动 ROI | 把 `RoiPanel.ts:13` 的 `const activeId = data.active_roi_id \|\| … \|\| rois[0]?.id` 改成恒取 `rois[0]?.id`（即 `RpcClient` 垫片失效后的静默退化形态） | 用例红：`切到 roi_2 后复选框必须是该 ROI 的真值（后端 false）；显示上一个 ROI 的值就是面板在撒谎`。这条钉住的正是 `contract.spec.ts` 警告过的"垫片一删就退化成 `rois[0]`，多 ROI 时就是错的" |
| 步骤 2 重名改名必须被拒且冒泡 | 把 `_validate_roi_name` 的唯一性判断改成 `if False:` | 用例红：`重名改名失败必须弹框告知用户，而不是静默不生效`（既证明后端真的在拦，也证明拒绝会走到 `alert`） |
| 步骤 3 单位框必须真的进后端 | 把 `YCalibPanel.ts:111` 的 `const unit = (…)?.value.trim() \|\| 'cm'` 改成硬写 `'cm'` | 3 条红：`"unit": "m"` 期望 vs `"cm"` 实收（用例 1、2、3 都断言了单位）。用例 4 仍绿——它**在提交之后**才取快照，对单位没有期望，这正是精确判别 |
| 步骤 3 像素排序归一 | 把 `session.py` `calibrate_axes` 的 `ordered = sorted(…, key=lambda pair: pair[0])` 改成不排序的 `list(zip(…))` | 仅用例 3 红：`Expected: 611 / Received: 1198`（即用户先填的那个点被当成了 top）。用例 1、2 用的是升序输入，故不受影响 |
| 步骤 3 覆盖语义 | 把 `depth_calib` 的整体赋值改成逐键 `setdefault`（即"永不覆盖"） | 仅用例 2 红：`第二次标定必须覆盖第一次`，`Expected: 700 / Received: 611`（上一轮的陈旧值存活） |
| 步骤 3 后端同像素第二道防线 | 把 `session.py` 的 `if np.all(y_pixels == y_pixels[0]):` 改成 `if False and …`（守卫彻底失效） | 仅用例 4 红：`Received has value: null`——证明此时 RPC **根本不再拒绝**（不是"换了个错误文案"），即这道防线真的在起作用 |
| 步骤 3 比例预览不得是占位符 | 把 `YCalibPanel.ts:21` 的比值条件加一个恒假上限（`> 1e9`），令 `ratioStr` 永远停在 `'--'` | 仅用例 1 红，且**红在最后那条**比例断言上（前面的后端逐字段断言全过）：`Y 标定比例预览必须显示真实计算值，而不是永久的占位符 --`。这条证明"恒为 `--`"这种"控件在、但从不计算"的形态会被抓住 |
| 步骤 4 确认几何真的动了掩膜 | 把 `_recompose` 的 `stats["geometry_removed_pixels"]` 硬写成 `0` | 仅用例 1 红在**因果**断言上：`确认一条几何后，几何通道实际剔除的像素必须从 0 起跳`（`Expected: > 0 / Received: 0`）；前面的 `pxBefore === 0` 与"状态已翻成 removed"全都照过 |
| 步骤 4 删除真删 | 把 `delete_line_geometry` 的列表推导改成 `list(self.line_candidates)`（空操作）并摘掉"未知 id"的 raise | 仅用例 2 红：`点「删除」后该几何必须从后端消失（数量-1 且 id 不再出现）`（30 s 轮询超时） |
| 步骤 4 手工几何的 axis | 把落库字典里的 `"axis": axis` 改成 `("v" if axis == "h" else "h")` | 仅用例 3 红，且红在**第一条**几何属性断言上：`Expected: "h" / Received: "v"`——证明"拖拽方向 ↔ 落库轴"的对账是真的在比 |
| 步骤 4 统一厚度中心不动 | 把 `h` 分支的 `centre = (y0 + y1) // 2` 改成 `centre = y0 + 1`（带宽仍精确 = 7，只是中心漂一格） | 仅用例 4 红：`「统一厚度」承诺中心行不动，但 line_h_170 的中心行从 818 漂到了 819`。**判别力**：它证明这条用例不只是"宽度对了就算过"——宽度断言先全过，红的正是"中心行"那条 |
| 步骤 4 越界标红必须真的可见 | 把 `setProperty('border-color', …, 'important')` 退回普通内联 `style.borderColor = '#ef4444'` | 仅用例 5 红：`Expected: "rgb(239, 68, 68)" / Received: "rgb(203, 213, 225)"`（`toHaveCSS` 读的是 **computed** 值）。这条同时钉住了 §9 那条第 12 号缺陷：日间模式的 `!important` 安全网会吃掉普通内联标红 |
| 步骤 4 清空后面板不得再宣称有排除区 | 把 `onClearCleanupEdits` 里补的两行镜像同步（`line_strokes = []` + `exclusion_regions` 过滤）删掉 | 仅用例 6 红：`后端排除区已清零，面板不得再宣称存在排除区`，diff 里同时出现 `排除区 0 px`（统计行）与 `③ 排除区 (1 个)`（表头）——就是原始缺陷的复现形态 |
| 步骤 4 后端厚度防线 | 把 `if thickness > 500:` 放宽成 `if thickness > 10**9:` | 仅用例 7 红：`后端必须拒绝 thickness=501 / Received: null` |

### 8.1 注入的失败形状必须能区分新旧代码

上传用例的第一版注入的是 `500 + text/plain`，看着合理，**却证明了任何事**：那种 body 会让
新旧两版代码都在 `res.json()` 处抛错，于是两者都会弹框——用例无法区分修复前后，
没有判别力。把它改成"**能解析成 JSON、但没有 `path` 字段**"（例如后端返 `{"detail": ...}` 的 5xx）
后才真正分开：旧代码带着 `undefined` 一路走到下游 RPC，新代码在 `!res.ok` 就停。

判据：**先问"这个注入在我修复前会不会也通过"，会通过就换形状。**
承重断言也要选能区分的那条——本例不是"弹了框"，而是"下游 RPC 根本没被发出去"。

相反方向同样要证：**负向对照**。画布探针在"本不该有这一层"的步骤上必须为 0
（步骤 1 的 ROI 特征色实测 0）。做不到 0 的探针不能用——「ROI 蓝」就是这样被否掉的：
叠加层 `RoiOverlay`（id `roi-indicator`）与管线 `roi` 层共用 `#0284c7`，像素不可区分，
所以它只能当阶段级信号，不能当层专属证据。

**一次注入只能证明"第一条被它打红的断言"有判别力。** 步骤 3 的教训：注入「单位框被忽略」
后用例 1 确实变红，但红在**靠前**的后端 `unit` 断言上——后面那条"比例预览不得是占位符"的
断言**根本没执行到**（断言按顺序短路）。于是那次注入对它零证明力，必须另做一次
**只破坏比例计算**的注入（`> 1e9` 恒假）才把最后那条断言打红。
判据：一条用例里有多条断言时，**想证明哪一条有判别力，注入就必须让前面那些先全过**。
推论：把独立断言拆成独立用例，或用例内把"辅助可见性断言"放最后——否则前面的断言会成为
后面断言的保护伞，形成"看着有 N 条断言、实际只有第 1 条在把关"的假覆盖。

### 8.2 互不干扰的注入可以合并成一批，省的是构建而不是判别力

一条注入只影响一个用例时，多条注入可以**打进同一次构建、跑一次全量**，只要预期红名单互不相交。
步骤 4 实测：后端 5 条注入（分别只动 `geometry_removed_pixels`、厚度中心、厚度上界、删除、`axis`）
一起打进去跑一遍，**恰好**用例 1/2/3/4/7 红、用例 5/6 绿；前端 2 条（标红样式、镜像同步）
一起打进去，**恰好**用例 5/6 红、其余 5 条绿。判据：先各自确认"这条注入的爆炸半径只有目标用例"，
再合并。**顺带得到一个副产品**：同批里没被预期的用例保持全绿，本身就是"注入没有溢出"的负向对照。

⚠️ **反例（2026-09-29，步骤 5 实测）**：把"删掉 `await rpcClient.renameColumn(...)`"（C2）与
"删掉 `Sidebar` 的重名前置校验"（C4）**一起**打进步骤 5，两条注入都指向用例 3（重名拦截）——
C2 让请求根本发不出去，于是 C4 想暴露的"后端 `-32002` 冒泡"永远到不了。合并批的反馈是
"用例 3 红"，但**原因不是 C4**。判别力并没有真的省下来，只是被掩盖了：必须**先把 C4 单独跑一遍**
（实测：单独注入 C4 → 只有用例 3 红，且恰好红在 `toContain('严禁重名')` 那一行，收到的
是后端的 `命名或实体冲突 (code -32002)`），合并批的结论才可用。所以判据要写成：
**每条注入先单独跑过、确认爆炸半径，再合并**——"我预期它只影响 X"不算确认。

### 8.4 断言"动作生效"之外，还要断言"生效的东西经得起系统自身的重建"

步骤 5 的改名用例是本仓库第一个把这条讲清楚的例子。补上 `naming.renameColumn` 之后，
"改名写进后端"这条断言**当场就绿了**（`getDiagramData` 里 `columns[0].name` 确实变了）。
但真正的缺陷藏在下一步：`detect_columns` 重新分列时会**从另一个存储**（`session.taxa_names`）
把列名**覆盖回**列对象，而那个存储当时是空的 ⇒ 一次**真实的重新分列**就把名字打回 `col02`。
只断言"改完的那一刻字段变了"会**放过整整一个缺陷**，而且是最危险的那个（用户走一遍正常流程就丢数据）。

判据：**任何"持久化了"的声明，都要让数据穿过系统自己的重建路径再断言一次。**
本仓库里现成的重建路径有：重新分列（`core.detectColumns`）、阶段往返（`gotoStage` 回到本步）、
换 ROI 再切回、导出后再读。它们之所以有效，是因为它们会**重新读取权威存储**而不是复用内存镜像——
恰好能暴露"两个存储不一致"这类缺陷。⚠️ 注意这**不是** `page.reload()`：本应用有
`beforeunload` 守卫（`main.ts:180`），fixture 会把弹窗按掉从而**取消**刷新，用例会以 60 s 超时假红。
用 RPC 驱动的重建路径，不要用刷新。

### 8.3 门禁要区分"RPC 成功了"与"界面已经重挂"

步骤 4 有 3 条用例曾假红：`applyCleanupState` → `Inspector.updateData` → `render()` →
`bindEvents()` → `stepPanel.mount()` 会**整块替换**步骤面板的 DOM。点击若落在这段窗口里，
会命中一个**正在被替换**的节点（静默无操作）；更隐蔽的是 `mount()` 的闭包捕获的是**旧**
`<input>`，于是处理器读到的是陈旧值——现象看起来像"产品没反应"，实际是测试抢跑。
缓解是在每次交互前 `settle()`：轮询到面板行数等于后端权威条数再动手。

⚠️ `settle()` 的作用要说清楚：它只证明"行数对上了"，**同数量的重挂它看不出来**。
所以它是必要条件而非充分条件；真正要断言的量仍然必须取自后端或 computed 样式，不能取自
一个可能已经被换掉的 DOM 节点。

### 8.5 快照基线（golden）的三条硬约定

2026-11-06 一次性钉了 11 份 golden，其中**三份第一版是假绿**。教训固化成下面三条，新增基线
必须逐条过；三条都写在各自模块的 docstring 里，这里只给统一口径。

**① 每条基线必须做一次反向验证，且改坏要打在被选中的那条路径上。**

- 正例：把组斜率的 0 点从 `start + 轴粗` 改成 `start`，基线当场变红。
- 反例一：改 `generate_age_ensemble` 的候选梯度 `seed*0.4 → seed*0.45` 时基线**没红**——
  该模型的最优解落在 `span/20` 这条候选上，被我改的那条根本没被选中。
- 反例二：删掉 `load_image` 里的 `self.samples = []` 时基线**没红**——六个案例全是空白会话，
  清理分支从未被走到；补上「先载一张图造满状态、再载第二张」才红。
- 反例三：`digitize` 用 fig3 那张图版时三种读取器逐行相同（曲线只有 1~2px），
  换扫描件（宽墨块）才分离出 78px 与 9.5px。

基线不红有两种可能：代码没变，或判据看不看那里。这两种必须分开确认，不能默认为前者。

**② 快照粒度二选一，理由写进模块 docstring。**

| 输出体量 | 存什么 | 现状用例 |
| --- | --- | --- |
| 小（几十到几千个标量） | 全值逐字段比对 | project_load / lipd_export / column_scale |
| 大（矩阵、逐行序列） | sha256 前 16 位摘要 + 首末样本 + 结构计数 | age_ensemble 的 64×N 矩阵、digitize 的 637 点序列 |

摘要式基线的报错必须同时打印诊断块（阈值、拐点数、包络失配等），否则红了只知道「变了」。

**③ 稳定性三件套：路径、时间、随机。**

- 路径只存 `basename`：`image_path` 是绝对路径时，基线在 CI（D:\a\...）上必红。
- 时间戳剔除：`.tar` 的 `manifest.json` 里 timestamp 每次不同，比对前 pop 掉。
- 随机固定 seed，且**连生成两次逐字节一致**才允许入库（11 份都做了这一步）。

**命名**：环境变量 `UPDATE_<TARGET>_GOLDEN`，fixture 放
`tests/unit/fixtures/<target>_golden.json`，模块 docstring 末尾写「重新生成」命令。14 份 golden 目前无一例外。

> 拆分前的前置检查（本会话亏了两次全量套件才学会）：先
> `grep -rn "<被拆函数名>" tests/ support/ scripts/` 列出那些**扫源码文本**的判据
> （枚举闭集、元素 id、裸阶段数字），它们会因函数边界变化而红；把这批判据的更新当成
> 拆分动作的一部分，而不是等红灯教一遍。
## 9 已知缺口（含已修与未修）

前几行是**已修并已钉住**的（保留在此，因为它们说明了"为什么需要这条门禁"）；
其余是**测试策略想抓、但当前还抓不住**的既有问题，按"只报不改"登记：

| 缺口 | 位置 | 为什么危险 |
| --- | --- | --- |
| 导出失败被静默吞掉 | ~~`main.ts:1922`~~ **已修（2026-09-29）** | 原实现捕 `core.exportData` 失败后只 `console.warn`，再打开一个**空**的导出面板：直接违反不变量 1，用户会以为是自己没做分列，实际是后端/契约坏了；且 `console.warn` 不在门禁覆盖范围内（门禁只认 `console.error`），**改前没有任何一层会红**。已改走同文件 `main.ts:63` 的 `reportBackendFailure`，并**不再打开空面板**（报错后停在原地）。 |
| `export.csv` 空载荷静默回退 | `PropertyPanel.ts:617` 当返回非字符串时回退到 `textarea.value` | 与历史 `x_bounds`/`data_xlim` 事故同型：用"看起来正常"的内容掩盖契约破裂。 |
| 就绪清单字段硬编码（**已修，2026-11-06**） | `components/steps/ExportReadinessPanel.ts` + `components/ExportModal.ts` | `dataCsvEqualsPrimary: true` 是写死的常量，DOM 属性 `data-data-csv-equals-primary="true"` 与文案 `DATA_CSV_EQUALS_PRIMARY=true` 同样写死——**三项都无法被证伪**，断言它等于没断言。已全部删除：面板只保留能真算出来的 `data-sheets` / `data-primary` / `data-readiness-missing`；「data.csv = 主 ROI」这条真实不变式由后端按 `primary_roi_id` 生成并在 `export.spec.ts` 用 tar 逐字节比对验证。反向钉子：该属性与文案**不得再出现**（首跑对旧构建变红，证明有判别力）。 |
| 汇总失败只 `console.warn` | ~~`QaPanel.triggerSummarize`~~ **已修（2026-09-29）** | 原实现手搓 JSON-RPC 信封、失败只 `console.warn`，面板数字静默停在默认值。**实测后果比"缺个提示"严重**：注入 `qa.summarize` 失败后 banner 仍显示绿色的「🟢 地学校验门禁通过，数据符合规律」——等于在后端没算出来的情况下向用户宣告**科学结论已通过校验**。现已改走共享 `RpcClient`，失败把 banner 切红并写明原因；回归钉子在 `error-surfacing.spec.ts`（已过金丝雀：还原旧实现后该用例确实变红）。 |
| 前端 TS 类型与真实 payload 不一致（**反向判据已补，2026-11-06**） | `frontend/e2e/contract.spec.ts` + `frontend/src/types/pollen.ts` | 原来只有单向判据「真实 payload ⊇ 必填声明」，**反向（payload 里有、TS 没声明）抓不到**——多发的键前端读到它时类型系统零保护，改名也不会有编译期提示。已补 `auditNothingUndeclared`：DiagramData / DepthCalibration / DataRoi / Column 逐个键反查声明，例外必须登记（`KNOWN_WIRE_ALIASES` 驼峰侧、`CLIENT_OWNED_FIELDS`、`PAYLOAD_ONLY_FIELDS` 且每条写理由）。**首跑即抓到真缺口**：`cleanup`（含 `stats`/`legend`/`roi_id`）后端每次都发、前端 `RpcClient.ts:434` 在读，而 `DiagramData` 里根本没声明——已补进 `pollen.ts`。登记为 payload-only 的只有 `lineRemoval`（前端零消费者）。**仍未判**：声明为可选却**永不出现**的字段（死声明）。 |
| **RPC 方法边界大面积无验证** | `straditize_core/rpc_methods/*.py`（90 个应用 RPC） | 实测：90 个应用 RPC 中，仅 **56** 个被前端 `src` 引用、**46** 个被任何测试（pytest ∪ e2e）按方法名字面量引用，余下 **44 个（49%）没有任何一层验证过它的边界**。注意"无引用"≠"死代码"：`main.ts` 的 WebMCP `callTool` 会把**任意**方法名直通 `rpcClient.call(name, args)`，所以这些方法仍可被 agent 调用，只是**没有任何测试固定住它们的参数名与返回形状**——正是 `x_bounds`/`data_xlim` 那一类失效的温床。检查 G 只能保证"前端调用的名字 ⊆ 后端注册表"，对本行这个反向缺口无能为力。 |
| **孤儿 RPC 的处置（2026-11-06 定论）** | `docs/rpc-call-evidence.json` + `tests/unit/test_orphan_rpc_contracts.py` | 全仓 105 个 RPC 逐条反查后，既无前端调用、也无测试/直调的有 **11 条**。按「先写契约判据，再谈删不删」处理，已为最像死代码的两条写出判据（4 passed）：`algorithm.extractTurningPoints`（自动提取峰谷写入控制点、且保留手工点）与 `core.getShadowLayer`（放大包络显示层，无图时 `STATE_ERROR`，有图时 `available/shadow_pixels/overlay_png`）。结论：**两条都能调通且行为具体 ⇒ 是「有能力、没入口」，不是死代码**，不删。`core.getShadowLayer` **已标对外（2026-11-06）**：spec 新增 §4.2b（六键返回体 + `-32001 STATE_ERROR` 触发条件 + "前端零引用、属对外接口" 的定性），`ALL_RPC_METHODS` 上方注明"清单只保证注册表↔声明一致、不代表有前端入口"并点名三条纯对外面，实现处 docstring 同步；新增判据"返回体每个键都必须出现在 §4.2b"（反向验证：`layers`→`layerz` 即红）。`algorithm.extractTurningPoints` **已接入口（2026-11-06）**：列属性面板新增【自动提取峰谷】按钮，走同一个 RPC，成功后以 toast 明示「更新 N 列控制点（手工点保留）」，失败走 `notifyCaught` 冒泡；e2e `inspector-turning-points.spec.ts` 钉住「按钮可见、真发该 RPC、已有控制点一个不丢」。该 e2e **不**声称点数必然增加——算法是把峰谷**合并**进现有控制点，铺满控制点的列可能一个都不新增（实测 32→32），写入语义由 `test_orphan_rpc_contracts.py` 在干净列上钉住。其余 6 条属协议/agent 面（`ping`/`shutdown`/`notifications/initialized`/`webmcp.listTools` 等）或自动化面（`agedepth.generate*Script`/`component.uninstall`），不该按调用量删（2026-11-06 定性时**顺手查出两个真缺陷并已修**：`component.uninstall` 的 name 可路径穿越 → 现在 RPC 边界白名单校验、`agedepth.generateBaconScript` 空测年也返回「纯先验」脚本 → 现在 -32602 拒绝；判据在 `test_orphan_rpc_contracts`）。`core.reset` 与 `ensemble.add` **也已定性（2026-11-06）**：前者是「出厂重置」（重跑 `__init__`，连图像/元数据一起清；与逐字段清的 `project.new` 语义不同），后者是集成表的对外导入通道（原生生产者是 `agedepth.*` 三处）。两者都补了契约判据（重置后会话仍可用；add→list 可见且同名覆盖）。**并撤回两条错判**：集成表选项并非永远为空（实际是禁用 + 有说明），也不是只能由 agent 导入（agedepth 会自动登记）。**方法论**：grep 判死不可信——本表用「RPC 字面量 + RpcClient 方法名链式调用」双轨匹配才抓全 `FileLoaderService.detectDeskew()` 这类无字面量调用。 |
| 契约文档与实现漂移 | `docs/JSON_RPC_SPECIFICATION.md` §3 / §4.1 / §4.7 | **已修（2026-09-29）**。§3 曾把 `-32002` 记作 "File not found"、`-32004` 记作 "Export error"，而 `protocol.py` 与前端 `errorCodes.ts` 一致地把它们定义为 `CONFLICT_ERROR` / `FILE_ERROR`（`protocol.py` 保留了三个**旧语义别名常量**，数值早已重新指派，文档跟着别名走了）。这会让一次**命名冲突**被渲染成"文件不存在"。§4.1 漏了 `page_number`、错写"三者必须给出其一"、且没提 `loadImage` **会自动建 `pollen` ROI** 这一副作用；§4.7 完全没提多 ROI 的 `roi_id`。已在文首加"权威范围"表并逐条修正。 |
| **上传端点无 e2e 覆盖（已补）** | `AgeDepthModal.handleOfflineZipUpload` | 原实现不查 `res.ok`，把错误响应里的 `undefined` 当 `zip_path` 继续调用 `component.installOfflineZip`。实测用户拿到的不是"上传失败"，而是后端的 `参数绑定失败: missing a required argument: 'zip_path'` —— 一次**错位诊断**。现已收进 `RpcClient.uploadFile()`（查 `ok` + 校验路径非空），回归钉子在 `error-surfacing.spec.ts`（已过金丝雀）。 |
| **旧去线模型残留（已清，2026-09-29）** | `Inspector.ts` / `Toolbar.ts` / `Viewport.ts` / `RpcClient.ts` | 上一轮删掉 S2「去线灵敏度」面板时只删了 **HTML**，5 个 `querySelector` 监听（`#select-inspector-degrid` / `#chk-degrid-vertical` / `#btn-linefix-erase` / `-restore` / `-clear`）全部留在 `bindEvents()` 里。因为都带 `?.`，**永远不会报错**——正是"一个从不失败的门禁"在代码里的同构形态。同时 `algorithm.degrid`（档位 + `corrections`）与现行的 `applyLineRemoval`（geometry + `strokes`）两套去线模型并存，笔刷笔迹被写进**旧**模型的 `lineCorrections`，而当前模型的 `line_strokes` 恒空。现已整体下线旧模型：删 `lineCorrections` / `degridStrength` / `DegridResult` / `setDegridStrength` / 5 个死监听，笔刷改道 `algorithm.applyLineRemoval` 的 `strokes`，并把「擦掉误标 / 补回漏标 / 清空笔迹」三按钮恢复到步骤 4 的 `CleanupPanel`。 |
| **`algorithm.degrid` 前端零调用（已定性为对外接口，2026-11-06）** | `straditize_core/rpc_methods/cleanup.py:10` + `session_parts/core.py` `algorithm_degrid` | S2 面板下线后前端确实无调用方，但它**不是死代码**：WebMCP `callTool` 可直达，且 `stats.degrid_removed_pixels` 只有经它才非零。**原登记里两条判断已证伪并更正**：①「改它或删它测试不会红」——`tests/integration/test_rpc.py:1105` 早就按 RPC 名断言返回体；②「结构性常量 0」——该值是 `(raw_ink & degrid_line_mask).sum()`，掩膜由 `core.py:2020` 写入，界面上恒 0 只因无人调用。已补钉子 `tests/unit/test_degrid_external_contract.py`：经 dispatcher 调一次 → 掩膜非空 + `degrid_removed_pixels > 0`；反向验证：摘掉那句掩膜赋值 → 两条同时红。 |
| **`stats.degrid_removed_pixels` 的消费者已消失（键保留）** | `session_parts/cleanup.py` `_recompose` | 前端零消费者（`grep degrid_removed_pixels frontend/` 为空），但它对外部客户端是有意义的真实量（见上一行），故**保留不删**。注意它是 `raw_ink & degrid_mask` 单源统计，与 `final_removed_pixels`（并集，不可归因）不是一回事——写测试时别拿它当「清理掉了多少」。 |
| **「清空笔迹」不真的清后端（已修，2026-09-29）** | `frontend/src/main.ts` `onClearLineFix` | 原实现只把前端镜像 `data.line_strokes` 置空，再调 `recomposeCleanupState()` —— 后者发的是 `RpcClient.refreshCleanup`，即**不带 `strokes`** 的"只重算"请求，而后端 `apply_line_removal` 的语义是 `strokes is None` → **保持原值**。于是后端把笔迹原样发回来盖掉镜像：HUD 提示"已清空"、镜像瞬时归零，**掩膜一点没变**。同属"看起来生效"型失效，且改前**没有任何一层会红**（旧套件只断言 DOM）。现改走 `setLineStrokes([])`（与画笔落库同一通道，失败照常 `reportBackendFailure` 冒泡）；回归钉子 = `workflow-panels.spec.ts` 步骤 4 笔刷用例，旧实现下它红在 `[1, 4424]`。 |
| **全量 e2e 偶发假红：`net::ERR_NO_BUFFER_SPACE`（未定位）** | `helpers.ts:81` `gotoApp` 的 `waitForFunction(__straditize)` | **症状具有误导性**：随机某个用例在 `resetBaseline → page.goto('/')` 处 30 s 超时，同时门禁报出唯一一条 `console.error`：`Failed to load resource: net::ERR_NO_BUFFER_SPACE`，于是**看起来像那个用例的产品缺陷**。实测连续两轮全量各红一条**不同**的用例（`qa.spec.ts:122`、`contract.spec.ts:233`），单独跑均稳定绿；报错发生在 SPA 自身 asset 加载阶段、任何产品代码执行之前。**已排除**：系统内存（失败时实测 42.8 GB free / 63.9 GB）、测试逻辑、后端（后端日志无异常，该轮 RPC 全部成功）。净机重跑 **34 passed / exit 0**。**疑与 OCR 每次重载模型（见下一行）造成的瞬时资源峰值有关，但未证实。** 缓解：跑前确认无残留 88xx 后端——⚠️ `pixi run python … &` 泄漏的**子进程不会被 `kill $BG` 杀掉**（本次实测泄漏了一个持 2339×1654 会话的后端，须 `taskkill //PID` 收尾）。**第三种表现形式（2026-09-29 实测）**：不再是 `goto` 超时，而是**该用例的控制台门禁**先抓住它——`qa.spec.ts:122` 报 `consoleError` 不为空，内容是 `Failed to load resource: net::ERR_NO_BUFFER_SPACE` **加上**由此派生的两条 `[QA] qa.summarize 失败: … 与后端的连接已断开`。此时症状更像"产品缺陷"（面板真的没算出来），但后端日志**无任何 traceback**、该用例单独跑稳定绿（本轮实测 `1 passed`）。判据：见到 `ERR_NO_BUFFER_SPACE` 一律先单独复跑该用例，不要顺着派生错误去查产品。**第四种表现形式（2026-11-05 实测）**：`export.spec.ts:252` 在 `openApp → gotoApp` 处 45 s 超时，门禁抓住的唯一 `console.error` 是 `[bootstrap] 初始工程数据获取失败: 与后端的连接已断开` —— 症状同样像产品缺陷。单跑该 spec **16.6 s 通过**（`1 passed`）；当轮改动只是后端 `age_depth_tracer.py` 的纯函数拆分（golden 逐元素等价 + 693 条后端测试全绿），与该用例无交集。判据同上：**先单独复跑**。 |
| **OCR 每次调用都重载 PP-OCRv4 ONNX 模型（已修，2026-09-29）** | `straditize_core/session.py:3542` → `ocr/engine.py:157` | 原实现 `session.py` 每次调用都 new `OcrTaxaRecognitionEngine`（连 `ocr_get_taxa_dict` 读词表都实例化一次引擎），构造函数 `_init_models()` 每次重新 `ort.InferenceSession(...)` 读盘分配两个模型（一轮 e2e 出现 55 次加载日志）。**已修**：`OcrTaxaRecognitionEngine` 增加进程级 `_MODEL_CACHE` 单例缓存，`ocr_get_taxa_dict` 改直接用 `PollenDictionary`；实测 4 条模块 E2E 全程仅加载 1 次模型，由 `test_ocr_engine_caches_onnx_sessions_singleton` 锁死。 |
| **`_recompose` 的返回体不声明 `exclusion_regions` / `line_strokes`（已缓解，结构性缺口仍在）** | `straditize_core/session_parts/cleanup.py` `_recompose` | 它只返回 `candidates`/`selected_ids`/`stats`/`overlay_png`，而 `clear_cleanup_edits` 的语义**包含**清掉整步的排除区与笔迹 ⇒ 返回值与动作语义不匹配，前端 `applyCleanupState` 只覆盖认识的四个键，于是"后端已清、界面还在显示"（步骤 4 第 11 号缺陷）。已在 `main.ts` 的 `onClearCleanupEdits` 里做镜像补偿并留注释，但那**只是这一处的补丁**：任何新的 `_recompose` 消费者都会重新踩到同一个坑。根治要么让 `_recompose` 把这两项一并返回，要么让该动作返回一个"已清空"的明确信号——属后端契约改动，未做。门禁钉住了当前这一处（`step4-cleanup.spec.ts` 用例 6）。 |
| **后端参数校验的错误码不统一（清理几何已修，2026-11-06）** | `session_parts/cleanup.py` 四个几何方法 | 原实现 `upsert_line_geometry` / `set_line_geometry_status` / `set_line_thickness` / `delete_line_geometry` 的输入校验一律 `raise ValueError`，经 dispatcher 兜成 **-32603 后端内部错误**并提示「请查看服务器控制台日志排查」——**用户输错一个厚度**却被报成服务端故障。已改为 `JsonRpcError(INVALID_PARAMS, …)` 且文案带上越界字面量；钉子 `tests/unit/test_cleanup_error_codes.py`（九条非法输入走 dispatcher，断言 -32602 / 文案含具体值 / 状态不变），`test_line_removal_v2` 的越界用例同步改绑错误码。**未做**：在 dispatcher 层把 `ValueError` 全局映射成 -32602——算法内部真异常仍应报 -32603，不做一刀切。 |
| **`final_removed_pixels` 不可归因（测试选统计量时必读）** | `session_parts/cleanup.py` `_recompose` | 它是 `raw_ink & grid_line_mask`，而 `grid_line_mask` 是**并集**：`candidate_line_mask(=已确认几何) | degrid_line_mask | exclusion | strokes`。所以"确认一条几何后它变大"**不能**证明是那条几何干的（任何一路变化都会让它变大）。可归因的是 `geometry_removed_pixels`（掩膜只按 `statuses={REMOVED}` 构建）：检测后恒 0、确认后才 >0。这不是缺陷而是**统计量语义**，但足以让不读源码的人写出一条恒真的断言，故登记在此。 |
| **导出「缺行」= 0，不是插值（2026-11-07 定论）** | `session_parts/export.py` `_export_value_columns` + `digitize._read_column_profile` | `digitize` 遍历列窗口的**每一行**，只有该行真有墨迹才产出点 ⇒ 窗口内缺行 = 该行无墨迹 = 零丰度，导出填 0 点是**正确**语义。曾有一轮提议「缺行改插值」，实测证明那是**编造**：构造 10px@行10、50px@行20 的曲线，行 15 无墨迹，插值给出 30% 而真值是 0%。判据 `tests/unit/test_export_missing_row_semantics.py` 钉死（反向验证：改成 `np.interp` → 30.0 ≠ 0.0 立刻红）。**仍未处理**：窗口**之外**的层位（粘贴深度超出取数区）目前也给 0，语义上是「不在本列读数范围内」，应给 `None`——需要按列窗口判定。 |
| **网格采样对「曲线范围外」的层位做端点 clamp（2026-11-08 记录，未改）** | `session_parts/export.py` `extract_grid_values` | `np.interp` 会把超出曲线行范围的层位**夹到端点值**，而导出 CSV 对同类层位现在给 `None`（见上一条）。两者语义不同：网格这条有 e2e 明确断言「已标定列必须给数」（`verify_straditize_pro_e2e.py:321`），故本轮**保留 clamp、不动**。风险写清：曲线只画了剖面中段时，范围外的层位会重复端点读数，看起来像真实测量。要不要改成 `None` 属产品判断（会引入网格空洞），未决。 |
| **粘贴深度：入口在步骤 7，落库走 samples（2026-11-08）** | `components/steps/SamplesPanel.ts` + `samples.pasteDepths` | 原来后端 `samples.pasteDepths` 完整可用（含未标定时 `-32001` 指路步骤 3），前端却把粘贴结果写进 **client-owned** 的 `calibration.customDepths`：后端从不认识它、刷新即丢，导出仍按「逐行点并集」出行。现在入口在步骤 7（`SamplesPanel`），走 `samples.pasteDepths` 落库成 `samples(source="paste")`，导出的行随之变成这些深度；面板同时显示「深度分辨率 ≈ X cm/px」（深度→行只能落到整数行，1px = 一个分辨率）。`customDepths` 已从前端整体删除（类型 / ProjectManager / SplineInterpolator）。判据 `e2e/step7-paste-depths.spec.ts`：粘贴 20/40/60 → 后端 samples 三条 paste → 导出 CSV 的 depth 列恰好是 [20,40,60]。反向验证：RPC 名改错 → 判据红（且遥测抓出未处理的后端失败）。注意 `data.samples` 是 client-owned（`getDiagramData` 不下发），读后端真相要用 `samples.list`。 |
| **步骤 6 画布：齿的间距来源 & 组归属条（2026-11-09）** | `components/canvas/tickGeometry.ts` + `columnBoundaries.ts` | 齿原来只认组级 `ref_span_px`（用户确认值）。用户刚进步骤 6 时它是 null，于是**一条齿都不画**，而面板写着「检测: 4 列 · 刻距 124.5px」——「点一个刻度齿」无从点起。现在齿的**位置**取「确认值 > 实测刻距（`algorithm.measureRuler` 的 `median_spacing_px`）> 不画」，读数含义仍只在用户确认后存在；面板测完要让画布重画（`setTickRedrawHook`），否则递了值也不生效。同时新增**组归属条**：≥2 组时每列上方一条组色横条、每个连续段首列写组名（单组是噪声，不画）。**盲区**：齿的可视性没有可靠的像素判据——底图自带水平虚线阴影，把间距强制成 null 后判据仍绿（三版都栽在这），已撤掉那种判据，改由纯函数单测钉「间距来源」，可见性靠人眼验收；组带判据带 A/B 对照（并回同组后颜色必须一致），反向验证过。 |
| **草稿恢复把 legacy 占位写成了标定端点（已修，2026-11-08）** | `frontend/src/core/draftPayload.ts` + `ProjectManager.draftToProjectPayload` | 前端恢复草稿时对**未标定**列写 @@x_values = [startValue, tickValue]@@（legacy 占位，默认 0→100 / 0→20）。后端 `resolve_column_scale` 的 Case A1 只要看到「组 tick_layout + 列 x_values」就判 `calibrated=true`，于是恢复草稿后这些列**开始出数**，且是一整表看起来正常的百分比（实测第二行 `233,68.4211,67.5676,…`）。已修：该判断抽成 `draftColumnXValues()`，未标定返回 `null`（真标定照搬 x_ticks 端点）；判据 `frontend/test-roi-calibration.mjs` 第 11 条（反向验证：返回占位端点即红）+ `tests/unit/test_no_fabricated_calibration.py`（后端契约：x_values ⇒ calibrated；x_values=null + legacy ⇒ 未标定且导出为空）。**全路径巡检结论**：导出/网格/画布/点检查器/导出预览都按 `calibrated` 门控，QA 有意宽松但面板显式标注「N 列未标定、不出数、导出记为空」——除本处外没有第二条能用占位刻度出数的路。 |
| **并发压测打坏原生内存 → 全量 pytest 挂死（已修，2026-11-05）** | `tests/unit/test_dispatcher_serialisation.py` 的无锁对照 | 该用例故意把 `_request_lock` 换成空实现，让 3 线程并发打同一 session：writer 在 `load_image` 里重建 numpy/PIL 数组，两个 reader 同时读。`faulthandler` 抓到 **Windows `access violation`**（线程分别停在 `protocol.py:337`、`protocol.py:299`、`session_parts/core.py:485`），主线程卡在 `thread.join(timeout=90)` 上，两轮共 180 s 起 —— 全量 pytest 因此在 **41%（第 285/696 例）** 上多花 3~5 分钟（**不是挂死**，早期误判为挂死是因为只观察到 100 s 无输出），CI 会明显变慢；子进程**能跑完**（实测 reads 1721 万 / torn 1714 万 / stuck 0，3~5 分钟）但同样不适合进常规套件。判据没退让：无锁对照改用纯 Python 的 `_SlowFakeSession`（`load_image` 分两步 + 睡 2 ms），仍稳定观测到撕裂；真实 session 上的同一件事保留为手动探针 `tests/unit/_dispatcher_race_probe.py`。修后该文件 **9 passed / 14.6 s**。 |
| **Ctrl+Z 撤销不了清理编辑**（`②` 复活画笔后由"不可达"变成"可达"）**已修（2026-09-29，方案 b）** | `frontend/src/core/HistoryManager.ts` + `main.ts` `applyHistorySnapshot` | `history.push()` 的快照只含 `columns`/`calibration`/`roi(s)`，**完全不含** `line_candidates` / `exclusion_regions` / `line_strokes`；`onUndo` 也只调 `applyHistorySnapshot(prev)`（它只在有 `roi` 时 `commitRoi` 让后端按新范围重算，笔迹仍用后端**自己那份**）。后果：涂抹一笔后按 Ctrl+Z，撤销栈里**确实多了一条**记录（如 `Clear Line-mask Corrections`），按下去却只还原 ROI/列，**笔迹与掩膜原样保留**——用户看到"撤销无效"，且栈深度被虚假占用。修法**已定并已实施（2026-09-29，方案 b：清理编辑不再 `push` 历史）**：上游原版 `straditize/straditize/` **完全没有撤销机制**（`grep -rn "def undo\|QUndoStack" → 0 命中`），所以撤销是本项目自创的、其快照**刻意只覆盖前端自有模型**；清理编辑的回收出口是本步显式提供的「清空笔迹」/「清空本步编辑」按钮。仍存的设计缺口：**逐笔撤销**（涂错一笔只能全清重涂）——技术上可行（后端 `setLineStrokes` 是**全量覆盖**，撤销一笔 = 推 `strokes[:-1]`，仅 1 次 RPC），但需要 `HistorySnapshot` 扩字段 + 决定哪些动作入栈，属产品决策，未做。 |
| **`session.taxa_names` 是一个按下标索引的扁平列表，扛不住多 ROI 重排（半修，2026-09-29）** | `straditize_core/session.py` `detect_columns:901` + `rpc_methods/naming.py` `rename_column` | 列名有**两个**存储：列对象上的 `columns[i]["name"]`（前端/导出实际读的）与 `session.taxa_names`（一个 `list[str]`）。重新分列时 `detect_columns` 会**从 `taxa_names` 反写回列对象**，于是两边不一致时以 `taxa_names` 为准——而它按下标索引。**已修的半边**：还原循环原先用**本 ROI 局部**下标读，而写入点与另外三个读取点用**全局** `col_index` ⇒ 多 ROI 时差一个 `len(other_cols)`，右 ROI 重新分列会读回左 ROI 的名字（pytest 已钉住：`test_multi_roi_column_names_follow_global_col_index`）。**未修的半边（结构性）**：`col_index` 本身由 `merged_cols = other_cols + detected_cols` **现场重排**（`session.py:914-917`），所以换个 ROI 重新分列会让**所有**列的下标平移；扁平列表无论如何都对不上，"名字跟着列走"在多 ROI 下无法保证。根治要把名字**按列 id** 存（`dict[str, str]`），或干脆**取消 `taxa_names` 作为独立存储**、以 `columns[i]["name"]` 为单一事实源并让 `detect_columns` 按 id 保留旧名。属 RPC 契约/数据结构改动，未做。 |
| **步骤面板整块重挂（焦点/输入已保，2026-11-06；架构未变）** | `frontend/src/components/Inspector.ts` `render()` + `main.ts` 八处 `updateData` | `render()` 仍是整段重写 `innerHTML`，任何「动作成功 → updateData」都会把面板连同正在编辑的输入一起换掉。**已修的是症状**：移植 `Sidebar.renderPreservingInlineEdit` 的做法——渲染前记下 `{id, value, 选区}`，重建后回填并 `focus()` + `setSelectionRange`。**只对带 `data-edit-preserve="1"` 的输入生效**（属种名、放大倍数）：对全部输入恢复会让 `#inp-roi-name` 的聚焦再次触发 `onRenameActiveRoi`，实测把 step2-roi 整条打成 60s 超时。钉子 `e2e/inspector-focus.spec.ts`——先给输入框打 `data-epoch` 标记、触发后确认标记消失（证明**确实重渲染了**，否则判据会假绿），再断焦点/值/光标；反向验证：快照恒为 null 即红。**未做**：增量更新（每面板 `update(data)` 只改字段——成本高，且漏字段会退化成「显示旧值」，比丢焦点更难发现）；未标 opt-in 的步骤面板输入（如标定框）仍丢编辑现场；IME 组合输入中被重建仍丢组合串。 |
| **放大倍数键名分裂（已修，2026-11-06）** | `session_parts/xscale.py` `store_exaggeration` + `core.py` `column_update` + `Inspector.ts` | 同一个量原来四个名字：`exaggeration_mult`（规范）/ `exaggeration_multiplier`（legacy，种子 5.0）/ `has_exaggeration`（布尔）/ `mult_source`（**只写不读、从不下发**）；payload 还同时发 `exaggerationMult`。三份状态可以互相打架，而 `px_to_value` 真会除以它。已收敛为单键：库 / payload / 工程包只有 `exaggeration_mult: float|None`；历史名字只在入口被接受并立刻归一（`store_exaggeration`），`project.load` 归一老包；`mult_source` 删除。**同时修掉两处伪造 5×**：① `Inspector` 的 `?? 5` / `\|\| 5` 兜底（勾选即写 5，而换算会除以它 → 整列读数缩小 5 倍）；② R 脚本生成器的 `Math.max(5, …)`（无人设置时脚本也按 5× 画）。**原登记里「UI 无路径可达」已过时**：`Inspector` 现在经 `column.update` 真发 RPC（e2e `step6-group-attrs` 钉住）。钉子：`tests/unit/test_exaggeration_single_key.py`（7 条，改前全红）。**`roi.applyFormDefaults` 已删除（2026-11-07）**：它属于分组设计之前的模型（把 ROI 的 `form_defaults` 批量写进每一列），而形态/尺度/放大倍数现在是**组属性**、列只是继承——留着它迟早造出「组一份、列一份」的两份状态。删除范围：实现 + 注册 + `ALL_RPC_METHODS`（105→104）+ 前端 `RpcMethod` 联合类型 + `RpcClient.roiApplyFormDefaults` + 对应 integration 测试；`form_defaults` 键本身保留（TS 注明「仅表单记忆，不参与任何计算」）。 |
| **X 轴换算链（已收口，2026-11-06）** | `session_parts/xscale.py` `read_column_values` + 两 profile | 原登记：链 L（`export_data` / `extract_grid_values`）读 legacy 三件套、链 X（XLSX/LiPD/QA）读 `x_ticks` ⇒ 同一列换个格式数字不同，且「未标定」的兜底互相矛盾。**第一步（已落地）**：`resolve_column_scale` 成为唯一解析入口。**第二步（本轮）**：读取也收敛——`read_column_values(scale, rows_px, profile=...)` 是唯一入口，`READ_PROFILE_EXPORT`（未标定整列 `None`、4 位）与 `READ_PROFILE_QA`（允许粗算、全精度）两个**命名** profile 把差异写死在一处，四处调用点的重复拷贝全部删除。判据 `tests/unit/test_export_chain_equality.py`：①CSV/TAR/XLSX/LiPD/网格在同一 (列,行) 逐位相等且 `depth` 对齐；②未标定列四路全 `None` 而 QA 仍有数；③两 profile 在已标定列只差取整。**局限（反向验证暴露）**：①抓不到「策略改错」——四路一起变，相等仍成立（只有③能红）；③抓不到「某一路另写一份」。两条判据覆盖两种失效模式，缺一即半边盲区。**未做**：QA 精度与导出统一（有意不同，现已显式命名，不必统一）。 |
| **`column_remove` 删中间列后点数据错位（取数张冠李戴）（已修，2026-09-29）** | `straditize_core/session.py` `_reindex_columns` / `column_remove` / `roi_remove` | 新增 `_reindex_columns` 在 `column_remove`、`roi_remove`、`detect_columns` 时按存活列的原 `col_index` 同步搬移 `column_points`、`control_points`、`reader_types`、`x_scales` 与 `taxa_names`，前端 `#btn-col-delete` 接入 `column.remove` RPC；由 `test_column_remove_migrates_point_stores_and_taxa_names` 钉死。 |
| **列级 `unit` / `plot_type` 后端只写不读，载荷还把 `unit` 硬编码成 `"%"`（已修，2026-09-29）** | `rpc_methods/system.py` + `metadata/exporter_lipd.py` | 列载荷与 LiPD 导出均已改为经 `resolve_column_scale` 读取真实 `unit` 与 `plot_type`。 |

## 10 Discovery lane（随机状态机探索）

回归 lane（`frontend/e2e/*.spec.ts`）回答的是「**我们想过的那些路径还对吗**」；
它有一个结构性盲区：**没人想到的路径永远不会被走到**。Discovery lane 补的就是这一块——
用确定性随机种子在真实 UI 上乱走，把状态机里"人真会碰到、但没人写用例"的路径踩一遍。

它**不是**回归套件：没有固定断言序列，失败即报警并保留证据，由人判断是产品缺陷、
还是动作选得不合理。它**不改产品代码**，也**不引入第二套 E2E 框架**——只用
`frontend/` 已有的 `@playwright/test`（`channel: 'msedge'`，真实 Edge）。

### 10.1 跑什么

状态机九个状态：

```
EMPTY → IMAGE_LOADED → ROI_READY → Y_CALIBRATED → CLEANED
      → COLUMNS_DETECTED → X_CALIBRATED → SAMPLES_READY → EXPORT_READY
```

状态**不单调**：删除 ROI / 清空层位 / 撤销都会往回推，每步都从后端权威载荷重算。

每个状态有一张「合法动作集」（`states.mjs` 的 `TRANSITIONS`），每个动作声明前置状态、
后继状态、是否危险（返回 / 删除 / 重做 / 保存重开 / 连击）。动作实现（`actions.mjs`）
**全部走真实 UI 入口**：真实 `<input type=file>` 与 `filechooser`、真实按钮点击、
真实键盘逐字事件、真实鼠标拖拽 / 右键平移 / 双击、真实画布坐标。

**禁止用 RPC 摆状态。** 只读 RPC 由一个硬白名单（`run.mjs` 的 `READ_ONLY_RPC`）在运行时
强制：`straditize.getDiagramData` / `roi.list` / `samples.list` / `qa.summarize` /
`core.getStatus` / `system.ping` / `e2e.health`。白名单外一律抛错。

`e2e.reset` 是唯一例外，且**只用于 seed 隔离**（每个 seed 前把零状态后端复位），
不参与任何业务动作。

### 10.2 seed 语义与重放

- `seed` 是**动作序列的唯一来源**：`mulberry32(seed)` 初始化 RNG，动作 = 给定状态的
  候选动作**排序后按权重抽取**。权重是常量表，所以
  「同 seed + 同动作表 ⇒ 动作序列逐条相同」是由构造保证的，不依赖 `Math.random`。
- ⚠️ **改了动作表（增删动作 / 改 `from` / 改权重）就会改变既有 seed 的序列**。
  这不是缺陷，但要意识到：老 seed 的 `seq.json` 与新种子不再可比。
- 重放命令：

```bash
# 跑一批 seed（1..20 或 1-3 或 1,2,3）
npm --prefix frontend run discovery -- --seeds=1-3 --steps=10 --port=22960

# 单 seed 重放，并与磁盘上既有 seq.json 逐条比对（不一致 = 失败，REPLAY_MISMATCH）
npm --prefix frontend run discovery -- --seed=7 --replay --steps=20 --port=22960

# 只跑 known-failures 清单里那批 seed
npm --prefix frontend run discovery:replay
```

- 需要先起**零状态**后端（探索器不负责起后端，避免与其它会话抢端口）：

```bash
STRADITIZE_ZERO_PORT=22960 pixi run python support/serve_zero_backend.py
```

端口约定：`22960` 是本 lane 的默认口，`22961` 保留给第二实例。
不要用 `8799`（回归基线）/ `22920-22930`（从零旅程）/ `22950`。

### 10.3 产物目录

落在 `.scratch/discovery/<seed>/`（`.scratch/` 已被 `.gitignore` 覆盖）：

| 文件 | 内容 |
| --- | --- |
| `seq.json` | seed、动作序列、每步前后状态摘要、末轮不变量结果、失败归因 |
| `trace.zip` | `context.tracing`（含截图与 DOM 快照） |
| `shot-<n>.png` | 第 n 步**动作前**的画面；失败时另有 `shot-<n>-fail.png`（失败后） |
| `console.jsonl` | 全部控制台消息与未捕获异常 |
| `rpc.jsonl` | 页面发起的写 RPC + 探索器的只读 RPC，各带结果与耗时 |
| `state-before.json` / `state-after.json` | 整个序列起点 / 终点的状态摘要 |
| `steps/<n>/state-before.json|after.json` | 每一步的前后完整摘要 |
| `saved-project.tar` | 若走过「保存项目」，原始归档 |

**失败保留全部产物**并写明违反了哪条不变量；**通过时默认只留 `seq.json`**
（`--keep-artifacts` 可关掉裁剪，冒烟验证目录结构时用它；`--compact` 会把通过的
`seq.json` 压成摘要）。

实测体积（seed 2，10 步）：

| 情形 | 留下的文件 | 体积 |
| --- | --- | --- |
| 失败（故意把 I4 改成恒假，停在第 8 步） | 31 个：`trace.zip` + 9 张 `shot-*.png` + `console.jsonl` + `rpc.jsonl` + `state-before/after.json` + `steps/1..8/*` + `seq.json` | `trace.zip` 10.06 MB，`seq.json` 13.5 KB，其余约 2.1 MB |
| 通过（默认） | 只有 `seq.json` | 约 15 KB |
| 通过（`--compact`） | 只有 `seq.json`（摘要形态） | 219 B |

⚠️ 关于「摘要 ≤ 200 字节」：**10 步就已经 219 字节**，因为摘要里最占地方的是
动作 id 列表本身（`double_click_canvas` 这类长名字 10 条约 170 字节）。
`--steps` 允许到 30，摘要必然远超 200 字节。只有"摘要里不放动作列表"才可能达标，
但那样又毁掉「同 seed 两次序列可比对」这条证据。**这里选择保留动作列表**，
体积以本表实测为准；要卡死 200 字节请改用更短的 action id（那会让 `seq.json`
不再自解释，收益不抵成本）。

动作失败不得静默跳过：按钮不存在或不可见记 `ACTION_UNAVAILABLE` 并记录 selector 与原因，
点了但没生效记 `ACTION_FAILED`，两者都**不算通过**。

### 10.4 与 regression lane 的分工

| | regression lane | discovery lane |
| --- | --- | --- |
| 判据 | 写死的断言，语义「这条路径必须仍然对」 | 6 条不变量 + 动作成败，语义「随机路径上不许出现这些坏形状」 |
| 起点 | 基线（预载 hoya）或零状态 | 零状态 + `e2e.reset` |
| 覆盖 | 已知路径，深且窄 | 未知路径，浅而广 |
| 失败含义 | 产品退化了 | 要么产品缺陷，要么动作表不合理，**需人判** |
| 产物 | `test-results-<port>/` | `.scratch/discovery/<seed>/` |
| 何时跑 | 每次改动 + CI | 随机制动跑；PR 只跑 known-failures 清单 |

六条机检（`invariants.mjs`）：
① 无未捕获异常 / `console.error`；② 前端活动 ROI == 后端 `active_roi_id`；
③ primary / active 指向仍存在的 ROI；④ 所有列的 `roi_id` 都存在；
⑤ 删除后该 id 不再出现在任何状态里；⑥ 保存 → 重开后关键状态一致。

其余**刻意不做机检**的项（及其理由）写在 `invariants.mjs` 的 `MANUAL_ONLY` 注释里：
三种平移手势等价、画布像素层面"该层真的画了"、列内曲线数值正确性、撤销栈深层一致性、
并发/时序类缺陷、导出归档内容正确性。共同点是：要么缺一条可证伪的观测，
要么已被既有回归用例覆盖，硬塞进来只会制造无法归因的红灯。

### 10.5 PR 只跑「最近失败 seed 清单」

全量随机探索不适合每次 PR 都跑（慢且噪声大）。CI / PR 只重放**已知会失败的 seed**：

- 清单文件：`frontend/e2e/discovery/known-failures.json`，初始为空数组 `[]`。
- 探索器每次运行结束会**自动维护**它：失败的 seed 加入、通过的 seed 移除。
- PR 侧命令：`npm --prefix frontend run discovery:replay`（等价于只跑清单里的 seed）。
- 清单为空 ⇒ 直接退出，不启动浏览器。
- 修好某个 seed 后，重放通过会把该 seed 自动移出清单——**清单必须能自己变短**，
  否则它会退化成一份没人清理的忽略列表。

### 10.6 已知局限（写清边界，避免把绿灯当全覆盖）

1. **深状态靠步数堆。** `--steps=10` 的实测覆盖是
   `EMPTY / IMAGE_LOADED / ROI_READY / Y_CALIBRATED / COLUMNS_DETECTED`；
   `CLEANED` 需要进第 4 步且真的点一次「确认去除」，`X_CALIBRATED` 需要进第 6 步手工
   写刻度，`EXPORT_READY` 需要第 7→8 步。26 步的实测能到 `SAMPLES_READY`，但仍可能
   整轮绕过 `CLEANED`（那一步的候选集很大）。要稳定覆盖深层状态就得加步数，
   而加步数会让单条序列跑到 3 分钟以上——这是刻意保留的取舍，不是遗漏。
2. **没进动作表的入口**（因此完全没被随机走过）：列删除（要先在 Inspector 里选中一列）、
   清理笔刷涂抹 / 排除区拖框（画家式拖动，判据难以与"拖歪了"区分）、
   年龄-深度模型弹窗、OCR 审阅弹窗、导出面板各格式下载。
3. **I2 只在第 2 步生效。** 其它步骤第 2 步面板不在 DOM 里，读不到"界面认为的活动 ROI"，
   该步记 `skip`（不是 `pass`）。
4. **写 RPC 失败要分两种。** 后端拒绝且前端已经 toast / 弹窗告知用户 = 产品在正确工作，
   记 `OK_RPC_REJECTED_SURFACED`（观测项）；后端拒绝但用户毫不知情 = 违反不变量 1，
   记 `RPC_WRITE_FAILED` 并中止。判"是否告知"靠页面上的通知通道采集，理论上存在
   "用户看到通知但采集器没抓到"的漏判，未做反向验证。
5. **`trace.zip` 会长。** 10 步约 10 MB，因为 `screenshots: true` + `snapshots: true`；
   通过时会被裁掉，失败时才留下。
6. **只用零状态后端 + 真实 Edge。** 基线（预载 hoya）后端跑本 lane 时 `e2e.reset`
   不存在，脚本会直接报错退出并指名端口——这是刻意的快速失败。

### 10.7 等待纪律：条件优先，`heuristic_wait` 必须自曝

初版在每步动作之后有一句 `await page.waitForTimeout(80)`。那是**固定 sleep 当同步用**，
正是本仓明令禁止的假绿来源：短了会把**半完成状态**读成 PASS，长了则掩盖"动作早就结束"。
已全部替换，规则如下。

**① 页面侧的 `/rpc` 在飞计数（默认等待）。**
`run.mjs` 的 `addInitScript` 包一层 `window.fetch`，只包 `pathname === '/rpc'`：

- 不包 `/events`（SSE 长连接）——算进去会让计数永不归零，quiescence 变死等；
- 减计数发生在 **body 被读完之后**（`res.clone().text()`），不是响应头到达时。
  `fetch()` 的 Promise 在响应头就 resolve，而业务代码是 `await res.json()` 之后才动状态；
  在响应头处减，"安静"会早于数据落地，读到的仍是半完成状态；
- 采样由 `requestAnimationFrame` 驱动，**连续两帧**都为 0 才算安静；不是定时器轮询。
- 帧预算（1800 帧）只是防"某个请求永不返回把整轮挂死"的兜底：耗尽即判
  `QUIESCE_TIMEOUT` **失败**，不允许"差不多得了"。

**② 多阶段落地用"镜像稳定"当判据。** 打开项目（解 tar → 换图 → 建 ROI → 面板整块重挂）
没有单一统计量，用 `waitForStableFront`：连续两次采样 `{stage, ROIs, 列数, 图尺寸, 标定}`
完全相同才收敛，且顺序必须是**先等安静、再等稳定**（反过来会在"请求未回、镜像暂时没变"
的空窗里判稳定）。

**③ 动作级等待同样不许 sleep。** `undo`/`redo` 改成等安静（它们可能发 0 个也可能发 1 个
RPC）；`run_qa` 原来的判据是"`#qa-banner` 存在"，而横幅在点击前就已渲染 ⇒ 恒真、等于没等，
现改成「安静 + 横幅内容非空」并记录 `qaTextChanged`。

**④ 五个动作确实无法条件化，标 `heuristic_wait` 并逐步写进 `seq.json`。**

| 动作 | 为什么不可条件化 |
| --- | --- |
| `fit_view` | `F` 幂等且不发 RPC：已适应屏幕时再按，视口三元组一个字节都不动 |
| `zoom_in` / `zoom_out` | 缩放有上下限，已到极限时 `scale` 不变，"变了"不是恒成立的判据 |
| `pan_canvas` | 平移在图像边缘被钳制，`panX/panY` 可能一格不动；纯 canvas 手势无 RPC |
| `double_click_canvas` | 双击语义随工具模式变化（加控制点 / 放大 / 无动作），无单一后端量可证"已处理" |

这五个动作的等待是 `requestAnimationFrame` 两次帧边界（不是毫秒数），`seq.json` 里每步有
`waitMode: "heuristic_wait" | "condition"` 与 `quiesce: {quiet, frames, inflight}` 可查；
其余 24 个动作是 `condition`。

**⑤ 机制必须自证活着。** 若整轮 `__discRpcWrapped === 0`（应用的 RPC 不走 `window.fetch`），
`waitForQuiet` 实际退化成了帧边界等待——这时 `seq.json` 会出现
`observations[O3] = inert`，明确写出"本轮不该被当作有条件的同步来信任"，而不是静默装成有等待。

**实测（2026-11-09，seed 1，10 步）**：`inflightWrappedRpcs = 9`（确实包到 9 次 `/rpc`）；
第 10 步 `apply_ycalib_next` 的 `quiesce.frames = 52` —— 旧实现会在 80 ms 处直接读状态，
而真实请求还在飞，那一步读到的是半完成镜像。这一条就是这次改动的收益。
