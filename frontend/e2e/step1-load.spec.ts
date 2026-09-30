/**
 * 步骤 1（载入图谱）—— 逐动作可用性排查。
 *
 * ## 为什么需要这一层
 *
 * 步骤 1 的面板只有一个推进按钮，真正的"载入"发生在**顶栏三条入口**：
 * 范例下拉 `#select-sample-diagram`、打开文件 `#btn-open-file`、拖拽到画布。
 * 此前这三条**没有一条 happy path 用例**——已有覆盖只有
 * `e2e.reset` 从后端直接种下的 hoya 基线（`smoke.spec.ts` 的真值 sha256），
 * 以及"上传失败要冒泡"的反向用例（`error-surfacing.spec.ts`）。
 * 也就是说：**菜单项本身能不能用，从来没有被验证过**。
 *
 * 结果就是本文件第一条用例抓到的真实缺陷：下拉里的「验证图谱」指向
 * `verification_real_pollen_edit.png`，而该文件是
 * `scripts/verify_real_pollen_edit.py` 的产物、且被 `.gitignore` 排除，
 * 任何全新克隆都拿不到 —— 选中必定 `-32004 FILE_ERROR`。
 *
 * 判据一律是**后端权威状态**（`getDiagramData` 的 `imageWidth/imageHeight`、
 * `rois`），不是"下拉框里有几项"。
 */
import { expect, test } from './fixtures';
import { diagramData, resetBaseline, rpc } from './helpers';

/** 每个可选项对应的真值尺寸——取自真实样本文件，改动样本即须同步改这里。 */
const SAMPLE_TRUTH: Record<string, [number, number]> = {
  // straditize_core/assets/tutorials/hoya-del-castillo.png
  hoya: [2339, 1654],
  // straditize_core/assets/tutorials/beginner-tutorial.png
  beginner: [1923, 1796],
};

interface ImageState {
  imageWidth: number;
  imageHeight: number;
  rois: Array<{ name?: string; composition?: boolean }>;
}

test.describe('步骤 1 载入：每条入口都必须真的把后端切到那张图', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('范例下拉里的每一个选项都能载入（死选项会在这里变红）', async ({ page, telemetry }) => {
    const values = await page
      .locator('#select-sample-diagram option:not([disabled])')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));

    expect(values.length, '下拉里至少要有 2 个可选项').toBeGreaterThanOrEqual(2);

    // 逐项真载入。各选项真值尺寸互不相同，所以"change 没触发/后端没动"会在下一项暴露。
    for (const key of values) {
      const truth = SAMPLE_TRUTH[key];
      expect(
        truth,
        `下拉出现未知选项 '${key}'：请确认它对应的图片真的随仓库分发，并把真值尺寸登记进 SAMPLE_TRUTH`
      ).toBeDefined();

      await page.selectOption('#select-sample-diagram', key);

      await expect
        .poll(
          async () => {
            const d = await diagramData<ImageState>(page);
            return [d.imageWidth, d.imageHeight];
          },
          { timeout: 30_000, message: `选中范例 '${key}' 后，后端尺寸应变成该图真值 ${truth}` }
        )
        .toEqual(truth);
    }

    expect(telemetry.dialogs, '正常载入范例不该弹任何原生对话框').toEqual([]);
  });

  test('拖拽一张真实 PNG 到画布：后端尺寸必须等于该 PNG 的尺寸', async ({ page, telemetry }) => {
    // 造一张**与基线不同**尺寸的图：若拖拽链路整条静默失效，后端会停在 hoya 基线，
    // 断言立刻变红（用同尺寸图就分辨不出来）。
    const W = 321;
    const H = 123;
    const dataTransfer = await page.evaluateHandle(
      ([w, h]) =>
        new Promise<DataTransfer>((resolve) => {
          const c = document.createElement('canvas');
          c.width = w as number;
          c.height = h as number;
          const g = c.getContext('2d')!;
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = '#000';
          for (let i = 0; i < 40; i++) g.fillRect(8 + i * 7, 15 + (i % 5) * 15, 3, 60);
          c.toBlob((blob) => {
            const file = new File([blob!], 'probe-321x123.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            resolve(dt);
          }, 'image/png');
        }),
      [W, H]
    );

    // 监听器在画布容器上；在画布上派发会让事件冒泡上去。
    await page.locator('#geology-canvas').dispatchEvent('drop', { dataTransfer });

    await expect
      .poll(
        async () => {
          const d = await diagramData<ImageState>(page);
          return [d.imageWidth, d.imageHeight];
        },
        { timeout: 30_000, message: `拖拽 ${W}×${H} 的 PNG 后，后端尺寸应变成 ${W}×${H}` }
      )
      .toEqual([W, H]);

    expect(telemetry.dialogs, '拖拽载入不该弹任何原生对话框').toEqual([]);
  });

  test('载入的副作用：后端自动建一个 composition=True 的 pollen ROI，且能推进到步骤 2', async ({
    page,
  }) => {
    // 这是"载入"最容易被忽略的因果：载入不只换图，还会重设 ROI（session.py 的 _init_rois
    // + 自动 roi_create(composition=True)）。步骤 2 的「组成图」勾选框测的就是它。
    const before = await diagramData<ImageState>(page);
    expect(before.rois.length, '载入后应恰好有一个自动 ROI').toBe(1);
    expect(before.rois[0].name).toBe('pollen');
    expect(before.rois[0].composition, '自动 ROI 必须是 composition=True').toBe(true);

    // 换一张图后仍应回到"恰好一个自动 pollen ROI"，不允许旧 ROI 残留
    await rpc(page, 'core.loadImage', { sample_key: 'beginner' });
    await expect
      .poll(async () => (await diagramData<ImageState>(page)).rois.length, { timeout: 20_000 })
      .toBe(1);

    // 推进按钮真的把工作流推进到步骤 2
    await page.locator('#btn-goto-step2').click();
    await expect(page.locator('.step-panel[data-step="2"]'), '步骤 2 面板应出现').toBeVisible();
  });
});
