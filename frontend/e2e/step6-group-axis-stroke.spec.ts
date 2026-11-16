/**
 * 组轴粗的**显示隔离**：输入框只能显示当前组自己的 `axis_stroke_px`。
 *
 * ## 用户原话
 *
 * 「轴线修改粗细只在组1的col1生效，组2和组3的col28均不生效」
 * 「我设置了 grp2，然后其他两组的线粗框**自动就显示 1 了**，我以为它直接接过值了，
 *   就没手动改。」
 *
 * ## 缺陷本体（实测）
 *
 * 后端两条链路都对：写 → 保存 → 重载，三组都能保持各自的值（见 PR 里的 Python 复现）。
 * 问题在显示：`XTicksPanel` 的输入框 value 有一个**跨组**的全局兜底
 * （`state.axisStrokeOverride`，注释写着「用户量一次、全图共用」）。于是
 * 给 grp2 填 1 之后切到 grp1/grp3，那两个框也显示 1 —— 用户读作「已经接过值了」，
 * 不再手动设，后端仍是 None、绿线回落缺省 5。属于「界面编造状态」。
 *
 * ## 判据
 *
 * - 给 grp2 设 1 → 切 grp1 / grp3：输入框 value 必须是 ''（缺省 5 只出现在 placeholder）；
 * - 切回 grp2：value === '1'；
 * - `project.save` → `project.load` 重载后，三组分别显示 '' / '1' / ''；
 * - 反向验证：把 value 的兜底改回全局变量 → 第一条立刻红（实测显示 '1'）。
 */
import { expect, test } from './fixtures';
import { backendRpc, gotoStage, openApp, openStep6GroupsFold, resetBaseline } from './helpers';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

interface GroupRow { id: string; axis_stroke_px?: number | null }

async function groupsOf(page: Page): Promise<GroupRow[]> {
  const res = await backendRpc<{ rois: Array<{ x_groups?: GroupRow[] }> }>(page, 'roi.list');
  return res.rois[0]?.x_groups ?? [];
}

async function strokes(page: Page): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const g of await groupsOf(page)) out[g.id] = g.axis_stroke_px ?? null;
  return out;
}

/** 造出与用户工程同构的三组：grp1（默认）/ grp2（col01）/ grp3（col28）。 */
async function setupThreeGroups(page: Page) {
  await resetBaseline(page);
  const roi = (await backendRpc<{ rois: Array<{ id: string; default_group_id?: string }> }>(
    page,
    'roi.list'
  )).rois[0];
  const g2 = (await backendRpc<{ group: { id: string } }>(page, 'roi.groupCreate', {
    roi_id: roi.id, name: '组 2', unit: '粒/g', plot_type: 'line',
  })).group;
  const g3 = (await backendRpc<{ group: { id: string } }>(page, 'roi.groupCreate', {
    roi_id: roi.id, name: '组 3', unit: '粒/g', plot_type: 'line',
  })).group;
  await backendRpc(page, 'column.update', { col_index: 0, updates: { x_group_id: g2.id } });
  await backendRpc(page, 'column.update', { col_index: 27, updates: { x_group_id: g3.id } });
  // 必须重载：面板的数据来自 getDiagramData，RPC 直改后端不会推给已加载的页面。
  await openApp(page);
  await gotoStage(page, 6);
  await openStep6GroupsFold(page);
  return { g1: roi.default_group_id as string, g2: g2.id, g3: g3.id };
}

async function selectGroup(page: Page, gid: string): Promise<void> {
  await page.locator('.btn-switch-group-tab[data-group-id="' + gid + '"]').click();
  await page.waitForTimeout(200);
}

test.describe('步骤 6：组轴粗的显示隔离', () => {
  test('T1 给 grp2 设 1 后，grp1 / grp3 的输入框不得跟着显示 1', async ({ page }) => {
    const { g1, g2, g3 } = await setupThreeGroups(page);

    // 前置：三组都还没有轴粗值。
    const before = await strokes(page);
    expect(before[g1], '前置：grp1 初始无值').toBeNull();
    expect(before[g2], '前置：grp2 初始无值').toBeNull();
    expect(before[g3], '前置：grp3 初始无值').toBeNull();

    await selectGroup(page, g2);
    await expect(page.locator('#inp-axis-stroke'), 'grp2 初始应为空').toHaveValue('');
    await page.locator('#inp-axis-stroke').fill('1');
    await page.locator('#inp-axis-stroke').dispatchEvent('change');

    await expect
      .poll(async () => (await strokes(page))[g2], {
        message: 'grp2 的轴粗必须落库为 1',
        timeout: 15_000,
      })
      .toBe(1);

    // 核心判据：别的组不得显示 1。
    await selectGroup(page, g1);
    await expect(
      page.locator('#inp-axis-stroke'),
      'grp1 没有自己的轴粗值，输入框必须为空（不得显示 grp2 的 1）'
    ).toHaveValue('');
    await selectGroup(page, g3);
    await expect(
      page.locator('#inp-axis-stroke'),
      'grp3 没有自己的轴粗值，输入框必须为空（不得显示 grp2 的 1）'
    ).toHaveValue('');

    // 切回 grp2 必须还原成自己的值。
    await selectGroup(page, g2);
    await expect(page.locator('#inp-axis-stroke'), '切回 grp2 应显示 1').toHaveValue('1');

    // 别的组在后端也必须是 None（显示层不能把值写给别人）。
    const after = await strokes(page);
    expect(after[g1], 'grp1 后端仍应为 null').toBeNull();
    expect(after[g3], 'grp3 后端仍应为 null').toBeNull();
  });

  test('T2 project.save → project.load 后三组分别显示 空 / 1 / 空', async ({ page }) => {
    const { g1, g2, g3 } = await setupThreeGroups(page);
    await selectGroup(page, g2);
    await page.locator('#inp-axis-stroke').fill('1');
    await page.locator('#inp-axis-stroke').dispatchEvent('change');
    await expect.poll(async () => (await strokes(page))[g2], { timeout: 15_000 }).toBe(1);

    // 保存成真工程包，再按路径 load 回来（走 project.load 的 .tar 分支）。
    const saved = await backendRpc<{ tar_base64: string }>(page, 'project.save');
    const tarPath = test.info().outputPath('saved-groups.tar');
    writeFileSync(tarPath, Buffer.from(saved.tar_base64, 'base64'));
    await backendRpc(page, 'project.load', { project_data: tarPath });

    await openApp(page);
    await gotoStage(page, 6);
    await openStep6GroupsFold(page);

    await selectGroup(page, g1);
    await expect(page.locator('#inp-axis-stroke'), '重载后 grp1 应为空').toHaveValue('');
    await selectGroup(page, g2);
    await expect(page.locator('#inp-axis-stroke'), '重载后 grp2 应为 1').toHaveValue('1');
    await selectGroup(page, g3);
    await expect(page.locator('#inp-axis-stroke'), '重载后 grp3 应为空').toHaveValue('');
  });
});
