/**
 * 数据来源闸门（`ProvenanceGate`）必须区分「后端不在」与「后端这一下很忙」。
 *
 * ## 缺陷背景
 *
 * `RpcClient.probeBackend`（`src/services/RpcClient.ts:190-285`）对每次候选地址只给
 * **2.5 秒** abort 时限，而 `ensureDataProvenance` 拿**第一次**探测的结果当终局：
 * 不通就挂出阻塞式闸门（`#provenance-gate`），只能由用户点「重新连接」放行。
 *
 * 后端是**单会话串行**执行的：`e2e.reset` / 分列 / 年模提取这类重活会把
 * `system.ping` 压到 4 秒以上（本机实测：`e2e/agedepth-modal.spec.ts` 运行期间
 * 逐秒探测，出现 4.13s / 4.23s / 4.27s 的 ping 响应）。于是「后端明明在监听、
 * 只是被一个重活压住」会被判成「后端未连接」，页面上出现一个需要人工点击的闸门，
 * 而这个闸门背后没有任何自动恢复路径。
 *
 * 实测事故形态：`e2e/column-delete-entry.spec.ts` 排在 `agedepth-modal.spec.ts`
 * 之后时，`gotoApp` 等 `window.__straditize` 45 秒超时——页面停在这张闸门上，
 * 而同一时刻后端仍在监听、`system.ping` 也确实回 200。
 *
 * ## 本用例钉住什么
 *
 * 用**人为延迟**（不是伪造响应、不改任何载荷）让第一次 `system.ping` 慢 3 秒，
 * 超过探测自身的 2.5 秒 abort 时限，复现「后端忙」这一真实条件，然后要求：
 *
 * 1. 画布与 `window.__straditize` 必须就位（应用自己恢复，不需要用户点「重新连接」）；
 * 2. `#provenance-gate` 不得出现（不得把"忙"说成"未连接"）。
 *
 * 反向对照在别处：后端真的不在时闸门**必须**出现，该行为由
 * `ProvenanceGate.ensureDataProvenance` 的兜底分支与本文件的第 2 条用例共同守住
 * （第 2 条断的是"探测彻底失败仍然亮闸门"，防止把闸门改成永远不亮）。
 *
 * 只延迟第一条 ping：后续重试请求照常透传，测的才是"重试能否救回来"，而不是
 * "把所有请求都卡住"。
 */
import { expect, test, type Page } from './fixtures';

const STALL_MS = 3_000;

/** 只把**第一条** `system.ping` 拖慢，其余请求原样透传。 */
async function stallFirstPing(page: Page): Promise<void> {
  let stalled = false;
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (!stalled && body?.method === 'system.ping') {
      stalled = true;
      await new Promise((resolve) => setTimeout(resolve, STALL_MS));
    }
    await route.continue().catch(() => undefined);
  });
}

test.describe('后端忙不能被判成后端未连接', () => {
  test('首次探测超时（后端被重活压住 3s）时应用必须自行恢复，不得亮出阻塞闸门', async ({
    page,
  }) => {
    await stallFirstPing(page);
    await page.goto('/');

    const gate = page.locator('#provenance-gate');
    await expect(
      page.locator('canvas'),
      '后端只是忙，应用不得停在闸门上：画布必须就位'
    ).toBeVisible({ timeout: 30_000 });
    expect(
      await page.evaluate(() =>
        Boolean((window as unknown as { __straditize?: unknown }).__straditize)
      ),
      '调试/观测句柄必须挂上——它就是"应用真的启动了"的判据'
    ).toBe(true);
    await expect(gate, '一次探测超时不得被说成"后端未连接"').toHaveCount(0);
  });

  test('反向对照：后端彻底不可达时闸门必须亮出来（不得改成永远不亮）', async ({ page }) => {
    // 让**所有** RPC 都失败：这模拟"后端真的不在了"。
    await page.route('**/rpc', (route) => route.abort('connectionrefused'));
    await page.goto('/');

    await expect(
      page.locator('#provenance-gate'),
      '后端确实不可达时，闸门必须出现（否则"未连接"这件事对用户隐藏了）'
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#provenance-gate')).toContainText('后端未连接');
  });
});
