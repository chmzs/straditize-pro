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

## 9 已知缺口（含已修与未修）

前几行是**已修并已钉住**的（保留在此，因为它们说明了"为什么需要这条门禁"）；
其余是**测试策略想抓、但当前还抓不住**的既有问题，按"只报不改"登记：

| 缺口 | 位置 | 为什么危险 |
| --- | --- | --- |
| 导出失败被静默吞掉 | ~~`main.ts:1922`~~ **已修（2026-09-29）** | 原实现捕 `core.exportData` 失败后只 `console.warn`，再打开一个**空**的导出面板：直接违反不变量 1，用户会以为是自己没做分列，实际是后端/契约坏了；且 `console.warn` 不在门禁覆盖范围内（门禁只认 `console.error`），**改前没有任何一层会红**。已改走同文件 `main.ts:63` 的 `reportBackendFailure`，并**不再打开空面板**（报错后停在原地）。 |
| `export.csv` 空载荷静默回退 | `PropertyPanel.ts:617` 当返回非字符串时回退到 `textarea.value` | 与历史 `x_bounds`/`data_xlim` 事故同型：用"看起来正常"的内容掩盖契约破裂。 |
| 就绪清单字段硬编码 | `ExportReadinessPanel.ts:41` `dataCsvEqualsPrimary: true` | 该属性永远为真，断言它等于没断言。 |
| 汇总失败只 `console.warn` | ~~`QaPanel.triggerSummarize`~~ **已修（2026-09-29）** | 原实现手搓 JSON-RPC 信封、失败只 `console.warn`，面板数字静默停在默认值。**实测后果比"缺个提示"严重**：注入 `qa.summarize` 失败后 banner 仍显示绿色的「🟢 地学校验门禁通过，数据符合规律」——等于在后端没算出来的情况下向用户宣告**科学结论已通过校验**。现已改走共享 `RpcClient`，失败把 banner 切红并写明原因；回归钉子在 `error-surfacing.spec.ts`（已过金丝雀：还原旧实现后该用例确实变红）。 |
| 前端 TS 类型与真实 payload 不完全一致 | `frontend/src/types/` | `contract.spec.ts` 只验"真实 payload ⊇ 声明字段"，声明里多余或失真的字段抓不到。 |
| **RPC 方法边界大面积无验证** | `straditize_core/rpc_methods/*.py`（90 个应用 RPC） | 实测：90 个应用 RPC 中，仅 **56** 个被前端 `src` 引用、**46** 个被任何测试（pytest ∪ e2e）按方法名字面量引用，余下 **44 个（49%）没有任何一层验证过它的边界**。注意"无引用"≠"死代码"：`main.ts` 的 WebMCP `callTool` 会把**任意**方法名直通 `rpcClient.call(name, args)`，所以这些方法仍可被 agent 调用，只是**没有任何测试固定住它们的参数名与返回形状**——正是 `x_bounds`/`data_xlim` 那一类失效的温床。检查 G 只能保证"前端调用的名字 ⊆ 后端注册表"，对本行这个反向缺口无能为力。 |
| 契约文档与实现漂移 | `docs/JSON_RPC_SPECIFICATION.md` §3 / §4.1 / §4.7 | **已修（2026-09-29）**。§3 曾把 `-32002` 记作 "File not found"、`-32004` 记作 "Export error"，而 `protocol.py` 与前端 `errorCodes.ts` 一致地把它们定义为 `CONFLICT_ERROR` / `FILE_ERROR`（`protocol.py` 保留了三个**旧语义别名常量**，数值早已重新指派，文档跟着别名走了）。这会让一次**命名冲突**被渲染成"文件不存在"。§4.1 漏了 `page_number`、错写"三者必须给出其一"、且没提 `loadImage` **会自动建 `pollen` ROI** 这一副作用；§4.7 完全没提多 ROI 的 `roi_id`。已在文首加"权威范围"表并逐条修正。 |
| **上传端点无 e2e 覆盖（已补）** | `AgeDepthModal.handleOfflineZipUpload` | 原实现不查 `res.ok`，把错误响应里的 `undefined` 当 `zip_path` 继续调用 `component.installOfflineZip`。实测用户拿到的不是"上传失败"，而是后端的 `参数绑定失败: missing a required argument: 'zip_path'` —— 一次**错位诊断**。现已收进 `RpcClient.uploadFile()`（查 `ok` + 校验路径非空），回归钉子在 `error-surfacing.spec.ts`（已过金丝雀）。 |
| **旧去线模型残留（已清，2026-09-29）** | `Inspector.ts` / `Toolbar.ts` / `Viewport.ts` / `RpcClient.ts` | 上一轮删掉 S2「去线灵敏度」面板时只删了 **HTML**，5 个 `querySelector` 监听（`#select-inspector-degrid` / `#chk-degrid-vertical` / `#btn-linefix-erase` / `-restore` / `-clear`）全部留在 `bindEvents()` 里。因为都带 `?.`，**永远不会报错**——正是"一个从不失败的门禁"在代码里的同构形态。同时 `algorithm.degrid`（档位 + `corrections`）与现行的 `applyLineRemoval`（geometry + `strokes`）两套去线模型并存，笔刷笔迹被写进**旧**模型的 `lineCorrections`，而当前模型的 `line_strokes` 恒空。现已整体下线旧模型：删 `lineCorrections` / `degridStrength` / `DegridResult` / `setDegridStrength` / 5 个死监听，笔刷改道 `algorithm.applyLineRemoval` 的 `strokes`，并把「擦掉误标 / 补回漏标 / 清空笔迹」三按钮恢复到步骤 4 的 `CleanupPanel`。 |
| **`algorithm.degrid` 变成"前端零调用"** | `straditize_core/rpc_methods/cleanup.py:10` | 下线后该后端方法**保留但前端无任何调用方**（`degrid_line_mask` 恒 `None`，`stats.degrid_removed_pixels` 恒 0）。它仍可被 WebMCP `callTool` 直通调用，因此**不是死代码**，但已不在任何前端用例的射程内。是否删除属于后端决策，此处只登记：改它或删它，当前测试**不会红**。 |
| **`stats.degrid_removed_pixels` 变成结构性常量 0** | `session_parts/cleanup.py` `_recompose` | 旧模型的痕迹留在统计里。前端已无消费者（`grep degrid_removed_pixels frontend/` 为空），故不构成误报；若日后重命名该键，`contract.spec.ts` 的"真实 payload ⊇ 声明字段"检查**抓不到**（方向是单向包含）。 |
| **「清空笔迹」不真的清后端（已修，2026-09-29）** | `frontend/src/main.ts` `onClearLineFix` | 原实现只把前端镜像 `data.line_strokes` 置空，再调 `recomposeCleanupState()` —— 后者发的是 `RpcClient.refreshCleanup`，即**不带 `strokes`** 的"只重算"请求，而后端 `apply_line_removal` 的语义是 `strokes is None` → **保持原值**。于是后端把笔迹原样发回来盖掉镜像：HUD 提示"已清空"、镜像瞬时归零，**掩膜一点没变**。同属"看起来生效"型失效，且改前**没有任何一层会红**（旧套件只断言 DOM）。现改走 `setLineStrokes([])`（与画笔落库同一通道，失败照常 `reportBackendFailure` 冒泡）；回归钉子 = `workflow-panels.spec.ts` 步骤 4 笔刷用例，旧实现下它红在 `[1, 4424]`。 |
| **全量 e2e 偶发假红：`net::ERR_NO_BUFFER_SPACE`（未定位）** | `helpers.ts:81` `gotoApp` 的 `waitForFunction(__straditize)` | **症状具有误导性**：随机某个用例在 `resetBaseline → page.goto('/')` 处 30 s 超时，同时门禁报出唯一一条 `console.error`：`Failed to load resource: net::ERR_NO_BUFFER_SPACE`，于是**看起来像那个用例的产品缺陷**。实测连续两轮全量各红一条**不同**的用例（`qa.spec.ts:122`、`contract.spec.ts:233`），单独跑均稳定绿；报错发生在 SPA 自身 asset 加载阶段、任何产品代码执行之前。**已排除**：系统内存（失败时实测 42.8 GB free / 63.9 GB）、测试逻辑、后端（后端日志无异常，该轮 RPC 全部成功）。净机重跑 **34 passed / exit 0**。**疑与 OCR 每次重载模型（见下一行）造成的瞬时资源峰值有关，但未证实。** 缓解：跑前确认无残留 88xx 后端——⚠️ `pixi run python … &` 泄漏的**子进程不会被 `kill $BG` 杀掉**（本次实测泄漏了一个持 2339×1654 会话的后端，须 `taskkill //PID` 收尾）。**第三种表现形式（2026-09-29 实测）**：不再是 `goto` 超时，而是**该用例的控制台门禁**先抓住它——`qa.spec.ts:122` 报 `consoleError` 不为空，内容是 `Failed to load resource: net::ERR_NO_BUFFER_SPACE` **加上**由此派生的两条 `[QA] qa.summarize 失败: … 与后端的连接已断开`。此时症状更像"产品缺陷"（面板真的没算出来），但后端日志**无任何 traceback**、该用例单独跑稳定绿（本轮实测 `1 passed`）。判据：见到 `ERR_NO_BUFFER_SPACE` 一律先单独复跑该用例，不要顺着派生错误去查产品。 |
| **OCR 每次调用都重载 PP-OCRv4 ONNX 模型（已修，2026-09-29）** | `straditize_core/session.py:3542` → `ocr/engine.py:157` | 原实现 `session.py` 每次调用都 new `OcrTaxaRecognitionEngine`（连 `ocr_get_taxa_dict` 读词表都实例化一次引擎），构造函数 `_init_models()` 每次重新 `ort.InferenceSession(...)` 读盘分配两个模型（一轮 e2e 出现 55 次加载日志）。**已修**：`OcrTaxaRecognitionEngine` 增加进程级 `_MODEL_CACHE` 单例缓存，`ocr_get_taxa_dict` 改直接用 `PollenDictionary`；实测 4 条模块 E2E 全程仅加载 1 次模型，由 `test_ocr_engine_caches_onnx_sessions_singleton` 锁死。 |
| **`_recompose` 的返回体不声明 `exclusion_regions` / `line_strokes`（已缓解，结构性缺口仍在）** | `straditize_core/session_parts/cleanup.py` `_recompose` | 它只返回 `candidates`/`selected_ids`/`stats`/`overlay_png`，而 `clear_cleanup_edits` 的语义**包含**清掉整步的排除区与笔迹 ⇒ 返回值与动作语义不匹配，前端 `applyCleanupState` 只覆盖认识的四个键，于是"后端已清、界面还在显示"（步骤 4 第 11 号缺陷）。已在 `main.ts` 的 `onClearCleanupEdits` 里做镜像补偿并留注释，但那**只是这一处的补丁**：任何新的 `_recompose` 消费者都会重新踩到同一个坑。根治要么让 `_recompose` 把这两项一并返回，要么让该动作返回一个"已清空"的明确信号——属后端契约改动，未做。门禁钉住了当前这一处（`step4-cleanup.spec.ts` 用例 6）。 |
| **后端参数校验的错误码不统一** | `cleanup.py:391/397/417` 等 `raise ValueError` | `set_line_thickness` 的越界与未知 id 抛 `ValueError`，经 dispatcher 统一兜成 **`-32603 后端内部错误`**（前端据此提示"请查看服务器控制台日志排查"）；而 `calibrate_axes` 这类用 **`-32602 INVALID_PARAMS`** 并给出字段级原因。同类"用户输入可预见地非法"的情形给出"内部错误"是**错位诊断**。未修：把 `ValueError` 全局映射成 `-32602` 是影响面很大的决定（其余算法方法同样在 raise），留待后端决策。门禁只断言"被拒 + 几何不变"，不绑死错误码，将来改码不会假红。 |
| **`final_removed_pixels` 不可归因（测试选统计量时必读）** | `session_parts/cleanup.py` `_recompose` | 它是 `raw_ink & grid_line_mask`，而 `grid_line_mask` 是**并集**：`candidate_line_mask(=已确认几何) | degrid_line_mask | exclusion | strokes`。所以"确认一条几何后它变大"**不能**证明是那条几何干的（任何一路变化都会让它变大）。可归因的是 `geometry_removed_pixels`（掩膜只按 `statuses={REMOVED}` 构建）：检测后恒 0、确认后才 >0。这不是缺陷而是**统计量语义**，但足以让不读源码的人写出一条恒真的断言，故登记在此。 |
| **Ctrl+Z 撤销不了清理编辑**（`②` 复活画笔后由"不可达"变成"可达"）**已修（2026-09-29，方案 b）** | `frontend/src/core/HistoryManager.ts` + `main.ts` `applyHistorySnapshot` | `history.push()` 的快照只含 `columns`/`calibration`/`roi(s)`，**完全不含** `line_candidates` / `exclusion_regions` / `line_strokes`；`onUndo` 也只调 `applyHistorySnapshot(prev)`（它只在有 `roi` 时 `commitRoi` 让后端按新范围重算，笔迹仍用后端**自己那份**）。后果：涂抹一笔后按 Ctrl+Z，撤销栈里**确实多了一条**记录（如 `Clear Line-mask Corrections`），按下去却只还原 ROI/列，**笔迹与掩膜原样保留**——用户看到"撤销无效"，且栈深度被虚假占用。修法**已定并已实施（2026-09-29，方案 b：清理编辑不再 `push` 历史）**：上游原版 `straditize/straditize/` **完全没有撤销机制**（`grep -rn "def undo\|QUndoStack" → 0 命中`），所以撤销是本项目自创的、其快照**刻意只覆盖前端自有模型**；清理编辑的回收出口是本步显式提供的「清空笔迹」/「清空本步编辑」按钮。仍存的设计缺口：**逐笔撤销**（涂错一笔只能全清重涂）——技术上可行（后端 `setLineStrokes` 是**全量覆盖**，撤销一笔 = 推 `strokes[:-1]`，仅 1 次 RPC），但需要 `HistorySnapshot` 扩字段 + 决定哪些动作入栈，属产品决策，未做。 |
| **`session.taxa_names` 是一个按下标索引的扁平列表，扛不住多 ROI 重排（半修，2026-09-29）** | `straditize_core/session.py` `detect_columns:901` + `rpc_methods/naming.py` `rename_column` | 列名有**两个**存储：列对象上的 `columns[i]["name"]`（前端/导出实际读的）与 `session.taxa_names`（一个 `list[str]`）。重新分列时 `detect_columns` 会**从 `taxa_names` 反写回列对象**，于是两边不一致时以 `taxa_names` 为准——而它按下标索引。**已修的半边**：还原循环原先用**本 ROI 局部**下标读，而写入点与另外三个读取点用**全局** `col_index` ⇒ 多 ROI 时差一个 `len(other_cols)`，右 ROI 重新分列会读回左 ROI 的名字（pytest 已钉住：`test_multi_roi_column_names_follow_global_col_index`）。**未修的半边（结构性）**：`col_index` 本身由 `merged_cols = other_cols + detected_cols` **现场重排**（`session.py:914-917`），所以换个 ROI 重新分列会让**所有**列的下标平移；扁平列表无论如何都对不上，"名字跟着列走"在多 ROI 下无法保证。根治要把名字**按列 id** 存（`dict[str, str]`），或干脆**取消 `taxa_names` 作为独立存储**、以 `columns[i]["name"]` 为单一事实源并让 `detect_columns` 按 id 保留旧名。属 RPC 契约/数据结构改动，未做。 |
| **步骤面板在提交后被整块重挂，吞掉用户正在输入的内容与焦点（未修，2026-09-29 实测）** | `frontend/src/components/Inspector.ts:142` + `main.ts:1687` `applyDepthCalibration` | `Inspector.render()` 每次都 `this.element.innerHTML = …` **整块重写**，随后再把当前步骤面板 `mount()` 进去 ⇒ 任何"动作成功 → `inspector.updateData()`"的路径都会**拆掉并重建面板 DOM**。步骤 3 的五个标定输入框都挂了 `change` → `commitCalibration`（`YCalibPanel.ts:143-145`；只要四个数值都能解析就发请求 `:121-123`），而每次提交成功又都走 `inspector.updateData()` ⇒ 提交与重挂几乎同时发生（`core.calibrateAxes` 往返实测 **2.97 / 4.81 ms**）。**实测后果**：① 写进 `#ycal-inp-bot-px` 的 `1100` 在一次重挂后从 DOM 里消失（仍是 `1198`，且那一发提交根本没发出）；② `change` 前 `activeElement` 是 `ycal-inp-top-val`，`change` 后立刻变成 `<body>`（**焦点被摧毁**）。用户可见：填完一个框按 Tab，下一个框随即失焦，接着敲的数字落不到任何输入框；连改两个框时后一个的值可能被重挂吃掉。**为何不顺手修**：不能在 `render()` 里简单"保留焦点输入框的值"——后端拒绝时把旧值搬过去会**掩盖后端的纠正**（步骤 5 的改名那处正是必须先 `blur()` 才安全，见审查文档 #14/#18）。正解是把"数据更新"与"DOM 拆除"解耦（面板实现 `update(data)` 而非整块重建），属跨 8 步的交互架构改动。**门禁现状**：`step3-ycalib.spec.ts` 的 `commitYCalib` 已改为"一次写全五个值 + 只点一次应用"（只发一次提交 ⇒ 与请求顺序无关；单独 3 轮 × 4 用例稳定绿）；**"改一个框就自动落库"这条交互路径目前无门禁覆盖**——它现在就会偶发丢值，钉成断言只会得到一条稳定的红灯。同族缺陷见步骤 5 的 inline 改名输入框（已修）。 |
| **放大倍数是三处键名/通道分裂（未修，2026-09-29 登记）** | 前端 `Inspector.ts` 的 exag 控件 + `RpcClient.ts:704`；后端 `session.py:876` 种子、`session_parts/xticks.py:110-111`、`session_parts/export.py:174`、`session_parts/qa.py:187` | 同一个「放大倍数」概念有三个落点，互不相通：① **前端镜像**读写 `exaggerationMult`，其来源是载荷字段 `exaggeration_multiplier`（**带 ier**，种子里默认 5.0）；② **导出与 QA** 读的是 `col["exaggeration_mult"]`（**不带 ier**）；③ 而 `exaggeration_mult` 的写入者**只有两处**：`calibrate_column_xticks`（`xticks.py:110-111`）与 `roi_apply_form_defaults`（`roi.py:339-365`，把 ROI 的 `form_defaults.exaggerationMult` 写给全 ROI 的列）——**后者全仓零调用点**（`grep -rn "applyFormDefaults(" frontend/src` 为空：RPC 已注册 `rpc_methods/roi.py:16`、客户端方法 `RpcClient.ts:946` 也已存在，但没有任何调用方，`RoiPanel` 也没有对应表单区块）。`Inspector` 的勾选框/倍数框则**只改前端内存 + 压撤销栈、没有任何专属 RPC**（`grep -n exag frontend/src/main.ts` 为空）。后果：**界面上显示的倍数永远到不了导出**，导出实际用来折算的倍数又只能靠一次「标定 X 刻度」的显式参数写入，UI 无路径可达 —— 即 `exaggeration > 1.0` 的折算分支（`export.py:174`/`qa.py:187`）在纯 UI 操作下**永远不触发**。属 B2/B3 范围（导出改读 `x_ticks` 时一并收口），此处只登记。 |
| **同一个物理量存在两条互不相通的换算链（X 轴标度）** | 链 L＝`session.py:1383-1444`（`export_data`）/ `session.py:1633-1667`（`extract_grid_values`）；链 X＝`session_parts/export.py:128-176`（XLSX/LiPD/TAR）/ `session_parts/qa.py:130-191`（QA） | 链 L 读 legacy 三件套（`startValue`/`tickValue`/`tickEndX`），链 X 读 `x_ticks` ⇒ **同一列、同一次标定，换个导出格式得到的数字不一样**；且两链对「未标定」的兜底**互相矛盾**（`export.py` 按 `0→100%` 照算，`qa.py` 令 `declared_max=0` 从而**静默豁免**超限判定，`qa.py:126`）。更根本的是：左栏那五个标定输入框**从不落库**（见审查文档第 23 条），所以后端一直在用 `detect_columns` 的伪造种子（`session.py:871-873`）算这些数。**处置**：由「列分组」设计的 P0 统一到唯一解析入口（`resolve_column_scale`），最高价值断言＝四种导出的数值必须相等。见 `docs/plans/2026-09-29-column-groups-design.md` §4。 |
| **`column_remove` 删中间列后点数据错位（取数张冠李戴）（已修，2026-09-29）** | `straditize_core/session.py` `_reindex_columns` / `column_remove` / `roi_remove` | 新增 `_reindex_columns` 在 `column_remove`、`roi_remove`、`detect_columns` 时按存活列的原 `col_index` 同步搬移 `column_points`、`control_points`、`reader_types`、`x_scales` 与 `taxa_names`，前端 `#btn-col-delete` 接入 `column.remove` RPC；由 `test_column_remove_migrates_point_stores_and_taxa_names` 钉死。 |
| **列级 `unit` / `plot_type` 后端只写不读，载荷还把 `unit` 硬编码成 `"%"`（已修，2026-09-29）** | `rpc_methods/system.py` + `metadata/exporter_lipd.py` | 列载荷与 LiPD 导出均已改为经 `resolve_column_scale` 读取真实 `unit` 与 `plot_type`。 |
