/**
 * T-02：四个 Y 标定框为空时点「应用标定」必须有明确错误，不能零反应。
 *
 * ## 缺陷
 *
 * `YCalibPanel.ts:141-143` 在四个数值任一 `isNaN` 时直接 `return`：不发请求、
 * 不提示、不改后端，按钮既不 disabled 也无 loading。而四个框的 `placeholder`
 * 是字面量常量 `556 / 0 / 1320 / 1500`（`:59,63,77,81`），看起来很像"已经填好了"，
 * 于是用户点完以为标定过了 —— Y 标定是所有深度读数的唯一来源。
 *
 * ## 本文件钉住的三件事（缺一不可）
 *
 * 1. **用户可见**：必须出现一条点名"缺哪个字段"的错误。只说"参数错误"等于没说。
 * 2. **零写请求**：断言真的没发出 `core.calibrateAxes`（按 JSON-RPC body 的 method 计数，
 *    不是看 toast）。只看提示会被"提示了但照样乱写"的实现骗过。
 * 3. **后端不变**：`calibration.isCalibrated` 必须仍是 false。
 *
 * ## 为什么要读 `value` 而不是看界面
 *
 * 占位符是常量，不是用户输入；`inputValue()` 读的是 `value` 属性。若哪天有人把占位符
 * 改成 `value`（"看起来更方便"），这里会立刻变红——那会把假值静默写进标定。
 *
 * ## 负向对照为什么必要
 *
 * 最省事的"修法"是把按钮改成永远 disabled 或永远报错。第二个 describe 用正常填值路径
 * 反向锁死：填齐四个值后必须**正好发出 1 次**写请求且后端真的变成已标定。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, resetBaseline } from './helpers';

const PANEL = '.step-panel[data-step="3"]';
/** 四个数值框 + 它们对用户的中文名字（错误文案必须点名到这一个粒度）。 */
const FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['#ycal-inp-top-px', 'Y1 像素行'],
  ['#ycal-inp-top-val', 'Y1 数值'],
  ['#ycal-inp-bot-px', 'Y2 像素行'],
  ['#ycal-inp-bot-val', 'Y2 数值'],
];
/** 预期错误的稳定前缀（`YCalibPanel.ts` 的提交校验）。 */
const ERROR_PREFIX = 'Y 轴标定未提交';

interface WireCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  top_cm: number | null;
  bottom_px: number | null;
  bottom_cm: number | null;
  unit: string | null;
}

const backendCal = async (page: Page): Promise<WireCalibration> =>
  (await diagramData<{ calibration: WireCalibration }>(page)).calibration;

/**
 * 数真正发出去的 `core.calibrateAxes` 写请求（JSON-RPC over HTTP）。
 *
 * 为什么不看 toast、不看 `__straditize.getState()`：前者证明"有提示"，后者读的是前端镜像，
 * 二者都不能证明"没有写后端"。这里按 POST body 里的 method 字段判，是最贴近事实的探针。
 */
function watchCalibrateRequests(page: Page): { count: () => number } {
  let seen = 0;
  page.on('request', (req) => {
    if (!req.url().includes('/rpc')) return;
    const body = req.postData();
    if (body && body.includes('core.calibrateAxes')) seen++;
  });
  return { count: () => seen };
}

/**
 * 只写 `value`、不派发任何事件，最后点一次「应用标定」。
 *
 * 不能用 `fill()`：六个框都挂了 `change → commitCalibration`（`YCalibPanel.ts:163-165`），
 * 逐框 fill 会连发多次"只带部分新值"的提交，请求条数取决于填值顺序，`正好 1 次`
 * 这条断言会变成在测竞态而不是测行为（`step3-ycalib.spec.ts` 的 `commitYCalib`
 * 记录了实测请求序列，同一坑）。
 */
async function fillYCalib(page: Page, values: readonly string[]): Promise<void> {
  await page.evaluate((pairs: Array<[string, string]>) => {
    for (const [selector, value] of pairs) {
      const el = document.querySelector(
        `.step-panel[data-step="3"] ${selector}`
      ) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少控件 ${selector}`);
      el.value = value;
    }
  }, FIELDS.map(([selector], i) => [selector, values[i]] as [string, string]));
}

test.describe('T-02 空输入点「应用标定」必须明确报错', () => {
  // 本用例**故意**触发用户可见错误，豁免写在这里可见，不靠关掉门禁。
  test.use({ allowlists: { notice: [new RegExp(ERROR_PREFIX)] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('四个数值框全空时点「应用标定」：报错点名缺失字段、零写请求、后端仍未标定', async ({
    page,
    telemetry,
  }) => {
    await gotoStage(page, 3);
    const panel = page.locator(PANEL);

    // ---- 1. 前置事实：四个框真的是空的（placeholder 556/0/1320/1500 不算值） ----
    for (const [selector, label] of FIELDS) {
      const value = await panel.locator(selector).inputValue();
      expect(
        value,
        `${label} 框必须是空值（占位符是字面量常量，不能当作用户输入）`
      ).toBe('');
    }
    expect(
      (await backendCal(page)).isCalibrated,
      '前置：基线不该已经标定，否则"后端未变"这条断言没有判别力'
    ).toBe(false);

    // ---- 2. 点「应用标定」 ----
    const requests = watchCalibrateRequests(page);
    await panel.locator('#btn-apply-ycalib').click();

    // ---- 3. 必须出现用户可见错误，且点名缺哪个字段 ----
    await expect
      .poll(
        () => telemetry.notices.filter((text) => text.includes(ERROR_PREFIX)).length,
        {
          message: '空输入点「应用标定」必须给出用户可见的错误（不能零反应）',
          timeout: 10_000,
        }
      )
      .toBe(1);
    const notice = telemetry.notices.find((text) => text.includes(ERROR_PREFIX)) ?? '';
    for (const [, label] of FIELDS) {
      expect(
        notice,
        `错误文案必须点名缺失字段「${label}」；实际文案：${notice}`
      ).toContain(label);
    }

    // ---- 4. 不得发写请求、不得改后端 ----
    expect(requests.count(), '缺输入时不得发出 core.calibrateAxes 写请求').toBe(0);
    const after = await backendCal(page);
    expect(after.isCalibrated, '后端标定状态不得因这次点击而改变').toBe(false);
    expect(
      { top_px: after.top_px, bottom_px: after.bottom_px },
      '后端标定端点不得被占位符 556/1320 写成真值'
    ).toEqual({ top_px: null, bottom_px: null });
  });
});

test.describe('T-02 负向对照：填齐四个值必须能真的提交', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('填齐四个值后点「应用标定」：正好 1 次写请求且后端逐字段等于输入', async ({ page }) => {
    await gotoStage(page, 3);
    const panel = page.locator(PANEL);

    const button = panel.locator('#btn-apply-ycalib');
    await expect(button, '「应用标定」不得改成永远不可点').toBeEnabled();

    await fillYCalib(page, ['611', '7.5', '1198', '42.5']);
    const requests = watchCalibrateRequests(page);
    await button.click();

    await expect
      .poll(async () => (await backendCal(page)).isCalibrated, {
        message: '填齐四个值后必须真的提交成功（防止把按钮改成永远报错还过测试）',
        timeout: 15_000,
      })
      .toBe(true);
    expect(
      await backendCal(page),
      '后端标定必须逐字段等于用户输入'
    ).toMatchObject({
      isCalibrated: true,
      top_px: 611,
      top_cm: 7.5,
      bottom_px: 1198,
      bottom_cm: 42.5,
    });
    expect(
      requests.count(),
      '填齐后点一次「应用标定」必须正好发出 1 次 core.calibrateAxes（不能重复提交）'
    ).toBe(1);
  });
});
