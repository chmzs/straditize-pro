/**
 * 年代-深度模型视觉检查与解译弹窗 (AgeDepthModal) 真实 E2E 门禁。
 *
 * 验证链条：
 * 1. 点击顶栏 #btn-age-depth-modal 打开年代-深度模型弹窗；
 * 2. 点击 #ad-btn-center-bacon 载入内置 Bacon 年代图谱（触发 agedepth.loadModelDiagram + /image/agedepth 真图像加载）；
 * 3. 验证 4 个标定点自动就位、#ad-calib-values 标定值面板可见（3000 -> 0 cal BP, 0 -> 150 cm）；
 * 4. 点击 #ad-btn-extract 执行真实逐行年代曲线与 95% 置信包络提取（agedepth.extractAndInspect），
 * 断言 #ad-status-msg 显示 "识别成功"、预览表格 #ad-mapping-tbody 渲染出层位年代与沉积速率；
 * 5. 点击 #ad-btn-apply 关联至花粉图谱，断言后端 ensemble.list 已注册 1000 条集合实现表，
 *    且 core.exportData 与 export.exportLipd 真实包含 age_est / age_min_95 / age_max_95 与 chronEnsembleTable。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

test.describe('AgeDepthModal (年代-深度模型与不确定性集合模块) E2E', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 载入 Bacon 年代图 → 四点标定与曲线/包络提取 → 生成 1000 集合并关联花粉导出', async ({
    page,
  }) => {
    await gotoStage(page, 7);

    // 先在主会话完成 Y 轴深度标定（0 -> 150 cm）并提取采样层位，以便年代模型映射花粉样品
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 150 },
      ],
      unit: 'cm',
    });
    await rpc(page, 'samples.set', {
      samples: [
        { row_px: 600, depth: 16.6875, source: 'manual' },
        { row_px: 900, depth: 72.9375, source: 'manual' },
      ],
    });

    // 1. 打开年代-深度模型弹窗
    await page.locator('#btn-age-depth-modal').click();
    const dialog = page.locator('.agedepth-dialog');
    await expect(dialog).toBeVisible();

    // 2. 点击【Hoya Bacon 范例】载入真实年代图谱
    await dialog.locator('#ad-btn-center-bacon').click();

    // 等待 /image/agedepth 图像加载完成并种子化 4 个标定点
    await expect(dialog.locator('#ad-current-source-label')).toHaveText('范例: BACON', {
      timeout: 10_000,
    });
    await expect(dialog.locator('#ad-calib-values')).toBeVisible();
    await expect(dialog.locator('#ad-calib-hint')).toContainText('四点已落位');

    // 3. 点击【③ 运行识别并叠加视觉校对】触发真实提取
    await dialog.locator('#ad-btn-extract').click();

    const statusMsg = dialog.locator('#ad-status-msg');
    await expect(statusMsg).toContainText('识别成功', { timeout: 20_000 });

    // 断言映射预览表渲染出真实深度与年代行
    const tbodyRows = dialog.locator('#ad-mapping-tbody tr');
    expect(await tbodyRows.count()).toBeGreaterThan(0);

    // 断言解译质量诊断卡片可见且显示质量评级
    const qcCard = dialog.locator('#ad-quality-card');
    await expect(qcCard).toBeVisible();
    await expect(dialog.locator('#ad-qc-badge')).toContainText('质量优良');

    // 4. 点击【确认无误，关联至花粉图谱】
    await dialog.locator('#ad-btn-apply').click();
    await expect(dialog).toHaveCount(0);

    // 5. 断言后端 ensemble.list 已生成 Bacon_Ensemble_1000 集合表
    const ensList = await rpc<{ count: number; tables: Array<{ name: string; rows: number }> }>(
      page,
      'ensemble.list'
    );
    expect(ensList.count).toBeGreaterThanOrEqual(1);
    expect(ensList.tables.map((t) => t.name)).toContain('Bacon_Ensemble_1000');

    // 6. 断言后端 core.exportData 导出的 CSV 包含 age_est, age_min_95, age_max_95 列
    const csvExport = await rpc<{ columns: string[]; data: Array<Record<string, number>> }>(
      page,
      'core.exportData',
      { format: 'csv' }
    );
    expect(csvExport.columns).toContain('age_est');
    expect(csvExport.columns).toContain('age_min_95');
    expect(csvExport.columns).toContain('age_max_95');
    expect(csvExport.data[0].age_est).toBeGreaterThan(0);
    expect(csvExport.data[0].age_max_95).toBeGreaterThanOrEqual(csvExport.data[0].age_min_95);

    // 7. 断言后端 export.exportLipd 包含 chronMeasurementTable 与 chronEnsembleTable
    const lipdRes = await rpc<{ success: boolean; lipd: any }>(page, 'export.exportLipd', {
      include_age_depth: true,
    });
    expect(lipdRes.success).toBe(true);
    const chronData = lipdRes.lipd.chronData[0];
    expect(chronData.chronMeasurementTable[0].columns.length).toBeGreaterThanOrEqual(4);
    expect(chronData.chronEnsembleTable[0].tableName).toBe('Bacon_Ensemble_1000');
  });

  test('T2 Bchron 阶梯范例载入 + Tab 2 实测年代数据表增行与地质事件参数交互', async ({ page }) => {
    await gotoStage(page, 3);

    await page.locator('#btn-age-depth-modal').click();
    const dialog = page.locator('.agedepth-dialog');
    await expect(dialog).toBeVisible();

    // 1. 点击【Bchron 阶梯范例】载入第二张内置年代图谱
    await dialog.locator('#ad-btn-center-bchron').click();
    await expect(dialog.locator('#ad-current-source-label')).toHaveText('范例: BCHRON', {
      timeout: 10_000,
    });

    // 2. 切换到 Tab 2（测年数据与 Bacon / geoChronR 向导）
    await dialog.locator('#ad-tab-btn-modeling').click();
    const modelingPanel = dialog.locator('#ad-tab-panel-modeling');
    await expect(modelingPanel).toBeVisible();

    // 3. 验证测年表增行交互
    const initialRows = await modelingPanel.locator('#ad-dating-tbody tr').count();
    await modelingPanel.locator('#btn-ad-add-date-row').click();
    expect(await modelingPanel.locator('#ad-dating-tbody tr').count()).toBe(initialRows + 1);

    // 4. 勾选沉积间断 (Hiatus)、瞬时沉积层 (Slump) 与碳储库校正 (ΔR)，验证参数框展开
    await modelingPanel.locator('#ad-chk-hiatus').check();
    await expect(modelingPanel.locator('#ad-hiatus-box')).toBeVisible();
    await modelingPanel.locator('#ad-inp-hiatus-depth').fill('45.0');

    await modelingPanel.locator('#ad-chk-slump').check();
    await expect(modelingPanel.locator('#ad-slump-box')).toBeVisible();

    await modelingPanel.locator('#ad-chk-dr').check();
    await expect(modelingPanel.locator('#ad-dr-box')).toBeVisible();

    // 5. 切换分段厚度胶囊 (2 cm 高密)
    await modelingPanel.locator('.ad-btn-thick[data-thick="2"]').click();
    await expect(modelingPanel.locator('#ad-val-thick')).toHaveText('2 cm');

    await dialog.locator('#ad-close-btn').click();
    await expect(dialog).toHaveCount(0);
  });

  test.describe('T3 专用子组（放行重置弹窗）', () => {
    test.use({ allowlists: { notice: [/确定要重置当前图谱的全部操作吗/] } });

    test('T3 空状态重置防崩溃测试与浮动工具条主题适配', async ({ page }) => {
      // 1. 在未载入底图的空状态下触发顶栏重置
      const resetBtn = page.locator('#btn-reset-all');
      if (await resetBtn.isVisible()) {
        await resetBtn.click();
      }

      // 确认未炸出 rpc-error-modal
      await expect(page.locator('#rpc-error-modal')).toHaveCount(0);

      // 2. 打开年代-深度弹窗，验证浮动工具栏主题结构已正规化
      await page.locator('#btn-age-depth-modal').click();
      const dialog = page.locator('.agedepth-dialog');
      await expect(dialog).toBeVisible();

      const floatToolbar = dialog.locator('#ad-floating-toolbar');
      await expect(floatToolbar).toBeVisible();
      await expect(floatToolbar.locator('.ad-fmode-btn')).toHaveCount(4);

      await dialog.locator('#ad-close-btn').click();
      await expect(dialog).toHaveCount(0);
    });
  });

  test('T4 年代-深度提取结果表格呈现与就地可编辑性验证', async ({ page }) => {
    await gotoStage(page, 3);

    // 1. 打开年代-深度弹窗并载入 Bacon 范例
    await page.locator('#btn-age-depth-modal').click();
    const dialog = page.locator('.agedepth-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#ad-btn-center-bacon').click();
    await expect(dialog.locator('#ad-current-source-label')).toHaveText('范例: BACON', {
      timeout: 10_000,
    });

    // 2. 运行提取
    await dialog.locator('#ad-btn-extract').click();
    await expect(dialog.locator('#ad-status-msg')).toContainText('识别成功', {
      timeout: 20_000,
    });

    // 3. 验证侧边栏表格渲染出可编辑输入框
    const sideInputs = dialog.locator('#ad-mapping-tbody .ad-input-side-age');
    expect(await sideInputs.count()).toBeGreaterThan(0);

    // 4. 切换到 Tab 2【年代-深度结果数据表】
    await dialog.locator('#ad-tab-btn-table').click();
    const tablePanel = dialog.locator('#ad-tab-panel-table');
    await expect(tablePanel).toBeVisible();

    // 验证大表格行数与可编辑输入框
    const fullRows = tablePanel.locator('#ad-full-table-tbody tr');
    const rowCount = await fullRows.count();
    expect(rowCount).toBeGreaterThan(10);

    // 5. 编辑第一行的年代数值
    const firstAgeInput = tablePanel.locator('.ad-input-full-age').first();
    await firstAgeInput.fill('150');
    await firstAgeInput.dispatchEvent('change');

    // 6. 测试添加新层位
    await tablePanel.locator('#ad-tbl-btn-add').click();
    expect(await tablePanel.locator('#ad-full-table-tbody tr').count()).toBe(rowCount + 1);

    // 7. 测试按深度升序排序
    await tablePanel.locator('#ad-tbl-btn-sort').click();

    // 8. 测试保存同步到模型
    await tablePanel.locator('#ad-tbl-btn-sync').click();
    await expect(tablePanel.locator('#ad-table-sync-status')).toContainText(/已将 \d+ 行修改后的年代-深度数据同步到工程/, {
      timeout: 10_000,
    });

    // 9. 应用并关闭弹窗
    await dialog.locator('#ad-btn-apply').click();
    await expect(dialog).toHaveCount(0);
  });

  test('T5 表格：速率±SE 两列、格式位数、表头排序只重排显示', async ({ page }) => {
    await gotoStage(page, 3);
    await page.locator('#btn-age-depth-modal').click();
    const dialog = page.locator('.agedepth-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#ad-btn-center-bacon').click();
    await expect(dialog.locator('#ad-current-source-label')).toHaveText('范例: BACON', {
      timeout: 10_000,
    });
    await dialog.locator('#ad-btn-extract').click();
    await expect(dialog.locator('#ad-status-msg')).toContainText('识别成功', {
      timeout: 20_000,
    });

    await dialog.locator('#ad-tab-btn-table').click();
    const panel = dialog.locator('#ad-tab-panel-table');
    await expect(panel).toBeVisible();
    const rows = panel.locator('#ad-full-table-tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(10);

    // ① 速率与标准误是两列，且 ±SE 有值（后端行对齐的分窗回归）
    expect(await panel.locator('thead th').count()).toBe(9);
    const seTexts = await panel
      .locator('#ad-full-table-tbody tr td:nth-child(8)')
      .allTextContents();
    const seWithNumbers = seTexts.filter((t) => /±\s*[\d.]+/.test(t)).length;
    expect(
      seWithNumbers,
      `±SE 列应大多有数值，实际 ${seWithNumbers}/${seTexts.length}：${seTexts.slice(0, 3)}`,
    ).toBeGreaterThan(rowCount * 0.5);
    const rateTexts = await panel
      .locator('#ad-full-table-tbody tr td:nth-child(7)')
      .allTextContents();
    expect(rateTexts.filter((t) => /[\d.]/.test(t)).length).toBeGreaterThan(rowCount * 0.5);

    // ② 格式下拉：选 2 位小数后深度输入框必须正好 2 位小数；回到原始值则不再统一
    await panel.locator('#ad-tbl-fmt-digits').selectOption('2');
    const two = await panel
      .locator('.ad-input-full-depth')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value).slice(0, 5));
    for (const v of two) {
      expect(v, `深度显示应为 2 位小数，实际 "${v}"`).toMatch(/^-?\d+\.\d{2}$/);
    }
    await panel.locator('#ad-tbl-fmt-digits').selectOption('');
    const raw = await panel
      .locator('.ad-input-full-depth')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value).slice(0, 5));
    expect(
      raw.some((v) => !/^-?\d+\.\d{2}$/.test(v)),
      `原始值模式不应统一成 2 位小数：${raw}`,
    ).toBe(true);

    // ③ 表头排序只重排显示：data-idx 仍是 0..n-1 的排列，且方向可切换
    const idxOf = () =>
      panel
        .locator('.ad-input-full-depth')
        .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-idx'))));
    const before = await idxOf();
    expect(before).toEqual([...before].sort((a, b) => a - b));

    await panel.locator('th[data-sort="age"]').click();
    const asc = await idxOf();
    // 年龄随深度单调递增，升序排一遍结果与源序相同 —— 这里只断言"仍是同一排列"，
    // 不强求变化（强求变化就等于假定数据本身不是升序，那是把数据当成了代码的性质）。
    expect(
      [...asc].sort((a, b) => a - b),
      '排序只是显示置换：data-idx 必须仍是 0..n-1 的排列',
    ).toEqual(before);
    // 显示值必须非递减（这才是排序该保证的东西）
    const agesOf = () =>
      panel
        .locator('.ad-input-full-age')
        .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
    const ascAges = await agesOf();
    for (let i = 1; i < ascAges.length; i++) {
      expect(ascAges[i], `升序：第 ${i} 行不应小于上一行`).toBeGreaterThanOrEqual(ascAges[i - 1]);
    }

    await panel.locator('th[data-sort="age"]').click();
    const descAges = await agesOf();
    // 相等值在稳定排序下不翻面，所以不能断言"降序=升序的逆"；断言单调性即可。
    for (let i = 1; i < descAges.length; i++) {
      expect(descAges[i], `降序：第 ${i} 行不应大于上一行`).toBeLessThanOrEqual(descAges[i - 1]);
    }
    expect(descAges, '降序显示值必须与升序不同（否则方向没切换）').not.toEqual(ascAges);
    expect(
      [...(await idxOf())].sort((a, b) => a - b),
      '降序后 data-idx 仍是 0..n-1 的排列',
    ).toEqual(before);
    await expect(panel.locator('th[data-sort="age"] .ad-sort-ind')).toHaveText('▼');

    // ④ 排序后同步仍成功（显示顺序不改变数据语义）
    await panel.locator('#ad-tbl-btn-sync').click();
    await expect(panel.locator('#ad-table-sync-status')).toContainText(
      /已将 \d+ 行修改后的年代-深度数据同步到工程/,
      { timeout: 10_000 },
    );

    await dialog.locator('#ad-btn-apply').click();
    await expect(dialog).toHaveCount(0);
  });

  test.describe('T6 拖拽载图（放行"非图片"拒绝提示）', () => {
    // 非图片被拒绝时控制器会 notifyError，这是**故意**触发的用户可见报错，
    // 按 fixtures.ts 的约定在此声明豁免，而不是把断言删掉。
    test.use({ allowlists: { notice: [/不是图片文件/] } });

    test('T6 空白区文案承诺的拖拽必须真的能载图', async ({ page }) => {
    // 空白区一直写着「直接将 Bacon / Bchron / OxCal 年代图拖拽至此处」，但代码里
    // 从未有 dragover/drop 监听 —— 拖进来毫无反应。本用例钉住"文案成真"。
    // 判别力：修复前拖拽完全不触发 onImageLoaded，来源标签会停在「未载入」。
    await gotoStage(page, 3);
    await page.locator('#btn-age-depth-modal').click();
    const dialog = page.locator('.agedepth-dialog');
    await expect(dialog).toBeVisible();

    const label = dialog.locator('#ad-current-source-label');
    await expect(label).toHaveText('未载入');

    const W = 257;
    const H = 199;
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
          for (let i = 0; i < 25; i++) g.fillRect(6 + i * 9, 12, 4, 150);
          c.toBlob((blob) => {
            const file = new File([blob!], 'probe-agedepth-257x199.png', {
              type: 'image/png',
            });
            const dt = new DataTransfer();
            dt.items.add(file);
            resolve(dt);
          }, 'image/png');
        }),
      [W, H]
    );

    // 监听器挂在 #ad-canvas-container 上，空白区是它的子元素，事件会冒泡上去。
    await dialog.locator('#ad-empty-drop-zone').dispatchEvent('drop', { dataTransfer });

    // 来源标签必须变成文件名 —— 这是"拖拽真的走到了 handleCustomImageFile"的证据。
    await expect(label, '拖拽后来源标签应显示文件名').toHaveText(
      'probe-agedepth-257x199.png',
      { timeout: 10_000 }
    );
    // 空白区应让位给画布
    await expect(dialog.locator('#ad-empty-drop-zone')).toBeHidden();
    // 拖拽时的高亮必须复位（否则边框停在强调色上，像一直处于拖拽态）
    await expect
      .poll(async () =>
        dialog
          .locator('#ad-canvas-container')
          .evaluate((el) => (el as HTMLElement).style.borderColor)
      )
      .toBe('');

    // 非图片必须如实拒绝并保持原图不变（不静默吞掉）
    const badTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
      return dt;
    });
    await dialog.locator('#ad-canvas-container').dispatchEvent('drop', {
      dataTransfer: badTransfer,
    });
    await expect(label, '非图片不得替换当前图谱').toHaveText(
      'probe-agedepth-257x199.png'
    );

    // 硬关闭弹窗（本用例没跑提取，应用按钮无意义）
    await dialog.locator('#ad-close-btn').click();
    await expect(dialog).toHaveCount(0);
    });
  });
});
