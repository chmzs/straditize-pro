import { DiagramData } from '../../types/pollen';

export interface ExportReadinessState {
  sheets: string[];
  primaryRoi: string;
  primaryRoiId: string;
  dataCsvEqualsPrimary: boolean;
  readinessMissing: string[];
  allReady: boolean;
}

export function computeExportReadiness(data: DiagramData): ExportReadinessState {
  const rois =
    data.rois && data.rois.length > 0
      ? data.rois
      : [{ id: 'pollen', name: 'pollen', name_source: 'default', visible: true, xlim: [0, 100], ylim: [0, 100], columns_stale: false, form_defaults: null }];

  const primaryRoiId: string = data.primary_roi_id || (data as any).primaryRoiId || rois[0].id || 'pollen';
  const primaryRoiObj = rois.find((r) => r.id === primaryRoiId) || rois[0];
  const primaryRoi: string = primaryRoiObj.name || primaryRoiObj.id || 'pollen';

  const sheets: string[] = rois.map((r) => r.name || r.id || 'roi');
  const readinessMissing: string[] = [];

  for (const r of rois) {
    const rName: string = r.name || r.id || 'roi';
    const nameSource = r.name_source || 'default';
    const cols = (data.columns || []).filter((c) => c.roi_id === r.id);

    // 判断"是否已命名"读 DataRoi.name_source（不得靠"名字是否等于 pollen"猜）
    // 无列 ROI 必须在就绪清单里列出而非静默跳过
    if (nameSource === 'default' || cols.length === 0) {
      readinessMissing.push(rName);
    }
  }

  return {
    sheets,
    primaryRoi,
    primaryRoiId,
    dataCsvEqualsPrimary: true,
    readinessMissing,
    allReady: readinessMissing.length === 0,
  };
}

export function renderExportReadiness(data: DiagramData): string {
  const state = computeExportReadiness(data);
  const sheetsStr = `[${state.sheets.join(',')}]`;
  const missingStr = `[${state.readinessMissing.join(',')}]`;

  const cols = data.columns || [];
  const calibratedCount = cols.filter(
    (c) => Array.isArray(c.x_ticks) && c.x_ticks.length === 2
  ).length;
  const uncalibratedCount = cols.length - calibratedCount;

  return `
    <div id="export-readiness-container" class="export-readiness-box"
         data-sheets="${state.sheets.join(',')}"
         data-primary="${state.primaryRoi}"
         data-data-csv-equals-primary="true"
         data-readiness-missing="${state.readinessMissing.join(',')}"
         style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light); margin-bottom: 12px; font-size: 11px;">
      <div style="font-weight: 700; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
        <span>导出就绪状态清单 (Export Readiness)</span>
        <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; ${state.allReady ? 'background: #dcfce7; color: #166534;' : 'background: #fef3c7; color: #92400e;'}">
          ${state.allReady ? '✓ 全部就绪' : `待完善 (${state.readinessMissing.length})`}
        </span>
      </div>

      <div style="line-height: 1.6; font-size: 10.5px;">
        <div>• 导出分表 (SHEETS): <strong id="lbl-export-sheets" style="color: var(--accent-blue);">${sheetsStr}</strong></div>
        <div>• 主工作区 (PRIMARY_ROI): <strong id="lbl-export-primary" style="color: var(--accent-green, #10b981);">${state.primaryRoi}</strong> (对应归档 <code>data.csv</code>)</div>
        <div>• 根数据归属: <span id="lbl-export-data-csv-primary">DATA_CSV_EQUALS_PRIMARY=true</span></div>
        <div>• 属种刻度标定: <span id="lbl-export-calibration-status">${calibratedCount} 列已标定${uncalibratedCount > 0 ? ` / <strong style="color: #f59e0b;">${uncalibratedCount} 列未标定</strong> (按列宽百分比估算)` : ' (全部已标定)'}</span></div>
        <div>• 未就绪清单 (READINESS_MISSING): <strong id="lbl-export-missing" style="color: ${state.readinessMissing.length > 0 ? '#ef4444' : 'var(--text-muted)'};">${missingStr}</strong></div>
      </div>
      ${
        state.readinessMissing.length > 0
          ? `<div style="margin-top: 6px; font-size: 10px; color: #b45309; line-height: 1.4;">
               提示：未命名（使用默认名）或无属种列的 ROI 将列在未就绪清单中。请在步骤 2 中命名或为其划分属种列。
             </div>`
          : ''
      }
    </div>
  `;
}
