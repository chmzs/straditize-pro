import { test, expect } from './fixtures';
import { openApp } from './helpers';

test.describe('用户反馈实机上机视觉验收', () => {
  test.use({
    allowlists: {
      rpcError: [/plot\.render/],
      notice: [/出图完成/, /读取 .* 数据集失败/],
    },
  });

  test('实机上机排查：数据表格垂直充满、原始文本等大充满、外层杜绝滚动叠块', async ({ page }) => {
    // 采用工作区视口 (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    // 构造地学 50 行 x 8 列数据
    const headers = ['Depth', 'Picea', 'Pinus', 'Betula', 'Quercus', 'Artemisia', 'Chenopodiaceae', 'Poaceae'];
    const rows: string[] = [];
    for (let i = 0; i < 50; i++) {
      const depth = (i * 2.5).toFixed(1);
      const vals = [
        depth,
        (Math.sin(i * 0.2) * 15 + 20).toFixed(2),
        (Math.cos(i * 0.15) * 20 + 25).toFixed(2),
        (Math.sin(i * 0.3) * 10 + 12).toFixed(2),
        (Math.cos(i * 0.25) * 8 + 10).toFixed(2),
        (Math.sin(i * 0.1) * 25 + 30).toFixed(2),
        (Math.cos(i * 0.05) * 12 + 15).toFixed(2),
        (Math.sin(i * 0.4) * 6 + 8).toFixed(2),
      ];
      rows.push(vals.join(','));
    }
    const sampleCsv = headers.join(',') + '\n' + rows.join('\n');

    // 拦截 export.csv / export.getReadiness / plot.render
    await page.route('**/rpc', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      let body: any = null;
      try {
        body = request.postDataJSON();
      } catch {
        return route.continue();
      }
      if (body?.method === 'export.csv') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: body?.id ?? null,
            result: {
              csv: sampleCsv,
              variables: headers.length - 1,
              samples_count: rows.length,
              bytes: sampleCsv.length,
              dataset: 'samples',
              column_units: { Depth: 'cm', Picea: '%', Pinus: '%' },
              sum_check: {
                status: 'ok',
                mean_sum: 100.0,
                violations: 0,
                total_horizons: 50,
                details: '全部 50 个层位丰度总和均在 100% 正常容差范围内',
              },
            },
          }),
        });
      }
      if (body?.method === 'export.getReadiness') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: body?.id ?? null,
            result: {
              ready: true,
              readinessMissing: [],
              sheets: ['samples', 'turning_points'],
              primaryRoi: 'roi_1',
              project_name: 'Han2026GPC_NgamringCo',
              rowset: { source: 'samples', label: '共识采样层位 (50 行)' },
            },
          }),
        });
      }
      return route.continue();
    });

    // 打开导出弹窗
    await page.locator('#btn-export-csv').click();
    await expect(page.locator('.wpd-export-dialog')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(600);

    // 1. 验证表格区高度拉伸：左侧容器与表格容器高度饱满，垂直撑满全部空间
    const tableWrapperBox = await page.locator('#wpd-table-wrapper').boundingBox();
    console.log('tableWrapper boundingBox:', tableWrapperBox);
    expect(tableWrapperBox).not.toBeNull();
    // 弹窗中表格区高度应充满可用垂直空间（>= 450px），且把下方大片留白完全吃满
    expect(tableWrapperBox!.height).toBeGreaterThan(450);

    // 2. 验证外层 body 绝对不发生纵向滚动（杜绝整体翻滚和顶部叠块）
    const bodyScrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.wpd-modal-body') as HTMLElement | null;
      if (!body) return { scrollable: false, scrollTop: 0 };
      const before = body.scrollTop;
      body.scrollTop = 120; // 模拟用户在弹窗背景向上滚轮
      const after = body.scrollTop;
      return {
        overflowY: getComputedStyle(body).overflowY,
        before,
        after,
      };
    });
    console.log('bodyScrollInfo:', bodyScrollInfo);
    expect(bodyScrollInfo.after, '外层 body 的 scrollTop 必须始终为 0，不得发生位移').toBe(0);

    // 3. 截图 1：深色模式下数据表格垂直充满大屏，无下方大片空白
    await page.screenshot({
      path: 'C:/Users/chmzs/.gemini/antigravity-cli/brain/3b60f102-7262-481e-b6bb-33b98fcb84a7/real_screen_grid_dark.png',
      fullPage: false,
    });

    // 4. 切换到“原始文本”Tab 并验证高度充满
    const tabBtnText = page.locator('#tab-btn-text');
    await tabBtnText.click();
    await page.waitForTimeout(400);

    const textareaBox = await page.locator('#wpd-data-textarea').boundingBox();
    console.log('textareaBox:', textareaBox);
    expect(textareaBox).not.toBeNull();
    // 文本区高度必须与表格区等大撑满（完全 1:1），彻底消灭图 2 蓝框空白
    expect(textareaBox!.height).toBeCloseTo(tableWrapperBox!.height, 1);
    expect(textareaBox!.width).toBeCloseTo(tableWrapperBox!.width, 1);

    // 5. 截图 2：深色模式下原始文本垂直撑满
    await page.screenshot({
      path: 'C:/Users/chmzs/.gemini/antigravity-cli/brain/3b60f102-7262-481e-b6bb-33b98fcb84a7/real_screen_text_dark.png',
      fullPage: false,
    });

    // 6. 切回数据表格 Tab
    const tabBtnGrid = page.locator('#tab-btn-grid');
    await tabBtnGrid.click();
    await page.waitForTimeout(300);

    // 7. 验证滚轮向上滚动弹窗时，顶部绝对不发生重叠错位
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    const topBannerBox = await page.locator('#wpd-sum-check-banner').boundingBox();
    const tabStripBox = await page.locator('.wpd-tab-strip').boundingBox();
    console.log('topBannerBox:', topBannerBox, 'tabStripBox:', tabStripBox);
    expect(topBannerBox).not.toBeNull();
    expect(tabStripBox).not.toBeNull();
    // 关键不变量：Tab 栏在上方，Banner 在下方，两者垂直绝对不重叠！
    expect(topBannerBox!.y).toBeGreaterThanOrEqual(tabStripBox!.y + tabStripBox!.height - 1);

    // 8. 切换浅色模式并截图
    await page.evaluate(() => {
      document.body.classList.add('theme-light');
    });
    await page.waitForTimeout(300);

    // 截图 3：浅色模式下数据表格高对比度
    await page.screenshot({
      path: 'C:/Users/chmzs/.gemini/antigravity-cli/brain/3b60f102-7262-481e-b6bb-33b98fcb84a7/real_screen_grid_light.png',
      fullPage: false,
    });

    // 切换到原始文本并截图
    await tabBtnText.click();
    await page.waitForTimeout(300);

    // 截图 4：浅色模式下原始文本高对比度撑满
    await page.screenshot({
      path: 'C:/Users/chmzs/.gemini/antigravity-cli/brain/3b60f102-7262-481e-b6bb-33b98fcb84a7/real_screen_text_light.png',
      fullPage: false,
    });

    console.log('All real screen visual verifications passed perfectly!');
  });
});
