/**
 * e2e 共用助手 —— 所有 spec 与后端/应用交互的唯一入口。
 *
 * 两条纪律，直接来自旧套件踩过的坑：
 *
 * 1. **错误必须冒泡。** 旧套件用 `re.search(r"### Result\s*\n(.*?)(?:\n###|\Z)")`
 *    从 CLI 的 markdown stdout 里刮 JSON，于是一个真实的应用级错误
 *    （`前置状态缺失：未找到 ROI 'roi_2'`）被降解成测试端的
 *    `json.decoder.JSONDecodeError`，真正的诊断全丢。这里的 `rpc()` 让
 *    promise 拒绝直接抛到测试里。
 * 2. **断言后端权威状态，而不是 DOM 文本。** 旧套件 94 条断言里只有 1 条读了
 *    后端。DOM 正常而状态机错乱（例如"删除后几何复活"）对纯 DOM 断言完全隐形。
 */
import { expect, type Page } from '@playwright/test';

/** 应用对外句柄的形状（`window.__straditize`）。 */
export interface StraditizeHandle {
  getState: () => Record<string, unknown>;
  gotoStage: (step: number) => Promise<void>;
  rpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

export interface PageTelemetry {
  /** 控制台 error 文本（按出现顺序）。 */
  consoleErrors: string[];
  /** 页面弹过的原生对话框文本；非空通常意味着前置状态缺失。 */
  dialogs: string[];
}

/**
 * 在 `goto` **之前**挂上控制台与对话框监听。
 *
 * 对话框必须显式接管：Playwright 默认会自动 dismiss，但那样测试只看到一个
 * 卡住或语义不明的失败；这里把文本留下来，失败信息才指向真正的原因。
 */
export function watchPage(page: Page): PageTelemetry {
  const telemetry: PageTelemetry = { consoleErrors: [], dialogs: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') telemetry.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => telemetry.consoleErrors.push(`pageerror: ${err.message}`));
  page.on('dialog', (dialog) => {
    telemetry.dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return telemetry;
}

/** 打开应用并等到画布与句柄就绪（不等数据）。 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
    undefined,
    { timeout: 30_000 }
  );
  await expect(page.locator('canvas')).toBeVisible();
}

/** 等到后端数据真的到达前端（基线里 hoya 的 ROI 已就位）。 */
export async function waitForDiagram(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __straditize?: StraditizeHandle }).__straditize;
      const rois = (api?.getState()?.rois ?? []) as unknown[];
      return rois.length > 0;
    },
    undefined,
    { timeout: 30_000 }
  );
}

/** 打开应用并等到基线数据就绪。 */
export async function openApp(page: Page): Promise<void> {
  await gotoApp(page);
  await waitForDiagram(page);
}

/**
 * 直接走 HTTP 调后端 RPC，**不依赖应用是否已加载**。
 *
 * `beforeEach` 里页面还是 `about:blank`，此时 `window.__straditize` 并不存在；
 * 而复位后端这件事本来也不需要应用参与。用浏览器上下文的 request 打 `/rpc`
 * （同源、自动带 baseURL），比"先加载页面再调、调完再重载"少一次完整加载。
 */
export async function backendRpc<T = unknown>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const res = await page.request.post('/rpc', {
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  if (!res.ok()) {
    throw new Error(`后端 RPC ${method} 返回 HTTP ${res.status()}：${await res.text()}`);
  }
  const body = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };
  if (body.error) {
    throw new Error(`后端 RPC ${method} 失败 [${body.error.code}] ${body.error.message}`);
  }
  return body.result as T;
}

/**
 * 把后端复位到基线，然后重新加载页面让前端拉取新状态。
 *
 * 为什么必须重新加载：直接改后端，前端的镜像状态不会自己刷新
 * （旧套件正是因此出现"前端 rois 停在旧值"的假失败）。
 */
export async function resetBaseline(page: Page): Promise<void> {
  await backendRpc(page, 'e2e.reset');
  await page.goto('/');
  await openApp(page);
}

/** 调后端 RPC，拿到 result。失败直接抛出应用的真实错误。 */
export async function rpc<T = unknown>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  return page.evaluate(
    async ([m, p]) => {
      const api = (window as unknown as { __straditize?: StraditizeHandle }).__straditize;
      if (!api) throw new Error('window.__straditize 句柄不可用：应用未完成初始化');
      return api.rpc(m, p);
    },
    [method, params] as const
  ) as Promise<T>;
}

/** 前端权威状态（stage / rois / renderedLayers / yCalibMarks ...）。 */
export async function getState<T = Record<string, unknown>>(page: Page): Promise<T> {
  return page.evaluate(() => {
    const api = (window as unknown as { __straditize?: StraditizeHandle }).__straditize;
    if (!api) throw new Error('window.__straditize 句柄不可用');
    return api.getState();
  }) as Promise<T>;
}

/** 后端权威图谱数据。 */
export async function diagramData<T = Record<string, unknown>>(page: Page): Promise<T> {
  return rpc<T>(page, 'straditize.getDiagramData');
}

/** 跳步骤并确认真的落定（不确认就会在错的状态上做断言）。 */
export async function gotoStage(page: Page, step: number): Promise<void> {
  await page.evaluate(async (s) => {
    const api = (window as unknown as { __straditize?: StraditizeHandle }).__straditize;
    if (!api) throw new Error('window.__straditize 句柄不可用');
    await api.gotoStage(s);
  }, step);
  await expect
    .poll(async () => (await getState<{ stage: number }>(page)).stage, {
      message: `应停在步骤 ${step}`,
      timeout: 15_000,
    })
    .toBe(step);
}

/** 画布元素的布局框（世界坐标换算的锚点）。 */
export async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('#geology-canvas').boundingBox();
  if (!box) throw new Error('#geology-canvas 尚未布局，拿不到 bounding box');
  return box;
}

/** 在画布的相对位置 (rx, ry ∈ [0,1]) 真实点击。 */
export async function clickCanvas(page: Page, rx: number, ry: number): Promise<void> {
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width * rx, b.y + b.height * ry);
}

/** 当前可见的工具按钮顺序（`data-fmode`），隐藏的不计。 */
export async function visibleTools(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.floating-tool-palette button[data-fmode]'))
      .filter((b) => getComputedStyle(b).display !== 'none')
      .map((b) => b.dataset.fmode ?? '')
  );
}

/** 调色板当前高亮的工具；无高亮返回 `null`。 */
export async function paletteActiveTool(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLButtonElement>(
      '.floating-tool-palette button[data-fmode].active-mode'
    );
    return el?.dataset.fmode ?? null;
  });
}

/** 页脚显示的当前工具模式文本。 */
export async function footerToolMode(page: Page): Promise<string> {
  return (await page.locator('#footer-tool-mode').innerText()).trim();
}

/**
 * 当前生效工具的两个独立来源。
 *
 * 二者不一致本身就是缺陷（冷启动时页脚写"选择"而调色板高亮"平移"就是这样被发现的），
 * 所以单独提供这个读取器，让 spec 能把"两处必须一致"写成断言。
 */
export async function activeTool(page: Page): Promise<{ footer: string; palette: string | null }> {
  return { footer: await footerToolMode(page), palette: await paletteActiveTool(page) };
}

/** 断言没有意外弹出原生对话框（前置状态缺失会走这条路）。 */
export function expectNoDialogs(telemetry: PageTelemetry): void {
  expect(
    telemetry.dialogs,
    `应用弹出了原生对话框，通常是前置状态缺失：\n${telemetry.dialogs.join('\n')}`
  ).toEqual([]);
}
