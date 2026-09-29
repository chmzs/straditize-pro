/**
 * 「前端错误必须冒泡到用户」的**正向**测试。
 *
 * ## 为什么需要它：全局门禁只证明了"没出错时不弹框"
 *
 * `fixtures.ts` 的门禁断言 `console.error` / 失败 RPC / 原生弹窗**为空**。那是
 * 反向覆盖：它证明"一切正常时用户没被打扰"，**不证明"出问题时用户看得见"**。
 * 这两件事差得很远 —— 一个把错误全吞进 `console.warn` 的实现能让门禁全绿，而
 * 用户面对的是一个静默失效的界面。历史上"前端发 x_bounds、后端要 data_xlim
 * 被静默兜底掩盖很久"就是这一类。
 *
 * ## 本应用的用户可见报错通道就是 `alert()`
 *
 * 没有全局错误条 / toast：正确写法集中在 `main.ts:63` 的 `reportBackendFailure`
 * （`console.error` + `alert('❌ xxx失败')`）。所以这里断言"弹框文本"，就是断言
 * "用户被告知了"。
 *
 * ## 注入失败是"必要才 mock"
 *
 * 要验证"后端失败时前端冒泡"，就必须真的制造一次后端失败。用 `page.route` 让
 * **指定方法**返回 JSON-RPC 错误（其余请求照常透传），这样被测的仍是真实的
 * 前端错误处理路径，只把"失败来源"换成可控的。注意本后端的错误是
 * `HTTP 200 + body.error`，所以注入的也必须是这个形状。
 *
 * 故意触发失败的用例必须显式声明豁免（否则门禁自己会红）；豁免写在用例文件里
 * 可见，是 `fixtures.ts` 要求的唯一合法方式。
 */
import { expect, test, type Page } from './fixtures';
import { gotoStage, resetBaseline, waitForDiagram } from './helpers';

/** 注入文本：既证明确实是"我们制造的那次失败"，也不会和真实错误混淆。 */
const INJECTED = 'PROBE 注入的后端导出失败';

/**
 * 只让 `method` 失败，其余 RPC 请求照常透传。
 *
 * 约束在方法名上而不是拦住整个 `/rpc`：否则导出面板本身要发的其它请求
 * （就绪清单等）会一起失败，把用例变成"到处都坏"的无差别场景。
 */
async function failRpcMethod(page: Page, method: string, message: string): Promise<void> {
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON() as { id?: unknown; method?: string } | null;
    if (body?.method !== method) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: { code: -32603, message },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await resetBaseline(page);
  await waitForDiagram(page);
});

test.describe('后端失败必须被用户看见', () => {
  test.use({
    allowlists: { rpcError: [/export\.csv/], dialog: [INJECTED, /导出 CSV 失败/] },
  });

  test('导出失败必须弹框告知，而不是静默给一份空数据', async ({ page, telemetry }) => {
    // 导出面板：`#btn-export-csv` 无禁用逻辑，任何步骤都打得开
    await page.locator('#btn-export-csv').click();
    await expect(page.locator('.wpd-export-dialog'), '导出面板应打开').toBeVisible();

    await failRpcMethod(page, 'export.csv', INJECTED);
    await page.locator('#btn-wpd-download-csv').click();

    // 断言"用户看见了"，而不是"代码里有个 catch"
    await expect
      .poll(() => telemetry.dialogs.join('\n'), {
        message: '后端导出失败必须弹框告知用户，而不是静默吞掉',
        timeout: 10_000,
      })
      .toContain(INJECTED);
    expect(telemetry.dialogs.join('\n'), '弹框应说明失败的是导出').toContain('导出 CSV 失败');
  });
});

test.describe('客户端校验失败同样必须被用户看见', () => {
  test.use({ allowlists: { dialog: [/两点标定错误/] } });

  test('两点像素 Y 相同时必须弹框拒绝，而不是静默不生效', async ({ page, telemetry }) => {
    await gotoStage(page, 3);

    // 先填像素、后填数值：这样中途每次 change 都因"数值未填齐"而提前 return，
    // 不会在两次像素还不相同的时候把标定提交给后端（那会引入无关的 RPC 副作用）。
    await page.locator('#ycal-inp-top-px').fill('600');
    await page.locator('#ycal-inp-bot-px').fill('600');
    await page.locator('#ycal-inp-top-val').fill('100');
    await page.locator('#ycal-inp-bot-val').fill('200');

    await page.locator('#btn-apply-ycalib').click();

    await expect
      .poll(() => telemetry.dialogs.join('\n'), {
        message: '两个参考点像素 Y 相同时必须弹框拒绝（静默忽略会让用户以为已标定）',
        timeout: 10_000,
      })
      .toContain('两点标定错误');
  });
});
