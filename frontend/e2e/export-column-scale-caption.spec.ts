/**
 * 导出面板的行集 caption：两种「未标定」必须各自指向**正确的步骤**。
 *
 * ## 缺陷（实测，非推测）
 *
 * Y 轴已标定、但 28 个属种列一列都没标定 X 刻度（缺步骤 6）时，后端原来照样返回
 * 「表头 + 76 行 depth + 28 列全空」的 CSV。面板把它渲染成
 * 「来源（N 行）· 预览、复制与 CSV 下载都按此行集导出」——一份**看起来有数据**的空表，
 * 用户完全不知道卡在步骤 6。
 *
 * 修法分两层：
 *   1. 后端：全列未标定 ⇒ 抛 `CALIBRATION_ERROR`（-32003），文案指明**列刻度 / 步骤 6**；
 *      只要有一列标定过就照常导出（未标定列整列 NA）；
 *   2. 前端：caption 必须区分两种 -32003（缺深度标定 → 步骤 3；缺列刻度 → 步骤 6），
 *      判据是后端 `data.reason`（经 `RpcClient` 冒泡），不按模糊的 `includes('标定')`。
 *
 * ## 判据为什么这么写
 *
 * 两条用例各测一个方向，且**互为反证**：只断言"有 caption"不足以区分两种错误，
 * 必须断言文案里的**步骤号**，并且断言它**没有**指向另一个步骤——否则把两句话
 * 互换、或者永远写"步骤 3"，两条用例里至少有一条会红。
 */
import { expect, test } from './fixtures';
import { backendRpc, readColumnScale, resetBaseline, waitForDiagram } from './helpers';

/** 面板当前的行集 caption 文本。 */
async function captionText(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('#wpd-rowset-caption').innerText()).trim();
}

test.describe('caption：缺深度标定 → 步骤 3', () => {
  // 未标定场景**故意**触发 -32003：面板会把它写成 caption 与 toast。
  test.use({
    allowlists: {
      consoleError: [/导出需要深度标定/],
      rpcError: [/导出需要深度标定/],
      notice: [/读取 .* 数据集失败/],
    },
  });

  test('Y 未标定时 caption 指向步骤 3，且不得把人引去步骤 6', async ({ page }) => {
    await resetBaseline(page);

    await page.locator('#btn-export-csv').click();
    const caption = page.locator('#wpd-rowset-caption');
    await expect(caption).toBeVisible({ timeout: 20_000 });

    await expect(caption, '缺深度标定时必须指向步骤 3').toHaveText(/步骤 3/);
    await expect(caption, '深度问题不得被写成列刻度问题').not.toHaveText(/步骤 6/);
  });
});

test.describe('caption：缺列刻度 → 步骤 6', () => {
  // 本场景的后端拒绝是**被测行为**：`export.csv` 的 -32003 必须被写成 caption。
  test.use({
    allowlists: {
      consoleError: [/导出需要列刻度/],
      rpcError: [/导出需要列刻度/],
      notice: [/读取 .* 数据集失败/],
    },
  });

  test('Y 已标定但全列未标定时，caption 指向步骤 6，且不得把人引去步骤 3', async ({
    page,
  }) => {
    await resetBaseline(page);

    // 只做步骤 3（Y 两点标定），**故意不做**步骤 6。
    await backendRpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 200, val: 0 },
        { pixel: 600, val: 40 },
      ],
      unit: 'cm',
    });
    await page.reload();
    await waitForDiagram(page);

    // 前置：Y 已标定、列未标定。这两条不成立就不是本用例要测的状态。
    const diagram = await backendRpc<{ calibration: { isCalibrated: boolean } }>(
      page,
      'straditize.getDiagramData'
    );
    expect(diagram.calibration.isCalibrated, '前置：Y 轴必须已标定').toBe(true);
    const col0 = await readColumnScale(page, 0);
    expect(col0.calibrated, '前置：列必须仍未标定 X 刻度').toBe(false);

    // 后端契约：这条路径必须明确拒绝，而不是给一张整表空白的 CSV。
    const body = await page.request
      .post('/rpc', {
        data: { jsonrpc: '2.0', id: 1, method: 'export.csv', params: { dataset: 'depth_grid' } },
      })
      .then((res) => res.json() as Promise<{ error?: { code: number; message: string } }>);
    expect(body.error?.code, '全列未标定时后端必须拒绝导出').toBe(-32003);
    expect(body.error?.message ?? '', '拒绝文案必须指明是列刻度 / 步骤 6').toContain('步骤 6');

    await page.locator('#btn-export-csv').click();
    const caption = page.locator('#wpd-rowset-caption');
    await expect(caption).toBeVisible({ timeout: 20_000 });

    await expect(caption, '缺列刻度时必须指向步骤 6').toHaveText(/步骤 6/);
    await expect(caption, '文案必须点明是列刻度的问题').toHaveText(/列刻度/);
    await expect(caption, '列刻度问题不得被写成步骤 3 的深度标定').not.toHaveText(/步骤 3/);
    expect(await captionText(page)).not.toMatch(/按此行集导出/);
  });
});
