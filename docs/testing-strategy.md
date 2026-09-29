# 测试策略

> 判据来源：知乎《[大型 ToB 项目的前端自动化测试实践](https://zhuanlan.zhihu.com/p/546647225)》
> 与《[契约测试实践篇](https://zhuanlan.zhihu.com/p/514909521)》。两篇的结论并非照搬，
> 下文在每一处标注了「本仓库的落点」与「为什么不适用」。命令与规模实测于 2026-09-29。

## 1 分层与职责边界

每一层守一类失效，**不重复**另一层的主要职责。唯一有意的跨层重复是契约（§3）。

| 层 | 命令 | 规模（实测） | 守什么失效 | 反馈代价 |
| --- | --- | --- | --- | --- |
| 后端逻辑 | `pixi run test` | 276 passed + 96 subtests | 计算正确性；数据来源不变量（`tests/integration/test_no_fabrication.py` 是守卫测试，不得放宽） | ~185 s |
| 前端模块 | `npm --prefix frontend test` | 5 个 node 脚本 | 纯函数 / 模型 / 注册表 / 阶段映射 / 契约字段完整性 | ~2 s |
| 跨文件一致性 | `pixi run lint` | 8 项检查 | 签名↔调用点、类型标注↔实现、package-data、pytest 收集、裸步骤数字、**前端 RPC 方法名 ⊆ 后端注册表** | ~1 s |
| 端到端 | `pixi run test-e2e` | 11 spec / 28 用例 / 191 条断言，含 **67 次真实后端读取** | 真实浏览器里的集成事实：画布渲染管线、手势、i18n、错误冒泡 | ~110 s |
| 契约快速 lane | `pixi run test-contract` | 5 用例 | 同上，只取契约部分 | 26 s |

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
3. **零固定 sleep。** 等待一律走 Playwright 的智能等待或 `expect.poll`；`waitForTimeout`
   是 E2E 假绿的第一来源。
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
# ① 后端读取总次数 —— 当前 67（11 spec / 28 用例）
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

相反方向同样要证：**负向对照**。画布探针在"本不该有这一层"的步骤上必须为 0
（步骤 1 的 ROI 特征色实测 0）。做不到 0 的探针不能用——「ROI 蓝」就是这样被否掉的：
叠加层 `RoiOverlay`（id `roi-indicator`）与管线 `roi` 层共用 `#0284c7`，像素不可区分，
所以它只能当阶段级信号，不能当层专属证据。

## 9 已知缺口（已报告，未修）

这些是**测试策略想抓、但当前还抓不住**的失效，属于既有代码问题，按"只报不改"登记：

| 缺口 | 位置 | 为什么危险 |
| --- | --- | --- |
| 导出失败被静默吞掉 | `main.ts:1922` 捕 `core.exportData` 失败后只 `console.warn`，再打开一个**空**的导出面板 | 直接违反不变量 1。用户会以为是自己没做分列，实际是后端/契约坏了；且 `console.warn` 不在门禁覆盖范围内（门禁只认 `console.error`），现状下**没有任何一层会红**。正确写法就在同文件 `main.ts:63` 的 `reportBackendFailure`。 |
| `export.csv` 空载荷静默回退 | `PropertyPanel.ts:617` 当返回非字符串时回退到 `textarea.value` | 与历史 `x_bounds`/`data_xlim` 事故同型：用"看起来正常"的内容掩盖契约破裂。 |
| 就绪清单字段硬编码 | `ExportReadinessPanel.ts:41` `dataCsvEqualsPrimary: true` | 该属性永远为真，断言它等于没断言。 |
| 汇总失败只 `console.warn` | `QaPanel.triggerSummarize` | 面板数字静默停在默认值 0，纯 DOM 断言完全隐形。 |
| 前端 TS 类型与真实 payload 不完全一致 | `frontend/src/types/` | `contract.spec.ts` 只验"真实 payload ⊇ 声明字段"，声明里多余或失真的字段抓不到。 |
