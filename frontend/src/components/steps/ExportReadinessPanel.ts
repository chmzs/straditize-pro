import type { DiagramData } from '../../types/pollen.ts';
import { renderExportSuspectBlockRow } from './SuspectBlockNotice.ts';
import { isColumnCalibrated } from '../../core/calibProgress.ts';

export interface ExportReadinessState {
  sheets: string[];
  primaryRoi: string;
  primaryRoiId: string;
  readinessMissing: string[];
  allReady: boolean;
}

export function computeExportReadiness(data: DiagramData): ExportReadinessState {
  const rois =
    data.rois && data.rois.length > 0
      ? data.rois
      : [{ id: 'pollen', name: 'pollen', name_source: 'default', visible: true, xlim: [0, 100], ylim: [0, 100], columns_stale: false, form_defaults: null }];

  const primaryRoiId: string = data.primary_roi_id || rois[0].id || 'pollen';
  const primaryRoiObj = rois.find((r) => r.id === primaryRoiId) || rois[0];
  const primaryRoi: string = primaryRoiObj.name || primaryRoiObj.id || 'pollen';

  const sheets: string[] = rois.map((r) => r.name || r.id || 'roi');
  const readinessMissing: string[] = [];

  for (const r of rois) {
    const rName: string = r.name || r.id || 'roi';
    const nameSource = r.name_source || 'default';
    const cols = (data.columns || []).filter((c) => c.roi_id === r.id);

    // 仅在多 ROI 且仍为默认名，或任何 ROI 无属种列时记入未就绪
    // 单 ROI 项目使用默认名 'pollen' 是标准且完备的，不作未就绪阻拦
    const isUnnamed = rois.length > 1 ? nameSource === 'default' : false;
    if (isUnnamed || cols.length === 0) {
      readinessMissing.push(rName);
    }
  }

  return {
    sheets,
    primaryRoi,
    primaryRoiId,
    readinessMissing,
    allReady: readinessMissing.length === 0,
  };
}

export function renderExportReadiness(data: DiagramData, backendConnected: boolean = true): string {
  const state = computeExportReadiness(data);
  const sheetsStr = `[${state.sheets.join(',')}]`;
  const missingStr = `[${state.readinessMissing.join(',')}]`;

  const cols = data.columns || [];
  // 与步骤 6 进度条、列徽标用**同一判据**：后端写入组级斜率时会主动清空各列的
  // `x_ticks`（roi.py:470-478），所以"只认 x_ticks.length===2"会把所有通过组斜率
  // 标定的列算成未标定 —— 用户写完组斜率，这里仍报"0 列已标定"。
  const calibratedCount = cols.filter((c) => isColumnCalibrated(c)).length;
  const uncalibratedCount = cols.length - calibratedCount;

  const badgeStyle = !backendConnected
    ? 'background: var(--bg-secondary); color: var(--text-muted); border: 1px solid var(--border-color);'
    : state.allReady
      ? 'background: var(--pill-success-bg); color: var(--pill-success-text);'
      : 'background: var(--pill-warning-bg); color: var(--pill-warning-text);';
  const badgeText = !backendConnected
    ? '后端未连接 · 就绪度未知'
    : state.allReady
      ? '✓ 已就绪'
      : `待完善 (${state.readinessMissing.length})`;

  return `
    <div id="export-readiness-container" class="export-readiness-box"
         data-sheets="${state.sheets.join(',')}"
         data-primary="${state.primaryRoi}"
         data-readiness-missing="${state.readinessMissing.join(',')}"
         style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light); margin-bottom: 0;${!backendConnected ? ' opacity: 0.72;' : ''}">
      <div style="font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: var(--font-size-sm); color: var(--text-primary);">数据就绪状态</span>
        <span style="font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 9999px; font-weight: 500; ${badgeStyle}">
          ${badgeText}
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.5;">
        <div style="display: flex; justify-content: space-between; gap: 6px;">
          <span>导出分表:</span>
          <strong id="lbl-export-sheets" style="color: var(--accent-blue); font-weight: 600;">${sheetsStr}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 6px;">
          <span>主工作区:</span>
          <span><strong id="lbl-export-primary" style="color: var(--status-success); font-weight: 600;">${state.primaryRoi}</strong></span>
        </div>
        <div style="display: none;"><span id="lbl-export-data-csv-owner">data.csv ← 主 ROI（由后端生成，导出时逐字节校验）</span></div>
        <div style="display: flex; justify-content: space-between; gap: 6px;">
          <span>属种标定:</span>
          <span id="lbl-export-calibration-status">${calibratedCount} 列已标定${uncalibratedCount > 0 ? ` / <strong style="color: var(--status-warning); font-weight: 600;">${uncalibratedCount} 列未标定</strong>` : ''}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 6px;">
          <span>缺失清单:</span>
          <strong id="lbl-export-missing" style="color: ${state.readinessMissing.length > 0 ? 'var(--status-danger)' : 'var(--text-muted)'}; font-weight: ${state.readinessMissing.length > 0 ? '600' : 'normal'};">${missingStr}</strong>
        </div>
      </div>
      ${renderExportSuspectBlockRow(data)}
      ${
        !backendConnected
          ? `<div style="margin-top: 6px; font-size: var(--font-size-xs); color: var(--text-muted); line-height: 1.4; padding: 4px 6px; background: var(--bg-secondary); border-radius: 4px;">
               后端未连接，无法核验真实就绪状态；请先启动或重连后端。
             </div>`
          : state.readinessMissing.length > 0
            ? `<div style="margin-top: 6px; font-size: var(--font-size-xs); color: var(--status-warning); line-height: 1.4; padding: 4px 6px; background: rgba(245, 158, 11, 0.08); border-radius: 4px;">
                 提示：存在未命名或无属种列的分区，已列入缺失清单。
               </div>`
            : ''
      }
    </div>
  `;
}
