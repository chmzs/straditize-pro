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
 *
 * 监听（控制台 error / 未捕获异常 / 失败的 RPC / 原生弹窗）由本文件的 `watchPage`
 * 采集，**门禁断言**则统一放在 `fixtures.ts` 的 auto fixture 里 —— 见那里的说明，
 * 用例不再各自手写监听。
 */
import { expect, type Page } from '@playwright/test';

/** 应用对外句柄的形状（`window.__straditize`）。 */
export interface StraditizeHandle {
  getState: () => Record<string, unknown>;
  gotoStage: (step: number) => Promise<void>;
  rpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

export interface PageTelemetry {
  /** 控制台 error 文本 + 未捕获异常（`pageerror:` 前缀），按出现顺序。 */
  consoleErrors: string[];
  /** 失败的 JSON-RPC 响应（`方法名 [码] 消息`）；前端自己发起的也算。 */
  rpcErrors: string[];
  /**
   * 用户可见的通知文本，按出现顺序。
   *
   * 本通道**合并两类**来源，因为它们对用户是同一件事："界面打断你，告诉你一件事"：
   *
   * 1. 原生对话框（`window.confirm` / `window.prompt` 仍是原生的）；
   * 2. 应用内通知通道（`src/ui/feedback.ts` 的 `notify()` toast、
   *    `#rpc-error-modal` 后端失败详情弹窗、`#ui-detail-modal` 详情弹窗）。
   *
   * 合并的理由见下方 `watchPage` 注释：门禁要守的是"正常流程里用户不该被
   * 意外通知打断"，通道换了不该出现覆盖空洞。
   */
  notices: string[];
}

/**
 * 在 `goto` **之前**挂上控制台、网络与用户通知监听。
 *
 * ## 为什么通知通道是"合并采集"的
 *
 * 历史上本应用**没有**应用内通知通道，用户可见的报错一律是 `window.alert`，
 * 所以本文件只监听 `page.on('dialog')`。现在 `src/ui/feedback.ts` 提供了
 * `notify()`（非阻塞 toast）与 `showDetailModal()`（可复制详情），
 * `main.ts:reportBackendFailure` 也从 `alert` 改为「toast + 可复制详情弹窗」。
 *
 * 如果继续只监听原生 dialog，那个门禁会**静默失去全部覆盖**：alert 迁移到 toast 后
 * `dialogs` 恒为空，"用户被打断"再也测不出来。所以这里把应用内通知也采集成
 * `notices`；同时保留原生 dialog 采集——`confirm` / `prompt` 仍是原生的。
 *
 * 采集方式：`addInitScript` 在页面脚本之前装一个 `MutationObserver`（因此在任何
 * `goto` 之前、也跨导航存活），命中即通过 `exposeFunction` 把文本发回 Node 侧。
 * 这样即使 toast 4 秒后自行消失，文本也已经留在遥测里。
 *
 * 原生对话框必须显式接管：Playwright 默认会自动 dismiss，但那样测试只看到一个
 * 卡住或语义不明的失败；这里把文本留下来，失败信息才指向真正的原因。
 *
 * RPC 失败必须读 **body** 而不是只看 status：本后端的 JSON-RPC 错误是
 * `HTTP 200 + body.error`（见下方 `backendRpc`），只看 status 会漏掉全部应用级
 * 错误。判断"前端自己发起的请求是否异常"正是 E2E 的职责之一。
 *
 * 这里**一律如实记录，不做豁免过滤** —— 豁免是门禁策略，统一在 `fixtures.ts`
 * 的 teardown 里判定。分开的理由：过滤若散在采集侧，"这条为什么没报"就变成
 * 要看两处才能回答；集中在一处，`test.use({ allowlists: { notice: [...] } })` 就是唯一答案。
 */
export async function watchPage(page: Page): Promise<PageTelemetry> {
  const telemetry: PageTelemetry = { consoleErrors: [], rpcErrors: [], notices: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') telemetry.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => telemetry.consoleErrors.push(`pageerror: ${err.message}`));
  page.on('dialog', (dialog) => {
    telemetry.notices.push(dialog.message());
    void dialog.dismiss();
  });

  // 应用内通知通道：initScript 装的观察器把文本回传到 Node 侧的数组。
  await page.exposeFunction('__e2eRecordNotice', (text: unknown) => {
    const clean = String(text ?? '').trim();
    if (clean) telemetry.notices.push(clean);
  });
  await page.addInitScript(() => {
    // `.ui-toast` 是非阻塞提示；两个 `#…-modal` 是带详情的应用内弹窗。
    const SELECTOR = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
    const record = (el: Element): void => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      const fn = (
        window as unknown as { __e2eRecordNotice?: (value: string) => void }
      ).__e2eRecordNotice;
      if (typeof fn === 'function') fn(text);
    };
    // 按元素去重，每批 addedNodes 重置一次。`notify()` 先把 `.ui-toast-host` 挂到
    // body、再把 `.ui-toast` 挂进 host，两者落在**同一批** addedNodes 里：host 的
    // `querySelectorAll` 与 toast 自身会各命中一次，一次通知就会被算成两条。
    let recorded = new WeakSet<Element>();
    const recordOnce = (el: Element): void => {
      if (recorded.has(el)) return;
      recorded.add(el);
      record(el);
    };
    const scan = (node: Node): void => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (el.matches(SELECTOR)) recordOnce(el);
      el.querySelectorAll(SELECTOR).forEach(recordOnce);
    };
    const start = (): void => {
      scan(document.documentElement);
      new MutationObserver((records) => {
        recorded = new WeakSet<Element>();
        for (const rec of records) rec.addedNodes.forEach(scan);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
  page.on('response', (res) => {
    if (!res.url().includes('/rpc')) return;
    void res
      .json()
      .then((body: unknown) => {
        const err = (body as { error?: { code?: number; message?: string } } | null)?.error;
        if (!err) return;
        telemetry.rpcErrors.push(
          `${res.request().postDataJSON?.()?.method ?? '?'} [${err.code ?? '?'}] ${err.message ?? ''}`
        );
      })
      .catch(() => {
        /* 非 JSON 响应不参与本门禁 */
      });
  });
  return telemetry;
}

/** 打开应用并等到画布与句柄就绪（不等数据）。 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
    undefined,
    { timeout: 45_000 }
  );
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
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
    { timeout: 45_000 }
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

/** `canvasInk()` 的返回：画布上"真的落了墨"的像素统计。 */
export interface CanvasInk {
  /** 画布像素尺寸 `[width, height]`。 */
  size: [number, number];
  /** 不透明像素数；底图铺满整幅时应等于 `size[0] * size[1]`。 */
  opaque: number;
  /** 非白的不透明像素数，即整幅"墨迹"总量。 */
  ink: number;
}

/**
 * 读画布像素，统计"墨迹"。
 *
 * ## 为什么需要它：`renderedLayers` 会被骗
 *
 * `step-visibility.spec.ts` 比对的是 `renderedLayers` —— 它只证明某个
 * `drawXxx()` 被**调用过**（且返回真 / 叠加层没抛异常），**不证明它真的往画布上
 * 落了墨**。一个提前 `return` 或算错坐标的绘制函数，在这套结构断言下完全隐形：
 * 层名照样进集合，用户屏幕上却什么都没有。
 *
 * `#geology-canvas` 是普通 2D canvas（`GeologyCanvas.ts:174` 取 `'2d'` 上下文），
 * 所以 `getImageData` 直接可用，不需要任何依赖、也不需要存基线图。
 *
 * ## 用不等式，不用绝对值
 *
 * 实测同一进程内连测两轮，`ink` 有约 1% 的轮间抖动（底图重绘 / 抗锯齿），
 * 但层与层之间的差是 ~19 万像素量级、噪声只有 ~1700 —— 信噪比约 100×。
 * 所以断言一律写成**步骤之间的不等式**（带余量），绝不写绝对值：
 * 绝对值既会因抖动误报，又会因换台机器/换浏览器而失效。
 */
export async function canvasInk(page: Page): Promise<CanvasInk> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#geology-canvas');
    if (!canvas) throw new Error('#geology-canvas 不存在，无法读画布墨迹');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('#geology-canvas 拿不到 2d 上下文');
    const { width, height } = canvas;
    const d = ctx.getImageData(0, 0, width, height).data;
    let opaque = 0;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      opaque++;
      if (!(d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250)) ink++;
    }
    return { size: [width, height] as [number, number], opaque, ink };
  });
}

/**
 * 数画布上近似等于某**特征色**的不透明像素个数。
 *
 * `canvasInk()` 只能回答"整幅有没有变化"，回答不了"**这一层**有没有画"。
 * 把某一层的特征色（见 `GeologyCanvas` 各 `drawXxx` 里的描边色）单独拎出来计数，
 * 就得到了针对该层的探针：**该出现时必须 > 0，不该出现时必须为 0** —— 后者是
 * 负向对照，证明这个探针不是恒真。
 *
 * 实测（hoya 基线）：
 *   - `#0284c7` ROI 蓝：步骤 1 = 0，步骤 3 = 7665（`roi` 层从无到有）；
 *   - `#f59e0b` Y 标定橙：点两点前 = 0，点完两点后 = 411。
 *
 * 容差默认 24：`drawYAxisCalibration` 等用纯色描边，但抗锯齿会让边缘像素偏移。
 */
export async function canvasColorPixels(
  page: Page,
  rgb: [number, number, number],
  tolerance = 24
): Promise<number> {
  return page.evaluate(
    ([r, g, b, tol]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#geology-canvas');
      if (!canvas) throw new Error('#geology-canvas 不存在，无法读画布像素');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('#geology-canvas 拿不到 2d 上下文');
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        if (
          Math.abs(d[i] - r) <= tol &&
          Math.abs(d[i + 1] - g) <= tol &&
          Math.abs(d[i + 2] - b) <= tol
        ) {
          n++;
        }
      }
      return n;
    },
    [rgb[0], rgb[1], rgb[2], tolerance] as const
  );
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
