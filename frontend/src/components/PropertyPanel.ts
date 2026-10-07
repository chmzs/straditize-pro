import { Column, DataRoi, DiagramCalibration, DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { ExportModal } from './ExportModal';
import { ProjectManager } from '../core/ProjectManager';

export class PropertyPanel {
  private container: HTMLElement;
  private data: DiagramData;
  private rpcClient: RpcClient;
  private onCalibrationSave: (cal: DiagramCalibration) => void;
  private onRoiSave: (roi: DataRoi) => void;

  private exportModal: ExportModal;
  private projectManager: ProjectManager;

  constructor(
    container: HTMLElement,
    data: DiagramData,
    rpcClient: RpcClient,
    onCalibrationSave: (cal: DiagramCalibration) => void,
    onRoiSave: (roi: DataRoi) => void,
    onProjectLoad?: (projectData: DiagramData) => void
  ) {
    this.container = container;
    this.data = data;
    this.rpcClient = rpcClient;
    this.onCalibrationSave = onCalibrationSave;
    this.onRoiSave = onRoiSave;

    this.projectManager = new ProjectManager(data, rpcClient, onProjectLoad);
    this.exportModal = new ExportModal(container, data, rpcClient, this.projectManager);
  }

  public updateData(data: DiagramData): void {
    this.data = data;
    this.exportModal.updateData(data);
    this.projectManager.updateData(data);
  }

  /**
   * 1. 打开取数区域与深度网格设置模态框。
   *
   * 深度轴本身不在这里设：它由 S4 画布上的两点标定确定（像素点 + 真实值），
   * 用一对"min/max 数字框"表达不了"哪一行像素对应哪个值"。
   */
  public openCalibrationModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const cal = this.data.calibration;
    const roi = this.data.roi;
    const bounds = CoordinateSystem.calibrationBounds(cal);

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>取数区域与层位网格设置 (ROI &amp; Grid)</h3>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>数据取数区像素范围 (Data ROI):</label>
            <div class="input-row">
              <input type="number" id="roi-xmin" value="${Math.round(roi.xMin)}" title="左界" />
              <span style="color: var(--text-muted);">~</span>
              <input type="number" id="roi-xmax" value="${Math.round(roi.xMax)}" title="右界" />
              <span class="unit-label">px (X)</span>
            </div>
            <div class="input-row" style="margin-top: 6px;">
              <input type="number" id="roi-ymin" value="${Math.round(roi.yMin)}" title="顶界" />
              <span style="color: var(--text-muted);">~</span>
              <input type="number" id="roi-ymax" value="${Math.round(roi.yMax)}" title="底界" />
              <span class="unit-label">px (Y)</span>
            </div>
            <small>框定纯数据区，排除坐标轴、文字与聚类树。此框不携带任何深度含义。</small>
          </div>

          <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light);">
            <label style="display: block; margin-bottom: 6px;">Y 轴深度标定 (只读):</label>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.7;">
              ${
                bounds
                  ? `① Y=${bounds.topPx}px → <strong>${bounds.topValue} ${cal.unit}</strong><br>
                     ② Y=${bounds.bottomPx}px → <strong>${bounds.bottomValue} ${cal.unit}</strong>`
                  : '<span style="color: #f59e0b; font-weight: 700;">尚未标定</span> —— 深度一律显示为 --'
              }
            </div>
            <small style="display: block; margin-top: 6px;">在 S4 面板点击「 开始两点标定」后在画布上点两个已知刻度即可修改。</small>
          </div>

          <div class="form-group">
            <label>剖面标准采样间隔 (Depth Grid Interval):</label>
            <div class="input-row">
              <input type="number" id="cal-depth-interval" value="${cal.depthInterval ?? 2}" step="any" min="0.01" />
              <span class="unit-label">${cal.unit} / 层位</span>
            </div>
            <small>设定剖面采样间隔（例如从 ${bounds ? bounds.topValue : '?'} 到 ${bounds ? bounds.bottomValue : '?'} ${cal.unit}，每隔 ${cal.depthInterval ?? 2} ${cal.unit} 作为一个标准层位）</small>
          </div>

          <div class="form-group">
            <div class="checkbox-row" style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <input type="checkbox" id="cal-depth-grid" ${cal.depthGridEnabled !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--accent-blue); cursor: pointer;" />
              <label for="cal-depth-grid" style="cursor: pointer; color: var(--text-primary); font-size: 12.5px; font-weight: 500;">
                在画布上显示水平淡蓝色层位标线 (Depth Grid Lines)
              </label>
            </div>
            <small style="margin-left: 24px;">贯穿所有属种列，确保数据直接锚定在这些固定的层位深度上</small>
          </div>
        </div>
        <div class="modal-footer">
          <button class="ui-btn ui-btn--secondary" id="modal-cancel">取消</button>
          <button class="ui-btn ui-btn--primary" id="modal-save">保存设置</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#modal-close')?.addEventListener('click', closeModal);
    modal.querySelector('#modal-cancel')?.addEventListener('click', closeModal);

    modal.querySelector('#modal-save')?.addEventListener('click', () => {
      const num = (sel: string, fallback: number) => {
        const parsed = parseFloat((modal.querySelector(sel) as HTMLInputElement).value);
        return isNaN(parsed) ? fallback : parsed;
      };
      const intervalVal = num('#cal-depth-interval', cal.depthInterval ?? 2);
      const gridEnabledVal = (modal.querySelector('#cal-depth-grid') as HTMLInputElement).checked;

      const nextRoi: DataRoi = {
        xMin: num('#roi-xmin', roi.xMin),
        xMax: num('#roi-xmax', roi.xMax),
        yMin: num('#roi-ymin', roi.yMin),
        yMax: num('#roi-ymax', roi.yMax),
      };
      this.onRoiSave(nextRoi);

      this.onCalibrationSave({
        ...cal,
        depthInterval: intervalVal,
        depthGridEnabled: gridEnabledVal,
      });
      closeModal();
    });
  }

  /**
   * 2. 导出界面打开 (委托至 ExportModal)
   */
  public openExportModal(initialContent: string = '', format: 'csv' | 'json' = 'csv'): void {
    this.exportModal.open(initialContent, format);
  }

  /**
   * 3. 项目化保存为开放标准 .tar 归档 (委托至 ProjectManager)
   */
  public async saveProjectFile(): Promise<void> {
    return this.projectManager.saveProjectFile();
  }

  /**
   * 4. 生成地学标准 CSV 表格 (委托至 ProjectManager)
   */
  public generateStandardCsv(): string {
    return this.projectManager.generateStandardCsv();
  }

  /**
   * 5. 生成针对当前图谱与属种列的 R 语言绘图脚本 (委托至 ProjectManager)
   */
  public static generateRScript(columns: Column[], unit: string = 'cm'): string {
    return ProjectManager.generateRScript(columns, unit);
  }

  /**
   * 6. 打开已有项目 (委托至 ProjectManager)
   */
  public openProjectFile(file: File): void {
    this.projectManager.openProjectFile(file);
  }

  /**
   * 7. 后端 JSON-RPC 配置弹窗
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
          <p style="color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
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
              ${status.connected ? '已连接到后端 Agent 2' : '本地 Mock 仿真自主运行 (无后端)'}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="ui-btn ui-btn--secondary" id="modal-close-btn">关闭</button>
          <button class="ui-btn ui-btn--primary" id="btn-probe">重新探测连接</button>
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
