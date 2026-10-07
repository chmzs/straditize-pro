/**
 * 花粉属种名 OCR 识别、词汇表管理与分列对齐弹窗 (OcrReviewModal) 真实 E2E 门禁。
 *
 * 验证链条：
 * 1. 打开 OCR 复核弹窗 (#btn-ocr-review-modal) -> 打开词汇表弹窗 (#btn-ocr-taxa-dict)；
 * 2. 粘贴期刊图版说明文本，触发后端 ocr.parseTaxaText 实时解析预览，点击 #dict-save-btn 保存 (ocr.saveCustomTaxa)，
 *    断言后端 ocr.getTaxaDict 权威自定义词条落库，且顶部徽标 #ocr-dict-badge 实时更新；
 * 3. 点击 #btn-ocr-run 触发真实离线 PP-OCRv6 识别 (ocr.recognizeLabels)，在汇总表审校修改属种名并勾选采纳，
 *    点击 #ocr-btn-apply (ocr.applyLabels)，断言后端 getDiagramData 列名更新且经得起重新分列 (core.detectColumns)。
 */
import { expect, test } from './fixtures';
import { diagramData, gotoStage, resetBaseline, rpc } from './helpers';

test.describe('OcrReviewModal (OCR 识别与词汇表管理模块) E2E', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    // 确保每次测试前自定义词汇表清空，避免跨用例污染
    await rpc(page, 'ocr.saveCustomTaxa', { clear: true, entries: [] });
  });

  test.afterEach(async ({ page }) => {
    await rpc(page, 'ocr.saveCustomTaxa', { clear: true, entries: [] });
  });

  test('T1 词汇表管理：粘贴期刊图版说明实时解析 + 保存落库 + 徽标刷新', async ({ page }) => {
    await gotoStage(page, 5);

    await page.locator('#btn-ocr-review-modal').click();
    const ocrDialog = page.locator('.ocr-review-dialog');
    await expect(ocrDialog).toBeVisible();

    // 打开词汇表子弹窗
    await ocrDialog.locator('#btn-ocr-taxa-dict').click();
    const dictInput = page.locator('#dict-import-input');
    await expect(dictInput).toBeVisible();

    // 输入期刊图版说明格式
    await dictInput.fill(
      '图版Ⅱ。a), b) Pediastrum boryanum var. boryanum; c) Spirogyra\n水绵属,Spirogyra_custom,绿藻类'
    );

    // 等待后端 ocr.parseTaxaText 返回预览
    const preview = page.locator('#dict-import-preview');
    await expect(preview).toContainText('Pediastrum boryanum', { timeout: 5000 });

    // 点击保存并应用
    await page.locator('#dict-save-btn').click();
    await expect(dictInput).toHaveCount(0);

    // 断言后端 ocr.getTaxaDict 已持久化自定义词条
    const dictSummary = await rpc<{ custom_count: number; custom: Array<{ latin: string }> }>(
      page,
      'ocr.getTaxaDict'
    );
    expect(dictSummary.custom_count).toBeGreaterThanOrEqual(2);
    expect(dictSummary.custom.map((c) => c.latin)).toContain('Pediastrum boryanum var. boryanum');

    // 断言 OCR 弹窗顶部徽标刷新出最新自定义数量
    await expect(ocrDialog.locator('#ocr-dict-badge')).toContainText(
      `自定义 ${dictSummary.custom_count}`
    );

    await ocrDialog.locator('#ocr-close-btn').click();
  });

  test('T2 执行真实 PP-OCRv6 识别 → 审校修改属种名 → 一键赋予图谱各列并活过重新分列', async ({
    page,
  }) => {
    await gotoStage(page, 5);

    await page.locator('#btn-ocr-review-modal').click();
    const ocrDialog = page.locator('.ocr-review-dialog');
    await expect(ocrDialog).toBeVisible();

    // 1. 点击【执行 OCR 识别】调用真实后端 PP-OCRv6 引擎
    await ocrDialog.locator('#btn-ocr-run').click();

    // 等待识别完成（表格第一行渲染出 .ocr-edit-input）
    const firstInput = ocrDialog.locator('#ocr-summary-tbody .ocr-edit-input').nth(0);
    const secondInput = ocrDialog.locator('#ocr-summary-tbody .ocr-edit-input').nth(1);
    await expect(firstInput).toBeVisible({ timeout: 15_000 });

    // 2. 先点击【✗ 全部跳过】清空默认勾选，再在汇总表中人工审校前两列为指定学名（输入时自动勾选采纳）
    await ocrDialog.locator('#btn-ocr-skip-all').click();
    await firstInput.fill('Pinus_sylvestris');
    await secondInput.fill('Betula_nana');

    // 确认前两行的采纳复选框已自动启用并勾选
    await expect(ocrDialog.locator('#ocr-summary-tbody .ocr-accept-chk').nth(0)).toBeChecked();
    await expect(ocrDialog.locator('#ocr-summary-tbody .ocr-accept-chk').nth(1)).toBeChecked();

    // 3. 点击【确认无误，一键赋予图谱各列】
    await ocrDialog.locator('#ocr-btn-apply').click();
    await expect(ocrDialog).toHaveCount(0);

    // 4. 断言后端权威列名称已更新
    const afterApply = await diagramData<{ columns: Array<{ id: string; name: string; roi_id: string }> }>(page);
    expect(afterApply.columns[0].name).toBe('Pinus_sylvestris');
    expect(afterApply.columns[1].name).toBe('Betula_nana');

    // 5. 触发一次真实的重新分列（core.detectColumns），验证 ocr.applyLabels 已同步写入 session.taxa_names
    const roiId = afterApply.columns[0].roi_id;
    await rpc(page, 'algorithm.detectColumns', { roi_id: roiId });

    const afterResplit = await diagramData<{ columns: Array<{ name: string }> }>(page);
    expect(afterResplit.columns[0].name).toBe('Pinus_sylvestris');
    expect(afterResplit.columns[1].name).toBe('Betula_nana');
  });
});
