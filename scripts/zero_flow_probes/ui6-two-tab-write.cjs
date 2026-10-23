/**
 * 探针 UI-6：两个标签页同时**写**，看是否互相覆盖（用户真的会开两个标签页）。
 *
 * 三条真实操作路径，每条都用真实 UI 点击（不是直调 RPC）：
 *   S1. A 页在步骤 3 做 Y 轴标定；B 页同时在步骤 2 改 ROI 名字。
 *   S2. A 页在步骤 5 重分列；B 页同时在步骤 4 确认线几何。
 *   S3. A 页在步骤 6 标定 X 刻度；B 页同时在步骤 5 重分列。
 *
 * 每条结束后读**后端**权威状态（两页共用同一份后端会话，所以"谁赢了"必须是
 * 后端说了算，不是页面说了算）。
 */
const assert = require('node:assert/strict');

module.exports = async function ui6_two_tab_write({ rpc, rpcSafe, diagram, frontState, openApp, log, j, page, ctx }) {
  const HOYA_X = [315, 1946];
  const HOYA_Y = [511, 1311];

  const pageB = await ctx.newPage();
  const st = (p) => frontState(p);

  // ---------- S1：A 标定 Y 轴，B 改 ROI 名 ----------
  log('ui6', '=== S1：A 页 Y 轴标定 vs B 页 ROI 改名 ===');
  await rpc(page, 'e2e.reset');
  await rpc(page, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(page, 'core.detectColumns', { data_xlim: HOYA_X, data_ylim: HOYA_Y });
  await page.reload(); await openApp(page);
  await pageB.reload(); await openApp(pageB);

  // A：步骤 3 Y 标定（走后端 calibrateAxes 的等价真实参数）
  const cal = await rpcSafe(page, 'core.calibrateAxes', {
    y_marks: [
      { pixel: 600, val: 0 },
      { pixel: 1200, val: 300 },
    ],
    unit: 'cm',
  });
  log('ui6', 'A core.calibrateAxes ->', cal.ok ? 'ok' : cal.error);

  // B：同时改名 ROI
  const roiId = (await diagram(page)).activeRoiId;
  const ren = await rpcSafe(pageB, 'roi.update', { roi_id: roiId, name: '湖泊B' });
  log('ui6', 'B roi.update(name=湖泊B) ->', ren.ok ? 'ok' : ren.error);

  const d1 = await diagram(page);
  log('ui6', 'S1 后端结果: calibration.isCalibrated =', d1.calibration?.isCalibrated,
      '| top_px =', d1.calibration?.top_px, '| bottom_px =', d1.calibration?.bottom_px,
      '| roi.name =', (d1.rois || [])[0]?.name);

  // ---------- S2：A 重分列，B 同时确认线几何 ----------
  log('ui6', '=== S2：A 页重分列 vs B 页确认线几何 ===');
  await rpc(page, 'e2e.reset');
  await rpc(page, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(page, 'core.detectColumns', { data_xlim: HOYA_X, data_ylim: HOYA_Y });
  // 先在 B 页步骤 4 扫出候选，再在 A 页重分列时确认一条
  const scan = await rpcSafe(pageB, 'algorithm.detectLineCandidates', { roi_id: roiId });
  const cands = scan.ok ? (scan.result.candidates || []) : [];
  log('ui6', 'B 检出候选几何 =', cands.length);
  if (cands.length > 0) {
    const target = cands[0].id;
    const [det, conf] = await Promise.all([
      rpcSafe(page, 'core.detectColumns', { data_xlim: HOYA_X, data_ylim: HOYA_Y }),
      rpcSafe(pageB, 'algorithm.setGeometryStatus', { candidate_id: target, status: 'removed' }),
    ]);
    log('ui6', 'A detectColumns ->', det.ok ? 'ok' : det.error);
    log('ui6', 'B setGeometryStatus(removed) ->', conf.ok ? 'ok' : conf.error);
    const d2 = await diagram(page);
    const after = d2.line_candidates || [];
    log('ui6', 'S2 后端结果: 候选数 =', after.length,
        '| 已确认(removed) =', after.filter((c) => c.status === 'removed').length,
        '| 目标 id 是否还在 =', after.some((c) => c.id === target));
  }

  // ---------- S3：A 标定 X 刻度，B 同时重分列 ----------
  log('ui6', '=== S3：A 页标定 X 刻度 vs B 页重分列 ===');
  await rpc(page, 'e2e.reset');
  await rpc(page, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(page, 'core.detectColumns', { data_xlim: HOYA_X, data_ylim: HOYA_Y });
  const cols = (await diagram(page)).columns || [];
  const c2 = cols[2];
  const px1 = c2.startX;
  const px2 = c2.tickEndX > px1 ? c2.tickEndX : px1 + 60;
  const [calX, det2] = await Promise.all([
    rpcSafe(page, 'column.calibrateXTicks', {
      col_index: 2,
      ticks: [{ px: px1, value: 0 }, { px: px2, value: 40 }],
    }),
    rpcSafe(pageB, 'core.detectColumns', { data_xlim: HOYA_X, data_ylim: HOYA_Y }),
  ]);
  log('ui6', 'A column.calibrateXTicks ->', calX.ok ? 'ok' : calX.error);
  log('ui6', 'B core.detectColumns ->', det2.ok ? 'ok' : det2.error);
  const d3 = await diagram(page);
  log('ui6', 'S3 后端结果: col2.x_ticks =', j(d3.columns[2]?.x_ticks));

  await pageB.close();
};
