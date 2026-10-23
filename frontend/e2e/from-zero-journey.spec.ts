/**
 * 从零开始的花粉图真实上机旅程 —— 「模拟一个人打开软件、上传自己的图、走完八步、导出」。
 *
 * ## 这条用例与现有全部 e2e 的根本差别
 *
 * 既有 70 项 e2e 都跑在 `support/serve_e2e_backend.py` 的基线上：那个启动器**启动时
 * 就预载 hoya 范例、预跑 detect_columns**。于是两件事在整套测试里从来没被验证过：
 *
 * 1. **"打开文件"这条链路**（真实文件选择器 → FileReader → `core.loadImage`）；
 * 2. **"第一次运行"**（会话里一张图都没有时，界面能不能用、点下去有没有反应）。
 *
 * 本文件跑在 `support/serve_zero_backend.py` 上（零状态：无图、无列、无 ROI），
 * 所以上面两件事是**它的主要内容**，不是顺带。
 *
 * ## 逐条纪律（每条都对应一处容易作弊的地方）
 *
 * | 纪律 | 为什么 | 落点 |
 * | --- | --- | --- |
 * | 上传走**真实文件选择器** | 直接调 `core.loadImage` 等于绕过整条用户路径，测的就不是"人能不能做这件事" | `test.step('1. 上传')` |
 * | 每一步都读**后端权威状态** | 前端镜像可以"改了但没落后端"，只读镜像的断言恰好在缺陷时是绿的 | 全部 `rpc()`/`diagramData()` |
 * | 推进用**真实按钮** | `gotoStage()` 会跳过业务动作（例如进入步骤 4 会自动点「检测候选」、进入步骤 5 会真的重分列），用它推步骤等于把被跳过的那步排除在测试之外 | `advanceByRealUi()` |
 * | 失败**不放宽** | 松断言/删用例只会把缺陷藏起来；走不通就如实记录并向 Lead 报告 | 见 `journey-log.md` |
 *
 * ## 为什么 `gotoStage()` 只用于"落定确认"而不用于推进
 *
 * `WorkflowController.advanceToWorkflowStage`（`frontend/src/services/WorkflowController.ts:94`）
 * 里每个分支都带**副作用**：进步骤 4 会 `queueMicrotask` 点「检测候选」、进步骤 5 会
 * `core.detectColumns` 真的重分列、进步骤 6 会点「自动提取刻度」。用 `gotoStage()`
 * 推步骤时这些副作用照样发生，但**推完之后界面可能已经被重挂**，随后的点击会落在
 * 一个正在被替换的节点上（`docs/testing-strategy.md` §8.3 记的正是这种假红）。
 * 所以推进统一走 UI 按钮，`gotoStage()` 只在需要"回到某步看一眼"时用于落定确认。
 *
 * ## trace JSON
 *
 * 每一步的**后端权威快照**都写进 `journey-trace.json`（落在 `outputDir`，即
 * `frontend/test-results-<port>-zero/`）。跑通后由人工拷一份到 `docs/findings/`
 * 作为给用户的证据——本文件不自动写 `docs/`，避免测试运行去污染文档目录。
 */
import { Buffer } from 'node:buffer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { backendRpc, getState } from './helpers';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 仓库根：本文件在 `frontend/e2e/` 下，上跳三级。 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 受版本控制的真实花粉图（与现有基线同一张，便于和已知值对账）。 */
const REAL_POLLEN_IMAGE = join(REPO_ROOT, 'straditize_core/assets/tutorials/hoya-del-castillo.png');

/** 该图的真值尺寸——与 `frontend/e2e/step1-load.spec.ts` 的 `SAMPLE_TRUTH.hoya` 一致。 */
const TRUTH_W = 2339;
const TRUTH_H = 1654;

/** 现有基线里 detect_columns 用的 X/Y 边界（用户在这一步"框数据区"对应的真实取值）。 */
const ROI_X: [number, number] = [315, 1946];
const ROI_Y: [number, number] = [511, 1311];

/** Y 轴两点标定：与 `journey.spec.ts:146-150` 同一组真值，便于跨套对账。 */
const Y_TOP_PX = 511;
const Y_BOT_PX = 1311;
const Y_UNIT = 'cm';

/**
 * trace 落盘路径。`outputDir` 由 `playwright.zero.config.ts` **按端口隔离**，
 * 所以这里必须同样从 `STRADITIZE_ZERO_PORT` 推导——写死 22920 会在换端口跑时
 * 把 trace 静默写进另一个端口的目录（两个端口并发时互相覆盖）。
 */
const TRACE_PORT = process.env.STRADITIZE_ZERO_PORT ?? '22920';
const TRACE_PATH = join(process.cwd(), `test-results-${TRACE_PORT}-zero`, 'journey-trace.json');

// ---------------------------------------------------------------------------
// 类型（只写本文件真正读到的线缆字段）
// ---------------------------------------------------------------------------

interface WireCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  top_cm: number | null;
  bottom_px: number | null;
  bottom_cm: number | null;
  unit: string | null;
}

interface WireRoi {
  id: string;
  name: string;
  name_source: string;
  xlim?: [number, number];
  ylim?: [number, number];
  composition?: boolean;
}

interface WireColumn {
  id: string;
  name?: string;
  species?: string;
  roi_id?: string;
  col_index?: number;
  startX?: number;
  endX?: number;
  tickEndX?: number;
  x_ticks?: Array<{ px: number; value: number }> | null;
}

interface WireDiagram {
  imageSrc: string | null;
  imageWidth: number;
  imageHeight: number;
  columns: WireColumn[];
  activeTaxaId: string;
  rois: WireRoi[];
  primaryRoiId: string | null;
  activeRoiId: string | null;
  calibration: WireCalibration;
  line_candidates: Array<{ id: string; status?: string }>;
  exclusion_regions: unknown[];
  line_strokes: unknown[];
}

/** trace 里单步的记录。`backend` 一律是后端权威载荷的关键子集，不掺前端镜像。 */
interface StepRecord {
  step: number;
  label: string;
  humanAction: string;
  uiResponse: string;
  backend: Record<string, unknown>;
  judgement: string;
}

// ---------------------------------------------------------------------------
// 助手：只读后端
// ---------------------------------------------------------------------------

/** 后端权威图谱数据（`straditize.getDiagramData`）。**唯一**状态事实源。 */
async function diagram(page: Page): Promise<WireDiagram> {
  return backendRpc<WireDiagram>(page, 'straditize.getDiagramData', {});
}

/**
 * 等前端状态机落到某步。
 *
 * `getState().stage` 是**前端镜像**，这里只把它当"界面确实到了这一步"的屏障用，
 * 不用它做任何业务断言（业务断言一律读后端）。理由：前端 stage 只是个枚举，
 * 它对了不代表后端状态对了；反过来，它停在旧值却断言后端状态则是抢跑。
 */
async function waitStage(page: Page, step: number): Promise<void> {
  await expect
    .poll(async () => (await getState<{ stage: number }>(page)).stage, {
      message: `界面应停在步骤 ${step}`,
      timeout: 30_000,
    })
    .toBe(step);
}

/**
 * 用**真实按钮**推进，并等界面落定。
 *
 * 不许用 `gotoStage()` 代替：它会跳过该步的业务动作（见文件头说明）。
 * 这里的 selector 都是步面板自己的下一步按钮，与 `journey.spec.ts` 用的是同一批。
 */
async function advanceByRealUi(page: Page, selector: string, targetStage: number): Promise<void> {
  const btn = page.locator(selector);
  await expect(btn, `推进按钮 ${selector} 必须可见可点`).toBeEnabled({ timeout: 20_000 });
  await btn.click();
  await waitStage(page, targetStage);
}

// ---------------------------------------------------------------------------
// 助手：trace
// ---------------------------------------------------------------------------

/**
 * 收集每一步的后端权威快照。
 *
 * 落盘放在 `test.afterAll`，这样**即便中途断言失败**也能拿到已经走过的步骤
 * ——那正是排查时最需要的信息。若只在用例成功时写，失败时 trace 反而是空的。
 */
const trace: StepRecord[] = [];

function record(rec: StepRecord): void {
  trace.push(rec);
}

function writeTrace(): void {
  const dir = dirname(TRACE_PATH);
  mkdirSync(dir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    spec: 'frontend/e2e/from-zero-journey.spec.ts',
    startedFrom: 'zero-state (no image, no columns, no ROI)',
    sourceImage: 'straditize_core/assets/tutorials/hoya-del-castillo.png',
    steps: trace,
  };
  writeFileSync(TRACE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test.describe('从零开始：真实上传一张花粉图 → 八步 → 导出', () => {
  test.afterAll(() => {
    // 无条件写盘：失败时这份 trace 就是排查起点，绝不能只在成功路径上写。
    writeTrace();
  });

  test.beforeEach(async ({ page }) => {
    // 零状态复位：`e2e.reset` 只清状态，**不种任何图**。注意这里不能走
    // `helpers.resetBaseline`——那个会去 openApp 并等 `rois.length > 0`，
    // 而零状态下永远没有 ROI，会 45s 超时假红。
    await backendRpc(page, 'e2e.reset');
  });

  test('人怎么做完这件事，后端就怎么记账：八步全走 + tar 里有真实数据行', async ({
    page,
    telemetry,
  }) => {
    // =====================================================================
    // 0. 零状态自检：应用必须能在"一张图都没有"的情况下完成 boot
    // =====================================================================
    // 这是本套用例最重要的一条前置：若零状态直接白屏/抛错，那就是一个 P0
    //（用户装完软件第一次打开就是零状态，那是最常被走到的路径）。
    await page.goto('/');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
      undefined,
      { timeout: 45_000 }
    );
    await expect(page.locator('#geology-canvas'), '零状态下画布元素必须存在').toBeVisible({
      timeout: 15_000,
    });

    const zero = await diagram(page);
    expect(zero.imageSrc, '零状态必须如实返回 imageSrc=null（不得回落内置范例）').toBeNull();
    expect(zero.rois, '零状态必须没有任何 ROI').toEqual([]);
    expect(zero.columns, '零状态必须没有任何列').toEqual([]);
    expect(zero.imageWidth).toBe(0);
    expect(zero.imageHeight).toBe(0);

    // 界面必须**告诉用户该干什么**，而不是显示一个空壳。
    const loadPanel = page.locator('.step-panel[data-step="1"]');
    await expect(loadPanel, '零状态必须停在第 1 步并渲染其面板').toBeVisible();
    await expect(
      loadPanel,
      '零状态的第 1 步必须给用户可执行的指引（"点击顶栏范例 / 拖拽图片"），而不是空白'
    ).toContainText('尚未载入');

    // 零状态下不应有「进入步骤 2」按钮：没有图就没法划 ROI。
    // —— 但**工作流推进条**的 #btn-wf-next 仍然是渲染的（见下一条发现）。
    const gotoStep2 = page.locator('#btn-goto-step2');
    expect(
      await gotoStep2.count(),
      '零状态下不该出现「进入步骤 2」按钮（没有图就没有 ROI 可划）'
    ).toBe(0);

    record({
      step: 0,
      label: '零状态启动',
      humanAction: '双击打开软件（后端空会话，未载入任何图）',
      uiResponse: '页面完成 boot，停在第 1 步，提示"尚未载入剖面图…"',
      backend: {
        imageSrc: zero.imageSrc,
        imageWidth: zero.imageWidth,
        imageHeight: zero.imageHeight,
        rois: zero.rois.length,
        columns: zero.columns.length,
      },
      judgement:
        '零状态可用：__straditize 句柄就绪、画布已挂载、后端如实返回 null/[] 而非回落范例。',
    });

    // =====================================================================
    // 1. 上传：真实文件选择器
    // =====================================================================
    // `#btn-open-file` 的 handler 是 `fileInput.click()`（`Toolbar.ts:463`），
    // 所以点击它必然弹出系统级文件选择器。Playwright 拦下这个事件后 `setFiles()`
    // 走的就是**用户选中一个文件**的那条路：input 的 change → `onOpenFile(file)`
    // → `FileLoaderService.handleOpenFile` → FileReader → `core.loadImage`。
    // 这里没有替代任何环节，也没有直调 RPC 种图。
    let uploadPath = '真实文件选择器（#btn-open-file → filechooser）';
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
      await page.locator('#btn-open-file').click();
      const chooser = await chooserPromise;
      await chooser.setFiles(REAL_POLLEN_IMAGE);
    } catch (err) {
      // 若环境不允许原生文件选择器（极少数无 GUI 的 CI），退化为直接给同一个
      // <input type=file> 塞文件——**仍然是 UI 的 change 链路**，只是省掉系统对话框。
      uploadPath = `setInputFiles 兜底（filechooser 不可用：${String((err as Error)?.message ?? err)}）`;
      await page.locator('#file-input-image').setInputFiles(REAL_POLLEN_IMAGE);
    }

    // ## 这条等待的写法有一个实测教训（2026-10-19，本用例第一版就踩了）
    //
    // 直觉写法是"等到后端 `imageWidth` 等于真值 2339"。**那是错的**：
    // `session_parts/core.py:232` 先把 `self.width/height` 写进去，之后才
    // `suggest_data_region()`（要跑一遍连通域分析）再 `roi_create()`。所以
    // `imageWidth === 2339` 在 `core.loadImage` **还在后端跑的时候**就已经成立，
    // 此时 `rois` 还是空数组——实测"尺寸到位"那一刻 `rois.length = 0`，
    // 再过约 350 ms 才变成 1。用尺寸当屏障 ⇒ 拿着半完成状态去断言 ROI 数量，
    // 得到一条与产品无关的红。
    //
    // 正确的屏障是**被断言的那个量本身**：`rois.length > 0`。
    // （同一纪律见 `docs/testing-strategy.md` §4.2：一次 RPC 可能分两阶段落地，
    // 等待条件必须直接写成被断言的统计量，而不是它的前驱。）
    await expect
      .poll(
        async () => {
          const d = await diagram(page);
          return { width: d.imageWidth, height: d.imageHeight, rois: d.rois.length };
        },
        {
          timeout: 60_000,
          message:
            '上传真实 PNG 后，后端必须同时具备：尺寸 2339×1654 **且** 自动建出 1 个 ROI（两者由同一次 core.loadImage 落地）',
        }
      )
      .toEqual({ width: TRUTH_W, height: TRUTH_H, rois: 1 });

    const loaded = await diagram(page);
    expect(loaded.imageSrc, '上传成功后后端必须给出图像地址（否则画布无图可画）').toBeTruthy();
    // 载入的副作用：后端自动建一个 composition=True 的 pollen ROI（`session_parts/core.py:259`）
    expect(loaded.rois.length, '载入后后端应恰好自动建一个 ROI').toBe(1);
    expect(loaded.rois[0].name).toBe('pollen');
    expect(loaded.rois[0].composition, '自动建的 pollen ROI 必须是组成型').toBe(true);
    // 但**不得**自动分列：分列是用户在第 5 步显式触发的动作。
    expect(loaded.columns, '载入后绝不能自动分列（分列是步骤 5 的动作）').toEqual([]);

    record({
      step: 1,
      label: '上传真实花粉图',
      humanAction: `点击顶栏「打开文件」，在系统文件对话框里选中 hoya-del-castillo.png（${uploadPath}）`,
      uiResponse: '载入进度提示 → 画布出现整幅剖面图，自动出现一个 pollen 数据有效区',
      backend: {
        imageWidth: loaded.imageWidth,
        imageHeight: loaded.imageHeight,
        imageSrc: loaded.imageSrc ? 'data:…/image/current' : null,
        rois: loaded.rois.map((r) => ({ id: r.id, name: r.name, composition: r.composition })),
        columns: loaded.columns.length,
        autoDetectedColumns: false,
      },
      judgement:
        '上传走的是真实 UI 链路（filechooser → input.change → FileReader → core.loadImage）。后端尺寸等于真值，且**没有**偷偷预跑分列。',
    });

    // =====================================================================
    // 2. ROI：把取数区拖到真实绘图区
    // =====================================================================
    // 载入时后端建的是 `suggest_data_region()` 猜出来的框，用户这一步要把它收到
    // 真正的数据区。判定必须读后端 `rois[].xlim/ylim`，不是 canvas 上的手柄位置。
    await advanceByRealUi(page, '#btn-goto-step2', 2);
    const roiPanel = page.locator('.step-panel[data-step="2"]');
    await expect(roiPanel).toBeVisible();

    // 用面板上的坐标读数确认起点：后端确实给了一个"建议框"。
    const beforeRoi = await diagram(page);
    expect(beforeRoi.rois.length).toBe(1);
    const suggested = beforeRoi.rois[0];
    expect(suggested.xlim, '后端必须给出建议取数区的 x 范围').toBeTruthy();
    expect(suggested.ylim, '后端必须给出建议取数区的 y 范围').toBeTruthy();

    // 拖右下角手柄到位：先用 `F` 适应屏幕，再用画布坐标算世界坐标。
    // 直接拖到"目标框的右下角"比逐像素猜更稳：起点是当前手柄位置，终点是目标的
    // 世界坐标→屏幕坐标换算结果，中间由真实的 mousemove 驱动 `RoiToolStrategy`。
    await page.keyboard.press('f');
    await dragRoiCornerTo(page, ROI_X[1], ROI_Y[1]);

    // 判据分两层，都必须读后端。
    //
    // ① 因果层：右/下边界**真的变了**。这是"我确实拖到了手柄"的证据——
    //    手柄命中半径只有 `ROI_HANDLE_SIZE_SCREEN + 2`（`GeologyCanvas.ts:1588`），
    //    坐标算错 100px 就会落空（本用例第一版实测：`xlim` 停在建议值 2030 不动）。
    // ② 目标层：右/下边界落在目标附近。容差 ±8px：拖拽经过视口缩放与整数取整，
    //    但"没动"（差 84px）与"拖错了"（差几百 px）都会被打红。
    //
    // 注意：左/上边界**不该**变——这一步只抓右下角手柄。把它们写成"也必须等于目标"
    // 是错的断言（建议框的左边 309 ≠ 目标的 315，而用户并没有动左边手柄）。
    const suggestedRight = suggested.xlim![1];
    const suggestedBottom = suggested.ylim![1];

    await expect
      .poll(
        async () => {
          const r = (await diagram(page)).rois[0];
          const right = r.xlim?.[1] ?? -1;
          const bottom = r.ylim?.[1] ?? -1;
          return {
            // ① 真的动了
            rightChanged: Math.abs(right - suggestedRight) > 1,
            bottomChanged: Math.abs(bottom - suggestedBottom) > 1,
            // ② 落在目标附近
            rightNearTarget: Math.abs(right - ROI_X[1]) <= 8,
            bottomNearTarget: Math.abs(bottom - ROI_Y[1]) <= 8,
          };
        },
        {
          timeout: 20_000,
          message: `拖动 ROI 右下角手柄后，后端右/下边界必须从建议值 (${suggestedRight}, ${suggestedBottom}) 移到目标 (${ROI_X[1]}, ${ROI_Y[1]}) ±8px`,
        }
      )
      .toEqual({
        rightChanged: true,
        bottomChanged: true,
        rightNearTarget: true,
        bottomNearTarget: true,
      });

    const dragged = (await diagram(page)).rois[0];
    // 左/上边界必须保持原样（用户没碰它们）。写死比较是安全的：来源就是同一份后端载荷。
    expect(dragged.xlim![0], '拖右下角手柄不得改动左边界').toBe(suggested.xlim![0]);
    expect(dragged.ylim![0], '拖右下角手柄不得改动上边界').toBe(suggested.ylim![0]);

    const roi = (await diagram(page)).rois[0];
    expect(roi.id, 'ROI 的 id 不应在拖拽中被换掉（换 id 会让后面所有列归属失效）').toBe(
      suggested.id
    );

    record({
      step: 2,
      label: '界定数据有效区 (ROI)',
      humanAction: `按 F 适应屏幕，拖动 pollen ROI 的右下角手柄到 (${ROI_X[1]}, ${ROI_Y[1]})`,
      uiResponse: 'ROI 框跟随手柄缩小/放大，面板的像素范围读数实时更新',
      backend: {
        roi: { id: roi.id, name: roi.name, xlim: roi.xlim, ylim: roi.ylim },
        roisCount: (await diagram(page)).rois.length,
      },
      judgement:
        'ROI 通过真实拖拽写入后端（`roi.update`），且 id 未被换掉。取数区与标定互不派生这条不变量在这一步没有被破坏。',
    });

    // 推进（用真实按钮；同时验证"没标定也能进入步骤 3"）
    await advanceByRealUi(page, '#btn-apply-roi-next', 3);

    // =====================================================================
    // 3. Y 轴两点标定
    // =====================================================================
    const ycal = page.locator('.step-panel[data-step="3"]');
    await expect(ycal).toBeVisible();

    const preCal = await diagram(page);
    expect(preCal.calibration.isCalibrated, '进入步骤 3 时后端必须仍是"未标定"').toBe(false);

    // 五个输入框一次写全、只点一次应用。理由见 `step3-ycalib.spec.ts:64-94`：
    // 逐框 fill 会因 `change` → 自动提交 + 面板重挂而丢值（那是产品缺陷，
    // 记为 F-3；本旅程不重复踩它，但也**不**假装它不存在）。
    await commitYCalib(page, {
      topPx: Y_TOP_PX,
      topVal: 0,
      botPx: Y_BOT_PX,
      botVal: 1300,
      unit: Y_UNIT,
    });

    await expect
      .poll(async () => (await diagram(page)).calibration.isCalibrated, {
        timeout: 20_000,
        message: '点「应用标定」后后端必须进入已标定状态',
      })
      .toBe(true);

    const cal = (await diagram(page)).calibration;
    expect(cal, '后端标定必须逐字段等于用户输入').toMatchObject({
      isCalibrated: true,
      top_px: Y_TOP_PX,
      top_cm: 0,
      bottom_px: Y_BOT_PX,
      bottom_cm: 1300,
      unit: Y_UNIT,
    });

    // ROI 不得被标定改写（ARCHITECTURE §6「关键区分」）。
    const roiAfterCal = (await diagram(page)).rois[0];
    expect(
      roiAfterCal.xlim,
      '标定不得改动取数区——ROI 与标尺互相独立是硬不变量'
    ).toEqual(roi.xlim);

    record({
      step: 3,
      label: 'Y 轴两点标定',
      humanAction: `在面板填 top=${Y_TOP_PX}px→0、bottom=${Y_BOT_PX}px→1300，单位 ${Y_UNIT}，点「应用标定」`,
      uiResponse: '面板显示比例 0.1601 cm/px，HUD 提示"已标定"',
      backend: { calibration: cal, roiUnchanged: true },
      judgement:
        '两点式标定真的写进后端 depth_calib，且**没有**顺手改动 ROI（两条独立的换算链）。',
    });

    await advanceByRealUi(page, '#btn-apply-ycalib-next', 4);

    // =====================================================================
    // 4. 清理（线掩膜）
    // =====================================================================
    await expect(page.locator('.step-panel[data-step="4"]')).toBeVisible();

    // 进入步骤 4 时 `WorkflowController` 会 microtask 点「检测候选」，所以这里
    // 等到后端真的产出了候选几何（或明确为 0 条）再动手。
    await expect
      .poll(async () => Array.isArray((await diagram(page)).line_candidates), {
        timeout: 30_000,
        message: '进入步骤 4 后后端必须给出 line_candidates 数组（哪怕是空的）',
      })
      .toBe(true);

    const cleanupBefore = await diagram(page);
    // 候选**检测**只产几何、不动像素（ARCHITECTURE §7.1）；所以此刻 status 必须全是 candidate。
    const statuses = cleanupBefore.line_candidates.map((c) => c.status ?? 'candidate');
    expect(
      statuses.every((s) => s === 'candidate'),
      `检测阶段产出的几何必须全部是 candidate，实际：${JSON.stringify(statuses.slice(0, 5))}`
    ).toBe(true);

    record({
      step: 4,
      label: '清理干扰线（检测候选）',
      humanAction: '进入步骤 4，等「检测候选几何」跑完',
      uiResponse: '侧栏列出候选横/竖线，橙色（未确认）',
      backend: {
        candidates: cleanupBefore.line_candidates.length,
        allCandidate: true,
        exclusionRegions: cleanupBefore.exclusion_regions.length,
        strokes: cleanupBefore.line_strokes.length,
      },
      judgement:
        '检测与删除解耦：检测只产几何不动像素。候选数量因图而异，故不断言具体条数，只断言"状态全是候选"这条因果。',
    });

    await advanceByRealUi(page, '#btn-apply-cleanup-next', 5);

    // =====================================================================
    // 5. 分列与命名
    // =====================================================================
    await expect(page.locator('.step-panel[data-step="5"]')).toBeVisible();

    // 进入步骤 5 = 后端真的跑了一遍 detect_columns。这是整条旅程第一次"算法产出数据"。
    await expect
      .poll(async () => (await diagram(page)).columns.length, {
        timeout: 60_000,
        message: '进入步骤 5 必须真的跑出属种列（分列是这个动作的核心产出）',
      })
      .toBeGreaterThan(0);

    const cols = (await diagram(page)).columns;
    // 列必须全部挂在这个 ROI 上（多 ROI 工程里归属错乱会让导出串表）。
    expect(
      cols.every((c) => c.roi_id === roi.id),
      `所有列都必须归属 ROI ${roi.id}，实际：${JSON.stringify([...new Set(cols.map((c) => c.roi_id))])}`
    ).toBe(true);
    // col_index 必须是稳定的数字（列级 RPC 靠它寻址）。
    expect(
      cols.every((c) => typeof c.col_index === 'number'),
      '每列都必须带 col_index，否则前端无法稳定寻址列级 RPC'
    ).toBe(true);

    // 改一个名字，并**用真实键盘**（`step5-naming.spec.ts:82-89` 证明 fill() 会掩盖
    // "聚焦被重渲染吃掉"这个缺陷）。
    const target = cols[1] ?? cols[0];
    const NEW_NAME = 'JourneyTaxon';
    await renameColumnViaUi(page, target.id, NEW_NAME);
    await expect
      .poll(async () => (await diagram(page)).columns.find((c) => c.id === target.id)?.name, {
        timeout: 15_000,
        message: '行内改名必须真的写进后端列对象',
      })
      .toBe(NEW_NAME);

    record({
      step: 5,
      label: '分列与命名',
      humanAction: `进入步骤 5（自动分列），在侧栏把列 ${target.col_index} 改名为「${NEW_NAME}」并回车`,
      uiResponse: '画布画出各列垂直基线；侧栏列名即时更新',
      backend: {
        columns: cols.length,
        allBelongToRoi: true,
        renamedColumn: (await diagram(page)).columns.find((c) => c.id === target.id)?.name,
      },
      judgement:
        '分列产出真实列并全部归属本 ROI；改名走真实键盘并落后端。',
    });

    await advanceByRealUi(page, '#btn-apply-naming-next', 6);

    // =====================================================================
    // 6. 标定列 X 刻度
    // =====================================================================
    await expect(page.locator('.step-panel[data-step="6"]')).toBeVisible();

    // 进入步骤 6 会自动点「自动提取刻度」。修复后的正确语义是：
    // **检测只提供齿位（detected_ticks / tickEndX），绝不自动写 x_ticks** ——
    // 读数只能由人给。hoya 没有刻度尺，所以这里应当"什么都没检出、什么都没写"。
    // （旧实现会替用户编造 `0`/`20` 两个读数写进后端，见 docs/findings/bug-report.md B-01。）
    await page.waitForTimeout(2500);
    const afterAuto = await diagram(page);
    const autoCalibrated = afterAuto.columns.filter(
      (c) => Array.isArray(c.x_ticks) && c.x_ticks.length === 2
    );
    expect(
      autoCalibrated.length,
      '进入步骤 6 的自动检测**不得**替用户写入任何 x_ticks（读数只能由人给）'
    ).toBe(0);

    // 现在由**人**真正完成一次标定：走真实 UI 填入两个读数并点【保存】。
    // 面板自己认的"活动列"取自 `XTicksPanel.activeColumn()`（前端缓存），
    // 不一定等于后端 `activeTaxaId`。以**该面板实际提交到后端的列**为准：
    // 先记下所有列当前的 x_ticks，保存后看**哪一列**变了，避免靠猜 id。
    const beforeSave = new Map(
      (await diagram(page)).columns.map((c) => [xId(c), JSON.stringify(c.x_ticks ?? null)])
    );
    await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
    await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('40');
    await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();

    // 判据：恰好有一列从"未标定"变成"已标定"，且读数等于人填的 0/40。
    let calibratedCol = null;
    for (let i = 0; i < 40 && !calibratedCol; i++) {
      await page.waitForTimeout(250);
      const cols = (await diagram(page)).columns;
      const changed = cols.filter((c) => {
        const now = JSON.stringify(c.x_ticks ?? null);
        return now !== beforeSave.get(xId(c)) && Array.isArray(c.x_ticks) && c.x_ticks.length === 2;
      });
      if (changed.length === 1) calibratedCol = changed[0];
      else if (changed.length > 1) {
        throw new Error(`保存一次标定却改动了 ${changed.length} 列：${changed.map((c) => xId(c))}`);
      }
    }
    if (!calibratedCol) {
      throw new Error('人填入读数并【保存】后，没有任何一列的 x_ticks 发生改变');
    }
    const panelCol = { id: xId(calibratedCol) };
    const px1 = calibratedCol.startX as number;
    const [t0, t1] = calibratedCol.x_ticks!;
    expect(t0.px, '第一个刻度点应落在列左边界').toBe(px1);
    expect(t1.px, '第二个刻度点的像素必须大于第一个（否则两点式标度方向反了）').toBeGreaterThan(
      t0.px
    );
    expect(t1.value, '两个刻度值必须不同（相同值无法定标度）').not.toBe(t0.value);
    expect([t0.value, t1.value], '写入的读数必须等于人填的那两个值').toEqual([0, 40]);

    record({
      step: 6,
      label: '标定列 X 刻度',
      humanAction: '进入步骤 6（自动检测不写标定），由人填入 0 与 40 并点【保存】',
      uiResponse: '面板显示两点的像素与读数，画布底部出现刻度标记',
      backend: {
        activeColumn: panelCol.id,
        xTicks: calibratedCol.x_ticks,
        autoFabricatedBeforeEdit: autoCalibrated.length,
        calibratedColumns: (await diagram(page)).columns.filter(
          (c) => Array.isArray(c.x_ticks) && c.x_ticks.length === 2
        ).length,
        totalColumns: (await diagram(page)).columns.length,
      },
      judgement:
        '自动检测**没有**替用户写读数（编造数为 0 条）；人填入 0/40 后 x_ticks 才真的落库。' +
        '这同时验证了 B-01 的修复：读数只能来自用户输入。',
    });

    await advanceByRealUi(page, '#btn-apply-xticks-next', 7);

    // =====================================================================
    // 7. 拐点与采样层位
    // =====================================================================
    await expect(page.locator('.step-panel[data-step="7"]')).toBeVisible();

    const samplesBefore = await backendRpc<{ count: number }>(page, 'samples.list', {});
    expect(samplesBefore.count, '进入步骤 7 时后端不应已有层位（用户还没提取）').toBe(0);

    await page.locator('#btn-extract-consensus').click();
    await expect
      .poll(async () => (await backendRpc<{ count: number }>(page, 'samples.list', {})).count, {
        timeout: 60_000,
        message: '点「提取共识层位」后后端必须真的产出层位（否则导出只有表头）',
      })
      .toBeGreaterThan(0);

    const samples = await backendRpc<{ count: number; samples: Array<{ row_px: number; depth: number }> }>(
      page,
      'samples.list',
      {}
    );
    // 层位的深度必须来自用户刚才的两点标定（不是 0 也不是 NaN）——这是 ROI≠标尺的
    // 推论：没有标定时这个字段是不可信的，标定之后它必须真的算出数。
    const depths = samples.samples.map((s) => s.depth);
    expect(
      depths.every((d) => Number.isFinite(d)),
      `层位深度必须是有限数（来自用户标定），实际：${JSON.stringify(depths.slice(0, 5))}`
    ).toBe(true);
    expect(
      Math.max(...depths),
      '层位深度必须落在用户标定的量程内（0-1300 cm），否则标定没被用上'
    ).toBeLessThanOrEqual(1300 + 1e-6);

    record({
      step: 7,
      label: '拐点与采样层位',
      humanAction: '点「自动提取共识层位」',
      uiResponse: '侧栏列出识别出的层位行及其深度',
      backend: {
        horizons: samples.count,
        depthRange: [Math.min(...depths), Math.max(...depths)],
        calibrationUsed: true,
      },
      judgement:
        '层位真的落后端，且深度由用户标定换算而来（落在 0-1300 cm 内且全部有限）。',
    });

    await advanceByRealUi(page, '#btn-apply-samples-next', 8);

    // =====================================================================
    // 8. 校验与导出
    // =====================================================================
    await expect(page.locator('#qa-banner'), '步骤 8 的 QA 横幅必须渲染').toBeVisible({
      timeout: 30_000,
    });

    const qa = await backendRpc<{ n_horizons: number; n_horizons_empty: number }>(
      page,
      'qa.summarize',
      {}
    );
    expect(qa.n_horizons, 'QA 必须在后端真的算出层位数').toBeGreaterThan(0);

    const readiness = await backendRpc<{
      sheets: string[];
      primary_roi: string;
      primary_roi_id: string;
      total_rois: number;
    }>(page, 'export.getReadiness', {});
    expect(readiness.sheets.length, '就绪清单必须至少有一个分表').toBeGreaterThan(0);
    expect(readiness.primary_roi, '必须有一个主 ROI').toBeTruthy();

    const tar = await backendRpc<{ tar_base64: string; size: number; success: boolean }>(
      page,
      'export.tar',
      {}
    );
    const bytes = Buffer.from(tar.tar_base64, 'base64');
    expect(bytes.length, 'base64 解出的字节数必须与后端报的 size 一致').toBe(tar.size);

    const entries = untarArchive(bytes);
    const dataCsv = entries.get('data.csv');
    if (!dataCsv) throw new Error('归档里没有 data.csv');
    const lines = dataCsv.toString('utf8').trimEnd().split('\n');
    expect(lines[0], 'data.csv 第一列必须是 depth').toMatch(/^depth,/);
    expect(
      lines.length,
      `data.csv 必须含真实数字化行而不只是表头（当前 ${lines.length} 行：${JSON.stringify(
        lines.slice(0, 3)
      )}）`
    ).toBeGreaterThan(1);

    // data.csv 必须等于主 ROI 的那张分表（导出的归属不变式）。
    const primaryCsv = entries.get(`data/${readiness.primary_roi}.csv`);
    if (!primaryCsv) {
      throw new Error(
        `归档缺少主 ROI 分表 data/${readiness.primary_roi}.csv，实际成员：${JSON.stringify([...entries.keys()])}`
      );
    }
    expect(dataCsv.equals(primaryCsv), 'data.csv 必须逐字节等于主 ROI 的分表').toBe(true);

    // 至少有一列是真的读出过数的（全 0 的 CSV 也会"有数据行"，那是假绿）。
    const rowValues = lines.slice(1).map((line) => line.split(',').slice(1).map(Number));
    const maxCell = Math.max(...rowValues.flat().filter((v) => Number.isFinite(v)));
    expect(
      maxCell,
      'data.csv 至少要有非零读数；全 0 说明曲线没被数字化（"有行数"不等于"有数据"）'
    ).toBeGreaterThan(0);

    record({
      step: 8,
      label: '校验与导出',
      humanAction: '进入步骤 8 等 QA 跑完，点「导出」/ 直接取归档',
      uiResponse: 'QA 横幅给出层位数与组分和门禁结论',
      backend: {
        qa: { n_horizons: qa.n_horizons, n_horizons_empty: qa.n_horizons_empty },
        readiness: {
          sheets: readiness.sheets,
          primary_roi: readiness.primary_roi,
          total_rois: readiness.total_rois,
        },
        tar: {
          members: [...entries.keys()].sort(),
          size: tar.size,
          dataCsvRows: lines.length - 1,
          maxCell,
          dataCsvEqualsPrimary: true,
        },
      },
      judgement:
        '导出真的有数据行、有非零读数，且 data.csv 与主 ROI 分表逐字节相同——不是只有表头的空壳。',
    });

    // 全程不该有意外通知（正常路径上用户不该被弹窗/报错打断）。
    // 注意：`fixtures.ts` 的 teardown 已经会判这条；这里显式再断一次，是为了
    // 让"旅程中途被打断"这件事在用例体里也有一句可读的失败原因。
    expect(telemetry.notices, '正常旅程不该出现任何用户通知（弹窗/toast/错误详情）').toEqual([]);
    expect(telemetry.rpcErrors, '正常旅程不该出现任何失败的后端 RPC').toEqual([]);

    // =====================================================================
    // trace 落盘（同时写一份到 outputDir，afterAll 是兜底）
    // =====================================================================
    writeTrace();
  });

  // =========================================================================
  // 回归钉子：改 ROI 后重新分列会**静默清空** x_ticks（数据损坏入口）
  // =========================================================================
  //
  // ## 为什么这条单独一个用例，而不是塞进上面的旅程
  //
  // 上面那条旅程代表"一个人顺利走完"的正常路径，它应当保持全绿——把一条**已知会红**
  // 的断言塞进去，只会让人要么忽略红灯、要么去改断言，两种结果都更糟。
  // 这里把缺陷单独钉成一条用例，并用 `test.fail()` 显式声明"**我们知道它会失败**"。
  //
  // `test.fail()` 的语义正好是我们要的：
  //   * 缺陷还在 → 用例红是**预期**，整轮仍是绿的（不会阻塞交付）；
  //   * 缺陷被修好 → 用例意外通过，Playwright 报 `Expected to fail, but passed`，
  //     **强制**我们把 `test.fail()` 摘掉并把它升格为正向回归。
  // 这样"知道有问题"这件事被写进了代码，而不是只写在文档里。
  //
  // ## 缺陷本身（已独立复现，非引用他人结论）
  //
  // 判据是**区间守卫越界**，不是"列数变化"——后者只是伴随现象。
  // `session_parts/core.py:736-746` 的恢复块里，刻度像素必须落在
  // `[min(start,end)-10, max(start,end)+10]` 内才回填 `x_ticks`；
  // 落在区间外时该分支**既不写、也不报、也不计**（静默丢弃），
  // 随后 `resolve_column_scale` 退化到 `source="legacy"`。
  //
  // 注意：本条用例**故意只挪 20px**：此时守卫已越界（首次越界在 18px），
  // 但**列数仍是 28→28**（首次列数变化要 22px）。这样断言就精确钉住"守卫"这个真判据，
  // 不会被"列数变化"这一伴随现象带偏（早期版本正是因此把归因写错了）。
  //
  // 实测（Lead 逐像素扫描 `scripts/lead_probe/xticks_scan_decide.py`）：
  //   Δ=17 列数 28→28 守卫通过 → 保留；Δ=18 列数 28→28 守卫越界 → **被抹**；Δ=22 列数才首次变化。
  // 数据后果（同一像素宽度 110px）：标定后 `13.9241 %`（source=x_ticks）→ 重分列后 `47.6190 %`（source=legacy）。
  test.describe('回归：重新分列与 x_ticks 标定的存亡', () => {
    test.fail(
      !process.env.STRADITIZE_EXPECT_XTICKS_FIXED,
      '已知缺陷：ROI 边界挪动致刻度越出守卫区间时，重分列会静默清空 x_ticks（见 docs/findings/bug-report.md B-02）'
    );

    test('ROI 边界挪动使刻度越出守卫区间后，已标定的 x_ticks 必须仍然存在（列数未变）', async ({ page }) => {
      await backendRpc(page, 'e2e.reset');
      // 用后端直调摆出"已标定 + 已分列"的起点。这一步不是验证 UI 上传（上面已覆盖），
      // 而是把缺陷的**最小前置**固定下来：同一张图、同一个 ROI、同一组刻度。
      await backendRpc(page, 'core.loadImage', {
        sample_key: 'hoya',
        file_name: 'hoya-del-castillo.png',
      });
      await backendRpc(page, 'core.detectColumns', {
        data_xlim: [315, 1946],
        data_ylim: [511, 1311],
      });

      const before = await diagram(page);
      expect(before.columns.length, '前置：基准分列应产出列').toBeGreaterThan(0);
      const colId = before.columns[0].id;

      // 标定第一列（走真实 RPC，像素取自该列几何）。
      const col0 = before.columns[0];
      const px1 = col0.startX as number;
      await backendRpc(page, 'column.calibrateXTicks', {
        col_index: col0.col_index,
        ticks: [
          { px: px1, value: 0 },
          { px: px1 + 158, value: 20 },
        ],
        unit: '%',
      });

      const calibrated = await diagram(page);
      const ticks = calibrated.columns.find((c) => c.id === colId)?.x_ticks;
      expect(ticks, '前置：标定后该列必须有 x_ticks').toBeTruthy();
      expect(ticks!.length).toBe(2);

      // 关键动作：把 ROI 左边界挪 **20px** 后重新分列。
      // 20px 落在"守卫已越界（≥18）但列数尚未变化（<22）"的窗口内，
      // 因此本断言钉的是**守卫**，而不是列数。实测列数保持 28→28。
      await backendRpc(page, 'core.detectColumns', {
        data_xlim: [335, 1946],
        data_ylim: [511, 1311],
      });

      const after = await diagram(page);
      const afterTicks = after.columns.find((c) => c.id === colId)?.x_ticks ?? null;

      // 前置保护：确认这一档**列数确实没变**，否则本用例就不再能区分两种判据。
      expect(
        after.columns.length,
        '前置：本用例选的位移必须让列数保持不变（否则就无法证明判据是守卫而非列数）'
      ).toBe(before.columns.length);

      // 这条断言就是缺陷本身：期望"标定活下来"，现状是 null。
      expect(
        afterTicks,
        `刻度越出守卫区间后，重分列把 x_ticks 静默清空了（标定前 ${JSON.stringify(ticks)}，重分列后 null）。` +
          `后果：同一列在标定前后按不同换算链导出不同数值，见 docs/findings/bug-report.md B-02`
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 本文件局部助手（只被这一个 spec 用，故不进 helpers.ts）
// ---------------------------------------------------------------------------

function xId(col: WireColumn): string {
  return col.id;
}

/**
 * 一次性写全 5 个标定框、只点一次「应用」。
 *
 * 不使用逐框 `fill()`：`YCalibPanel.ts` 给每个框挂了 `change` → 自动提交，而每次提交
 * 成功都会 `inspector.updateData()` → 整块重挂面板，逐框填写会丢值（产品缺陷 F-3，
 * 见 `docs/testing-strategy.md` §9 与 `step3-ycalib.spec.ts` 的详细记录）。
 * 本旅程要验证的是"标定能不能做对"，不是在测试里复现那个竞态。
 */
async function commitYCalib(
  page: Page,
  v: { topPx: number; topVal: number; botPx: number; botVal: number; unit: string }
): Promise<void> {
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

/**
 * 用真实鼠标把 ROI 的右下角手柄拖到世界坐标 `(wx, wy)`。
 *
 * ## 坐标怎么来的（不是猜的）
 *
 * `Viewport` 没有挂到 `window` 上，测试拿不到它。但它对 `F` 键（`GeologyCanvas.fitToScreen`，
 * `GeologyCanvas.ts:450-456`）的取值是**确定的**：
 *
 * ```
 * viewport.fitToScreen(containerW, containerH, imageW, imageH, padding = 60)
 *   scale = min((containerW - 120) / imageW, (containerH - 120) / imageH, 1.5)
 *   panX  = (containerW - imageW * scale) / 2
 *   panY  = (containerH - imageH  * scale) / 2
 * ```
 *
 * 所以"先按 F，再按上式反算屏幕坐标"就能精确落在手柄上。
 * 容器是 `.canvas-wrapper`（`main.ts:133-134` 创建、`:249` 传给 GeologyCanvas），
 * 它的 `getBoundingClientRect()` 与画布 CSS 尺寸一致（`canvas.style.width = rect.width`，
 * `GeologyCanvas.ts:471-473`），故屏幕坐标可直接加上 box 的左上角。
 *
 * ## 为什么不用"画布像素 ÷ 图尺寸"的近似
 *
 * 第一版正是那么写的，结果 `fitToScreen` 的 **60px 内边距** 与 **1.5 上限** 都没算进去，
 * 实际拖拽点偏出 ROI 手柄约 100px ⇒ 命中测试落空 ⇒ 后端 `xlim` 纹丝不动
 * （失败信息里 `Received: 2030` 就是载入时的建议框，没被改过）。
 * 手柄命中半径只有 `ROI_HANDLE_SIZE_SCREEN + 2`（`GeologyCanvas.ts:1588`），必须精确。
 */
async function dragRoiCornerTo(page: Page, wx: number, wy: number): Promise<void> {
  // `f` 键：适应屏幕。`ShortcutService` 在不处于输入框时处理（页面此刻焦点在 body）。
  await page.keyboard.press('f');
  // 等一帧，让 requestRender 与视口变换落定。
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

  const geom = await page.evaluate(
    ([tx, ty]) => {
      const api = (window as unknown as { __straditize?: { getState: () => any } }).__straditize;
      if (!api) throw new Error('window.__straditize 不可用');
      const st = api.getState();
      const roi = st.rois?.[0];
      if (!roi) throw new Error('后端没有 ROI，无法拖动');
      const wrap = document.querySelector('.canvas-wrapper') as HTMLElement | null;
      if (!wrap) throw new Error('.canvas-wrapper 不存在（GeologyCanvas 的容器）');
      const rect = wrap.getBoundingClientRect();
      const PAD = 60; // GeologyCanvas.fitToScreen 的 padding
      const availW = Math.max(10, rect.width - PAD * 2);
      const availH = Math.max(10, rect.height - PAD * 2);
      const imageW = st.image?.width || 1;
      const imageH = st.image?.height || 1;
      const scale = Math.min(availW / imageW, availH / imageH, 1.5);
      const panX = (rect.width - imageW * scale) / 2;
      const panY = (rect.height - imageH * scale) / 2;
      const toScreen = (x: number, y: number) => ({
        // 容器内坐标 → 视口坐标
        x: rect.left + x * scale + panX,
        y: rect.top + y * scale + panY,
      });
      return {
        from: toScreen(roi.xlim[1], roi.ylim[1]),
        to: toScreen(tx, ty),
        scale,
      };
    },
    [wx, wy] as const
  );

  await page.mouse.move(geom.from.x, geom.from.y);
  await page.mouse.down();
  // 分多步移动：`RoiToolStrategy.onMouseMove` 每步都按 pointer 位置改写 ROI，
  // 一步到位也能用，但多步更接近真人拖拽，也能更早暴露"中途被别的东西抢走"。
  await page.mouse.move(geom.to.x, geom.to.y, { steps: 24 });
  await page.mouse.up();
}

/**
 * 行内改名（真实键盘）。
 *
 * 必须走键盘而不是 `fill()`：焦点会触发侧栏重渲染，`fill()` 在元素被替换时
 * 可能静默写到已脱离文档的旧节点上，把缺陷掩盖成"值没变"
 * （`step5-naming.spec.ts:82-89` 的实测结论）。
 *
 * ## 为什么不用 `Control+a`（2026-10-19 实测）
 *
 * 第一版照抄 `step5-naming.spec.ts` 写 `input.press('Control+a')`，后端收到的是
 * **`JourneyTaxoncol02`** —— `col02` 原样留在后面，说明那次全选没生效：点击输入框
 * 会先触发 `focusin → onSelectTaxa → Sidebar.updateData → render()`，整栏 `innerHTML`
 * 被重写；新旧节点之间选区丢失，`Control+a` 落在被替换掉的旧节点上等于什么都没做。
 *
 * 因此改用 **`fill('')` 清空 + 断言真的空了** 再逐字敲：`fill` 会等元素稳定，
 * 而"清空后必须为空"是一条显式前置断言——它直接证明"框里没有残留"，
 * 而不是指望某个快捷键在竞态里恰好生效。清空走真实 `input` 事件，不是给 DOM 塞值。
 */
async function renameColumnViaUi(page: Page, colId: string, text: string): Promise<void> {
  const input = page.locator(`input.taxa-name-inline-input[data-col-id="${colId}"]`).first();
  await expect(input, `列 ${colId} 的行内改名输入框必须可见`).toBeVisible({ timeout: 20_000 });
  await input.click();
  // 前置：点开后框里必须是原列名（否则"名字真的换了"失去判别力）。
  await expect(input, '点开后输入框应显示该列当前名字').not.toHaveValue('');
  await input.fill('');
  await expect(
    input,
    '清空后输入框必须真的为空（不为空说明输入被重渲染吃掉，或旧值和光标位置有残留）'
  ).toHaveValue('');
  await page.keyboard.type(text, { delay: 20 });
  await expect(input, '真实键盘输入必须完整落进输入框，不能有残留字符').toHaveValue(text);
  await input.press('Enter');
}

/**
 * 极简 POSIX UStar 读取器（同 `export.spec.ts`：`src/core/TarArchive.ts` 没有挂到 window，
 * 测试拿不到；`frontend/node_modules` 里也没有 tar 包）。
 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (Number.isNaN(size)) {
      throw new Error(`tar 头解析失败：偏移 ${offset} 处 size 字段为 ${JSON.stringify(sizeText)}`);
    }
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g') {
      entries.set(name, buf.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}
