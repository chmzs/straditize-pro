/**
 * 现行 8 步工作流「步骤 → 可绘制能力」的回归测试。
 *
 * 每条断言都对应一次真实用户反馈，写成"某一步应该/不应该看见什么"，
 * 而不是断言实现细节——这样下次有人改编号，测试会直接变红。
 *
 * 本轮三处反馈的形状完全一样：**同一个步骤编号在两处各写一遍，改了一处忘了一处**。
 * 现已集中到 src/core/WorkflowStage.ts，本文件负责钉住它的语义。
 *
 * 运行：npm --prefix frontend test（含本文件）
 */
import assert from 'node:assert/strict';

const S = await import('./src/core/WorkflowStage.ts');

// ---------------------------------------------------------------------------
// 0. 步骤编号本身必须与设计稿 §1 对照表一致
//    docs/plans/2026-09-20-8step-workflow-redesign.md
// ---------------------------------------------------------------------------
assert.deepEqual(
  { ...S.STAGE },
  {
    EMPTY: 0, LOAD: 1, ROI: 2, Y_CALIB: 3, CLEANUP: 4,
    SPLIT: 5, CALIBRATE_COLUMNS: 6, SPEARS_AND_SAMPLES: 7, QA: 8,
  },
  '步骤编号必须与设计稿 8 步对照表一致（改编号请先改设计稿）',
);
console.log('✔ 步骤编号与设计稿一致');

// ---------------------------------------------------------------------------
// 1. Y 标定：步骤 3 点完两点必须立刻看得见
//    （用户反馈：「应该在我点两点就即时出现，而不是点确定应用后才出现」）
// ---------------------------------------------------------------------------
assert.equal(S.showsYCalibMarks(S.STAGE.Y_CALIB), true, '步骤3 必须绘制 Y1/Y2 标记');
assert.equal(S.canPickYCalibMark(S.STAGE.Y_CALIB, 'ycalib'), true, '步骤3 Y 标定模式必须能拾取');
assert.equal(S.canPickYCalibMark(S.STAGE.Y_CALIB, 'select'), false, '步骤3 非 Y 标定模式不得拾取');
assert.equal(S.canPickYCalibMark(S.STAGE.ROI, 'ycalib'), false, '步骤2 不得拾取 Y 标定点');
assert.equal(S.showsYCalibMarks(S.STAGE.ROI), false, '步骤2 尚未进入标定，不该画标记');

// 本轮缺陷的形状：绘制守卫 >=4、拾取守卫 ===3 —— 结果是"点得上却看不见"。
// 正确关系是单向的：**能拾取的地方必须画得出来**（否则点了毫无反馈），
// 反过来不成立 —— 步骤 4 清理时已拾取的 Y1/Y2 要继续可见（标定信息不能凭空消失），
// 但不该再允许点选新的（那一步在做去线，工具模式是 linefix 而非 ycalib）。
for (let stage = 0; stage <= 8; stage++) {
  const pick = S.canPickYCalibMark(stage, 'select');
  const draw = S.showsYCalibMarks(stage);
  assert.ok(!pick || draw, `步骤 ${stage}：允许拾取 Y 标定点就必须绘制该标记`);
  assert.equal(
    S.showsRoiOverlay(stage),
    S.canHitRoiHandle(stage),
    `步骤 ${stage}：ROI「看得见手柄」与「点得中手柄」必须同真同假`,
  );
}
// 步骤 4 的具体语义（本轮推敲后确定，别再改回"两态一致"）
assert.equal(S.canPickYCalibMark(S.STAGE.CLEANUP, 'ycalib'), false, '步骤4 清理不允许再拾取 Y 点');
assert.equal(S.showsYCalibMarks(S.STAGE.CLEANUP), true, '步骤4 仍须显示已拾取的 Y1/Y2');
console.log('✔ 「能点 ⟹ 能画」成立，且 ROI 手柄绘制/命中成对');

// ---------------------------------------------------------------------------
// 2. 分列（步骤 5）绝不能提前描出花粉轮廓与锚点
//    （用户反馈：「为什么分列就直接描列图形轮廓了？？」）
// ---------------------------------------------------------------------------
assert.equal(S.showsPollenCurves(S.STAGE.SPLIT, 9), false, '步骤5 分列不得画花粉曲线/锚点');
assert.equal(S.showsPollenCurves(S.STAGE.CALIBRATE_COLUMNS, 9), false, '步骤6 标定列也不该画');
assert.equal(S.showsPollenCurves(S.STAGE.SPEARS_AND_SAMPLES, 9), true, '步骤7 拐点必须画');
assert.equal(S.showsPollenCurves(S.STAGE.QA, 9), true, '步骤8 校验继续显示');
assert.equal(S.showsPollenCurves(S.STAGE.SPEARS_AND_SAMPLES, 0), false, '没有列时不该画');
console.log('✔ 花粉曲线只在步骤 7 起出现');

// ---------------------------------------------------------------------------
// 3. 深度标尺：步骤 3 标定完就能画，4 清理 / 5 分列 不画
//    （设计稿 §1.1：把 Y 标定放前面，是因为标定后深度标尺即可绘制）
// ---------------------------------------------------------------------------
assert.equal(S.showsDepthGrid(S.STAGE.Y_CALIB), true, '步骤3 标定后必须能画深度标尺');
assert.equal(S.showsDepthGrid(S.STAGE.CLEANUP), false, '步骤4 清理：画网格会抹黑图谱');
assert.equal(S.showsDepthGrid(S.STAGE.SPLIT), false, '步骤5 分列：同上');
assert.equal(S.showsDepthGrid(S.STAGE.CALIBRATE_COLUMNS), true, '步骤6 标定列必须有标尺');
assert.equal(S.showsDepthGrid(S.STAGE.SPEARS_AND_SAMPLES), true, '步骤7 采样层位必须有标尺');
assert.equal(S.showsDepthGrid(S.STAGE.ROI), false, '步骤2 还没标定，不画');
console.log('✔ 深度标尺时机与设计稿 §1.1 一致');

// ---------------------------------------------------------------------------
// 4. 列边界：一旦分列完成，跨步骤回退也不该突然消失
// ---------------------------------------------------------------------------
assert.equal(S.showsColumnBoundaries(S.STAGE.SPLIT, 9), true, '分列后必须显示列边界');
assert.equal(S.showsColumnBoundaries(S.STAGE.Y_CALIB, 9), true, '回到步骤3，已分的列不该消失');
assert.equal(S.showsColumnBoundaries(S.STAGE.SPLIT, 0), false, '没列就不画');
console.log('✔ 列边界一旦存在持续可见');

// ---------------------------------------------------------------------------
// 5. visibleLayers：给 e2e / 调试句柄用的权威能力清单
// ---------------------------------------------------------------------------
const layersAt5 = S.visibleLayers(S.STAGE.SPLIT, { hasImage: true, columnCount: 9 });
assert.ok(layersAt5.includes('background'), '步骤5 底图必须在');
assert.ok(layersAt5.includes('roi'), '步骤5 ROI 必须在');
assert.ok(!layersAt5.includes('pollenCurves'), '步骤5 不得含 pollenCurves');
assert.ok(!layersAt5.includes('anchors'), '步骤5 不得含 anchors');

const layersAt7 = S.visibleLayers(S.STAGE.SPEARS_AND_SAMPLES, { hasImage: true, columnCount: 9 });
assert.ok(layersAt7.includes('pollenCurves'), '步骤7 应含 pollenCurves');
assert.ok(layersAt7.includes('depthGrid'), '步骤7 应含 depthGrid');
console.log('✔ visibleLayers 权威能力清单正确');

console.log('\n🎉 工作流步骤→能力映射回归测试通过！');
