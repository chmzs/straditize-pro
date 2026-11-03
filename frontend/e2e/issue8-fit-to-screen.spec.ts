/**
 * Issue #8：【适应屏幕】/ F 键与容器尺寸的关系。
 *
 * ## 本文件钉住的三件事（判据全部可证伪）
 *
 * | 判据 | 改坏后会怎样 |
 * | --- | --- |
 * | 容器 1140×943 下按下 F/【适应屏幕】：`scale` 与 `Viewport.fitToScreen` 公式一致（<1%），`panX` 使图居中 | 视口不按当前容器重算 → scale 停在别的容器的旧值 |
 * | 容器变大/变小（窗口缩放、抽屉折叠）后**无需按 F**，视口自动重新适配 | 只改画布后备缓冲、不改视口 → 图偏出中心（实测 140px） |
 * | 用户手动缩放/平移过后，容器变化**不得**把视口打回 fit | 无条件 refit → 用户精修中的缩放被抢走 |
 *
 * ## 数值口径：期望值一律从**当前容器实测尺寸**与**当前图像实测尺寸**现算
 *
 * 曾经有人按"1140×943 容器 + 1923×1796 图"手算期望值，得到 scale=0.4582 /
 * panX=129.4，而画布实际是 0.436 / 60 —— 差 80px。那不是视口没重算，而是算期望
 * 值时用了另一张图（组级标定用的 beginner 范例是 1923×1796，当时真正在画的是
 * 基线 hoya 2339×1654；实测 beginner 载入瞬间视口就是 0.45824053452115815 /
 * 129.40172605790644，与公式分毫不差）。所以这里不再手算常数，容器尺寸取
 * `.canvas-wrapper` 的 boundingBox，图像尺寸取 `getState().image`，与产品同源。
 *
 * 视口真值取自 `getState().viewport`（`WebMcpBridge` 新增字段），而不是从画出来的
 * 分列竖线反解——反解要世界坐标 + 网格搜索，误差全进判据里。
 */
import { expect, test } from './fixtures';
import { openApp } from './helpers';
import type { Page } from '@playwright/test';

/** 与 `Viewport.fitToScreen` 同一条公式（padding 60 由 `GeologyCanvas.fitToScreen` 传入）。 */
const PADDING = 60;

interface Measurement {
  /** 容器（`.canvas-wrapper`）的 CSS 像素尺寸，即 `fitToScreen` 读取的那个矩形。 */
  containerW: number;
  containerH: number;
  scale: number;
  panX: number;
  panY: number;
  imageW: number;
  imageH: number;
}

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('.canvas-wrapper');
    if (!wrapper) throw new Error('.canvas-wrapper 不存在');
    const box = wrapper.getBoundingClientRect();
    const state = (window as unknown as {
      __straditize: { getState: () => Record<string, any> };
    }).__straditize.getState();
    return {
      containerW: box.width,
      containerH: box.height,
      scale: state.viewport.scale,
      panX: state.viewport.panX,
      panY: state.viewport.panY,
      imageW: state.image.width,
      imageH: state.image.height,
    };
  });
}

/** 该容器尺寸下 `fitToScreen` 应给出的 scale / panX / panY。 */
function expectedFit(m: Pick<Measurement, 'containerW' | 'containerH' | 'imageW' | 'imageH'>) {
  const availableW = Math.max(10, m.containerW - PADDING * 2);
  const availableH = Math.max(10, m.containerH - PADDING * 2);
  const scale = Math.min(availableW / m.imageW, availableH / m.imageH, 1.5);
  return {
    scale,
    panX: (m.containerW - m.imageW * scale) / 2,
    panY: (m.containerH - m.imageH * scale) / 2,
  };
}

function describe(m: Measurement): string {
  const e = expectedFit(m);
  return (
    `容器 ${m.containerW.toFixed(0)}×${m.containerH.toFixed(0)}，图 ${m.imageW}×${m.imageH}；`
    + `实测 scale=${m.scale} panX=${m.panX.toFixed(1)} panY=${m.panY.toFixed(1)}；`
    + `公式应为 scale=${e.scale.toFixed(6)} panX=${e.panX.toFixed(1)} panY=${e.panY.toFixed(1)}`
  );
}

/**
 * 轮询直到视口按当前容器适配（<1% 的 scale 误差 + panX/panY 居中 1px 内）。
 *
 * 轮询而不是「睡一觉再断言」：容器尺寸变化由 `ResizeObserver` 投递，投递时机取决于
 * 宿主帧调度；固定 sleep 会变成随机红。超时时把实测值与公式值一起抛出来，
 * 失败信息直接指向偏差量。
 */
async function expectFittedToCurrentContainer(page: Page, label: string): Promise<Measurement> {
  let last: Measurement | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    last = await measure(page);
    const e = expectedFit(last);
    const scaleOk = Math.abs(last.scale - e.scale) <= e.scale * 0.01;
    const centred = Math.abs(last.panX - e.panX) <= 1 && Math.abs(last.panY - e.panY) <= 1;
    if (scaleOk && centred) return last;
    await page.waitForTimeout(75);
  }
  throw new Error(`${label}：视口没有按当前容器适配。${last ? describe(last) : '（未取到测量值）'}`);
}

/** 把窗口定到一个尺寸并等布局落定（`100vh` 派生高度需要一帧）。 */
async function resizeWindow(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
}

async function pressFit(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('f');
  await page.waitForTimeout(150);
}

test.describe('Issue #8：适应屏幕与容器尺寸', () => {
  test('C1 容器 1140×943 下【适应屏幕】：scale 与公式一致、panX 使图居中', async ({ page }) => {
    // 1680×1050 的窗口下 `.canvas-wrapper` 实测为 1140×943（左右抽屉各占固定宽度，
    // 顶栏 79px + 底栏 28px），正是 issue 里点名的容器尺寸。
    await resizeWindow(page, 1680, 1050);
    await openApp(page);
    await pressFit(page);

    const m = await expectFittedToCurrentContainer(page, 'C1');
    expect(
      Math.abs(m.containerW - 1140) <= 5 && Math.abs(m.containerH - 943) <= 5,
      `复现环境应落在 issue 点名的 1140×943 容器上（实测 ${m.containerW.toFixed(0)}×${m.containerH.toFixed(0)}）`
    ).toBe(true);

    // 判据拆开写，失败信息才能区分"比例错"和"没有居中"。
    const e = expectedFit(m);
    expect(Math.abs(m.scale - e.scale) / e.scale, `scale 必须与公式一致（<1%）：${describe(m)}`)
      .toBeLessThan(0.01);
    // 居中：图左缘 = panX、右缘 = panX + 图宽·scale，两者到容器左右边的距离必须相等。
    const leftGap = m.panX;
    const rightGap = m.containerW - (m.panX + m.imageW * m.scale);
    expect(Math.abs(leftGap - rightGap), `左右留白必须相等（整幅图居中）：${describe(m)}`)
      .toBeLessThanOrEqual(1);
  });

  test('C2 容器变大后无需按 F，视口自动重新适配', async ({ page }) => {
    // 先在**小**容器里安定下来，再让容器长大 —— 这正是 issue 描述的时序
    //（"视口停留在首次适应屏幕时的布局"）。旧实现里 `handleResize()` 只改画布
    // 后备缓冲，视口一个字节都不动，于是图像按旧比例绘制，偏出中心。
    await resizeWindow(page, 1440, 960);
    await openApp(page);
    await pressFit(page);
    const small = await expectFittedToCurrentContainer(page, 'C2 前置（小容器）');
    expect(small.containerW, '前置：小窗口下容器应明显更窄').toBeLessThan(1100);

    await resizeWindow(page, 1680, 1050);

    // 不按 F、不调任何接口，只等自动重算。
    await expectFittedToCurrentContainer(page, 'C2（容器从 ' + small.containerW.toFixed(0) + ' 变大后）');
  });

  test('C3 折叠抽屉（非窗口 resize 引起的容器变化）同样触发重新适配', async ({ page }) => {
    // 没有 ResizeObserver 时这类变化完全没有信号：`window.resize` 不会触发，
    // 只有 `setSidebarCollapsed()` 顺带调一次 `handleResize()`。
    await resizeWindow(page, 1680, 1050);
    await openApp(page);
    await pressFit(page);
    const before = await expectFittedToCurrentContainer(page, 'C3 前置');

    await page.keyboard.press('Control+BracketLeft');
    await page.waitForTimeout(300);
    const after = await measure(page);
    expect(after.containerW, '前置：折叠左抽屉后容器必须真的变宽').toBeGreaterThan(
      before.containerW + 100
    );

    await expectFittedToCurrentContainer(page, 'C3（折叠左抽屉后）');
  });

  test('C4 用户手动缩放后，容器变化不得把视口打回 fit', async ({ page }) => {
    await resizeWindow(page, 1680, 1050);
    await openApp(page);
    await pressFit(page);

    // 手动放大两档（`=` 键走 `Viewport.zoomStepAt`，与滚轮同一条路径）。
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await page.waitForTimeout(150);
    const zoomed = await measure(page);
    expect(zoomed.scale, '前置：两档放大后比例必须明显大于 fit 值').toBeGreaterThan(
      expectedFit(zoomed).scale * 1.3
    );

    await resizeWindow(page, 1400, 900);
    await page.waitForTimeout(300);

    const after = await measure(page);
    expect(
      after.scale,
      `用户动手调过视口，容器变化后不得自动改比例：${describe(after)}`
    ).toBeCloseTo(zoomed.scale, 3);
    expect(after.panX, '同理不得自动改平移').toBeCloseTo(zoomed.panX, 1);

    // 显式按 F 仍应回到适配 —— 自动重算被抑制不等于 F 失效。
    await pressFit(page);
    await expectFittedToCurrentContainer(page, 'C4（手动缩放后按 F）');
  });
});
