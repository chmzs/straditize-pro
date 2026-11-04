/**
 * 图例颜色同源 + 轴线粗自动实测（任务 1 / 任务 2 的判据）。
 *
 * ## L 系列：三条色块的颜色必须等于画布**实际绘制**用的色
 *
 * 图例的用途是"看到画布上那条线时知道它是什么"。色值对不上，就等于把 A 线标成
 * B 线的名字。所以这里做两道独立检查：
 * 1. **源码耦合**：从 `GeologyCanvas.drawColumnBoundaries` 里正则抠出红/绿/蓝三条
 *    线的 `strokeStyle` 字面量，与 `style.css` 里 `.legend-sw-*` 的声明逐字比较。
 *    只改一边就红——覆盖"有人调了画布颜色忘了改图例"这个真实事故形态。
 * 2. **计算样式**：浏览器里读 `.legend-sw-*` 的 `border-top-color`，与上面抠出来的
 *    期望色比对（含浅色主题下蓝色换档）。
 *
 * ## A 系列：轴线粗是**测出来**的，不是写死 5
 *
 * 判据按用户原话："把某列的 `axis_stroke_px` 改大 3px，绿线位置必须相应右移 3px"。
 * 量法：把视口压到 100%（`Ctrl+1`，此时屏幕 px 与世界 px 1:1），在画布中段扫一行
 * 像素，用 `g - max(r,b)` 找绿线中心（抗锯齿下那条线会跨两个像素，纯色相减比
 * 逐通道等值判断稳），再用 `getState().viewport` 反算世界 x。期望值 = `startX + 轴粗`。
 */
import { expect, test } from './fixtures';
import { backendRpc, gotoStage, openApp, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const CANVAS_SRC = readFileSync(`${SRC}components/GeologyCanvas.ts`, 'utf8');
const CSS = readFileSync(`${SRC}style.css`, 'utf8');

/**
 * 从绘制代码里抠某条线的 strokeStyle 字面量。
 *
 * 用 `indexOf` + 切片而不是拼 RegExp 字符串：拼串要多一层转义，写错了正则只会
 * 静默 "找不到"，把检查变成假绿。锚点找不到就直接抛。
 */
function drawColor(afterMarker: string): string {
  const at = CANVAS_SRC.indexOf(afterMarker);
  if (at < 0) {
    throw new Error(
      `GeologyCanvas.ts 里找不到锚点 ${JSON.stringify(afterMarker)} —— 绘制代码改了结构，请同步本测试`
    );
  }
  const m = CANVAS_SRC.slice(at, at + 260).match(/strokeStyle = '([^']+)'/);
  if (!m) throw new Error(`锚点 ${JSON.stringify(afterMarker)} 之后 260 字符内没有 strokeStyle`);
  return m[1];
}

/** CSS 里某个选择器的 border-top-color 声明值（同样用切片，避免转义陷阱）。 */
function cssColor(selector: string, opts: { themeLight?: boolean } = {}): string {
  const full = `${opts.themeLight ? 'body.theme-light ' : ''}${selector} {`;
  const at = CSS.indexOf(full);
  if (at < 0) throw new Error(`style.css 里找不到选择器 ${JSON.stringify(full)}`);
  const block = CSS.slice(at, CSS.indexOf('}', at) + 1);
  const m = block.match(/border-top-color: ([^;]+);/);
  if (!m) throw new Error(`style.css 的 ${JSON.stringify(full)} 里没有 border-top-color`);
  return m[1].trim();
}

/** `#ef4444` → `239, 68, 68`；`rgba(1,2,3,0.5)` → `1, 2, 3, 0.5`。用于跨写法比较。 */
function normalize(color: string): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1`;
  }
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((s) => s.trim());
    return `${Number(parts[0])}, ${Number(parts[1])}, ${Number(parts[2])}, ${parts[3] ?? '1'}`;
  }
  throw new Error(`无法归一化的颜色写法: ${color}`);
}

/** 当前主题下 `.legend-sw-*` 的计算色（归一化后）。 */
async function computedSwatch(page: Page, cls: string): Promise<string> {
  return page.evaluate((c) => {
    const el = document.querySelector(`.canvas-legend .${c}`);
    if (!el) throw new Error(`画布图例里没有 .${c}`);
    return getComputedStyle(el).borderTopColor;
  }, cls).then(normalize);
}

interface GroupSnapshot {
  id: string;
  axis_stroke_px?: number | null;
}

async function readGroups(page: Page): Promise<{ groups: GroupSnapshot[]; defaultId?: string; roiId?: string }> {
  const res = await backendRpc<{
    rois: Array<{ id: string; default_group_id?: string; x_groups?: GroupSnapshot[] }>;
  }>(page, 'roi.list');
  const roi = res.rois[0];
  return { groups: roi?.x_groups ?? [], defaultId: roi?.default_group_id, roiId: roi?.id };
}

interface ColumnSnapshot {
  startX: number;
  col_index: number | null;
}

async function readColumns(page: Page): Promise<ColumnSnapshot[]> {
  return page.evaluate(() => {
    const st = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    return (st.columns as any[]).map((c) => ({ startX: Number(c.startX), col_index: c.col_index }));
  });
}

/**
 * 画布上**绿线（0 点）**的世界 x：在给定世界 x 附近扫一行像素，取绿色分的加权质心。
 *
 * 为什么用 `g - max(r,b)` 而不是逐通道等值匹配：`lineWidth = 1.2/scale`，scale=1 时
 * 线宽 1.2px，抗锯齿会把它摊到相邻两个像素上，纯色只出现在正中间那一列。
 *
 * 为什么取**质心**而不是最大值峰：最大值峰被量化到像素索引，误差 ±0.5px，而本用例
 * 要量的是 3px 的位移 —— 误差直接进判据（实测峰位法给出 2.45px，看着像产品差 0.55px，
 * 其实是量法误差）。质心把相邻像素的权重一起算进去，得到亚像素位置。
 */
async function greenLineWorldX(page: Page, nearWorldX: number): Promise<number> {
  const out = await page.evaluate((expected) => {
    const cv = document.querySelector('#geology-canvas') as HTMLCanvasElement | null;
    if (!cv) throw new Error('#geology-canvas 不存在');
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('取不到 2d context');
    const st = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    const { panX, scale } = st.viewport as { panX: number; scale: number };
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const y = Math.round(cv.height * 0.5);
    const row = ctx.getImageData(0, y, cv.width, 1).data;
    const expectedCss = expected * scale + panX;
    const lo = Math.max(0, Math.round((expectedCss - 25) * dpr));
    const hi = Math.min(cv.width - 1, Math.round((expectedCss + 25) * dpr));
    const FLOOR = 12;
    let weight = 0;
    let moment = 0;
    let peak = -Infinity;
    for (let x = lo; x <= hi; x++) {
      const r = row[x * 4];
      const g = row[x * 4 + 1];
      const b = row[x * 4 + 2];
      const a = row[x * 4 + 3];
      if (a < 64) continue;
      const score = g - Math.max(r, b);
      if (score > peak) peak = score;
      const w = Math.max(0, score - FLOOR);
      // 用像素**中心**（x + 0.5）而不是左缘，否则整体系统偏 -0.5px
      moment += w * (x + 0.5);
      weight += w;
    }
    if (weight <= 0 || peak < 20) {
      throw new Error(`在期望位置 ${expectedCss.toFixed(1)}px 附近没找到绿线（最高绿色分=${peak}）`);
    }
    const centreDevice = moment / weight;
    // 设备像素 → CSS 像素 → 世界坐标
    return { worldX: (centreDevice / dpr - panX) / scale, score: peak };
  }, nearWorldX);
  return out.worldX;
}

/** 载入 beginner 范例并走到指定步骤（分列在步骤 5 的流程里跑）。 */
async function openBeginnerStep(page: Page, step: 5 | 6): Promise<void> {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await resetBaseline(page);
  await page.selectOption('#select-sample-diagram', 'beginner');
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as any).__straditize.getState().image as { width: number }),
      { timeout: 30_000 }
    )
    .toMatchObject({ width: 1923 });
  await gotoStage(page, 5);
  if (step === 6) await gotoStage(page, 6);
}

test.describe('图例色块与画布实际绘制同源（任务 1）', () => {
  test('L1 红/绿两条线的色值在绘制代码与 CSS 之间逐字一致', () => {
    // 抓的是 `drawColumnBoundaries` 里画完红线/绿线后紧随的 strokeStyle。
    const red = drawColor('ctx.lineTo(leftEdgeX, bottomY);');
    const green = drawColor('ctx.lineTo(zeroX, bottomY);');
    expect(normalize(cssColor('.legend-sw-column')), '图例红线必须用画布红色的同一个值').toBe(
      normalize(red)
    );
    expect(normalize(cssColor('.legend-sw-zero')), '图例绿线必须用画布绿色的同一个值').toBe(
      normalize(green)
    );
    // 两条线的语义不能合并：红线是列切分线（左缘），绿线是 0 点（右缘）。
    expect(normalize(red), '红与绿必须是两个不同的颜色，否则图例会指向同一条线').not.toBe(
      normalize(green)
    );
  });

  test('L2 蓝色刻度线按主题换档，图例跟着换档', () => {
    const dark = cssColor('.legend-sw-tick');
    const light = cssColor('.legend-sw-tick', { themeLight: true });
    expect(normalize(dark), '深色主题下必须用画布绘制的那档蓝').toBe(
      normalize('rgba(96, 165, 250, 0.65)')
    );
    expect(normalize(light), '浅色主题下必须用画布绘制的那档蓝').toBe(
      normalize('rgba(37, 99, 235, 0.55)')
    );
    // 画布那边确实是这两档（换了绘制色就必须同步 CSS，否则上面两条会红）。
    expect(CANVAS_SRC).toContain("'rgba(37, 99, 235, 0.55)'");
    expect(CANVAS_SRC).toContain("'rgba(96, 165, 250, 0.65)'");
  });

  test('L3 浏览器里三个色块的计算色都解析出了真实颜色（不是 currentColor）', async ({ page }) => {
    await resetBaseline(page);
    const sec = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('color')
    );
    for (const cls of ['legend-sw-column', 'legend-sw-zero', 'legend-sw-tick']) {
      const color = await computedSwatch(page, cls);
      expect(color, `.${cls} 必须有显式颜色`).not.toBe('');
      expect(color, `.${cls} 不能退化成继承正文色 ${sec}`).not.toBe(normalize(sec));
    }
    // 主题无关的红/绿：与绘制代码一致即可（绘制不分主题）。
    expect(await computedSwatch(page, 'legend-sw-column')).toBe(
      normalize(drawColor('ctx.lineTo(leftEdgeX, bottomY);'))
    );
    expect(await computedSwatch(page, 'legend-sw-zero')).toBe(
      normalize(drawColor('ctx.lineTo(zeroX, bottomY);'))
    );
  });
});

test.describe('轴线粗自动实测（任务 2）', () => {
  test('A1 beginner 分列后组上带实测轴粗，且不是静默的 5', async ({ page }) => {
    await openBeginnerStep(page, 5);
    const { groups } = await readGroups(page);
    expect(groups.length, 'beginner 必须有一个默认列组').toBeGreaterThan(0);
    const stroke = Number(groups[0].axis_stroke_px);
    expect(Number.isFinite(stroke) && stroke > 0, `组上必须写入实测轴粗，实测=${groups[0].axis_stroke_px}`).toBe(true);
    // 逐列实测值为 [4, 6, 6, 6]，中位数 6。断言"不是 5"是有判别力的：
    // 5 正是前端/后端的历史估算缺省值，写 5 说明还在猜。
    expect(stroke, 'beginner 实测应为 6px（4/6/6/6 的中位数），出现 5 说明是估算值').toBe(6);
  });

  test('A2 测得出时面板明示"已从像素实测"', async ({ page }) => {
    await openBeginnerStep(page, 6);
    const src = page.locator('.step-panel[data-step="6"] [data-role="axis-stroke-source"]');
    await expect(src, '面板必须有一行说明轴粗来源').toBeVisible();
    await expect(src).toHaveAttribute('data-measured', '1');
    await expect(src).toContainText('实测');
    await expect(src).not.toContainText('估算');
  });

  test('A3 轴粗 +3px，绿线（0 点）必须相应右移 3px', async ({ page }) => {
    await openBeginnerStep(page, 6);
    const { groups, defaultId, roiId } = await readGroups(page);
    const stroke = Number(groups[0].axis_stroke_px);
    expect(stroke, '前置：轴粗必须是实测值，否则本用例测的是估算值').toBeGreaterThan(0);

    // 100% 视口：屏幕 px 与世界 px 1:1，3px 的位移才量得准（fit 下 scale≈0.44）。
    const toHundred = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(150);
    };
    await toHundred();

    const cols = await readColumns(page);
    const target = cols.find((c) => c.col_index === 1) ?? cols[0];
    const expectedBefore = target.startX + stroke;
    const before = await greenLineWorldX(page, expectedBefore);
    expect(
      Math.abs(before - expectedBefore),
      `画布上的绿线必须落在 startX(${target.startX}) + 轴粗(${stroke}) = ${expectedBefore}；实测世界 x=${before.toFixed(2)}`
    ).toBeLessThanOrEqual(0.6);

    // 把组轴粗改大 3px，然后重载页面让前端拿到新的组数据。
    await backendRpc(page, 'roi.groupUpdate', {
      roi_id: roiId,
      group_id: defaultId ?? groups[0].id,
      updates: { axis_stroke_px: stroke + 3 },
    });
    // 这里必须是 openApp（只重载，不 reset）：后端刚写进去的 axis_stroke_px 要保留。
    // 用 resetBaseline 会 e2e.reset 掉这次写入，位移永远是 0。
    await openApp(page);
    await gotoStage(page, 6);
    await toHundred();

    const expectedAfter = target.startX + stroke + 3;
    const after = await greenLineWorldX(page, expectedAfter);
    // 打印实测值：报告里要写的是真实数字，不是"通过"两个字。
    console.log(
      `[A3] startX=${target.startX} 轴粗 ${stroke}→${stroke + 3}px；`
        + `绿线世界 x: ${before.toFixed(2)} → ${after.toFixed(2)}（期望 ${expectedBefore} → ${expectedAfter}，`
        + `位移 ${(after - before).toFixed(2)}px）`
    );
    expect(
      Math.abs(after - expectedAfter),
      `改大 3px 后绿线应落在 ${expectedAfter}；实测 ${after.toFixed(2)}`
    ).toBeLessThanOrEqual(0.6);
    expect(
      Math.abs(after - before - 3),
      `绿线位移必须是 +3px（before=${before.toFixed(2)} after=${after.toFixed(2)}）`
    ).toBeLessThanOrEqual(0.3);
  });

  test('A4 测不出时不静默用 5：面板明确说"无法自动测量 / 按 5px 估算"', async ({ page }) => {
    // hoya 基线：29 列里只有 8 列（28%）左缘是灰度均匀的轴，未过半 → 不写组参数。
    await page.setViewportSize({ width: 1680, height: 1050 });
    await resetBaseline(page);
    await gotoStage(page, 6);

    const { groups } = await readGroups(page);
    const stroke = groups[0]?.axis_stroke_px;
    expect(
      stroke == null || Number(stroke) <= 0,
      `前置：hoya 的轴粗测不出，组上不该有值（实测 ${stroke}）`
    ).toBe(true);

    const src = page.locator('.step-panel[data-step="6"] [data-role="axis-stroke-source"]');
    await expect(src).toBeVisible();
    await expect(src).toHaveAttribute('data-measured', '0');
    await expect(src).toContainText('无法自动测量');
    await expect(src).toContainText('估算');
  });
});
