/**
 * 文件型导出（LiPD / XLSX）的**浏览器下载**契约：点按钮必须真的下载到一个文件。
 *
 * 为什么需要这条：后端 export.exportLipd 曾两条分支都只返回 lipd 字典、从不给
 * base64，前端 if (res && res.base64) 又没有 else —— 用户点「LiPD」既不下载也
 * 不报错。单元测试只能证明"base64 解出来是 zip"，证明不了"按钮真的产出一个
 * .lpd 文件"。本 spec 补的就是这一段：等 download 事件、看文件名、读文件头。
 *
 * 两条用例共用 expectZipDownload：文件名后缀 + 前 4 字节 PK\x03\x04 + 大小 > 0。
 *
 * 反向验证：把 export_multi_lipd 的返回改回 {"success": True, "lipd": ...}
 * （不返回 base64）→ LiPD 用例在这里变红（waitForEvent 超时），不是只靠单测红。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';
/** 组斜率（与 step6 用例同量级），让每列真的有百分比读数。 */
const SLOPE = 0.16129;

const PK_HEADER = [0x50, 0x4b, 0x03, 0x04];

/** 步骤 3：填两个像素行 + 两个数值，点一次「应用」，等后端确认。 */
async function calibrateDepth(page: Page): Promise<void> {
  await gotoStage(page, 3);
  await page.evaluate(() => {
    const pairs: Array<[string, string]> = [
      ['#ycal-inp-unit', 'cm'],
      ['#ycal-inp-top-px', '200'],
      ['#ycal-inp-bot-px', '600'],
      ['#ycal-inp-top-val', '0'],
      ['#ycal-inp-bot-val', '40'],
    ];
    for (const [selector, value] of pairs) {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error('标定面板缺少控件 ' + selector);
      el.value = value;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (window as unknown as { __straditize?: { rpc: Function } }).__straditize;
          const data = (await api!.rpc('straditize.getDiagramData')) as {
            calibration: { isCalibrated: boolean };
          };
          return data.calibration.isCalibrated;
        }),
      { message: 'Y 标定必须落到后端', timeout: 15_000 }
    )
    .toBe(true);
}

/** 组级 X 标定：与步骤 6「点齿 + 填数字」同一条后端写入。 */
async function calibrateColumnsX(page: Page): Promise<void> {
  await gotoStage(page, 6);
  await rpc(page, 'roi.groupUpdate', {
    roi_id: RID,
    group_id: GID,
    updates: { value_per_px: SLOPE },
  });
}

async function openExportModal(page: Page): Promise<void> {
  await page.locator('#btn-export-csv').click();
  await expect(
    page.locator('#btn-wpd-download-lipd'),
    '导出弹窗应打开且带 LiPD 按钮'
  ).toBeVisible();
}

async function expectZipDownload(
  page: Page,
  selector: string,
  suffix: string
): Promise<{ name: string; size: number }> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator(selector).click(),
  ]);
  const name = download.suggestedFilename();
  expect(name.endsWith(suffix), '文件名应以 ' + suffix + ' 结尾，实际 ' + name).toBe(true);

  const path = await download.path();
  expect(path, 'download.path() 为空：没有真正落盘').toBeTruthy();
  const bytes = readFileSync(path as string);
  expect(bytes.length, '下载到的文件是空的').toBeGreaterThan(0);
  expect(
    [...bytes.subarray(0, 4)],
    '文件头必须是 zip 的 PK\\x03\\x04，实际 ' + JSON.stringify([...bytes.subarray(0, 4)])
  ).toEqual(PK_HEADER);
  return { name, size: bytes.length };
}

test.describe('导出面板：LiPD / XLSX 必须真的下载到文件', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    await calibrateDepth(page);
    await calibrateColumnsX(page);
  });

  test('点 LiPD → 下载到 .lpd 文件，PK 头，非空', async ({ page }) => {
    await openExportModal(page);
    const { name, size } = await expectZipDownload(page, '#btn-wpd-download-lipd', '.lpd');
    expect(name).toMatch(/_stradpro_lipd_\d{8}_(?:\d{4}|\d{6})\.lpd$/);
    expect(size, '一个只含 JSON-LD 的包也应有几百字节').toBeGreaterThan(100);
  });

  test('点 XLSX → 下载到 .xlsx 文件，PK 头，非空', async ({ page }) => {
    await openExportModal(page);
    const { name, size } = await expectZipDownload(page, '#btn-wpd-download-xlsx', '.xlsx');
    expect(name).toMatch(/_stradpro_report_\d{8}_(?:\d{4}|\d{6})\.xlsx$/);
    expect(size).toBeGreaterThan(100);
  });
});
