import assert from 'node:assert/strict';
import { renderExportReadiness } from './src/components/steps/ExportReadinessPanel.ts';

const readyData = {
  imageSrc: '/image/current',
  imageWidth: 1000,
  imageHeight: 500,
  rois: [
    {
      id: 'roi_1',
      name: 'pollen',
      name_source: 'user',
      composition: true,
      visible: true,
      xlim: [100, 900],
      ylim: [50, 450],
      columns_stale: false,
      form_defaults: null,
    },
  ],
  primary_roi_id: 'roi_1',
  active_roi_id: 'roi_1',
  roi: {
    id: 'roi_1',
    name: 'pollen',
    name_source: 'user',
    composition: true,
    visible: true,
    xlim: [100, 900],
    ylim: [50, 450],
    columns_stale: false,
    form_defaults: null,
    xMin: 100,
    xMax: 900,
    yMin: 50,
    yMax: 450,
  },
  calibration: {
    isCalibrated: true,
    top_px: 50,
    top_cm: 0,
    bottom_px: 450,
    bottom_cm: 100,
    unit: 'cm',
  },
  line_candidates: [],
  selected_candidate_ids: [],
  line_strokes: [],
  exclusion_regions: [],
  samples: [],
  columns: [
    {
      id: 'c1',
      col_index: 0,
      name: 'Pinus',
      startX: 100,
      endX: 200,
      roi_id: 'roi_1',
      scale_provenance: { calibrated: true, source: 'group_slope' },
    },
  ],
  activeTaxaId: 'c1',
  selectedEntity: null,
};

const onlineHtml = renderExportReadiness(readyData, true);
assert.ok(onlineHtml.includes('✓ 已就绪'), '在线时应显示 ✓ 已就绪');

const offlineHtml = renderExportReadiness(readyData, false);
assert.ok(!offlineHtml.includes('✓ 已就绪'), '后端断开时不得显示 ✓ 已就绪');
assert.ok(offlineHtml.includes('后端未连接'), '后端断开时应明确提示后端未连接');

console.log('✓ test-export-readiness-offline.mjs passed');
