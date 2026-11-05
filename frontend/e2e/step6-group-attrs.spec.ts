/**
 * 步骤 6 的属性层级：**形态/尺度是组属性，局部放大是列属性**（缺陷 #23 回归）。
 *
 * 迁移自 `step6-xticks.spec.ts` 的 T6。那个文件整体断言的是已删除的「单列两点标定」
 * 控件（X1/X2 输入 + 保存/清空），其三条硬约束已由 `step6-group-slope.spec.ts`
 * 覆盖（真发 RPC / 重载仍在 / 非法输入当场拒绝），故整文件下线；
 * 但 T6 这条**没有替代**，必须留下：同一功能若在组面板和列面板各有一个控件，
 * 改一处另一处不知道，会直接写错数据。
 */
import { expect, test } from './fixtures';
import { diagramData, gotoStage, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';

/** 收集发往后端的 JSON-RPC：判据落在请求载荷上，而不只是前端乐观更新。 */
function watchRpc(page: Page): string[] {
  const methods: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
    try {
      const body = req.postDataJSON() as { method?: string; params?: unknown };
      if (!body?.method) return;
      methods.push(body.method);
      const bucket = methods as unknown as { payloads?: unknown[] };
      bucket.payloads ??= [];
      bucket.payloads.push({ method: body.method, params: body.params ?? null });
    } catch {
      /* 非 JSON 体不关心 */
    }
  });
  return methods;
}

test.describe('步骤 6 属性层级', () => {
  test('形态经 roi.groupUpdate、放大经 column.update，都必须真发 RPC', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 5);
    await gotoStage(page, 6);

    const rpc = watchRpc(page);
    const panel = page.locator('.step-panel[data-step="6"]');

    // 形态（plot_type）是**组**属性：入口在步骤 6 的组参数里，不是列属性面板。
    await panel.locator('.grp-plottype-btn[data-plottype="bar"]').click();
    await page.waitForTimeout(800);

    const payloads =
      (rpc as unknown as { payloads?: Array<{ method: string; params: any }> }).payloads ?? [];
    const groupUpdate = payloads.filter((x) => x.method === 'roi.groupUpdate').pop();
    expect(groupUpdate, '形态必须经 roi.groupUpdate 发出').toBeTruthy();
    expect(groupUpdate?.params?.updates?.plot_type, '载荷必须携带 plot_type=bar').toBe('bar');

    // 局部放大（exaggeration）仍是**列**属性：入口留在列属性面板。
    await page.evaluate(() => {
      const api = (window as unknown as {
        __straditize: { getState: () => any; selectColumn: (id: string) => void };
      }).__straditize;
      api.selectColumn(api.getState().columns[0].id);
    });
    const inspector = page.locator('.app-inspector');
    await inspector.locator('#chk-has-exag').check();
    await expect
      .poll(
        // 读**后端**权威载荷：前端镜像要等 onDataChange 才刷新，用它会写成假红。
        async () => {
          const cols = (await diagramData<{ columns: Array<Record<string, unknown>> }>(page)).columns;
          const c = cols[0];
          return c.exaggeration_mult ?? c.exaggerationMult;
        },
        { timeout: 10_000 }
      )
      .toBe(5);
    expect(rpc, '局部放大必须真发 RPC').toContain('column.update');
  });
});
