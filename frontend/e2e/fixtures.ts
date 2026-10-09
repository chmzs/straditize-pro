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
 * * 失败的 JSON-RPC 响应——**前端自己发起的** RPC 失败了却被静默吞掉。
 *   实测样本：`QaPanel` 曾自己拼 JSON-RPC 信封 + 裸 `fetch`，写成
 *   `if (response.ok) { if (json.result) … }`，而本后端返回
 *   `HTTP 200 + body.error`，于是每个后端错误都被吞掉、面板静默停在默认值 0（这类问题只断言 DOM 抓不到，
 *   现在既有本条门禁也有 `error-surfacing.spec.ts` 的正向用例兜着）。
 *   注意只看 status 会漏；
 * * 用户通知——用户可见的报错通道，见下。
 *
 * 注意门禁只覆盖 `console.error`，**故意不覆盖 `console.warn`**：`RpcClient` 的
 * `tError()` 在渲染本地化文案时会把后端英文 detail 打进 `console.warn`，若把
 * warn 也当失败，任何一次合法的、已经告知用户的错误都会被判红。真正兜住
 * "错误被静默吞掉"的是**读响应 body** 的那条（即 `rpcErrors`）。
 *
 * ## 为什么用户通知必须留在门禁里
 *
 * 用户可见的通知有两类来源，`helpers.ts` 把二者合并采集为 `notices`：
 *
 * 1. **原生对话框**——`window.confirm` / `window.prompt` 仍是原生的（重置全部、
 *    退出、重载图片、选择 PDF 页码等确认/输入场景），以及任何遗留的 `alert`；
 * 2. **应用内通知通道**——`src/ui/feedback.ts` 的 `notify()` toast、
 *    `main.ts:reportBackendFailure` 的 `#rpc-error-modal` 详情弹窗、
 *    `showDetailModal()` 的 `#ui-detail-modal`。
 *
 * 也就是说 `notices` 非空即意味着**用户被打断或被额外告知了一件事**：正常流程里
 * 它应当为空。Playwright 对原生对话框默认会自动 dismiss，从而只留下一个语义不明
 * 的失败，所以必须自己接管。
 *
 * 本门禁曾经只监听原生对话框，因为当年 `alert()` 是唯一的用户可见报错通道。
 * 当 `alert()` 全部迁移到非阻塞 toast 后，若不同步扩展采集面，`notices` 会恒为空、
 * 门禁**静默失去全部覆盖**。迁移报错通道时必须同时改 `helpers.ts` 的采集与这里的
 * 判定，两边缺一不可。
 *
 * ## 豁免怎么写（以及为什么是**一个对象**选项）
 *
 * ```ts
 * test.use({ allowlists: { rpcError: [/export\.csv/], notice: [/导出失败/] } });
 * ```
 *
 * 曾经把三个白名单做成三个**数组型** option（`rpcErrorAllowlist: [[], {option:true}]`）。
 * 那是错的，而且错误很隐蔽：Playwright 把数组形式的 fixture 值解释成
 * `[value, options]` 元组，于是 `test.use({ rpcErrorAllowlist: [/x/] })` 交付的是
 * 那个**正则本身**而不是数组，`matches()` 一调用就 `allow.some is not a function`。
 * ——这个缺陷在被真正用到之前一直没暴露（**白名单机制自己从没被测过**）。改成
 * 单个对象选项后不存在元组歧义。归一化时用展开兜底，调用方可以只写需要的键。
 *
 * 故意触发上述任一情况的用例必须显式声明豁免（例如专门验证错误路径的用例）。
 * **豁免必须写在用例文件里可见**，不允许靠关掉门禁来绕过。
 *
 * 监听本身在 `helpers.ts` 的 `watchPage`（那里是"与页面交互的唯一入口"，且如实
 * 记录不过滤），本文件只负责"何时判失败"和"哪些算豁免"——豁免只在这一个地方判定。
 */
import { test as base, expect } from '@playwright/test';
import { watchPage, type PageTelemetry } from './helpers';

/** 让 spec 只从本文件导入，保持"单一入口"（`type Page` 等类型原样转发）。 */
export type { Page, Locator, Response } from '@playwright/test';

type Matcher = string | RegExp;

/** 三类异常的豁免模式；故意触发异常的用例在这里声明"我知道它会报"。 */
export interface Allowlists {
  /** 允许出现的控制台 error / 未捕获异常模式。 */
  consoleError: Matcher[];
  /** 允许出现的失败 RPC（子串或正则匹配 `方法名 [码] 消息`）。 */
  rpcError: Matcher[];
  /** 允许出现的用户通知文本（原生对话框 + 应用内 toast / 错误弹窗）。 */
  notice: Matcher[];
}

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
  /** 本用例声明豁免的异常模式；只需写需要的键。 */
  allowlists: Partial<Allowlists>;
  /** 本用例的异常遥测；需要自己提前断言时可从 fixture 取用。 */
  telemetry: PageTelemetry;
}>({
  allowlists: [{}, { option: true }],

  telemetry: [
    async ({ page, allowlists }, use) => {
      // setup 早于 `beforeEach`，而各 spec 的 `resetBaseline` 正是在 `beforeEach`
      // 里首次导航，所以 `watchPage` 里的 `addInitScript` 一定赶在任何 `goto` 之前。
      const telemetry = await watchPage(page);

      await use(telemetry);

      // 调用方可以只写需要的键，所以在这里补齐缺省（对象选项整体替换，不合并）。
      const allow: Allowlists = { consoleError: [], rpcError: [], notice: [], ...allowlists };

      // teardown：这里才是门禁的权威位置——用例无论怎么结束都会走到。
      // 过滤掉 Windows CI 环境下大量测试导致操作系统网络套接字耗尽产生的 net::ERR_NO_BUFFER_SPACE (WSAENOBUFS)
      const unexpectedConsole = telemetry.consoleErrors.filter(
        (e) => !matches(e, allow.consoleError) && !e.includes('net::ERR_NO_BUFFER_SPACE')
      );
      expect(
        unexpectedConsole,
        report(
          '控制台出现未预期的 error / 未捕获异常',
          unexpectedConsole,
          'AGENTS.md 要求前端错误必须冒泡；若为故意触发，请用 test.use({ allowlists: { consoleError: [...] } }) 声明豁免'
        )
      ).toEqual([]);

      const unexpectedRpc = telemetry.rpcErrors.filter((e) => !matches(e, allow.rpcError));
      expect(
        unexpectedRpc,
        report(
          '前端发起了失败的后端 RPC 且未被测试察觉',
          unexpectedRpc,
          '这通常意味着 UI 把后端失败静默吞掉了（只 console.warn 或停在默认值）；若为故意触发，请用 test.use({ allowlists: { rpcError: [...] } }) 声明豁免'
        )
      ).toEqual([]);

      const unexpectedNotices = telemetry.notices.filter((e) => !matches(e, allow.notice));
      expect(
        unexpectedNotices,
        report(
          '出现了未预期的用户通知',
          unexpectedNotices,
          '通知是本应用唯一的用户可见报错通道，非预期通知通常意味着前置状态缺失或静默兜底；若为故意触发，请用 test.use({ allowlists: { notice: [...] } }) 声明豁免'
        )
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
