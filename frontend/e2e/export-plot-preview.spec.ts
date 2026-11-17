/**
 * 出图预览的交互与格式（用户原话：图片预览缺可缩放、平移；默认应填充显示全貌；
 * 下载只提供 jpg 和 svg；预览应有显式关闭按钮）。
 *
 * ## 为什么用 stub 而不是真跑 R
 *
 * 本文件的判据全部落在**前端**：预览框几何、缩放锚点、关闭后释放、下载扩展名与字节头。
 * 真正的出图（R + rioja）由 `tests/unit/test_plot_render.py` 覆盖，那里能直接断言
 * 「format=svg 交回的字节以 <?xml 开头且含 <svg」。e2e 若也真跑 R，CI 上没装 R 就整条跳过、
 * 装了 R 又因 R 版本差异变红——那测的是 R 环境，不是这里要守的交互。
 *
 * 因此 `plot.render` 用一个**只替换这一个方法**的 route 拦下：返回真 JPEG（画布现场生成，
 * 所以 naturalWidth/naturalHeight 是真的）或真 SVG 字节；其余 RPC 一律透传，避免
 * 「到处都坏」的无差别场景（同 `error-surfacing.spec.ts` 的做法）。
 *
 * ## 判据与反向验证
 *
 * 1. 默认态：object-fit: contain、scale=1、无平移，**整幅画面落在预览框内**，且预览框
 *    高度 <= 46vh（长图不得把弹窗撑爆）。反向验证：删掉 frame 的 height:46vh、
 *    把 img 的 object-fit 改成 fill → 判据 1 变红。
 * 2. 关闭预览：预览框 display:none 且 img.src 为空字符串（src 属性已移除，data URL 释放）。
 *    反向验证：把 removeAttribute('src') 改回 src=''（属性保留）→ 判据 2 变红。
 * 3. 下载格式：下拉集合精确等于 {jpeg, svg}；选 jpeg 得到 0xFF 0xD8 0xFF 开头的 .jpeg，
 *    选 svg 得到含 <svg 的 .svg。反向验证：让下载固定用 lastPlot.format（不按所选重出）
 *    → 选 svg 时扩展名仍是 .jpeg，判据 3 变红。
 * 4. 滚轮缩放以**光标**为锚点：缩放前后光标下的那个图像点位移 <= 1px（按缩放后的画面
 *    宽度折算成像素）。反向验证：把 zoomPlotAt 换成「以框中心缩放」→ 判据 4 变红。
 */
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from './fixtures';
import { openApp } from './helpers';

/** 预览图尺寸：刻意用**长图**（600x2400），因为地层图就是长的，contain 必须扛得住。 */
const JPEG_W = 600;
const JPEG_H = 2400;

/** 伪 SVG 字节：前端职责只是「把后端给的字节按所选扩展名存出去」，不解析 SVG。 */
const SVG_BYTES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2400">' +
    '<rect width="600" height="2400" fill="#f2f2f2"/>' +
    '<text x="20" y="60" font-size="24">蒿属</text></svg>\n',
  'utf8',
);

interface PlotGeometry {
  /** transform 的 scale（矩阵 a）。 */
  scale: number;
  tx: number;
  ty: number;
  natural: { width: number; height: number };
  /** contain 之后画面在 img 布局盒里的位置与尺寸（CSS 语义，独立算出）。 */
  content: { left: number; top: number; width: number; height: number };
  /** 画面在**屏幕上**的矩形（已含 transform）。 */
  screenContent: { left: number; top: number; width: number; height: number };
  /** 预览框：left/top/width/height 是 border box（算中心用），client* 是内容盒（算 46vh 用）。 */
  frame: {
    left: number;
    top: number;
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  objectFit: string;
}

/**
 * 读预览图几何。
 *
 * 画面矩形不读实现里的变量，而是按 CSS 语义自己算一遍：img 的布局盒由
 * width/height:100% 决定，object-fit: contain 把画面等比缩进盒内并居中。
 * 屏幕矩形再由 getComputedStyle().transform 的矩阵推出来（transform-origin: 0 0，
 * 所以元素未变换的左上角 = rect.left - e）。
 */
async function plotGeometry(page: Page): Promise<PlotGeometry | null> {
  return page.evaluate(() => {
    const img = document.querySelector('#wpd-plot-image') as HTMLImageElement | null;
    const frame = document.querySelector('#wpd-plot-frame') as HTMLElement | null;
    if (!img || !frame) return null;
    const m = new DOMMatrix(getComputedStyle(img).transform);
    const rect = img.getBoundingClientRect();
    const boxW = img.offsetWidth;
    const boxH = img.offsetHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!boxW || !boxH || !nw || !nh) return null;
    const ratio = Math.min(boxW / nw, boxH / nh);
    const contentW = nw * ratio;
    const contentH = nh * ratio;
    const contentLeft = (boxW - contentW) / 2;
    const contentTop = (boxH - contentH) / 2;
    const untransformedLeft = rect.left - m.e;
    const untransformedTop = rect.top - m.f;
    const frameRect = frame.getBoundingClientRect();
    return {
      scale: m.a,
      tx: m.e,
      ty: m.f,
      natural: { width: nw, height: nh },
      content: { left: contentLeft, top: contentTop, width: contentW, height: contentH },
      screenContent: {
        // 注意必须加上 m.e / m.f（平移）：getBoundingClientRect 已含 transform，
        // 但画面矩形是按元素**未变换**的左上角 + 矩阵推的，漏掉平移会整体错位。
        left: untransformedLeft + m.e + m.a * contentLeft,
        top: untransformedTop + m.f + m.d * contentTop,
        width: contentW * m.a,
        height: contentH * m.d,
      },
      frame: {
        left: frameRect.left,
        top: frameRect.top,
        width: frameRect.width,
        height: frameRect.height,
        clientWidth: frame.clientWidth,
        clientHeight: frame.clientHeight,
      },
      objectFit: getComputedStyle(img).objectFit,
    };
  });
}

/** 光标位置对应的图像点（画面内归一化坐标 u/v，0 到 1）。 */
async function imagePointUnder(page: Page, x: number, y: number) {
  const geometry = await plotGeometry(page);
  if (!geometry) throw new Error('预览图还没解码，读不到几何');
  return {
    u: (x - geometry.screenContent.left) / geometry.screenContent.width,
    v: (y - geometry.screenContent.top) / geometry.screenContent.height,
    geometry,
  };
}

/**
 * 打开导出面板并出图（stub 版）。
 *
 * 顺序有依赖：JPEG data URL 先在页面里用 canvas 生成（真图片），再装 route，
 * 最后点「本机出图」——route 的回调闭包捕获这份 data URL。
 */
async function openPreview(page: Page): Promise<void> {
  const jpegDataUrl = await page.evaluate(
    ([width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 2d context，无法生成预览图');
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#333';
      for (let i = 0; i < 6; i += 1) {
        ctx.fillRect(20 + i * 90, 40 + i * 300, 60, 240);
      }
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    [JPEG_W, JPEG_H] as [number, number],
  );

  await page.route('**/rpc', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    let body: { id?: unknown; method?: string; params?: { format?: string } } | null = null;
    try {
      body = request.postDataJSON() as { id?: unknown; method?: string; params?: { format?: string } };
    } catch {
      await route.continue();
      return;
    }
    if (body?.method !== 'plot.render') {
      await route.continue();
      return;
    }
    const format = String(body?.params?.format ?? 'jpeg');
    const result =
      format === 'svg'
        ? {
            success: true,
            engine: 'stub',
            format: 'svg',
            mime: 'image/svg+xml',
            size_bytes: SVG_BYTES.length,
            data_url: 'data:image/svg+xml;base64,' + SVG_BYTES.toString('base64'),
            path: null,
            rows_count: 3,
            columns_count: 2,
            warnings: [],
            unsupported: [],
          }
        : {
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null, result }),
    });
  });

  await page.locator('#btn-export-csv').click();
  await page.locator('#btn-wpd-plot-oneclick').click();
  await expect(page.locator('#wpd-plot-preview-box')).toBeVisible();
  // 图必须真的解码（naturalWidth > 0）：img 挂上了但字节坏掉，这里是唯一能抓到的地方。
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (document.querySelector('#wpd-plot-image') as HTMLImageElement | null)?.naturalWidth ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

test.describe('出图预览：缩放 / 平移 / 关闭 / 下载格式', () => {
  // 导出面板一打开就发 export.csv 取行集；本文件不标定深度（预览图是 stub 给的），
  // 后端按 CALIBRATION_ERROR(-32003) 拒绝，面板把原因写进「行集」caption 里给用户看。
  // 这条失败是既有行为、不是被吞掉的错误，故显式声明豁免（同 export-*.spec.ts 的做法）。
  // 两条通知也是既有行为：①未标定 → 面板把 export.csv 的 -32003 弹成 toast；
  // ②出图成功 → 「出图完成」toast（本文件正是在验证这条链路正常）。
  test.use({
    allowlists: {
      rpcError: [/export\.csv/],
      notice: [/读取 samples 数据集失败/, /出图完成/],
    },
  });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('默认填充显示全貌：contain + 整幅可见 + 预览框高度不超过 46vh', async ({ page }) => {
    await openPreview(page);
    const geometry = await plotGeometry(page);
    expect(geometry, '预览图必须已解码').not.toBeNull();

    expect(geometry!.objectFit, '默认必须是 object-fit: contain（填充显示全貌）').toBe('contain');
    expect(geometry!.natural.width).toBe(JPEG_W);
    expect(geometry!.natural.height).toBe(JPEG_H);

    // 默认态 = 适应窗口：scale 1、无平移。
    expect(geometry!.scale).toBeCloseTo(1, 3);
    expect(geometry!.tx).toBeCloseTo(0, 1);
    expect(geometry!.ty).toBeCloseTo(0, 1);

    // 长图必须整幅落在框内（不得溢出、不得裁切）。
    const eps = 1;
    expect(geometry!.screenContent.left).toBeGreaterThanOrEqual(geometry!.frame.left - eps);
    expect(geometry!.screenContent.top).toBeGreaterThanOrEqual(geometry!.frame.top - eps);
    expect(geometry!.screenContent.left + geometry!.screenContent.width).toBeLessThanOrEqual(
      geometry!.frame.left + geometry!.frame.width + eps,
    );
    expect(geometry!.screenContent.top + geometry!.screenContent.height).toBeLessThanOrEqual(
      geometry!.frame.top + geometry!.frame.height + eps,
    );
    // 且画面确实顶满了一边（2400 高的长图在 46vh 框里应是「高度顶满」）。
    expect(geometry!.screenContent.height).toBeCloseTo(geometry!.frame.clientHeight, 0);

    // 容器高度上限：46vh。
    const viewport = page.viewportSize();
    expect(viewport, '需要固定视口才能算 46vh').not.toBeNull();
    expect(geometry!.frame.clientHeight).toBeLessThanOrEqual(viewport!.height * 0.46 + 1);
    // 弹窗本身也不得被撑出视口（长图不得把弹窗撑爆）。
    const dialog = await page.locator('.ui-modal').first().boundingBox();
    expect(dialog).not.toBeNull();
    expect(dialog!.y).toBeGreaterThanOrEqual(-1);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });

  test('关闭预览：预览框隐藏且 img.src 被清空（data URL 释放）', async ({ page }) => {
    await openPreview(page);

    const srcBefore = await page.evaluate(
      () => (document.querySelector('#wpd-plot-image') as HTMLImageElement).getAttribute('src') ?? '',
    );
    expect(srcBefore.length, '打开预览后 img 应挂着 data URL').toBeGreaterThan(100);

    await page.locator('#btn-wpd-plot-close').click();

    await expect(page.locator('#wpd-plot-preview-box')).toBeHidden();
    const after = await page.evaluate(() => {
      const img = document.querySelector('#wpd-plot-image') as HTMLImageElement;
      return {
        src: img.src,
        attr: img.getAttribute('src'),
        downloadDisabled: (document.querySelector('#btn-wpd-plot-download') as HTMLButtonElement).disabled,
      };
    });
    expect(after.attr, 'src 属性必须移除，否则大字符串还挂在这个节点上').toBeNull();
    expect(after.src, 'img.src 必须为空字符串').toBe('');
    expect(after.downloadDisabled, '关掉预览后下载按钮应回到禁用态').toBe(true);
  });

  test('下拉只列 jpeg / svg，且下载按所选扩展名与真字节保存', async ({ page }) => {
    await openPreview(page);

    const options = await page.locator('#sel-wpd-plot-format option').evaluateAll((nodes) =>
      nodes.map((node) => {
        const option = node as HTMLOptionElement;
        return { value: option.value, text: option.textContent ?? '' };
      }),
    );
    expect(options.map((o) => o.value).sort(), '格式集合必须精确等于 {jpeg, svg}').toEqual(['jpeg', 'svg']);
    // 每项都要写清用途，否则用户只能靠猜。
    const jpegText = options.find((o) => o.value === 'jpeg')!.text;
    const svgText = options.find((o) => o.value === 'svg')!.text;
    expect(jpegText).toMatch(/位图|直接分享/);
    expect(svgText).toMatch(/矢量|排版/);

    // ---- JPEG：字节头 0xFF 0xD8 0xFF ----
    await page.locator('#sel-wpd-plot-format').selectOption('jpeg');
    const [jpegDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-wpd-plot-download').click(),
    ]);
    expect(jpegDownload.suggestedFilename()).toMatch(/\.jpeg$/);
    const jpegBytes = readFileSync(await jpegDownload.path());
    expect([jpegBytes[0], jpegBytes[1], jpegBytes[2]], 'JPEG 魔术字节').toEqual([0xff, 0xd8, 0xff]);

    // ---- SVG：内容必须含 <svg ----
    // 预览里那份是 JPEG；选 SVG 时必须按 SVG 现场重出，否则存下来的 .svg 里是 JPEG 字节。
    await page.locator('#sel-wpd-plot-format').selectOption('svg');
    const [svgDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-wpd-plot-download').click(),
    ]);
    expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
    const svgBytes = readFileSync(await svgDownload.path());
    expect(svgBytes.toString('utf8'), 'SVG 必须真的含 <svg 根元素').toContain('<svg');
    expect(svgBytes.subarray(0, 5).toString('utf8'), 'SVG 必须以 <?xml 开头').toBe('<?xml');
    // 预览仍是那张可显示的 JPEG（预览固定 jpeg，所见即所得）。
    const geometry = await plotGeometry(page);
    expect(geometry!.natural.width, 'SVG 下载不得把预览图换掉').toBe(JPEG_W);
  });

  test('滚轮缩放以光标为锚点：缩放前后光标下的图像点位移 <= 1px', async ({ page }) => {
    await openPreview(page);
    const frame = page.locator('#wpd-plot-frame');
    await frame.scrollIntoViewIfNeeded();
    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();

    // 刻意取非中心点：以框中心缩放的实现能通过「中心点不动」的弱断言，通不过这一条。
    const anchorX = frameBox!.x + frameBox!.width * 0.32;
    const anchorY = frameBox!.y + frameBox!.height * 0.61;
    const before = await imagePointUnder(page, anchorX, anchorY);

    await page.mouse.move(anchorX, anchorY);
    await page.mouse.wheel(0, -320);

    await expect
      .poll(async () => (await plotGeometry(page))?.scale ?? 0, { timeout: 5_000 })
      .toBeGreaterThan(before.geometry.scale * 1.1);

    const after = await imagePointUnder(page, anchorX, anchorY);
    const driftX = Math.abs(after.u - before.u) * after.geometry.screenContent.width;
    const driftY = Math.abs(after.v - before.v) * after.geometry.screenContent.height;
    expect(driftX, '光标下的图像点在 x 方向漂移了 ' + driftX.toFixed(2) + 'px').toBeLessThanOrEqual(1);
    expect(driftY, '光标下的图像点在 y 方向漂移了 ' + driftY.toFixed(2) + 'px').toBeLessThanOrEqual(1);
  });

  test('拖拽平移 / 双击复位 / 1:1 与适应窗口按钮', async ({ page }) => {
    await openPreview(page);
    const frame = page.locator('#wpd-plot-frame');
    await frame.scrollIntoViewIfNeeded();
    const frameBox = (await frame.boundingBox())!;
    const centerX = frameBox.x + frameBox.width / 2;
    const centerY = frameBox.y + frameBox.height / 2;

    // 放大后再拖拽：平移量必须跟手（±5px）。
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -320);
    await expect.poll(async () => (await plotGeometry(page))?.scale ?? 0).toBeGreaterThan(1.1);
    const zoomed = (await plotGeometry(page))!;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 60, centerY + 40, { steps: 6 });
    await page.mouse.up();
    const panned = (await plotGeometry(page))!;
    expect(panned.tx - zoomed.tx).toBeGreaterThan(55);
    expect(panned.tx - zoomed.tx).toBeLessThan(65);
    expect(panned.ty - zoomed.ty).toBeGreaterThan(35);
    expect(panned.ty - zoomed.ty).toBeLessThan(45);

    // 双击复位到「适应窗口」。
    await page.mouse.dblclick(centerX, centerY);
    await expect.poll(async () => (await plotGeometry(page))?.scale ?? 0).toBeCloseTo(1, 2);

    // 1:1：画面宽度等于图片原始像素宽（600）。
    await page.locator('#btn-wpd-plot-actual').click();
    const actual = (await plotGeometry(page))!;
    expect(actual.screenContent.width).toBeCloseTo(JPEG_W, 0);
    // 居中：画面中心与框中心重合。
    expect(actual.screenContent.left + actual.screenContent.width / 2).toBeCloseTo(
      actual.frame.left + actual.frame.width / 2,
      0,
    );

    // 适应窗口：回到 scale 1 / 无平移。
    await page.locator('#btn-wpd-plot-fit').click();
    const fitted = (await plotGeometry(page))!;
    expect(fitted.scale).toBeCloseTo(1, 3);
    expect(fitted.tx).toBeCloseTo(0, 1);
    expect(fitted.ty).toBeCloseTo(0, 1);
  });
});
