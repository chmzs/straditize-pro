import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * U6：**删除列不可撤销**，因此不得让撤销按钮亮起来。
 *
 * 缺陷背景：删除列在后端没有"恢复"通道。旧代码却在三处压了旧 history
 * （`Inspector.ts` / `GeologyCanvas.ts` / `EraserToolStrategy.ts`），
 * 于是删除后撤销按钮变亮、点下去走前端快照重放 —— 列并不会回来，
 * 属于"可点但没反应"，比按钮灰着更误导。
 *
 * 本用例钉住两件事：
 * 1. 删除列**不改变**撤销按钮的可用状态（不产生可撤销条目）；
 * 2. 即使点了撤销，被删的列**不会**回来（删除就是不可逆，界面不许暗示相反）。
 */
test.describe('删除列不可撤销', () => {
  test('删除中间列后撤销按钮状态不变；点撤销也不会把列恢复', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 6);

    const before = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const cols = (before.columns ?? []) as any[];
    expect(cols.length).toBeGreaterThanOrEqual(3);
    const target = cols[1];

    const undoBtn = page.locator('#btn-undo');
    const disabledBefore = await undoBtn.isDisabled();

    await page.locator(`input.taxa-name-inline-input[data-col-id="${target.id}"]`).first().click();
    await expect(page.locator('#btn-col-delete')).toBeVisible({ timeout: 10_000 });

    await page.locator('#btn-col-delete').click(); // 上膛
    await page.locator('#btn-col-delete').click(); // 确认

    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return (d.columns ?? []).length;
        },
        { timeout: 15_000 }
      )
      .toBe(cols.length - 1);

    // 1) 删除不得新增可撤销条目
    const disabledAfter = await undoBtn.isDisabled();
    expect(
      disabledAfter,
      `删除列不得让撤销按钮变亮（删除前 disabled=${disabledBefore}，删除后 disabled=${disabledAfter}）`
    ).toBe(disabledBefore);

    // 2) 点撤销也不会把列恢复（若按钮可用，说明还有别的可撤销动作，点了也不该回来）
    if (!disabledAfter) {
      await undoBtn.click();
      await page.waitForTimeout(800);
    }
    const after = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    expect(
      (after.columns ?? []).map((c: any) => c.id),
      '被删除的列不得因为"撤销"而复活'
    ).not.toContain(target.id);
  });
});
