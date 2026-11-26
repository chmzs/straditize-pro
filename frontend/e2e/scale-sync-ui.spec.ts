/**
 * #150 / #175 UI 端到端回归：步骤 6 调整组倍率后，侧栏峰值与 export.csv 必须同比例缩放，
 * 且不得触发重数字化改变 controlPoints 数量。
 */
import { expect, test, type Page } from './fixtures';
import { gotoStage, resetBaseline, rpc, waitForDiagram } from './helpers';
import type { DiagramData } from '../src/types/pollen';

function parseCsvMax(csvText: string, colName: string): number {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('export.csv 行数不足');
  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = headers.indexOf(colName);
  if (idx < 0) throw new Error(`export.csv 缺少列 ${colName}`);
  let maxVal = -Infinity;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i].split(',')[idx]?.trim() ?? '';
    if (!raw || raw === 'NA') continue;
    const num = Number.parseFloat(raw);
    if (Number.isFinite(num) && num > maxVal) maxVal = num;
  }
  return maxVal;
}

async function readExportPeak(page: Page, colName: string): Promise<number> {
  const csv = await rpc<string>(page, 'export.csv', {});
  return parseCsvMax(csv, colName);
}

async function readSidebarPeak(page: Page, colId: string): Promise<number> {
  const card = page.locator(`.taxa-card[data-taxa-id="${colId}"]`).first();
  const peakRow = card.locator('.meta-item', { hasText: '峰值（实测最大）' }).first();
  const text = (await peakRow.locator('code strong').textContent()) ?? '';
  const num = Number.parseFloat(text.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(num)) {
    throw new Error(`侧栏峰值解析失败：colId=${colId}, text=${JSON.stringify(text)}`);
  }
  return num;
}

async function sumGroupControlPoints(page: Page, groupId: string): Promise<number> {
  const data = await rpc<DiagramData>(page, 'straditize.getDiagramData', {});
  return data.columns
    .filter((c) => c.x_group_id === groupId)
    .reduce((acc, c) => acc + (c.controlPoints?.length ?? 0), 0);
}

test.describe('#150/#175：步骤 6 组倍率同步（侧栏峰值 vs export.csv）', () => {
  test('点 5× 与手填 10× 后侧栏峰值与 export.csv 同比例变化，且 controlPoints 不变', async ({
    page,
  }) => {
    await resetBaseline(page);

    const initial = await rpc<DiagramData>(page, 'straditize.getDiagramData', {});
    const roi = initial.rois?.[0];
    const group = roi?.x_groups?.[0];
    if (!roi || !group) throw new Error('基线缺少默认 ROI 或列组');
    const col = initial.columns.find((c) => c.x_group_id === group.id) ?? initial.columns[0];
    if (!col) throw new Error('基线缺少属种列');

    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 100 },
      ],
      unit: 'cm',
      primary_axis: 'depth',
    });
    await rpc(page, 'column.redigitizeAll', {});
    await rpc(page, 'roi.groupUpdate', {
      roi_id: roi.id,
      group_id: group.id,
      updates: { value_per_px: 1.0 },
    });

    await page.reload();
    await waitForDiagram(page);
    await gotoStage(page, 6);

    const cpBefore = await sumGroupControlPoints(page, group.id);
    expect(cpBefore).toBeGreaterThan(0);

    const exportPeak1 = await readExportPeak(page, col.name);
    const sidebarPeak1 = await readSidebarPeak(page, col.id);
    expect(exportPeak1).toBeGreaterThan(0);
    const ratioBefore = sidebarPeak1 / exportPeak1;
    expect(Math.abs(ratioBefore - 1)).toBeLessThan(0.05);

    // 1. 点击组面板 5× 按钮
    await page.locator('.grp-exag-btn[data-exag="5"]').click();
    await expect
      .poll(() => readSidebarPeak(page, col.id), { timeout: 15_000 })
      .toBeLessThan(sidebarPeak1 * 0.3);

    const exportPeak5 = await readExportPeak(page, col.name);
    const sidebarPeak5 = await readSidebarPeak(page, col.id);
    expect(Math.abs(exportPeak5 - exportPeak1 / 5)).toBeLessThan(0.05);
    expect(Math.abs(sidebarPeak5 / exportPeak5 - ratioBefore)).toBeLessThan(0.05);
    expect(await sumGroupControlPoints(page, group.id)).toBe(cpBefore);

    // 2. 手填倍率输入框 10
    const exagInput = page.locator('#grp-exag-inp');
    await exagInput.fill('10');
    await exagInput.press('Enter');
    await expect
      .poll(() => readSidebarPeak(page, col.id), { timeout: 15_000 })
      .toBeLessThan(sidebarPeak5 * 0.7);

    const exportPeak10 = await readExportPeak(page, col.name);
    const sidebarPeak10 = await readSidebarPeak(page, col.id);
    expect(Math.abs(exportPeak10 - exportPeak1 / 10)).toBeLessThan(0.05);
    expect(Math.abs(sidebarPeak10 / exportPeak10 - ratioBefore)).toBeLessThan(0.05);
    expect(await sumGroupControlPoints(page, group.id)).toBe(cpBefore);

    // 3. 改列级轴线粗（触发 column.update → SCALE_MUTATING_METHODS → applyScaleSnapshot）
    //    轴粗增大使 0 点右移，侧栏峰值与 export.csv 必须同步减小。
    const colAxisInput = page.locator('#inp-col-axis-stroke');
    await colAxisInput.fill('12');
    await colAxisInput.press('Tab');
    await expect
      .poll(() => readSidebarPeak(page, col.id), { timeout: 15_000 })
      .toBeLessThan(sidebarPeak10 - 0.3);

    const exportPeakStroke = await readExportPeak(page, col.name);
    const sidebarPeakStroke = await readSidebarPeak(page, col.id);
    expect(exportPeakStroke).toBeLessThan(exportPeak10);
    expect(Math.abs(sidebarPeakStroke / exportPeakStroke - ratioBefore)).toBeLessThan(0.05);
  });
});
