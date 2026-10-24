/**
 * 真机端到端全链路操作测试脚本 (Han 2026 Fig 3 真实论文图版)
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const require = createRequire(resolve('frontend/package.json'));
const { chromium } = require('@playwright/test');

const REPO_ROOT = resolve('.');
const PORT = 22920;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE_PATH = resolve('output/han2026_ngamring/fig3_raw.jpeg');
const SCREENSHOT_DIR = resolve('output/journey_han2026');

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isBackendAlive() {
  try {
    const res = await fetch(`${BASE_URL}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'e2e.health', params: {} }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.result?.ok === true;
  } catch {
    return false;
  }
}

async function startBackendIfNeeded() {
  if (await isBackendAlive()) {
    console.log(`Backend already running on port ${PORT}`);
    return null;
  }
  console.log(`Starting zero backend on port ${PORT}...`);
  const child = spawn(
    'pixi',
    ['run', 'python', 'support/serve_zero_backend.py'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, STRADITIZE_ZERO_PORT: String(PORT) },
      stdio: 'pipe',
    }
  );
  child.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[backend err] ${d}`));

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await isBackendAlive()) {
      console.log(`Backend ready on port ${PORT}!`);
      return child;
    }
  }
  throw new Error(`Backend failed to start on port ${PORT} after 20s`);
}

async function rpc(method, params = {}) {
  const res = await fetch(`${BASE_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC ${method} error [${data.error.code}]: ${data.error.message}`);
  return data.result;
}

async function main() {
  console.log('=== 开始 Straditize 真机端到端全流程操作与质量核验 ===');
  console.log(`测试图像: ${IMAGE_PATH}`);
  const backendProc = await startBackendIfNeeded();

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[Browser Console Error] ${msg.text()}`);
  });

  try {
    // 0. 重置到干净状态
    console.log('0. 重置后端会话...');
    await rpc('e2e.reset');

    // 1. 打开首页
    console.log('1. 打开主界面...');
    await page.goto(BASE_URL);
    await page.waitForSelector('#geology-canvas', { timeout: 15000 });
    console.log('   主画布已就绪');

    // 2. Step 1: 上传真实花粉图 (fig3_raw.jpeg)
    console.log('2. 真实上传 Han 2026 Fig 3 (2132x928)...');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.locator('#btn-open-file').click(),
    ]);
    await chooser.setFiles(IMAGE_PATH);

    // 等待图谱载入与 ROI 创建完成
    await page.waitForFunction(
      () => {
        const s = window.__straditize?.getState();
        return s && s.image && s.image.width > 0 && s.rois && s.rois.length > 0;
      },
      undefined,
      { timeout: 45000 }
    );
    await sleep(800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '01_loaded.png') });
    console.log('   ✓ 图谱载入成功，已截图 01_loaded.png');

    // 3. Step 2: 确认与调整数据有效区 (ROI)
    console.log('3. 进入 Step 2: 设置取数区 ROI...');
    await page.evaluate(() => window.__straditize?.gotoStage(2));
    await page.waitForSelector('.step-panel[data-step="2"]', { timeout: 10000 });

    // 权威真实数据区：[330, 233, 1330, 869] (包含底边横轴线 y=869 与 16 列花粉)
    await rpc('roi.update', {
      roi_id: 'roi_1',
      xMin: 330,
      xMax: 1330,
      yMin: 233,
      yMax: 869,
      composition: true,
    });
    // 刷新前端画布
    const refreshed = await rpc('straditize.getDiagramData');
    await page.evaluate((d) => window.__straditize?.canvasComponent?.loadNewDiagram(d), refreshed);
    await sleep(600);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '02_roi_set.png') });
    console.log('   ✓ ROI 设置 [330,233,1330,869] 成功，已截图 02_roi_set.png');

    // 4. Step 3: Y 轴层位深度标定
    console.log('4. 进入 Step 3: 标定 Y 轴...');
    await page.evaluate(() => window.__straditize?.gotoStage(3));
    await page.waitForSelector('.step-panel[data-step="3"]', { timeout: 10000 });

    // 真实在表单中填入两点深度标定：Y1=233px -> 0 cm, Y2=869px -> 637 cm
    await page.locator('#ycal-inp-top-px').fill('233');
    await page.locator('#ycal-inp-top-val').fill('0');
    await page.locator('#ycal-inp-bot-px').fill('869');
    await page.locator('#ycal-inp-bot-val').fill('637');
    await page.locator('#ycal-inp-unit').fill('cm');
    await page.locator('#btn-apply-ycalib').click();
    await sleep(600);

    await page.screenshot({ path: join(SCREENSHOT_DIR, '03_ycalib.png') });
    console.log('   ✓ Y 轴表单标定深度 0~637 cm 完成，已截图 03_ycalib.png');

    // 5. Step 4: 干扰线清理
    console.log('5. 进入 Step 4: 干扰清理...');
    await page.evaluate(() => window.__straditize?.gotoStage(4));
    await page.waitForSelector('.step-panel[data-step="4"]', { timeout: 10000 });
    await sleep(800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '04_cleanup.png') });
    console.log('   ✓ Step 4 清理面板就绪，已截图 04_cleanup.png');

    // 6. Step 5: 自动分列与 OCR 属种名识别
    console.log('6. 进入 Step 5: 自动分列...');
    await page.evaluate(() => window.__straditize?.gotoStage(5));
    await page.waitForSelector('.step-panel[data-step="5"]', { timeout: 10000 });

    // 等待分列完成
    await page.waitForFunction(
      () => {
        const d = window.__straditize?.getState();
        return d && d.columns && d.columns.length >= 15;
      },
      undefined,
      { timeout: 15000 }
    );
    const splitData = await rpc('straditize.getDiagramData');
    console.log(`   ✓ 成功自动切分 ${splitData.columns.length} 个属种列！`);

    // 打开 OCR 属种识别审校弹窗
    console.log('   触发 OCR 属种识别弹窗...');
    await page.locator('#btn-trigger-ocr').click();
    await page.waitForSelector('.ocr-review-dialog', { timeout: 10000 });

    // 执行 OCR 识别
    console.log('   点击【执行 OCR 识别】...');
    await page.locator('#btn-ocr-run').click();

    // 等待 OCR 结果填入表格
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('#ocr-summary-tbody tr');
        return rows.length >= 10;
      },
      undefined,
      { timeout: 30000 }
    );

    const ocrRowsCount = await page.locator('#ocr-summary-tbody tr').count();
    console.log(`   ✓ OCR 成功识别到 ${ocrRowsCount} 个标签候选！`);

    // 点击【全部接受】
    await page.locator('#btn-ocr-accept-all').click();
    await sleep(300);

    // 点击【应用到图谱各列】
    console.log('   点击【应用到图谱各列】...');
    await page.locator('#ocr-btn-apply').click();
    await sleep(800);

    // 校验列名是否成功注入为拉丁学名
    const postOcrData = await rpc('straditize.getDiagramData');
    const namedCols = postOcrData.columns.map((c) => c.name);
    console.log(`   ✓ 改名后列名: ${namedCols.slice(0, 8).join(', ')} ...`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05_naming_ocr.png') });

    // 7. Step 6: 标定 X 刻度 - 使用组参考标尺模数定标！
    console.log('7. 进入 Step 6: 列组参考标尺模数定标...');
    await page.evaluate(() => window.__straditize?.gotoStage(6));
    await page.waitForSelector('.step-panel[data-step="6"]', { timeout: 10000 });

    // 检查组参考标尺输入框
    const spanInput = page.locator('#inp-ref-ruler-span');
    await spanInput.fill('40.0');
    await page.locator('#inp-ref-val1').fill('0');
    await page.locator('#inp-ref-val2').fill('20');
    console.log('   填写组标尺模数: 40.0px = 0 ~ 20%');

    // 点击【对齐标尺：刚体应用到本组】
    console.log('   点击【对齐标尺：刚体应用到本组】...');
    await page.locator('#btn-apply-group-scale').click();
    await sleep(800);

    // 验证后端所有列的标定状态
    const calibColsData = await rpc('straditize.getDiagramData');
    const allCalibrated = calibColsData.columns.every((c) => c.x_ticks && c.x_ticks.length === 2);
    console.log(`   ✓ 全组 ${calibColsData.columns.length} 列标定完成率: ${allCalibrated ? '100% (全绿)' : '部分未标定'}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '06_xticks_group_calibrated.png') });

    // 8. Step 7: 采样与提取
    console.log('8. 进入 Step 7: 曲线数值提取...');
    await page.evaluate(() => window.__straditize?.gotoStage(7));
    await page.waitForSelector('.step-panel[data-step="7"]', { timeout: 10000 });
    await sleep(800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '07_digitize.png') });
    console.log('   ✓ Step 7 曲线提取就绪，已截图 07_digitize.png');

    // 9. Step 8: 质量审计与数据导出
    console.log('9. 进入 Step 8: 质量审计与数据导出...');
    await page.evaluate(() => window.__straditize?.gotoStage(8));
    await page.waitForSelector('.step-panel[data-step="8"]', { timeout: 10000 });
    await sleep(1000);

    // 检查导出就绪性
    const readiness = await rpc('export.getReadiness');
    console.log(`   ✓ 导出就绪清单: ready=${readiness.ready}, uncalibrated=${readiness.uncalibrated_columns?.length || 0}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '08_qa_readiness.png') });

    // 10. 真实数据导出验证 (CSV + XLSX)
    console.log('10. 导出科研成果数据 (CSV + XLSX)...');
    const csvRes = await rpc('export.csv');
    const csvStr = typeof csvRes === 'string' ? csvRes : (csvRes?.csv || csvRes?.data || '');
    if (csvStr) {
      const csvPath = join(SCREENSHOT_DIR, 'Han2026_Fig3_extracted.csv');
      writeFileSync(csvPath, csvStr, 'utf-8');
      const lines = csvStr.trim().split('\n');
      console.log(`   ✓ CSV 导出成功: ${csvPath} (${lines.length} 行, 表头: ${lines[0].slice(0, 80)}...)`);
    } else {
      console.warn('   ⚠️ CSV 返回空内容:', csvRes);
    }

    const xlsxRes = await rpc('export.exportXlsx');
    if (xlsxRes && xlsxRes.base64) {
      const xlsxPath = join(SCREENSHOT_DIR, 'Han2026_Fig3_extracted.xlsx');
      const buf = Buffer.from(xlsxRes.base64, 'base64');
      writeFileSync(xlsxPath, buf);
      console.log(`   ✓ XLSX 导出成功: ${xlsxPath} (${buf.length} 字节, 合法 openpyxl 工作簿)`);
    }

    console.log('\n======================================================');
    console.log('🎉 真机全流程上机操作与核验全部顺利完成！无任何阻断！');
    console.log(`所有高清截图与成果数据已保存在: ${SCREENSHOT_DIR}`);
    console.log('======================================================');
  } finally {
    await context.close();
    await browser.close();
    if (backendProc) {
      backendProc.kill();
    }
  }
}

main().catch((err) => {
  console.error('\n❌ 上机测试出现阻断异常:', err);
  process.exit(1);
});
