/**
 * 论文与钻孔站点 FAIR / LiPD v1.3 元数据弹窗 (MetadataModal) 真实 E2E 门禁。
 *
 * 验证链条：
 * 1. 顶栏点击 #btn-metadata-modal 打开弹窗；
 * 2. 真实填写 LiPD v1.3 标准字段：
 *    - 来源文献 + 基金资助（funding_agency / funding_grant）
 *    - 站点地理坐标 + 国家/行政区（country）+ 水深（water_depth_m）+ 孔长（core_length_m）+ 野外采集时间（collection_date）
 *    - 年代学模型参数
 *    - 野外采集/实验分析人（investigators，独立于论文作者）+ 数字化录入人（digitizer）+ 所属单位（affiliation）+ 数字化日期（digitization_date）
 *    - 数据集版本（dataset_version）+ 原始数据链接（original_data_url）
 * 3. 点击 #meta-btn-save 触发 metadata.update，断言后端 metadata.get 逐字段等于用户输入；
 * 4. 再次打开弹窗断言表单从后端真值回填；
 * 5. 触发真实 LiPD 导出（export.exportLipd），断言生成的 LiPD JSON-LD 根节点、geo、funding、investigators
 *    及测量表真实列单位（如 "粒/cm³"）全部严格就位。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

test.describe('MetadataModal (FAIR / LiPD v1.3 元数据模块) E2E', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 弹窗录入全量 LiPD v1.3 元数据（含采集人/单位/采集时间/基金）并落库回填 + LiPD 导出结构与真实单位对账', async ({
    page,
  }) => {
    await gotoStage(page, 6);

    // 1. 点击顶栏【元数据】按钮打开弹窗
    const openBtn = page.locator('#btn-metadata-modal');
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const dialog = page.locator('.metadata-dialog');
    await expect(dialog).toBeVisible();

    // 2. 填写分组 1：出版信息与基金资助
    await dialog.locator('#meta-inp-doi').fill('10.1016/j.quascirev.2025.108001');
    await dialog.locator('#meta-pub-title').fill('Holocene vegetation dynamics on the Tibetan Plateau');
    await dialog.locator('#meta-pub-authors').fill('Chen, X., Liu, Y.');
    await dialog.locator('#meta-pub-journal').fill('Quaternary Science Reviews');
    await dialog.locator('#meta-pub-year').fill('2025');
    await dialog.locator('#meta-pub-funding-agency').fill('NSFC');
    await dialog.locator('#meta-pub-funding-grant').fill('42071100');

    // 3. 填写分组 2：站点坐标、国家、水深、孔长与野外采集时间
    await dialog.locator('#meta-site-name').fill('Lake_Qinghai_Core1');
    await dialog.locator('#meta-site-country').fill('China');
    await dialog.locator('#meta-site-lat').fill('36.88');
    await dialog.locator('#meta-site-lon').fill('100.15');
    await dialog.locator('#meta-site-elev').fill('3194');
    await dialog.locator('#meta-site-water-depth').fill('21.5');
    await dialog.locator('#meta-site-core-length').fill('8.4');
    await dialog.locator('#meta-site-archive').fill('lake sediment');
    await dialog.locator('#meta-site-collection-date').fill('2021-08');

    // 4. 填写分组 3：年代学模型
    await dialog.locator('#meta-chron-model').fill('Bacon');
    await dialog.locator('#meta-chron-dating').fill('AMS 14C');
    await dialog.locator('#meta-chron-range').fill('0-14500 cal yr BP');
    await dialog.locator('#meta-chron-calcurve').fill('IntCal20');

    // 5. 填写分组 4 & 5：采集/分析人、数字化人、所属单位、日期、版本与原始链接
    await dialog.locator('#meta-tech-investigators').fill('Dr. Li, Prof. Wang');
    await dialog.locator('#meta-tech-digitizer').fill('Chmzs');
    await dialog.locator('#meta-tech-affiliation').fill('ITP CAS');
    await dialog.locator('#meta-tech-digitization-date').fill('2026-09-29');
    await dialog.locator('#meta-tech-method').fill('HF digestion + Lycopodium tablets');
    await dialog.locator('#meta-tech-lab').fill('Key Lab of Alpine Ecology');
    await dialog.locator('#meta-tech-interval').fill('2');
    await dialog.locator('#meta-qual-version').fill('1.2.0');
    await dialog.locator('#meta-qual-url').fill('https://doi.org/10.1594/PANGAEA.999999');
    await dialog.locator('#meta-qual-notes').fill('Zero-abundance verified.');

    // 6. 点击保存
    await dialog.locator('#meta-btn-save').click();
    await expect(dialog).toHaveCount(0);

    // 7. 断言后端 metadata.get 权威状态逐字段等于输入
    const saved = await rpc<{ metadata: any }>(page, 'metadata.get');
    expect(saved.metadata.publication).toMatchObject({
      doi: '10.1016/j.quascirev.2025.108001',
      title: 'Holocene vegetation dynamics on the Tibetan Plateau',
      journal: 'Quaternary Science Reviews',
      year: 2025,
      funding_agency: 'NSFC',
      funding_grant: '42071100',
    });
    expect(saved.metadata.site).toMatchObject({
      site_name: 'Lake_Qinghai_Core1',
      country: 'China',
      latitude: '36.88',
      longitude: '100.15',
      elevation_m: '3194',
      water_depth_m: '21.5',
      core_length_m: '8.4',
      archive_type: 'lake sediment',
      collection_date: '2021-08',
    });
    expect(saved.metadata.technical).toMatchObject({
      investigators: 'Dr. Li, Prof. Wang',
      digitizer: 'Chmzs',
      affiliation: 'ITP CAS',
      digitization_date: '2026-09-29',
      laboratory: 'Key Lab of Alpine Ecology',
      sampling_interval_cm: '2',
    });
    expect(saved.metadata.quality).toMatchObject({
      dataset_version: '1.2.0',
      original_data_url: 'https://doi.org/10.1594/PANGAEA.999999',
      quality_notes: 'Zero-abundance verified.',
    });

    // 8. 重新打开弹窗，断言表单从后端真值回填
    await openBtn.click();
    await expect(page.locator('#meta-tech-investigators')).toHaveValue('Dr. Li, Prof. Wang');
    await expect(page.locator('#meta-tech-affiliation')).toHaveValue('ITP CAS');
    await expect(page.locator('#meta-site-collection-date')).toHaveValue('2021-08');
    await expect(page.locator('#meta-pub-funding-grant')).toHaveValue('42071100');
    await page.locator('#meta-btn-cancel').click();

    // 9. 设定首列单位为 "粒/cm³"，并调用真实 export.exportLipd 对账 LiPD JSON-LD
    await rpc(page, 'column.update', {
      col_index: 0,
      updates: { unit: '粒/cm³' },
    });
    const lipdRes = await rpc<{ success: boolean; lipd: any }>(page, 'export.exportLipd', {});
    expect(lipdRes.success).toBe(true);
    const lipd = lipdRes.lipd;

    expect(lipd.investigators).toEqual(['Dr. Li', 'Prof. Wang']);
    expect(lipd.createdBy).toBe('Chmzs');
    expect(lipd.affiliation).toBe('ITP CAS');
    expect(lipd.collectionDate).toBe('2021-08');
    expect(lipd.digitizationDate).toBe('2026-09-29');
    expect(lipd.datasetVersion).toBe('1.2.0');
    expect(lipd.originalDataUrl).toBe('https://doi.org/10.1594/PANGAEA.999999');
    expect(lipd.funding).toEqual([{ fundingAgency: 'NSFC', fundingGrant: '42071100' }]);
    expect(lipd.geo).toMatchObject({
      siteName: 'Lake_Qinghai_Core1',
      country: 'China',
      latitude: 36.88,
      longitude: 100.15,
      elevation: 3194,
      waterDepth: 21.5,
      coreLength: 8.4,
      collectionDate: '2021-08',
    });

    // 断言测量表列单位真实取自列标度（而非硬编码 "%"）
    const pCols = lipd.paleoData[0].paleoMeasurementTable[0].columns;
    expect(pCols[1].units).toBe('粒/cm³');
  });

  test('T2 LLM API / Key / 模型与提取提示词配置：默认预置模板、修改保存与恢复默认全链路', async ({
    page,
  }) => {
    await page.locator('#btn-metadata-modal').click();
    const dialog = page.locator('.metadata-dialog');
    await expect(dialog).toBeVisible();

    // 1. 点击【LLM 与提示词配置】展开面板
    await dialog.locator('#btn-toggle-llm-config').click();
    const llmPanel = dialog.locator('#meta-llm-config-panel');
    await expect(llmPanel).toBeVisible();

    // 2. 断言默认提示词模板已预置且包含 LiPD v1.3 扩展字段（country / water_depth_m / investigators）
    const promptInp = llmPanel.locator('#meta-llm-prompt');
    const defaultPrompt = await promptInp.inputValue();
    expect(defaultPrompt).toContain('water_depth_m');
    expect(defaultPrompt).toContain('investigators');

    // 3. 填入自定义 API Base URL、Key、Model 与自定义提示词并点击保存
    await llmPanel.locator('#meta-llm-base-url').fill('https://api.deepseek.com/v1');
    await llmPanel.locator('#meta-llm-api-key').fill('sk-test-gahai-2024');
    await llmPanel.locator('#meta-llm-model').fill('deepseek-chat');
    await promptInp.fill('Custom prompt for Lake Gahai extraction');

    await llmPanel.locator('#btn-save-llm-config').click();
    await expect(dialog.locator('#meta-extract-status')).toContainText('LLM 配置与提示词已保存');

    // 4. 断言后端 system.getConfig 已持久化该配置
    const cfg = await rpc<any>(page, 'system.getConfig');
    expect(cfg.llm_base_url).toBe('https://api.deepseek.com/v1');
    expect(cfg.llm_api_key).toBe('sk-test-gahai-2024');
    expect(cfg.llm_model).toBe('deepseek-chat');
    expect(cfg.llm_prompt_template).toBe('Custom prompt for Lake Gahai extraction');

    // 5. 点击【恢复默认提示词】并再次保存复原
    await llmPanel.locator('#btn-reset-llm-prompt').click();
    expect(await promptInp.inputValue()).toContain('water_depth_m');
    await llmPanel.locator('#meta-llm-base-url').fill('https://api.openai.com/v1');
    await llmPanel.locator('#meta-llm-api-key').fill('');
    await llmPanel.locator('#meta-llm-model').fill('gpt-4o');
    await llmPanel.locator('#btn-save-llm-config').click();

    await dialog.locator('#meta-btn-cancel').click();
  });

  test('T3 外部 AI 零 Token 导入助手：复制/查看提示词 + 粘贴含 Markdown 代码块与寒暄语的 AI 回复一键解析回填并落后端', async ({
    page,
  }) => {
    await page.locator('#btn-metadata-modal').click();
    const dialog = page.locator('.metadata-dialog');
    await expect(dialog).toBeVisible();

    // 1. 点击【外部 AI 导入助手 (免Token)】展开面板
    await dialog.locator('#btn-toggle-external-assistant').click();
    const extPanel = dialog.locator('#meta-external-assistant-panel');
    await expect(extPanel).toBeVisible();

    // 2. 点击【查看/编辑提示词】，确认预置了完整 LiPD v1.3 JSON 提示词模板
    await extPanel.locator('#btn-toggle-external-prompt-preview').click();
    const extPromptBox = extPanel.locator('#meta-external-prompt-box');
    await expect(extPromptBox).toBeVisible();
    const extPromptVal = await extPromptBox.inputValue();
    expect(extPromptVal).toContain('"publication"');
    expect(extPromptVal).toContain('"water_depth_m"');
    expect(extPromptVal).toContain('"investigators"');

    // 3. 模拟用户从网页版 DeepSeek / ChatGPT 复制过来的带前后寒暄语和 ```json 代码块的完整回复（以尕海湖 Zhou et al., 2024 为例）
    const simulatedLlmReply = `好的！我已经仔细阅读了您上传的《Holocene pollen record from Lake Gahai》PDF 论文，为您提取出以下符合 Straditize Pro 规范的元数据：

\`\`\`json
{
  "publication": {
    "doi": "https://doi.org/10.1016/j.quascirev.2024.108504",
    "title": "Holocene pollen record from Lake Gahai, NE Tibetan Plateau and its implications for quantitative reconstruction of regional precipitation",
    "authors": ["Shan Zhou", "Jiawu Zhang", "Bo Cheng", "Hainan Zhu", "Jinxiu Lin"],
    "journal": "Quaternary Science Reviews",
    "year": 2024,
    "funding_agency": "NSFC",
    "funding_grant": "41771212"
  },
  "site": {
    "site_name": "Lake Gahai (GHB core)",
    "country": "China (Qaidam Basin, Qinghai)",
    "latitude": "37.1333",
    "longitude": "97.5167",
    "elevation_m": "2848",
    "water_depth_m": "11.4",
    "core_length_m": "14.0",
    "archive_type": "lake sediment",
    "collection_date": "2008-05"
  },
  "chronology": {
    "age_model": "Bacon",
    "dating_method": "AMS 14C (28 carbonate + 4 mollusk shells)",
    "age_range": "0-11400 cal yr BP",
    "cal_curve": "IntCal20"
  },
  "technical": {
    "investigators": "Jiawu Zhang, Shan Zhou, Bo Cheng",
    "affiliation": "Lanzhou University",
    "laboratory": "Key Laboratory of Western China Environmental Systems",
    "pollen_extraction_method": "Acid-alkali treatment + Lycopodium tablets",
    "sampling_interval_cm": "2"
  },
  "quality": {
    "dataset_version": "1.0.0",
    "original_data_url": "https://doi.org/10.1016/j.quascirev.2024.108504",
    "quality_notes": "660 fossil samples analyzed (>500 terrestrial grains/sample)."
  }
}
\`\`\`

希望以上提取结果对您的研究有帮助！`;

    await extPanel.locator('#meta-external-paste-input').fill(simulatedLlmReply);
    await extPanel.locator('#btn-parse-external-json').click();

    await expect(dialog.locator('#meta-extract-status')).toContainText(
      '已成功解析外部 AI 结果并填入全部元数据字段'
    );

    // 4. 断言弹窗内各分组输入框已自动回填（且 DOI 前缀 https://doi.org/ 已被自动清洗）
    await expect(dialog.locator('#meta-inp-doi')).toHaveValue('10.1016/j.quascirev.2024.108504');
    await expect(dialog.locator('#meta-pub-funding-grant')).toHaveValue('41771212');
    await expect(dialog.locator('#meta-site-name')).toHaveValue('Lake Gahai (GHB core)');
    await expect(dialog.locator('#meta-site-water-depth')).toHaveValue('11.4');
    await expect(dialog.locator('#meta-site-core-length')).toHaveValue('14.0');
    await expect(dialog.locator('#meta-site-collection-date')).toHaveValue('2008-05');
    await expect(dialog.locator('#meta-tech-investigators')).toHaveValue(
      'Jiawu Zhang, Shan Zhou, Bo Cheng'
    );
    await expect(dialog.locator('#meta-tech-affiliation')).toHaveValue('Lanzhou University');

    // 5. 断言后端 metadata.get 权威状态已同步就位
    const backendMeta = await rpc<{ metadata: any }>(page, 'metadata.get');
    expect(backendMeta.metadata.publication.doi).toBe('10.1016/j.quascirev.2024.108504');
    expect(backendMeta.metadata.site.site_name).toBe('Lake Gahai (GHB core)');
    expect(backendMeta.metadata.site.water_depth_m).toBe('11.4');
    expect(backendMeta.metadata.site.collection_date).toBe('2008-05');
    expect(backendMeta.metadata.technical.investigators).toBe('Jiawu Zhang, Shan Zhou, Bo Cheng');

    await dialog.locator('#meta-btn-save').click();
  });
});
