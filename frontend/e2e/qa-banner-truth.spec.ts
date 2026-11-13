/**
 * 导出模态的「百分比总和自检」：空集不得判达标，判定必须复述后端结论。
 *
 * ## 实测现场（`.scratch/hands-on/export/`，独立 Edge，未构造脏数据）
 *
 * ```
 * 百分比总和自检: 全剖面平均总和 100.0%（各层位介于 999999.0% ~ 0.0%，质检达标）  0 层位质检
 * ```
 *
 * 同屏步骤 8 的面板横幅此刻是**红的**（「组分总和超标报警（788 个层位）」，
 * N_HORIZONS 808 / SUM_MAX 728.9%）。所以这不是"两边都错"，而是模态这条自检行
 * 用了**前端自算的第二条求和路径**，并且：
 * ① `999999` 是 `minSum` 的初始化哨兵（后端全字段递归扫描 0 命中，纯前端本地值），
 *    被当成真实上限印给用户；
 * ② `minSum >= 85 && maxSum <= 115` 在哨兵未更新时恒真 ⇒ **空集被判达标**。
 *
 * ## 本文件钉的两件事
 *
 * 1. 空集（被检层位 0）**不得**出现"达标/通过"，`999999` 不得作为上限展示；
 * 2. **保护性回归**：步骤 8 横幅在"有超标层位"的场景下必须仍然是红——修改自检行
 *    时若顺手把横幅也改绿，这条会立刻红。
 *
 * `page.route` 只用于第 2 条：把 `qa.summarize` 响应里的 `violations_over` 注入成
 * 107 条（其余字段原样透传），以便在不跑整条流水线的前提下钉住横幅的判定分支。
 * **这是注入，不是真实链路证据**，用例名与注释都已写明。
 */
import { expect, test, type Page } from './fixtures';
import { openApp, resetBaseline, rpc } from './helpers';

/**
 * 造出"有行可预览、但每行总和都是 0"的现场——这正是实测里 `0 层位质检` 的来源：
 *
 * - 先给第 1 列钉 x_ticks（像素→百分比映射，`px=startX → 0%`）；
 * - 再让后端真数字化出控制点，然后把每个控制点的 x 都压到列起点（=0%）；
 * - 行集来自控制点，于是"行存在、但没有任何一行被计入质检"。
 *
 * 不做这一步的话 `onExport` 的守卫（无控制点 → 打开就绪清单而不是导出模态）会拦住模态。
 */
async function stageZeroSumColumn(page: Page): Promise<void> {
  const data = await rpc<{
    columns: Array<{ id: string; startX: number; endX: number }>;
    rois: Array<{ id: string; ylim: number[] }>;
  }>(page, 'straditize.getDiagramData');
  const col = data.columns[0];
  const roi = data.rois[0];
  if (!col || !roi) throw new Error('基线缺少列或 ROI，无法构造零和现场');

  await rpc(page, 'column.update', {
    col_index: 0,
    updates: {
      roi_id: roi.id,
      scale_type: 'linear',
      startValue: 0,
      tickValue: 100,
      x_ticks: [
        { px: col.startX, value: 0 },
        { px: col.endX, value: 100 },
      ],
    },
  });
  await rpc(page, 'core.digitize', { col_index: 0 });

  const ylim = roi.ylim ?? [0, 0];
  for (let i = 0; i < 4; i++) {
    const row = Math.round(ylim[0] + ((ylim[1] - ylim[0]) * (i + 1)) / 5);
    // x 压到列起点 ⇒ 该行每个属种的读数都是 0% ⇒ 行总和 0 ⇒ 不计入质检。
    await rpc(page, 'core.updateControlPoint', { col_index: 0, row, x: col.startX });
  }

  // 前端镜像只有重载后才拿得到上面那批后端改动。
  await page.reload();
  await openApp(page);
}

test.describe('导出模态自检行：不得把空集或哨兵值说成达标', () => {
  // 契约：点【导出】必然打开面板（未标定也开）。面板一打开就发 `export.csv` 取行集，
  // 本用例现场没有 Y 轴标定，后端按 CALIBRATION_ERROR(`-32003`) 拒绝；这条失败由
  // `ExportModal.updateFullDisplay` 的 catch 分支写进行集 caption 并 notifyError，
  // 用户可见，不是被吞掉。自检行本身（`#wpd-sum-check-*`）的数据源是 `qa.summarize`，
  // 与行集无关，所以本用例的判据不受这次拒绝影响。
  // 豁免只收窄到这一种病因：别的方法失败、别的错误码仍判红。
  test.use({
    allowlists: {
      rpcError: [/export\.csv \[-32003\]/],
      notice: [/数据集失败：.*导出需要深度标定/],
    },
  });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('0 层位被检验时不得判"达标"，且 999999 哨兵不得作为上限展示', async ({ page }) => {
    await stageZeroSumColumn(page);
    await page.locator('#btn-export-csv').click();
    const text = page.locator('#wpd-sum-check-text');
    await expect(text, '导出模态必须渲染百分比总和自检行').toContainText('百分比总和自检', {
      timeout: 20_000,
    });

    await expect
      .poll(async () => (await page.locator('#wpd-sum-check-sub').textContent()) ?? '', {
        message: '自检行必须给出被检验的层位数',
        timeout: 20_000,
      })
      .toMatch(/\d+ 层位/);

    const sub = (await page.locator('#wpd-sum-check-sub').textContent()) ?? '';
    const body = (await text.textContent()) ?? '';

    // 前置：只有"确实一个层位都没被检验"的现场，下面的断言才有判别力。
    expect(sub, `本用例要求现场处于"未检验任何层位"的形态，实际副标题：${sub}`).toContain(
      '0 层位'
    );

    expect(
      body,
      `一行都没被检验却判"质检达标"＝把空集当通过（实际文案：${body}）`
    ).not.toMatch(/达标|通过/);
    expect(body, '内部哨兵 999999 不得作为"最小值/上限"展示给用户').not.toContain('999999');
  });
});

/**
 * 步骤 8 横幅的回归判据**不在本文件**，而是 `qa.spec.ts:154`：
 * 它用真实 RPC 造出 76 层位（最大 103.2%）、断言 `#qa-banner` 的 `data-level`
 * 必须是 `red`。那是一条真链路的正对照，比我在这里注入字段更强 ——
 * 本次改动没有碰 `QaPanel.computeBannerMeta`，该用例在相邻回归里一起跑。
 */
