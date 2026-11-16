/**
 * 导出弹窗的版面密度门禁：1366×768 / 1280×720 下 footer 必须在首屏、只允许一个滚动容器、
 * 字号只走设计系统 token、出图预览的工具行必须是单行。
 *
 * ## 用户反馈（原话）
 *
 * > 导出界面也是，ui 变得差了；可能是前面你都没有读图能力。现在返工，把今天 9 点之后的
 * > ui 修改进行改进，确保交互和界面适当美观
 *
 * 看不了图，所以这里**只断言可测量的数字**：矩形、像素、字号集合、滚动容器个数。
 *
 * ## 五条判据与它们的反向验证
 *
 * 1. `.ui-modal__footer` 完整在视口内（`bottom <= innerHeight`），1366×768 与 1280×720 各测一遍；
 *    反向验证：把 `#wpd-plot-frame` 的 `height` 改回 `46vh`（并把预览移回 body 与 footer 之间）
 *    → footer 被顶出视口，判据 1 变红。
 * 2. `.ui-modal__body` 内**只有一个**纵向滚动容器，且必须是 body 自己（后代里 0 个）；
 *    反向验证：给 `.wpd-table-wrapper` 恢复 `overflow: auto` → 判据 2 变红。
 * 3. 弹窗内所有元素的计算字号 ⊆ {10,11,12,14,16}px；反向验证：把任一内联字号写回 `10.5px`
 *    → 判据 3 变红。
 * 4. 出图工具行 `#wpd-plot-toolbar` 在 1366 宽下是**单行**：`clientHeight <= lineHeight * 1.5`
 *    且不横向溢出；反向验证：把「滚轮缩放…· 预览固定 JPEG，下载按所选格式」那句说明加回工具行
 *    → 行高被撑到两行，判据 4 变红。
 * 5. 预览出现后不改变 y 轴范围/列量程的可达性：预览显示前后 footer 都在视口内，且
 *    `#wpd-plot-options` 仍能被滚进可视区（它的矩形落在 body 的可视矩形内）。
 */
import { expect, test, type Page } from './fixtures';
import { openApp } from './helpers';

/** 设计系统 §3 只允许这几档（docs/UI_DESIGN_SYSTEM.md:95-99 的 token 值）。 */
const ALLOWED_FONT_PX = [10, 11, 12, 14, 16];

/** 预览图尺寸：长图（600×2400），因为地层图就是长的。 */
const JPEG_W = 600;
const JPEG_H = 2400;

/**
 * 打开导出面板并出图（`plot.render` 用 route stub 只替换这一个方法）。
 *
 * 不真跑 R：本文件测的是版面几何，R 出图由 `tests/unit/test_plot_render.py` 覆盖。
 */
async function openModalWithPreview(page: Page): Promise<void> {
  const jpegDataUrl = await page.evaluate(
    ([width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 2d context');
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#333';
      for (let i = 0; i < 6; i += 1) ctx.fillRect(20 + i * 90, 40 + i * 300, 60, 240);
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    [JPEG_W, JPEG_H] as [number, number],
  );

  await page.route('**/rpc', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    let body: { id?: unknown; method?: string } | null = null;
    try {
      body = request.postDataJSON() as { id?: unknown; method?: string };
    } catch {
      return route.continue();
    }
    if (body?.method !== 'plot.render') return route.continue();
    const result = {
      success: true,
      engine: 'stub',
      format: 'jpeg',
      mime: 'image/jpeg',
      size_bytes: jpegDataUrl.length,
      data_url: jpegDataUrl,
      path: null,
      rows_count: 3,
      columns_count: 2,
      warnings: [],
      unsupported: [],
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null, result }),
    });
  });

  await page.locator('#btn-export-csv').click();
  await expect(page.locator('.wpd-export-dialog')).toBeVisible();
  await page.locator('#btn-wpd-plot-oneclick').click();
  await expect(page.locator('#wpd-plot-preview-box')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('#wpd-plot-image') as HTMLImageElement | null)?.naturalWidth ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

async function rectOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`拿不到 ${selector} 的矩形`);
  return { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width, width: box.width, height: box.height };
}

test.describe('导出弹窗版面密度', () => {
  // 未标定会话里面板一打开就发 export.csv（-32003），面板把它写进 caption 并 toast；
  // 出图成功也有 toast。都是既有行为，显式豁免（同 export-*.spec.ts）。
  test.use({
    allowlists: {
      rpcError: [/export\.csv/],
      notice: [/读取 samples 数据集失败/, /出图完成/],
    },
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    test(`${viewport.width}×${viewport.height}：footer 完整在首屏 + 单滚动容器 + 字号合标`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      await openModalWithPreview(page);

      // ---- 判据 1：footer 完整在视口内 ----
      const footer = await rectOf(page, '.ui-modal__footer');
      expect(footer.bottom, 'footer 底边越出视口：' + footer.bottom + ' > ' + viewport.height).toBeLessThanOrEqual(
        viewport.height + 0.5,
      );
      expect(footer.top, 'footer 顶边在视口外').toBeGreaterThanOrEqual(-0.5);

      // ---- 判据 2：body 内只有一个纵向滚动容器（且是 body 自己） ----
      const scrollers = await page.evaluate(() => {
        const body = document.querySelector('.ui-modal__body') as HTMLElement | null;
        if (!body) return null;
        const isVerticallyScrollable = (el: HTMLElement) => {
          const style = getComputedStyle(el);
          const overflowY = style.overflowY;
          return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        };
        const describe = (el: HTMLElement) =>
          el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).join('.') : '');
        return {
          bodyScrollable: isVerticallyScrollable(body),
          descendants: Array.from(body.querySelectorAll<HTMLElement>('*'))
            .filter(isVerticallyScrollable)
            .map(describe),
        };
      });
      expect(scrollers, '找不到 .ui-modal__body').not.toBeNull();
      expect(scrollers!.descendants, 'body 内出现了嵌套的纵向滚动容器').toEqual([]);
      expect(scrollers!.bodyScrollable, 'body 应当是唯一的纵向滚动容器（内容超长时它必须能滚）').toBe(true);

      // ---- 判据 3：字号只走 token ----
      const fonts = await page.evaluate(() => {
        const root = document.querySelector('.ui-modal') as HTMLElement | null;
        if (!root) return null;
        // 每个字号带一个「首个出现它的元素」样本：红的时候能直接定位到选择器。
        const samples = new Map<number, string>();
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
          if (!(el instanceof HTMLElement)) continue;
          const px = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
          if (!Number.isFinite(px)) continue;
          if (samples.has(px)) continue;
          const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
          samples.set(px, el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls);
        }
        const values = Array.from(samples.keys()).sort((a, b) => a - b);
        return { values, samples: Object.fromEntries(Array.from(samples.entries()).map(([k, v]) => [String(k), v])) };
      });
      expect(fonts, '找不到 .ui-modal').not.toBeNull();
      const offStandard = fonts!.values.filter((v) => !ALLOWED_FONT_PX.includes(v));
      const offDetails = offStandard.map((v) => v + 'px ← ' + (fonts!.samples[String(v)] ?? '?')).join(' / ');
      expect(offStandard, '离标字号（只允许 ' + ALLOWED_FONT_PX.join('/') + 'px）：' + offDetails).toEqual([]);

      // ---- 判据 5：预览出现后 y 轴范围仍可达 ----
      const body = await rectOf(page, '.ui-modal__body');
      await page.locator('#wpd-plot-options').scrollIntoViewIfNeeded();
      const options = await rectOf(page, '#wpd-plot-options');
      expect(options.top, 'y 轴范围滚不进 body 可视区').toBeGreaterThanOrEqual(body.top - 1);
      expect(options.bottom, 'y 轴范围滚不进 body 可视区').toBeLessThanOrEqual(body.bottom + 1);
      const footerAfterScroll = await rectOf(page, '.ui-modal__footer');
      expect(footerAfterScroll.bottom, '滚动后 footer 仍须完整在视口内').toBeLessThanOrEqual(viewport.height + 0.5);
    });
  }

  test('1366 宽下出图工具行是单行', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openApp(page);
    await openModalWithPreview(page);

    const toolbar = await page.evaluate(() => {
      const el = document.querySelector('#wpd-plot-toolbar') as HTMLElement | null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        clientHeight: el.clientHeight,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        lineHeight: parseFloat(style.lineHeight),
        text: (el.textContent ?? '').trim(),
      };
    });
    expect(toolbar, '找不到工具行 #wpd-plot-toolbar').not.toBeNull();
    expect(Number.isFinite(toolbar!.lineHeight) && toolbar!.lineHeight > 0, 'line-height 必须可测（px）').toBe(true);
    expect(
      toolbar!.clientHeight,
      '工具行折行了：clientHeight=' + toolbar!.clientHeight + ' > lineHeight*1.5=' + (toolbar!.lineHeight * 1.5).toFixed(1),
    ).toBeLessThanOrEqual(toolbar!.lineHeight * 1.5);
    expect(toolbar!.scrollWidth, '工具行横向溢出').toBeLessThanOrEqual(toolbar!.clientWidth + 1);
    // 工具行只放控件与百分比：长说明必须在 meta 行/title 里，不许回到这一行。
    expect(toolbar!.text, '工具行里出现了说明性长文本').not.toMatch(/滚轮缩放|拖拽平移|预览固定 JPEG/);
  });
});
