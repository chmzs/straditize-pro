/**
 * 步骤面板与阶段工具门禁（每一步都断言**后端因果**，不只是"按钮存在"）。
 *
 * ## 为什么不再写"按钮存在"
 *
 * 旧套件的 `test_cleanup.py` / `test_samples.py` / `test_xticks.py` 三文件
 * 合计 12 条断言，全部形如 `assert data["scan_btn"] == "present"`——面板塌了、
 * 点击后后端毫无反应、工具被错误门禁挡住，这些**都照样通过**。它们能证明的
 * 只有"HTML 里还留着这几个 id"。
 *
 * 这里改成：点真实按钮 → 读**后端权威状态**确认副作用真的发生；能往返的
 * 还要验证"再点另一个按钮能退回去"（单向断言看不出状态卡死）。
 *
 * 阶段工具集取自 `GeologyCanvas.getAllowedTools`（`GeologyCanvas.ts:3016`）：
 * 浮动工具条**只显示**当前步允许的工具，所以"可见集"就是门禁的可见表达。
 * 这条门禁有真实用户反馈背书——源码注释里记着「工具栏缺了微调(S)」。
 */
import { expect, test } from './fixtures';
import {
  canvasBox,
  gotoStage,
  paletteActiveTool,
  resetBaseline,
  rpc,
  visibleTools,
} from './helpers';

interface SamplesList {
  samples: unknown[];
  count: number;
}

test.describe('步骤面板与阶段工具门禁', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('阶段工具门禁：浮动工具条只显示本步允许的工具，默认工具是该步首位', async ({ page }) => {
    // 下表的"可见集"与"激活工具"均为实测值（非推导），因为调色板一共只有
    // 7 个 data-fmode 按钮（addCol/addPoint/eraser/linefix/measure/pan/select）：
    //   - 步骤 2/3 的主工具 roi / ycalib 是**步骤默认模式**而不是调色板按钮
    //     （`GeologyCanvas.ts:2902` 进入该步自动激活），故那两步调色板只剩 pan，
    //     且没有任何按钮处于 active（active=null）。页脚仍显示 "Mode: ROI…/Y-Axis…"，
    //     所以"当前工具"的完整表达需要页脚 + 调色板一起看。
    //   - 步骤 4 的 select 放首位是源码注释里那条真实用户反馈的修复
    //     （「工具栏缺了微调(S)」）。
    const expectations: Record<number, { visible: string[]; active: string | null }> = {
      1: { visible: ['pan'], active: 'pan' },
      2: { visible: ['pan'], active: null },
      3: { visible: ['pan'], active: null },
      4: { visible: ['linefix', 'measure', 'pan', 'select'], active: 'select' },
      5: { visible: ['addCol', 'eraser', 'pan', 'select'], active: 'addCol' },
      6: { visible: ['addCol', 'eraser', 'pan', 'select'], active: 'select' },
      7: { visible: ['addPoint', 'eraser', 'pan', 'select'], active: 'select' },
    };

    for (const [step, want] of Object.entries(expectations)) {
      await gotoStage(page, Number(step));
      const tools = [...(await visibleTools(page))].sort();
      expect(tools, `步骤 ${step} 的可见工具集`).toEqual(want.visible);
      expect(await paletteActiveTool(page), `步骤 ${step} 的默认激活工具`).toBe(want.active);
    }
  });

  test('步骤 4 清理：先清空、再点扫描，候选真的由这个按钮产出', async ({ page }) => {
    await gotoStage(page, 4);
    await expect(page.locator('.step-panel[data-step="4"]')).toBeVisible();
    for (const id of [
      '#btn-detect-candidates',
      '#btn-add-exclusion-rect',
      '#btn-trigger-linefix',
      '#btn-apply-cleanup-next',
    ]) {
      await expect(page.locator(id), `${id} 应存在于步骤 4`).toBeVisible();
    }

    const readCandidates = () =>
      rpc<{ line_candidates: { status: string; kind: string }[] }>(page, 'straditize.getDiagramData');

    const roiId = (await rpc<{ rois: { id: string }[] }>(page, 'straditize.getDiagramData')).rois[0].id;
    // 等待进入步骤 4 时的初始任务落定，显式清空作为因果断言的前提
    await page.waitForTimeout(500);
    await rpc(page, 'algorithm.clearCleanupEdits', { roi_id: roiId });
    await expect
      .poll(async () => (await readCandidates()).line_candidates.length, {
        message: '清空后基线不应有候选几何',
        timeout: 5000,
      })
      .toBe(0);

    // 为了让"这个按钮确实产出了候选"成为**因果**结论，先让后端确有候选、
    // 再清掉、再点按钮：
    //   1) 直接调后端把候选造出来 —— 证明检测能力本身可用
    await rpc(page, 'algorithm.detectLineCandidates', { roi_id: roiId });
    expect((await readCandidates()).line_candidates.length, '后端检测应能产出候选').toBeGreaterThan(0);

    //   2) 清空 —— 证明下面看到的候选只可能来自按钮
    await rpc(page, 'algorithm.clearCleanupEdits', { roi_id: roiId });
    await expect
      .poll(async () => (await readCandidates()).line_candidates.length, {
        message: '清空后应无候选',
        timeout: 5000,
      })
      .toBe(0);

    //   3) 走真实用户路径：点扫描按钮
    await page.click('#btn-detect-candidates');
    await expect
      .poll(async () => (await readCandidates()).line_candidates.length, {
        message: '点击扫描按钮后后端应产生候选几何',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const after = await readCandidates();
    // 刚扫出来的必须仍是"待确认"，不该已经变成"已剔除"
    expect(
      [...new Set(after.line_candidates.map((c) => c.status))],
      '新扫出的候选状态应为 candidate'
    ).toEqual(['candidate']);
    expect(
      after.line_candidates.every((c) => ['A', 'B', 'C'].includes(c.kind)),
      '候选 kind 只能是 A/B/C'
    ).toBe(true);
  });

  test('步骤 4 笔刷：涂抹落库到 line_strokes，两种笔与清空都真的改变后端掩膜', async ({ page }) => {
    // 这条用例钉住的是"笔迹属于**当前**清理模型"这一事实。
    //
    // 旧实现里笔刷把笔迹写进的是**已下线**的档位模型字段（`lineCorrections`），
    // 而当前模型的 `line_strokes` 恒空——两者在类型系统里都"看着正常"，
    // 因为 `?.` 与 `?? []` 把断裂全吃掉了。所以这里一律断言**后端权威状态**：
    // `line_strokes` 真的多了一条、`stats.manual_*_pixels` 真的动起来。
    await gotoStage(page, 4);
    await expect(page.locator('.step-panel[data-step="4"]')).toBeVisible();

    // 三件套缺一不可：旧的擦除/补回/清空按钮死在 Inspector 的死监听里，
    // 只有 id 存在才证明它们被恢复到了**这一步**的面板上。
    for (const id of ['#btn-trigger-linefix', '#btn-linefix-restore', '#btn-linefix-clear']) {
      await expect(page.locator(id), `${id} 应存在于步骤 4`).toBeVisible();
    }

    interface CleanupData {
      line_strokes: { mode: string; radius: number; points: number[][] }[];
      cleanup: { stats: Record<string, number> };
    }
    const read = () => rpc<CleanupData>(page, 'straditize.getDiagramData');
    const roiId = (await rpc<{ rois: { id: string }[] }>(page, 'straditize.getDiagramData')).rois[0].id;

    // 从"没有笔迹"出发，否则下面的"多了一条"可能来自上一轮的残留。
    await rpc(page, 'algorithm.applyLineRemoval', { roi_id: roiId, strokes: [] });
    expect((await read()).line_strokes, '前置：清空后不应有笔迹').toEqual([]);

    // 真实用户路径：点擦除笔 → 在画布上拖一笔 → 松手提交。
    const dragStroke = async (rx0: number, ry0: number) => {
      const b = await canvasBox(page);
      const x = b.x + b.width * rx0;
      const y = b.y + b.height * ry0;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 24, y + 6, { steps: 6 });
      await page.mouse.move(x + 48, y + 12, { steps: 6 });
      await page.mouse.up();
    };

    // 等待条件必须是**统计量本身**，不能是 `line_strokes.length`。
    //
    // `apply_line_removal` 分两阶段落地：先写 `line_strokes`，再跑 `_recompose`
    // ——后者在写入 `cleanup_stats` 之前还要编码一张 overlay PNG（毫秒级）。
    // 只等 `line_strokes` 就会撞进"笔迹已可见、统计还是上一轮"的窗口里读到 0。
    // 本用例最初正是这样假失败的：后端日志显示 `_recompose` 已算出 4424，
    // 而同期的 `getDiagramData` 仍读到上一轮的 0（重放同一笔迹立刻得 4424）。
    const statOf = async (key: string) => (await read()).cleanup.stats[key] ?? 0;

    await page.click('#btn-trigger-linefix');
    await dragStroke(0.35, 0.45);
    await expect
      .poll(() => statOf('manual_erase_pixels'), {
        message: '擦除笔拖一笔后后端 manual_erase_pixels 应大于 0',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const afterErase = await read();
    expect(afterErase.line_strokes.length, '擦除笔落库后应有 1 条笔迹').toBe(1);
    expect(afterErase.line_strokes[0].mode, '擦除笔落库的 mode 必须是 erase').toBe('erase');
    expect(afterErase.line_strokes[0].points.length, '笔迹应是折线（≥1 个点）').toBeGreaterThan(0);
    expect(
      afterErase.cleanup.stats.manual_erase_pixels,
      '擦除笔必须真的改变后端掩膜，而不是只在前端画了一道'
    ).toBeGreaterThan(0);

    // 清空笔迹：只清笔迹，掩膜统计必须跟着回到 0。
    await page.click('#btn-linefix-clear');
    await expect
      .poll(
        async () => {
          const d = await read();
          return [d.line_strokes.length, d.cleanup.stats.manual_erase_pixels ?? 0];
        },
        {
          message: '点「清空笔迹」后 line_strokes 应回到 0 且统计同步归零',
          timeout: 30_000,
        }
      )
      .toEqual([0, 0]);

    // 补回笔：另一种 mode，走的是另一半掩膜通道。
    await page.click('#btn-linefix-restore');
    await dragStroke(0.5, 0.6);
    await expect
      .poll(() => statOf('manual_restore_pixels'), {
        message: '补回笔拖一笔后后端 manual_restore_pixels 应大于 0',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const afterRestore = await read();
    expect(afterRestore.line_strokes.length, '补回笔落库后应有 1 条笔迹').toBe(1);
    expect(afterRestore.line_strokes[0].mode, '补回笔落库的 mode 必须是 restore').toBe('restore');
    expect(
      afterRestore.cleanup.stats.manual_restore_pixels,
      '补回笔必须走上 manual_restore 通道'
    ).toBeGreaterThan(0);
    expect(
      afterRestore.cleanup.stats.manual_erase_pixels,
      '补回笔不该同时增长 manual_erase'
    ).toBe(0);

    // 收尾：把笔迹交还给干净基线，避免污染同文件后续用例。
    await rpc(page, 'algorithm.applyLineRemoval', { roi_id: roiId, strokes: [] });
  });

  test('步骤 6 刻度：检测接口可用，且对本样本不假报刻度', async ({ page }) => {
    await gotoStage(page, 6);
    await expect(page.locator('.step-panel[data-step="6"]')).toBeVisible();
    await expect(page.locator('#btn-detect-xticks')).toBeVisible();
    await expect(page.locator('#btn-apply-xticks-next')).toBeVisible();

    const data = await rpc<{ rois: { id: string }[] }>(page, 'straditize.getDiagramData');
    expect(data.rois.length, '基线应有 ROI').toBeGreaterThan(0);

    // 注意传的是 **ROI id**（不是 column id）。
    const res = await rpc<{ band: unknown; per_column: unknown[] }>(page, 'algorithm.detectXTicks', {
      roi_id: data.rois[0].id,
    });
    expect(Array.isArray(res.per_column), 'per_column 应是数组').toBe(true);

    // hoya 样本**没有刻度尺**（`tests/data/truth/index.json` 的
    // images.hoya.has_tick_ruler=false、ticks=0），所以正确的期望是"不假报刻度"，
    // 而不是"检出刻度"——断言 >0 会是错的期望。这条同时是**无假阳性**回归钉子：
    // 检测器一旦开始对着没有标尺的图谱乱吐齿位，这里立刻失败。
    expect(
      res.per_column.length,
      'hoya 无刻度尺，不应检出任何齿位（真值 has_tick_ruler=false）'
    ).toBe(0);

    // 按钮接线：点下去必须把结果冒泡到用户可见的 HUD
    // （检测是只读的 {band, per_column}；落到 column.x_ticks 需要用户随后做两点标定，
    //   那是另一条路径，不在本测试范围内。）
    await page.click('#btn-detect-xticks');
    await expect
      .poll(async () => (await page.locator('#hud-text').innerText()).trim().length, {
        message: '点击后应给出可见提示',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });

  test('步骤 7 采样：提取 → 清空的往返都能在后端看到', async ({ page }) => {
    await gotoStage(page, 7);
    await expect(page.locator('.step-panel[data-step="7"]')).toBeVisible();
    for (const id of ['#btn-extract-consensus', '#btn-clear-horizons', '#btn-apply-samples-next']) {
      await expect(page.locator(id), `${id} 应存在于步骤 7`).toBeVisible();
    }

    expect((await rpc<SamplesList>(page, 'samples.list')).count, '复位后不应有采样层位').toBe(0);

    // 真实按钮 → 后端真的多出层位
    await page.click('#btn-extract-consensus');
    await expect
      .poll(async () => (await rpc<SamplesList>(page, 'samples.list')).count, {
        message: '提取共识后后端应产生采样层位',
        timeout: 90_000,
      })
      .toBeGreaterThan(0);

    // 真实按钮 → 后端真的被清空（单向断言看不出"清不掉"）
    await page.click('#btn-clear-horizons');
    await expect
      .poll(async () => (await rpc<SamplesList>(page, 'samples.list')).count, {
        message: '清空按钮应把后端层位清回 0',
        timeout: 20_000,
      })
      .toBe(0);
  });
});
