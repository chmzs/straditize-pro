import { DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { SplineInterpolator } from '../core/SplineInterpolator';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { ProjectManager } from '../core/ProjectManager';
import { computeExportReadiness, renderExportReadiness } from './steps/ExportReadinessPanel';
import { notifyError } from '../ui/feedback';

export class ExportModal {
  private container: HTMLElement;
  private data: DiagramData;
  private rpcClient: RpcClient;
  private projectManager?: ProjectManager;

  constructor(
    container: HTMLElement,
    data: DiagramData,
    rpcClient: RpcClient,
    projectManager?: ProjectManager
  ) {
    this.container = container;
    this.data = data;
    this.rpcClient = rpcClient;
    this.projectManager = projectManager;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
    this.projectManager?.updateData(data);
  }

  /**
   * 导出界面打开 (对齐 WebPlotDigitizer / WPD 专业科学数据导出面板，支持排序、格式化、复制、下载与在线成图)
   */
  public open(_initialContent: string = '', _format: 'csv' | 'json' = 'csv'): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const readiness = computeExportReadiness(this.data);

    modal.innerHTML = `
      <div class="modal-dialog modal-large wpd-export-dialog ui-modal" style="--modal-width: 1180px;"
           data-sheets="${readiness.sheets.join(',')}"
           data-primary="${readiness.primaryRoi}"
           data-data-csv-equals-primary="true"
           data-readiness-missing="${readiness.readinessMissing.join(',')}">
        <div class="modal-header ui-modal__header">
          <div>
            <h3 class="ui-modal__title">检查并导出数据</h3>
            <span class="ui-status" id="export-readiness-status">正在检查导出条件</span>
          </div>
          <button class="ui-icon-btn" id="modal-close" aria-label="关闭导出窗口" title="关闭">&times;</button>
        </div>

        <div class="modal-body wpd-modal-body ui-modal__body">
          <!-- 左侧：双模式（表格预览与交互编辑 / 原始代码）区域 -->
          <div class="wpd-left-area" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; height: 100%;">
            <!-- 地层丰度百分比总和自检门禁 (Sum Check QA Gate) -->
            <div id="wpd-sum-check-banner" class="wpd-qa-banner wpd-qa-banner--ok">
              <span id="wpd-sum-check-text"><strong>百分比总和自检</strong>: 分析中...</span>
              <span id="wpd-sum-check-sub" class="wpd-qa-banner__sub">-- 层位</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0;">
              <div style="display: flex; gap: 4px;">
                <button id="tab-btn-grid" class="tool-btn active-mode" style="font-size: 11px; padding: 4px 10px;" title="可就地编辑的数值表格">数据表格</button>
                <button id="tab-btn-text" class="tool-btn" style="font-size: 11px; padding: 4px 10px;" title="原始 CSV 文本，可复制或手工调整">原始文本</button>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 10px; align-items: center;">
                <span>Variables: <strong id="wpd-vars-label" style="color: var(--accent-blue);">Depth, 29 Taxa</strong></span>
                <span id="wpd-data-size-label">0 KB</span>
                <button id="btn-wpd-reset-edits" class="tool-btn" style="font-size: 10px; padding: 2px 7px; color: var(--text-muted);" title="清除所有手动微调，还原为图谱自动提取值">还原提取值</button>
              </div>
            </div>

            <!-- 视图 1: 交互式表格视图 (支持直接点选单元格修改数字) -->
            <div id="wpd-table-wrapper" class="wpd-table-wrapper" style="flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-light); border-radius: 6px;">
              <table id="wpd-preview-table" class="wpd-preview-table">
                <!-- 动态填充 thead 与 tbody -->
              </table>
            </div>

            <!-- 视图 2: 纯文本导出框 (可复制或手工调整) -->
            <textarea id="wpd-data-textarea" class="export-textarea" style="display: none; flex: 1; min-height: 0; font-family: var(--font-mono); font-size: 11px; line-height: 1.45;"></textarea>

            <div style="font-size: 10px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
              <span>提示：点击任意表格单元格可直接修改数值（修改项呈橙色高亮），导出 CSV、R 脚本与 TAR 包将实时同步生效。</span>
            </div>
          </div>

          <!-- 右侧：WPD 风格的控制面板 (Dataset, Sort, Format, Visualize) 并列排布 -->
          <div class="wpd-right-controls" style="width: 270px; min-width: 270px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); height: 100%; box-sizing: border-box; overflow-y: auto;">
            <!-- 导出就绪状态清单 (T10) -->
            ${renderExportReadiness(this.data)}

            <!-- 数据集选择 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Dataset (数据集形态):</label>
              <select id="wpd-dataset-select" class="sample-select" style="width: 100%; font-size: 11px;">
                <option value="union_points" selected>1. 真实物理拐点共振层位 [推荐: 忠实原图/无伪插值]</option>
                <option value="depth_grid">2. 参考标尺均匀层位 [用于等距辅助测试]</option>
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

            <!-- 导出内容选择与集成表 (规范第九章) -->
            <div class="form-group wpd-content-tree-box" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <label style="font-size: 11px; font-weight: bold; color: var(--accent-blue);">导出内容选择 (Content Tree):</label>
              <div style="display: flex; flex-direction: column; gap: 5px; font-size: 10px; margin-top: 5px;">
                <label style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: not-allowed;">
                  <input type="checkbox" checked disabled />
                  <span>核心数据 (meta_info + pollen) [必选]</span>
                </label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="chk-export-agedepth" checked />
                  <span class="wpd-tree-label">深度-年代表 (age-depth)</span>
                </label>
                <label id="lbl-export-ensemble" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="chk-export-ensemble" />
                  <span id="txt-export-ensemble" style="color: var(--accent-amber); font-weight: 600;">集成表 (ensemble tables)</span>
                </label>
                <div id="ensemble-sub-options" style="display: none; padding-left: 18px; font-size: 9.5px; color: var(--text-muted);">
                  <span id="ensemble-list-hint">暂无原生或导入集成表</span>
                </div>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="chk-export-readme" checked />
                  <span style="color: var(--text-muted);">说明文件 (readme)</span>
                </label>
              </div>
            </div>

            <!-- 导出说明 (Section 八: R 脚本本地出图) -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--accent-blue);">导出格式说明:</label>
              <p style="font-size: 10px; color: var(--text-muted); line-height: 1.4; margin-bottom: 6px;">
                可导出无 NA 的地学标准丰度表、<code>rioja::strat.plot</code> 绘图脚本与 POSIX UStar 项目归档。
              </p>
              <div class="wpd-scientific-qc-box">
                <div class="wpd-qc-title">地学科学规范：</div>
                <ul class="wpd-qc-list">
                  <li>未出现属种严格填报 <code>0.00</code></li>
                  <li>对数分析请自行添加伪计数 (如 +0.01)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer ui-modal__footer export-modal-footer">
          <button class="ui-btn ui-btn--quiet" id="btn-wpd-copy">复制当前数据</button>
          <div class="export-format-actions">
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-csv">CSV</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-lipd" title="导出符合 LiPD / LinkedEarth 规范的数据包">LiPD</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-r" title="下载 rioja::strat.plot 绘图脚本">R 脚本</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-tar" title="下载包含数据、原图与脚本的项目归档">TAR 归档</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-json">JSON</button>
          </div>
          <button class="ui-btn ui-btn--primary" id="btn-wpd-download-xlsx" title="导出包含元数据、花粉、年代与集成表的工作簿">导出 XLSX</button>
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

    // 动态表格数据模型与手动微调记录
    let currentHeaders: string[] = [];
    let currentRows: Array<string[]> = [];
    const userEdits = new Map<string, string>(); // key: `${rowIdx}_${colIdx}` -> editedValue

    const tabBtnGrid = modal.querySelector('#tab-btn-grid') as HTMLButtonElement;
    const tabBtnText = modal.querySelector('#tab-btn-text') as HTMLButtonElement;
    const tableWrapper = modal.querySelector('#wpd-table-wrapper') as HTMLDivElement;
    const previewTable = modal.querySelector('#wpd-preview-table') as HTMLTableElement;
    const resetEditsBtn = modal.querySelector('#btn-wpd-reset-edits') as HTMLButtonElement;

    // Tab 视图切换
    tabBtnGrid?.addEventListener('click', () => {
      tabBtnGrid.classList.add('active-mode');
      tabBtnText?.classList.remove('active-mode');
      tableWrapper.style.display = 'block';
      textarea.style.display = 'none';
    });

    tabBtnText?.addEventListener('click', () => {
      tabBtnText.classList.add('active-mode');
      tabBtnGrid?.classList.remove('active-mode');
      tableWrapper.style.display = 'none';
      textarea.style.display = 'block';
    });

    // 重新计算原始提取数据矩阵
    const extractRawMatrix = (): { headers: string[]; rows: Array<string[]> } => {
      const dataset = datasetSelect.value;
      const digits = parseInt(digitsInp.value, 10) || 2;
      const naStr = naFillSelect.value;
      const isDesc = sortOrderSelect.value === 'desc';

      const cal = this.data.calibration;
      const visibleCols = this.data.columns.filter((c) => c.visible);

      if (dataset === 'turning_points') {
        varsLabel.textContent = 'Taxon, Type, Depth, Value, X, Y';
        const headers = ['Taxon', 'Type', `Depth_${cal.unit}`, 'Value', 'X_px', 'Y_px'];
        const matrix: Array<string[]> = [];

        visibleCols.forEach((col) => {
          const pts = [...col.controlPoints].sort((a, b) => (isDesc ? b.y - a.y : a.y - b.y));
          pts.forEach((pt) => {
            const depth = CoordinateSystem.imageYToDepth(pt.y, cal);
            const val = CoordinateSystem.imageXToPercent(pt.x, col);
            matrix.push([
              col.name,
              pt.type || 'transition',
              depth !== undefined ? depth.toFixed(digits) : naStr,
              val !== undefined ? val.toFixed(digits) : naStr,
              String(pt.x),
              String(pt.y),
            ]);
          });
        });
        return { headers, rows: matrix };
      }

      if (dataset === 'union_points') {
        varsLabel.textContent = `Depth_${cal.unit}, ${visibleCols.length} Taxa (Union Horizons: 0 NA)`;
        const allYSet = new Set<number>();
        visibleCols.forEach((col) => {
          col.controlPoints.forEach((pt) => allYSet.add(pt.y));
        });
        const sortedY = Array.from(allYSet).sort((a, b) => (isDesc ? b - a : a - b));
        const headers = [`Depth_${cal.unit}`, ...visibleCols.map((c) => c.name)];
        const matrix: Array<string[]> = [];

        for (const y of sortedY) {
          const depth = CoordinateSystem.imageYToDepth(y, cal);
          const rowVals: string[] = [depth !== undefined ? depth.toFixed(digits) : naStr];
          for (const col of visibleCols) {
            const v = SplineInterpolator.interpolatePercentAtY(col, y);
            rowVals.push(v !== undefined && !isNaN(v) ? v.toFixed(digits) : naStr);
          }
          matrix.push(rowVals);
        }
        return { headers, rows: matrix };
      }

      // 默认: 标准深度层位网格 (depth_grid)
      varsLabel.textContent = `Depth_${cal.unit}, ${visibleCols.length} Taxa`;
      const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal);
      const headers = [`Depth_${cal.unit}`, ...visibleCols.map((c) => c.name)];
      const matrix: Array<string[]> = [];

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
        matrix.push(rowVals);
      }
      return { headers, rows: matrix };
    };

    // 将当前内存矩阵格式化为文本 (包含用户编辑覆盖项)
    const serializeMatrixToText = (headers: string[], rows: Array<string[]>): string => {
      const sep = colSepSelect.value === '\t' ? '\t' : colSepSelect.value;
      const lines = [headers.join(sep)];
      for (const row of rows) {
        lines.push(row.join(sep));
      }
      return lines.join('\n');
    };

    // 渲染可交互表格
    const renderTableGrid = () => {
      previewTable.innerHTML = '';

      // Thead
      const thead = document.createElement('thead');
      const trHead = document.createElement('tr');
      const thNum = document.createElement('th');
      thNum.className = 'col-row-num';
      thNum.textContent = '#';
      trHead.appendChild(thNum);

      currentHeaders.forEach((h, cIdx) => {
        const th = document.createElement('th');
        if (cIdx === 0) th.className = 'col-depth';
        th.textContent = h;
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);
      previewTable.appendChild(thead);

      // Tbody
      const tbody = document.createElement('tbody');
      currentRows.forEach((row, rIdx) => {
        const tr = document.createElement('tr');

        // 行号
        const tdNum = document.createElement('td');
        tdNum.className = 'col-row-num';
        tdNum.textContent = String(rIdx + 1);
        tr.appendChild(tdNum);

        row.forEach((cellVal, cIdx) => {
          const td = document.createElement('td');
          if (cIdx === 0) {
            td.className = 'col-depth';
            td.textContent = cellVal;
          } else {
            const input = document.createElement('input');
            input.className = 'wpd-cell-input';
            const editKey = `${rIdx}_${cIdx}`;
            if (userEdits.has(editKey)) {
              input.classList.add('user-modified');
              input.value = userEdits.get(editKey)!;
            } else {
              input.value = cellVal;
            }

            input.addEventListener('input', () => {
              userEdits.set(editKey, input.value);
              input.classList.add('user-modified');
              currentRows[rIdx][cIdx] = input.value;
              syncSerializedText();
              updateSumCheck();
            });

            td.appendChild(input);
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      previewTable.appendChild(tbody);
    };

    const syncSerializedText = () => {
      const dataStr = serializeMatrixToText(currentHeaders, currentRows);
      textarea.value = dataStr;
      sizeLabel.textContent = `${(dataStr.length / 1024).toFixed(1)} KB (${currentRows.length} rows)`;
    };

    const updateSumCheck = () => {
      const bannerEl = modal.querySelector('#wpd-sum-check-banner') as HTMLElement;
      const textEl = modal.querySelector('#wpd-sum-check-text') as HTMLElement;
      const subEl = modal.querySelector('#wpd-sum-check-sub') as HTMLElement;
      if (!bannerEl || !textEl || !subEl) return;

      if (datasetSelect.value === 'turning_points' || currentRows.length === 0) {
        bannerEl.style.display = 'none';
        return;
      }
      bannerEl.style.display = 'flex';

      let totalSum = 0;
      let minSum = 999999;
      let maxSum = 0;
      let countedRows = 0;

      for (const row of currentRows) {
        let rowSum = 0;
        for (let c = 1; c < row.length; c++) {
          const val = parseFloat(row[c]);
          if (!isNaN(val)) rowSum += val;
        }
        if (rowSum > 0) {
          totalSum += rowSum;
          minSum = Math.min(minSum, rowSum);
          maxSum = Math.max(maxSum, rowSum);
          countedRows++;
        }
      }

      const meanSum = countedRows > 0 ? totalSum / countedRows : 100;
      subEl.textContent = `${countedRows} 层位质检`;

      if (minSum >= 85 && maxSum <= 115) {
        bannerEl.className = 'wpd-qa-banner wpd-qa-banner--ok';
        textEl.innerHTML = `<strong>百分比总和自检</strong>: 全剖面平均总和 <strong>${meanSum.toFixed(1)}%</strong> (各层位介于 ${minSum.toFixed(1)}% ~ ${maxSum.toFixed(1)}%，质检达标)`;
      } else {
        bannerEl.className = 'wpd-qa-banner wpd-qa-banner--warn';
        const minDisp = minSum === 999999 ? 0 : minSum.toFixed(1);
        textEl.innerHTML = `<strong>质检提示</strong>: 存在层位总和偏离 100% (范围: <strong>${minDisp}% ~ ${maxSum.toFixed(1)}%</strong>)，请检查是否有穿透越界峰或漏识属种`;
      }
    };

    const updateFullDisplay = () => {
      const { headers, rows } = extractRawMatrix();
      currentHeaders = headers;
      // 叠加上用户修改
      currentRows = rows.map((r, rIdx) => {
        return r.map((cell, cIdx) => {
          const key = `${rIdx}_${cIdx}`;
          return userEdits.has(key) ? userEdits.get(key)! : cell;
        });
      });
      renderTableGrid();
      syncSerializedText();
      updateSumCheck();
    };

    // 还原按钮
    resetEditsBtn?.addEventListener('click', () => {
      userEdits.clear();
      updateFullDisplay();
    });

    datasetSelect.addEventListener('change', () => {
      userEdits.clear();
      updateFullDisplay();
    });
    sortBySelect.addEventListener('change', updateFullDisplay);
    sortOrderSelect.addEventListener('change', updateFullDisplay);
    digitsInp.addEventListener('input', updateFullDisplay);
    colSepSelect.addEventListener('change', syncSerializedText);
    naFillSelect.addEventListener('change', updateFullDisplay);

    updateFullDisplay();

    // 复制到剪贴板
    const copyBtn = modal.querySelector('#btn-wpd-copy') as HTMLButtonElement;
    copyBtn?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = '已复制';
      setTimeout(() => (copyBtn.textContent = '复制当前数据'), 1500);
    });

    // 下载 CSV (直连后端 export.csv)
    modal.querySelector('#btn-wpd-download-csv')?.addEventListener('click', async () => {
      try {
        const res = await this.rpcClient.call<any, any>('export.csv');
        const csvStr = typeof res === 'string' ? res : (res?.csv || res?.csv_content || '');
        if (csvStr) {
          const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `straditize_${this.data.primary_roi_id || 'data'}_${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          // Fallback to textarea text if offline
          const blob = new Blob([textarea.value], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `straditize_pollen_${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err: any) {
        notifyError(`导出 CSV 失败: ${err.message || err}`);
      }
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

    // 下载配套 R 语言地层图绘图脚本 (直连后端 export.r)
    modal.querySelector('#btn-wpd-download-r')?.addEventListener('click', async () => {
      try {
        const res = await this.rpcClient.call<any, any>('export.r');
        const rStr = typeof res === 'string' ? res : (res?.r || res?.script || '');
        const scriptToUse = rStr || ProjectManager.generateRScript(this.data.columns, this.data.calibration.unit || 'cm');
        const blob = new Blob([scriptToUse], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plot_strat.R';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err: any) {
        notifyError(`导出 R 脚本失败: ${err.message || err}`);
      }
    });

    // 导出项目包 (.tar) (直连后端 T10 多 ROI 权威归档)
    modal.querySelector('#btn-wpd-download-tar')?.addEventListener('click', () => {
      if (this.projectManager) {
        void this.projectManager.saveProjectFile();
      } else {
        const pm = new ProjectManager(this.data, this.rpcClient);
        void pm.saveProjectFile();
      }
    });

    // 导出内容与集成表联动处理 (规范第九章)
    const chkEnsemble = modal.querySelector('#chk-export-ensemble') as HTMLInputElement;
    const subEnsemble = modal.querySelector('#ensemble-sub-options') as HTMLElement;
    chkEnsemble.disabled = true;

    this.rpcClient.call<void, { count: number; tables: Array<{ name: string; columns: string[]; rows: number }> }>('ensemble.list')
      .then((res) => {
        if (res && res.tables && res.tables.length > 0) {
          chkEnsemble.disabled = false;
          chkEnsemble.checked = true;
          subEnsemble.style.display = 'block';
          subEnsemble.innerHTML = res.tables.map((t, idx) => `
            <label style="display: flex; align-items: center; gap: 4px; margin-top: 3px; cursor: pointer;">
              <input type="checkbox" class="chk-sub-ensemble" value="${t.name}" ${idx === 0 ? 'checked' : ''} />
              <span style="color: var(--accent-amber);">${t.name} (${t.rows} 行采样)</span>
            </label>
          `).join('');
        } else {
          chkEnsemble.disabled = true;
          chkEnsemble.checked = false;
          subEnsemble.style.display = 'none';
        }
      })
      .catch(() => {
        chkEnsemble.disabled = true;
      });

    chkEnsemble?.addEventListener('change', () => {
      subEnsemble.style.display = chkEnsemble.checked ? 'block' : 'none';
    });

    // 导出多 Sheet XLSX (包含 meta_info, pollen, age-depth, ensemble)
    modal.querySelector('#btn-wpd-download-xlsx')?.addEventListener('click', async () => {
      const chkAgeDepth = (modal.querySelector('#chk-export-agedepth') as HTMLInputElement)?.checked ?? true;
      const chkReadme = (modal.querySelector('#chk-export-readme') as HTMLInputElement)?.checked ?? true;
      const selectedEnsembles: string[] = [];
      if (chkEnsemble && chkEnsemble.checked) {
        modal.querySelectorAll('.chk-sub-ensemble:checked').forEach((el) => {
          selectedEnsembles.push((el as HTMLInputElement).value);
        });
      }

      try {
        const res = await this.rpcClient.call<any, any>('export.exportXlsx', {
          include_age_depth: chkAgeDepth,
          include_ensemble_names: selectedEnsembles,
          include_readme: chkReadme,
        });
        if (res && res.base64) {
          const byteCharacters = atob(res.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `straditize_scientific_${Date.now()}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err: any) {
        notifyError(`导出 XLSX 失败: ${err.message || err}`);
      }
    });

    // 导出 LiPD (.lpd zip) 容器
    modal.querySelector('#btn-wpd-download-lipd')?.addEventListener('click', async () => {
      const chkAgeDepth = (modal.querySelector('#chk-export-agedepth') as HTMLInputElement)?.checked ?? true;
      const selectedEnsembles: string[] = [];
      if (chkEnsemble && chkEnsemble.checked) {
        modal.querySelectorAll('.chk-sub-ensemble:checked').forEach((el) => {
          selectedEnsembles.push((el as HTMLInputElement).value);
        });
      }

      try {
        const res = await this.rpcClient.call<any, any>('export.exportLipd', {
          include_age_depth: chkAgeDepth,
          include_ensemble_names: selectedEnsembles,
        });
        if (res && res.base64) {
          const byteCharacters = atob(res.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `straditize_lipdverse_${Date.now()}.lpd`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err: any) {
        notifyError(`导出 LiPD 失败: ${err.message || err}`);
      }
    });
  }
}
