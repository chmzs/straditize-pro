/**
 * 列属性面板：**自动提取峰谷**必须真发 RPC，且不丢已有的控制点。
 *
 * `algorithm.extractTurningPoints` 原本是"有能力没入口"：算法完整（按几何曲线找峰/谷、
 * 保留手工点），但前端没有任何调用点，也没进 spec。入口补在列属性面板——它改的正是
 * "这一列的控制点"。
 *
 * ## 判据边界（写清楚，避免假断言）
 *
 * 这条 e2e 声称的是"**按钮接上了 RPC**"，不是"点数必然增加"：算法是把峰谷**合并**进
 * 现有控制点，若该列已由数字化铺满控制点，提取出来的峰谷可能一个都不新增（实测
 * fig3 基线就是 32 → 32）。"写入语义正确"由 `tests/unit/test_orphan_rpc_contracts.py`
 * 在干净列上钉住（那里断言 `control_points` 从空变非空、且手工点保留）。
 *
 * 所以这里钉三件事：按钮可见可点、真的发了那个 RPC、**已有的控制点一个都没少**。
 */

import { expect, test } from './fixtures';
import { diagramData, resetBaseline } from './helpers';

interface ColumnPayload {
  id: string;
  controlPoints?: { id?: string; y?: number }[];
}

async function controlPoints(page: import('@playwright/test').Page): Promise<string[]> {
  const data = await diagramData<{ columns: ColumnPayload[] }>(page);
  return (data.columns[0]?.controlPoints ?? []).map((p) => String(p.id ?? p.y));
}

test.describe('列属性面板：自动提取峰谷', () => {
  // 提取成功会弹一条**预期**提示（结果必须让用户看见），故登记豁免。
  test.use({ allowlists: { notice: [/已自动提取峰谷/] } });

  test('点按钮 → 发 algorithm.extractTurningPoints → 已有控制点不丢', async ({ page }) => {
    await resetBaseline(page);

    const methods: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
      try {
        const body = req.postDataJSON() as { method?: string };
        if (body?.method) methods.push(body.method);
      } catch {
        /* 非 JSON 体不关心 */
      }
    });

    const colId = await page.evaluate(
      () => (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState().columns[0].id
    );
    await page.evaluate(
      (id) => (window as unknown as { __straditize: { selectColumn: (i: string) => void } }).__straditize.selectColumn(id),
      colId
    );

    const button = page.locator('#btn-extract-turning-points');
    await expect(button, '入口必须出现在列属性面板里').toBeVisible();

    const before = await controlPoints(page);
    expect(before.length, '基线列应当已有控制点，否则这条判据测不到"合并"').toBeGreaterThan(0);

    await button.click();

    await expect
      .poll(() => methods.filter((m) => m === 'algorithm.extractTurningPoints').length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    const after = await controlPoints(page);
    const lost = before.filter((id) => !after.includes(id));
    expect(lost, '自动提取不得丢掉已有控制点（尤其是手工点）').toEqual([]);
  });
});
