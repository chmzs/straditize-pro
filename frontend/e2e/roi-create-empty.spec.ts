/**
 * 产品决策 ③：**新建 ROI 必须是"待用户框选的空区域"**，不是当前 ROI 的克隆。
 *
 * ## 被钉住的三个事实（全部读后端，不看 DOM）
 *
 * | 判据 | 为什么只能读后端 |
 * | --- | --- |
 * | 新 ROI 面积为 0 | 克隆缺陷的症状就是"边界等于旧 ROI"。只看 DOM 卡片数量、颜色、名字，克隆与空区域长得一模一样 |
 * | 与既有 ROI 零重合 | 面积 0 是"空"的充分条件，零重合是它的可复算表述；两条都写，防止有人把面积清零却把原点留在旧 ROI 内部造成"看似空、实则在别人肚子里" |
 * | `name_source === 'default'` | 前端显式传 `name` 会把后端打成 `user`——那是"用户自己起的名字"，与事实不符，且会污染重命名语义 |
 *
 * ## 负向对照（防止"只把数值清零就算完"）
 *
 * 光断言面积 0 的另一种作弊实现是「永远拿不到真实边界」。所以这里继续做一次
 * **真实拖拽**，并把落库边界与拖拽终点的世界坐标对账：用户画到哪，就必须存到哪。
 * 只有"能空、也能真的画上"两半都成立，这条需求才算做完。
 *
 * ## 为什么拖拽从左上角手柄起手
 *
 * 零面积 ROI 的 8 个手柄全部重合在同一个点。人在这种图上只有一个直觉动作：
 * 抓住那个点往右下拖。命中判定若照名单顺序返回 `tl`，拖拽会被 `xMax - 20`
 * 的下界夹死、矩形纹丝不动——所以本用例的拖拽本身就是对命中判定的验收。
 */
import { expect, test, type Page } from './fixtures';
import { canvasBox, diagramData, getState, gotoStage, resetBaseline } from './helpers';

interface WireRoi {
  id: string;
  name: string;
  name_source?: string;
  xlim: [number, number];
  ylim: [number, number];
}

interface WireDiagram {
  rois: WireRoi[];
  activeRoiId: string | null;
}

interface ViewportState {
  stage: number;
  viewport: { scale: number; panX: number; panY: number };
}

/** `xlim` 写成 [min, max] 还是反的都不影响面积，用绝对值兜住。 */
function roiArea(roi: WireRoi): number {
  return Math.abs(roi.xlim[1] - roi.xlim[0]) * Math.abs(roi.ylim[1] - roi.ylim[0]);
}

/** 两个轴对齐矩形的交集面积（像素²）。 */
function overlapArea(a: WireRoi, b: WireRoi): number {
  const ax0 = Math.min(a.xlim[0], a.xlim[1]);
  const ax1 = Math.max(a.xlim[0], a.xlim[1]);
  const ay0 = Math.min(a.ylim[0], a.ylim[1]);
  const ay1 = Math.max(a.ylim[0], a.ylim[1]);
  const bx0 = Math.min(b.xlim[0], b.xlim[1]);
  const bx1 = Math.max(b.xlim[0], b.xlim[1]);
  const by0 = Math.min(b.ylim[0], b.ylim[1]);
  const by1 = Math.max(b.ylim[0], b.ylim[1]);
  const w = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const h = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  return w * h;
}

async function diagram(page: Page): Promise<WireDiagram> {
  return diagramData<WireDiagram>(page);
}

/**
 * 从当前活动 ROI 的左上角（零面积时 8 个手柄的重合点）向右下拖到世界坐标 (wx, wy)。
 *
 * 起点用**渲染真值**（`__straditize.getState().viewport` 的 scale/panX/panY），
 * 不用 fitToScreen 公式重算：公式一旦与实现漂移，拖拽就会落在错的像素上，
 * 而失败信息会伪装成"边界没落库"。
 */
async function dragEmptyRoiCornerTo(page: Page, wx: number, wy: number): Promise<void> {
  const box = await canvasBox(page);
  const state = await getState<ViewportState>(page);
  const { scale, panX, panY } = state.viewport;
  const toScreen = (x: number, y: number) => ({
    x: box.x + x * scale + panX,
    y: box.y + y * scale + panY,
  });

  const current = await diagram(page);
  const active = current.rois.find((r) => r.id === current.activeRoiId);
  if (!active) throw new Error('没有活动 ROI，无法拖拽');

  const from = toScreen(active.xlim[0], active.ylim[0]);
  const to = toScreen(wx, wy);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

test('新建 ROI 是待框选的空区域，且框选后边界等于用户画的', async ({ page }) => {
  await resetBaseline(page);
  await gotoStage(page, 2);

  const before = await diagram(page);
  expect(before.rois.length, '基线应恰好一个 pollen ROI').toBe(1);
  const existing = before.rois[0];

  // ---- 1. 点「+ 新建 ROI」 ----
  await page.locator('#btn-create-roi').click();
  await expect
    .poll(async () => (await diagram(page)).rois.length, {
      message: '点「+ 新建 ROI」后后端应出现第二个 ROI',
      timeout: 15_000,
    })
    .toBe(2);

  const afterCreate = await diagram(page);
  const created = afterCreate.rois.find((r) => r.id !== existing.id);
  expect(created, '新建的 ROI 必须在后端 rois[] 里可定位').toBeTruthy();
  const fresh = created as WireRoi;

  // 判据 A：空区域
  expect(
    roiArea(fresh),
    `新建 ROI 必须是零面积的"待框选"区域，实际边界 xlim=${JSON.stringify(fresh.xlim)} ylim=${JSON.stringify(fresh.ylim)}`,
  ).toBe(0);

  // 判据 B：与既有 ROI 零重合（克隆缺陷下这里是整块重合）
  expect(
    overlapArea(fresh, existing),
    '新建 ROI 不得与既有 ROI 在几何上重合',
  ).toBe(0);

  // 判据 C：默认名必须标成 default，不是 user
  expect(
    fresh.name_source,
    '后端自动生成的默认名必须记作 name_source=default（前端显式传 name 会把它打成 user）',
  ).toBe('default');

  // 判据 D：新 ROI 必须成为活动 ROI（否则用户框的还是旧区域）
  expect(afterCreate.activeRoiId, '新建后应自动切到新 ROI').toBe(fresh.id);

  // 判据 E：面板必须告诉用户下一步做什么（可见文本，含"框选/拖"）
  const hint = page.locator('[data-roi-empty-hint]');
  await expect(hint, '空 ROI 状态下，面板必须给出可见的框选指引').toBeVisible({ timeout: 10_000 });
  await expect(hint).toContainText(/框选|拖/);

  // ---- 2. 负向对照：真的画一个框，边界必须等于画的那一块 ----
  const targetX = 900;
  const targetY = 700;
  await dragEmptyRoiCornerTo(page, targetX, targetY);

  await expect
    .poll(async () => {
      const current = await diagram(page);
      const roi = current.rois.find((r) => r.id === fresh.id);
      return roi ? roiArea(roi) : 0;
    }, { message: '框选后后端边界必须从零面积变成真实面积', timeout: 15_000 })
    .toBeGreaterThan(0);

  const framed = (await diagram(page)).rois.find((r) => r.id === fresh.id) as WireRoi;
  const [fx1, fy1] = [Math.max(...framed.xlim), Math.max(...framed.ylim)];
  expect(
    Math.abs(fx1 - targetX),
    `框选落库的右边界应等于拖拽终点 ${targetX}px，实际 ${fx1}`,
  ).toBeLessThanOrEqual(5);
  expect(
    Math.abs(fy1 - targetY),
    `框选落库的下边界应等于拖拽终点 ${targetY}px，实际 ${fy1}`,
  ).toBeLessThanOrEqual(5);

  // 框选完成后"待框选"提示必须消失——否则提示在撒谎。
  await expect(hint, '框选落库后不应再显示"待框选"提示').toHaveCount(0);
});
