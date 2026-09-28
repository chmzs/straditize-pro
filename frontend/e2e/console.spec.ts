/**
 * 页面加载后浏览器控制台必须零 error。
 *
 * ## 为什么必须在真实浏览器里测
 *
 * 这一类缺陷只有真实浏览器才暴露：`render()` 里对 broken 图片调用 `drawImage`
 * 抛的 `InvalidStateError`、静态资源 404——headless 的 pytest / node 自检一概看不到。
 *
 * 历史（本测试要钉住的两个具体回归点）：
 * * `GeologyCanvas.loadImage` 的 `onerror` 曾把加载失败也标成 `isImageLoaded = true`，
 *   导致 `drawBackgroundDiagram` 对 broken 元素调 `drawImage` 并中断整条 render 管线；
 * * `index.html` 曾没有声明 icon，浏览器回退请求 `/favicon.ico` 得到 404。
 *
 * 这里比旧版多测一条：**零状态**（未载图）也必须零 error。旧版只测了有图状态，
 * 而 broken-image 那条历史缺陷恰恰只在"图没加载好"时触发。
 */
import { expect, test } from '@playwright/test';
import { backendRpc, openApp, watchPage } from './helpers';

function report(errors: string[]): string {
  return `页面加载后出现 ${errors.length} 条控制台 error（headless 测试抓不到这类问题）：\n` +
    errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
}

test.describe('控制台洁净度', () => {
  test('有图状态：基线加载后零 error、零页面异常、零原生弹窗', async ({ page }) => {
    const telemetry = watchPage(page);
    await openApp(page);

    // 等渲染管线真正跑过一帧再下结论，否则只是"还没跑到"
    await page.waitForFunction(() => {
      const api = (window as any).__straditize;
      return api && api.getState().renderedLayers.length > 0;
    }, undefined, { timeout: 30_000 });

    expect(telemetry.consoleErrors, report(telemetry.consoleErrors)).toEqual([]);
    expect(telemetry.dialogs, `出现了原生弹窗：${JSON.stringify(telemetry.dialogs)}`).toEqual([]);
  });

  test('零状态：清空图像后重新加载同样零 error', async ({ page }) => {
    // 先复位到零状态（此时后端没有图像），再挂监听并加载页面
    await backendRpc(page, 'project.new', { clear_image: true });

    const telemetry = watchPage(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__straditize), undefined, {
      timeout: 30_000,
    });
    await page.waitForFunction(() => {
      const api = (window as any).__straditize;
      return api && api.getState().renderedLayers.length > 0;
    }, undefined, { timeout: 30_000 });

    const state = await page.evaluate(() => (window as any).__straditize.getState());
    expect(state.image.width, '前置条件：应是零状态').toBe(0);

    expect(telemetry.consoleErrors, report(telemetry.consoleErrors)).toEqual([]);
    expect(telemetry.dialogs, `出现了原生弹窗：${JSON.stringify(telemetry.dialogs)}`).toEqual([]);
  });
});
