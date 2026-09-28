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
| 端到端 | `pixi run test-e2e` | 10 spec / 25 用例 / 178 条断言 | 真实浏览器里的集成事实：画布渲染管线、手势、i18n、错误冒泡 | ~95 s |
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

1. **错误必须冒泡。** `frontend/e2e/fixtures.ts` 提供 auto fixture：控制台 `error`、
   未捕获异常、**前端自己发起的失败 RPC**、原生弹窗，一律在 teardown 断言为空。
   之前的 10 条 spec 里有 3 条完全没有监听，另外 7 条靠用例末尾手写——用例中途失败就
   永远走不到那一行。已知实例：`QaPanel.triggerSummarize` 失败时只 `console.warn`，
   面板数字静默停在默认值 0；只断言 DOM 抓不到。
   注意本后端的 JSON-RPC 错误是 `HTTP 200 + body.error`，只看 status 会漏掉全部应用级错误。
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
| 视觉/截图回归（`toMatchSnapshot`） | canvas 渲染 + 跨 OS 字体差异会让基线图在 Windows 本地与 CI Linux 之间抖动；那篇文章本身也把"噪音处理/基线维护"明确列为 E2E 的成本。改用**结构化断言**：`renderedLayers` 词汇表、后端数值本身。 |
| Pact / Pact Broker | 见 §3。 |
| 追覆盖率百分比 | 覆盖率不区分"断言了后端权威状态"和"断言了 DOM 没报错"。本仓库更在意**断言的种类**：178 条断言里必须有多少条真的读了后端。 |
| 引入第二个 E2E 框架 | 一个真浏览器驱动就够；多一套框架等于多一套 flaky 与依赖。 |
| 为"将来可能复用"抽测试工具层 | 只有一处调用的抽象是负债。 |

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
`test.use({ consoleErrorAllowlist: [...] })` 在用例文件里显式声明豁免，不允许关掉门禁。

## 7 门禁

提交前：`pixi run lint`、`pixi run test`、`npm --prefix frontend run build`；
改了前端逻辑加 `npm --prefix frontend test`；改了 RPC 契约或界面行为加
`pixi run test-e2e`。CI（`.github/workflows/ci.yml`）跑的就是这些，外加 e2e 类型检查
（`npm --prefix frontend run test:e2e:typecheck`），失败时上传 Playwright 报告。
