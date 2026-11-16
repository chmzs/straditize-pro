/**
 * 步骤 2：ROI 手柄必须「画出来就点得到」。
 *
 * 用户原话：「roi 选择步骤，有时候 roi 会没法拖动改变范围，即使我还没调好和确定好 roi」。
 *
 * ## 复现结论（修复前实测）
 *
 * | 情形 | 实测 |
 * | --- | --- |
 * | ① 默认进入步骤 2（工具 roi） | 能拖，xlim 315 → 245 |
 * | ② 点过浮动条抓手（工具 pan） | **拖不动，后端 xlim 一动不动**，光标还是 grab |
 * | ③ 侧栏新建第二个 ROI 再拖 | 能拖（写进的是活动 ROI） |
 * | ④ 拖到画布边界外松手 | **拖到一半失效**：canvas mouseleave 清掉拖拽态，松手不提交 |
 *
 * 用户遇到的正是 ②：`RoiToolStrategy` 只按当前工具分派，工具停在 pan 时它根本
 * 不会被调用，而手柄照样画在画布上——画了却点不到，用户只能猜「要切回 ROI 工具」。
 *
 * ## 判据
 *
 * 三条互相独立的证据，缺一条都可能放过「只有前端内存变了」的假修复：
 *   1. 后端 `roi.update` 真的收到新 xlim/ylim（读 `straditize.getDiagramData`）；
 *   2. 画布 ROI 矩形跟着变：`getState().legacyRoi` 是 `drawRoiOverlay` 的唯一数据源，
 *      同时用像素探针确认新角上真的落了一个手柄白块；
 *   3. 光标是 resize 而不是 grab（手柄可拖的可见信号）。
 *
 * 反向验证：把 `GeologyCanvas.onMouseDown` 里的手柄优先分支与 `onMouseLeave` 的
 * 拖拽保留回退，本文件第 1、4 条立刻变红（见 PR 描述里的实测记录）。
 */
import { expect, test, type Page } from './fixtures';
import {
  canvasBox,
  canvasInk,
  diagramData,
  getState,
  gotoStage,
  paletteActiveTool,
  resetBaseline,
} from './helpers';

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';

interface RoiBounds {
  id: string;
  xlim: [number, number];
  ylim: [number, number];
}

/** 后端权威 ROI 列表（按 id 取，取不到直接抛，避免 `?.` 把断言变成永久真）。 */
async function rois(page: Page): Promise<RoiBounds[]> {
  const d = await diagramData<{ rois: RoiBounds[]; activeRoiId?: string }>(page);
  return d.rois ?? [];
}

async function activeRoi(page: Page): Promise<RoiBounds> {
  const d = await diagramData<{ rois: RoiBounds[]; activeRoiId?: string }>(page);
  const id = d.activeRoiId ?? d.rois?.[0]?.id;
  const roi = (d.rois ?? []).find((r) => r.id === id);
  if (!roi) throw new Error(`后端不存在活动 ROI（当前：${(d.rois ?? []).map((r) => r.id).join(',') || '空'}）`);
  return roi;
}

/** 手柄在**页面坐标**下的位置（世界坐标 → 屏幕 CSS px → 加上画布偏移）。 */
async function handlePoint(page: Page, handle: Handle): Promise<{ x: number; y: number }> {
  const st = await getState<{
    legacyRoi: { xMin: number; xMax: number; yMin: number; yMax: number };
    viewport: { scale: number; panX: number; panY: number };
  }>(page);
  const box = await canvasBox(page);
  const r = st.legacyRoi;
  const { scale, panX, panY } = st.viewport;
  const pts: Record<Handle, [number, number]> = {
    tl: [r.xMin, r.yMin],
    tr: [r.xMax, r.yMin],
    bl: [r.xMin, r.yMax],
    br: [r.xMax, r.yMax],
    t: [(r.xMin + r.xMax) / 2, r.yMin],
    b: [(r.xMin + r.xMax) / 2, r.yMax],
    l: [r.xMin, (r.yMin + r.yMax) / 2],
    r: [r.xMax, (r.yMin + r.yMax) / 2],
  };
  const [wx, wy] = pts[handle];
  return { x: box.x + wx * scale + panX, y: box.y + wy * scale + panY };
}

/** 真实鼠标按下-移动-抬起（与用户操作同一条路径，不直接调内部方法）。 */
async function dragHandle(page: Page, handle: Handle, dx: number, dy: number): Promise<void> {
  const p = await handlePoint(page, handle);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function canvasCursor(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('#geology-canvas')?.style.cursor ?? ''
  );
}

/**
 * 画布上某个页面坐标处是否画着 ROI 手柄。
 *
 * 手柄填充是白色（#ffffff），悬停/拖拽时变成橙色（#f97316）——鼠标刚松手时
 * 指针仍停在新角上，所以两种都要认。用颜色而不是亮度，是因为悬停橙的亮度
 * 恰好落在中间值上（128.7），拿亮度当判据会把「画了手柄」判成「没画」。
 */
async function isHandlePixel(page: Page, x: number, y: number): Promise<boolean> {
  const box = await canvasBox(page);
  return page.evaluate(
    ([px, py, bx, by]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#geology-canvas');
      if (!canvas) throw new Error('#geology-canvas 不存在');
      const k = canvas.width / canvas.clientWidth;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 2d 上下文');
      const [r, g, b] = ctx.getImageData(
        Math.round((px - bx) * k),
        Math.round((py - by) * k),
        1,
        1
      ).data;
      const white = r > 200 && g > 200 && b > 200;
      const hoverOrange = r > 230 && g > 90 && g < 150 && b < 80;
      return white || hoverOrange;
    },
    [x, y, box.x, box.y] as const
  );
}

test.describe('步骤 2：ROI 手柄画出来就必须点得到', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 2);
  });

  test('pan 工具下拖左上手柄：后端收到新边界、画布矩形跟着变、光标是 resize', async ({
    page,
  }) => {
    await page.locator('.floating-tool-palette button[data-fmode="pan"]').click();
    expect(await paletteActiveTool(page), '前提：工具应停在抓手平移').toBe('pan');

    const before = await activeRoi(page);
    const p = await handlePoint(page, 'tl');
    await page.mouse.move(p.x, p.y);
    // 手柄可拖的可见信号：光标必须是四向 resize，而不是抓手。
    expect(await canvasCursor(page), '悬停在 ROI 手柄上时光标必须说「这里能拖」').toBe(
      'nwse-resize'
    );

    const inkBefore = await canvasInk(page);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 30, { steps: 8 });
    await page.mouse.up();
    // 提交是异步的（roi.update → 重算 → 重绘），等落库后再读像素。
    await expect
      .poll(async () => (await activeRoi(page)).xlim[0], { timeout: 10_000 })
      .toBeGreaterThan(before.xlim[0]);
    await page.waitForTimeout(300);

    // ① 后端真的收到新边界（不是只有前端内存变了）。
    await expect
      .poll(async () => (await activeRoi(page)).xlim[0], {
        message: 'pan 工具下拖手柄必须把新 xlim 写进后端 roi.update',
        timeout: 10_000,
      })
      .toBeGreaterThan(before.xlim[0]);
    const after = await activeRoi(page);
    expect(after.ylim[0], '左上角手柄同时改 yMin').toBeGreaterThan(before.ylim[0]);
    expect(after.xlim[1], '只拖左上角，右边界不得变').toBe(before.xlim[1]);
    expect(after.ylim[1], '只拖左上角，下边界不得变').toBe(before.ylim[1]);

    // ② 画布矩形跟着变：data.roi（drawRoiOverlay 的唯一数据源）+ 新角上的手柄白块。
    const st = await getState<{ legacyRoi: Record<string, number> }>(page);
    expect(st.legacyRoi.xMin, '画布镜像的 xMin 必须等于后端新值').toBe(after.xlim[0]);
    expect(st.legacyRoi.yMin, '画布镜像的 yMin 必须等于后端新值').toBe(after.ylim[0]);
    const moved = await handlePoint(page, 'tl');
    expect(
      await isHandlePixel(page, moved.x, moved.y),
      '新角上必须画着手柄（白块 / 悬停橙）——否则矩形只是数据变了、像素没动'
    ).toBe(true);

    // ③ 整幅墨迹也变了：ROI 遮罩跟着移动。
    const inkAfter = await canvasInk(page);
    expect(Math.abs(inkAfter.ink - inkBefore.ink), 'ROI 遮罩移动应改变画布墨迹').toBeGreaterThan(
      500
    );
  });

  test('默认 roi 工具下同样可拖（对照组：修复不得弄坏正常路径）', async ({ page }) => {
    const before = await activeRoi(page);
    await dragHandle(page, 'tl', -30, -20);
    await expect
      .poll(async () => (await activeRoi(page)).xlim[0], { timeout: 10_000 })
      .toBeLessThan(before.xlim[0]);
  });

  test('拖到画布外松手仍然提交（指针离开 canvas 不得中途丢拖拽）', async ({ page }) => {
    const before = await activeRoi(page);
    const p = await handlePoint(page, 'tl');
    const box = await canvasBox(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    // 一路拖到画布左边界之外（页面坐标 < 画布左缘），再松手。
    await page.mouse.move(box.x - 40, p.y - 20, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => (await activeRoi(page)).xlim[0], {
        message: '指针拖出画布后松手，ROI 仍必须落库（旧实现在 mouseleave 就丢了拖拽态）',
        timeout: 10_000,
      })
      .toBeLessThan(before.xlim[0]);
  });

  test('多 ROI：拖哪个手柄就只改哪个 ROI', async ({ page }) => {
    const panel = page.locator('.step-panel[data-step="2"]');
    await panel.locator('#btn-create-roi').click();
    await expect.poll(async () => (await rois(page)).length, { timeout: 15_000 }).toBe(2);
    const active = await activeRoi(page);
    const first = (await rois(page)).find((r) => r.id !== active.id);
    if (!first) throw new Error('新建后应存在两个 ROI');
    const firstBefore = { xlim: [...first.xlim], ylim: [...first.ylim] };

    await dragHandle(page, 'br', 80, 60);
    await expect
      .poll(async () => (await activeRoi(page)).xlim[1], {
        message: '拖活动 ROI 的手柄必须写进活动 ROI',
        timeout: 10_000,
      })
      .toBeGreaterThan(active.xlim[1]);

    const firstAfter = (await rois(page)).find((r) => r.id === first.id);
    expect(firstAfter?.xlim, '另一个 ROI 的边界不得被顺手改掉').toEqual(firstBefore.xlim);
    expect(firstAfter?.ylim, '另一个 ROI 的边界不得被顺手改掉').toEqual(firstBefore.ylim);
  });
});
