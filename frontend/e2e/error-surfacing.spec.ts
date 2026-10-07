/**
 * 「前端错误必须冒泡到用户」的**正向**测试。
 *
 * ## 为什么需要它：全局门禁只证明了"没出错时用户没被打扰"
 *
 * `fixtures.ts` 的门禁断言 `console.error` / 失败 RPC / 用户通知**为空**。那是
 * 反向覆盖：它证明"一切正常时用户没被打扰"，**不证明"出问题时用户看得见"**。
 * 这两件事差得很远 —— 一个把错误全吞进 `console.warn` 的实现能让门禁全绿，而
 * 用户面对的是一个静默失效的界面。历史上"前端发 x_bounds、后端要 data_xlim
 * 被静默兜底掩盖很久"就是这一类。
 *
 * ## 本应用的用户可见通知通道
 *
 * 短消息走 `src/ui/feedback.ts` 的 `notify()` toast（非阻塞、数秒后自动消失）；
 * 后端失败另走 `main.ts:reportBackendFailure` 的 `#rpc-error-modal` 详情弹窗
 * （可划选、可复制，取代了阻塞且不可复制的原生 `window.alert`）。
 * `helpers.ts` 把这两类与仍在使用的原生 `confirm` / `prompt` 合并采集为
 * `telemetry.notices`，所以这里断言"通知文本"，就是断言"用户被告知了"。
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
/** QA 面板那条用独立文案：免得断言"看到了导出失败"其实命中的是别处的常量。 */
const INJECTED_QA = 'PROBE 注入的 QA 汇总失败';

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
    allowlists: { rpcError: [/export\.csv/], notice: [INJECTED, /导出 CSV 失败/] },
  });

  test('导出失败必须通知用户，而不是静默给一份空数据', async ({ page, telemetry }) => {
    // 导出面板：`#btn-export-csv` 无禁用逻辑，任何步骤都打得开
    await page.locator('#btn-export-csv').click();
    await expect(page.locator('.wpd-export-dialog'), '导出面板应打开').toBeVisible();

    await failRpcMethod(page, 'export.csv', INJECTED);
    await page.locator('#btn-wpd-download-csv').click();

    // 断言"用户看见了"，而不是"代码里有个 catch"
    await expect
      .poll(() => telemetry.notices.join('\n'), {
        message: '后端导出失败必须通知用户，而不是静默吞掉',
        timeout: 10_000,
      })
      .toContain(INJECTED);
    expect(telemetry.notices.join('\n'), '通知应说明失败的是导出').toContain('导出 CSV 失败');
  });
});

test.describe('客户端校验失败同样必须被用户看见', () => {
  test.use({ allowlists: { notice: [/两点标定错误/] } });

  test('两点像素 Y 相同时必须明确提示，而不是静默不生效', async ({ page, telemetry }) => {
    await gotoStage(page, 3);

    // 先填像素、后填数值：这样中途每次 change 都因"数值未填齐"而提前 return，
    // 不会在两次像素还不相同的时候把标定提交给后端（那会引入无关的 RPC 副作用）。
    await page.locator('#ycal-inp-top-px').fill('600');
    await page.locator('#ycal-inp-bot-px').fill('600');
    await page.locator('#ycal-inp-top-val').fill('100');
    await page.locator('#ycal-inp-bot-val').fill('200');

    await page.locator('#btn-apply-ycalib').click();

    await expect
      .poll(() => telemetry.notices.join('\n'), {
        message: '两个参考点像素 Y 相同时必须明确提示（静默忽略会让用户以为已标定）',
        timeout: 10_000,
      })
      .toContain('两点标定错误');
  });
});

/**
 * 第三条走的是**另一条**用户可见通道：面板自己的 banner，而不是 toast / 错误弹窗。
 *
 * `QaPanel`（步骤 8）把错误写在面板顶部的 banner 里。它曾经自己拼 JSON-RPC
 * 信封 + 裸 `fetch`，写成 `if (response.ok) { if (json.result) {…} }`。本后端把
 * 应用级错误放在 `HTTP 200 + body.error` 里 —— 于是 `response.ok` 为真、
 * `json.result` 为空，**每一个后端错误都被静默吞掉**（连 `console.warn` 都没有）。
 *
 * 危害不在于"少了个提示"，而在于失败时 banner 仍停在渲染初值
 * 「🟢 地学校验门禁通过，数据符合规律」—— 用户拿到的是一个**假结论**。
 * 这也正是"只断言 DOM 里的数字"抓不到它的原因：数字停在默认 0，看着像正常空数据。
 */
test.describe('面板内的后端失败也必须被用户看见（banner 通道）', () => {
  test.use({
    allowlists: { rpcError: [/qa\.summarize/], consoleError: [/\[QA\]/] },
  });

  test('qa.summarize 失败必须把 banner 切成错误态，而不是留着绿色的「门禁通过」', async ({
    page,
  }) => {
    await failRpcMethod(page, 'qa.summarize', INJECTED_QA);

    // 进入步骤 8 时 `QaPanel.mount` 末尾会自动拉一次诊断，不需要点击。
    await gotoStage(page, 8);

    const banner = page.locator('#qa-banner');
    await expect(banner, '用户必须看到失败原因，而不是一个静默的 0').toContainText(INJECTED_QA);
    await expect(banner, 'banner 必须进入错误态').toHaveAttribute('data-level', 'red');
    // 负向对照：失败时绝不能继续宣称"门禁通过"（修复前正是这个表现）。
    await expect(banner, '失败时残留绿色结论就是伪造科学结论').not.toContainText('门禁通过');
  });
});

/**
 * 第四条走的是**非 JSON-RPC 的上传端点** `/api/upload`。
 *
 * 它和上面三条的失败形状不同：`/api/upload` 成功是 2xx + `{path}`，失败是
 * **非 2xx**（不是 JSON-RPC 的 `200 + body.error`）。`AgeDepthModal` 曾经
 * 拿到响应后**完全不查 `ok`**，直接把 `upJson.path || upJson.saved_path` 当路径 ——
 * 错误响应体若不含那个字段，`zip_path` 就是 `undefined`，被原样喂给
 * `component.installOfflineZip`。
 *
 * ## 注入形状必须是「合法 JSON 但没有 path」
 *
 * 这一点是被金丝雀验证逼出来的。第一版注入的是 `500 + text/plain`，看着合理，
 * 却**证明了任何事**：那种 body 会让新旧两版代码都在 `res.json()` 处抛错，
 * 于是两者都会通知 —— 测试无法区分修复前后。真正能区分的是"能解析、但没有路径"
 * 这种响应（例如后端返 `{"detail": ...}` 的 5xx）：旧代码会一路带着 `undefined`
 * 去调用下游 RPC，新代码在 `!res.ok` 就停下。
 *
 * 所以本用例的承重断言不是"弹了框"，而是**下游那个 RPC 根本没有被发出去**。
 */
test.describe('上传失败必须被用户看见（/api/upload 通道）', () => {
  test.use({
    allowlists: {
      notice: [/离线导入失败/],
      // 注入 5xx 会让**浏览器自己**往控制台打一条 "Failed to load resource ... 500"，
      // 那是 Chromium 对非 2xx 响应的记录，不是应用代码的 error。本仓库的 500 由本
      // 用例故意制造，故显式豁免；应用侧的报错仍由下面的通知断言把守。
      consoleError: [/Failed to load resource.*500/],
    },
  });

  test('离线包上传失败时不得把 undefined 当路径喂给下游 RPC', async ({ page, telemetry }) => {
    // 记录前端实际发出的 RPC 方法名，用来断言"下游调用没有发生"。
    const rpcMethods: string[] = [];
    await page.route('**/rpc', async (route) => {
      const method = (route.request().postDataJSON() as { method?: string } | null)?.method;
      if (method) rpcMethods.push(method);
      await route.continue();
    });

    await page.route('**/api/upload', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        // 能解析成 JSON，但没有 path / saved_path —— 旧代码正是被这种响应骗过。
        body: JSON.stringify({ detail: '解压失败：不是合法的 zip' }),
      })
    );

    await page.locator('#btn-age-depth-modal').click();
    await page.locator('#inp-ad-webr-zip').setInputFiles({
      name: 'webr-offline.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('PK\x03\x04-not-a-real-zip'),
    });

    await expect
      .poll(() => telemetry.notices.join('\n'), {
        message: '上传 5xx 必须通知用户',
        timeout: 10_000,
      })
      .toContain('离线导入失败');

    // 承重断言：失败的上传绝不能推进到安装步骤（那会拿 undefined 去换取一个错位诊断）。
    expect(
      rpcMethods.filter((m) => m === 'component.installOfflineZip'),
      '上传失败后不得调用 component.installOfflineZip'
    ).toEqual([]);
  });
});
