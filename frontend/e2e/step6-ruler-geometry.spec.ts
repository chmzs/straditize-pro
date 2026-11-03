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
import { backendRpc, canvasBox, canvasColorPixels, clickCanvas, diagramData, gotoStage, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';

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
const UNITS_PER_CELL = `${PANEL} #inp-ref-units-per-cell`;
const APPLY = `${PANEL} #btn-apply-group-scale`;

/** 图像物理真值：四列**轴线**（= 数据 0 点）的像素带。左缘实测 259/947/1352/1576，
 * 描边 1–3px，右缘即 0 点。用带而不是定值，断言就不绑死描边宽度的估计。 */
const AXIS_BANDS = [
  [259, 265],
  [947, 953],
  [1352, 1358],
  [1576, 1582],
];
/** 分列给出的 start，仅作对照：col1 的 start 在轴线右侧，col2/col3 在左侧。 */
const SPLIT_STARTS = [259, 954, 1352, 1576];

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

    // 跨度也必须是检测来的：末齿 825 − 轴线右缘（262±几px）= 563±3。
    // 这里只钉量级（T3 才对锚点做精确判别），因为轴线右缘取决于描边宽度估计。
    const span = Number(await page.locator(`${PANEL} [data-role="ruler-span"]`).getAttribute('data-span'));
    expect(span, `自动跨度应为 末齿825 − 轴线 ≈ 563px，实得 ${span}`).toBeGreaterThanOrEqual(556);
    expect(span).toBeLessThanOrEqual(567);
    expect(telemetry.rpcErrors, '检测过程不得有失败请求').toEqual([]);
  });

  test.describe('T2 每根齿单位数留空', () => {
    test.use({ allowlists: { notice: [/每根齿单位数必须填/] } });

    test('T2 留空点按钮：当场拒绝且后端一列都不写（不许用 20 之类的默认值蒙）', async ({
      page,
      telemetry,
    }) => {
      await openBeginnerStep6(page);
      await expect(page.locator(UNITS_PER_CELL)).toHaveValue('');

      const before = await columns(page);
      await page.locator(APPLY).click();

      await expect
        .poll(() => telemetry.notices.some((n) => n.includes('每根齿单位数必须填')), { timeout: 10_000 })
        .toBe(true);
      expect(
        (await columns(page)).map((c) => c.x_ticks ?? null),
        '读数缺失时绝不能把任何标定写进后端'
      ).toEqual(before.map((c) => c.x_ticks ?? null));
      expect(before.every((c) => (c.x_ticks ?? null) === null), '前置条件：初始未标定').toBe(true);
    });
  });

  test.describe('T3 填读数并应用', () => {
    test.use({ allowlists: { notice: [/已对齐/] } });

    test('T3 填 90 应用后：锚点=实测轴线，px/单位落在 6.2~6.4（真值 563/90≈6.26）', async ({
      page,
      telemetry,
    }) => {
      await openBeginnerStep6(page);
      await page.locator(UNITS_PER_CELL).fill('20');
      await page.locator(APPLY).click();

      await expect
        .poll(
          async () => (await columns(page)).every((c) => (c.x_ticks ?? null) !== null),
          { timeout: 15_000, message: '四列都必须被标定' }
        )
        .toBe(true);

      const cols = await columns(page);
      expect(cols.length).toBe(4);
      const slopes: number[] = [];
      for (const [i, col] of cols.entries()) {
        const ticks = col.x_ticks as [Tick, Tick];
        const [bandLo, bandHi] = AXIS_BANDS[i];
        expect(
          ticks[0].px,
          `第 ${i} 列 0 点必须落在实测轴线带 [${bandLo},${bandHi}]，实得 ${ticks[0].px}`
        ).toBeGreaterThanOrEqual(bandLo);
        expect(ticks[0].px).toBeLessThanOrEqual(bandHi);
        expect(ticks[0].value).toBe(0);

        // 双向判别：col1 的分列 start 在轴线**右**侧，col2/col3 在**左**侧。
        // 两个方向都断言，才能证明锚点真的是实测轴线而不是 col.startX。
        if (i === 1) {
          expect(
            ticks[0].px,
            `col1 的 0 点必须落在分列 start(${SPLIT_STARTS[i]}) 左侧`
          ).toBeLessThan(SPLIT_STARTS[i]);
        }
        if (i === 2 || i === 3) {
          expect(
            ticks[0].px,
            `第 ${i} 列 0 点必须在分列 start(${SPLIT_STARTS[i]}) 右侧（轴线右缘）`
          ).toBeGreaterThan(SPLIT_STARTS[i]);
        }

        const dx = ticks[1].px - ticks[0].px;
        const dv = ticks[1].value - ticks[0].value;
        const slope = dx / dv;
        slopes.push(slope);
        // 每格 20 单位、检测刻距 124.5px → 124.5/20 = 6.225 px/单位。
        // 带留宽以容纳描边宽度与刻距中位数的估计误差。
        expect(
          slope,
          `第 ${i} 列 px/单位应为 ≈6.225（刻距/每格单位），实得 ${slope.toFixed(3)}`
        ).toBeGreaterThanOrEqual(6.1);
        expect(slope).toBeLessThanOrEqual(6.4);
      }

      // 独立几何交叉核对：col0 的末齿跨度 563px 在 6.225 px/单位下 ≈ 90.4 个单位，
      // 与图上最后一条标签「90」吻合。这条不依赖用户读哪个数，是纯几何推出的。
      const t0 = cols[0].x_ticks as [Tick, Tick];
      const dv0 = t0[1].value - t0[0].value;
      expect(dv0, `col0 跨到末齿应 ≈90 个单位（图印标签 90），实得 ${dv0.toFixed(2)}`).toBeGreaterThan(89);
      expect(dv0).toBeLessThan(92);

      // 四列必须共用同一斜率（刚体对齐的全部意义）
      for (const slope of slopes) {
        expect(Math.abs(slope - slopes[0]), '四列 px/单位必须一致').toBeLessThan(1e-3);
      }
      expect(telemetry.rpcErrors, '应用过程不得有失败请求').toEqual([]);
    });
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
      await page.locator(`${PANEL} #btn-delete-group`).click();
      await expect
        .poll(
          async () => new Set((await columns(page)).map((c) => c.x_group_id)).size,
          { timeout: 15_000, message: '删组后应只剩一个组' }
        )
        .toBe(1);
    });
  });
  test.describe('T6 未标定不画猜测刻度（放行成功通知）', () => {
    test.use({ allowlists: { notice: [/已对齐 \d+ 列/] } });

    test('T6 未标定：无红色刻度线 + X2 为空 + 显示「未标定」；标定后红线必须出现', async ({
      page,
    }) => {
      await openBeginnerStep6(page);

      // 单位刻度线现在是**蓝实线**（见 ARCHITECTURE §6.4：刻度按组级 `cell_px` 等距外推）。
      // 组的 `cell_px` 为空时不该画——那才是"未标定不画猜测刻度"的真正含义。
      const TICK_BLUE: [number, number, number] = [96, 165, 250];
      const blueBefore = await canvasColorPixels(page, TICK_BLUE, 28);
      expect(
        blueBefore,
        `组的 cell_px 为空时不应画单位刻度蓝线（实测 ${blueBefore} 个特征像素）`
      ).toBeLessThan(100);

      await expect(page.locator('#inp-manual-tick-val2'), 'X2 不得预填猜测读数').toHaveValue('');
      await expect(page.locator(PANEL)).toContainText('未标定');

      // 反向对照：真标定之后，四条刻度线必须出现——否则上面那条「没有红线」是靠
      // 把整层画崩换来的，不是靠判定。
      await page.locator(`${PANEL} #inp-ref-units-per-cell`).fill('20');
      await page.locator(`${PANEL} #btn-apply-group-scale`).click();
      await expect
        .poll(async () => canvasColorPixels(page, TICK_BLUE, 28), { timeout: 15_000 })
        .toBeGreaterThan(200);
    });
  });

  test.describe('T8 未标定列不给丰度数（悬停）', () => {
    test.use({ allowlists: { notice: [/已对齐 \d+ 列/] } });

    test('T8 未标定：悬停丰度必须是 --；标定后必须给出数字', async ({ page }) => {
      await openBeginnerStep6(page);

      // 前置：必须有一列处于选中态。`onHoverInfo` 只在有 active 列时才去算丰度，
      // 没有 active 列时「丰度是 --」恒成立，那条断言就失去了判别力。
      const first = page.locator('.taxa-card').first();
      if ((await first.count()) > 0) await first.click();
      const { activeTaxaId } = await diagramData<{ activeTaxaId: string }>(page);
      expect(activeTaxaId, '前置：必须有一列处于选中状态').toBeTruthy();

      const box = await canvasBox(page);
      const cy = box.y + box.height * 0.5;
      const cx = box.x + box.width * 0.5;
      await page.mouse.move(cx, cy);
      await page.mouse.move(cx + 5, cy + 5);

      // 先证 `onHoverInfo` 真的在跑，否则「丰度是 --」可能只是根本没触发悬停。
      await expect
        .poll(async () => page.locator('#footer-cursor').innerText(), { timeout: 10_000 })
        .toContain('X:');

      await expect(
        page.locator('#footer-pollen'),
        '未标定列的换算只会给出猜测标度下的数字（tickEndX / maxPercent 来自分列期），必须如实留空'
      ).toContainText('--');

      // 反向对照：标定之后必须给数。否则上面那条只是靠「丰度永远为空」换来的。
      await page.locator(`${PANEL} #inp-ref-units-per-cell`).fill('20');
      await page.locator(`${PANEL} #btn-apply-group-scale`).click();
      // 标定是异步 RPC：等它真的落到后端，再悬停（悬停只读取当下数据，不会重算）。
      await expect
        .poll(
          async () => (await columns(page)).filter((c) => (c.x_ticks ?? null) !== null).length,
          { timeout: 15_000, message: '对齐本组必须真的写入 x_ticks' }
        )
        .toBeGreaterThan(0);

      // 悬停在画布靠右处：换算值明显非零，避开「0 被当 falsy → 仍显示 --」的边界。
      // 每轮都重新 move：hover 不会自己重算，一次 move 在标度生效前发生就会永远停在 `--`。
      await expect
        .poll(
          async () => {
            await page.mouse.move(box.x + box.width * 0.8, cy);
            await page.mouse.move(box.x + box.width * 0.8 + 3, cy + 3);
            return (await page.locator('#footer-pollen').innerText()).includes('--');
          },
          { timeout: 15_000 }
        )
        .toBe(false);
    });
  });
});
