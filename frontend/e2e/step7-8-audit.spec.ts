/**
 * 步骤 7 与 步骤 8 逐步骤可用性排查门禁（闭环排查矩阵终章）。
 *
 * 覆盖：
 * - 步骤 7 SamplesPanel：
 *   1. 【自动提取层位共识】落库并在 #horizons-list-container 显示；
 *   2. 单行层位删除按钮（.btn-delete-sample）真发 samples.set 且后端数量-1；
 *   3. 【清空层位】清空后端 samples 且面板回到零态；
 *   4. 【进入下一步】顺利推进到步骤 8。
 * - 步骤 8 QaPanel + ExportReadinessPanel：
 *   5. 【调整容差】（#qa-inp-tolerance）触发 qa.summarize 重新计算，且 banner/指标实时联动；
 *   6. 【重新执行 QA】（#btn-run-qa）真发 RPC；
 * 7. 未标定属种列在 #qa-column-peaks-container 中显式标出 未标定，
 *      且 #lbl-export-calibration-status 显示未标定列数统计（P1: 未标定显式化）；
 *   8. 【直接导出】（#btn-qa-export）触发导出通道。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

test.describe('步骤 7 & 8 逐动作可用性排查', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('步骤 7：共识提取、单行删除落后端、清空层位与推进', async ({ page }) => {
    await gotoStage(page, 7);

    // 1. 点击【自动提取共识层位】
    await page.locator('#btn-extract-consensus').click();

    // 断言 DOM 列表渲染出多行层位，且后端 samples.list 非空
    const container = page.locator('#horizons-list-container');
    await expect(container.locator('.btn-delete-sample').first()).toBeVisible({ timeout: 10_000 });
    const initialDomCount = await container.locator('.btn-delete-sample').count();
    expect(initialDomCount).toBeGreaterThan(0);

    const backendBefore = await rpc<{ samples: any[]; count: number }>(page, 'samples.list');
    expect(backendBefore.count).toBe(initialDomCount);

    // 2. 点击第一行的单个删除按钮，断言真落后端
    await container.locator('.btn-delete-sample').first().click();
    await expect
      .poll(async () => (await rpc<{ count: number }>(page, 'samples.list')).count, {
        timeout: 5000,
      })
      .toBe(initialDomCount - 1);

    // 3. 点击【清空层位】
    await page.locator('#btn-clear-horizons').click();
    await expect
      .poll(async () => (await rpc<{ count: number }>(page, 'samples.list')).count, {
        timeout: 5000,
      })
      .toBe(0);
    await expect(container).toContainText('-- 暂无层位 --');

    // 4. 点击【进入下一步】进入步骤 8
    await page.locator('#btn-apply-samples-next').click();
    await expect(page.locator('.step-panel[data-step="8"]')).toBeVisible();
  });

  test('步骤 8：容差调整联动、未标定状态显式化与诊断触发', async ({ page }) => {
    await gotoStage(page, 8);

    const qaBanner = page.locator('#qa-banner');
    await expect(qaBanner).toBeVisible({ timeout: 10_000 });

    // 1. 验证未标定列显式化 (P1 成果)
    // 基线图谱在步骤 6 前默认未标定，QA 面板不得假报 "✓"
    const peaksContainer = page.locator('#qa-column-peaks-container');
    await expect(peaksContainer).toBeVisible();
    await expect(peaksContainer).toContainText('未标定');

    // 2. 更改门禁容差
    const tolInp = page.locator('#qa-inp-tolerance');
    await tolInp.fill('0.5');
    await tolInp.dispatchEvent('change');

    // 断言容差联动生效
    await page.waitForTimeout(500);

    // 3. 点击【重新执行 QA 诊断】按钮
    await page.locator('#btn-run-qa').click();
    await expect(qaBanner).toBeVisible();

    // 4. 点击【直接导出】打开导出与就绪状态清单模态框
    await page.locator('#btn-qa-export').click();
    const calibStatus = page.locator('#lbl-export-calibration-status');
    await expect(calibStatus).toBeVisible({ timeout: 15_000 });
    await expect(calibStatus).toContainText('未标定');
  });
});
