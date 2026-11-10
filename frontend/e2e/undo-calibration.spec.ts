/**
 * T-04（高）：撤销之后，步骤 3 面板**否定**了后端已确认的 Y 标定。
 *
 * ## 缺陷现象（已由 Triage 复现，证据 `.scratch/triage/F-04/`）
 *
 * ```
 * 拖 ROI（历史栈里因此压了一条"标定之前"的快照）
 *   → 步骤 3 完成两点标定（后端 isCalibrated=true / 556 / 1320）
 *   → 点顶栏「撤销」
 *   → 面板「尚未完成 Y 轴标定」、Ratio `--`、深度 `--`
 *     同刻后端 straditize.getDiagramData().calibration 仍是 true / 556 / 1320
 * ```
 *
 * 机制：撤销把 `HistorySnapshot.calibration` 写回前端镜像
 * （`CleanupManager.applyHistorySnapshot` → `data.calibration`），
 * 而 `CoordinateSystem.calibrationBounds` 见到 `isCalibrated=false` 就返回 null，
 * 于是面板 / Ratio / 深度换算一起判"未标定"。**后端从未收到任何清除请求。**
 *
 * ## 为什么这条断言必须"先断后端、再断面板"
 *
 * 先断后端是防止顺序短路：面板断言（`not.toContainText` 之类）如果写在前面，
 * 一旦失败就再也看不到"后端其实没变"这条关键事实，失败信息会退化成
 * "面板文案不对"，把"界面否定后端真值"降级成"文案 bug"。
 *
 * ## 判据的判别力（负向对照在这里）
 *
 * 第二条用例守的是"不许用永远显示已标定来通过"：干净会话里（后端本来未标定）
 * 撤销之后，面板**必须**如实显示"未标定"、`Ratio` **必须**是 `--`。
 * 同时它还断言撤销真的把 ROI 退回原值——否则"撤销按钮失效"会让这条对照恒真。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, getState, gotoStage, resetBaseline } from './helpers';

/** 后端 `straditize.getDiagramData().calibration`（线缆字段名）。 */
interface WireCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  top_cm: number | null;
  bottom_px: number | null;
  bottom_cm: number | null;
  unit: string | null;
  primaryAxis?: 'depth' | 'age';
}

/** `window.__straditize.getState()` 里本文件用到的部分（`WebMcpBridge.ts:110-167`）。 */
interface FrontState {
  stage: number;
  image: { src: string | null; width: number; height: number };
  /** `screen = world * scale + pan`（画布局部坐标）。 */
  viewport: { scale: number; panX: number; panY: number };
  rois: Array<{ id: string; xlim: number[]; ylim: number[] }>;
  legacyRoi: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null };
  calibration: {
    isCalibrated: boolean;
    top_px: number | null;
    bottom_px: number | null;
    unit: string | null;
  };
  yCalibMarks: Array<{ x: number; y: number }>;
}

/** 后端权威标定状态——所有标定断言的唯一事实源。 */
const backendCal = async (page: Page): Promise<WireCalibration> =>
  (await diagramData<{ calibration: WireCalibration }>(page)).calibration;

/** 后端某一个 ROI 的 `ylim`（`undefined` 表示后端根本没有这个 ROI）。 */
async function backendYlim(page: Page, id: string): Promise<number[] | undefined> {
  const data = await diagramData<{ rois: Array<{ id: string; ylim?: number[] }> }>(page);
  return data.rois.find((r) => r.id === id)?.ylim;
}

const front = (page: Page): Promise<FrontState> => getState<FrontState>(page);

/** 世界坐标 → 页面坐标（`viewport` 是唯一真值源，不重算 fitToScreen）。 */
async function toPage(page: Page, worldX: number, worldY: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([wx, wy]) => {
    const api = (
      window as unknown as {
        __straditize?: {
          getState: () => { viewport: { scale: number; panX: number; panY: number } };
        };
      }
    ).__straditize;
    if (!api) throw new Error('window.__straditize 不可用');
    const { scale, panX, panY } = api.getState().viewport;
    const wrap = document.querySelector('.canvas-wrapper') as HTMLElement | null;
    if (!wrap) throw new Error('.canvas-wrapper 不存在（GeologyCanvas 的容器）');
    const rect = wrap.getBoundingClientRect();
    return { x: rect.left + wx * scale + panX, y: rect.top + wy * scale + panY };
  }, [worldX, worldY] as const);
}

/**
 * 拖 ROI 的右下角手柄到 `(wx, wy)` 世界坐标。
 *
 * 为什么必须先按 `F`：`resetBaseline` 里按过一次，但本文件随后会在步骤间来回走，
 * 不重新 fit 就无法用 `viewport` 反算屏幕坐标来命中小于 2px 的手柄。
 * `screen = world * scale + pan`（`WebMcpBridge.ts:114`）是唯一真值源，比复算
 * `fitToScreen` 公式（`padding=60` / 上限 1.5）少一层误差。
 */
async function dragRoiCornerTo(page: Page, wx: number, wy: number): Promise<void> {
  await page.keyboard.press('f');
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

  const st = await front(page);
  const corner = st.legacyRoi;
  if (corner.xMax === null || corner.yMax === null) {
    throw new Error(`前端 legacyRoi 缺少右下角坐标：${JSON.stringify(corner)}`);
  }
  const from = await toPage(page, corner.xMax, corner.yMax);
  const to = await toPage(page, wx, wy);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 多步移动：与真人拖拽一致，也让"中途被别的层抢走"这类缺陷更早暴露。
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

/**
 * 一次性写全五个标定框，然后只点一次「应用」。
 *
 * 照抄 `step3-ycalib.spec.ts:97-115` 的写法（那里有完整理由）：逐框 `fill` 会连发
 * 多次只带部分新值的标定请求，终态取决于哪一发最后落库；这里只写 `value`、
 * 不派发任何事件，最后点一次只发一次请求，结论与请求顺序无关。
 */
async function commitYCalib(
  page: Page,
  v: { topPx: number; topVal: number; botPx: number; botVal: number; unit: string }
): Promise<void> {
  await page.evaluate((vals: Array<[string, string]>) => {
    for (const [sel, value] of vals) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少控件 ${sel}`);
      el.value = value;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  }, [
    ['#ycal-inp-unit', v.unit],
    ['#ycal-inp-top-px', String(v.topPx)],
    ['#ycal-inp-bot-px', String(v.botPx)],
    ['#ycal-inp-top-val', String(v.topVal)],
    ['#ycal-inp-bot-val', String(v.botVal)],
  ] as Array<[string, string]>);
}

/** 由后端四个端点算出的 Ratio 文案（`YCalibPanel.ts:25-29` 的同一口径）。 */
function expectedRatio(cal: WireCalibration): string {
  const { top_px, bottom_px, top_cm, bottom_cm } = cal;
  if (top_px === null || bottom_px === null || top_cm === null || bottom_cm === null) {
    throw new Error(`后端标定端点不全，无法计算 Ratio：${JSON.stringify(cal)}`);
  }
  const ratio = Math.abs((bottom_cm - top_cm) / (bottom_px - top_px));
  return `${ratio.toFixed(4)} ${cal.unit ?? 'cm'}/px`;
}

test.describe('T-04 撤销不得否定后端已确认的 Y 标定', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('拖过 ROI → 完成标定 → 撤销：后端标定逐值不变，面板仍须认定已标定', async ({ page }) => {
    // ── 基线：hoya 已预载，且**未标定**（本用例的"标定前快照"由此产生）
    const baseline = await backendCal(page);
    expect(baseline.isCalibrated, '基线必须未标定，否则本用例造不出"标定前"的快照').toBe(false);
    const roiId = (await front(page)).rois[0]?.id;
    if (!roiId) throw new Error('基线没有 ROI');
    const ylimBefore = await backendYlim(page, roiId);
    if (!ylimBefore) throw new Error(`后端 ROI '${roiId}' 没有 ylim`);

    // ── 步骤 1/2：拖一下 ROI 下边界，历史栈因此压入一条"标定之前"的快照
    await gotoStage(page, 2);
    await dragRoiCornerTo(page, (await front(page)).legacyRoi.xMax! - 40, ylimBefore[1] - 80);
    await expect
      .poll(async () => (await backendYlim(page, roiId))?.[1], {
        message: '拖拽必须真的落到后端（否则历史栈不会产生"标定前"的快照）',
        timeout: 15_000,
      })
      .not.toBe(ylimBefore[1]);
    const ylimAfterDrag = await backendYlim(page, roiId);

    // ── 步骤 3：两点标定并等后端确认
    await gotoStage(page, 3);
    await commitYCalib(page, { topPx: 556, topVal: 0, botPx: 1320, botVal: 1500, unit: 'cm' });
    await expect
      .poll(async () => (await backendCal(page)).isCalibrated, {
        message: '提交后后端必须确认标定（否则后面的撤销断言没有对象）',
        timeout: 15_000,
      })
      .toBe(true);

    const calibrated = await backendCal(page);
    expect(calibrated, '后端标定必须等于用户输入').toMatchObject({
      isCalibrated: true,
      top_px: 556,
      top_cm: 0,
      bottom_px: 1320,
      bottom_cm: 1500,
      unit: 'cm',
    });
    expect((await front(page)).yCalibMarks.length, '标定成功后画布上应留下两个 Y 标记').toBe(2);

    // ── 撤销：先确认按钮真的可用（点一个 disabled 的按钮什么都不会发生）
    const undo = page.locator('#btn-undo');
    await expect(undo, '历史栈里既有 ROI 拖拽又有标定，撤销按钮必须可用').toBeEnabled();
    await undo.click();

    // 等前端动作**真正落地**，不靠固定 sleep：
    // `applyHistorySnapshot` 在同一处调 `clearYCalibMarks()`（`CleanupManager.ts:184`），
    // 所以"画布上的两个 Y 标记被清掉"就是这次撤销已执行的机械证据。
    await expect
      .poll(async () => (await front(page)).yCalibMarks.length, {
        message: '撤销必须真的执行（画布上的 Y 标记应被清除）',
        timeout: 15_000,
      })
      .toBe(0);
    expect(await backendYlim(page, roiId), '撤销不得改动后端 ROI 的 ylim（快照里的 roi 与后端一致）').toEqual(
      ylimAfterDrag
    );

    // ── 断言①：后端标定逐值不变（先断后端，避免顺序短路）
    expect(
      await backendCal(page),
      '撤销不得改写后端标定——前端没有任何"清除标定"的 RPC，后端不变量必须原样成立'
    ).toEqual(calibrated);

    // ── 断言②：面板不得否定后端真值
    const panel = page.locator('.step-panel[data-step="3"]');
    await expect(
      panel,
      '后端 isCalibrated=true 时，步骤 3 面板不得显示「尚未完成 Y 轴标定」'
    ).not.toContainText('尚未完成 Y 轴标定');
    await expect(panel, '面板必须显示标定生效中').toContainText('Y 轴标定生效中');

    // ── 断言③：Ratio 必须是后端四端点算出的真实比例，不是占位符 `--`
    await expect(
      page.locator('#lbl-ycal-ratio'),
      'Ratio 必须等于后端标定算出的比例（`--` 即意味着前端否定了后端）'
    ).toHaveText(expectedRatio(calibrated));

    // ── 断言④：深度换算非 `--`（悬停探测读的是同一个 `calibrationBounds`）
    //
    // 判据为什么是"两点差 + 单点误差"而不是"单点 > 期望-1"（首版写法，实测红）：
    // 悬停探针落在**整像素行**上（`mouse.move` 的浮点坐标被浏览器量化，探针自己也会
    // 取整），而这里 1 px ≈ 1.96 cm；首版容差 `expectedDepth - 1` 只有 1 cm < 1 px，
    // 于是 2 px 的量化差就把一条正确的深度读数判红（实测 745.93 vs 749）。
    // 换成两条与参数无关的判据：
    //   ① 两行之差必须等于线性模型之差（"永远是同一个常数"会被这一条杀掉）；
    //   ② 每行读数与模型之差不超过 2 px 的量化上限。
    const pxToCm = Math.abs(
      (calibrated.bottom_cm! - calibrated.top_cm!) / (calibrated.bottom_px! - calibrated.top_px!)
    );
    const quantTol = 2 * pxToCm;
    const roi0 = (await front(page)).legacyRoi;
    const midWorldX = ((roi0.xMin ?? 0) + (roi0.xMax ?? 0)) / 2;
    const modelDepth = (worldY: number): number =>
      calibrated.top_cm! +
      ((worldY - calibrated.top_px!) / (calibrated.bottom_px! - calibrated.top_px!)) *
        (calibrated.bottom_cm! - calibrated.top_cm!);

    const depthAt = async (worldY: number): Promise<number> => {
      const at = await toPage(page, midWorldX, worldY);
      await page.mouse.move(at.x, at.y);
      let seen = NaN;
      await expect
        .poll(
          async () => {
            const text = await page.locator('#footer-depth').innerText();
            const parsed = Number.parseFloat(text.replace(/[^\d.\-]/g, ''));
            seen = Number.isFinite(parsed) ? parsed : NaN;
            return Number.isFinite(seen);
          },
          {
            message: `悬停到 y=${Math.round(worldY)} 时页脚深度必须换成真实数值（期望 ≈ ${modelDepth(
              worldY
            ).toFixed(2)} cm），而不是 --`,
            timeout: 10_000,
          }
        )
        .toBe(true);
      return seen;
    };

    const yLow = calibrated.top_px! + 0.25 * (calibrated.bottom_px! - calibrated.top_px!);
    const yHigh = calibrated.top_px! + 0.75 * (calibrated.bottom_px! - calibrated.top_px!);
    // 先走到远端再回近端：同一坐标重复 hover 不一定重新触发探测。
    const depthHigh = await depthAt(yHigh);
    const depthLow = await depthAt(yLow);

    expect(
      Math.abs(depthHigh - depthLow - (modelDepth(yHigh) - modelDepth(yLow))),
      `两点深度差必须与线性模型一致（模型差 ${(modelDepth(yHigh) - modelDepth(yLow)).toFixed(2)} cm，` +
        `实测差 ${(depthHigh - depthLow).toFixed(2)} cm）——常量读数会在这里红`
    ).toBeLessThanOrEqual(quantTol);
    expect(
      Math.abs(depthLow - modelDepth(yLow)),
      `低点深度必须落在模型 ±${quantTol.toFixed(2)} cm（2 px 量化）内`
    ).toBeLessThanOrEqual(quantTol);
    expect(
      Math.abs(depthHigh - modelDepth(yHigh)),
      `高点深度必须落在模型 ±${quantTol.toFixed(2)} cm（2 px 量化）内`
    ).toBeLessThanOrEqual(quantTol);
    expect(
      await page.locator('#footer-depth').innerText(),
      '深度换算必须带单位，且不得是占位符 --'
    ).toContain('cm');
  });

  /**
   * 负向对照：干净会话（后端本来未标定）里撤销，面板必须**仍然**如实说未标定。
   *
   * 这条守的是"把修复写成永远显示已标定"。
   * 同时它断言撤销真的把 ROI 退回了拖拽前的边界——否则"撤销按钮失效 / 空操作"
   * 会让本用例恒真（假对照）。
   */
  test('负向对照：未标定的会话里撤销，面板仍须如实显示未标定', async ({ page }) => {
    const roiId = (await front(page)).rois[0]?.id;
    if (!roiId) throw new Error('基线没有 ROI');
    const ylimBefore = await backendYlim(page, roiId);
    if (!ylimBefore) throw new Error(`后端 ROI '${roiId}' 没有 ylim`);
    expect((await backendCal(page)).isCalibrated, '干净会话必须未标定').toBe(false);

    await gotoStage(page, 2);
    const corner = (await front(page)).legacyRoi;
    await dragRoiCornerTo(page, corner.xMax! - 40, ylimBefore[1] - 80);
    await expect
      .poll(async () => (await backendYlim(page, roiId))?.[1], {
        message: '拖拽必须真的落到后端（否则撤销无事可撤）',
        timeout: 15_000,
      })
      .not.toBe(ylimBefore[1]);

    await expect(page.locator('#btn-undo')).toBeEnabled();
    const marksBefore = (await front(page)).yCalibMarks.length;
    await page.locator('#btn-undo').click();

    // 撤销落地的机械证据：ROI 退回拖拽前的边界（后端），且没有 Y 标记残留。
    await expect
      .poll(async () => (await backendYlim(page, roiId))?.[1], {
        message: '撤销必须把 ROI 退回拖拽前的边界（否则本对照是假对照）',
        timeout: 15_000,
      })
      .toBe(ylimBefore[1]);
    expect(marksBefore, '未标定的会话本来就不该有 Y 标记').toBe(0);

    // 后端仍未被标定——这条是下面面板断言的前提
    expect(
      await backendCal(page),
      '没有标定动作就不该出现标定，后端必须仍未标定'
    ).toMatchObject({ isCalibrated: false });

    // 面板断言的对象必须先**存在**：撤销发生在步骤 2，此时 DOM 里只有
    // `.step-panel[data-step="2"]`。首轮红日志（`.scratch/fix/T-04-red.log:244`）
    // 报的是 `element(s) not found` —— 那是"断言查错了对象"，不是产品行为，
    // 与另一条用例的失败形态完全不同。先跳回步骤 3 再读面板。
    await gotoStage(page, 3);

    // 面板断言必须在**步骤 3** 里做：`.step-panel[data-step="3"]` 只在当前步骤
    // 为 3 时才挂载（Inspector 按 `workflowController` 的当前阶段渲染），
    // 停在步骤 2 时它根本不存在——第一条红日志里那句 `element(s) not found`
    // 是漏了这一步，而不是产品缺陷。
    await gotoStage(page, 3);

    const panel = page.locator('.step-panel[data-step="3"]');
    await expect(panel, '未标定就必须如实显示未标定').toContainText('尚未完成 Y 轴标定');
    await expect(
      page.locator('#lbl-ycal-ratio'),
      '未标定时 Ratio 必须是占位符 --（防止把修复写成"永远显示已标定"）'
    ).toHaveText('--');
  });
});
