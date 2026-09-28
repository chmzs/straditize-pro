/**
 * 全局错误门禁 fixture —— 所有 spec 都从这里取 `test` / `expect`，而不是直接从
 * `@playwright/test` 取。
 *
 * ## 出处与它对应的项目不变量
 *
 * 知乎《大型 ToB 项目的前端自动化测试实践》把「请求异常 / js 异常的监听」列为
 * E2E 用例**准备阶段**的固定动作，并明确 E2E 的职责之一是「判断测试用例运行时，
 * 是否有异常的请求」。本仓库与之对应的硬约束是 `AGENTS.md` 的第一条不变量：
 * **前端错误必须冒泡到用户**（`docs/ARCHITECTURE.md` §2）——后端失败、契约不符
 * 一律显式报错，禁止静默兜底。
 *
 * ## 为什么必须是 auto fixture，而不是每条用例手写
 *
 * 迁移前 10 条 spec 里有 3 条（`contract` / `step-visibility` / `workflow-panels`，
 * 共 12 个用例）**完全没有**任何异常监听；另外 7 条靠用例**末尾**手写的
 * `expectNoDialogs()`。手写那套有两个真实漏洞：
 *
 * 1. 用例中途断言失败就再也走不到那一行，异常信息全丢；
 * 2. 异常发生在手动检查**之后**（例如收尾阶段的渲染）同样漏掉。
 *
 * 放进 fixture 的 teardown 就不可能被忘记，也对"先失败再看"的顺序免疫。
 *
 * ## 三道门禁
 *
 * * `console.error` / 未捕获异常（`pageerror`）——前端把错误吞在控制台里；
 * * 失败的 JSON-RPC 响应——**前端自己发起的** RPC 失败了却被静默吞掉
 *   （已知实例：`QaPanel.triggerSummarize` 失败时只 `console.warn`，面板数字
 *   静默停在默认值 0；这类问题只断言 DOM 是抓不到的。注意本后端返回
 *   `HTTP 200 + body.error`，只看 status 会漏）；
 * * 原生 `dialog`——通常是前置状态缺失；Playwright 默认会自动 dismiss，从而
 *   只留下一个语义不明的失败。
 *
 * 故意触发上述任一情况的用例，用
 * `test.use({ consoleErrorAllowlist: [...], rpcErrorAllowlist: [...] })` 显式声明豁免
 * （例如专门验证错误路径的用例）。**豁免必须写在用例文件里可见**，不允许靠
 * 关掉门禁来绕过。
 *
 * 监听本身在 `helpers.ts` 的 `watchPage`（那里是"与页面交互的唯一入口"），
 * 本文件只负责"何时判失败"和"哪些算豁免"。
 */
import { test as base, expect } from '@playwright/test';
import { watchPage, type PageTelemetry } from './helpers';

/** 让 spec 只从本文件导入，保持"单一入口"（`type Page` 等类型原样转发）。 */
export type { Page, Locator, Response } from '@playwright/test';

type Matcher = string | RegExp;

function matches(text: string, allow: Matcher[]): boolean {
  return allow.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)));
}

function report(title: string, items: string[], hint: string): string {
  return (
    `${title}（共 ${items.length} 条）—— ${hint}\n` +
    items.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
  );
}

export const test = base.extend<{
  /** teardown 时允许出现的控制台 error / 未捕获异常模式。 */
  consoleErrorAllowlist: Matcher[];
  /** teardown 时允许出现的失败 RPC（子串或正则匹配 `方法名 [码] 消息`）。 */
  rpcErrorAllowlist: Matcher[];
  /** 本用例的异常遥测；需要自己提前断言时可从 fixture 取用。 */
  telemetry: PageTelemetry;
}>({
  consoleErrorAllowlist: [[], { option: true }],
  rpcErrorAllowlist: [[], { option: true }],

  telemetry: [
    async ({ page, consoleErrorAllowlist, rpcErrorAllowlist }, use) => {
      // setup 早于 `beforeEach`，而各 spec 的 `resetBaseline` 正是在 `beforeEach`
      // 里首次导航，所以这里是"任何 goto 之前"。
      const telemetry = watchPage(page, rpcErrorAllowlist);

      await use(telemetry);

      // teardown：这里才是门禁的权威位置——用例无论怎么结束都会走到。
      const unexpectedConsole = telemetry.consoleErrors.filter(
        (e) => !matches(e, consoleErrorAllowlist)
      );
      expect(
        unexpectedConsole,
        report(
          '控制台出现未预期的 error / 未捕获异常',
          unexpectedConsole,
          'AGENTS.md 要求前端错误必须冒泡；若为故意触发，请用 test.use({ consoleErrorAllowlist }) 声明豁免'
        )
      ).toEqual([]);

      expect(
        telemetry.rpcErrors,
        report(
          '前端发起了失败的后端 RPC 且未被测试察觉',
          telemetry.rpcErrors,
          '这通常意味着 UI 把后端失败静默吞掉了（只 console.warn 或停在默认值）'
        )
      ).toEqual([]);

      expect(
        telemetry.dialogs,
        report('出现了原生弹窗', telemetry.dialogs, '通常是前置状态缺失')
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
