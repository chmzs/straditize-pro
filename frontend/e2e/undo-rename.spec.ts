import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * U3：**列改名必须能被真正撤销**（后端状态回退，不是 DOM 回退）。
 *
 * ## 缺陷背景（实测，见 docs/findings/undo-redesign-2026-11-11.md）
 * 旧撤销只重放"前端快照"，而列名的权威存储在 `columns[i].name`：
 * 实测同一个"列改名 → 撤销"动作，撤销时发的分别是 `algorithm.applyLineRemoval` /
 * `algorithm.measureRuler` / 一条都不发，**永不命中改名本身**，后端名字从不回退。
 *
 * ## 本用例钉住
 * 1. 改名成功后 `#btn-undo` 必须可用；
 * 2. 点撤销后**后端** `columns[].name` 必须回到旧名（读 `getDiagramData`，不看 DOM）；
 * 3. 撤销后再点重做，后端名字回到新名（逆操作成对）。
 *
 * 金丝雀：注掉 `SidebarBridge` 里 `undoStack.push(...)` → 第 2 条必红（回落旧快照重放，只改界面）。
 */
test.describe('撤销列改名', () => {
  test('改名列 → 撤销 → 后端名字回退；重做 → 再改回', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 6);

    const before = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const col = (before.columns ?? [])[0] as any;
    expect(col, '基线应至少有一列').toBeTruthy();
    const oldName: string = col.name;
    const newName = `UNDO_${Date.now() % 100000}`;

    const input = page.locator(`input.taxa-name-inline-input[data-col-id="${col.id}"]`).first();
    await input.click();
    await input.fill(newName);
    await input.press('Tab'); // 失焦触发 change（侧栏的提交入口）

    // 1) 改名已落到后端
    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return (d.columns ?? []).find((c: any) => c.id === col.id)?.name;
        },
        { message: '改名必须先真的写进后端', timeout: 15_000 }
      )
      .toBe(newName);

    // 2) 撤销按钮必须可用（栈里刚压了一条可撤销动作）
    const undoBtn = page.locator('#btn-undo');
    await expect(undoBtn, '改名后撤销按钮必须可用').toBeEnabled({ timeout: 10_000 });

    // 3) 撤销 → 后端名字回退（这是承重断言）
    await undoBtn.click();
    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return (d.columns ?? []).find((c: any) => c.id === col.id)?.name;
        },
        { message: '撤销后后端列名必须回到旧名（界面回退不算）', timeout: 20_000 }
      )
      .toBe(oldName);

    // 4) 重做 → 再改回新名
    const redoBtn = page.locator('#btn-redo');
    await expect(redoBtn).toBeEnabled({ timeout: 10_000 });
    await redoBtn.click();
    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return (d.columns ?? []).find((c: any) => c.id === col.id)?.name;
        },
        { message: '重做后后端列名必须回到新名', timeout: 20_000 }
      )
      .toBe(newName);
  });
});
