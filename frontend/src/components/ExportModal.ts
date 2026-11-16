import { DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { ProjectManager } from '../core/ProjectManager';
import { base64ToBlob, requireExportBase64, triggerDownload } from '../core/exportPayload';
import { computeExportReadiness, renderExportReadiness } from './steps/ExportReadinessPanel';
import {
  aggregateHeadline,
  aggregateQaScope,
  QA_DEFAULT_TOLERANCE,
  type QaAggregate,
  type QaScopePart,
} from '../core/qaVerdict';
import type { QaSummary } from '../types/pollen';
import { notify, notifyError } from '../ui/feedback';
import { copyText } from '../ui/clipboard';

let activeExportRefresh: (() => void) | null = null;

/**
 * 与后端 `export.py::PERCENT_UNITS` 同一口径：只有百分比族才走 0–100 基准。
 *
 * 两处必须一致，否则「跟随单位」在界面上说的和脚本里画的是两回事。
 */
const PERCENT_UNITS = new Set(['%', '％', 'percent', 'pct']);
const isPercentUnit = (unit?: string | null): boolean =>
  PERCENT_UNITS.has(String(unit ?? '').trim().toLowerCase());

/** 刷新当前打开的导出面板（未打开时为空操作）。 */
export function refreshOpenExportModal(): void {
  activeExportRefresh?.();
}

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
   * 出图的数据源是**主有效区**（后端 `_primary_roi_export_frame`），所以列量程只列
   * 该区的组。按组而不是按列：组已经是量纲与形态的归属单位，28 列逐列勾没人受得了。
   */
  private plotScaleGroups(): Array<{ gid: string; name: string; unit: string; columns: string[] }> {
    const rois = this.data.rois ?? [];
    const roi = rois.find((r) => r.id === this.data.primary_roi_id) ?? rois[0];
    const groups = roi?.x_groups ?? [];
    const fallbackGid = roi?.default_group_id || groups[0]?.id;
    const columns = this.data.columns ?? [];
    return groups.map((group) => ({
      gid: group.id,
      name: group.name,
      unit: group.unit || '%',
      columns: columns
        .filter((col) => (col.x_group_id || fallbackGid) === group.id)
        .map((col) => col.name),
    }));
  }

  /**
   * 导出界面打开 (对齐 WebPlotDigitizer / WPD 专业科学数据导出面板，支持排序、格式化、复制、下载与在线成图)
   */
  public open(_initialContent: string = '', _format: 'csv' | 'json' = 'csv'): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const readiness = computeExportReadiness(this.data);
    // 列量程行：按组列，默认「跟随单位」（unit 是唯一事实源，这里只做覆盖）。
    const scaleGroups = this.plotScaleGroups();
    const scaleRowsHtml = scaleGroups.length
      ? scaleGroups
          .map((group) => {
            const follow = isPercentUnit(group.unit) ? '按列归一' : '自身量程';
            return `
              <label style="display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm);">
                <span style="min-width: 110px; color: var(--text-primary);">${group.name}</span>
                <span style="color: var(--text-muted); min-width: 150px;">单位 ${group.unit} · ${group.columns.length} 列</span>
                <select class="sel-wpd-scale-mode" data-group-id="${group.gid}" data-group-unit="${group.unit}" style="font-size: var(--font-size-sm);">
                  <option value="follow" selected>跟随单位（${follow}）</option>
                  <option value="normalize">强制按列归一</option>
                  <option value="fixed">强制自身量程</option>
                </select>
              </label>`;
          })
          .join('')
      : '<span style="font-size: var(--font-size-xs); color: var(--text-muted);">当前有效区没有分组。</span>';

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
          <div class="wpd-export-main">
          <!-- 左侧：双模式（表格预览与交互编辑 / 原始代码）区域 -->
          <div class="wpd-left-area" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; height: 100%;">
            <!-- 地层丰度百分比总和自检门禁 (Sum Check QA Gate) -->
            <div id="wpd-sum-check-banner" class="wpd-qa-banner wpd-qa-banner--ok">
              <span id="wpd-sum-check-text"><strong>百分比总和自检</strong>: 分析中...</span>
              <span id="wpd-sum-check-sub" class="wpd-qa-banner__sub">-- 层位</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0;">
              <div style="display: flex; gap: 4px;">
                <button id="tab-btn-grid" class="ui-btn ui-btn--quiet ui-btn--xs active-mode" style="font-size: var(--font-size-sm); padding: 4px 10px;" title="可就地编辑的数值表格">数据表格</button>
                <button id="tab-btn-text" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-sm); padding: 4px 10px;" title="原始 CSV 文本，可复制或手工调整">原始文本</button>
              </div>
              <div style="font-size: var(--font-size-sm); color: var(--text-muted); display: flex; gap: 10px; align-items: center;">
                <span>Variables: <strong id="wpd-vars-label" style="color: var(--accent-blue);">Depth, 29 Taxa</strong></span>
                <span id="wpd-data-size-label">0 KB</span>
                <button id="btn-wpd-reset-edits" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 2px 7px; color: var(--text-muted);" title="清除所有手动微调，还原为图谱自动提取值">还原提取值</button>
              </div>
            </div>

            <!-- 视图 1: 交互式表格视图 (支持直接点选单元格修改数字) -->
            <div id="wpd-table-wrapper" class="wpd-table-wrapper" style="flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; border: 1px solid var(--border-light); border-radius: 6px;">
              <table id="wpd-preview-table" class="wpd-preview-table">
                <!-- 动态填充 thead 与 tbody -->
              </table>
            </div>

            <!-- 视图 2: 纯文本导出框 (可复制或手工调整) -->
            <textarea id="wpd-data-textarea" class="export-textarea" style="display: none; flex: 1; min-height: 0; font-family: var(--font-mono); font-size: var(--font-size-sm); line-height: 1.45;"></textarea>

            <div style="font-size: var(--font-size-xs); color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
              <span>提示：点击任意表格单元格可直接修改数值（修改项呈橙色高亮），导出 CSV、R 脚本与 TAR 包将实时同步生效。</span>
            </div>
          </div>

          <!-- 右侧：WPD 风格的控制面板 (Dataset, Sort, Format, Visualize) 并列排布 -->
          <div class="wpd-right-controls" style="width: 270px; min-width: 270px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); box-sizing: border-box;">
            <!-- 导出就绪状态清单 (T10) -->
            ${renderExportReadiness(this.data)}

            <!-- 数据集选择 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--text-primary);">Dataset (数据集形态):</label>
              <select id="wpd-dataset-select" class="sample-select" style="width: 100%; font-size: var(--font-size-sm);">
                <option value="samples" selected>1. 共识层位 —— 每个采样层位一行；与 data.csv / TAR / XLSX 同源</option>
                <option value="union_points">2. 各列拐点并集 —— 所有列的拐点深度合并去重成行；某列在该深度没有拐点则按其曲线线性插值（不是 0）</option>
                <option value="turning_points">3. 拐点原始坐标表 —— 长表，一行一个拐点（taxon/type/depth/value/x/y）；不能与上面两张矩阵表混用</option>
                <!-- 缺值口径必须写在面板上：插值 vs NA 是两种完全不同的数，用户看不到就会误读。 -->
                <div style="margin-top: 4px; font-size: var(--font-size-xs); line-height: 1.45; color: var(--text-muted);">
                  共识层位上某列没有拐点时：<b>已标定列</b>按该列曲线线性插值填充；<b>未标定列</b>仍为 NA（不给数）。
                </div>
                <optgroup label="高级">
                  <option value="depth_grid">按深度间隔重采样 —— 按设置里的深度间隔生成规则层位（调试/等距辅助用，不是共识层位）</option>
                </optgroup>
              </select>
              <!--
                行集说明：用户必须先知道"这 N 行是哪来的"。
                以前预览（控制点并集）与下载（后端样品层位）是两套行集，界面一个字都没说，
                用户看到「预览 125 行 / 下载 35 行」完全无法判断哪个权威（U-ROWS-01）。
              -->
              <div id="wpd-rowset-caption" style="margin-top: 5px; font-size: var(--font-size-sm); line-height: 1.45; color: var(--text-muted);"></div>
            </div>

            <!-- 排序 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--text-primary);">Sort (排序):</label>
              <div style="display: flex; gap: 6px;">
                <select id="wpd-sort-by" class="sample-select" style="flex: 1; font-size: var(--font-size-sm);">
                  <option value="depth" selected>Depth (深度)</option>
                  <option value="raw">Raw (原始)</option>
                </select>
                <select id="wpd-sort-order" class="sample-select" style="flex: 1; font-size: var(--font-size-sm);">
                  <option value="asc" selected>升序 (顶->底)</option>
                  <option value="desc">降序 (底->顶)</option>
                </select>
              </div>
            </div>

            <!-- 格式化 Format -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--text-primary);">Format (格式化):</label>
              <div style="display: flex; flex-direction: column; gap: 6px; font-size: var(--font-size-sm);">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">浮点精度:</span>
                  <input type="number" id="wpd-digits" value="2" min="0" max="6" style="width: 60px; font-size: var(--font-size-sm);" />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">列分隔符:</span>
                  <select id="wpd-col-sep" class="sample-select" style="width: 80px; font-size: var(--font-size-sm);">
                    <option value="," selected>逗号 (,)</option>
                    <option value="\t">Tab (\\t)</option>
                    <option value=";">分号 (;)</option>
                    <option value=" ">空格 ( )</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">缺测填充:</span>
                  <select id="wpd-na-fill" class="sample-select" style="width: 80px; font-size: var(--font-size-sm);">
                    <!-- 默认必须是 NA：缺测（未测到）不是"零丰度"。
                         曾经默认选中 0.0，等于教用户把"没测"当成"测到 0"写进结果。 -->
                    <option value="0.0">0.0（当成真实零丰度，慎用）</option>
                    <option value="NaN">NaN</option>
                    <option value="NA" selected>NA（推荐）</option>
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
            <div id="wpd-workbook-rowset-note" style="font-size: var(--font-size-xs); line-height: 1.5; color: var(--status-warning); padding: 6px 8px; border-radius: 4px; background: rgba(245, 158, 11, 0.10); border: 1px solid rgba(245, 158, 11, 0.35);">
              XLSX / LiPD / TAR 由后端生成，固定按「样品层位」出表（与上方预览的行集可能不同）。
            </div>

            <div class="divider" style="margin: 2px 0;"></div>

            <!-- 导出内容选择与集成表 (规范第九章) -->
            <div class="form-group wpd-content-tree-box" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--accent-blue);">导出内容选择 (Content Tree):</label>
              <div style="display: flex; flex-direction: column; gap: 5px; font-size: var(--font-size-xs); margin-top: 5px;">
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
                <div id="ensemble-sub-options" style="display: none; padding-left: 18px; font-size: var(--font-size-xs); color: var(--text-muted);">
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
              <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--accent-blue);">导出格式说明:</label>
              <p style="font-size: var(--font-size-xs); color: var(--text-muted); line-height: 1.4; margin-bottom: 6px;">
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

          <!-- 出图设置与预览（全宽，跟在主区下面）。
               这两块必须在 body（滚动区）**内部**：旧版把它们放在 body 与 footer 之间，
               预览一出现就把 footer 顶出视口、y 轴范围与列量程也被挤出首屏（1366×768 实测）。
               现在 body 是唯一滚动容器，footer 钉在 grid 第三行，任何时候都完整可见。 -->
          <div class="wpd-export-extras">
            <!-- y 轴范围：三项都填才生效（后端 validate_y_axis 同一口径）。留空 = 自动。 -->
            <div class="form-group" id="wpd-plot-options" style="margin: 0;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--font-size-sm);">
                <span style="color: var(--text-muted);" title="三项都填才生效（与后端 validate_y_axis 同一口径）；留空 = 按数据自动">y 轴范围（留空=自动）：</span>
                <input type="number" id="inp-wpd-y-min" placeholder="min" style="width: 72px; font-size: var(--font-size-sm);" />
                <input type="number" id="inp-wpd-y-max" placeholder="max" style="width: 72px; font-size: var(--font-size-sm);" />
                <input type="number" id="inp-wpd-y-interval" placeholder="间隔" style="width: 72px; font-size: var(--font-size-sm);" />
                <span id="wpd-plot-y-hint" style="font-size: var(--font-size-xs); color: var(--status-warning);"></span>
              </div>

              <!-- 列量程（按组）：默认跟随单位——非 % 的组按自身量程画，不与百分比列共用
                   0–100 基准。这里只做覆盖，不改组的单位（unit 是唯一事实源）。
                   说明压成两行；例子（A 列 20% / B 列 5%）进 summary 的 title——写在正文里
                   会在窄栏折成五行碎片（用户实测反馈）。 -->
              <details id="wpd-scale-mode-box" style="margin-top: 6px;">
                <summary style="font-size: var(--font-size-sm); color: var(--text-muted); cursor: pointer;" title="默认「跟随单位」：unit 是百分比族就按 rioja 惯例画（每列按本列最大值归一、画满宽），否则按该组自身量程画。例：A 列 max 20%、B 列 max 5%，归一后两者都画满宽——不是共用一把 0–100 的尺；要固定尺请选「强制自身量程」。">
                  列量程（按组，默认跟随单位）
                </summary>
                <div style="font-size: var(--font-size-sm); color: var(--text-muted); margin: 4px 0 6px; line-height: 1.5;">
                  百分比组按本列最大值归一后画满宽（花粉图惯例）；非 <code>%</code> 的组按自身量程（min..max）画。
                  这里的覆盖只影响本次出图，不改组的单位。
                </div>
                <div id="wpd-scale-mode-rows" style="display: flex; flex-direction: column; gap: 4px;">
                  ${scaleRowsHtml}
                </div>
              </details>
            </div>

            <!-- 本机出图预览：图直接显示在这里，下载走浏览器下载事件。
                 以前只把路径写进 ~/.straditize/plots，用户点完按钮还得自己去隐藏目录里找，
                 那不是「出图」，是「出一个文件路径」。

                 尺寸：height 取 min(34vh, 360px)——1366×768 下约 261px，加工具行与 meta 行
                 仍能让 footer 与设置项留在首屏；更大的图交给缩放/平移看。
                 工具行只放控件与百分比，长说明进 title 与下方 meta 行，避免窄栏折成碎片。 -->
            <div class="form-group" id="wpd-plot-preview-box" style="display: none; margin: 12px 0 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; flex-wrap: nowrap;">
                <label style="font-size: var(--font-size-sm); font-weight: bold; color: var(--accent-blue); white-space: nowrap;">本机出图预览</label>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;">
                  <select id="sel-wpd-plot-format" class="sample-select" style="font-size: var(--font-size-sm);" title="下载格式：JPEG 位图，直接分享；PDF 矢量，适合排版放大（只影响下载，预览固定 JPEG）">
                    <option value="jpeg" selected>JPEG（位图 · 直接分享）</option>
                    <option value="pdf">PDF（矢量 · 排版放大）</option>
                  </select>
                  <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-plot-download" disabled>下载图片</button>
                  <button class="ui-btn ui-btn--quiet ui-btn--sm" id="btn-wpd-plot-close" title="关闭预览并释放图片数据">✕ 关闭</button>
                </div>
              </div>
              <div id="wpd-plot-toolbar" style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: nowrap; font-size: var(--font-size-xs); color: var(--text-muted); line-height: 20px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-wpd-plot-fit" title="整图缩放到预览框内（默认）">适应窗口</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-wpd-plot-actual" title="按图片原始像素 1:1 显示，超出部分拖拽查看">1:1</button>
                <span id="wpd-plot-zoom-label" style="min-width: 36px; text-align: right;">100%</span>
              </div>
              <div id="wpd-plot-frame" title="滚轮缩放（以光标为锚点）· 拖拽平移 · 双击复位" style="position: relative; border: 1px solid var(--border-light); border-radius: 6px; background: var(--bg-tertiary); padding: 0; height: min(34vh, 360px); overflow: hidden; cursor: grab; touch-action: none;">
                <img id="wpd-plot-image" alt="地层图预览" draggable="false" style="display: block; width: 100%; height: 100%; object-fit: contain; transform-origin: 0 0; will-change: transform; user-select: none;" />
              </div>
              <p id="wpd-plot-meta" style="font-size: var(--font-size-xs); color: var(--text-muted); margin: 6px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></p>
            </div>
          </div>
        </div>

        <div class="ui-modal__footer export-modal-footer">
          <button class="ui-btn ui-btn--quiet" id="btn-wpd-copy">复制当前数据</button>
          <button class="ui-btn ui-btn--quiet ui-btn--sm" id="btn-wpd-refresh" title="重新从后端拉取当前行集（画布上改过控制点后点这里）">刷新数据</button>
          <div class="export-format-actions">
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-csv">CSV</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-lipd" title="导出符合 LiPD / LinkedEarth 规范的数据包">LiPD</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-r" title="下载 rioja::strat.plot 绘图脚本">R 脚本</button>
            <button class="ui-btn ui-btn--primary ui-btn--sm" id="btn-wpd-plot-oneclick" title="用本机 R 的 rioja::strat.plot 直接出图（不联网）">本机出图</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-tar" title="下载包含数据、原图与脚本的项目归档">TAR 归档</button>
            <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-wpd-download-json">JSON</button>
          </div>
          <button class="ui-btn ui-btn--primary" id="btn-wpd-download-xlsx" title="导出包含元数据、花粉、年代与集成表的工作簿">导出 XLSX</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    const closeModal = () => {
      activeExportRefresh = null;
      modal.remove();
    };
    modal.querySelector('#export-modal-close')?.addEventListener('click', closeModal);

    const textarea = modal.querySelector('#wpd-data-textarea') as HTMLTextAreaElement;
    const datasetSelect = modal.querySelector('#wpd-dataset-select') as HTMLSelectElement;
    const sortBySelect = modal.querySelector('#wpd-sort-by') as HTMLSelectElement;
    const sortOrderSelect = modal.querySelector('#wpd-sort-order') as HTMLSelectElement;
    const digitsInp = modal.querySelector('#wpd-digits') as HTMLInputElement;
    const colSepSelect = modal.querySelector('#wpd-col-sep') as HTMLSelectElement;
    const naFillSelect = modal.querySelector('#wpd-na-fill') as HTMLSelectElement;
    const sizeLabel = modal.querySelector('#wpd-data-size-label') as HTMLElement;
    const rowSetCaptionEl = modal.querySelector('#wpd-rowset-caption') as HTMLElement | null;

    /** 数据集 → 行集来源的人话名字（与 `#wpd-dataset-select` 的选项一一对应）。 */
    const ROWSET_SOURCE: Record<string, string> = {
      samples: '按共识层位（samples）',
      union_points: '按各列拐点并集（无拐点处插值）',
      depth_grid: '按深度间隔重采样（高级）',
      turning_points: '按拐点原始坐标表',
    };

    // 动态表格数据模型与手动微调记录
    let currentHeaders: string[] = [];
    let currentRows: Array<string[]> = [];
    const userEdits = new Map<string, string>(); // key: `${rowIdx}_${colIdx}` -> editedValue

    /** 后端返回的原始 CSV；**没有用户编辑时**界面与下载都用它，保证逐字节一致。 */
    let backendCsvText = '';
    /** 异步取数的乱序保护：同一个面板只有最后一次 dataset 请求可以落地。 */
    let displayToken = 0;

    /** 后端 CSV → 矩阵。后端输出是纯逗号分隔、无引号（taxon 名不含逗号）。 */
    const parseDelimitedMatrix = (text: string): { headers: string[]; rows: string[][] } => {
      const trimmed = text.trim();
      if (!trimmed) return { headers: [], rows: [] };
      const lines = trimmed.split(/\r?\n/);
      return {
        headers: lines[0].split(',').map((cell) => cell.trim()),
        rows: lines.slice(1).map((line) => line.split(',').map((cell) => cell.trim())),
      };
    };

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
      // 无编辑时直接用后端的原文：这样「面板里看到的」与「点 CSV 下载到的」
      // 是同一串字节，不经过任何前端再序列化（U-ROWS-01 的判据就钉在这里）。
      const dataStr = userEdits.size > 0
        ? serializeMatrixToText(currentHeaders, currentRows)
        : backendCsvText || serializeMatrixToText(currentHeaders, currentRows);
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

    const updateFullDisplay = async () => {
      // 行集与数值**全部由后端产出**（`export.csv{dataset}`）：面板只是它的渲染。
      // 这样「预览看到的数」与「点 CSV 下载到的数」由构造保证同源，不再让前端
      // 用 `SplineInterpolator` 在 controlPoints 上另造一套（两套数差 11.8×/2.1×）。
      const dataset = datasetSelect.value;
      const requestToken = ++displayToken;
      let csvText = '';
      try {
        const res = await this.rpcClient.call<any, any>('export.csv', { dataset });
        csvText = typeof res === 'string' ? res : (res?.csv || res?.csv_content || '');
      } catch (err: any) {
        if (requestToken !== displayToken) return;
        // 后端明确说没有可导出行集（`STATE_ERROR`）时，**面板本身**必须说明，
        // 不能只剩一条 toast + 一张空表 —— 空表看起来像"这张图没数据"。
        currentHeaders = [];
        currentRows = [];
        backendCsvText = '';
        renderTableGrid();
        syncSerializedText();
        updateSumCheck();
        if (rowSetCaptionEl) {
          rowSetCaptionEl.style.color = 'var(--status-warning)';
          // 「未标定」与「行集为空」是两件事：前者是**导出被拒绝**，后者是没数据。
          // 而后端现在有两种「未标定」拒绝（都是 -32003），指向**不同步骤**：
          //   深度未标定 → 步骤 3（Y 轴两点标定）；
          //   全列未标定 → 步骤 6（刻列：点刻度齿标定 X 轴）。
          // 判据只认后端给的结构化 `reason`（`data.reason`，经 RpcClient 冒泡），
          // 退化时也只匹配后端那句**逐字**开头；绝不按模糊的 includes('标定') 判——
          // 那句话两种错误都含，实测会把卡在步骤 6 的用户引去步骤 3。
          const errText = String(err?.message ?? err ?? '');
          const reason = (err as { data?: { reason?: string } } | null)?.data?.reason;
          const lacksColumnScale =
            reason === 'column_scale' || errText.includes('导出需要列刻度');
          const lacksDepthScale =
            reason === 'depth_calibration' || errText.includes('导出需要深度标定');
          rowSetCaptionEl.textContent = lacksColumnScale
            ? '导出需要列刻度：所有属种列都还没有 X 轴标度，这张表一个读数也不会有。请先完成步骤 6（刻列）的刻度齿标定，再回到这里导出。'
            : lacksDepthScale
              ? '导出需要深度标定：请先完成步骤 3 的 Y 轴两点标定（当前未标定），完成后再回到这里导出。'
              : `当前行集为空（0 行）：${dataset} 数据集在此会话没有可导出的层位。请先在步骤 3 完成 Y 轴标定，或换一个数据集。`;
        }
        notifyError(`读取 ${dataset} 数据集失败：${err?.message || err}`);
        return;
      }
      // 快速切换 dataset 时，只有最后一次请求的结果可以落到界面上。
      if (requestToken !== displayToken) return;

      backendCsvText = csvText;
      const parsed = parseDelimitedMatrix(csvText);
      currentHeaders = parsed.headers;
      currentRows = parsed.rows.map((row, rIdx) =>
        row.map((cell, cIdx) => {
          const key = `${rIdx}_${cIdx}`;
          return userEdits.has(key) ? userEdits.get(key)! : cell;
        })
      );
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
      void updateFullDisplay();
    });

    // 刷新：画布上改过锚点后立刻重拉，不关面板也能看到新数。
    modal.querySelector('#btn-wpd-refresh')?.addEventListener('click', () => {
      userEdits.clear();
      void updateFullDisplay();
    });

    // 面板打开期间的后端数据变更（画布改锚点）由 main.ts 通过这个句柄重拉。
    activeExportRefresh = () => {
      userEdits.clear();
      void updateFullDisplay();
    };

    datasetSelect.addEventListener('change', () => {
      userEdits.clear();
      void updateFullDisplay();
    });
    sortBySelect.addEventListener('change', () => void updateFullDisplay());
    sortOrderSelect.addEventListener('change', () => void updateFullDisplay());
    digitsInp.addEventListener('input', () => void updateFullDisplay());
    colSepSelect.addEventListener('change', syncSerializedText);
    naFillSelect.addEventListener('change', () => void updateFullDisplay());

    void updateFullDisplay();
    // 自检行只复述后端结论，所以必须真的去问一次后端（不能等用户点按钮）。
    void refreshQa();

    // 复制到剪贴板：非安全上下文（局域网 http 访问）下 navigator.clipboard 不存在，
    // 旧写法直接 await 会抛 `Cannot read properties of undefined (reading 'writeText')`，
    // 用户看到的是「功能坏了」。copyText 内部判空 + execCommand 回退，失败如实告知。
    const copyBtn = modal.querySelector('#btn-wpd-copy') as HTMLButtonElement;
    copyBtn?.addEventListener('click', async () => {
      const ok = await copyText(textarea.value);
      if (!ok) {
        notifyError('这个地址下浏览器不允许自动复制：请手动全选数据框内容复制。');
        return;
      }
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
    // 本机出图：走本机 R（riojaPlot 优先，缺失时回退 rioja::strat.plot），不联网。
    //
    // 产物**不落盘**：后端把图以 data URL 交回来，这里直接 <img src> 显示，
    // 「下载」交给浏览器下载事件。失败必须把「缺什么」原样告诉用户，
    // 不许变成一张空白图（ARCHITECTURE §2）。
    let lastPlot: { dataUrl: string; format: string } | null = null;
    const plotImg = modal.querySelector('#wpd-plot-image') as HTMLImageElement | null;
    const plotBox = modal.querySelector('#wpd-plot-preview-box') as HTMLElement | null;
    const plotMeta = modal.querySelector('#wpd-plot-meta') as HTMLElement | null;
    const plotDownload = modal.querySelector('#btn-wpd-plot-download') as HTMLButtonElement | null;
    const plotFormat = modal.querySelector('#sel-wpd-plot-format') as HTMLSelectElement | null;
    const plotFrame = modal.querySelector('#wpd-plot-frame') as HTMLElement | null;
    const plotClose = modal.querySelector('#btn-wpd-plot-close') as HTMLButtonElement | null;
    const plotFitBtn = modal.querySelector('#btn-wpd-plot-fit') as HTMLButtonElement | null;
    const plotActualBtn = modal.querySelector('#btn-wpd-plot-actual') as HTMLButtonElement | null;
    const plotZoomLabel = modal.querySelector('#wpd-plot-zoom-label') as HTMLElement | null;

    // ---- 预览区缩放 / 平移 ----
    //
    // 视图 = `translate(tx, ty) scale(scale)`，原点固定在图左上角（`transform-origin: 0 0`）。
    // 默认 scale=1 / tx=ty=0 就是「适应窗口」：`<img>` 是 width/height:100% +
    // `object-fit: contain`，长图自动缩到框内，用户一打开就看见全貌。
    const PLOT_MIN_SCALE = 0.2;
    const PLOT_MAX_SCALE = 12;
    const plotView = { scale: 1, tx: 0, ty: 0 };

    /**
     * 图在容器里的**实际画面**几何。
     *
     * `<img>` 的布局盒永远等于容器，真正画出来的图是盒内居中的那块（contain 会留白）。
     * 缩放/平移必须按画面算：按盒子算的话，光标锚点会偏掉一截留白，图会跟着跑。
     */
    const plotContentBox = () => {
      const boxW = plotImg?.offsetWidth ?? 0;
      const boxH = plotImg?.offsetHeight ?? 0;
      const nw = plotImg?.naturalWidth ?? 0;
      const nh = plotImg?.naturalHeight ?? 0;
      if (!boxW || !boxH || !nw || !nh) return null;
      const ratio = Math.min(boxW / nw, boxH / nh);
      const width = nw * ratio;
      const height = nh * ratio;
      return { boxW, boxH, width, height, left: (boxW - width) / 2, top: (boxH - height) / 2 };
    };

    const applyPlotView = () => {
      if (!plotImg) return;
      plotImg.style.transform =
        `translate(${plotView.tx}px, ${plotView.ty}px) scale(${plotView.scale})`;
      if (plotZoomLabel) plotZoomLabel.textContent = `${Math.round(plotView.scale * 100)}%`;
    };

    /** 适应窗口：整图缩回框内（默认态）。双击也走这里。 */
    const fitPlot = () => {
      plotView.scale = 1;
      plotView.tx = 0;
      plotView.ty = 0;
      applyPlotView();
    };

    /** 1:1：按图片原始像素显示并居中，超出框的部分靠拖拽/滚轮查看。 */
    const actualSizePlot = () => {
      const content = plotContentBox();
      if (!content || !plotImg) return;
      // 居中基准用 img 自己的布局盒（content.boxW/boxH），不用 frame.clientWidth：
      // 框有 1px 边框，clientWidth 不含边框而 img 盒从边框内侧起算，用它会整体偏 1px。
      const frameW = content.boxW;
      const frameH = content.boxH;
      const scale = plotImg.naturalWidth / content.width;
      plotView.scale = scale;
      // 画面中心对到框中心：画面点 u 的屏幕横坐标 = tx + scale * (left + u * width)。
      plotView.tx = frameW / 2 - scale * (content.left + content.width / 2);
      plotView.ty = frameH / 2 - scale * (content.top + content.height / 2);
      applyPlotView();
    };

    /**
     * 以容器内坐标 (px, py) 为锚点缩放到 nextScale：锚点下的那个图像点留在原地。
     *
     * 由画面点 u 的屏幕横坐标 X = tx + s * (left + u * width) 解出 u，再令新比例下
     * X 仍等于 px，得到新的 tx（纵轴同理）。这样滚轮缩放是「钉住光标」而不是
     * 「以框中心缩放」——后者在放大长图时目标会飘走。
     */
    const zoomPlotAt = (px: number, py: number, nextScale: number) => {
      const content = plotContentBox();
      if (!content) return;
      const scale = Math.min(PLOT_MAX_SCALE, Math.max(PLOT_MIN_SCALE, nextScale));
      const u = (px - plotView.tx - plotView.scale * content.left) / (plotView.scale * content.width);
      const v = (py - plotView.ty - plotView.scale * content.top) / (plotView.scale * content.height);
      plotView.scale = scale;
      plotView.tx = px - scale * (content.left + u * content.width);
      plotView.ty = py - scale * (content.top + v * content.height);
      applyPlotView();
    };

    // 新图落地后回到「适应窗口」：换一张图还停在上一次的放大位置，用户会以为图没出来。
    plotImg?.addEventListener('load', () => fitPlot());

    plotFrame?.addEventListener('wheel', (ev) => {
      if (!plotImg?.getAttribute('src')) return;
      // 不 preventDefault 的话，滚轮会连带把弹窗内容滚走，图钉不住。
      ev.preventDefault();
      const rect = plotFrame.getBoundingClientRect();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      zoomPlotAt(ev.clientX - rect.left, ev.clientY - rect.top, plotView.scale * factor);
    }, { passive: false });

    // 拖拽平移：pointer capture 让指针移出框后仍然跟随（否则一甩就断）。
    let dragFrom: { x: number; y: number; tx: number; ty: number } | null = null;
    plotFrame?.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !plotImg?.getAttribute('src')) return;
      dragFrom = { x: ev.clientX, y: ev.clientY, tx: plotView.tx, ty: plotView.ty };
      plotFrame.setPointerCapture(ev.pointerId);
      plotFrame.style.cursor = 'grabbing';
    });
    plotFrame?.addEventListener('pointermove', (ev) => {
      if (!dragFrom) return;
      plotView.tx = dragFrom.tx + (ev.clientX - dragFrom.x);
      plotView.ty = dragFrom.ty + (ev.clientY - dragFrom.y);
      applyPlotView();
    });
    const endPlotDrag = (ev: PointerEvent) => {
      if (!dragFrom) return;
      dragFrom = null;
      if (plotFrame?.hasPointerCapture(ev.pointerId)) plotFrame.releasePointerCapture(ev.pointerId);
      if (plotFrame) plotFrame.style.cursor = 'grab';
    };
    plotFrame?.addEventListener('pointerup', endPlotDrag);
    plotFrame?.addEventListener('pointercancel', endPlotDrag);
    plotFrame?.addEventListener('dblclick', () => fitPlot());
    plotFitBtn?.addEventListener('click', () => fitPlot());
    plotActualBtn?.addEventListener('click', () => actualSizePlot());

    /** 关掉预览并把图数据真的放掉（data URL 是几十万字符的字符串，留着就是泄漏）。 */
    const closePlotPreview = () => {
      lastPlot = null;
      if (plotImg) plotImg.removeAttribute('src');
      if (plotBox) plotBox.style.display = 'none';
      if (plotDownload) plotDownload.disabled = true;
      if (plotMeta) {
        plotMeta.textContent = '';
        plotMeta.removeAttribute('title');
      }
      fitPlot();
    };
    plotClose?.addEventListener('click', () => closePlotPreview());

    /** 预览区的手势说明（只出现在 meta 行与 title 里，不占工具行）。 */
    const PLOT_GESTURE_HINT = '滚轮缩放（以光标为锚点）· 拖拽平移 · 双击复位 · 预览固定 JPEG，下载按所选格式';

    /** 出图（唯一入口）：本机出图按钮与「按所选格式下载」都走这里。失败直接抛。 */
    const renderPlot = async (fmt: string, options: { quiet?: boolean; preview?: boolean } = {}) => {
      // `preview: false` = 只为下载出图（PDF 无法塞进 <img>，塞进去就是一张碎图 +
      // 一条控制台报错）。预览永远是 JPEG，下载按所选格式现场出图。
      const preview = options.preview !== false;
      // y 轴范围三格：三项都填才发给后端（后端同一口径，只给一部分会被整套忽略并提示）。
      const readNum = (selector: string): number | null => {
        const el = modal.querySelector(selector) as HTMLInputElement | null;
        const raw = (el?.value ?? '').trim();
        if (!raw) return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      };
      const yMin = readNum('#inp-wpd-y-min');
      const yMax = readNum('#inp-wpd-y-max');
      const yStep = readNum('#inp-wpd-y-interval');
      const yGiven = [yMin, yMax, yStep].filter((v) => v !== null).length;
      const yHint = modal.querySelector('#wpd-plot-y-hint') as HTMLElement | null;
      let yAxis: { min: number; max: number; interval: number } | null = null;
      if (yGiven === 3) {
        yAxis = { min: yMin as number, max: yMax as number, interval: yStep as number };
        if (yHint) yHint.textContent = '';
      } else if (yGiven > 0) {
        if (yHint) yHint.textContent = '需要三项都填才生效（本次已忽略，按数据自动）';
      } else if (yHint) {
        yHint.textContent = '';
      }
      // 列量程：把组选择展开成「列名 → normalize|fixed」（后端只认列名，组只是批量入口）。
      // 规则：follow 时按单位解析——百分比族 = normalize（后端默认，不必发），其余 = fixed；
      // 显式覆盖照发。只发「与默认不同」的项，纯 % 工程的请求与以前一字不差。
      // 放在 renderPlot 里而不是按钮 handler 里：#35 把出图收敛成唯一入口后，
      // 预览与「按所选格式下载」都走这里，漏一处就会出现「预览对、下载错」。
      const plotScaleMode: Record<string, string> = {};
      modal.querySelectorAll<HTMLSelectElement>('.sel-wpd-scale-mode').forEach((sel) => {
        const unit = sel.dataset.groupUnit ?? '%';
        const byUnit = isPercentUnit(unit) ? 'normalize' : 'fixed';
        const mode = sel.value === 'follow' ? byUnit : sel.value;
        if (mode !== 'normalize' && mode !== 'fixed') return;
        if (mode === 'normalize' && byUnit === 'normalize') return; // 与后端默认相同，不必发
        const gid = sel.dataset.groupId ?? '';
        const group = scaleGroups.find((g) => g.gid === gid);
        for (const colName of group?.columns ?? []) plotScaleMode[colName] = mode;
      });
      const plotSettings: Record<string, unknown> = {};
      if (yAxis) plotSettings.y_axis = yAxis;
      if (Object.keys(plotScaleMode).length) plotSettings.plot_scale_mode = plotScaleMode;
      const res: any = await this.rpcClient.call<any, any>('plot.render', {
        format: fmt,
        ...(Object.keys(plotSettings).length ? { settings: plotSettings } : {}),
      });
      if (!res?.data_url) throw new Error('后端没有返回图片数据（data_url 为空）');
      const plot = { dataUrl: String(res.data_url), format: String(res.format || fmt) };
      if (preview) {
        lastPlot = plot;
        if (plotImg) plotImg.src = plot.dataUrl;
        if (plotBox) plotBox.style.display = '';
        if (plotDownload) plotDownload.disabled = false;
      }
      const sizeKb = Math.round(Number(res?.size_bytes || 0) / 1024);
      const warns: string[] = Array.isArray(res?.warnings) ? res.warnings.filter(Boolean) : [];
      if (plotMeta) {
        const summary =
          `${res?.engine || '?'} · ${res?.columns_count ?? '?'} 列 · ${res?.rows_count ?? '?'} 行 · ` +
          `${res?.format || fmt} · ${sizeKb} KB` +
          (warns.length ? ` · 警告：${warns.join(' / ')}` : '');
        // 手势说明只在这一行出现（工具行只放控件与百分比）：窄窗口放不下就省略号，
        // 全文进 title，hover 可读。
        plotMeta.textContent = `${summary} ｜ ${PLOT_GESTURE_HINT}`;
        plotMeta.title = `${summary}\n${PLOT_GESTURE_HINT}`;
      }
      if (!options.quiet) {
        if (warns.length) notify('出图完成，但有降级：' + warns.join('；'), 'info', 12000);
        else notify('出图完成（' + sizeKb + ' KB）：图在上方预览区，点「下载图片」保存。', 'success', 6000);
      }
      return plot;
    };

    const reportPlotError = (err: any) => {
      const data = (err as { data?: { reason?: string } } | null)?.data;
      notifyError(
        (data?.reason === 'r_missing' ? '本机出图需要 R + rioja：' : '出图失败：') +
          String(err?.message || err)
      );
    };

    // 下载：按**所选扩展名**保存（手里是预览 JPEG，选 PDF 时现场重出，见下）。
    plotDownload?.addEventListener('click', async () => {
      if (!lastPlot) return;
      const selected = plotFormat?.value || 'jpeg';
      const btn = plotDownload;
      btn.disabled = true;
      try {
        // 手里这份是预览用的 JPEG；选 PDF 时必须按 PDF 现场重出，再把 PDF 字节存成
        // .pdf —— 直接把 jpeg 字节存成 .pdf，用户会拿到一个打不开的文件。
        const plot = selected === 'jpeg' && lastPlot.format === 'jpeg'
          ? lastPlot
          : await renderPlot(selected, { quiet: true, preview: false });
        const a = document.createElement('a');
        a.href = plot.dataUrl;
        a.download = `straditize_strat_diagram_${Date.now()}.${plot.format}`;
        a.click();
      } catch (err: any) {
        reportPlotError(err);
      } finally {
        btn.disabled = false;
      }
    });

    modal.querySelector('#btn-wpd-plot-oneclick')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const label = btn.textContent || '本机出图';
      btn.disabled = true;
      btn.textContent = '出图中…';
      try {
        // 预览固定 JPEG：PDF 无法内嵌显示；所选格式只决定「下载图片」写出的扩展名。
        // 列量程由 renderPlot 统一收集（预览与下载共用同一条入口，不能只在一处生效）。
        await renderPlot('jpeg');
      } catch (err: any) {
        reportPlotError(err);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });


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
        // 下载的就是 textarea 里那串（= 面板显示的 CSV）：无编辑时它就是后端
        // `export.csv` 的原文，逐字节一致；有用户编辑时是该编辑后的重序列化。
        const csvStr = textarea.value;
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
        const blob = base64ToBlob(
          requireExportBase64(res, '导出 XLSX'),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        triggerDownload(blob, `straditize_scientific_${Date.now()}.xlsx`);
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
        const blob = base64ToBlob(requireExportBase64(res, '导出 LiPD'), 'application/zip');
        triggerDownload(blob, `straditize_lipdverse_${Date.now()}.lpd`);
      } catch (err: any) {
        notifyError(`导出 LiPD 失败: ${err.message || err}`);
      }
    });
  }
}
