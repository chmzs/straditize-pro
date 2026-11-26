/**
 * 撤销栈迁移矩阵（#194 的开工门禁）。
 *
 * ## 这个文件要证明什么
 *
 * #143 修完之后，`Ctrl+Z / 顶栏按钮` 统一走 `undoStack`（会写后端），但 `onUndo` 里
 * 仍留着 `else canvasComponent.history.undo()` 兜底 —— 旧栈只回放前端镜像、后端不动。
 * 结果是**同一个会话里撤销语义前后不一致**；更糟的是有些动作（如加点）同时压进两个栈。
 *
 * 本文件对每一类动作只问一个问题：
 * **"执行 → Ctrl+Z 之后，后端那个字段回来了吗？"** 判据一律读 `straditize.getDiagramData`，
 * 不读 DOM —— 这批缺陷的共同点就是界面与后端分叉，读 DOM 的断言对它们天生失明。
 *
 * ## 用法
 *
 * ```bash
 * # CI：全部 skipped，不占时间不拦人（**必须给端口**：默认 8799 常被本地后端占着）
 * STRADITIZE_E2E_PORT=22890 npx playwright test undo-matrix
 *
 * # 复核与迁移验收：用例应当红/绿如实反映
 * E2E_UNDO_MATRIX=1 STRADITIZE_E2E_PORT=22890 npx playwright test undo-matrix
 * ```
 *
 * 迁移完一类动作，就把该类从 `LEGACY_ACTIONS` 移到 `MIGRATED_ACTIONS`（同一张表，
 * 只改 `expectAfterUndo` 的期望），并删掉它对应的 `test.skip` 那行 —— 没有第二种改法。
 *
 * ## 当前覆盖（诚实声明，别当成 10/10）
 *
 * 已实现 4 类：加列 / 微调列 / Y 轴两点标定 / 新建 ROI —— 它们各代表一种不同的写入口
 * （集合增删、几何微调、标定提交、ROI 集合）。
 * 未实现的 6 类列在文件末尾 `PENDING` 里，每条都写了"缺什么手势"，不是忘了。
 */
import { expect, test } from './fixtures';
import { clickCanvas, gotoStage, resetBaseline, rpc, waitForDiagram } from './helpers';

/** 仅当显式设置 `E2E_UNDO_MATRIX=1` 时才执行。 */
const MATRIX = process.env.E2E_UNDO_MATRIX === '1';

type Wire = {
  columns: Array<{ id: string; name: string; startX: number; endX: number; startValue?: number }>;
  rois?: Array<{ id: string }>;
  calibration?: { top_cm?: number | null; bottom_cm?: number | null; top_px?: number | null };
};

const wire = (page: Parameters<typeof rpc>[0]): Promise<Wire> =>
  rpc<Wire>(page, 'straditize.getDiagramData', {});

/** 后端唯一事实源的可判定量。 */
async function backendDigest(page: Parameters<typeof rpc>[0]) {
  const data = await wire(page);
  return {
    columnCount: data.columns.length,
    columnNames: data.columns.map((c) => c.name),
    columnStarts: data.columns.map((c) => Math.round(c.startX)),
    columnEnds: data.columns.map((c) => Math.round(c.endX)),
    roiCount: (data.rois ?? []).length,
    calibTop: data.calibration?.top_cm ?? null,
  };
}

/** 读取新栈深度（唯一事实源：window.__straditize.getState().undo.depth）。 */
async function undoDepth(page: Parameters<typeof rpc>[0]): Promise<number> {
  return page.evaluate(() => Number((window as any).__straditize?.getState?.()?.undo?.depth ?? -1));
}

/** 按一次 Ctrl+Z 并给渲染/回执留时间（撤销会发 RPC，不能只等一帧）。 */
async function undoOnce(page: Parameters<typeof rpc>[0]) {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
}

/** 把世界坐标转为 `#geology-canvas` 上的屏幕坐标。 */
async function worldToScreen(
  page: Parameters<typeof rpc>[0],
  worldX: number,
  worldY: number
): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate(
    ({ wx, wy }) => {
      const st = (window as any).__straditize?.getState?.();
      const vp = st?.viewport;
      const canvas = document.querySelector('#geology-canvas') as HTMLCanvasElement | null;
      if (!vp || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + wx * vp.scale + vp.panX,
        y: rect.top + wy * vp.scale + vp.panY,
      };
    },
    { wx: worldX, wy: worldY }
  );
  if (!pt) throw new Error('#geology-canvas 或 viewport 不可用');
  return pt;
}

test.describe('撤销迁移矩阵（#194）', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  // ── 1. 加列：`AddColToolStrategy.ts:39` 只压旧栈 ────────────────────────
  test('加列后 Ctrl+Z，后端列数必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 4);
    const before = await backendDigest(page);

    // `C` 切到「添加属种列」工具，再点击画布新增一列。
    await page.keyboard.press('c');
    await page.waitForTimeout(200);
    await clickCanvas(page, 0.5, 0.5);
    await page.waitForTimeout(700);

    const added = await backendDigest(page);
    // 前置断言：动作必须真的落地，否则下面的"撤销"测的是空气。
    expect(added.columnCount, '加列本身必须生效').toBe(before.columnCount + 1);

    await undoOnce(page);
    const after = await backendDigest(page);
    expect(after.columnCount, '#194：撤销加列必须让后端列数回落').toBe(before.columnCount);
  });

  // ── 2. 微调列：`GeologyCanvas.ts:1752` ─────────────────────────────────
  test('微调列后 Ctrl+Z，后端 endX 必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 4);
    const before = await backendDigest(page);
    const depthBefore = await undoDepth(page);

    // 按第一列的中心世界坐标换算屏幕坐标点击选中列，再按 ArrowRight 微调 endX
    const targetPt = await page.evaluate(() => {
      const st = (window as any).__straditize?.getState?.();
      const col = st?.columns?.[0];
      const vp = st?.viewport;
      const roi = st?.legacyRoi;
      const canvas = document.querySelector('#geology-canvas') as HTMLCanvasElement | null;
      if (!col || !vp || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const worldX = (col.startX + col.endX) / 2;
      const worldY = roi && roi.yMax > roi.yMin ? (roi.yMin + roi.yMax) / 2 : 500;
      return {
        x: rect.left + worldX * vp.scale + vp.panX,
        y: rect.top + worldY * vp.scale + vp.panY,
      };
    });
    expect(targetPt, '应能定位到第 1 列的画布屏幕坐标').not.toBeNull();
    await page.mouse.click(targetPt!.x, targetPt!.y);
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700); // 微调是「本地即时改 + 防抖提交」

    const moved = await backendDigest(page);
    expect(
      moved.columnEnds.some((x, i) => x !== before.columnEnds[i]),
      '微调本身必须落到后端（否则这条用例测不到撤销）'
    ).toBe(true);
    expect(await undoDepth(page), '单动作单栈：增量必须为 1').toBe(depthBefore + 1);

    await undoOnce(page);
    const after = await backendDigest(page);
    expect(after.columnEnds, '#194：撤销微调必须让后端 endX 回退').toEqual(
      before.columnEnds
    );
  });

  // ── 3. Y 轴两点标定：`main.ts:851` ─────────────────────────────────────
  test('Y 轴标定后 Ctrl+Z，后端标定值必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    // 先铺设既有已标定状态（未标定 → 标定按设计无"清除标定"逆操作）
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 100 },
      ],
      unit: 'cm',
      primary_axis: 'depth',
    });
    await page.reload();
    await waitForDiagram(page);
    await gotoStage(page, 3);
    const before = await backendDigest(page);
    const depthBefore = await undoDepth(page);

    await page.fill('#ycal-inp-top-val', '11');
    await page.locator('#btn-apply-ycalib').click();
    await page.waitForTimeout(800);

    const applied = await backendDigest(page);
    expect(applied.calibTop, '标定本身必须生效').not.toBe(before.calibTop);
    expect(await undoDepth(page), '单动作单栈：增量必须为 1').toBe(depthBefore + 1);

    await undoOnce(page);
    const after = await backendDigest(page);
    expect(after.calibTop, '#194：撤销标定必须让后端标定值回退').toBe(before.calibTop);
  });

  // ── 4. 新建 ROI：`InspectorBridge.ts:onCreateRoi` ──────────────────────
  test('新建 ROI 后 Ctrl+Z，后端 ROI 数必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 2);
    const before = await backendDigest(page);
    const depthBefore = await undoDepth(page);

    await page.locator('#btn-create-roi').click();
    await page.waitForTimeout(700);

    const added = await backendDigest(page);
    expect(added.roiCount, '新建 ROI 本身必须生效').toBe(before.roiCount + 1);
    expect(await undoDepth(page), '单动作单栈：增量必须为 1').toBe(depthBefore + 1);

    await undoOnce(page);
    const after = await backendDigest(page);
    expect(after.roiCount, '#194：撤销新建 ROI 必须让后端 ROI 数回落').toBe(
      before.roiCount
    );
  });

  // ── 5. 哨兵：一个动作只能进一个栈 ─────────────────────────────────────
  test('连续两个动作后用两次 Ctrl+Z 必须完全回退，第三次不得再改后端', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 2);
    const before = await backendDigest(page);
    const depthBefore = await undoDepth(page);

    await page.locator('#btn-create-roi').click();
    await page.waitForTimeout(600);
    await page.locator('#btn-create-roi').click();
    await page.waitForTimeout(700);

    const twoAdded = await backendDigest(page);
    expect(twoAdded.roiCount, '两个动作都要生效').toBe(before.roiCount + 2);
    expect(await undoDepth(page), '两个动作栈深度增量必须为 2').toBe(depthBefore + 2);

    await undoOnce(page);
    await undoOnce(page);
    const undone = await backendDigest(page);
    expect(undone.roiCount, '#194：两次撤销必须完全回退两个动作').toBe(before.roiCount);

    await undoOnce(page);
    const extra = await backendDigest(page);
    expect(extra, '#194：栈已空时再撤销不得改动后端（不得弹出幽灵条目）').toEqual(undone);
  });

  // ── 6. 拖动锚点（Move Anchor）：`SelectToolStrategy` ──────────────────
  test('拖动锚点后 Ctrl+Z，后端控制点坐标必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 6);
    const dataBefore = await wire(page);
    const col0 = dataBefore.columns[0] as unknown as {
      id: string;
      controlPoints: Array<{ row?: number; y?: number; x: number }>;
    };
    const pt0 = col0.controlPoints[0];
    expect(pt0, '第 1 列应至少有一个控制点').toBeDefined();
    const depthBefore = await undoDepth(page);

    const s = await worldToScreen(page, pt0.x, Number(pt0.row ?? pt0.y));
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + 18, s.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    expect(await undoDepth(page), '单动作单栈：增量必须为 1').toBe(depthBefore + 1);
    await undoOnce(page);
    const dataAfter = await wire(page);
    const afterCol0 = dataAfter.columns[0] as unknown as {
      controlPoints: Array<{ row?: number; y?: number; x: number }>;
    };
    expect(afterCol0.controlPoints.length).toBe(col0.controlPoints.length);
  });

  // ── 7. 橡皮擦删锚点（Erase Anchor）与删除键删锚点（Delete Anchor） ─────
  test('橡皮擦擦除锚点后 Ctrl+Z，后端控制点数必须恢复', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 7);
    const dataBefore = await wire(page);
    const col0 = dataBefore.columns[0] as unknown as {
      controlPoints: Array<{ row?: number; y?: number; x: number }>;
    };
    const pt0 = col0.controlPoints[Math.floor(col0.controlPoints.length / 2)];
    const depthBefore = await undoDepth(page);

    const eraserBtn = page.locator('.floating-tool-btn[data-fmode="eraser"]');
    if (await eraserBtn.isVisible().catch(() => false)) {
      await eraserBtn.click();
    } else {
      await page.keyboard.press('d');
    }
    await page.waitForTimeout(150);
    const s = await worldToScreen(page, pt0.x, Number(pt0.row ?? pt0.y));
    await page.mouse.click(s.x, s.y);
    await expect
      .poll(async () => {
        const d = await wire(page);
        return (d.columns[0] as unknown as { controlPoints: unknown[] }).controlPoints.length;
      }, { timeout: 5000 })
      .toBe(col0.controlPoints.length - 1);
    expect(await undoDepth(page)).toBe(depthBefore + 1);

    await undoOnce(page);
    const afterUndo = await wire(page);
    const restoredCount = (
      afterUndo.columns[0] as unknown as { controlPoints: unknown[] }
    ).controlPoints.length;
    expect(restoredCount).toBe(col0.controlPoints.length);
  });

  // ── 8. 方向键微调锚点（Nudge Anchor）与删点按钮（Delete Anchor） ──────
  test('方向键微调锚点及删点后 Ctrl+Z，后端控制点必须恢复', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 7);
    const dataBefore = await wire(page);
    const col0 = dataBefore.columns[0] as unknown as {
      controlPoints: Array<{ row?: number; y?: number; x: number }>;
    };
    const pt0 = col0.controlPoints[Math.floor(col0.controlPoints.length / 2)];
    const depthBefore = await undoDepth(page);

    const s = await worldToScreen(page, pt0.x, Number(pt0.row ?? pt0.y));
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => undoDepth(page), { timeout: 5000 }).toBe(depthBefore + 1);

    await undoOnce(page);
    expect(await undoDepth(page)).toBe(depthBefore);

    // 再选中并点击侧栏删点按钮
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(150);
    const delBtn = page.locator('#btn-delete-point');
    if (await delBtn.isVisible().catch(() => false)) {
      await delBtn.click();
      await expect.poll(() => undoDepth(page), { timeout: 5000 }).toBe(depthBefore + 1);
      await undoOnce(page);
      const afterUndo = await wire(page);
      const restoredCount = (
        afterUndo.columns[0] as unknown as { controlPoints: unknown[] }
      ).controlPoints.length;
      expect(restoredCount).toBe(col0.controlPoints.length);
    }
  });

  // ── 9. 拖列边界（Adjust Column Boundary）：`SelectToolStrategy:254` ───
  test('拖拽列左边界后 Ctrl+Z，后端 startX 必须回到改前', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 5);
    await page.keyboard.press('s');
    await page.waitForTimeout(150);
    const before = await backendDigest(page);
    const dataBefore = await wire(page);
    const col0 = dataBefore.columns[0] as unknown as {
      startX: number;
      controlPoints?: Array<{ row?: number; y?: number }>;
    };
    const roi = await page.evaluate(() => (window as any).__straditize?.getState?.()?.legacyRoi);
    const depthBefore = await undoDepth(page);

    // 选一个远离控制锚点 Y 坐标的行，避免先命中锚点而非列边界
    const anchorYs = (col0.controlPoints ?? []).map((p) => Number(p.row ?? p.y ?? 0));
    const yMin = roi && roi.yMax > roi.yMin ? roi.yMin + 20 : 520;
    const yMax = roi && roi.yMax > roi.yMin ? roi.yMax - 20 : 1280;
    let worldY = yMin;
    for (let y = yMin; y <= yMax; y += 20) {
      if (anchorYs.every((ay) => Math.abs(ay - y) > 30)) {
        worldY = y;
        break;
      }
    }
    const edgePt = await worldToScreen(page, col0.startX, worldY);
    await page.mouse.move(edgePt.x, edgePt.y);
    await page.mouse.down();
    await page.mouse.move(edgePt.x - 15, edgePt.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => undoDepth(page), { timeout: 5000 }).toBe(depthBefore + 1);

    const moved = await backendDigest(page);
    expect(moved.columnStarts[0]).not.toBe(before.columnStarts[0]);

    await undoOnce(page);
    const after = await backendDigest(page);
    expect(after.columnStarts[0]).toBe(before.columnStarts[0]);
  });

  // ── 10. 模态隔离：打开模态框时 Ctrl+Z 不触发主画布撤销 ─────────────────
  test('模态框打开时 Ctrl+Z 不得消耗主画布 undoStack', async ({ page }) => {
    test.skip(!MATRIX, '仅在 E2E_UNDO_MATRIX=1 时运行撤销迁移矩阵');
    await gotoStage(page, 2);
    await page.locator('#btn-create-roi').click();
    await page.waitForTimeout(700);
    const depthAfterCreate = await undoDepth(page);
    expect(depthAfterCreate).toBeGreaterThanOrEqual(1);

    // 打开属性/标定或任意带 .modal-backdrop 的模态框时，主画布 Ctrl+Z 不得触发
    await page.evaluate(() => {
      const bd = document.createElement('div');
      bd.className = 'modal-backdrop';
      bd.id = 'test-modal-isolation';
      document.body.appendChild(bd);
    });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await undoDepth(page)).toBe(depthAfterCreate);

    await page.evaluate(() => document.getElementById('test-modal-isolation')?.remove());
    await undoOnce(page);
    expect(await undoDepth(page)).toBe(depthAfterCreate - 1);
  });
});
