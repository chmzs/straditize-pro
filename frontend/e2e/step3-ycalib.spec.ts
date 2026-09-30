/**
 * 步骤 3「Y 轴两点标定」的逐控件可用性排查。
 *
 * ## 排查前的真实覆盖状况（`grep` 实测，不是推测）
 *
 * | 已有用例 | 实际断言到的东西 |
 * | --- | --- |
 * | `journey.spec.ts:142` | 只数画布上**标记数量**变了，随后点下一步 |
 * | `step-visibility.spec.ts:114-130` | 画布点两下产生标记 → 图层被绘制 |
 * | `error-surfacing.spec.ts:103` | 只跑**同像素被前端拒绝**这一条守卫路径 |
 *
 * 于是最大的盲区是：**成功路径从来没有被驱动过**。没有任何用例验证过
 * 「用户填四个数 + 单位 → 点应用」之后后端的 `calibration` 真的等于用户输入。
 * 这正是"看着有覆盖、其实没断言"的典型——四个数值框、单位框、`#btn-apply-ycalib`
 * 的成功分支，在本次排查前全都是零覆盖。
 *
 * ## 顺带钉住的一条**前端自算权威值**的味道
 *
 * `RpcClient.calibrateDepthAxis`（`RpcClient.ts:386-397`）返回的
 * `top_px/top_cm/bottom_px/bottom_cm` 是拿**前端自己刚发出去的 marks** 现排序算的，
 * 并没有读后端算出的 `depth_calib`。当前两边归一规则相同（都按像素升序）所以数值一致，
 * 但这是"前端宣称权威值"的结构性隐患：后端哪天改了归一/加了 log 标度而前端没跟，
 * 界面会继续显示用户自己填的数字，看不出任何异常。
 * 下面每个用例都用 `toEqual`/`toMatchObject` 把**前端镜像与后端权威值对账**，
 * 就是在钉这一点（违反 `docs/ARCHITECTURE.md` §2 的那种改动能立刻被抓住）。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, getState, gotoStage, resetBaseline } from './helpers';

/** 后端 `straditize.getDiagramData().calibration`（线缆字段名，snake_case）。 */
interface WireCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  top_cm: number | null;
  bottom_px: number | null;
  bottom_cm: number | null;
  unit: string | null;
}

/** 前端镜像 `__straditize.getState().calibration`——只暴露三个字段（`main.ts:2289-2293`）。 */
interface MirrorCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  bottom_px: number | null;
  unit: string | null;
}

/** 后端权威标定状态——所有断言的唯一事实源。 */
const backendCal = async (page: Page): Promise<WireCalibration> =>
  (await diagramData<{ calibration: WireCalibration }>(page)).calibration;

/** 前端镜像标定状态——用来和上面的权威值对账。 */
const mirrorCal = async (page: Page): Promise<MirrorCalibration> =>
  (await getState<{ calibration: MirrorCalibration }>(page)).calibration;

interface YCalibInput {
  topPx: number;
  topVal: number;
  botPx: number;
  botVal: number;
  unit: string;
}

/**
 * 一次性写全五个值，然后只点一次「应用」。
 *
 * ## 为什么不用 `fill()`（2026-09-29 实测，不是推测）
 *
 * 原先的版本逐框 `fill`，全量 e2e 里偶发假红：本用例断言"第二次标定必须整体覆盖、
 * 不得残留旧值"，却看到 `top_cm` 停在第一次的 `7.5`。实测出两条**产品侧**事实
 * （已登记 `docs/testing-strategy.md` §9）：
 *
 * 1. `YCalibPanel.ts:143-145` 给这 5 个框都挂了 `change` → `commitCalibration`，而它
 *    只要四个数值都能解析就发请求（`:121-123`）。于是"逐个 fill"会连发多次**只带部分
 *    新值**的标定请求（实测载荷序列 `[{611,7.5},{1198,42.5}]` → `[{700,7.5},…]` →
 *    `[{700,0},…]`），终态取决于哪一发最后落库。窗口还极短：`core.calibrateAxes`
 *    往返实测只有 **3–5 ms**（`ThreadingHTTPServer`，见 `rpc_server.py:19`）。
 * 2. 每次提交成功后 `applyDepthCalibration` 都调 `inspector.updateData()`
 *    （`main.ts:1687`）→ `Inspector.render()` 把 `this.element.innerHTML` 整个换掉
 *    （`Inspector.ts:142`）→ 步骤面板重挂、五个输入框按**后端值**重建。实测后果：
 *    写进 `#ycal-inp-bot-px` 的 `1100` 在一次重挂后从 DOM 里消失（仍是 `1198`，
 *    且那一发提交根本没发出）；焦点也被摧毁（提交前 `activeElement` 是
 *    `ycal-inp-top-val`，提交后立刻变成 `<body>`）。
 *
 * 两条叠加 ⇒ "填完五个框再去点应用"天然带竞态。在产品侧缺陷修掉之前，本函数改为
 * **只写 `value`、不派发任何事件**，最后点一次只发**一次**携带全部五个值的请求，
 * 于是结论与请求顺序无关。
 *
 * 代价（有意接受）：不再覆盖"改一个框就自动落库"这条交互路径——那条路径目前**就会
 * 偶发丢值**，把它钉成断言只会得到一条稳定的红灯；那是产品缺陷，不是用例缺陷。
 *
 * 本函数只负责"发出动作"，不在这里断言——各用例自己 `poll` 到期望的后端终态，
 * 超时信息里能直接看出是哪一步没落地。
 */
async function commitYCalib(page: Page, v: YCalibInput): Promise<void> {
  const fields: Array<[string, string]> = [
    ['#ycal-inp-unit', v.unit],
    ['#ycal-inp-top-px', String(v.topPx)],
    ['#ycal-inp-bot-px', String(v.botPx)],
    ['#ycal-inp-top-val', String(v.topVal)],
    ['#ycal-inp-bot-val', String(v.botVal)],
  ];
  await page.evaluate((pairs: Array<[string, string]>) => {
    for (const [sel, value] of pairs) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少输入框 ${sel}`);
      el.value = value; // 只赋值、不派发 change ⇒ 不会触发中途提交
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  }, fields);
}

/** 轮询后端，等到 `top_px` 变成 `expected`（把"提交是否落地"和"值对不对"分开报错）。 */
const waitForTopPx = (page: Page, expected: number, message: string): Promise<void> =>
  expect
    .poll(async () => (await backendCal(page)).top_px, { message, timeout: 15_000 })
    .toBe(expected);

test.describe('步骤 3 Y 轴标定：成功路径、覆盖语义与后端防线', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('成功路径：四个数 + 单位提交后，后端 calibration 必须逐字段等于用户输入', async ({
    page,
  }) => {
    await gotoStage(page, 3);

    const before = await backendCal(page);
    // 前置反断言：基线若恰好等于本用例输入，下面的等式断言就恒真、失去判别力。
    expect(
      { top_px: before.top_px, bottom_px: before.bottom_px, unit: before.unit },
      '基线标定与本用例输入重合，会掩盖真实覆盖'
    ).not.toEqual({ top_px: 611, bottom_px: 1198, unit: 'm' });

    await commitYCalib(page, { topPx: 611, topVal: 7.5, botPx: 1198, botVal: 42.5, unit: 'm' });
    await waitForTopPx(page, 611, '后端 top_px 必须等于用户填的像素');

    expect(
      await backendCal(page),
      '后端标定必须逐字段等于用户输入（四个数值框 + 单位框是否真的接通了后端）'
    ).toMatchObject({
      isCalibrated: true,
      top_px: 611,
      top_cm: 7.5,
      bottom_px: 1198,
      bottom_cm: 42.5,
      unit: 'm',
    });

    expect(await mirrorCal(page), '前端镜像不得与后端权威值不一致').toMatchObject({
      isCalibrated: true,
      top_px: 611,
      bottom_px: 1198,
      unit: 'm',
    });

    // `#lbl-ycal-ratio` 是用户在提交前唯一能看到的数值反馈，由面板自己从标定值现算
    // （`YCalibPanel.ts:20-24`：|Δ值 / Δ像素|，四位小数）。它是步骤 3 最后一个从未被
    // 任何 e2e 触达的控件——钉住它，同时也就独立验了一遍"四个值确实进了前端镜像"
    // （`CoordinateSystem.calibrationBounds` 要求 isCalibrated + 四个字段全非空，
    // 缺一个就退回占位符 `--`，所以"不是 `--`"本身就是一条断言）。
    await expect
      .poll(async () => page.locator('#lbl-ycal-ratio').innerText(), {
        message: 'Y 标定比例预览必须显示真实计算值，而不是永久的占位符 --',
        timeout: 10_000,
      })
      .toBe('0.0596 m/px');

    // 标定结果必须被用户看见：`applyDepthCalibration` 成功后才写 HUD（`main.ts:1626-1630`）。
    await expect
      .poll(async () => page.locator('#hud-text').innerText(), {
        message: '标定成功必须给用户可见反馈，不能只在 console 里发生',
        timeout: 10_000,
      })
      .toContain('已标定');
  });

  test('重新取点：清画布标记但不改后端；再次提交必须整体覆盖、不得残留旧值', async ({
    page,
  }) => {
    await gotoStage(page, 3);

    await commitYCalib(page, { topPx: 611, topVal: 7.5, botPx: 1198, botVal: 42.5, unit: 'm' });
    await waitForTopPx(page, 611, '第一次标定应落地');
    expect(
      (await getState<{ yCalibMarks: unknown[] }>(page)).yCalibMarks.length,
      '提交成功后画布上应留下两个 Y 标记'
    ).toBe(2);

    // 「重新图上选点」＝切换拾取模式：清掉画布标记，但**不动**后端已提交的标定。
    await page.locator('#btn-repick-ycalib').click();
    await expect
      .poll(async () => (await getState<{ yCalibMarks: unknown[] }>(page)).yCalibMarks.length, {
        message: '重新取点必须清掉画布上的旧标记，否则新旧参考点会混在一起',
        timeout: 10_000,
      })
      .toBe(0);
    expect(
      await backendCal(page),
      '重新取点只是进入拾取模式，不该抹掉已提交的标定（用户可能中途放弃重取）'
    ).toMatchObject({
      top_px: 611,
      top_cm: 7.5,
      bottom_px: 1198,
      bottom_cm: 42.5,
      unit: 'm',
    });

    // 第二次提交：五个字段全部换掉，任何"合并/残留旧值"的实现都会被这里抓住。
    await commitYCalib(page, { topPx: 700, topVal: 0, botPx: 1100, botVal: 50, unit: 'ka' });
    await waitForTopPx(page, 700, '第二次标定必须覆盖第一次');

    expect(
      await backendCal(page),
      '第二次标定必须整体覆盖，不得残留第一次的任何字段'
    ).toMatchObject({
      top_px: 700,
      top_cm: 0,
      bottom_px: 1100,
      bottom_cm: 50,
      unit: 'ka',
    });
    expect(await mirrorCal(page), '前端镜像也必须整体换成第二次的值').toMatchObject({
      top_px: 700,
      bottom_px: 1100,
      unit: 'ka',
    });
  });

  test('倒序输入（先填深层、后填浅层）也必须归一成同一标定', async ({ page }) => {
    await gotoStage(page, 3);

    // 用户的真实场景：有人按"上→下"点，有人按"下→上"点。后端契约明说两个方向都接受
    // （`session.py:1214-1215`：「values may increase or decrease downcore」）。
    await commitYCalib(page, { topPx: 1198, topVal: 42.5, botPx: 611, botVal: 7.5, unit: 'm' });
    await waitForTopPx(page, 611, '像素更小的那个点必须被归一成 top');

    expect(
      await backendCal(page),
      '后端必须按像素排序归一，而不是照抄用户填在"上"框里的那个值'
    ).toMatchObject({
      top_px: 611,
      top_cm: 7.5,
      bottom_px: 1198,
      bottom_cm: 42.5,
      unit: 'm',
    });
    expect(
      await mirrorCal(page),
      '前端归一规则必须与后端一致，否则界面显示的上下界会与后端反过来'
    ).toMatchObject({ top_px: 611, bottom_px: 1198, unit: 'm' });
  });
});

/**
 * 本例**故意**让后端拒绝一次，所以必须显式声明豁免——否则 `fixtures.ts` 的 telemetry
 * 会按"UI 把后端失败静默吞掉"的规则把它判红（那正是它平时该干的事，不能为了
 * 让本用例通过就放宽全局）。
 */
test.describe('步骤 3 后端防线：故意触发一次后端拒绝', () => {
  test.use({ allowlists: { rpcError: [/core\.calibrateAxes \[-32602\]/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('后端自带的同像素防线：绕过面板直调也必须被拒，且不得污染已提交的标定', async ({
    page,
  }) => {
    await gotoStage(page, 3);

    await commitYCalib(page, { topPx: 611, topVal: 7.5, botPx: 1198, botVal: 42.5, unit: 'm' });
    await waitForTopPx(page, 611, '先把一个合法标定提交上去');
    const snapshot = await backendCal(page);

    // 面板的前端守卫（`YCalibPanel.ts:124-127`）让"两个像素相同"在 UI 上点不出来；
    // 但后端 `session.calibrate_axes` 自己也有 `np.all(y_pixels == y_pixels[0])` 检查
    // （`session.py:1233-1236`）。脚本调用 / 批量接口 / 未来的其它客户端绕过面板时，
    // 靠的就是它。这里直接发 RPC，验证第二道防线真的在，且失败不留痕。
    const message = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          __straditize?: {
            rpc: (m: string, p?: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).__straditize;
      try {
        await api!.rpc('core.calibrateAxes', {
          y_marks: [
            { pixel: 900, val: 1 },
            { pixel: 900, val: 2 },
          ],
          unit: 'cm',
        });
        return null;
      } catch (err) {
        return String((err as Error)?.message ?? err);
      }
    });

    expect(
      message,
      '两个像素相同的标定点必须被后端拒绝（前端守卫之外的第二道防线）'
    ).toContain('identical');
    expect(await backendCal(page), '被拒的标定不得改动已提交的状态').toEqual(snapshot);
  });
});
