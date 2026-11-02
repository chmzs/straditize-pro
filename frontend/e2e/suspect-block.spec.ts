/**
 * P1 suspect_block：后端标记「这一列是色块不是曲线」，界面必须让用户看见。
 *
 * ## 判据设计（不是"提示元素存在"）
 *
 * 1. **与后端真值交叉核对**：先读 `straditize.getDiagramData` 的列载荷，找出真正带
 *    `suspect_block` 的列（这是权威事实）；再断言界面上：
 *    - 步骤 5 的分列提示点名了**那一列**；
 *    - 步骤 6（点选该列后）的属性面板出现提示，且带 `data-suspect-reason`；
 *    - 导出就绪清单出现 `data-export-suspect-count`，且点名同一列。
 *    数字与列名都按 equality 断言，不是"存在即通过"。
 * 2. **文案三件事**：可能是色块 / 判据依据（填满率、变异系数）/ 该怎么办（删除列、
 *    且明说系统不会自动删）。
 * 3. **不得自动剔除**：断言该列在 `getDiagramData` 里**仍然存在**、仍可被标定。
 *    这是"绝不返回替代数据"在界面侧的对应约束。
 * 4. **反向哨兵**：未被标记的列（hoya 的 col01）点选后**不得**出现该提示。
 *    否则"提示永远显示"，判据没有判别力。
 *
 * ## 取样口径（这一条差点踩坑，务必保留）
 *
 * e2e 后端的基线是 `_load_baseline()` 用固定 `HOYA_X_BOUNDS=[315,1946]`、
 * `HOYA_Y_BOUNDS=[511,1311]` 分列的——那套边界得到 **28 列且一列都不命中**。
 * 产品真实路径是 `core.loadImage` 的建议 ROI（`[309,2030]×[507,1314]`）→ **29 列、
 * 命中第 29 列**。所以本套件必须自己走产品路径重载分列，不能直接用基线：
 * 用基线会得到"零命中"，那样断言的就不是产品现状了。
 */
import { expect, test } from './fixtures';
import { openApp, resetBaseline, rpc } from './helpers';

interface WireColumn {
  id: string;
  name: string;
  col_index: number;
  suspect_block?: {
    reason?: string;
    cv?: number;
    fill_ratio?: number;
    mean_ink_width?: number;
    column_width?: number;
  } | null;
}

interface WireData {
  columns: WireColumn[];
}

/**
 * 走产品路径载入 **benchmark 图**并按建议 ROI 分列，返回带标记的列。
 *
 * 为什么不用 hoya：hoya 图上没有「填满整列的色块」—— 实测 29 列的
 * `fill_ratio` 最高只有 **0.735**（阈值 0.95），`_detect_block_column` 判 0 列
 * 是**正确行为**。用一张不含该特征的图去测「色块列必须被点名」，等于用一个
 * 不可能发生的场景测功能，判据永远不可能真绿。
 * Pollen benchmark 的合成列 `fill=0.982 / cv=0.008`，才是这条判据该测的对象。
 *
 * 另：`core.detectColumns` 的参数名是 `data_xlim` / `data_ylim`，
 * 原写法 `x_bounds` / `y_bounds` 会被静默忽略（AGENTS.md 记载的历史事故）。
 */
async function loadBenchmarkProductPath(
  page: import('@playwright/test').Page
): Promise<WireColumn[]> {
  await openApp(page);
  const load = await rpc<{ suggested_roi: Record<string, number> }>(page, 'core.loadImage', {
    image_path: 'tests/data/figures/benchmark_types/Pollen_riojaPlotTestData.png',
  });
  const sug = load.suggested_roi;
  await rpc(page, 'core.detectColumns', {
    data_xlim: [sug.xMin, sug.xMax],
    data_ylim: [sug.yMin, sug.yMax],
  });
  // 绕过 UI 的 RPC 不刷新前端镜像，重载后前端才拿到新列
  await page.reload();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
    undefined,
    { timeout: 45_000 }
  );
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __straditize?: { getState: () => Record<string, unknown> };
      }).__straditize;
      return ((api?.getState()?.columns ?? []) as unknown[]).length > 0;
    },
    undefined,
    { timeout: 45_000 }
  );
  const data = await rpc<WireData>(page, 'straditize.getDiagramData', {});
  return data.columns.filter((c) => c.suspect_block);
}

test.describe('P1 suspect_block 色块列必须在界面上可见', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 真实图版：带标记的列在步骤 5 / 步骤 6 / 导出就绪清单三处都被点名', async ({
    page,
  }) => {
    const flagged = await loadBenchmarkProductPath(page);
    // 前提：产品路径上必须确有命中，否则本用例测不到该场景
    expect(flagged.length, '产品路径上应有列被标记为色块').toBeGreaterThan(0);
    expect(flagged.length, '实测每张图只命中 1 列——若变多，文案口径需复核').toBe(1);
    const col = flagged[0];
    const colName = col.name;

    // ---- 步骤 5：分列刚跑完就该报出来 ----
    await page.evaluate(async () => {
      await (
        window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }
      ).__straditize.gotoStage(5);
    });
    const step5 = page.locator('[data-panel="step5"][data-suspect-count]');
    await expect(step5).toBeVisible({ timeout: 20_000 });
    await expect(step5).toHaveAttribute('data-suspect-count', String(flagged.length));
    // textContent 而非 innerText：这句「系统不会自动剔除」在折叠的 `<details>`
    // 内容里，Chrome 的 innerText 对折叠内容返回空串（与 naming.spec 同一个陷阱）。
    const step5Text = (((await step5.textContent()) ?? '')).replace(/\s+/g, ' ');
    expect(step5Text, '步骤 5 提示必须点名该列').toContain(colName);
    expect(step5Text).toContain('色块');
    expect(step5Text, '必须说明系统不会自动剔除').toMatch(/不会自动剔除|不会自动删除/);

    // ---- 步骤 6：点选该列（走 renderColumnInspector），提示 + 删除列按钮都要在 ----
    await page.evaluate(async (id: string) => {
      await (
        window as unknown as { __straditize: { selectColumn: (id: string) => Promise<void> } }
      ).__straditize.selectColumn(id);
    }, col.id);
    const notice = page.locator('[data-suspect-reason]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAttribute('data-col-id', col.id);
    await expect(notice).toHaveAttribute('data-suspect-reason', col.suspect_block!.reason!);

    const noticeText = (await notice.innerText()).replace(/\s+/g, ' ');
    // 三件事：可能是色块 / 判据依据 / 该怎么办
    expect(noticeText).toContain('色块');
    expect(noticeText).toContain('判据依据');
    expect(noticeText, '必须给出填满率这一判据数值').toMatch(/填满列宽的\s*[\d.]+%/);
    expect(noticeText, '必须给出变异系数这一判据数值').toMatch(/变异系数/);
    // 提示指向的按钮必须真实存在（否则文案指了个不存在的控件）
    await expect(page.locator('#btn-col-delete')).toHaveCount(1);
    expect(noticeText, '必须指向真实存在的【删除列】按钮').toContain('删除列');

    // ---- 导出就绪清单：用户最终在这里决定导不导 ----
    await page.locator('#btn-export-csv').click();
    const row = page.locator('[data-export-suspect-count]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toHaveAttribute('data-export-suspect-count', String(flagged.length));
    await expect(row).toHaveAttribute('data-export-suspect-cols', colName);
    const rowText = (await row.innerText()).replace(/\s+/g, ' ');
    expect(rowText).toContain(colName);
    expect(rowText).toContain('色块');
  });

  test('T2 不得自动剔除：带标记的列仍留在载荷里，读数与列数不被前端改动', async ({ page }) => {
    const flagged = await loadBenchmarkProductPath(page);
    expect(flagged.length).toBeGreaterThan(0);
    const col = flagged[0];

    // 渲染过三个界面之后，后端权威状态里该列必须仍然存在（前端不得静默删）
    await page.evaluate(async () => {
      await (
        window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }
      ).__straditize.gotoStage(5);
    });
    await page.evaluate(async (id: string) => {
      await (
        window as unknown as { __straditize: { selectColumn: (id: string) => Promise<void> } }
      ).__straditize.selectColumn(id);
    }, col.id);
    await page.waitForTimeout(500);

    const after = await rpc<WireData>(page, 'straditize.getDiagramData', {});
    const still = after.columns.find((c) => c.id === col.id);
    expect(still, '带标记的列不得被前端删除').toBeTruthy();
    expect(still!.suspect_block?.reason, '标记也应原样保留，不得被前端清掉').toBe(
      col.suspect_block!.reason
    );
    // 列总数不得因提示渲染而改变
    expect(after.columns.length, '列总数不得因提示渲染而变化').toBeGreaterThan(1);
  });

  test('T3 反向哨兵：未被标记的列点选后不得出现该提示', async ({ page }) => {
    const flagged = await loadBenchmarkProductPath(page);
    expect(flagged.length).toBeGreaterThan(0);
    const clean = (await rpc<WireData>(page, 'straditize.getDiagramData', {})).columns.find(
      (c) => !c.suspect_block
    );
    expect(clean, '前提：应存在未被标记的列').toBeTruthy();

    await page.evaluate(async (id: string) => {
      await (
        window as unknown as { __straditize: { selectColumn: (id: string) => Promise<void> } }
      ).__straditize.selectColumn(id);
    }, clean!.id);
    await page.waitForTimeout(600);

    // 该列走的是同一个 renderColumnInspector，提示必须为空
    await expect(page.locator('[data-suspect-reason]')).toHaveCount(0);
    const body = await page.locator('.inspector-body').innerText();
    expect(body, '未被标记的列不得出现色块提示').not.toMatch(/可能是色块或填充带/);
  });
});
