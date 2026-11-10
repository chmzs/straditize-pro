import { DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { SplineInterpolator } from '../core/SplineInterpolator';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { ProjectManager } from '../core/ProjectManager';
import { computeExportReadiness, renderExportReadiness } from './steps/ExportReadinessPanel';
import {
  aggregateHeadline,
  aggregateQaScope,
  QA_DEFAULT_TOLERANCE,
  type QaAggregate,
  type QaScopePart,
} from '../core/qaVerdict';
import type { QaSummary } from './steps/QaPanel';
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
      <div class="modal-dialog wpd-export-dialog ui-modal" style="--modal-width: 1180px;"
           data-sheets="${readiness.sheets.join(',')}"
           data-primary="${readiness.primaryRoi}"
           data-readiness-missing="${readiness.readinessMissing.join(',')}">
        <div class="ui-modal__header">
          <div>
            <h3 class="ui-modal__title">检查并导出数据</h3>
            <span class="ui-status" id="export-readiness-status">正在检查导出条件</span>
          </div>
          <button class="ui-icon-btn" id="export-modal-close" aria-label="关闭导出窗口" title="关闭">&times;</button>
        </div>

        <div class="wpd-modal-body ui-modal__body">
          <!-- 左侧：双模式（表格预览与交互编辑 / 原始代码）区域 -->
          <div class="wpd-left-area" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; height: 100%;">
            <!-- 地层丰度百分比总和自检门禁 (Sum Check QA Gate) -->
            <div id="wpd-sum-check-banner" class="wpd-qa-banner wpd-qa-banner--ok">
              <span id="wpd-sum-check-text"><strong>百分比总和自检</strong>: 分析中...</span>
              <span id="wpd-sum-check-sub" class="wpd-qa-banner__sub">-- 层位</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0;">
              <div style="display: flex; gap: 4px;">
                <button id="tab-btn-grid" class="ui-btn ui-btn--quiet ui-btn--xs active-mode" style="font-size: 11px; padding: 4px 10px;" title="可就地编辑的数值表格">数据表格</button>
                <button id="tab-btn-text" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 11px; padding: 4px 10px;" title="原始 CSV 文本，可复制或手工调整">原始文本</button>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 10px; align-items: center;">
                <span>Variables: <strong id="wpd-vars-label" style="color: var(--accent-blue);">Depth, 29 Taxa</strong></span>
                <span id="wpd-data-size-label">0 KB</span>
                <button id="btn-wpd-reset-edits" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 2px 7px; color: var(--text-muted);" title="清除所有手动微调，还原为图谱自动提取值">还原提取值</button>
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
              <!--
                行集说明：用户必须先知道"这 N 行是哪来的"。
                以前预览（控制点并集）与下载（后端样品层位）是两套行集，界面一个字都没说，
                用户看到「预览 125 行 / 下载 35 行」完全无法判断哪个权威（U-ROWS-01）。
              -->
              <div id="wpd-rowset-caption" style="margin-top: 5px; font-size: 10.5px; line-height: 1.45; color: var(--text-muted);"></div>
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

            <!--
              工作簿类导出的行集来源必须写在界面上。
              后端 export.exportXlsx / export.exportLipd / export.tar 都没有"指定层位"
              参数（export.csv 的 depths 形参实际未被使用），它们固定按 samples 采样层位
              出表，与上方数据集选择器的行集是两回事。写成静态说明而不是悄悄不同
              （U-ROWS-01 的根因就是"隐性另搞一套"）。
            -->
            <div id="wpd-workbook-rowset-note" style="font-size: 10px; line-height: 1.5; color: var(--status-warning); padding: 6px 8px; border-radius: 4px; background: rgba(245, 158, 11, 0.10); border: 1px solid rgba(245, 158, 11, 0.35);">
              XLSX / LiPD / TAR 由后端生成，固定按「样品层位」出表（与上方预览的行集可能不同）。
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

        <div class="ui-modal__footer export-modal-footer">
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
    modal.querySelector('#export-modal-close')?.addEventListener('click', closeModal);

    const textarea = modal.querySelector('#wpd-data-textarea') as HTMLTextAreaElement;
    const datasetSelect = modal.querySelector('#wpd-dataset-select') as HTMLSelectElement;
    const sortBySelect = modal.querySelector('#wpd-sort-by') as HTMLSelectElement;
    const sortOrderSelect = modal.querySelector('#wpd-sort-order') as HTMLSelectElement;
    const digitsInp = modal.querySelector('#wpd-digits') as HTMLInputElement;
    const colSepSelect = modal.querySelector('#wpd-col-sep') as HTMLSelectElement;
    const naFillSelect = modal.querySelector('#wpd-na-fill') as HTMLSelectElement;
    const varsLabel = modal.querySelector('#wpd-vars-label') as HTMLElement;
    const sizeLabel = modal.querySelector('#wpd-data-size-label') as HTMLElement;
    const rowSetCaptionEl = modal.querySelector('#wpd-rowset-caption') as HTMLElement | null;

    /** 数据集 → 行集来源的人话名字（与 `#wpd-dataset-select` 的选项一一对应）。 */
    const ROWSET_SOURCE: Record<string, string> = {
      union_points: '按控制点层位',
      depth_grid: '按标尺均匀层位',
      turning_points: '按离散拐点清单',
    };

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
      // 未标定列与「个别层位缺测」是两件事，不能合并：
      //   - 缺测（列已标定，但该层没数据）：按用户选的 naFill 填（默认 0.0，地学惯例）；
      //   - 未标定（整列没有标度）：整列写 NA，绝不混进 0.0 —— 那会被读成
      //     "该层确实 0% 花粉"，是编造读数。
      const UNCALIBRATED_NA = 'NA';
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
            // 未标定列不出数：naStr 是既有占位通道（与深度缺标定一致）。
            const calibrated = CoordinateSystem.hasRealCalibration(col);
            const val = calibrated ? CoordinateSystem.imageXToPercent(pt.x, col) : undefined;
            matrix.push([
              col.name,
              pt.type || 'transition',
              depth !== undefined ? depth.toFixed(digits) : naStr,
              val !== undefined ? val.toFixed(digits) : calibrated ? naStr : UNCALIBRATED_NA,
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
            const calibrated = CoordinateSystem.hasRealCalibration(col);
            rowVals.push(
              calibrated
                ? v !== undefined && !isNaN(v)
                  ? v.toFixed(digits)
                  : naStr
                : UNCALIBRATED_NA
            );
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
          const calibrated = CoordinateSystem.hasRealCalibration(col);
          if (!calibrated) {
            rowVals.push(UNCALIBRATED_NA);
          } else if (v !== undefined && !isNaN(v)) {
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

    /**
     * QA 结论的唯一数据源：后端 `qa.summarize`。
     *
     * 曾经这里自己遍历预览表求 min/max，再套硬编码窗口 `minSum >= 85 && maxSum <= 115`。
     * 两个后果都被实测抓到（`.scratch/hands-on/export/`）：
     * ① 一行都没被检验时 `minSum` 停在初始化哨兵 `999999`，而
     *    `999999 >= 85 && 0 <= 115` 恒真 ⇒ 「**0 层位质检** … **质检达标**」；
     * ② 同一个哨兵被当成真实数值印给用户：「各层位介于 **999999.0%** ~ 0.0%」。
     * 同屏步骤 8 的横幅此刻报的是「组分总和超标报警（788 个层位）」——两条结论直接对立。
     *
     * 现在自检行**只复述后端字段**（超限层位数 / 最大总和 / 实际被检层位数），
     * 判定走 `core/qaVerdict.ts` 的同一个函数；前端不再有第二条求和路径。
     * 空集（被检层位 = 0）由该函数判为"无法判定"，绝不再算达标。
     */
    let latestAggregate: QaAggregate | null = null;
    let latestQaError: string | null = null;

    /**
     * 自检行的数据源与步骤 8 横幅**完全相同**：对每个"有列"的分区各调一次
     * `qa.summarize`，再用 `aggregateQaScope` 合成一个结论。
     *
     * 只算 active 分区曾造成：横幅（后端 violations）报红、自检行（另一个分区/另一套
     * 求和）报"达标"，同屏两个对立结论；哨兵 `999999` 还被印成真实数值。
     */
    const refreshQa = async (): Promise<void> => {
      try {
        const rois = this.data.rois ?? [];
        const columns = this.data.columns ?? [];
        const scored = rois.map((r) => {
          const roiId = String(r.id ?? '');
          return {
            roiId,
            roiName: r.name || roiId,
            columnCount: columns.filter((c) => c.roi_id === roiId).length,
          };
        });
        const checked = scored.filter((s) => s.columnCount > 0);
        const skipped = scored
          .filter((s) => s.columnCount === 0)
          .map((s) => ({ roiId: s.roiId, roiName: s.roiName }));

        const parts: QaScopePart[] = [];
        for (const { roiId, roiName, columnCount } of checked) {
          const summary = await this.rpcClient.call<
            { tolerance: number; roi_id: string },
            QaSummary
          >('qa.summarize', { tolerance: QA_DEFAULT_TOLERANCE, roi_id: roiId });
          if (!summary || typeof summary !== 'object') {
            throw new Error(`qa.summarize 未返回汇总对象（违反契约）：分区 ${roiId}`);
          }
          parts.push({ roiId, roiName, columnCount, summary });
        }
        latestAggregate = aggregateQaScope(parts, skipped, QA_DEFAULT_TOLERANCE);
        latestQaError = null;
      } catch (err) {
        latestAggregate = null;
        latestQaError = (err as Error)?.message || String(err);
      }
      updateSumCheck();
    };

    const updateSumCheck = () => {
      const bannerEl = modal.querySelector('#wpd-sum-check-banner') as HTMLElement;
      const textEl = modal.querySelector('#wpd-sum-check-text') as HTMLElement;
      const subEl = modal.querySelector('#wpd-sum-check-sub') as HTMLElement;
      if (!bannerEl || !textEl || !subEl) return;

      if (datasetSelect.value === 'turning_points') {
        bannerEl.style.display = 'none';
        return;
      }
      bannerEl.style.display = 'flex';

      // 后端结论还没到手：不许先给一句"达标"占位。
      if (latestQaError) {
        bannerEl.className = 'wpd-qa-banner wpd-qa-banner--warn';
        textEl.innerHTML = `<strong>百分比总和自检</strong>: 无法取得后端校验结果（${latestQaError}）`;
        subEl.textContent = '未检验';
        return;
      }
      if (!latestAggregate) {
        bannerEl.className = 'wpd-qa-banner wpd-qa-banner--warn';
        textEl.innerHTML = '<strong>百分比总和自检</strong>: 分析中...';
        subEl.textContent = '-- 层位';
        return;
      }

      const agg = latestAggregate;
      bannerEl.className =
        agg.level === 'green' ? 'wpd-qa-banner wpd-qa-banner--ok' : 'wpd-qa-banner wpd-qa-banner--warn';
      textEl.innerHTML = `<strong>百分比总和自检</strong>: ${aggregateHeadline(agg)}${
        agg.detail ? `｜${agg.detail}` : ''
      }`;
      subEl.textContent = `${agg.nChecked} 层位被检验`;
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
      updateRowSetCaption();
    };

    /**
     * 选择器下方那行"当前行集是哪来的、有多少行"。
     *
     * 界面必须同时说明两件事：来源（控制点并集 / 标尺均匀 / 拐点清单）与行数。
     * 用户原来只看到「预览 125 行」，下载却是 35 行，没有任何一处文字解释这个差异。
     */
    const updateRowSetCaption = () => {
      if (!rowSetCaptionEl) return;
      if (currentRows.length === 0) {
        rowSetCaptionEl.style.color = 'var(--status-warning)';
        rowSetCaptionEl.textContent =
          '当前行集为空（0 行）：这个数据集在当前图谱上没有可用层位。请先在步骤 3 完成 Y 轴标定，或换一个数据集。';
        return;
      }
      const source = ROWSET_SOURCE[datasetSelect.value] ?? '按当前数据集';
      rowSetCaptionEl.style.color = 'var(--text-muted)';
      rowSetCaptionEl.textContent = `${source}（${currentRows.length} 行）· 预览、复制与 CSV 下载都按此行集导出`;
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
    // 自检行只复述后端结论，所以必须真的去问一次后端（不能等用户点按钮）。
    void refreshQa();

    // 复制到剪贴板
    const copyBtn = modal.querySelector('#btn-wpd-copy') as HTMLButtonElement;
    copyBtn?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = '已复制';
      setTimeout(() => (copyBtn.textContent = '复制当前数据'), 1500);
    });

    // 下载 CSV：**导出当前预览矩阵本身**，不再另走一条后端通路。
    //
    // 以前这里直连 `export.csv`，后端按 `samples` 采样层位出表，与上方数据集选择器
    // 控制的行集是两个东西 —— 用户看到「预览 125 行、下载 35 行」，界面没有任何说明，
    // 无法判断哪个权威（U-ROWS-01）。
    //
    // 后端也接不住这个需求：`export_csv(depths=…)` 的 `depths` 形参在实现里根本没被
    // 使用（`export.py:1129` 直接转调 `export_data`），`export.exportXlsx` /
    // `export.exportLipd` 更是没有行集参数。所以"选择器同时控制下载"只能由前端
    // 把**同一个矩阵**写出去 —— 这同时保证了预览与下载物逐格同值（构造即成立）。
    modal.querySelector('#btn-wpd-download-csv')?.addEventListener('click', () => {
      if (currentRows.length === 0) {
        // 空行集给"成功下载了一个空文件"是最误导的做法：用户会以为导完了。
        notifyError(
          '当前行集为空（0 行），没有可导出的数据：请先在步骤 3 完成 Y 轴标定，或换一个数据集。'
        );
        return;
      }
      // 这条路径是自己拼字符串 + 造 Blob，没有后端参与，但**照样会失败**
      // （序列化异常、Blob 构造被环境拒绝、移动端内存不足）。失败必须让用户看见，
      // 不能停在"点了没反应"（本仓 §2：禁止静默兜底）。
      try {
        const csvStr = serializeMatrixToText(currentHeaders, currentRows);
        const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `straditize_${this.data.primary_roi_id || 'data'}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err: any) {
        notifyError(`导出 CSV 失败: ${err?.message || err}`);
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
          // 空态**必须把理由显示出来**：禁用控件如果不说为什么，用户只能猜。
          // 原来这里 display='none'，而「暂无原生或导入集成表」这句恰好就在这个容器里
          // ——等于给了一个看得见、却永远灰着的选项。原生集成表要跑年代模型（依赖 R）
          // 才会出现，所以空态在新机器上是**常态**，不是边界情况。
          subEnsemble.style.display = 'block';
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
