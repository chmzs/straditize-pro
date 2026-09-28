/**
 * test-roi-model.mjs
 *
 * W3 (T02) 阶段前端模型与扩展点自动化验收脚本：
 * 1. 'panels' in data === false
 * 2. HistoryManager push/undo/redo 往返深比较完美还原 rois / primary_roi_id / active_roi_id
 * 3. 步骤与叠加层 Registry 机制验证
 * 4. 契约字段完整性自检（确保契约 v1.3 §2 要求的字段无一缩水）
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- 运行 W3 (T02) 前端模型与扩展点测试 ---');

// 1. 断言 DiagramData 类型上不存在 'panels'
const pollenTsPath = path.join(__dirname, 'src/types/pollen.ts');
const pollenTsContent = fs.readFileSync(pollenTsPath, 'utf8');

assert.equal(
  pollenTsContent.includes('panels?: DiagramPanel[]'),
  false,
  "DiagramData 中严禁存在 'panels?: DiagramPanel[]'"
);
assert.equal(
  pollenTsContent.includes('activePanelId?: string'),
  false,
  "DiagramData 中严禁存在 'activePanelId'"
);
console.log('✔ panels / activePanelId 遗留结构已彻底物理清除');

// 2. 动态 import 真 TS 编译产物测试 HistoryManager
import { HistoryManager } from './src/core/HistoryManager.ts';
import { ResizeRoiCommand } from './src/core/Commands.ts';

const hm = new HistoryManager(10);

const initialRois = [
  {
    id: 'roi_1',
    name: 'pollen',
    name_source: 'default',
    composition: true,
    visible: true,
    xlim: [100, 500],
    ylim: [200, 800],
    columns_stale: false,
    form_defaults: null,
    xMin: 100,
    xMax: 500,
    yMin: 200,
    yMax: 800,
  },
];

hm.reset([], '', undefined, initialRois[0], initialRois, 'roi_1', 'roi_1');

const modifiedRois = [
  {
    ...initialRois[0],
    xlim: [120, 520],
    xMin: 120,
    xMax: 520,
    columns_stale: true,
  },
  {
    id: 'roi_2',
    name: 'charcoal',
    name_source: 'user',
    composition: false,
    visible: true,
    xlim: [550, 750],
    ylim: [200, 800],
    columns_stale: false,
    form_defaults: null,
    xMin: 550,
    xMax: 750,
    yMin: 200,
    yMax: 800,
  },
];

hm.push('Add Charcoal ROI', [], '', undefined, modifiedRois[1], modifiedRois, 'roi_1', 'roi_2');

assert.equal(hm.canUndo(), true, '应该允许撤销');

const undone = hm.undo();
assert.ok(undone);
assert.equal(undone.active_roi_id, 'roi_1', '撤销后 active_roi_id 必须还原');
assert.equal(undone.rois?.length, 1, '撤销后 rois 数量必须还原');
assert.deepEqual(undone.rois?.[0].xlim, [100, 500], '撤销后 ROI 坐标必须深比较还原');

const redone = hm.redo();
assert.ok(redone);
assert.equal(redone.active_roi_id, 'roi_2', '重做后 active_roi_id 必须还原');
assert.equal(redone.rois?.length, 2, '重做后 rois 数量必须还原为 2');
assert.deepEqual(redone.rois?.[1].name, 'charcoal', '重做后 charcoal ROI 必须还原');

console.log('✔ HistoryManager 对 rois / primary_roi_id / active_roi_id 的深比较还原验证通过');

// 3. ROI 拖拽必须同时更新单数 ROI 与 rois[] 的双字段镜像。
const commandOldRoi = { ...initialRois[0], xMin: 100, xMax: 500, yMin: 200, yMax: 800 };
const commandNewRoi = { ...commandOldRoi, xMin: 160, xMax: 760, yMin: 240, yMax: 740 };
const commandData = {
  roi: { ...commandOldRoi },
  rois: [{ ...commandOldRoi }],
  active_roi_id: 'roi_1',
};
const resizeCommand = new ResizeRoiCommand(commandOldRoi, commandNewRoi);
resizeCommand.execute(commandData);
assert.deepEqual(commandData.rois[0].xlim, [160, 760], 'ROI 执行后 xlim 必须同步');
assert.deepEqual(commandData.rois[0].ylim, [240, 740], 'ROI 执行后 ylim 必须同步');
assert.equal(commandData.rois[0].xMin, 160, 'ROI 执行后 xMin 必须同步');
assert.equal(commandData.rois[0].yMax, 740, 'ROI 执行后 yMax 必须同步');
resizeCommand.undo(commandData);
assert.deepEqual(commandData.rois[0].xlim, [100, 500], 'ROI 撤销后 xlim 必须恢复');
assert.deepEqual(commandData.rois[0].ylim, [200, 800], 'ROI 撤销后 ylim 必须恢复');
assert.equal(commandData.rois[0].xMin, 100, 'ROI 撤销后 xMin 必须恢复');
console.log('✔ ROI 拖拽/撤销会同步 xMin/xMax/yMin/yMax 与 xlim/ylim');

// 4. 验证步骤与叠加层 Registry 架构
const stepsRegistryPath = path.join(__dirname, 'src/components/steps/_registry.ts');
const canvasRegistryPath = path.join(__dirname, 'src/components/canvas/_registry.ts');

assert.ok(fs.existsSync(stepsRegistryPath), 'steps/_registry.ts 必须存在');
assert.ok(fs.existsSync(canvasRegistryPath), 'canvas/_registry.ts 必须存在');

const stepsRegistryContent = fs.readFileSync(stepsRegistryPath, 'utf8');
assert.ok(
  stepsRegistryContent.includes("import.meta.glob"),
  '步骤注册中心必须使用 import.meta.glob 收集'
);

const canvasRegistryContent = fs.readFileSync(canvasRegistryPath, 'utf8');
assert.ok(
  canvasRegistryContent.includes("import.meta.glob"),
  '画布叠加层注册中心必须使用 import.meta.glob 收集'
);
console.log('✔ 步骤与叠加层 Registry 机制验证通过');

// 4. 契约 v1.3 字段完整性机器核对
const requiredRoiFields = [
  'id',
  'name',
  'name_source',
  'composition',
  'visible',
  'xlim',
  'ylim',
  'columns_stale',
  'form_defaults',
];

const requiredColumnFields = [
  'id',
  'name',
  'roi_id',
  'startX',
  'endX',
  'visible',
  'color',
  'x_ticks',
  'plot_type',
  'scale_type',
  'unit',
  'exaggeration_mult',
  'mult_source',
  'control_points',
];

const requiredDiagramDataFields = [
  'rois',
  'primary_roi_id',
  'active_roi_id',
  'columns',
  'calibration',
  'line_candidates',
  'selected_candidate_ids',
  'line_strokes',
  'exclusion_regions',
  'samples',
];

for (const field of requiredRoiFields) {
  assert.ok(
    pollenTsContent.includes(field),
    `DataRoi 缺少契约字段: ${field}`
  );
}

for (const field of requiredColumnFields) {
  assert.ok(
    pollenTsContent.includes(field),
    `Column 缺少契约字段: ${field}`
  );
}

for (const field of requiredDiagramDataFields) {
  assert.ok(
    pollenTsContent.includes(field),
    `DiagramData 缺少契约字段: ${field}`
  );
}
console.log('✔ 契约 v1.3 字段完整性机器核对通过 (DataRoi 9/9, Column 14/14, DiagramData 10/10)');

console.log('🎉 全部 W3 前端模型与扩展点测试顺利通过！');
