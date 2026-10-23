/**
 * P1-C：默认（建议）取数区可能漏掉底部数据区——必须让用户看见。
 *
 * ## 判据设计（为什么不是"提示元素存在"）
 *
 * 只断言 `#roi-coverage-notice` 存在是**无判别力**的：那个容器在 `render` 阶段
 * 就无条件渲染（它就是承载边缘排除量的那块），无论判定结果是漏、是盖住、还是
 * 判不了，元素都在。所以本套件断言的是**容器上报的判定值**，并与**独立的后端
 * 真值**交叉核对：
 *
 * 1. 先直接调 `algorithm.detectXTicks` 拿后端真实的 `band`，换算轴线行；
 * 2. 再读界面上 `data-roi-coverage` 与 `data-axis-row` / `data-gap-px`；
 * 3. 断言两者**相等**（equality，不是存在性）。
 *
 * 反向对照（把被测行为退回错误实现后判据必须变红）：
 * - 若把提示改成"永远不报漏"（只渲染 covered / unknown），T1 立刻红；
 * - 若把提示改成"永远报漏"（无条件 short-bottom），T2/T3 立刻红。
 * 两个方向都在本文件里各有一条用例，所以判据不是单向的。
 *
 * ## 真实取样
 *
 * 用真实论文图版 `output/han2026_ngamring/fig3_raw.jpeg`（2132×928）：
 * - 建议 ROI `[69,1867]×[266,744]`：真实刻度轴线在 y=869，框底 744 → **漏 125px**；
 * - 手框 `[330,1330]×[233,869]`：框底正好压住轴线 → 盖住，不得报漏。
 */
import { expect, test } from './fixtures';
import { openApp, resetBaseline, rpc } from './helpers';

const FIG3 = 'output/han2026_ngamring/fig3_raw.jpeg';

/**
 * 载入真实图版并推进到步骤 2（数据有效区）。
 *
 * **必须在 `core.loadImage` 之后重新加载页面。** 面板渲染用的是前端镜像
 * （`canvasComponent.data`），而绕过 UI 直调 RPC 只会改后端；镜像仍停在上一次的
 * 图（e2e 后端基线是 hoya）。不重载的话，探针会拿 **fig3 的轴线** 去比
 * **hoya 的框底**——两个不同的图，判据测的就不是同一件事了。
 * 实测踩中：界面报 `covered`，因为 hoya 的框底 1314 确实大于 fig3 的轴线 869。
 */
async function loadFig3AtStep2(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page);
  await rpc(page, 'core.loadImage', { image_path: FIG3 });
  // 重载让前端镜像重新从后端取权威状态（含新图尺寸与建议 ROI）
  await page.reload();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
    undefined,
    { timeout: 45_000 }
  );
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __straditize?: { getState: () => Record<string, unknown> };
      }).__straditize;
      const img = (api?.getState()?.image ?? {}) as { width?: number; height?: number };
      return img.width === 2132 && img.height === 928;
    },
    undefined,
    { timeout: 45_000 }
  );
  await page.evaluate(async () => {
    await (
      window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }
    ).__straditize.gotoStage(2);
  });
}

/** 后端权威的轴线行：`band` 从轴线下方第一行开始，故轴线 = band[0] - 1。 */
async function backendAxisRow(page: import('@playwright/test').Page): Promise<number | null> {
  const res = await rpc<{ band?: number[] | null }>(page, 'algorithm.detectXTicks', {});
  const band = res?.band;
  if (!Array.isArray(band) || band.length === 0 || !Number.isFinite(band[0])) return null;
  return Math.round(band[0] - 1);
}

test.describe('P1-C 建议取数区漏底部数据必须在步骤 2 可见', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 真实图版的建议 ROI：界面必须报「未覆盖完整数据区」，且轴线行/缺口像素与后端真值相等', async ({
    page,
  }) => {
    await loadFig3AtStep2(page);

    // 建议 ROI 的底边（真实值 744）
    const data = await rpc<{
      rois: Array<{ id: string; xlim: number[]; ylim: number[] }>;
      active_roi_id: string;
    }>(page, 'straditize.getDiagramData', {});
    const active = data.rois.find((r) => r.id === data.active_roi_id) || data.rois[0];
    const roiBottom = Math.round(active.ylim[1]);
    expect(roiBottom).toBe(744);

    const axis = await backendAxisRow(page);
    expect(axis).not.toBeNull();

    const notice = page.locator('#roi-coverage-notice');
    await expect(notice).toHaveAttribute('data-roi-coverage', 'short-bottom', { timeout: 20_000 });

    // equality：界面报的轴线行 / 框底 / 缺口，必须等于后端真值算出来的同一组数
    await expect(notice).toHaveAttribute('data-axis-row', String(axis));
    await expect(notice).toHaveAttribute('data-roi-bottom', String(roiBottom));
    await expect(notice).toHaveAttribute('data-gap-px', String(axis! - roiBottom));

    // 文案必须说清三件事：漏了、漏多少、怎么修（不是一句泛泛的"可能有问题"）
    const text = (await notice.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('未覆盖完整数据区');
    expect(text).toContain(String(axis)); // 轴线行
    expect(text).toContain(String(roiBottom)); // 框底行
    expect(text).toContain(`${axis! - roiBottom}px`); // 缺口像素
    expect(text).toContain('拖'); // 可操作修法

    // 边缘排除量是纯算术，必须也在（让用户能自己判断框得对不对）
    expect(text).toMatch(/左 \d+px/);
    expect(text).toMatch(/下 \d+px/);
  });

  test('T2 反向对照：框底压住轴线后，界面必须改口为「已覆盖」，不得继续报漏', async ({ page }) => {
    await loadFig3AtStep2(page);
    const data = await rpc<{ active_roi_id: string }>(page, 'straditize.getDiagramData', {});
    const axis = await backendAxisRow(page);
    expect(axis).not.toBeNull();

    // 把框底拖到轴线以下（手框 [330,1330]×[233,869]，869 正好压住 y=869 的轴线）
    await rpc(page, 'roi.update', {
      roi_id: data.active_roi_id,
      xlim: [330, 1330],
      ylim: [233, axis!],
    });
    // 重载让前端镜像跟上后端的新框（同上：镜像不会因绕过 UI 的 RPC 自动刷新）
    await page.reload();
    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __straditize?: { getState: () => Record<string, unknown> };
        }).__straditize;
        const rois = (api?.getState()?.rois ?? []) as Array<{ ylim?: number[] }>;
        return rois[0]?.ylim?.[1] === 869;
      },
      undefined,
      { timeout: 45_000 }
    );
    await page.evaluate(async () => {
      await (
        window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }
      ).__straditize.gotoStage(2);
    });

    const notice = page.locator('#roi-coverage-notice');
    await expect(notice).toHaveAttribute('data-roi-coverage', 'covered', { timeout: 20_000 });
    await expect(notice).toHaveAttribute('data-axis-row', String(axis));
    await expect(notice).toHaveAttribute('data-roi-bottom', String(axis));
    const text = await notice.innerText();
    expect(text).toContain('已覆盖横轴刻度线');
    expect(text).not.toContain('未覆盖完整数据区');
  });

  test('T3 反向对照：没有刻度尺的图不得报漏（判不了就说判不了，不许假报警）', async ({ page }) => {
    await openApp(page);
    await rpc(page, 'core.loadImage', { sample_key: 'hoya' });
    await page.evaluate(async () => {
      await (window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }).__straditize.gotoStage(2);
    });

    // 后端对 hoya 确实检不到刻度尺——先钉住这个前提，否则本用例测的不是"无尺"场景
    expect(await backendAxisRow(page)).toBeNull();

    const notice = page.locator('#roi-coverage-notice');
    await expect(notice).toHaveAttribute('data-roi-coverage', 'unknown', { timeout: 20_000 });
    const text = await notice.innerText();
    expect(text).toContain('未检测到横轴刻度线');
    expect(text).not.toContain('未覆盖完整数据区');
  });
});
