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
    await expect(tablePanel.locator('#ad-table-sync-status')).toContainText('已成功将修改后的年代-深度数据同步', {
      timeout: 10_000,
    });

    // 9. 应用并关闭弹窗
    await dialog.locator('#ad-btn-apply').click();
    await expect(dialog).toHaveCount(0);
  });
});
