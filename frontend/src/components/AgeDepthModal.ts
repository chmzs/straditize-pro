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

/** The four calibration handles, clicked in this order. */
export type CalibKind = 'ageA' | 'ageB' | 'depthA' | 'depthB';

export interface CalibMarker {
  kind: CalibKind;
  /** Position in image pixel coordinates (not CSS pixels). */
  x: number;
  y: number;
}

const CALIB_ORDER: CalibKind[] = ['ageA', 'ageB', 'depthA', 'depthB'];

const CALIB_META: Record<CalibKind, { label: string; ordinal: string; color: string }> = {
  ageA: { label: '年龄轴端点 1', ordinal: '①', color: '#38bdf8' },
  ageB: { label: '年龄轴端点 2', ordinal: '②', color: '#38bdf8' },
  depthA: { label: '深度轴端点 1', ordinal: '③', color: '#34d399' },
  depthB: { label: '深度轴端点 2', ordinal: '④', color: '#34d399' },
};

const EXCLUDE_BOX_COLOR = 'rgba(239, 68, 68, 0.75)';
const MARKER_HIT_RADIUS = 10;

export class AgeDepthModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private onApplyAgeModel: (model: AgeDepthModelInspectionData) => void;

  private modalEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bgImage: HTMLImageElement | null = null;
  private inspectionData: AgeDepthModelInspectionData | null = null;
  private mappedSamples: {
    depths: number[];
    age_est: number[];
    age_min: number[];
    age_max: number[];
    px_y?: number[];
    px_x_curve?: number[];
    rate?: {
      acc_rate_yr_per_depth: (number | null)[];
      acc_rate_yr_per_depth_min: (number | null)[];
      acc_rate_yr_per_depth_max: (number | null)[];
      sed_rate_depth_per_yr: (number | null)[];
      units?: { acc_rate: string; sed_rate: string };
    };
  } | null = null;

  private showCurve: boolean = true;
  private showEnvelope: boolean = true;
  private showPollenHorizons: boolean = true;
  private overlayOpacity: number = 0.65;

  // 四点标定交互状态
  private calibMarkers: CalibMarker[] = [];
  private calibPicking: boolean = false;
  private draggingMarker: number | null = null;

  // 矩形排除区（橡皮擦）
  private excludeBoxes: number[][] = [];
  private excludeArmed: boolean = false;
  private excludeDragStart: { x: number; y: number } | null = null;
  private excludePreview: number[] | null = null;

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
    // Retained in the signature for callers, but no longer stored: the pollen-horizon
    // overlay positions now come from the backend calibrator (``mapped_samples.px_y`` /
    // ``px_x_curve``), so this class never has to re-derive a pixel transform. Keeping
    // an unused copy would also tempt a caller into thinking it is still the source of
    // truth for the overlay.
    void pollenData;
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
        <div class="ad-tab-strip" style="display: flex; gap: 4px; padding: 0 16px;">
          <button class="tool-btn ad-tab-btn active" id="ad-tab-btn-visual" style="border-radius: 4px 4px 0 0; border-bottom: none; padding: 6px 14px; font-size: 11.5px; font-weight: 600; color: var(--accent-blue);">
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
          <div id="ad-tab-panel-visual" style="flex: 1; display: flex; gap: 14px; min-width: 0; min-height: 0; overflow: hidden;">
            <!-- 左侧: Canvas -->
            <div class="ad-viewport-pane" style="flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
                <div style="display: flex; gap: 12px; align-items: center;">
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-curve" checked />
                    <span style="color: var(--accent-blue); font-weight: 600;">拟合代表线</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-envelope" checked />
                    <span style="color: var(--accent-amber); font-weight: 600;">95% 置信带</span>
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

              <div id="ad-canvas-container" style="flex: 1; min-height: 240px; position: relative; background: var(--bg-tertiary); border: 2px dashed var(--border-color); border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <canvas id="ad-inspection-canvas" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; display: none;"></canvas>
                <div id="ad-empty-drop-zone" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); z-index: 10; padding: 24px; text-align: center;">
                  <div style="font-size: 44px; margin-bottom: 10px;">⏳</div>
                  <h4 style="font-size: 15px; font-weight: 700; color: var(--text-heading); margin: 0 0 6px 0;">请载入年代-深度模型图谱 (Age-Depth Diagram)</h4>
                  <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0 0 16px 0; max-width: 420px; line-height: 1.5;">
                    直接将 <strong>Bacon / Bchron / OxCal</strong> 年代图拖拽至此处，或选择内置范例。
                  </p>
                  <button id="ad-btn-center-browse" class="btn btn-primary" style="padding: 6px 18px; font-size: 12px; margin-bottom: 10px;">
                    📁 选择本地年代图 (PNG/JPG)
                  </button>
                  <div style="display: flex; gap: 10px; align-items: center; font-size: 11px;">
                    <button id="ad-btn-center-bacon" class="tool-btn" style="color: var(--accent-blue);">Hoya Bacon 范例</button>
                    <button id="ad-btn-center-bchron" class="tool-btn" style="color: var(--accent-blue);">Bchron 阶梯范例</button>
                  </div>
                </div>
                <div id="ad-canvas-hud" style="position: absolute; bottom: 8px; left: 8px; background: var(--bg-hud); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-family: var(--font-mono); color: var(--text-secondary); pointer-events: none; z-index: 15;">
                  悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代
                </div>
              </div>

              <div style="font-size: 10.5px; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>💡 视觉检查标准：高亮蓝线应精确穿过深色脊线；琥珀色阴影应贴合灰色置信区间边缘。</span>
                <span id="ad-status-msg" style="color: #34d399;"></span>
              </div>
            </div>

            <!-- 右侧控制区 -->
            <div class="ad-control-pane" style="width: 330px; flex-shrink: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
              <div class="form-group" style="margin: 0; background: rgba(56, 189, 248, 0.05); padding: 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.2);">
                <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-bottom: 6px;">
                  <span>图谱数据源:</span>
                  <span id="ad-current-source-label" style="color: var(--accent-blue);">未载入</span>
                </div>
                <button class="btn btn-primary" id="ad-btn-upload-file" style="width: 100%; font-size: 11px; padding: 5px;">📁 上传本地图谱</button>
                <input type="file" id="ad-file-input" accept="image/*" style="display: none;" />
              </div>

              <!-- ============ 步骤 1：四点标定 ============ -->
              <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 11px; font-weight: bold; color: var(--accent-blue);">① 四点标定 (Calibration)</span>
                  <button class="tool-btn" id="ad-btn-calib-reset" style="font-size: 9.5px; padding: 1px 6px;">重置</button>
                </div>

                <button class="btn btn-primary" id="ad-btn-calib-start" style="width: 100%; font-size: 11px; padding: 5px; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                  🎯 在图上点击 4 个标定点
                </button>

                <ol id="ad-calib-checklist" style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10px; line-height: 1.7; color: var(--text-muted);">
                  <li data-kind="ageA">年龄轴端点 1（左/旧端刻度）</li>
                  <li data-kind="ageB">年龄轴端点 2（右/新端刻度）</li>
                  <li data-kind="depthA">深度轴端点 1（顶端刻度）</li>
                  <li data-kind="depthB">深度轴端点 2（底端刻度）</li>
                </ol>

                <div id="ad-calib-hint" style="margin-top: 6px; font-size: 10px; color: var(--accent-amber); line-height: 1.5;"></div>

                <!-- 四点落位后一次性批量输入数值 -->
                <div id="ad-calib-values" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                  <div style="font-size: 10.5px; font-weight: 600; color: var(--text-primary); margin-bottom: 5px;">批量输入标定值:</div>
                  <div style="display: grid; grid-template-columns: auto 1fr; gap: 5px 6px; font-size: 10.5px; align-items: center;">
                    <label style="color: var(--accent-blue);">① 年龄 1</label>
                    <input type="number" id="ad-inp-age-left" value="3000" style="width: 100%; font-size: 11px;" />
                    <label style="color: var(--accent-blue);">② 年龄 2</label>
                    <input type="number" id="ad-inp-age-right" value="0" style="width: 100%; font-size: 11px;" />
                    <label style="color: var(--accent-green);">③ 深度 1</label>
                    <input type="number" id="ad-inp-depth-top" value="0" style="width: 100%; font-size: 11px;" />
                    <label style="color: var(--accent-green);">④ 深度 2</label>
                    <input type="number" id="ad-inp-depth-bottom" value="150" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div style="display: flex; gap: 12px; margin-top: 7px; font-size: 10px;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                      <input type="checkbox" id="ad-chk-age-log" />
                      <span>年龄轴 log 变换</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                      <input type="checkbox" id="ad-chk-depth-log" />
                      <span>深度轴 log 变换</span>
                    </label>
                  </div>
                  <div id="ad-calib-readout" style="margin-top: 6px; font-size: 9.5px; color: var(--text-muted); font-family: var(--font-mono); line-height: 1.5;"></div>
                </div>
              </div>

              <!-- ============ 步骤 1b：单位约定（固定） ============ -->
              <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border-left: 3px solid var(--accent-amber); background: rgba(245,158,11,0.07);">
                <div style="font-size: 10.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 3px;">
                  ①b 单位固定为 <code>cm</code> 与 <code>cal BP</code>
                </div>
                <div style="font-size: 9.5px; color: var(--text-secondary); line-height: 1.55;">
                  本工具只认这两个单位，不做任何单位换算。<br>
                  原图若用 <b>ka</b>（如 0–12 ka），请自己乘 1000 后填入标定值（0 / 12000）；<br>
                  原图若用 <b>AD/CE</b>，请自己换成 BP（<code>BP = 1950 − AD</code>），否则年代方向相反。<br>
                  <b>未校正 ¹⁴C BP</b> 不是时间轴，需先过校正曲线，本工具不做校正。
                </div>
              </div>

              <!-- ============ 步骤 2：提取深度范围 ============ -->
              <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <div style="font-size: 11px; font-weight: bold; color: var(--accent-green); margin-bottom: 6px;">② 提取深度范围 (Extraction Range)</div>
                <div style="display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 5px; font-size: 10.5px; align-items: center;">
                  <label style="color: var(--text-muted);">最小</label>
                  <input type="number" id="ad-inp-range-min" value="0" style="width: 100%; font-size: 11px;" />
                  <label style="color: var(--text-muted);">最大</label>
                  <input type="number" id="ad-inp-range-max" value="450" style="width: 100%; font-size: 11px;" />
                </div>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 5px; font-size: 10.5px; align-items: center; margin-top: 6px;">
                  <label style="color: var(--text-muted);">重采样步长</label>
                  <input type="number" id="ad-inp-resample" value="2" min="0" step="0.5" style="width: 100%; font-size: 11px;" />
                </div>
                <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;">
                  范围可窄于标定区间：标定打在坐标轴末端，只提取实际分析段。步长留 0 则保留逐行原始采样。
                </div>
              </div>

              <!-- ============ 步骤 3：识别与校对 ============ -->
              <button class="btn btn-primary" id="ad-btn-extract" style="padding: 7px 10px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                🔍 ③ 运行识别并叠加视觉校对
              </button>

              <div id="ad-extract-error" style="display: none; font-size: 10px; color: var(--accent-red, #ef4444); line-height: 1.5; padding: 6px 8px; border-radius: 4px; background: rgba(239, 68, 68, 0.08);"></div>

              <!-- 排除笔刷（矩形橡皮擦） -->
              <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 10.5px; font-weight: 600;">🧽 排除干扰区 (橡皮擦)</span>
                  <span id="ad-exclude-count" style="font-size: 9.5px; color: var(--text-muted);">0 个</span>
                </div>
                <div style="display: flex; gap: 6px; margin-top: 5px;">
                  <button class="tool-btn" id="ad-btn-exclude-add" style="flex: 1; font-size: 10px;">＋ 拖框添加</button>
                  <button class="tool-btn" id="ad-btn-exclude-clear" style="font-size: 10px;">清空</button>
                </div>
                <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;">
                  用于遮住图例、文字批注或测年点概率分布图；被遮区域不参与曲线识别。
                </div>
              </div>

              <!-- 花粉层位映射预览 -->
              <div style="flex: 1; min-height: 130px; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                  <span style="font-size: 10.5px; font-weight: bold; color: var(--text-primary);">花粉样品年代与沉积速率预览:</span>
                  <span id="ad-rate-units" style="font-size: 9px; color: var(--text-muted); font-family: var(--font-mono);"></span>
                </div>
                <div style="flex: 1; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: var(--bg-card);">
                  <table class="wpd-preview-table" style="width: 100%; font-size: 10px;">
                    <thead><tr><th>Depth</th><th>Age</th><th>95% CI</th><th title="d(age)/d(depth)，由 1000 条集合成员求导得到的 95% 区间">Acc. rate</th></tr></thead>
                    <tbody id="ad-mapping-tbody">
                      <tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">尚未执行识别提取</td></tr>
                    </tbody>
                  </table>
                </div>
                <div style="font-size: 9px; color: var(--text-muted); margin-top: 3px; line-height: 1.45;">
                  速率来自集合成员的导数（不是中位曲线的点估计），因此带 95% 区间。
                </div>

                <!-- 速率口径：由用户勾选，工具只提供能从图中导出的量 -->
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                  <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px;">导出哪些速率列:</div>
                  <label style="display: flex; align-items: center; gap: 4px; font-size: 10px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-rate-sr" checked />
                    <span>线性/体积累积速率 <code>cm yr⁻¹</code></span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; font-size: 10px; cursor: pointer; margin-top: 2px;">
                    <input type="checkbox" id="ad-chk-rate-ar" checked />
                    <span>时间-深度累积速率 <code>yr cm⁻¹</code></span>
                  </label>
                  <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;">
                    <b>质量累积速率 MAR 不在列内</b>：<code>MAR = 体积累积速率 × 干容重</code>，
                    而干容重逐样品不同、图里也读不出来。请导出体积累积速率后用你自己的干容重换算。<br>
                    导出的列名会带上单位（如 <code>volume_ar (cm per yr)</code>），单位随数据一起进数据集。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ================================================================= -->
          <!-- Tab 2: 测年数据与 Bacon / geoChronR 向导 (Section 6 & 用户深度建议) -->
          <!-- ================================================================= -->
          <div id="ad-tab-panel-modeling" style="flex: 1; display: none; gap: 16px; min-width: 0; min-height: 0; overflow-y: auto;">
            <!-- 左半边: 测年数据表格 (支持从 Excel 一键粘贴) -->
            <div style="flex: 1.2; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 12px; color: var(--accent-blue);">1. 📜 钻孔实测年代数据表 (Radiocarbon / Dating Table)</strong>
                <button class="tool-btn" id="btn-ad-paste-dates" style="font-size: 10.5px; color: #10b981; border-color: rgba(16,185,129,0.3);">
                  📋 从 Excel 粘贴测年序列 (Ctrl+V)
                </button>
              </div>

              <div style="flex: 1; min-height: 240px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: var(--bg-card);">
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
              <strong style="font-size: 12px; color: var(--accent-amber);">2. 🌋 复杂地质事件与先验约束 (Blaauw 2011)</strong>

              <!-- 沉积间断 (Hiatus) -->
              <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-hiatus" />
                  <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">存在沉积间断 / 不整合面 (Hiatus)</span>
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
              <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-slump" />
                  <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">瞬时沉积层 (Slump / 火山灰 / 洪水层)</span>
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
              <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-dr" />
                  <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">碳储库效应 / 硬水效应校正 (ΔR)</span>
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
                  <span id="ad-val-thick" style="color: var(--accent-blue); font-weight: 700;">5 cm</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="tool-btn ad-btn-thick" data-thick="2" style="flex: 1; font-size: 10px;">2 cm (高密)</button>
                  <button class="tool-btn ad-btn-thick active" data-thick="5" style="flex: 1; font-size: 10px; border-color: var(--accent-blue);">5 cm (标准)</button>
                  <button class="tool-btn ad-btn-thick" data-thick="10" style="flex: 1; font-size: 10px;">10 cm (长孔)</button>
                </div>
              </div>

              <!-- WebR 增量扩展包状态管理 (规范第二方式) -->
              <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 10.5px; font-weight: 600; color: var(--accent-blue);">WebR 浏览器纯内置算力包:</span>
                  <span id="ad-webr-comp-status" style="font-size: 9.5px; color: var(--accent-amber);">检查中...</span>
                </div>
                <div id="ad-webr-install-bar" style="display: flex; gap: 6px; margin-top: 5px;">
                  <button class="tool-btn" id="btn-ad-install-webr" style="flex: 1; font-size: 10px; color: var(--accent-blue); border-color: rgba(56,189,248,0.3);">
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
                  ⏳ 正在探测本地 R 与内置算力环境...
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-primary" id="btn-ad-run-local-r" style="flex: 1.3; font-size: 11px; padding: 6px; background: linear-gradient(135deg, #059669, #10b981);" title="优先调用本机 R + rbacon 原生运行；仅在本机没有 R 时才考虑内置 WebR 算力">
                    ▶ 运行 Bacon 年龄建模（本机 R）
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
      tabVisual.style.color = 'var(--accent-blue)';
      tabModeling.classList.remove('active');
      tabModeling.style.color = 'var(--text-muted)';
      pVisual.style.display = 'flex';
      pModeling.style.display = 'none';
    });

    tabModeling?.addEventListener('click', () => {
      tabModeling.classList.add('active');
      tabModeling.style.color = 'var(--accent-amber)';
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
        (btn as HTMLElement).style.borderColor = 'var(--accent-blue)';
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

    // ================= 四点标定交互 =================
    modal.querySelector('#ad-btn-calib-start')?.addEventListener('click', () => this.startCalibration());
    modal.querySelector('#ad-btn-calib-reset')?.addEventListener('click', () => this.resetCalibration());
    modal.querySelector('#ad-chk-age-log')?.addEventListener('change', () => this.updateCalibReadout());
    modal.querySelector('#ad-chk-depth-log')?.addEventListener('change', () => this.updateCalibReadout());
    (['ad-inp-age-left', 'ad-inp-age-right', 'ad-inp-depth-top', 'ad-inp-depth-bottom'] as const).forEach(
      (id) => modal.querySelector(`#${id}`)?.addEventListener('input', () => this.updateCalibReadout())
    );

    // ================= 排除笔刷 =================
    modal.querySelector('#ad-btn-exclude-add')?.addEventListener('click', () => this.toggleExcludeArmed());
    modal.querySelector('#ad-btn-exclude-clear')?.addEventListener('click', () => {
      this.excludeBoxes = [];
      this.excludePreview = null;
      this.updateExcludeCount();
      this.renderCanvas();
    });

    // ================= 速率口径勾选 =================
    // Bounds the exported age-depth table to the columns the user asked for. The tool
    // only offers what is derivable from the figure; MAR needs per-sample dry bulk
    // density and stays the user's own conversion.
    (['ad-chk-rate-sr', 'ad-chk-rate-ar'] as const).forEach((id) =>
      modal.querySelector(`#${id}`)?.addEventListener('change', () => this.renderRateOptionsNote())
    );
    this.renderRateOptionsNote();

    // 画布：标定点拾取 / 拖拽 / 排除框拖拽 / 悬停读数
    this.bindCanvasInteractions();

    // 渲染测年数据表
    this.renderDatingTable();

    // 初始化标定面板（未标定状态）
    this.updateExcludeCount();
    this.updateCalibChecklist();

    // 检查本地 R 环境并提示
    this.checkLocalR();
    // 检查 WebR 增量扩展包状态
    this.checkComponentStatus();

    // 建立 SSE 监听 component.ready 事件
    this.setupSseListener();

    // 绑定自适应 Bacon 建模主入口 (支持本地原生 R 与浏览器内置 WebR 双通道)
    modal.querySelector('#btn-ad-run-local-r')?.addEventListener('click', () => this.handleRunBaconModeling());

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

  private sseSource: EventSource | null = null;

  public close(): void {
    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  /**
   * True when the RPC client is answering from its offline Mock instead of the backend.
   *
   * ``RpcClient.call`` swallows *any* failure -- a transient network hiccup as well as a
   * legitimate JSON-RPC business error -- and then flips ``isMock`` permanently for the
   * rest of the session, never re-probing. Once that happens its ``mockExecute`` default
   * arm returns a bare ``true`` for every unknown method, so a status query would come
   * back as ``true`` and this modal would happily render "component not installed" or
   * "no local R detected" from a fabricated value. The guards below refuse to interpret
   * a Mock response as an observation.
   */
  private backendIsMock(): boolean {    try {
      return this.rpcClient.getStatus().isMock;
    } catch {
      return true;
    }
  }

  private renderBackendOffline(selector: string): void {
    const el = this.modalEl?.querySelector(selector) as HTMLElement | null;
    if (el) {
      el.innerHTML =
        `<span style="color:var(--accent-red, #ef4444);">⚠️ <strong>后端未连接</strong>: ` +
        `无法读取真实状态（RPC 已降级为离线 Mock，不再返回后端数据）</span>`;
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

  private setupSseListener(): void {
    if (typeof EventSource === 'undefined') return;
    try {
      if (this.sseSource) {
        this.sseSource.close();
        this.sseSource = null;
      }
      this.sseSource = new EventSource('/events');
      this.sseSource.addEventListener('component.ready', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data || '{}');
          this.onComponentReady(data);
        } catch {
          this.onComponentReady();
        }
      });
      this.sseSource.onerror = () => {
        // SSE 异常静默，不影响正常轮询与功能
      };
    } catch {
      // 忽略不支持环境
    }
  }

  private onComponentReady(data?: any): void {
    if (!this.modalEl) return;
    const statusEl = this.modalEl.querySelector('#ad-webr-comp-status');
    const installBtn = this.modalEl.querySelector('#btn-ad-install-webr') as HTMLButtonElement;
    const box = this.modalEl.querySelector('#ad-webr-progress-box') as HTMLElement;
    const bar = this.modalEl.querySelector('#ad-webr-progress-fill') as HTMLElement;
    const txt = this.modalEl.querySelector('#ad-webr-progress-txt') as HTMLElement;

    if (box) box.style.display = 'block';
    if (bar) bar.style.width = '100%';
    if (txt) {
      txt.innerHTML = `<span style="color:#34d399; font-weight: 700;">✅ 组件已就绪，年龄建模功能已激活！</span>`;
    }
    if (statusEl) {
      const ver = data?.version || '1.0.0';
      statusEl.innerHTML = `<strong style="color:#34d399;">✓ 已就绪 (${ver})</strong>`;
    }
    if (installBtn) {
      installBtn.textContent = '✓ 组件已激活';
      installBtn.disabled = true;
    }
    const hintEl = this.modalEl.querySelector('#ad-local-r-status');
    if (hintEl) {
      hintEl.innerHTML = `<strong style="color:#34d399;">✅ 年龄建模组件已就绪</strong> · 随时可运行 Bacon 建模`;
    }
  }

  private async handleRunBaconModeling(): Promise<void> {
    const dates = this.getDatingTableData();
    if (dates.length < 2) {
      alert('请至少在测年数据表中保留或输入 2 个测年层位！');
      return;
    }

    const runBtn = this.modalEl?.querySelector('#btn-ad-run-local-r') as HTMLButtonElement;
    const statusEl = this.modalEl?.querySelector('#ad-local-r-status');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = '⏳ 正在进行探测与建模计算...';
    }

    try {
      if (this.backendIsMock()) {
        this.renderBackendOffline('#ad-local-r-status');
        alert(
          '⚠️ 后端未连接，无法运行年代建模。\n\n' +
          'RPC 客户端已降级为离线 Mock：它不会再向后端发起请求，也无法返回真实的 ' +
          'R 环境探测或建模结果。请确认 straditize 后端进程在运行，然后重新打开本窗口。'
        );
        return;
      }

      // 探测 1: 本地是否装有系统 R 且有 rbacon？
      let hasLocalR = false;
      let rVersion = '';
      try {
        const rCheck = await this.rpcClient.call<void, any>('agedepth.checkREnvironment');
        if (rCheck && rCheck !== true && rCheck.has_r && rCheck.has_rbacon) {
          hasLocalR = true;
          rVersion = rCheck.r_version || '4.x';
        }
      } catch {
        hasLocalR = false;
      }

      if (hasLocalR) {
        if (statusEl) {
          statusEl.innerHTML = `🟢 <strong>本地 R 环境就绪 (${rVersion})</strong>: 原生满血 150 万次 MCMC 运算中 (仅需 2~3 秒)...`;
        }
        const res = await this.rpcClient.call<any, any>('agedepth.runLocalBacon', {
          dates,
          core_name: 'StraditizeCore',
          thickness: this.getSelectedThickness(),
          hiatus_depths: this.getHiatusDepths(),
          d_r: this.getDeltaR(),
          d_std: this.getDeltaRStd(),
        });

        if (res && res !== true && res.success && res.inspection) {
          this.inspectionData = res.inspection;
          this.mappedSamples = res.mapped_samples || null;
          this.renderCanvas();
          this.updateMappingTable();
          this.switchToVisualTab();
          if (statusEl) {
            statusEl.innerHTML = `✅ <strong>本地 R 建模完成</strong>: 原生 150 万次 MCMC 成功完成并生成 95% 置信带！`;
          }
          alert('✅ 本地 Rscript 原生满血 Bacon 建模完成！已自动生成拟合中值线与 95% 置信区间。');
          return;
        }
        if (res && res !== true && res.error) {
          alert(`❌ 本地 R 建模失败: ${res.error}`);
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:var(--accent-red, #ef4444);">❌ 本地 R 建模失败: ${res.error}</span>`;
          }
          return;
        }
      }

      // 探测 2: 本地无 R 或缺少 rbacon，探测 WebR 增量扩展包是否已安装
      const compStatus = await this.rpcClient.call<{ name: string }, any>('component.getStatus', { name: 'age-modeling' });
      if (compStatus && compStatus !== true && compStatus.is_installed) {
        if (statusEl) {
          statusEl.innerHTML = `⚡ <strong>WebR 算力就绪</strong>: 正在拉起内置 WASM 引擎计算...`;
        }
        await this.runWebRAgeModeling(dates);
        return;
      }

      // 未安装: 弹出引导并高亮下载区
      this.showInstallGuideModal();
    } catch (err: any) {
      alert(`运行 Bacon 年龄建模失败: ${err.message || err}`);
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '▶ 运行 Bacon 年龄建模';
      }
    }
  }

  /**
   * WebR + rbacon in-browser engine.
   *
   * NOT IMPLEMENTED. This method previously produced a fabricated result: it linearly
   * interpolated the dating table and added an invented uncertainty term
   * (``baseErr * 1.96 + sqrt(|d - p0.depth|) * 12``), then reported it as
   * "WebR 浏览器纯内置 WASM 贝叶斯建模完成". That is wrong twice over:
   *
   * * linear interpolation between dated levels is not an age-depth model, and it skips
   *   radiocarbon calibration entirely -- the table's ``age`` column holds ¹⁴C BP, so
   *   those numbers were being stamped as ``age_unit: 'cal BP'`` without ever passing
   *   through IntCal20;
   * * the fabricated ``inspectionData`` flowed on to ``onApplyAgeModel`` and was mounted
   *   onto the pollen diagram as the chronology.
   *
   * The ``cc`` column on every dating row was never read. Until a real WASM worker is
   * wired up, this path refuses rather than inventing.
   */
  private async runWebRAgeModeling(_dates: DatingPoint[]): Promise<void> {
    const statusEl = this.modalEl?.querySelector('#ad-local-r-status');
    if (statusEl) {
      statusEl.innerHTML =
        `<span style="color:var(--accent-amber);">⚠️ <strong>WebR 引擎尚未接通</strong>: ` +
        `组件资产已挂载，但浏览器端 rbacon 调用尚未实现，本路径不产出结果。</span>`;
    }
    alert(
      '⚠️ WebR 内置算力引擎尚未接通。\n\n' +
      '组件资产（WASM/JS）已安装到用户目录并通过 /components/webr/ 挂载，但浏览器端调用 ' +
      'rbacon 的执行代码还没有实现。\n\n' +
      '为避免用「线性内插 + 拍脑袋误差项」冒充贝叶斯年代模型（那会跳过 ¹⁴C 校正，' +
      '把 ¹⁴C BP 当成 cal BP 写进结果），本路径不产出任何年代数据。\n\n' +
      '请改用以下真实通道：\n' +
      '1. 【▶ 运行 Bacon 年龄建模】→ 本地 R + rbacon 原生运行\n' +
      '2. 【📈 geoChronR 脚本】→ 导出后在 R 中自行运行'
    );
  }

  private showInstallGuideModal(): void {
    const installBar = this.modalEl?.querySelector('#ad-webr-install-bar') as HTMLElement;
    if (installBar) {
      installBar.scrollIntoView({ behavior: 'smooth' });
      installBar.style.outline = '2px solid #38bdf8';
      installBar.style.borderRadius = '4px';
      setTimeout(() => {
        if (installBar) installBar.style.outline = '';
      }, 3000);
    }
    alert(
      '💡 未检测到本地 R/rbacon 环境，且尚未安装浏览器内置 WebR 算力包。\n\n' +
      '您可以通过以下方式之一运行年龄建模：\n' +
      '1. 点击下方【⬇️ 一键下载组件 (~40MB)】（流式拉取、进度与速度实时显示、SHA256严密校验）\n' +
      '2. 或在 R 终端中运行：install.packages("rbacon")\n' +
      '3. 或点击【📂 离线导入】选择 age-modeling.zip'
    );
  }

  private switchToVisualTab(): void {
    const tabVisual = this.modalEl?.querySelector('#ad-tab-btn-visual') as HTMLButtonElement;
    const tabModeling = this.modalEl?.querySelector('#ad-tab-btn-modeling') as HTMLButtonElement;
    const pVisual = this.modalEl?.querySelector('#ad-tab-panel-visual') as HTMLElement;
    const pModeling = this.modalEl?.querySelector('#ad-tab-panel-modeling') as HTMLElement;
    if (tabVisual && tabModeling && pVisual && pModeling) {
      tabVisual.classList.add('active');
      tabVisual.style.color = '#38bdf8';
      tabModeling.classList.remove('active');
      tabModeling.style.color = 'var(--text-muted)';
      pVisual.style.display = 'flex';
      pModeling.style.display = 'none';
    }
  }

  private getDatingTableData(): DatingPoint[] {
    if (!this.modalEl) return this.datingPoints;
    const rows = this.modalEl.querySelectorAll('#ad-dating-tbody tr');
    if (!rows || rows.length === 0) return this.datingPoints;

    const list: DatingPoint[] = [];
    rows.forEach((tr, idx) => {
      const inps = tr.querySelectorAll('input');
      const sel = tr.querySelector('select');
      if (inps.length >= 5) {
        list.push({
          id: inps[0].value.trim() || `14C_${idx + 1}`,
          depth: parseFloat(inps[1].value) || 0,
          age: parseFloat(inps[2].value) || 0,
          error: parseFloat(inps[3].value) || 30,
          thickness: parseFloat(inps[4].value) || 1,
          cc: sel ? parseInt(sel.value, 10) : 1,
        });
      }
    });
    return list;
  }

  private getSelectedThickness(): number {
    const activeBtn = this.modalEl?.querySelector('.ad-btn-thick.active');
    return activeBtn ? parseFloat(activeBtn.getAttribute('data-thick') || '5') : 5.0;
  }

  private getHiatusDepths(): number[] | undefined {
    const chk = this.modalEl?.querySelector('#ad-chk-hiatus') as HTMLInputElement;
    if (chk && chk.checked) {
      const val = (this.modalEl?.querySelector('#ad-inp-hiatus-depth') as HTMLInputElement)?.value.trim();
      if (val) {
        const d = parseFloat(val);
        if (!isNaN(d)) return [d];
      }
    }
    return undefined;
  }

  private getDeltaR(): number | undefined {
    const chk = this.modalEl?.querySelector('#ad-chk-dr') as HTMLInputElement;
    if (chk && chk.checked) {
      const val = (this.modalEl?.querySelector('#ad-inp-dr-val') as HTMLInputElement)?.value;
      if (val) return parseFloat(val);
    }
    return undefined;
  }

  private getDeltaRStd(): number | undefined {
    const chk = this.modalEl?.querySelector('#ad-chk-dr') as HTMLInputElement;
    if (chk && chk.checked) {
      const val = (this.modalEl?.querySelector('#ad-inp-dr-std') as HTMLInputElement)?.value;
      if (val) return parseFloat(val);
    }
    return undefined;
  }

  private async checkComponentStatus(): Promise<void> {
    if (!this.modalEl) return;
    const statusEl = this.modalEl.querySelector('#ad-webr-comp-status');
    const installBtn = this.modalEl.querySelector('#btn-ad-install-webr') as HTMLButtonElement;

    try {
      const res = await this.rpcClient.call<{ name: string }, any>('component.getStatus', { name: 'age-modeling' });
      // A Mock response carries no installation state; rendering "not installed" from it
      // would be a fabricated observation.
      if (this.backendIsMock() || res === true) {
        this.renderBackendOffline('#ad-webr-comp-status');
        if (installBtn) installBtn.disabled = true;
        return;
      }
      if (res) {
        if (res.is_installed) {
          if (statusEl) statusEl.innerHTML = `<strong style="color:#34d399;">✓ 已安装 (${res.installed_version})</strong>`;
          if (installBtn) {
            installBtn.textContent = '✓ 组件已激活';
            installBtn.disabled = true;
          }
        } else if (res.downloading) {
          if (statusEl) statusEl.innerHTML = `<strong style="color:var(--accent-blue);">下载中...</strong>`;
          this.pollDownloadProgress();
        } else {
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-amber);">未安装 (需增量包)</span>`;
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
    if (txt) txt.textContent = '正在连接镜像流式拉取 age-modeling.zip (~40MB)...';

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

        const speedStr = res.progress.speed_str || '计算中...';
        const dlMb = (res.progress.downloaded_bytes / 1048576).toFixed(1);
        const totalMb = res.progress.total_bytes ? (res.progress.total_bytes / 1048576).toFixed(1) : '40.0';
        if (txt) {
          txt.textContent = `下载进度: ${pct.toFixed(1)}% (${dlMb} MB / ${totalMb} MB) · ${speedStr}`;
        }

        if (res.progress.status === 'completed' || res.is_installed) {
          clearInterval(timer);
          this.onComponentReady(res);
        } else if (res.progress.status === 'failed') {
          clearInterval(timer);
          if (txt) txt.innerHTML = `<span style="color:#ef4444;">❌ 下载失败: ${res.progress.error || '网络超时'}</span>`;
        }
      } else if (res && res.is_installed) {
        clearInterval(timer);
        this.onComponentReady(res);
      } else {
        clearInterval(timer);
      }
    }, 800);
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
        this.onComponentReady(instRes);
        alert('✅ 组件已就绪，年龄建模功能已激活！');
        this.checkComponentStatus();
      }
    } catch (err: any) {
      alert(`离线导入失败: ${err.message || err}`);
    }
  }

  private async checkLocalR(): Promise<void> {
    if (!this.modalEl) return;
    const statusEl = this.modalEl.querySelector('#ad-local-r-status');
    const runBtn = this.modalEl.querySelector('#btn-ad-run-local-r') as HTMLButtonElement | null;
    try {
      const res = await this.rpcClient.call<void, any>('agedepth.checkREnvironment');
      // Mock returns a bare `true`, so `res.has_r` would read as undefined and the modal
      // would claim "no system Rscript" while R + rbacon are in fact installed.
      if (this.backendIsMock() || res === true) {
        this.renderBackendOffline('#ad-local-r-status');
        return;
      }
      if (res && res.has_r && res.has_rbacon) {
        // Local R is the first-choice engine, so say so before the user clicks rather
        // than only after. Nothing needs downloading in this case.
        if (statusEl) {
          statusEl.innerHTML =
            `🟢 <strong>本机 R 已就绪，将直接调用</strong>: ${res.r_version || 'R 4.x'} · ` +
            `rbacon 已安装 · 无需下载任何组件`;
        }
        if (runBtn) {
          runBtn.textContent = '▶ 运行 Bacon 年龄建模（本机 R）';
        }
        return;
      }
      if (res && res.has_r) {
        if (statusEl) {
          statusEl.innerHTML = `🟡 已探测到 ${res.r_version || 'R'}，但缺少 <code>rbacon</code> 包。装包后即可本机运行：<code>install.packages("rbacon")</code>`;
        }
        return;
      }
      if (statusEl) {
        statusEl.innerHTML = `⚪ 未探测到本机 R/rbacon。可安装 R + rbacon（推荐），或待 WebR 引擎接通后使用内置算力。`;
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
      this.mappedSamples = null;
      this.excludeBoxes = [];
      this.updateExcludeCount();
      this.seedCalibration(img.naturalWidth, img.naturalHeight);
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
        this.mappedSamples = null;
        this.excludeBoxes = [];
        this.updateExcludeCount();
        // A user-supplied figure requires an explicit calibration pass.
        this.startCalibration();
        this.renderCanvas();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  private async executeExtraction(): Promise<void> {
    if (!this.modalEl || !this.bgImage) return;
    this.showExtractError('');

    if (this.backendIsMock()) {
      this.showExtractError(
        '后端未连接：RPC 客户端已降级为离线 Mock，不会返回真实的识别结果。请确认后端进程在运行后重开本窗口。'
      );
      return;
    }

    if (this.calibMarkers.length < 4) {
      this.showExtractError(
        `标定未完成（已放置 ${this.calibMarkers.length}/4 个点）。请点击「🎯 在图上点击 4 个标定点」并按清单顺序依次落点。`
      );
      return;
    }

    const m = this.markerMap();
    if (!m) return;

    const ageVals = [this.readNumber('ad-inp-age-left'), this.readNumber('ad-inp-age-right')];
    const depthVals = [this.readNumber('ad-inp-depth-top'), this.readNumber('ad-inp-depth-bottom')];
    const ageLog = this.readChecked('ad-chk-age-log');
    const depthLog = this.readChecked('ad-chk-depth-log');

    if (ageVals.some((v) => v === null) || depthVals.some((v) => v === null)) {
      this.showExtractError('四个标定值都必须填写有效数字。');
      return;
    }
    if (Math.abs((ageVals[0] as number) - (ageVals[1] as number)) < 1e-9) {
      this.showExtractError('两个年龄标定值不能相同，否则无法建立像素到年代的映射。');
      return;
    }
    if (Math.abs((depthVals[0] as number) - (depthVals[1] as number)) < 1e-9) {
      this.showExtractError('两个深度标定值不能相同，否则无法建立像素到深度的映射。');
      return;
    }
    if (ageLog && (ageVals as number[]).some((v) => v <= 0)) {
      this.showExtractError('年龄轴启用 log 变换时，标定值必须为严格正数。');
      return;
    }
    if (depthLog && (depthVals as number[]).some((v) => v <= 0)) {
      this.showExtractError('深度轴启用 log 变换时，标定值必须为严格正数。');
      return;
    }

    // A click may land in either vertical order; sort so depth_px runs shallow -> deep.
    const depthPx = [m.depthA.y, m.depthB.y];
    const agePx = [m.ageA.x, m.ageB.x];

    const rangeMin = this.readNumber('ad-inp-range-min');
    const rangeMax = this.readNumber('ad-inp-range-max');
    const step = this.readNumber('ad-inp-resample');

    const btn = this.modalEl.querySelector('#ad-btn-extract') as HTMLButtonElement;
    const prevLabel = btn?.textContent || '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 正在逐行追踪年代曲线...';
    }

    try {
      const res = await this.rpcClient.call<any, any>('agedepth.extractAndInspect', {
        depth_px: depthPx,
        depth_vals: depthVals,
        age_px: agePx,
        age_vals: ageVals,
        depth_range: rangeMin !== null && rangeMax !== null ? [rangeMin, rangeMax] : null,
        resample_step: step !== null && step > 0 ? step : null,
        depth_log: depthLog,
        age_log: ageLog,
        exclude_boxes: this.excludeBoxes,
        curve_type: 'median',
        envelope_type: '95_hpd',
        // Units and the age-direction convention are fixed by contract, not user input:
        // the tool speaks cm and cal BP only, and the user converts their own axis before
        // entering calibration values. The backend still validates the direction and
        // refuses a contradiction, which is what turns a silent 1000x / reversed-axis
        // mistake into a readable error.
        depth_unit: 'cm',
        age_unit: 'cal BP',
        cal_curve: 'IntCal20',
        age_increases_downcore: true,
        age_is_calendar_year: true,
        rate_columns: this.selectedRateColumns(),
      });

      if (res && res !== true && res.inspection) {
        this.inspectionData = res.inspection;
        this.mappedSamples = res.mapped_samples || null;
        this.renderCanvas();
        this.updateMappingTable();
        const statusEl = this.modalEl.querySelector('#ad-status-msg');
        const n = (res.inspection.depths || []).length;
        const sampled = res.mapped_samples?.depths?.length || 0;
        const ens = res.generated_ensemble;
        let note = '';
        if (ens?.skipped) {
          note = ' · ⚠️ 已跳过年代集合';
        } else if (ens?.diagnostics) {
          const dg = ens.diagnostics;
          note = ` · L=${dg.correlation_length}cm`;
        }
        if (statusEl) {
          statusEl.textContent = `✅ 识别成功：提取 ${n} 个深度层位，映射 ${sampled} 个花粉样品${note}`;
        }
      } else {
        this.showExtractError(
          '后端未返回识别结果（可能是识别失败，或 RPC 已降级为 Mock）。请检查标定点是否落在坐标轴上、深度范围是否与曲线重叠。'
        );
      }
    } catch (err: any) {
      this.showExtractError(`识别失败: ${err?.message || err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || '🔍 ③ 运行识别并叠加视觉校对';
      }
    }
  }

  // ==========================================================================
  // 四点标定交互
  // ==========================================================================

  private bindCanvasInteractions(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    canvas.addEventListener('mousedown', (e) => {
      const pt = this.canvasToImage(e.clientX, e.clientY);

      if (this.excludeArmed) {
        this.excludeDragStart = pt;
        this.excludePreview = [pt.x, pt.y, pt.x, pt.y];
        e.preventDefault();
        return;
      }

      const hit = this.findMarkerAt(pt);
      if (hit >= 0) {
        this.draggingMarker = hit;
        e.preventDefault();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const pt = this.canvasToImage(e.clientX, e.clientY);

      if (this.excludeArmed && this.excludeDragStart) {
        this.excludePreview = [
          Math.min(this.excludeDragStart.x, pt.x),
          Math.min(this.excludeDragStart.y, pt.y),
          Math.max(this.excludeDragStart.x, pt.x),
          Math.max(this.excludeDragStart.y, pt.y),
        ];
        this.renderCanvas();
        return;
      }

      if (this.draggingMarker !== null && this.calibMarkers[this.draggingMarker]) {
        this.calibMarkers[this.draggingMarker].x = pt.x;
        this.calibMarkers[this.draggingMarker].y = pt.y;
        this.updateCalibReadout();
        this.renderCanvas();
        return;
      }

      this.handleCanvasHover(e);
    });

    const endDrag = () => {
      if (this.excludeArmed && this.excludePreview) {
        const [x0, y0, x1, y1] = this.excludePreview;
        if (Math.abs(x1 - x0) > 4 && Math.abs(y1 - y0) > 4) {
          this.excludeBoxes.push([
            Math.round(x0),
            Math.round(y0),
            Math.round(x1),
            Math.round(y1),
          ]);
        }
        this.excludePreview = null;
        this.excludeDragStart = null;
        this.excludeArmed = false;
        this.applyExcludeArmedUI();
        this.updateExcludeCount();
        this.renderCanvas();
        return;
      }
      this.draggingMarker = null;
    };
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      this.draggingMarker = null;
      if (this.excludeDragStart) endDrag();
    });

    canvas.addEventListener('click', (e) => {
      if (!this.calibPicking || this.excludeArmed) return;
      const pt = this.canvasToImage(e.clientX, e.clientY);
      // A click that merely terminated a marker drag must not add a new handle.
      if (this.findMarkerAt(pt) >= 0) return;
      this.addCalibMarker(pt);
    });
  }

  /** Converts a client (CSS) coordinate into image pixel space. */
  private canvasToImage(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? this.canvas.height / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  private findMarkerAt(pt: { x: number; y: number }): number {
    if (!this.canvas) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const radius = MARKER_HIT_RADIUS * scale;
    for (let i = 0; i < this.calibMarkers.length; i++) {
      const mk = this.calibMarkers[i];
      if (Math.hypot(mk.x - pt.x, mk.y - pt.y) <= radius) return i;
    }
    return -1;
  }

  private markerMap(): Record<CalibKind, CalibMarker> | null {
    const map = {} as Record<CalibKind, CalibMarker>;
    for (const mk of this.calibMarkers) map[mk.kind] = mk;
    if (!map.ageA || !map.ageB || !map.depthA || !map.depthB) return null;
    return map;
  }

  /** Seeds four draggable handles at plausible axis positions so a sample is usable at once.

   * Only the coordinate *along* each axis carries information — the age handles are read
   * by their x, the depth handles by their y — so the handles are pushed just off their
   * axis line. Otherwise the two handles meeting at the plot's bottom-left corner land on
   * top of each other and neither can be grabbed.
   */
  private seedCalibration(width: number, height: number): void {
    const xLeft = width * 0.13;
    const xRight = width * 0.94;
    const yTop = height * 0.04;
    const yBottom = height * 0.88;
    const padX = width * 0.022;
    const padY = height * 0.022;
    this.calibMarkers = [
      { kind: 'ageA', x: xLeft, y: yBottom + padY },
      { kind: 'ageB', x: xRight, y: yBottom + padY },
      { kind: 'depthA', x: xLeft - padX, y: yTop },
      { kind: 'depthB', x: xLeft - padX, y: yBottom },
    ];
    this.calibPicking = false;
    this.updateCalibChecklist();
    this.updateCalibReadout();
  }

  private startCalibration(): void {
    this.calibMarkers = [];
    this.calibPicking = true;
    this.draggingMarker = null;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
  }

  private resetCalibration(): void {
    this.calibMarkers = [];
    this.calibPicking = false;
    this.draggingMarker = null;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
  }

  private addCalibMarker(pt: { x: number; y: number }): void {
    const nextKind = CALIB_ORDER[this.calibMarkers.length];
    if (!nextKind) return;
    this.calibMarkers.push({ kind: nextKind, x: pt.x, y: pt.y });
    if (this.calibMarkers.length >= CALIB_ORDER.length) this.calibPicking = false;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
  }

  private updateCalibChecklist(): void {
    if (!this.modalEl) return;
    const placed = new Set(this.calibMarkers.map((mk) => mk.kind));

    this.modalEl.querySelectorAll('#ad-calib-checklist li').forEach((node) => {
      const li = node as HTMLElement;
      const kind = li.getAttribute('data-kind') as CalibKind | null;
      const done = kind ? placed.has(kind) : false;
      li.style.color = done ? 'var(--accent-green)' : 'var(--text-muted)';
      li.style.fontWeight = done ? '600' : '400';
      const text = CALIB_META[kind as CalibKind]?.label || '';
      li.textContent = done ? `✓ ${text}` : text;
    });

    const hint = this.modalEl.querySelector('#ad-calib-hint') as HTMLElement;
    if (hint) {
      if (this.calibPicking) {
        const next = CALIB_ORDER[this.calibMarkers.length];
        hint.style.color = 'var(--accent-amber)';
        hint.innerHTML = next
          ? `请在图上点击：<strong>${CALIB_META[next].ordinal} ${CALIB_META[next].label}</strong>`
          : '';
      } else if (this.calibMarkers.length >= 4) {
        hint.style.color = 'var(--accent-green)';
        hint.innerHTML = '✓ 四点已落位，可拖动微调，然后填写标定值。';
      } else {
        hint.style.color = 'var(--text-muted)';
        hint.innerHTML = '未标定，无法识别。';
      }
    }

    const startBtn = this.modalEl.querySelector('#ad-btn-calib-start') as HTMLButtonElement;
    if (startBtn) {
      startBtn.textContent = this.calibMarkers.length >= 4 ? '🎯 重新点击标定点' : '🎯 在图上点击 4 个标定点';
    }

    const values = this.modalEl.querySelector('#ad-calib-values') as HTMLElement;
    if (values) values.style.display = this.calibMarkers.length >= 4 ? 'block' : 'none';
  }

  private updateCalibReadout(): void {
    if (!this.modalEl) return;
    this.updateCalibChecklist();
    const out = this.modalEl.querySelector('#ad-calib-readout') as HTMLElement;
    const m = this.markerMap();
    if (!out || !m) return;

    const ageVals = [this.readNumber('ad-inp-age-left'), this.readNumber('ad-inp-age-right')];
    const depthVals = [this.readNumber('ad-inp-depth-top'), this.readNumber('ad-inp-depth-bottom')];
    const agePxSpan = Math.abs(m.ageB.x - m.ageA.x);
    const depthPxSpan = Math.abs(m.depthB.y - m.depthA.y);

    const parts: string[] = [];
    if (ageVals[0] !== null && ageVals[1] !== null && agePxSpan > 1e-6) {
      const perPx = Math.abs((ageVals[1] as number) - (ageVals[0] as number)) / agePxSpan;
      parts.push(`年龄: ${agePxSpan.toFixed(0)} px = ${Math.abs((ageVals[1] as number) - (ageVals[0] as number)).toFixed(0)} → ${perPx.toFixed(3)}/px`);
    }
    if (depthVals[0] !== null && depthVals[1] !== null && depthPxSpan > 1e-6) {
      const perPx = Math.abs((depthVals[1] as number) - (depthVals[0] as number)) / depthPxSpan;
      parts.push(`深度: ${depthPxSpan.toFixed(0)} px = ${Math.abs((depthVals[1] as number) - (depthVals[0] as number)).toFixed(0)} → ${perPx.toFixed(3)}/px`);
    }
    out.textContent = parts.join(' ｜ ');
  }

  private toggleExcludeArmed(): void {
    this.excludeArmed = !this.excludeArmed;
    this.excludeDragStart = null;
    this.excludePreview = null;
    this.applyExcludeArmedUI();
    this.renderCanvas();
  }

  private applyExcludeArmedUI(): void {
    const btn = this.modalEl?.querySelector('#ad-btn-exclude-add') as HTMLElement;
    if (btn) {
      btn.style.borderColor = this.excludeArmed ? 'var(--accent-red, #ef4444)' : '';
      btn.style.color = this.excludeArmed ? 'var(--accent-red, #ef4444)' : '';
      btn.textContent = this.excludeArmed ? '✕ 拖框以排除…' : '＋ 拖框添加';
    }
    if (this.canvas) {
      this.canvas.style.cursor = this.excludeArmed ? 'crosshair' : 'default';
    }
  }

  private updateExcludeCount(): void {
    const el = this.modalEl?.querySelector('#ad-exclude-count');
    if (el) el.textContent = `${this.excludeBoxes.length} 个`;
  }

  private showExtractError(message: string): void {
    const el = this.modalEl?.querySelector('#ad-extract-error') as HTMLElement;
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
  }

  private readNumber(id: string): number | null {
    const input = this.modalEl?.querySelector(`#${id}`) as HTMLInputElement | null;
    if (!input) return null;
    const raw = input.value.trim();
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  private readChecked(id: string): boolean {
    const input = this.modalEl?.querySelector(`#${id}`) as HTMLInputElement | null;
    return !!input?.checked;
  }

  /** Rate column keys the user ticked, in export order. */
  private selectedRateColumns(): string[] {
    const cols: string[] = [];
    if (this.readChecked('ad-chk-rate-sr')) cols.push('volume_ar_cm_per_yr');
    if (this.readChecked('ad-chk-rate-ar')) cols.push('acc_rate_yr_per_depth');
    return cols;
  }

  private renderRateOptionsNote(): void {
    const el = this.modalEl?.querySelector('#ad-rate-units') as HTMLElement | null;
    if (el) {
      const sel = this.selectedRateColumns();
      el.textContent = sel.length ? `${sel.length} 列速率将写入数据集（含单位）` : '不导出速率列';
    }
    // The preview table mirrors the export selection so what you see is what gets written.
    if (this.inspectionData) this.updateMappingTable();
  }

  /** Draws calibration handles, the calibration rectangle, and eraser boxes. */
  private renderCalibrationOverlay(ctx: CanvasRenderingContext2D): void {
    // Eraser boxes first so handles stay legible on top.
    const boxes = [...this.excludeBoxes];
    if (this.excludePreview) boxes.push(this.excludePreview);
    boxes.forEach((box) => {
      const [x0, y0, x1, y1] = box;
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.strokeStyle = EXCLUDE_BOX_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    });

    const m = this.markerMap();
    if (m) {
      // Calibration rectangle: x from the age handles, y from the depth handles.
      const rx0 = Math.min(m.ageA.x, m.ageB.x);
      const rx1 = Math.max(m.ageA.x, m.ageB.x);
      const ry0 = Math.min(m.depthA.y, m.depthB.y);
      const ry1 = Math.max(m.depthA.y, m.depthB.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.restore();

      // Guide lines tying the age handles to the bottom edge and depth handles to the left edge.
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(m.ageA.x, ry0);
      ctx.lineTo(m.ageA.x, ry1);
      ctx.moveTo(m.ageB.x, ry0);
      ctx.lineTo(m.ageB.x, ry1);
      ctx.moveTo(rx0, m.depthA.y);
      ctx.lineTo(rx1, m.depthA.y);
      ctx.moveTo(rx0, m.depthB.y);
      ctx.lineTo(rx1, m.depthB.y);
      ctx.stroke();
      ctx.restore();
    }

    // Handles
    const rect = this.canvas?.getBoundingClientRect();
    const scale = rect && rect.width > 0 && this.canvas ? this.canvas.width / rect.width : 1;
    const radius = Math.max(6, 7 * scale);

    this.calibMarkers.forEach((mk) => {
      const meta = CALIB_META[mk.kind];
      ctx.save();
      ctx.beginPath();
      ctx.arc(mk.x, mk.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.stroke();

      // Ordinal tag
      ctx.font = `bold ${Math.max(12, Math.round(14 * scale))}px sans-serif`;
      ctx.fillStyle = meta.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = Math.max(2, 3 * scale);
      const ty = mk.y - radius - 3 * scale;
      ctx.strokeText(meta.ordinal, mk.x - radius * 0.55, ty);
      ctx.fillText(meta.ordinal, mk.x - radius * 0.55, ty);
      ctx.restore();
    });
  }

  private renderCanvas(): void {
    if (!this.canvas || !this.ctx || !this.bgImage) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.bgImage, 0, 0, w, h);

    if (this.inspectionData && this.inspectionData.px_points) {
      this.renderModelOverlay(ctx, this.inspectionData.px_points);
    }

    // Calibration handles and eraser boxes stay visible regardless of overlay state.
    this.renderCalibrationOverlay(ctx);
  }

  private renderModelOverlay(
    ctx: CanvasRenderingContext2D,
    px: NonNullable<AgeDepthModelInspectionData['px_points']>
  ): void {
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

    // 花粉层位交点：像素位置由后端标定器直接给出，前端不做坐标反算。
    // Drawn small on purpose: with a dense sampling interval these marker the whole curve,
    // and anything larger buries the fitted median line underneath them.
    if (this.showPollenHorizons && this.mappedSamples?.px_y && this.mappedSamples?.px_x_curve) {
      const ys = this.mappedSamples.px_y;
      const xs = this.mappedSamples.px_x_curve;
      const n = Math.min(ys.length, xs.length);
      ctx.fillStyle = '#34d399';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }


  private updateMappingTable(): void {
    if (!this.modalEl || !this.inspectionData) return;
    const tbody = this.modalEl.querySelector('#ad-mapping-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const rates = this.mappedSamples?.rate;
    const unitsEl = this.modalEl.querySelector('#ad-rate-units');
    if (unitsEl) {
      unitsEl.textContent = rates?.units?.acc_rate ? `${rates.units.acc_rate}` : '';
    }
    const accMid = rates?.acc_rate_yr_per_depth;
    const accLo = rates?.acc_rate_yr_per_depth_min;
    const accHi = rates?.acc_rate_yr_per_depth_max;
    const fmt = (v: number | null | undefined): string =>
      v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2);
    const rateCell = (i: number): string => {
      const mid = accMid?.[i];
      if (mid === undefined) {
        return '<td style="color:var(--text-muted); font-size:9px;">—</td>';
      }
      // null marks an undefined rate (an instantaneous deposit: zero time per unit depth,
      // so the reciprocal does not exist). Rendering it as 0 would claim the opposite.
      if (mid === null) {
        return '<td style="color:var(--accent-amber, #f59e0b); font-size:9px;" title="瞬时沉积层：该段历时为 0，速率无定义">∞</td>';
      }
      return (
        `<td style="color:var(--text-secondary); font-size:9.5px;">${fmt(mid)}` +
        `<br><span style="color:var(--text-muted); font-size:8.5px;">${fmt(accLo?.[i])}–${fmt(accHi?.[i])}</span></td>`
      );
    };

    // If mapped pollen samples are returned from backend session, display them
    if (this.mappedSamples && this.mappedSamples.depths && this.mappedSamples.depths.length > 0) {
      const ms = this.mappedSamples;
      for (let i = 0; i < ms.depths.length; i++) {
        const tr = document.createElement('tr');
        const minVal = ms.age_min ? ms.age_min[i] : (ms.age_est[i] - 100);
        const maxVal = ms.age_max ? ms.age_max[i] : (ms.age_est[i] + 100);
        tr.innerHTML = `
          <td style="font-weight: 600; color: var(--accent-blue);">${ms.depths[i]} cm</td>
          <td style="color: var(--text-primary); font-weight: 500;">${Math.round(ms.age_est[i])}</td>
          <td style="color: var(--text-muted); font-size: 9.5px;">${Math.round(minVal)} ~ ${Math.round(maxVal)}</td>
          ${rateCell(i)}
        `;
        tbody.appendChild(tr);
      }
      return;
    }

    // Fallback: display representative depth steps from inspection model
    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min;
    const ma = this.inspectionData.age_max;

    const step = Math.max(1, Math.floor(d.length / 15));
    for (let i = 0; i < d.length; i += step) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--accent-blue);">${d[i].toFixed(1)} cm</td>
        <td style="color: var(--text-primary); font-weight: 500;">${Math.round(a[i])}</td>
        <td style="color: var(--text-muted); font-size: 9.5px;">${Math.round(mi[i])} ~ ${Math.round(ma[i])}</td>
        <td style="color: var(--text-muted); font-size:9px;">—</td>
      `;
      tbody.appendChild(tr);
    }
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.canvas || !this.inspectionData || !this.inspectionData.px_points) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleY = this.canvas.height / rect.height;
    const my = (e.clientY - rect.top) * scaleY;

    const px = this.inspectionData.px_points;
    const hud = this.modalEl?.querySelector('#ad-canvas-hud');
    if (!hud || !px.y || px.y.length === 0) return;

    // Find nearest point on the curve along Y
    let bestIdx = 0;
    let minDiff = 99999;
    for (let i = 0; i < px.y.length; i++) {
      const diff = Math.abs(px.y[i] - my);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    const d = this.inspectionData.depths[bestIdx];
    const a = this.inspectionData.ages[bestIdx];
    const mi = this.inspectionData.age_min[bestIdx];
    const ma = this.inspectionData.age_max[bestIdx];

    hud.innerHTML = `深度: <strong style="color:var(--accent-blue);">${d.toFixed(1)} cm</strong> ➔ 年代: <strong style="color:var(--text-heading);">${Math.round(a)} cal BP</strong> (95% CI: <span style="color:var(--accent-amber);">${Math.round(mi)} ~ ${Math.round(ma)}</span>)`;
  }
}
