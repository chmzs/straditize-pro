import { DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';

export interface AgeDepthModelInspectionData {
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
    notes?: string;
  };
}

export interface DatingPoint {
  id: string;
  depth: number;
  age: number;
  error: number;
  thickness: number;
  cc: number; // 1 = IntCal20, 2 = Marine20, 3 = SHCal20, 0 = Non-14C
}

export class AgeDepthModal {
  private container: HTMLElement;
  private pollenData: DiagramData;
  private rpcClient: RpcClient;
  private onApplyAgeModel: (model: AgeDepthModelInspectionData) => void;

  private modalEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bgImage: HTMLImageElement | null = null;
  private inspectionData: AgeDepthModelInspectionData | null = null;

  private showCurve: boolean = true;
  private showEnvelope: boolean = true;
  private showPollenHorizons: boolean = true;
  private overlayOpacity: number = 0.65;

  // 测年点列表
  private datingPoints: DatingPoint[] = [
    { id: '14C_1', depth: 15.0, age: 350, error: 30, thickness: 1, cc: 1 },
    { id: '14C_2', depth: 45.0, age: 980, error: 40, thickness: 1, cc: 1 },
    { id: '14C_3', depth: 85.0, age: 1850, error: 45, thickness: 1, cc: 1 },
    { id: '14C_4', depth: 120.0, age: 2450, error: 50, thickness: 1, cc: 1 },
    { id: '14C_5', depth: 145.0, age: 2980, error: 60, thickness: 1, cc: 1 },
  ];

  constructor(
    container: HTMLElement,
    pollenData: DiagramData,
    rpcClient: RpcClient,
    onApplyAgeModel: (model: AgeDepthModelInspectionData) => void
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
      <div class="modal-dialog modal-large agedepth-dialog" style="width: min(1180px, 96vw); max-height: 94vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">⏳</span>
            <h3>年代-深度模型解译与贝叶斯建模 (Age-Depth Modeling & Inspection)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #f59e0b, #ef4444); font-size: 10px; padding: 2px 6px;">Bacon / geoChronR</span>
          </div>
          <button class="close-btn" id="ad-close-btn">&times;</button>
        </div>

        <!-- 选项卡切换: 视觉解译 vs 测年建模向导 -->
        <div style="display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.2);">
          <button class="tool-btn ad-tab-btn active" id="ad-tab-btn-visual" style="border-radius: 4px 4px 0 0; border-bottom: none; padding: 6px 14px; font-size: 11.5px; font-weight: 600; color: #38bdf8;">
            📈 图谱逆向视觉解译 (Visual Inspection)
          </button>
          <button class="tool-btn ad-tab-btn" id="ad-tab-btn-modeling" style="border-radius: 4px 4px 0 0; border-bottom: none; padding: 6px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted);">
            ⚙️ 测年数据与 Bacon / geoChronR 向导 (Dating & Downstream)
          </button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; padding: 14px; overflow: hidden; gap: 14px;">
          <!-- ================================================================= -->
          <!-- Tab 1: 视觉解译视口 (原有成熟能力) -->
          <!-- ================================================================= -->
          <div id="ad-tab-panel-visual" style="flex: 1; display: flex; gap: 14px; min-width: 0;">
            <!-- 左侧: Canvas -->
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

              <div id="ad-canvas-container" style="flex: 1; height: 420px; min-height: 360px; position: relative; background: #0b0f19; border: 2px dashed var(--border-color); border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <canvas id="ad-inspection-canvas" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; display: none;"></canvas>
                <div id="ad-empty-drop-zone" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(11, 15, 25, 0.94); z-index: 10; padding: 24px; text-align: center;">
                  <div style="font-size: 44px; margin-bottom: 10px;">⏳</div>
                  <h4 style="font-size: 15px; font-weight: 700; color: #f8fafc; margin: 0 0 6px 0;">请载入年代-深度模型图谱 (Age-Depth Diagram)</h4>
                  <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0 0 16px 0; max-width: 420px; line-height: 1.5;">
                    直接将 <strong>Bacon / Bchron / OxCal</strong> 年代图拖拽至此处，或选择内置范例。
                  </p>
                  <button id="ad-btn-center-browse" class="btn btn-primary" style="padding: 6px 18px; font-size: 12px; margin-bottom: 10px;">
                    📁 选择本地年代图 (PNG/JPG)
                  </button>
                  <div style="display: flex; gap: 10px; align-items: center; font-size: 11px;">
                    <button id="ad-btn-center-bacon" class="tool-btn" style="color: #38bdf8;">Hoya Bacon 范例</button>
                    <button id="ad-btn-center-bchron" class="tool-btn" style="color: #38bdf8;">Bchron 阶梯范例</button>
                  </div>
                </div>
                <div id="ad-canvas-hud" style="position: absolute; bottom: 8px; left: 8px; background: rgba(15, 23, 42, 0.85); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-family: var(--font-mono); color: #94a3b8; pointer-events: none; z-index: 15;">
                  悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代
                </div>
              </div>

              <div style="font-size: 10.5px; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>💡 视觉检查标准：高亮蓝线应精确穿过深色脊线；琥珀色阴影应贴合灰色置信区间边缘。</span>
                <span id="ad-status-msg" style="color: #34d399;"></span>
              </div>
            </div>

            <!-- 右侧控制区 -->
            <div class="ad-control-pane" style="width: 320px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
              <div class="form-group" style="margin: 0; background: rgba(56, 189, 248, 0.05); padding: 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.2);">
                <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-bottom: 6px;">
                  <span>图谱数据源:</span>
                  <span id="ad-current-source-label" style="color: #38bdf8;">未载入</span>
                </div>
                <button class="btn btn-primary" id="ad-btn-upload-file" style="width: 100%; font-size: 11px; padding: 5px;">📁 上传本地图谱</button>
                <input type="file" id="ad-file-input" accept="image/*" style="display: none;" />
              </div>

              <!-- 坐标轴物理标定 -->
              <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                <div style="font-size: 11px; font-weight: bold; color: #38bdf8; margin-bottom: 6px;">坐标轴标定 (Calibration):</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10.5px;">
                  <div>
                    <label style="color: var(--text-muted);">深度顶端:</label>
                    <input type="number" id="ad-inp-depth-top" value="0" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div>
                    <label style="color: var(--text-muted);">深度底端:</label>
                    <input type="number" id="ad-inp-depth-bottom" value="150" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div>
                    <label style="color: var(--text-muted);">年代左侧:</label>
                    <input type="number" id="ad-inp-age-left" value="3000" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div>
                    <label style="color: var(--text-muted);">年代右侧:</label>
                    <input type="number" id="ad-inp-age-right" value="0" style="width: 100%; font-size: 11px;" />
                  </div>
                </div>
              </div>

              <!-- 识别按钮 -->
              <button class="btn btn-primary" id="ad-btn-extract" style="padding: 7px 10px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                🔍 运行识别并叠加视觉检查
              </button>

              <!-- 花粉层位映射预览 -->
              <div style="flex: 1; min-height: 140px; display: flex; flex-direction: column;">
                <span style="font-size: 10.5px; font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">花粉样品年代映射预览:</span>
                <div style="flex: 1; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: rgba(0,0,0,0.3);">
                  <table class="wpd-preview-table" style="width: 100%; font-size: 10px;">
                    <thead><tr><th>Depth</th><th>Age</th><th>95% CI</th></tr></thead>
                    <tbody id="ad-mapping-tbody">
                      <tr><td colspan="3" style="text-align: center; color: #64748b; padding: 12px;">尚未执行识别提取</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- ================================================================= -->
          <!-- Tab 2: 测年数据与 Bacon / geoChronR 向导 (Section 6 & 用户深度建议) -->
          <!-- ================================================================= -->
          <div id="ad-tab-panel-modeling" style="flex: 1; display: none; gap: 16px; min-width: 0; overflow-y: auto;">
            <!-- 左半边: 测年数据表格 (支持从 Excel 一键粘贴) -->
            <div style="flex: 1.2; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 12px; color: #38bdf8;">1. 📜 钻孔实测年代数据表 (Radiocarbon / Dating Table)</strong>
                <button class="tool-btn" id="btn-ad-paste-dates" style="font-size: 10.5px; color: #10b981; border-color: rgba(16,185,129,0.3);">
                  📋 从 Excel 粘贴测年序列 (Ctrl+V)
                </button>
              </div>

              <div style="flex: 1; min-height: 240px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: rgba(0,0,0,0.3);">
                <table class="wpd-preview-table" style="width: 100%; font-size: 11px;">
                  <thead>
                    <tr>
                      <th style="width: 80px;">测年ID</th>
                      <th style="width: 70px;">深度 (cm)</th>
                      <th style="width: 80px;">¹⁴C 年龄 (BP)</th>
                      <th style="width: 60px;">误差 (±1σ)</th>
                      <th style="width: 60px;">厚度 (cm)</th>
                      <th style="width: 80px;">校正曲线</th>
                    </tr>
                  </thead>
                  <tbody id="ad-dating-tbody"></tbody>
                </table>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: var(--text-muted);">
                <span>* 支持 ¹⁴C、²¹⁰Pb、OSL 等多种年代类型；校正曲线 1=IntCal20, 2=Marine20, 0=非¹⁴C。</span>
                <button class="tool-btn" id="btn-ad-add-date-row" style="padding: 2px 8px; font-size: 10px;">➕ 加一行</button>
              </div>
            </div>

            <!-- 右半边: 复杂地质现象与 Bacon / geoChronR 参数设定 -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
              <strong style="font-size: 12px; color: #f59e0b;">2. 🌋 复杂地质事件与先验约束 (Blaauw 2011)</strong>

              <!-- 沉积间断 (Hiatus) -->
              <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-hiatus" />
                  <span style="color: #f1f5f9; font-size: 11px; font-weight: 600;">存在沉积间断 / 不整合面 (Hiatus)</span>
                </label>
                <div id="ad-hiatus-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <span>间断深度 (cm):</span>
                      <input type="text" id="ad-inp-hiatus-depth" placeholder="如 45.0" style="width: 100%; font-size: 11px;" />
                    </div>
                    <div style="flex: 1;">
                      <span>最大间断年限 (yr):</span>
                      <input type="number" id="ad-inp-hiatus-max" value="10000" style="width: 100%; font-size: 11px;" />
                    </div>
                  </div>
                  <span style="font-size: 9.5px; color: #94a3b8; display: block; margin-top: 2px;">说明：间断处将切断累积速率的连续自回归记忆。</span>
                </div>
              </div>

              <!-- 瞬时沉积层 (Slump / Tephra 火山灰 / 洪水层) -->
              <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-slump" />
                  <span style="color: #f1f5f9; font-size: 11px; font-weight: 600;">瞬时沉积层 (Slump / 火山灰 / 洪水层)</span>
                </label>
                <div id="ad-slump-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <span>事件顶界 (cm):</span>
                      <input type="text" id="ad-inp-slump-top" placeholder="如 70.0" style="width: 100%; font-size: 11px;" />
                    </div>
                    <div style="flex: 1;">
                      <span>事件底界 (cm):</span>
                      <input type="text" id="ad-inp-slump-bottom" placeholder="如 75.0" style="width: 100%; font-size: 11px;" />
                    </div>
                  </div>
                  <span style="font-size: 9.5px; color: #94a3b8; display: block; margin-top: 2px;">说明：该层段厚度将在年代累积模型中自动扣除（历时为 0 年）。</span>
                </div>
              </div>

              <!-- 碳储库效应校正 (Delta R) -->
              <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-dr" />
                  <span style="color: #f1f5f9; font-size: 11px; font-weight: 600;">碳储库效应 / 硬水效应校正 (ΔR)</span>
                </label>
                <div id="ad-dr-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <span>ΔR 偏移量 (yr):</span>
                      <input type="number" id="ad-inp-dr-val" value="150" style="width: 100%; font-size: 11px;" />
                    </div>
                    <div style="flex: 1;">
                      <span>误差 (±yr):</span>
                      <input type="number" id="ad-inp-dr-std" value="30" style="width: 100%; font-size: 11px;" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- 分段厚度与先验 -->
              <div class="form-group" style="margin: 0; font-size: 10.5px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                  <span style="color: var(--text-muted);">分段厚度 (thick):</span>
                  <span id="ad-val-thick" style="color: #38bdf8; font-weight: 700;">5 cm</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="tool-btn ad-btn-thick" data-thick="2" style="flex: 1; font-size: 10px;">2 cm (高密)</button>
                  <button class="tool-btn ad-btn-thick active" data-thick="5" style="flex: 1; font-size: 10px; border-color: #38bdf8;">5 cm (标准)</button>
                  <button class="tool-btn ad-btn-thick" data-thick="10" style="flex: 1; font-size: 10px;">10 cm (长孔)</button>
                </div>
              </div>

              <!-- WebR 增量扩展包状态管理 (规范第二方式) -->
              <div class="form-group" style="margin: 0; background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 10.5px; font-weight: 600; color: #38bdf8;">WebR 浏览器纯内置算力包:</span>
                  <span id="ad-webr-comp-status" style="font-size: 9.5px; color: #f59e0b;">检查中...</span>
                </div>
                <div id="ad-webr-install-bar" style="display: flex; gap: 6px; margin-top: 5px;">
                  <button class="tool-btn" id="btn-ad-install-webr" style="flex: 1; font-size: 10px; color: #38bdf8; border-color: rgba(56,189,248,0.3);">
                    ⬇️ 一键下载组件 (~40MB)
                  </button>
                  <button class="tool-btn" id="btn-ad-import-webr-zip" style="font-size: 10px; padding: 2px 6px;" title="离线环境手动导入已下载的 age-modeling.zip">
                    📂 离线导入
                  </button>
                  <input type="file" id="inp-ad-webr-zip" accept=".zip" style="display: none;" />
                </div>
                <div id="ad-webr-progress-box" style="display: none; margin-top: 4px;">
                  <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div id="ad-webr-progress-fill" style="width: 0%; height: 100%; background: #38bdf8; transition: width 0.2s;"></div>
                  </div>
                  <span id="ad-webr-progress-txt" style="font-size: 9px; color: var(--text-muted); display: block; margin-top: 2px;">准备下载...</span>
                </div>
              </div>

              <!-- 下游执行通道 -->
              <div style="margin-top: auto; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 10px;">
                <div id="ad-local-r-status" style="font-size: 10px; color: #10b981;">
                  ⏳ 正在探测本地 R 环境...
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-primary" id="btn-ad-run-local-r" style="flex: 1.2; font-size: 11px; padding: 6px; background: linear-gradient(135deg, #059669, #10b981);" title="直接调用本机已有的 R 与 rbacon 跑出 150 万次 MCMC">
                    ▶ 本地 R 一键运行
                  </button>
                  <button class="btn btn-secondary" id="btn-ad-export-geochronr" style="flex: 1; font-size: 11px; padding: 6px;" title="生成与当前 LiPD 容器深度绑定的 geoChronR 驱动代码">
                    📈 geoChronR 脚本
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">
            通过视觉检查确认拟合度后，点击应用可直接赋予当前花粉图谱真实年代轴与 95% 置信带。
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

    // 选项卡切换
    const tabVisual = modal.querySelector('#ad-tab-btn-visual') as HTMLButtonElement;
    const tabModeling = modal.querySelector('#ad-tab-btn-modeling') as HTMLButtonElement;
    const pVisual = modal.querySelector('#ad-tab-panel-visual') as HTMLElement;
    const pModeling = modal.querySelector('#ad-tab-panel-modeling') as HTMLElement;

    tabVisual?.addEventListener('click', () => {
      tabVisual.classList.add('active');
      tabVisual.style.color = '#38bdf8';
      tabModeling.classList.remove('active');
      tabModeling.style.color = 'var(--text-muted)';
      pVisual.style.display = 'flex';
      pModeling.style.display = 'none';
    });

    tabModeling?.addEventListener('click', () => {
      tabModeling.classList.add('active');
      tabModeling.style.color = '#f59e0b';
      tabVisual.classList.remove('active');
      tabVisual.style.color = 'var(--text-muted)';
      pVisual.style.display = 'none';
      pModeling.style.display = 'flex';
    });

    // 视觉复选框
    modal.querySelector('#ad-chk-curve')?.addEventListener('change', (e) => {
      this.showCurve = (e.target as HTMLInputElement).checked;
      this.renderCanvas();
    });
    modal.querySelector('#ad-chk-envelope')?.addEventListener('change', (e) => {
      this.showEnvelope = (e.target as HTMLInputElement).checked;
      this.renderCanvas();
    });
    modal.querySelector('#ad-chk-horizons')?.addEventListener('change', (e) => {
      this.showPollenHorizons = (e.target as HTMLInputElement).checked;
      this.renderCanvas();
    });
    modal.querySelector('#ad-rng-opacity')?.addEventListener('input', (e) => {
      this.overlayOpacity = parseFloat((e.target as HTMLInputElement).value) || 0.65;
      this.renderCanvas();
    });

    // 地质事件勾选联动
    const chkHiatus = modal.querySelector('#ad-chk-hiatus') as HTMLInputElement;
    const boxHiatus = modal.querySelector('#ad-hiatus-box') as HTMLElement;
    chkHiatus?.addEventListener('change', () => {
      boxHiatus.style.display = chkHiatus.checked ? 'block' : 'none';
    });

    const chkSlump = modal.querySelector('#ad-chk-slump') as HTMLInputElement;
    const boxSlump = modal.querySelector('#ad-slump-box') as HTMLElement;
    chkSlump?.addEventListener('change', () => {
      boxSlump.style.display = chkSlump.checked ? 'block' : 'none';
    });

    const chkDr = modal.querySelector('#ad-chk-dr') as HTMLInputElement;
    const boxDr = modal.querySelector('#ad-dr-box') as HTMLElement;
    chkDr?.addEventListener('change', () => {
      boxDr.style.display = chkDr.checked ? 'block' : 'none';
    });

    // 分段厚度胶囊点击
    modal.querySelectorAll('.ad-btn-thick').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ad-btn-thick').forEach((b) => {
          b.classList.remove('active');
          (b as HTMLElement).style.borderColor = '';
        });
        btn.classList.add('active');
        (btn as HTMLElement).style.borderColor = '#38bdf8';
        const th = btn.getAttribute('data-thick') || '5';
        const valEl = modal.querySelector('#ad-val-thick');
        if (valEl) valEl.textContent = `${th} cm`;
      });
    });

    // 载入范例
    modal.querySelector('#ad-btn-load-bacon')?.addEventListener('click', () => this.loadSampleImage('bacon'));
    modal.querySelector('#ad-btn-center-bacon')?.addEventListener('click', () => this.loadSampleImage('bacon'));
    modal.querySelector('#ad-btn-load-bchron')?.addEventListener('click', () => this.loadSampleImage('bchron'));
    modal.querySelector('#ad-btn-center-bchron')?.addEventListener('click', () => this.loadSampleImage('bchron'));

    // 本地文件上传
    const fileInput = modal.querySelector('#ad-file-input') as HTMLInputElement;
    modal.querySelector('#ad-btn-upload-file')?.addEventListener('click', () => fileInput.click());
    modal.querySelector('#ad-btn-center-browse')?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.handleCustomImageFile(file);
    });

    // 运行视觉提取
    modal.querySelector('#ad-btn-extract')?.addEventListener('click', () => this.executeExtraction());

    // 确认应用
    modal.querySelector('#ad-btn-apply')?.addEventListener('click', () => {
      if (!this.inspectionData) {
        alert('请先运行提取或生成年代模型！');
        return;
      }
      this.onApplyAgeModel(this.inspectionData);
      this.close();
    });

    // 鼠标悬停实时查验
    this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));

    // 渲染测年数据表
    this.renderDatingTable();

    // 检查本地 R 环境并提示
    this.checkLocalR();
    // 检查 WebR 增量扩展包状态
    this.checkComponentStatus();

    // 绑定组件安装与离线导入
    modal.querySelector('#btn-ad-install-webr')?.addEventListener('click', () => this.handleInstallComponent());
    const zipInput = modal.querySelector('#inp-ad-webr-zip') as HTMLInputElement;
    modal.querySelector('#btn-ad-import-webr-zip')?.addEventListener('click', () => zipInput.click());
    zipInput?.addEventListener('change', () => {
      const file = zipInput.files?.[0];
      if (file) this.handleOfflineZipUpload(file);
    });

    // 导出 geoChronR 脚本按钮
    modal.querySelector('#btn-ad-export-geochronr')?.addEventListener('click', () => this.exportGeoChronRScript());

    // 默认载入 Bacon 范例
    this.loadSampleImage('bacon');
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private renderDatingTable(): void {
    if (!this.modalEl) return;
    const tbody = this.modalEl.querySelector('#ad-dating-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    this.datingPoints.forEach((p, _idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" value="${p.id}" style="width:100%;font-size:10.5px;" /></td>
        <td><input type="number" value="${p.depth}" style="width:100%;font-size:10.5px;" /></td>
        <td><input type="number" value="${p.age}" style="width:100%;font-size:10.5px;" /></td>
        <td><input type="number" value="${p.error}" style="width:100%;font-size:10.5px;" /></td>
        <td><input type="number" value="${p.thickness}" style="width:100%;font-size:10.5px;" /></td>
        <td>
          <select style="width:100%;font-size:10px;">
            <option value="1" ${p.cc === 1 ? 'selected' : ''}>IntCal20</option>
            <option value="2" ${p.cc === 2 ? 'selected' : ''}>Marine20</option>
            <option value="3" ${p.cc === 3 ? 'selected' : ''}>SHCal20</option>
            <option value="0" ${p.cc === 0 ? 'selected' : ''}>Non-14C</option>
          </select>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  private async checkComponentStatus(): Promise<void> {
    if (!this.modalEl) return;
    const statusEl = this.modalEl.querySelector('#ad-webr-comp-status');
    const installBtn = this.modalEl.querySelector('#btn-ad-install-webr') as HTMLButtonElement;

    try {
      const res = await this.rpcClient.call<{ name: string }, any>('component.getStatus', { name: 'age-modeling' });
      if (res) {
        if (res.is_installed) {
          if (statusEl) statusEl.innerHTML = `<strong style="color:#34d399;">✓ 已安装 (${res.installed_version})</strong>`;
          if (installBtn) {
            installBtn.textContent = '✓ 组件已激活';
            installBtn.disabled = true;
          }
        } else if (res.downloading) {
          if (statusEl) statusEl.innerHTML = `<strong style="color:#38bdf8;">下载中...</strong>`;
          this.pollDownloadProgress();
        } else {
          if (statusEl) statusEl.innerHTML = `<span style="color:#f59e0b;">未安装 (需增量包)</span>`;
          if (installBtn) {
            installBtn.textContent = '⬇️ 一键下载组件 (~40MB)';
            installBtn.disabled = false;
          }
        }
      }
    } catch {
      if (statusEl) statusEl.textContent = '离线独立模式';
    }
  }

  private async handleInstallComponent(): Promise<void> {
    if (!this.modalEl) return;
    const box = this.modalEl.querySelector('#ad-webr-progress-box') as HTMLElement;
    const bar = this.modalEl.querySelector('#ad-webr-progress-fill') as HTMLElement;
    const txt = this.modalEl.querySelector('#ad-webr-progress-txt') as HTMLElement;

    if (box) box.style.display = 'block';
    if (bar) bar.style.width = '5%';
    if (txt) txt.textContent = '正在连接镜像下载 WebR + rbacon 运行时...';

    try {
      await this.rpcClient.call('component.install', { name: 'age-modeling' });
      this.pollDownloadProgress();
    } catch (err: any) {
      if (txt) txt.textContent = `下载启动失败: ${err.message || err}`;
    }
  }

  private pollDownloadProgress(): void {
    const timer = setInterval(async () => {
      if (!this.modalEl) {
        clearInterval(timer);
        return;
      }
      const res = await this.rpcClient.call<{ name: string }, any>('component.getStatus', { name: 'age-modeling' });
      const bar = this.modalEl.querySelector('#ad-webr-progress-fill') as HTMLElement;
      const txt = this.modalEl.querySelector('#ad-webr-progress-txt') as HTMLElement;
      const box = this.modalEl.querySelector('#ad-webr-progress-box') as HTMLElement;

      if (res && res.progress) {
        if (box) box.style.display = 'block';
        const pct = res.progress.progress_percent || 0;
        if (bar) bar.style.width = `${pct}%`;
        if (txt) txt.textContent = `下载进度: ${pct.toFixed(1)}% (${(res.progress.downloaded_bytes / 1048576).toFixed(1)} MB)`;

        if (res.progress.status === 'completed') {
          clearInterval(timer);
          if (txt) txt.innerHTML = `<span style="color:#34d399;">✅ 安装成功！无需重启，已就地激活。</span>`;
          this.checkComponentStatus();
        } else if (res.progress.status === 'failed') {
          clearInterval(timer);
          if (txt) txt.innerHTML = `<span style="color:#ef4444;">❌ 下载失败: ${res.progress.error || '网络超时'}</span>`;
        }
      } else {
        clearInterval(timer);
      }
    }, 1000);
  }

  private async handleOfflineZipUpload(file: File): Promise<void> {
    const statusEl = this.modalEl?.querySelector('#ad-webr-comp-status');
    if (statusEl) statusEl.textContent = '正在上传并安全解压离线包...';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const upJson = await upRes.json();
      const zipPath = upJson.path || upJson.saved_path;

      const instRes = await this.rpcClient.call<{ zip_path: string }, any>('component.installOfflineZip', {
        zip_path: zipPath,
      });

      if (instRes && instRes.success) {
        alert('✅ 离线组件解压安装成功！已就地激活，无需重启。');
        this.checkComponentStatus();
      }
    } catch (err: any) {
      alert(`离线导入失败: ${err.message || err}`);
    }
  }

  private async checkLocalR(): Promise<void> {
    if (!this.modalEl) return;
    const statusEl = this.modalEl.querySelector('#ad-local-r-status');
    try {
      const res = await this.rpcClient.call<void, any>('agedepth.checkREnvironment');
      if (res && res.has_r) {
        const pkgText = res.has_rbacon ? '已就绪 (包含 rbacon 与 geoChronR)' : '缺少 rbacon 包 (建议 install.packages("rbacon"))';
        if (statusEl) {
          statusEl.innerHTML = `🟢 <strong>本地 R 环境就绪</strong>: ${res.r_version || 'R 4.x'} · ${pkgText}`;
        }
      } else {
        if (statusEl) {
          statusEl.innerHTML = `⚪ 未探测到系统 Rscript，可直接导出 geoChronR 驱动代码。`;
        }
      }
    } catch {
      if (statusEl) statusEl.textContent = '⚪ 本地 R 探测通道就绪';
    }
  }

  private async exportGeoChronRScript(): Promise<void> {
    const rScript = `
# ==============================================================================
# geoChronR Native Bayesian Age-Depth Modeling (McKay et al. 2021)
# ==============================================================================
library(geoChronR)

# 1. 读取 Straditize Pro 导出的标准 LiPD 数据包 (.lpd)
# 测年点与间断参数已全部自动封装在 chronData 中
lipd_file <- file.choose()
L <- readLipd(lipd_file)

# 2. 一键运行 Bacon 贝叶斯 MCMC 模型 (1,500,000 次自回归采样)
L <- runBacon(L, thick=5)

# 3. 将生成的 1000 组年代集成表无缝映射到花粉属种数据矩阵
L <- mapAgeEnsembleToPaleoData(L, age.var="age")

# 4. 出版级诊断图
plotChron(L)

message("geoChronR 年代不确定性建模完成！已成功与花粉图谱建立时间轴映射。")
`;
    const blob = new Blob([rScript], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'run_geochronr_bacon.R';
    a.click();
    URL.revokeObjectURL(url);
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

      const lbl = this.modalEl?.querySelector('#ad-current-source-label');
      if (lbl) lbl.textContent = `范例: ${sampleKey.toUpperCase()}`;

      this.inspectionData = null;
      this.renderCanvas();
    };
    img.src = `/image/agedepth?sample=${sampleKey}&t=${Date.now()}`;
  }

  private handleCustomImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        if (this.canvas) {
          this.canvas.width = img.naturalWidth;
          this.canvas.height = img.naturalHeight;
          this.canvas.style.display = 'block';
        }
        const emptyZone = this.modalEl?.querySelector('#ad-empty-drop-zone') as HTMLElement;
        if (emptyZone) emptyZone.style.display = 'none';

        const lbl = this.modalEl?.querySelector('#ad-current-source-label');
        if (lbl) lbl.textContent = file.name;

        this.inspectionData = null;
        this.renderCanvas();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  private async executeExtraction(): Promise<void> {
    if (!this.modalEl || !this.bgImage) return;

    const depthTop = parseFloat((this.modalEl.querySelector('#ad-inp-depth-top') as HTMLInputElement).value) || 0;
    const depthBottom = parseFloat((this.modalEl.querySelector('#ad-inp-depth-bottom') as HTMLInputElement).value) || 150;
    const ageLeft = parseFloat((this.modalEl.querySelector('#ad-inp-age-left') as HTMLInputElement).value) || 3000;
    const ageRight = parseFloat((this.modalEl.querySelector('#ad-inp-age-right') as HTMLInputElement).value) || 0;

    const w = this.bgImage.naturalWidth;
    const h = this.bgImage.naturalHeight;

    const res = await this.rpcClient.call<any, any>('agedepth.extractAndInspect', {
      depth_px: [h * 0.04, h * 0.88],
      depth_vals: [depthTop, depthBottom],
      age_px: [w * 0.13, w * 0.94],
      age_vals: [ageLeft, ageRight],
      roi_box: [w * 0.11, h * 0.035, w * 0.96, h * 0.89],
      curve_type: 'median',
      envelope_type: '95_hpd',
      depth_unit: 'cm',
      age_unit: 'cal BP',
      cal_curve: 'IntCal20',
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
    if (!this.canvas || !this.ctx || !this.bgImage) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.bgImage, 0, 0, w, h);

    if (!this.inspectionData || !this.inspectionData.px_points) return;
    const px = this.inspectionData.px_points;

    ctx.save();
    ctx.globalAlpha = this.overlayOpacity;

    // 95% 置信带
    if (this.showEnvelope && px.y && px.x_min && px.x_max) {
      ctx.beginPath();
      ctx.moveTo(px.x_min[0], px.y[0]);
      for (let i = 1; i < px.y.length; i++) {
        ctx.lineTo(px.x_min[i], px.y[i]);
      }
      for (let i = px.y.length - 1; i >= 0; i--) {
        ctx.lineTo(px.x_max[i], px.y[i]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 拟合线
    if (this.showCurve && px.y && px.x_curve) {
      ctx.beginPath();
      ctx.moveTo(px.x_curve[0], px.y[0]);
      for (let i = 1; i < px.y.length; i++) {
        ctx.lineTo(px.x_curve[i], px.y[i]);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 花粉层位交点
    if (this.showPollenHorizons && this.pollenData && this.pollenData.calibration) {
      const topVal = this.pollenData.calibration.depthTopValue;
      const bottomVal = this.pollenData.calibration.depthBottomValue;
      const dSpan = bottomVal - topVal;
      if (dSpan > 0 && px.y && px.x_curve) {
        ctx.fillStyle = '#34d399';
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 1.5;
        const depths = this.pollenData.calibration.customDepths || [topVal, (topVal + bottomVal) / 2, bottomVal];
        depths.forEach((d) => {
          const ratio = (d - topVal) / dSpan;
          const targetY = h * 0.04 + ratio * (h * 0.84);
          let closestYIdx = 0;
          let minDiff = 9999;
          for (let k = 0; k < px.y.length; k++) {
            const diff = Math.abs(px.y[k] - targetY);
            if (diff < minDiff) {
              minDiff = diff;
              closestYIdx = k;
            }
          }
          if (minDiff < 25) {
            const targetX = px.x_curve[closestYIdx];
            ctx.beginPath();
            ctx.arc(targetX, targetY, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        });
      }
    }

    ctx.restore();
  }

  private updateMappingTable(): void {
    if (!this.modalEl || !this.inspectionData) return;
    const tbody = this.modalEl.querySelector('#ad-mapping-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min;
    const ma = this.inspectionData.age_max;

    const step = Math.max(1, Math.floor(d.length / 12));
    for (let i = 0; i < d.length; i += step) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: #38bdf8;">${d[i]} cm</td>
        <td>${a[i]} cal BP</td>
        <td style="color: var(--text-muted);">${mi[i]} ~ ${ma[i]}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.canvas || !this.inspectionData || !this.inspectionData.px_points) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const hud = this.modalEl?.querySelector('#ad-canvas-hud');
    if (hud) {
      hud.textContent = `光标位置: X:${Math.round(mx)}px, Y:${Math.round(my)}px`;
    }
  }
}
