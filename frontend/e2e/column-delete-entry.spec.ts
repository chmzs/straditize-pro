import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * H-32：列删除的**入口可达性**与**删后不错位**。
 *
 * ## 缺陷背景
 * 后端 `column.remove` 一直可用（`rpc_methods/columns.py:11`），前端也写好了删除按钮
 * （`Inspector.ts` 的 `#btn-col-delete`）与处理函数，但按钮所在的**列属性面板**只有在
 * `data.selectedEntity = {type:'column'}` 时才渲染，而这个状态**只有"画布上用选择工具(S)
 * 点列边界"才能设置**——从侧栏点选一列只设置了 activeTaxaId，走不到那个面板。
 * 实测（`.scratch/hands-on/undo/`）四种入口全部拿不到 `#btn-col-delete`，用户以为没有删除功能。
 *
 * ## 本用例钉住三件事
 * 1. 从侧栏点选一列 → `#btn-col-delete` **可见**（入口可达）；
 * 2. 删除必须**先确认**（对话框），取消则一列不少（破坏性操作不得一点就删）；
 * 3. 删除后**其余列的控制点行号逐列不变**、`colIndex` 连续（防"删一列把后面全部错位"）。
 *
 * 判据全部读后端 `straditize.getDiagramData`，不看 DOM 文本。
 */
test.describe('列删除入口与删后不错位', () => {
  test('侧栏点选列即可打开列属性面板；确认后删除该列，其余列控制点逐列不变', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 6);

    const before = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const cols = (before.columns ?? []) as any[];
    expect(cols.length, '基线应有 ≥3 列才谈得上删中间列').toBeGreaterThanOrEqual(3);

    const target = cols[1];

    // 1) 侧栏点选（点该列的行内改名输入框 → focusin → onSelectTaxa）
    await page
      .locator(`input.taxa-name-inline-input[data-col-id="${target.id}"]`)
      .first()
      .click();

    const del = page.locator('#btn-col-delete');
    await expect(del, '从侧栏点选一列后，列属性面板里的【删除列】必须可达').toBeVisible({
      timeout: 10_000,
    });

    // 2) 第一次点击只"上膛"：一列都不许少，按钮文案必须变成二次确认
    await del.click();
    await expect(del, '第一次点击必须进入二次确认态').toHaveText(/再点一次确认/, {
      timeout: 5_000,
    });
    await page.waitForTimeout(400);
    const afterArm = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    expect((afterArm.columns ?? []).length, '上了膛但没确认时不得删除任何列').toBe(cols.length);

    // 3) 第二次点击才真删：该列消失，其余列控制点行号不变
    await del.click();

    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return (d.columns ?? []).length;
        },
        { timeout: 15_000 }
      )
      .toBe(cols.length - 1);

    const after = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const afterCols = (after.columns ?? []) as any[];
    expect(afterCols.map((c) => c.id)).not.toContain(target.id);

    const rowsOf = (c: any) =>
      (c.controlPoints ?? []).map((p: any) => p.y).sort((a: number, b: number) => a - b);

    for (const c of cols.filter((x) => x.id !== target.id)) {
      const found = afterCols.find((x) => x.id === c.id);
      expect(found, `列 ${c.id} 不得因为删除别的列而消失`).toBeTruthy();
      expect(rowsOf(found), `列 ${c.id} 的控制点行号必须与删除前逐值相同`).toEqual(rowsOf(c));
    }

    // 4) colIndex 连续重排（0..n-1）—— payload 里是 snake_case `col_index`
    const idxOf = (c: any) => c.col_index ?? c.colIndex;
    expect(afterCols.map(idxOf)).toEqual(afterCols.map((_, i) => i));
  });
});
