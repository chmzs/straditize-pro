import { RpcClient } from '../services/RpcClient';
import { DiagramData } from '../types/pollen';

export interface AgeDepthInspectionData {
  depths: number[];
  ages: number[];
  age_min: number[];
  age_max: number[];
  px_points?: {
    y: number[];
    x_curve: number[];
    x_min: number[];
    x_max: number[];
  };
  metadata: {
    curve_type: string;
    envelope_type: string;
    depth_unit: string;
    age_unit: string;
    calibration_curve: string;
    notes: string;
  };
}

export class AgeDepthModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private pollenData: DiagramData;
  private onApplyAgeModel: (modelInfo: any) => void;

  private modalEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bgImage: HTMLImageElement | null = null;

  private inspectionData: AgeDepthInspectionData | null = null;
  private showCurve: boolean = true;
  private showEnvelope: boolean = true;
  private showPollenHorizons: boolean = true;
  private overlayOpacity: number = 0.65;

  constructor(
    container: HTMLElement,
    pollenData: DiagramData,
    rpcClient: RpcClient,
    onApplyAgeModel: (modelInfo: any) => void
  ) {
    this.container = container;
    this.pollenData = pollenData;
    this.rpcClient = rpcClient;
    this.onApplyAgeModel = onApplyAgeModel;
  }

  public open(): void {
    this.close();

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large agedepth-dialog" style="width: min(1120px, 95vw); max-height: 92vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">⏳</span>
            <h3>年代-深度模型解译与视觉检查 (Age-Depth Visual Inspection)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #f59e0b, #ef4444); font-size: 10px; padding: 2px 6px;">贝叶斯年代学</span>
          </div>
          <button class="close-btn" id="ad-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; gap: 16px; padding: 14px; overflow: hidden;">
          <!-- 左侧: 交互式视觉检查 Canvas 视口 -->
          <div class="ad-viewport-pane" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-curve" checked />
                  <span style="color: #38bdf8; font-weight: 600;">拟合代表线</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-envelope" checked />
                  <span style="color: #f59e0b; font-weight: 600;">95% 置信带</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-horizons" checked />
                  <span style="color: #34d399; font-weight: 600;">花粉层位交点</span>
                </label>
              </div>

              <div style="display: flex; align-items: center; gap: 6px;">
                <span>图层透明度:</span>
                <input type="range" id="ad-rng-opacity" min="0.1" max="1.0" step="0.05" value="0.65" style="width: 80px;" />
              </div>
            </div>

            <!-- Canvas 容器 -->
            <div id="ad-canvas-container" style="flex: 1; height: 420px; min-height: 360px; position: relative; background: #0b0f19; border: 2px dashed var(--border-color); border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; transition: border-color 0.2s;">
              <canvas id="ad-inspection-canvas" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; display: none;"></canvas>
              
              <!-- 醒目的空状态与上传引导区 (未载入图谱时直接呈现在画布中央) -->
              <div id="ad-empty-drop-zone" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(11, 15, 25, 0.94); z-index: 10; padding: 24px; text-align: center;">
                <div style="font-size: 44px; margin-bottom: 10px;">⏳</div>
                <h4 style="font-size: 15px; font-weight: 700; color: #f8fafc; margin: 0 0 6px 0;">请载入年代-深度模型图谱 (Age-Depth Diagram)</h4>
                <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0 0 16px 0; max-width: 420px; line-height: 1.5;">
                  可直接将 <strong>Bacon / Bchron / Clam / OxCal</strong> 导出的年代曲线图拖拽至此处，或点击下方按钮选择文件。
                </p>
                <button id="ad-btn-center-browse" class="btn btn-primary" style="padding: 8px 24px; font-size: 12.5px; font-weight: 700; margin-bottom: 14px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                  <span>📁 选择本地年代图文件 (PNG / JPG)</span>
                </button>
                <div style="display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--text-muted);">
                  <span>快速体验内置典型范例：</span>
                  <button id="ad-btn-center-bacon" class="tool-btn" style="padding: 3px 10px; font-size: 11px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">Hoya Bacon 贝叶斯图</button>
                  <button id="ad-btn-center-bchron" class="tool-btn" style="padding: 3px 10px; font-size: 11px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">Bchron 阶梯图</button>
                </div>
              </div>

              <div id="ad-canvas-hud" style="position: absolute; bottom: 8px; left: 8px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-family: var(--font-mono); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); pointer-events: none; z-index: 15;">
                悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代
              </div>
            </div>

            <div style="font-size: 10.5px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between;">
              <span>💡 视觉检查标准：高亮蓝线应精确穿过深色脊线；琥珀色阴影应贴合灰色置信区间边缘。</span>
              <span id="ad-status-msg" style="color: #34d399;"></span>
            </div>
          </div>

          <!-- 右侧: 标定控制与花粉样品联动映射表 -->
          <div class="ad-control-pane" style="width: 320px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
            <!-- 年代图谱数据源 -->
            <div class="form-group" style="margin: 0; background: rgba(56, 189, 248, 0.05); padding: 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.2);">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
                <span>年代图谱数据源:</span>
                <span id="ad-current-source-label" style="font-size: 10px; color: #38bdf8;">未载入</span>
              </label>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                <button class="btn btn-primary" id="ad-btn-upload-file" style="width: 100%; font-size: 11.5px; padding: 6px 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                  <span>📁 上传本地年代图 (PNG/JPG)</span>
                </button>
                <input type="file" id="ad-file-input" accept="image/png,image/jpeg,image/webp" style="display: none;" />

                <div style="display: flex; gap: 6px;">
                  <button class="tool-btn" id="ad-btn-load-bacon" style="flex: 1; font-size: 10.5px;">Bacon 范例</button>
                  <button class="tool-btn" id="ad-btn-load-bchron" style="flex: 1; font-size: 10.5px;">Bchron 范例</button>
                </div>
              </div>
            </div>

            <!-- 坐标轴物理标定 -->
            <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size: 11px; font-weight: bold; color: #38bdf8; margin-bottom: 6px;">坐标轴标定 (Axes Calibration):</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10.5px;">
                <div>
                  <label style="color: var(--text-muted);">深度顶端 (Depth Top):</label>
                  <input type="number" id="ad-inp-depth-top" value="0" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">深度底端 (Depth Bottom):</label>
                  <input type="number" id="ad-inp-depth-bottom" value="150" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">年代左端 (Age Left):</label>
                  <input type="number" id="ad-inp-age-left" value="3000" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">年代右端 (Age Right):</label>
                  <input type="number" id="ad-inp-age-right" value="0" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 用户自定义元数据填报 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">附加科学元数据 (Metadata):</label>
              <div style="display: flex; flex-direction: column; gap: 5px; font-size: 10.5px; margin-top: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">拟合线类型:</span>
                  <select id="ad-sel-curve-type" class="sample-select" style="width: 130px; font-size: 10.5px;">
                    <option value="median" selected>中位数 (Median)</option>
                    <option value="weighted_mean">加权均值 (Mean)</option>
                    <option value="best_fit">最佳拟合线 (Best-fit)</option>
                  </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">置信区间类型:</span>
                  <select id="ad-sel-envelope-type" class="sample-select" style="width: 130px; font-size: 10.5px;">
                    <option value="95_hpd" selected>95% 最高后验 (2σ)</option>
                    <option value="68_ci">68% 置信区间 (1σ)</option>
                  </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">年代单位与曲线:</span>
                  <div style="display: flex; gap: 4px;">
                    <input type="text" id="ad-inp-age-unit" value="cal BP" style="width: 65px; font-size: 10px;" />
                    <input type="text" id="ad-inp-cal-curve" value="IntCal20" style="width: 60px; font-size: 10px;" />
                  </div>
                </div>
              </div>
            </div>

            <!-- 执行识别与视觉核查按钮 -->
            <button class="btn btn-primary" id="ad-btn-extract" style="font-size: 11px; padding: 7px; background: linear-gradient(135deg, #0284c7, #38bdf8);">
              🔍 运行识别并叠加视觉检查
            </button>

            <!-- 花粉样品深度联动预览 -->
            <div class="form-group" style="margin: 0; flex: 1; display: flex; flex-direction: column;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">花粉样品年代映射预览:</label>
              <div id="ad-mapping-table-wrap" style="height: 110px; overflow: auto; border: 1px solid var(--border-light); border-radius: 4px; background: rgba(0,0,0,0.3); font-size: 10px; font-family: var(--font-mono);">
                <table style="width: 100%; border-collapse: collapse; text-align: right;">
                  <thead style="position: sticky; top: 0; background: #1e293b; color: #38bdf8;">
                    <tr>
                      <th style="padding: 2px 4px;">Depth</th>
                      <th style="padding: 2px 4px;">Age</th>
                      <th style="padding: 2px 4px;">95% CI</th>
                    </tr>
                  </thead>
                  <tbody id="ad-mapping-tbody">
                    <tr><td colspan="3" style="text-align: center; color: #64748b; padding: 12px;">尚未执行识别提取</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 10.5px; color: var(--text-muted);">
            通过视觉检查确认拟合贴合度后，点击应用可直接赋予当前花粉图谱真实年代轴。
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" id="ad-btn-cancel">取消</button>
            <button class="btn btn-primary" id="ad-btn-apply" style="background: linear-gradient(135deg, #059669, #10b981);">
              ✅ 确认无误，关联至花粉图谱
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(modal);
    this.modalEl = modal;

    this.canvas = modal.querySelector('#ad-inspection-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');

    // 绑定事件
    modal.querySelector('#ad-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#ad-btn-cancel')?.addEventListener('click', () => this.close());

    const chkCurve = modal.querySelector('#ad-chk-curve') as HTMLInputElement;
    const chkEnv = modal.querySelector('#ad-chk-envelope') as HTMLInputElement;
    const chkHorizons = modal.querySelector('#ad-chk-horizons') as HTMLInputElement;
    const rngOpacity = modal.querySelector('#ad-rng-opacity') as HTMLInputElement;

    chkCurve?.addEventListener('change', () => {
      this.showCurve = chkCurve.checked;
      this.renderCanvas();
    });
    chkEnv?.addEventListener('change', () => {
      this.showEnvelope = chkEnv.checked;
      this.renderCanvas();
    });
    chkHorizons?.addEventListener('change', () => {
      this.showPollenHorizons = chkHorizons.checked;
      this.renderCanvas();
    });
    rngOpacity?.addEventListener('input', () => {
      this.overlayOpacity = parseFloat(rngOpacity.value) || 0.65;
      this.renderCanvas();
    });

    // 上传本地年代图文件
    const fileInput = modal.querySelector('#ad-file-input') as HTMLInputElement;
    modal.querySelector('#ad-btn-upload-file')?.addEventListener('click', () => {
      fileInput?.click();
    });
    modal.querySelector('#ad-btn-center-browse')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files[0]) {
        this.handleUploadFile(files[0]);
      }
    });

    // 拖拽文件进入 Canvas 区域
    const dropZone = modal.querySelector('#ad-canvas-container') as HTMLElement;
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#38bdf8';
    });
    dropZone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border-color)';
    });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border-color)';
      const files = e.dataTransfer?.files;
      if (files && files[0]) {
        this.handleUploadFile(files[0]);
      }
    });

    // 载入内置范例
    modal.querySelector('#ad-btn-load-bacon')?.addEventListener('click', () => {
      (modal.querySelector('#ad-inp-depth-top') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value = '150';
      (modal.querySelector('#ad-inp-age-left') as HTMLInputElement).value = '3000';
      (modal.querySelector('#ad-inp-age-right') as HTMLInputElement).value = '0';
      this.loadSampleImage('bacon');
    });
    modal.querySelector('#ad-btn-center-bacon')?.addEventListener('click', () => {
      (modal.querySelector('#ad-inp-depth-top') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value = '150';
      (modal.querySelector('#ad-inp-age-left') as HTMLInputElement).value = '3000';
      (modal.querySelector('#ad-inp-age-right') as HTMLInputElement).value = '0';
      this.loadSampleImage('bacon');
    });

    modal.querySelector('#ad-btn-load-bchron')?.addEventListener('click', () => {
      (modal.querySelector('#ad-inp-depth-top') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value = '150';
      (modal.querySelector('#ad-inp-age-left') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-age-right') as HTMLInputElement).value = '12000';
      this.loadSampleImage('bchron');
    });
    modal.querySelector('#ad-btn-center-bchron')?.addEventListener('click', () => {
      (modal.querySelector('#ad-inp-depth-top') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value = '150';
      (modal.querySelector('#ad-inp-age-left') as HTMLInputElement).value = '0';
      (modal.querySelector('#ad-inp-age-right') as HTMLInputElement).value = '12000';
      this.loadSampleImage('bchron');
    });

    // 提取与视觉检查
    modal.querySelector('#ad-btn-extract')?.addEventListener('click', () => this.executeExtraction());

    // 确认应用
    modal.querySelector('#ad-btn-apply')?.addEventListener('click', () => {
      if (!this.inspectionData) {
        alert('请先点击运行识别并完成视觉检查！');
        return;
      }
      this.onApplyAgeModel(this.inspectionData);
      this.close();
    });

    // 鼠标悬停实时查验
    this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));

    // 默认载入 Bacon 范例图
    this.loadSampleImage('bacon');
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private handleUploadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      alert('请上传有效的图片文件 (PNG/JPG/WebP)！');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = async () => {
        this.bgImage = img;
        if (this.canvas) {
          this.canvas.width = img.naturalWidth;
          this.canvas.height = img.naturalHeight;
          this.canvas.style.display = 'block';
        }
        const emptyZone = this.modalEl?.querySelector('#ad-empty-drop-zone') as HTMLElement;
        if (emptyZone) emptyZone.style.display = 'none';

        const sourceLabel = this.modalEl?.querySelector('#ad-current-source-label');
        if (sourceLabel) sourceLabel.textContent = file.name;

        const statusEl = this.modalEl?.querySelector('#ad-status-msg');
        if (statusEl) statusEl.textContent = `已载入用户图谱: ${file.name} (${img.naturalWidth}×${img.naturalHeight})`;

        // 同步通知后端 Session
        try {
          await this.rpcClient.call('agedepth.loadModelDiagram', { base64_data: dataUrl });
        } catch (err) {
          console.warn('Backend loadModelDiagram via base64 fallback:', err);
        }

        this.inspectionData = null;
        this.renderCanvas();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  private loadSampleImage(sampleKey: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.bgImage = img;
      if (this.canvas) {
        this.canvas.width = img.naturalWidth;
        this.canvas.height = img.naturalHeight;
        this.canvas.style.display = 'block';
      }
      const emptyZone = this.modalEl?.querySelector('#ad-empty-drop-zone') as HTMLElement;
      if (emptyZone) emptyZone.style.display = 'none';

      const sourceLabel = this.modalEl?.querySelector('#ad-current-source-label');
      if (sourceLabel) sourceLabel.textContent = sampleKey.toUpperCase();

      this.inspectionData = null;
      this.renderCanvas();
      const statusEl = this.modalEl?.querySelector('#ad-status-msg');
      if (statusEl) statusEl.textContent = `已载入内置范例: ${sampleKey.toUpperCase()}`;
    };
    img.src = `/image/agedepth?sample=${sampleKey}&t=${Date.now()}`;
  }

  private async executeExtraction(): Promise<void> {
    if (!this.modalEl || !this.bgImage) return;

    const depthTop = parseFloat((this.modalEl.querySelector('#ad-inp-depth-top') as HTMLInputElement).value) || 0;
    const depthBottom = parseFloat((this.modalEl.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value) || 150;
    const ageLeft = parseFloat((this.modalEl.querySelector('#ad-inp-age-left') as HTMLInputElement).value) || 3000;
    const ageRight = parseFloat((this.modalEl.querySelector('#ad-inp-age-right') as HTMLInputElement).value) || 0;

    const curveType = (this.modalEl.querySelector('#ad-sel-curve-type') as HTMLSelectElement).value;
    const envType = (this.modalEl.querySelector('#ad-sel-envelope-type') as HTMLSelectElement).value;
    const ageUnit = (this.modalEl.querySelector('#ad-inp-age-unit') as HTMLInputElement).value.trim() || 'cal BP';
    const calCurve = (this.modalEl.querySelector('#ad-inp-cal-curve') as HTMLInputElement).value.trim() || 'IntCal20';

    const w = this.bgImage.naturalWidth;
    const h = this.bgImage.naturalHeight;

    // 拟合坐标轴标定 (自动内缩避开外围坐标轴文字与刻度)
    const res = await this.rpcClient.call<any, any>('agedepth.extractAndInspect', {
      depth_px: [h * 0.04, h * 0.88],
      depth_vals: [depthTop, depthBottom],
      age_px: [w * 0.13, w * 0.94],
      age_vals: [ageLeft, ageRight],
      roi_box: [w * 0.11, h * 0.035, w * 0.96, h * 0.89],
      curve_type: curveType,
      envelope_type: envType,
      depth_unit: 'cm',
      age_unit: ageUnit,
      cal_curve: calCurve,
    });

    if (res && res.inspection) {
      this.inspectionData = res.inspection;
      this.renderCanvas();
      this.updateMappingTable();
      const statusEl = this.modalEl.querySelector('#ad-status-msg');
      if (statusEl) statusEl.textContent = '✅ 识别成功！已叠加高精度拟合线与置信带';
    }
  }

  private renderCanvas(): void {
    if (!this.ctx || !this.canvas || !this.bgImage) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. 绘制底层年代-深度模型原图
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.bgImage, 0, 0, w, h);

    if (!this.inspectionData || !this.inspectionData.px_points) return;

    const px = this.inspectionData.px_points;
    const n = px.y.length;
    if (n < 2) return;

    ctx.save();

    // 2. 绘制 95% 置信带琥珀色高亮半透明包络面 (Amber Envelope)
    if (this.showEnvelope && px.x_min && px.x_max) {
      ctx.beginPath();
      // 沿 min 边缘向下
      for (let i = 0; i < n; i++) {
        const x = px.x_min[i];
        const y = px.y[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // 沿 max 边缘向上封闭多边形
      for (let i = n - 1; i >= 0; i--) {
        const x = px.x_max[i];
        const y = px.y[i];
        ctx.lineTo(x, y);
      }
      ctx.closePath();

      ctx.fillStyle = `rgba(245, 158, 11, ${this.overlayOpacity * 0.45})`;
      ctx.fill();

      // 绘制包络线边缘
      ctx.strokeStyle = `rgba(245, 158, 11, ${this.overlayOpacity * 0.9})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. 绘制中央拟合代表线 (Centerline: Median / Mean) - 亮蓝微光发光曲线
    if (this.showCurve && px.x_curve) {
      // 外层微光发光
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = px.x_curve[i];
        const y = px.y[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(56, 189, 248, ${this.overlayOpacity * 0.4})`;
      ctx.lineWidth = 6;
      ctx.stroke();

      // 核心精细实线
      ctx.strokeStyle = `rgba(2, 132, 199, ${Math.min(1.0, this.overlayOpacity + 0.35)})`;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    // 4. 绘制当前花粉剖面层位映射交点 (Green Crossmarks)
    if (this.showPollenHorizons && this.pollenData.calibration) {
      const topVal = this.pollenData.calibration.depthTopValue;
      const bottomVal = this.pollenData.calibration.depthBottomValue;
      const interval = this.pollenData.calibration.depthInterval || 5;

      const sampleDepths = [];
      for (let d = topVal; d <= bottomVal; d += interval) {
        sampleDepths.push(d);
      }

      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1;

      sampleDepths.forEach((d) => {
        const dSpan = bottomVal - topVal;
        if (dSpan > 0 && px.y && px.x_curve) {
          const ratio = (d - topVal) / dSpan;
          const targetY = h * 0.04 + ratio * (h * 0.84);

          // Find closest y index on curve
          let closestYIdx = 0;
          let minDiff = 9999;
          for (let k = 0; k < px.y.length; k++) {
            const diff = Math.abs(px.y[k] - targetY);
            if (diff < minDiff) {
              minDiff = diff;
              closestYIdx = k;
            }
          }
          const targetX = px.x_curve[closestYIdx];

          if (minDiff < 30) {
            // Draw horizontal connector line
            ctx.beginPath();
            ctx.strokeStyle = "rgba(52, 211, 153, 0.35)";
            ctx.setLineDash([3, 3]);
            ctx.moveTo(w * 0.11, targetY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw glowing marker point on the actual curve
            ctx.beginPath();
            ctx.fillStyle = "#34d399";
            ctx.strokeStyle = "#059669";
            ctx.lineWidth = 1.5;
            ctx.arc(targetX, targetY, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      });
    }

    ctx.restore();
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.canvas || !this.inspectionData || !this.inspectionData.px_points) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleY = this.canvas.height / rect.height;

    const mouseY = (e.clientY - rect.top) * scaleY;

    const hud = this.modalEl?.querySelector('#ad-canvas-hud') as HTMLElement;
    if (!hud) return;

    // 寻找最近的 Y 点
    const px = this.inspectionData.px_points;
    let closestIdx = -1;
    let minDist = 9999;
    for (let i = 0; i < px.y.length; i++) {
      const dist = Math.abs(px.y[i] - mouseY);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx !== -1 && minDist < 30) {
      const d = this.inspectionData.depths[closestIdx];
      const a = this.inspectionData.ages[closestIdx];
      const aMin = this.inspectionData.age_min[closestIdx];
      const aMax = this.inspectionData.age_max[closestIdx];
      const meta = this.inspectionData.metadata;
      hud.innerHTML = `
        <span style="color: #38bdf8; font-weight: bold;">层位: ${d} ${meta.depth_unit}</span>
        &nbsp;&rarr;&nbsp;
        <span style="color: #34d399; font-weight: bold;">年代 (${meta.curve_type}): ${a} ${meta.age_unit}</span>
        &nbsp;<span style="color: #f59e0b;">[95% CI: ${aMin} - ${aMax}]</span>
      `;
    }
  }

  private updateMappingTable(): void {
    const tbody = this.modalEl?.querySelector('#ad-mapping-tbody');
    if (!tbody || !this.inspectionData) return;

    tbody.innerHTML = '';
    const n = Math.min(25, this.inspectionData.depths.length);
    const step = Math.max(1, Math.floor(this.inspectionData.depths.length / n));

    for (let i = 0; i < this.inspectionData.depths.length; i += step) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      tr.innerHTML = `
        <td style="padding: 2px 4px; color: #38bdf8;">${this.inspectionData.depths[i]}</td>
        <td style="padding: 2px 4px; color: #f1f5f9; font-weight: 600;">${this.inspectionData.ages[i]}</td>
        <td style="padding: 2px 4px; color: #f59e0b;">${this.inspectionData.age_min[i]}-${this.inspectionData.age_max[i]}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}
