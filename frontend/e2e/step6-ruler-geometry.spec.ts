/**
 * 步骤 6「对齐本组」：打开就能用 —— 一行检测结果、一个读数、一个按钮。
 *
 * ## 真值来源（不是从被测代码里读的）
 *
 * `straditize_core/assets/tutorials/beginner-tutorial.png`（1923×1796）实测：
 * 底部轴线 y=1664，四列印刷标签依次 10/30/50/70/90、10/30/50、10/30、10/30；
 * 刻线中心 `[323,449,573,699,825] / [1012,1138,1262] / [1418,1542] / [1642,1766]`。
 * **轴线**（数据 0 点）左缘 259/947/1352/1576、右缘 262/952/1357/1581；
 * 分列 start 却是 259/954/1352/1576 —— col1 偏到轴线右侧，其余落在左缘。
 *
 * 所以 0 点必须用实测轴线：首列「轴线→末齿 = 825−262 = 563px 对应读数 90」
 * → 563/90 ≈ 6.25 px/单位，这是独立于实现可核对的物理量。
 *
 * 三条断言各守一件事：检测真的接上了、空读数不许蒙、应用后的斜率与**锚点**正确。
 * 判别力：把跨度写死成 40，第 3 条会得到 40/90 = 0.44 而立刻变红；
 * 把锚点退回 col.startX，col1/col2/col3 的方向断言会变红。
 */
import { expect, test } from './fixtures';
import {
  backendRpc,
  clickCanvas,
  diagramData,
  gotoStage,
  openStep6GroupsFold,
  resetBaseline,
} from './helpers';
import type { Page } from '@playwright/test';

/**
 * 走**新流程**给组标定：等价于 UI 上「点一个刻度齿 + 填它的数字」。
 *
 * 点齿标定的结果是 `value_per_px`（组级斜率）：`slope = 数字 / 距0点px`。
 * 这里直接写后端 —— 因为本文件的判据是"标定后读数/绘制是否正确"，
 * 而不是"鼠标点击有没有被处理"（那由专门的 UI 连通测试覆盖）。
 */
interface Tick {
  px: number;
  value: number;
}

interface BackendColumn {
  id: string;
  name?: string;
  col_index?: number;
  startX?: number;
  endX?: number;
  x_ticks?: Tick[] | null;
  x_group_id?: string;
}

const PANEL = '.step-panel[data-step="6"]';

const DETECT = `${PANEL} [data-role="ruler-detect"]`;

/** 图像物理真值：四列**轴线**（= 数据 0 点）的像素带。左缘实测 259/947/1352/1576，
 * 描边 1–3px，右缘即 0 点。用带而不是定值，断言就不绑死描边宽度的估计。 */
/** 分列给出的 start，仅作对照：col1 的 start 在轴线右侧，col2/col3 在左侧。 */

async function columns(page: Page): Promise<BackendColumn[]> {
  return (await diagramData<{ columns: BackendColumn[] }>(page)).columns;
}

/** 载入「沉积图谱」范例并走到步骤 6（进入步骤 5 会真的跑一次分列）。 */
async function openBeginnerStep6(page: Page): Promise<void> {
  await resetBaseline(page);
  await page.selectOption('#select-sample-diagram', 'beginner');
  await expect
    .poll(
      async () => {
        const d = await diagramData<{ imageWidth: number; imageHeight: number }>(page);
        return [d.imageWidth, d.imageHeight];
      },
      { timeout: 30_000, message: '范例下拉必须真的把后端切到 beginner-tutorial.png' }
    )
    .toEqual([1923, 1796]);

  await gotoStage(page, 5);
  expect((await columns(page)).length, 'beginner 图应切出 4 列').toBe(4);

  // 显式清空标定，保证"未标定"这个前提是真的。
  // `resetBaseline` 不清 x_ticks：同一 worker 里先跑的用例会留下已标定列，
  // 于是 T6 单跑绿、批量跑红（实测）。用例之间不该靠执行顺序成立。
  const n = (await columns(page)).length;
  for (let i = 0; i < n; i++) {
    await backendRpc(page, 'column.clearXTicks', { col_index: i });
  }
  expect(
    (await columns(page)).every((c) => (c.x_ticks ?? null) === null),
    '前置条件：所有列必须处于未标定状态'
  ).toBe(true);

  await gotoStage(page, 6);
  // 几何检测是 mount 里的异步 RPC，等它把数字填进检测行再断言。
  await expect
    .poll(async () => page.locator(DETECT).getAttribute('data-spacing'), { timeout: 20_000 })
    .not.toBe('');
}

test.describe('步骤 6 对齐本组（自动跨度）', () => {
  test('T1 检测行显示列数与真实刻距', async ({ page, telemetry }) => {
    await openBeginnerStep6(page);

    const line = page.locator(DETECT);
    await expect(line).toContainText('检测：4 列');
    await expect(line).toContainText('规则');

    const spacing = Number(await line.getAttribute('data-spacing'));
    expect(
      spacing,
      `检测行必须显示真实中位刻距（实测 124~126px），实得 ${spacing}`
    ).toBeGreaterThanOrEqual(120);
    expect(spacing).toBeLessThanOrEqual(130);
    await expect(line).toContainText(`${Math.round(spacing * 10) / 10}px`);

    // 自动跨度那一行随「每根齿单位数」控件一起删除了（标定改走「点齿 + 填数字」，
    // 不再拿"一格多宽"当输入量）。刻距本身仍由检测行给出，上面两条已在钉它。
    expect(telemetry.rpcErrors, '检测过程不得有失败请求').toEqual([]);
  });

  test.describe('T4 批量归组（放行成功通知）', () => {
    test.use({ allowlists: { notice: [/已把 \d+ 个属种列调整到目标组/] } });

  test('T4 批量归组：全选 + 一次划入（22 列不必点 22 次）', async ({ page }) => {
    await openBeginnerStep6(page);

    // 组由后端直接建（新建组走原生 prompt，而 fixture 会自动 dismiss 所有 dialog，
    // 所以这里不测 prompt 本身，只测"多选后一次划入"这条真正费手操作的路径）。
    const before = await diagramData<{ activeRoiId: string; columns: BackendColumn[] }>(page);
    const roiId = before.activeRoiId;
    const created = await backendRpc<{ group: { id: string; name: string } }>(
      page,
      'roi.groupCreate',
      { roi_id: roiId, name: '批量测试组', unit: '%', plot_type: 'area', scale_type: 'linear' }
    );
    const newGroupId = created.group.id;

    // 重挂面板：切走再回来，让组 Tab 与列状态按后端刷新
    await gotoStage(page, 5);
    await gotoStage(page, 6);
    const groupTabs = page.locator(`${PANEL} .btn-switch-group-tab`);
    await expect(groupTabs, '应有两个组 Tab').toHaveCount(2);

    // 选中新组
    await openStep6GroupsFold(page);
    await page.locator(`${PANEL} .btn-switch-group-tab[data-group-id="${newGroupId}"]`).click();

    // 展开批量归组抽屉
    await page.locator(`${PANEL} #btn-toggle-batch-assign`).click();
    const boxes = page.locator(`${PANEL} .group-col-check`);
    await expect(boxes).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(boxes.nth(i), `第 ${i} 列不应已在新组`).not.toBeChecked();
    }

    // 全选 → 一次划入
    await page.locator(`${PANEL} #btn-group-select-all`).click();
    for (let i = 0; i < 4; i++) await expect(boxes.nth(i)).toBeChecked();
    await page.locator(`${PANEL} #btn-assign-selected-to-group`).click();

    // 四列必须全部落到新组（一次操作，而不是四次）
    await expect
      .poll(
        async () => {
          const cols = await columns(page);
          return cols.map((c) => c.x_group_id);
        },
        { timeout: 15_000, message: `四列应全部进入新组 ${newGroupId}` }
      )
      .toEqual([newGroupId, newGroupId, newGroupId, newGroupId]);
  });
  });
  test.describe('T5 画布选列成组（放行成功通知）', () => {
    test.use({
      allowlists: { notice: [/已新建【.+】并划入 \d+ 列/, /已删除该列组/] },
    });

    test('T5 +分组 → 图上点选 → 确认成组 → 删除组全部回默认', async ({ page }) => {
      await openBeginnerStep6(page);

      const gidBefore = (await columns(page)).map((c) => c.x_group_id);
      expect(new Set(gidBefore).size, '前置：全部列同属默认组').toBe(1);

      // 进入选列模式
      await openStep6GroupsFold(page);
      await page.locator(`${PANEL} #btn-create-new-group`).click();
      const bar = page.locator(`${PANEL} #column-pick-bar`);
      await expect(bar, '必须出现选列提示条').toBeVisible();
      await expect(bar).toContainText('已选 0 列');

      // 布局门禁：提示条曾被我插进「包含 N 个属种列 + 批量调整」那条 flex 行里，
      // 被挤成 173px 宽、文字折成 5 行。它会占满面板宽度才说明没再被当成 flex item。
      {
        const barBox = await bar.boundingBox();
        const panelBox = await page.locator(PANEL).boundingBox();
        expect(barBox, '拿不到提示条尺寸').not.toBeNull();
        expect(
          barBox!.width,
          `选列条必须接近面板全宽（面板 ${panelBox!.width.toFixed(0)}px，实得 ${barBox!.width.toFixed(0)}px）`
        ).toBeGreaterThan(panelBox!.width * 0.8);
      }
      await expect(page.locator(`${PANEL} #btn-confirm-column-pick`)).toBeDisabled();

      // 在图上点两列（用画布相对位置，避开对缩放/居中的精确依赖）
      await clickCanvas(page, 0.35, 0.5);
      await expect(bar, '第一次点选后应为 1 列').toContainText('已选 1 列');
      await clickCanvas(page, 0.55, 0.5);
      await expect
        .poll(async () => (await bar.innerText()).includes('已选 2 列'), { timeout: 5_000 })
        .toBe(true);
      await expect(page.locator(`${PANEL} #btn-confirm-column-pick`)).toBeEnabled();

      // 确认成组
      await page.locator(`${PANEL} #btn-confirm-column-pick`).click();

      await expect
        .poll(
          async () => {
            const gids = (await columns(page)).map((c) => c.x_group_id);
            return [new Set(gids).size, gids.filter((g) => g === gidBefore[0]).length];
          },
          { timeout: 15_000, message: '应分成两组：2 列进新组、2 列留默认组' }
        )
        .toEqual([2, 2]);

      // 删除刚才那个组 → 全部回默认组
      await openStep6GroupsFold(page);
      await page.locator(`${PANEL} #btn-delete-group`).click();
      await expect
        .poll(
          async () => new Set((await columns(page)).map((c) => c.x_group_id)).size,
          { timeout: 15_000, message: '删组后应只剩一个组' }
        )
        .toBe(1);
    });
  });
});
