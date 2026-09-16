import { Column, DiagramCalibration, DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { SplineInterpolator } from '../core/SplineInterpolator';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { TarArchive, TarFileEntry } from '../core/TarArchive';

export class PropertyPanel {
  private container: HTMLElement;
  private data: DiagramData;
  private rpcClient: RpcClient;
  private onCalibrationSave: (cal: DiagramCalibration) => void;
  private onProjectLoad?: (projectData: DiagramData) => void;

  constructor(
    container: HTMLElement,
    data: DiagramData,
    rpcClient: RpcClient,
    onCalibrationSave: (cal: DiagramCalibration) => void,
    onProjectLoad?: (projectData: DiagramData) => void
  ) {
    this.container = container;
    this.data = data;
    this.rpcClient = rpcClient;
    this.onCalibrationSave = onCalibrationSave;
    this.onProjectLoad = onProjectLoad;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
  }

  /**
   * 1. 渲染并打开标定设置模态框 (岩心范围 min, max, 单位整合为一行)
   */
  public openCalibrationModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const cal = this.data.calibration;

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>地层深度与图谱标定设置 (Calibration)</h3>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <!-- 岩心范围合并为单行：min 至 max，单位由用户自由输入 (cm / m / cal kyr BP) -->
          <div class="form-group">
            <label>岩心范围 (Core Depth Range):</label>
            <div class="input-row">
              <input type="number" id="cal-depth-top" value="${cal.depthTopValue}" step="any" placeholder="Min" title="岩心顶部/最年轻层位深度" />
              <span style="color: var(--text-muted);">至</span>
              <input type="number" id="cal-depth-bottom" value="${cal.depthBottomValue}" step="any" placeholder="Max" title="岩心底部/最老沉积层深度" />
              <input type="text" id="cal-unit" value="${cal.unit}" style="width: 80px;" placeholder="单位" title="自定义深度单位 (如 cm, m, cal kyr BP)" />
            </div>
            <small>设定地质剖面顶部 (Min) 至底部 (Max) 物理跨度与测量单位</small>
          </div>

          <div class="form-group">
            <label>沉积剖面图谱像素 Y 范围 (Y-Limits):</label>
            <div class="input-row">
              <input type="number" id="cal-ymin" value="${cal.dataYMin}" />
              <span style="color: var(--text-muted);">至</span>
              <input type="number" id="cal-ymax" value="${cal.dataYMax}" />
              <span class="unit-label">px</span>
            </div>
            <small>地学剖面有效图表像素纵轴范围</small>
          </div>

          <div class="form-group">
            <label>剖面标准采样间隔 (Depth Grid Interval):</label>
            <div class="input-row">
              <input type="number" id="cal-depth-interval" value="${cal.depthInterval ?? 2}" step="any" min="0.01" />
              <span class="unit-label">${cal.unit} / 层位</span>
            </div>
            <small>设定剖面采样间隔（例如从 ${cal.depthTopValue} 到 ${cal.depthBottomValue} ${cal.unit}，每隔 ${cal.depthInterval ?? 2} ${cal.unit} 作为一个标准层位）</small>
          </div>

          <div class="form-group">
            <div class="checkbox-row" style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <input type="checkbox" id="cal-depth-grid" ${cal.depthGridEnabled !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #38bdf8; cursor: pointer;" />
              <label for="cal-depth-grid" style="cursor: pointer; color: var(--text-primary); font-size: 12.5px; font-weight: 500;">
                在画布上显示水平淡蓝色层位标线 (Depth Grid Lines)
              </label>
            </div>
            <small style="margin-left: 24px;">贯穿所有属种列，确保数据直接锚定在这些固定的层位深度上</small>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-save">保存标定</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#modal-close')?.addEventListener('click', closeModal);
    modal.querySelector('#modal-cancel')?.addEventListener('click', closeModal);

    modal.querySelector('#modal-save')?.addEventListener('click', () => {
      const topVal = parseFloat((modal.querySelector('#cal-depth-top') as HTMLInputElement).value) || 0;
      const bottomVal = parseFloat((modal.querySelector('#cal-depth-bottom') as HTMLInputElement).value) || 100;
      const unitVal = (modal.querySelector('#cal-unit') as HTMLInputElement).value.trim() || 'cm';
      const yMin = parseInt((modal.querySelector('#cal-ymin') as HTMLInputElement).value, 10) || cal.dataYMin;
      const yMax = parseInt((modal.querySelector('#cal-ymax') as HTMLInputElement).value, 10) || cal.dataYMax;
      const intervalVal = parseFloat((modal.querySelector('#cal-depth-interval') as HTMLInputElement).value) || 2;
      const gridEnabledVal = (modal.querySelector('#cal-depth-grid') as HTMLInputElement).checked;

      const newCal: DiagramCalibration = {
        ...this.data.calibration,
        depthTopValue: topVal,
        depthBottomValue: bottomVal,
        unit: unitVal,
        dataYMin: yMin,
        dataYMax: yMax,
        depthInterval: intervalVal,
        depthGridEnabled: gridEnabledVal,
        isCalibrated: true,
      };

      this.onCalibrationSave(newCal);
      closeModal();
    });
  }

  /**
   * 2. 导出界面重构 (对齐 WebPlotDigitizer / WPD 专业科学数据导出面板，支持排序、格式化、一键复制、下载与 riojaPlot 在线绘图)
   */
  public openExportModal(_initialContent: string = '', _format: 'csv' | 'json' = 'csv'): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';

    modal.innerHTML = `
      <div class="modal-dialog modal-large wpd-export-dialog">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <h3>数字化数据导出与在线成图 (Acquired Data & Visualize)</h3>
          </div>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>

        <div class="modal-body wpd-modal-body" style="display: flex; gap: 16px; padding: 16px;">
          <!-- 左侧：大文本数据预览区 -->
          <div class="wpd-left-area" style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
              <span>Variables: <strong id="wpd-vars-label" style="color: var(--accent-blue);">Depth, All Taxa (29)</strong></span>
              <span id="wpd-data-size-label">0 KB</span>
            </div>
            <textarea id="wpd-data-textarea" class="export-textarea" style="flex: 1; height: 320px; font-family: var(--font-mono); font-size: 11px; line-height: 1.45;" readonly></textarea>
          </div>

          <!-- 右侧：WPD 风格的控制面板 (Dataset, Sort, Format, Visualize) -->
          <div class="wpd-right-controls" style="width: 260px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light);">
            <!-- 数据集选择 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Dataset (数据集形态):</label>
              <select id="wpd-dataset-select" class="sample-select" style="width: 100%; font-size: 11px;">
                <option value="depth_grid" selected>1. 标准深度层位网格 [推荐: 无NA/全属种对齐]</option>
                <option value="union_points">2. 全属种特征层位并集矩阵 [无NA/极值全捕获]</option>
                <option value="turning_points">3. 离散拐点稀疏特征清单 [原始坐标表]</option>
              </select>
            </div>

            <!-- 排序 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Sort (排序):</label>
              <div style="display: flex; gap: 6px;">
                <select id="wpd-sort-by" class="sample-select" style="flex: 1; font-size: 11px;">
                  <option value="depth" selected>Depth (深度)</option>
                  <option value="raw">Raw (原始)</option>
                </select>
                <select id="wpd-sort-order" class="sample-select" style="flex: 1; font-size: 11px;">
                  <option value="asc" selected>升序 (顶->底)</option>
                  <option value="desc">降序 (底->顶)</option>
                </select>
              </div>
            </div>

            <!-- 格式化 Format -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Format (格式化):</label>
              <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">浮点精度:</span>
                  <input type="number" id="wpd-digits" value="2" min="0" max="6" style="width: 60px; font-size: 11px;" />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">列分隔符:</span>
                  <select id="wpd-col-sep" class="sample-select" style="width: 80px; font-size: 11px;">
                    <option value="," selected>逗号 (,)</option>
                    <option value="\t">Tab (\\t)</option>
                    <option value=";">分号 (;)</option>
                    <option value=" ">空格 ( )</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">缺测填充:</span>
                  <select id="wpd-na-fill" class="sample-select" style="width: 80px; font-size: 11px;">
                    <option value="0.0" selected>0.0 (地学)</option>
                    <option value="NaN">NaN</option>
                    <option value="NA">NA</option>
                    <option value="">(空)</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="divider" style="margin: 2px 0;"></div>

            <!-- 数据与发表级脚本说明 (Section 八: R 脚本本地出图) -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: #38bdf8;">科研发表级成果导出:</label>
              <p style="font-size: 10px; color: var(--text-muted); line-height: 1.4; margin-bottom: 6px;">
                支持一键生成无 NA 地学标准丰度表、基于 <code>rioja::strat.plot</code> 的自动化出图 R 脚本及 POSIX UStar 标准项目归档。
              </p>
              <div style="background: rgba(15, 23, 42, 0.5); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light); font-size: 10px; color: var(--text-muted); line-height: 1.4;">
                <div style="color: #f59e0b; font-weight: 600; margin-bottom: 2px;">📌 地学科学规范：</div>
                <div>• 未出现属种严格填报 <code>0.00</code></div>
                <div>• 对数分析请自行添加伪计数 (如 +0.01)</div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 10px; color: var(--text-muted);">
            * 提示：未出现属种严格输出 0.0；可直接导出配套 R 脚本与标准 TAR 归档。
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary" id="btn-wpd-copy">📋 复制</button>
            <button class="btn btn-primary" id="btn-wpd-download-csv">💾 下载 CSV</button>
            <button class="btn btn-secondary" id="btn-wpd-download-r" title="下载配套 R 语言地层绘图脚本 (rioja::strat.plot)">📈 R 脚本</button>
            <button class="btn btn-secondary" id="btn-wpd-download-tar" title="下载包含数据、原图与 R 脚本的标准 TAR 归档包">📦 导出 TAR 包</button>
            <button class="btn btn-secondary" id="btn-wpd-download-json">JSON</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#modal-close')?.addEventListener('click', closeModal);

    const textarea = modal.querySelector('#wpd-data-textarea') as HTMLTextAreaElement;
    const datasetSelect = modal.querySelector('#wpd-dataset-select') as HTMLSelectElement;
    const sortBySelect = modal.querySelector('#wpd-sort-by') as HTMLSelectElement;
    const sortOrderSelect = modal.querySelector('#wpd-sort-order') as HTMLSelectElement;
    const digitsInp = modal.querySelector('#wpd-digits') as HTMLInputElement;
    const colSepSelect = modal.querySelector('#wpd-col-sep') as HTMLSelectElement;
    const naFillSelect = modal.querySelector('#wpd-na-fill') as HTMLSelectElement;
    const varsLabel = modal.querySelector('#wpd-vars-label') as HTMLElement;
    const sizeLabel = modal.querySelector('#wpd-data-size-label') as HTMLElement;

    // 动态生成表格数据
    const generateFormattedData = (): string => {
      const dataset = datasetSelect.value;
      const digits = parseInt(digitsInp.value, 10) || 2;
      const sep = colSepSelect.value === '\\t' ? '\t' : colSepSelect.value;
      const naStr = naFillSelect.value;
      const isDesc = sortOrderSelect.value === 'desc';

      const cal = this.data.calibration;
      const visibleCols = this.data.columns.filter((c) => c.visible);

      if (dataset === 'turning_points') {
        varsLabel.textContent = 'Taxon, Type, Depth, Value, X, Y';
        const headers = ['Taxon', 'Type', `Depth_${cal.unit}`, 'Value', 'X_px', 'Y_px'];
        const rows: string[] = [headers.join(sep)];

        visibleCols.forEach((col) => {
          const pts = [...col.controlPoints].sort((a, b) => (isDesc ? b.y - a.y : a.y - b.y));
          pts.forEach((pt) => {
            const depth = CoordinateSystem.imageYToDepth(pt.y, cal);
            const val = CoordinateSystem.imageXToPercent(pt.x, col);
            rows.push(
              [
                col.name,
                pt.type || 'transition',
                depth !== undefined ? depth.toFixed(digits) : naStr,
                val !== undefined ? val.toFixed(digits) : naStr,
                pt.x,
                pt.y,
              ].join(sep)
            );
          });
        });
        return rows.join('\n');
      }

      // 全属种特征层位并集矩阵 (Union of All Turning Points - 收集所有列的全部特征 Y，并进行无缝线性插值，保证 0 个 NA)
      if (dataset === 'union_points') {
        varsLabel.textContent = `Depth_${cal.unit}, ${visibleCols.length} Taxa (Union Horizons: 0 NA)`;
        const allYSet = new Set<number>();
        visibleCols.forEach((col) => {
          col.controlPoints.forEach((pt) => allYSet.add(pt.y));
        });
        const sortedY = Array.from(allYSet).sort((a, b) => (isDesc ? b - a : a - b));

        const headers = [`Depth_${cal.unit}`, ...visibleCols.map((c) => c.name)];
        const rows: string[] = [headers.join(sep)];

        for (const y of sortedY) {
          const depth = CoordinateSystem.imageYToDepth(y, cal);
          const rowVals: string[] = [depth !== undefined ? depth.toFixed(digits) : naStr];

          for (const col of visibleCols) {
            const v = SplineInterpolator.interpolatePercentAtY(col, y);
            rowVals.push(v !== undefined && !isNaN(v) ? v.toFixed(digits) : naStr);
          }
          rows.push(rowVals.join(sep));
        }
        return rows.join('\n');
      }

      // 标准深度层位网格 (Depth Horizons - 标准等间距采样，无错位，0 个 NA)
      varsLabel.textContent = `Depth_${cal.unit}, ${visibleCols.length} Taxa`;
      const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal);
      const headers = [`Depth_${cal.unit}`, ...visibleCols.map((c) => c.name)];
      const rows: string[] = [headers.join(sep)];

      const indices = Array.from({ length: depths.length }, (_, i) => i);
      if (isDesc) indices.reverse();

      for (const i of indices) {
        const d = depths[i];
        const y = yPositions[i];
        const rowVals: string[] = [d.toFixed(digits)];

        for (const col of visibleCols) {
          const v = SplineInterpolator.interpolatePercentAtY(col, y);
          if (v !== undefined && !isNaN(v)) {
            rowVals.push(v.toFixed(digits));
          } else {
            rowVals.push(naStr);
          }
        }
        rows.push(rowVals.join(sep));
      }

      return rows.join('\n');
    };

    const updateDisplay = () => {
      const dataStr = generateFormattedData();
      textarea.value = dataStr;
      sizeLabel.textContent = `${(dataStr.length / 1024).toFixed(1)} KB (${dataStr.split('\n').length} rows)`;
    };

    datasetSelect.addEventListener('change', updateDisplay);
    sortBySelect.addEventListener('change', updateDisplay);
    sortOrderSelect.addEventListener('change', updateDisplay);
    digitsInp.addEventListener('input', updateDisplay);
    colSepSelect.addEventListener('change', updateDisplay);
    naFillSelect.addEventListener('change', updateDisplay);

    updateDisplay();

    // 复制到剪贴板
    const copyBtn = modal.querySelector('#btn-wpd-copy') as HTMLButtonElement;
    copyBtn?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = '✅ 已复制!';
      setTimeout(() => (copyBtn.textContent = '📋 复制到剪贴板'), 1500);
    });

    // 下载 CSV
    modal.querySelector('#btn-wpd-download-csv')?.addEventListener('click', () => {
      const blob = new Blob([textarea.value], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `straditize_pollen_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // 下载 JSON
    modal.querySelector('#btn-wpd-download-json')?.addEventListener('click', () => {
      const jsonStr = JSON.stringify(this.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `straditize_data_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // 下载配套 R 语言地层图绘图脚本 (rioja::strat.plot)
    modal.querySelector('#btn-wpd-download-r')?.addEventListener('click', () => {
      const rScript = PropertyPanel.generateRScript(this.data.columns, this.data.calibration.unit || 'cm');
      const blob = new Blob([rScript], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plot_strat.R';
      a.click();
      URL.revokeObjectURL(url);
    });

    // 导出项目包 (.tar)
    modal.querySelector('#btn-wpd-download-tar')?.addEventListener('click', () => {
      this.saveProjectFile();
    });
  }

  /**
   * 3. 项目化保存为开放标准 .tar 归档 (POSIX UStar)
   * 包含 manifest.json, image/original.png, straditize.json, data.csv, plot_strat.R, README.txt
   */
  public async saveProjectFile(): Promise<void> {
    const cal = this.data.calibration;

    // 1. manifest.json (元数据、版本与时间戳)
    const manifestJson = {
      version: '2.0.0',
      tool: 'straditize pro',
      timestamp: new Date().toISOString(),
      schema_version: '2.0',
    };

    // 2. straditize.json (矢量项目模型：ROI、列、两点刻度、控制拐点)
    const straditizeJson = {
      version: '2.0.0',
      image: {
        path: 'image/original.png',
        width: this.data.imageWidth,
        height: this.data.imageHeight,
      },
      depth_calibration: {
        top_px: cal.top_px ?? cal.dataYMin,
        bottom_px: cal.bottom_px ?? cal.dataYMax,
        top_cm: cal.top_cm ?? cal.depthTopValue,
        bottom_cm: cal.bottom_cm ?? cal.depthBottomValue,
        unit: cal.unit || 'cm',
        depthInterval: cal.depthInterval || 2,
        depthGridEnabled: cal.depthGridEnabled ?? true,
        isCalibrated: cal.isCalibrated ?? true,
      },
      roi: {
        x: cal.dataXMin,
        y: cal.dataYMin,
        w: cal.dataXMax - cal.dataXMin,
        h: cal.dataYMax - cal.dataYMin,
      },
      columns: this.data.columns.map((col) => ({
        id: col.id,
        species: col.name,
        name: col.name,
        color: col.color,
        visible: col.visible,
        scale_type: col.scale_type || 'linear',
        startX: col.startX,
        startValue: col.startValue ?? (col.scaleCalib?.originVal ?? 0),
        tickEndX: col.tickEndX ?? col.endX,
        tickValue: col.tickValue ?? (col.scaleCalib?.calibVal ?? col.maxPercent ?? 100),
        endX: col.endX,
        curveType: col.curveType,
        unit: col.unit,
        points: (col.controlPoints || []).map((pt) => ({
          x: pt.x,
          y: pt.y,
          value: pt.value ?? CoordinateSystem.imageXToValue(pt.x, col),
          kind: pt.kind || (pt.type === 'manual' || pt.isManual ? 'manual' : 'peak'),
          valid_segment: pt.valid_segment ?? true,
        })),
        controlPoints: col.controlPoints,
        scaleCalib: col.scaleCalib,
      })),
      calibration: cal,
      activeTaxaId: this.data.activeTaxaId,
    };

    const entries: TarFileEntry[] = [];

    // 1. 添加 manifest.json
    entries.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(JSON.stringify(manifestJson, null, 2)),
    });

    // 2. 添加 straditize.json
    entries.push({
      name: 'straditize.json',
      data: new TextEncoder().encode(JSON.stringify(straditizeJson, null, 2)),
    });

    // 3. 将当前底图转为二进制加入 tar (存为 image/original.png)
    try {
      if (this.data.imageSrc) {
        let imageBytes: Uint8Array | null = null;
        if (this.data.imageSrc.startsWith('data:')) {
          const parts = this.data.imageSrc.split(',');
          const binStr = atob(parts[1] || '');
          const len = binStr.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = binStr.charCodeAt(i);
          imageBytes = u8;
        } else {
          const resp = await fetch(this.data.imageSrc);
          const buf = await resp.arrayBuffer();
          imageBytes = new Uint8Array(buf);
        }

        if (imageBytes) {
          entries.push({
            name: 'image/original.png',
            data: imageBytes,
          });
        }
      }
    } catch (err) {
      console.warn('Failed to embed raw image into project tar:', err);
    }

    // 4. 添加标准 CSV 表格 data.csv (首列为深度，未出现属种严格填 0.0)
    const csvContent = this.generateStandardCsv();
    entries.push({
      name: 'data.csv',
      data: new TextEncoder().encode(csvContent),
    });

    // 5. 添加配套 R 绘图脚本 plot_strat.R (基于 rioja::strat.plot)
    const rScript = PropertyPanel.generateRScript(this.data.columns, this.data.calibration.unit || 'cm');
    entries.push({
      name: 'plot_strat.R',
      data: new TextEncoder().encode(rScript),
    });

    // 6. 添加说明文档 README.txt
    const readmeText = `Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)
================================================================

Archive File Hierarchy:
-----------------------
manifest.json      - Metadata, tool version, and timestamp.
image/original.png - High-resolution original stratigraphic diagram image.
straditize.json    - Full vector project model (ROI, columns, control points, calibrations).
data.csv           - Calibrated stratigraphic abundance matrix (Depth in 1st column, unobserved taxa = 0.0).
plot_strat.R       - Automated R script to render publication-quality diagram via rioja::strat.plot.
README.txt         - Archive documentation and scientific notices.

CRITICAL SCIENTIFIC NOTICES (Section 八):
----------------------------------------
1. In data.csv, unobserved taxa are strictly encoded as 0.0 (never NA).
2. Before taking log transformations or log-ratio calculations, please add an appropriate pseudocount (e.g. +0.01 or +0.1) to avoid log(0) undefined errors.

Reproduce Stratigraphic Diagram in R:
-------------------------------------
1. Extract tar archive:  tar -xf <filename>.tar
2. Run script:           Rscript plot_strat.R
`;
    entries.push({
      name: 'README.txt',
      data: new TextEncoder().encode(readmeText),
    });

    // 7. 打包为开放标准 .tar 并触发下载
    const tarData = TarArchive.create(entries);
    const blob = new Blob([tarData as unknown as BlobPart], { type: 'application/x-tar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `straditize_project_${Date.now()}.tar`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 生成地学标准 CSV 表格 (首列深度，未观察属种严格输出 0.0)
   */
  public generateStandardCsv(): string {
    const cal = this.data.calibration;
    const visibleCols = this.data.columns.filter((c) => c.visible);
    const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal);
    const headers = [`Depth_${cal.unit || 'cm'}`, ...visibleCols.map((c) => `"${c.name}"`)];
    const rows: string[] = [headers.join(',')];

    for (let i = 0; i < depths.length; i++) {
      const d = depths[i];
      const y = yPositions[i];
      const rowVals: string[] = [d.toFixed(2)];
      for (const col of visibleCols) {
        let v = SplineInterpolator.interpolatePercentAtY(col, y);
        if (v !== undefined && !isNaN(v)) {
          // 若用户勾选了放大线反算，按用户填写的放大倍数还原真实物理百分比
          if (col.hasExaggeration && col.exaggerationMult && col.exaggerationMult > 1) {
            v = v / col.exaggerationMult;
          }
          rowVals.push(v.toFixed(2));
        } else {
          rowVals.push('0.00');
        }
      }
      rows.push(rowVals.join(','));
    }
    return rows.join('\n');
  }

  /**
   * 生成针对当前图谱与属种列的 R 语言绘图脚本 (基于 rioja::strat.plot)
   */
  public static generateRScript(columns: Column[], unit: string = 'cm'): string {
    const visibleCols = columns.filter((c) => c.visible);
    const polyVec = visibleCols.map((c) => (c.plotType === 'bar' || c.plotType === 'line' || c.plotType === 'symbol' ? 'FALSE' : 'TRUE')).join(', ');
    const barVec = visibleCols.map((c) => (c.plotType === 'bar' ? 'TRUE' : 'FALSE')).join(', ');
    const lineVec = visibleCols.map((c) => (c.plotType === 'line' ? 'TRUE' : 'FALSE')).join(', ');
    const hasAnyExag = visibleCols.some((c) => c.hasExaggeration);
    const maxExagMult = Math.max(5, ...visibleCols.filter((c) => c.hasExaggeration).map((c) => c.exaggerationMult || 5));
    const exagVec = visibleCols.map((c) => (c.hasExaggeration ? 'TRUE' : 'FALSE')).join(', ');

    const exagParam = hasAnyExag
      ? `  exag = plot_exag,\n  exag.mult = ${maxExagMult},\n  col.exag = "auto",\n  exag.alpha = 0.5,\n`
      : '';

    return `# ==============================================================================
# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script
# Generated automatically by Straditize v2.0 (straditize pro)
# Requires R package 'rioja' (install.packages("rioja"))
# ==============================================================================

if (!requireNamespace("rioja", quietly = TRUE)) {
  message("Installing required package 'rioja' from CRAN...")
  install.packages("rioja", repos = "https://cloud.r-project.org")
}
library(rioja)

# 1. Locate and load exported stratigraphic CSV table
data_file <- "data.csv"
if (!file.exists(data_file)) {
  csv_candidates <- list.files(pattern = "\\\\.csv$", full.names = TRUE)
  if (length(csv_candidates) > 0) {
    data_file <- csv_candidates[1]
  } else {
    stop("Cannot find data.csv in current directory.")
  }
}

message("Loading stratigraphic dataset from: ", data_file)
df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)

# Extract depth horizon (first column) and taxa abundance matrix
depth <- df[[1]]
taxa_data <- df[, -1, drop = FALSE]

# Ensure matrix is strictly numeric, replace any residual NAs with 0
taxa_matrix <- as.matrix(sapply(taxa_data, as.numeric))
taxa_matrix[is.na(taxa_matrix)] <- 0

# 2. Configure per-column plot styles based on user selections in Straditize Pro
plot_poly <- c(${polyVec})
plot_bar  <- c(${barVec})
plot_line <- c(${lineVec})
${hasAnyExag ? `plot_exag <- c(${exagVec})` : ''}

# 3. Render stratigraphic plot using rioja::strat.plot
message("Rendering stratigraphic pollen profile...")
strat.plot(
  d = taxa_matrix,
  yvar = depth,
  y.rev = TRUE,             # Depth increases downwards (standard geological convention)
  ylabel = paste0("Depth (", "${unit}", ")"),
  plot.poly = plot_poly,    # Silhouette area fill
  plot.line = plot_line,    # Pure line curves
  plot.bar = plot_bar,      # Discrete horizontal bars
  col.poly = "grey35",
  col.line = "black",
  lwd.line = 1.0,
  scale.percent = TRUE,     # Percentage scale labels
${exagParam}  xRight = 0.95,
  yTop = 0.88,
  title = "Stratigraphic Pollen Diagram (Straditize Pro)"
)

message("Finished! Stratigraphic plot generated successfully.")
`;
  }

  /**
   * 4. 打开已有项目 (支持标准 .tar 归档 / .json)
   */
  public openProjectFile(file: File): void {
    const isTar =
      file.name.toLowerCase().endsWith('.tar') ||
      file.name.toLowerCase().endsWith('.tar.gz') ||
      file.type.includes('tar');

    const normalizeProject = (parsed: any, imageBlobUrl: string | null): DiagramData | null => {
      const cal = parsed.calibration || parsed.depth_calibration;
      const rawCols = parsed.columns;
      if (!rawCols || !Array.isArray(rawCols) || !cal) {
        return null;
      }

      const normalizedCal = {
        dataXMin: cal.dataXMin ?? parsed.roi?.x ?? 0,
        dataXMax: cal.dataXMax ?? (parsed.roi ? parsed.roi.x + parsed.roi.w : 1000),
        dataYMin: cal.dataYMin ?? cal.top_px ?? parsed.roi?.y ?? 0,
        dataYMax: cal.dataYMax ?? cal.bottom_px ?? (parsed.roi ? parsed.roi.y + parsed.roi.h : 1000),
        depthTopValue: cal.depthTopValue ?? cal.top_cm ?? 0,
        depthBottomValue: cal.depthBottomValue ?? cal.bottom_cm ?? 150,
        unit: cal.unit || 'cm',
        depthInterval: cal.depthInterval ?? cal.depth_interval ?? 2,
        depthGridEnabled: cal.depthGridEnabled ?? cal.depth_grid_enabled ?? true,
        isCalibrated: cal.isCalibrated ?? cal.is_calibrated ?? true,
        top_px: cal.top_px ?? cal.dataYMin,
        bottom_px: cal.bottom_px ?? cal.dataYMax,
        top_cm: cal.top_cm ?? cal.depthTopValue,
        bottom_cm: cal.bottom_cm ?? cal.depthBottomValue,
      };

      const normalizedCols = rawCols.map((c: any, idx: number) => {
        const name = c.name || c.species || `Col ${idx + 1}`;
        const startX = c.startX ?? 0;
        const tickEndX = c.tickEndX ?? (c.scaleCalib?.calibX ?? c.endX ?? startX + 50);
        const endX = c.endX ?? tickEndX;
        const startVal = c.startValue ?? (c.scaleCalib?.originVal ?? 0);
        const tickVal = c.tickValue ?? (c.scaleCalib?.calibVal ?? c.maxPercent ?? 100);
        const rawPts = c.controlPoints || c.points || [];

        const pts = rawPts.map((p: any, pIdx: number) => ({
          id: p.id || `pt_${idx}_${pIdx}`,
          x: p.x,
          y: p.y,
          value: p.value,
          kind: p.kind || (p.type === 'manual' || p.isManual ? 'manual' : 'peak'),
          valid_segment: p.valid_segment ?? true,
          isManual: p.kind === 'manual' || p.isManual || false,
          type: p.kind || p.type || 'peak',
          createdAt: p.createdAt || Date.now(),
        }));

        return {
          id: c.id || `col_${idx}`,
          name,
          species: name,
          color: c.color || '#38bdf8',
          startX,
          endX,
          maxPercent: tickVal,
          tickEndX,
          unit: c.unit || '%',
          isLocked: c.isLocked || false,
          curveType: c.curveType || 'linear',
          visible: c.visible !== false,
          scale_type: c.scale_type || 'linear',
          startValue: startVal,
          tickValue: tickVal,
          controlPoints: pts,
          points: pts,
          scaleCalib: c.scaleCalib || {
            originX: startX,
            originVal: startVal,
            calibX: tickEndX,
            calibVal: tickVal,
            unit: c.unit || '%',
          },
        };
      });

      return {
        imageSrc: imageBlobUrl || parsed.image?.src || parsed.imageSrc || this.data.imageSrc,
        imageWidth: parsed.image?.width || parsed.imageWidth || this.data.imageWidth,
        imageHeight: parsed.image?.height || parsed.imageHeight || this.data.imageHeight,
        calibration: normalizedCal,
        columns: normalizedCols,
        activeTaxaId: parsed.activeTaxaId || normalizedCols[0]?.id || '',
        selectedEntity: null,
      };
    };

    if (isTar) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buf = e.target?.result as ArrayBuffer;
          if (!buf) return;

          const entries = TarArchive.extract(buf);
          if (entries.length === 0) {
            alert('读取 .tar 归档失败：未找到有效的文件块。');
            return;
          }

          let jsonContent: string | null = null;
          let imageBlobUrl: string | null = null;

          for (const entry of entries) {
            if (
              entry.name.endsWith('straditize.json') ||
              entry.name.endsWith('wpd.json') ||
              (entry.name.endsWith('.json') && !entry.name.includes('manifest.json') && !entry.name.includes('info.json'))
            ) {
              jsonContent = new TextDecoder().decode(entry.data);
            } else if (
              entry.name.endsWith('.png') ||
              entry.name.endsWith('.jpg') ||
              entry.name.endsWith('.jpeg') ||
              entry.name.endsWith('.webp')
            ) {
              const mime = entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
              const imgBlob = new Blob([entry.data as unknown as BlobPart], { type: mime });
              imageBlobUrl = URL.createObjectURL(imgBlob);
            }
          }

          if (jsonContent) {
            const parsed = JSON.parse(jsonContent);
            const projectData = normalizeProject(parsed, imageBlobUrl);
            if (projectData) {
              if (this.onProjectLoad) {
                this.onProjectLoad(projectData);
              }
            } else {
              alert('解包成功，但未在 JSON 中找到合法的 columns 或 calibration 字段。');
            }
          } else {
            alert('未在 .tar 归档中找到项目数据 JSON 文件。');
          }
        } catch (err) {
          alert('解析 .tar 归档失败：' + (err as Error).message);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // 普通 JSON 文件读取
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const parsed = JSON.parse(text);
        const projectData = normalizeProject(parsed, null);
        if (projectData) {
          if (this.onProjectLoad) {
            this.onProjectLoad(projectData);
          }
        } else {
          alert('项目文件格式不匹配：未找到有效的 columns 或 calibration 配置。');
        }
      } catch (err) {
        alert('读取项目文件失败：无效的 JSON 格式。');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  /**
   * 5. 后端 JSON-RPC 配置弹窗
   */
  public openRpcConfigModal(onRefresh: () => void): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const status = this.rpcClient.getStatus();

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Agent 2 JSON-RPC 服务连接配置</h3>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
            前端自带高仿真 Mock 引擎，即使后端服务未启动也可完全自主交互、加点吸附、撤销重做和导出数据；
            当 Agent 2 的 JSON-RPC 服务启动时，可在此输入地址无缝直连。
          </p>
          <div class="form-group">
            <label>JSON-RPC 2.0 Endpoint 地址:</label>
            <input type="text" id="rpc-endpoint" value="${status.endpoint}" />
          </div>
          <div class="form-group">
            <label>当前运行模式:</label>
            <div class="mode-pill ${status.connected ? 'online' : 'mock'}">
              ${status.connected ? '🟢 已连接到后端 Agent 2' : '🟡 本地 Mock 仿真自主运行 (无后端)'}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-close-btn">关闭</button>
          <button class="btn btn-primary" id="btn-probe">重新探测连接</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#modal-close')?.addEventListener('click', closeModal);
    modal.querySelector('#modal-close-btn')?.addEventListener('click', closeModal);

    const probeBtn = modal.querySelector('#btn-probe') as HTMLButtonElement;
    probeBtn?.addEventListener('click', async () => {
      const endpoint = (modal.querySelector('#rpc-endpoint') as HTMLInputElement).value;
      probeBtn.disabled = true;
      probeBtn.textContent = '探测中...';
      await this.rpcClient.probeBackend(endpoint);
      probeBtn.disabled = false;
      probeBtn.textContent = '重新探测连接';
      onRefresh();
      closeModal();
    });
  }
}
