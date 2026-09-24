import { BackendStatus, JsonRpcRequest, JsonRpcResponse } from '../types/rpc';
import { tError } from '../i18n/errorCodes';
import { t } from '../i18n';
import { Column, ControlPoint, DataRoi, DepthCalibration, DiagramData, LineMaskStroke } from '../types/pollen';
import { PollenGlossary } from '../core/PollenGlossary';

/** 后端 ocr.getTaxaDict 的返回结构 */
export interface TaxaDictEntry {
  zh: string;
  latin: string;
  group: string;
  family: string;
}

export interface TaxaDictSummary {
  success: boolean;
  path: string;
  exists: boolean;
  builtin_pollen_count: number;
  builtin_npp_count: number;
  custom: TaxaDictEntry[];
  custom_count: number;
}

/** 后端 ocr.parseTaxaText 的返回结构 */
export interface TaxaParseResult {
  success: boolean;
  entries: Array<{ zh_name: string; latin_name: string; group: string }>;
  count: number;
  /** 'figure_caption' 表示识别为期刊图版说明，'list' 为普通名单 */
  format: 'figure_caption' | 'list';
}

/** 后端 ocr.saveCustomTaxa 的返回结构 */
export interface TaxaSaveResult {
  success: boolean;
  path: string;
  added: number;
  skipped: string[];
  custom_count: number;
  entries: TaxaDictEntry[];
}

/**
 * 干净的初始状态工厂（不预置任何属种列、控制点或示例数据）。
 * 真实数据一律来自后端；前端不再持有任何可充当"结果"的替代数据源。
 *
 * 注意 `calibration.isCalibrated` 为 false 且四个端点为 null：未标定就是未标定，
 * 前端绝不填 0/150 这类占位刻度（那会让用户以为深度轴已经生效）。
 */
function createEmptyDiagramData(): DiagramData {
  return {
    imageSrc: '',
    imageWidth: 0,
    imageHeight: 0,
    rois: [],
    primary_roi_id: '',
    active_roi_id: '',
    roi: { id: '', name: 'pollen', name_source: 'default', composition: true, visible: true, xlim: [0, 0], ylim: [0, 0], columns_stale: false, form_defaults: null, xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
    calibration: {
      isCalibrated: false,
      top_px: null,
      top_cm: null,
      bottom_px: null,
      bottom_cm: null,
      unit: 'cm',
    },
    line_candidates: [],
    selected_candidate_ids: [],
    line_strokes: [],
    exclusion_regions: [],
    samples: [],
    lineCorrections: [],
    columns: [],
    activeTaxaId: '',
    selectedEntity: null,
  };
}

/** 后端 algorithm.degrid 的返回值 */
export interface DegridResult {
  success: boolean;
  strength: string;
  remove_vertical: boolean;
  max_thickness: number;
  horizontal_rows: number[];
  vertical_cols: number[];
  removed_lines_count: number;
  removed_pixels: number;
  auto_pixels: number;
  manual_restore_pixels: number;
  manual_erase_pixels: number;
  roi: [number, number, number, number];
  /** `strength === 'off'` 时为 null：没有掩膜可显示。 */
  overlay_png: string | null;
}

export class RpcClient {
  private endpoint: string;
  /**
   * 后端是否可达。只由 probeBackend() 与 call() 的传输结果维护。
   * 为 false 时一律抛错，绝不返回替代数据。
   */
  private backendOnline: boolean = false;
  private isDesktopMode: boolean = false;
  private requestId: number = 1;
  private currentDiagramData: DiagramData;
  /** 状态订阅者列表。用列表而非单一槽位：横幅与顶栏胶囊都需要同一份状态，互相覆盖会导致胶囊长期停留在旧值。 */
  private statusListeners: Array<(status: BackendStatus) => void> = [];

  constructor(endpoint?: string) {
    if (endpoint) {
      this.endpoint = endpoint;
    } else if (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http')) {
      this.endpoint = `${window.location.origin}/rpc`;
    } else {
      this.endpoint = 'http://127.0.0.1:8765/rpc';
    }
    this.currentDiagramData = createEmptyDiagramData();
  }

  /** 当前会话图谱的浏览器可直接访问的 URL（由后端提供，前端不再自带示例图片副本） */
  private imageUrl(): string {
    return `${this.endpoint.replace(/\/rpc$/, '')}/image/current?full=1&t=${Date.now()}`;
  }

  public setStatusCallback(callback: (status: BackendStatus) => void): void {
    this.statusListeners.push(callback);
    callback(this.getStatus());
  }

  public getStatus(): BackendStatus {
    return {
      connected: this.backendOnline,
      isMock: false,
      endpoint: this.endpoint,
      latencyMs: this.backendOnline ? 5 : 0,
      isDesktopMode: this.isDesktopMode,
    };
  }

  /**
   * 探测真实 JSON-RPC 后端
   */
  public async probeBackend(preferredUrl?: string): Promise<BackendStatus> {
    const candidates: string[] = [];
    if (preferredUrl) {
      candidates.push(preferredUrl);
    }
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http')) {
      const originRpc = window.location.origin + "/rpc";
      if (!candidates.includes(originRpc)) {
        candidates.push(originRpc);
      }
    }
    const defaultRpc = 'http://127.0.0.1:8765/rpc';
    if (!candidates.includes(defaultRpc)) {
      candidates.push(defaultRpc);
    }

    for (const url of candidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);

        const requestPayload: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'system.ping',
          params: {},
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data: JsonRpcResponse = await res.json();
          if (data && !data.error) {
            this.endpoint = url;
            this.backendOnline = true;
            try {
              const statusUrl = url.replace(/\/rpc$/, '/status');
              const sRes = await fetch(statusUrl);
              if (sRes.ok) {
                const sData = await sRes.json();
                if (sData && typeof sData.is_desktop_mode === 'boolean') {
                  this.isDesktopMode = sData.is_desktop_mode;
                }
              }
            } catch {
              // ignore
            }
            this.notifyStatus();
            return this.getStatus();
          }
        }
      } catch {
        // Continue to next candidate
      }
    }

    this.backendOnline = false;
    this.notifyStatus();
    return this.getStatus();
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /**
   * 通用 JSON-RPC 2.0 请求方法
   */
  /**
   * 后端「不可达」时的统一处理：标记离线、通知界面，然后【抛错】。
   *
   * 这里刻意不返回任何替代数据。历史实现会切换为 Mock 并返回前端编造的结果
   * （随机抖动的曲线、固定名单的属种名、等分切割的分列边界），用户无法分辨，
   * 可能直接当成科研成果导出。对科研数据工具而言，宁可中断也不能给假数据。
   */
  private raiseBackendLost(method: string, reason: unknown): never {
    console.warn(`Backend unreachable for ${method} (no substitute data returned):`, reason);
    const wasOnline = this.backendOnline;
    this.backendOnline = false;
    this.notifyStatus();
    throw new Error(t(wasOnline ? 'error.backendLost' : 'error.backendOffline'));
  }

  public async call<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams
  ): Promise<TResult> {
    // === 路径 A：未连接后端 —— 直接报错，绝不返回替代数据 ===
    if (!this.backendOnline) {
      this.raiseBackendLost(method, new Error('backend not probed / offline'));
    }

    // === 路径 B：真实后端（唯一的数据来源）===
    {
      // ---- 1. 传输层：DNS/连接/超时失败 → 标记离线并抛错 ----
      let response: Response;
      try {
        const payload: JsonRpcRequest<TParams> = {
          jsonrpc: '2.0',
          id: ++this.requestId,
          method,
          params,
        };
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        this.raiseBackendLost(method, err);
      }

      // ---- 2. HTTP 层：非 2xx 视为服务不可用 → 报错并标记离线 ----
      if (!response.ok) {
        this.raiseBackendLost(method, new Error(`HTTP ${response.status} ${response.statusText}`));
      }

      // ---- 3. 解析层：响应不是合法 JSON-RPC → 报错并标记离线 ----
      let rpcRes: JsonRpcResponse<TResult>;
      try {
        rpcRes = await response.json();
      } catch (err) {
        this.raiseBackendLost(method, err);
      }

      // ---- 4. 业务层：后端已明确应答错误 → 冒泡给调用方，绝不静默返回假数据 ----
      if (rpcRes.error) {
        // 面向用户的叙述按当前语言渲染；后端英文原文仅作为技术细节进 console
        throw new Error(tError(rpcRes.error.code, rpcRes.error.message));
      }
      return rpcRes.result as TResult;
    }
  }

  // 对外便捷方法
  public async getDiagramData(): Promise<DiagramData> {
    const raw = await this.call<void, any>('straditize.getDiagramData');
    // 后端把取数区域与深度标定分两个键返回（`roi` / `calibration`），
    // 线掩膜修正笔迹在 `lineRemoval.corrections` —— 这里只做结构映射，
    // 不补任何默认值：缺字段就是缺字段，不能替后端编一个刻度出来。
    const data = raw as DiagramData & {
      lineRemoval?: { corrections?: LineMaskStroke[] };
      primaryRoiId?: string;
      activeRoiId?: string;
    };
    data.rois = data.rois ?? [];
    data.primary_roi_id = data.primary_roi_id ?? data.primaryRoiId ?? (data.rois[0]?.id || '');
    data.active_roi_id = data.active_roi_id ?? data.activeRoiId ?? (data.rois[0]?.id || '');
    data.line_candidates = data.line_candidates ?? [];
    data.selected_candidate_ids = data.selected_candidate_ids ?? [];
    data.line_strokes = data.line_strokes ?? [];
    data.exclusion_regions = data.exclusion_regions ?? [];
    data.samples = data.samples ?? [];

    const activeRoi = data.rois.find((r) => r.id === data.active_roi_id) || data.rois[0];
    if (activeRoi) {
      const x0 = activeRoi.xlim?.[0] ?? activeRoi.xMin ?? 0;
      const x1 = activeRoi.xlim?.[1] ?? activeRoi.xMax ?? 0;
      const y0 = activeRoi.ylim?.[0] ?? activeRoi.yMin ?? 0;
      const y1 = activeRoi.ylim?.[1] ?? activeRoi.yMax ?? 0;
      data.roi = {
        ...activeRoi,
        xMin: x0,
        xMax: x1,
        yMin: y0,
        yMax: y1,
      };
    } else {
      data.roi = data.roi ?? {
        id: '',
        name: 'pollen',
        name_source: 'default',
        composition: true,
        visible: true,
        xlim: [0, 0],
        ylim: [0, 0],
        columns_stale: false,
        form_defaults: null,
        xMin: 0,
        xMax: 0,
        yMin: 0,
        yMax: 0,
      };
    }
    data.calibration = data.calibration ?? {
      isCalibrated: false,
      top_px: null,
      top_cm: null,
      bottom_px: null,
      bottom_cm: null,
      unit: 'cm',
    };
    data.lineCorrections = data.lineRemoval?.corrections ?? [];
    this.currentDiagramData = data;
    return data;
  }

  /**
   * 把当前取数区域 (ROI) 推送给后端。
   *
   * 后端的分列、去线与数字化都以 ROI 为范围；不推送的话，用户在画布上拖框
   * 只会改前端显示，后端仍在旧范围上算（历史实现就是这样，直到 S2→S3 才对齐）。
   */
  public async updateRoi(roi: DataRoi): Promise<void> {
    await this.call('roi.update', {
      x0: Math.round(roi.xMin),
      x1: Math.round(roi.xMax),
      y0: Math.round(roi.yMin),
      y1: Math.round(roi.yMax),
    });
  }

  /**
   * 两点式 Y 轴标定：用户在画布上点选的两个参考点 + 其真实值。
   *
   * 返回后端建立的像素↔数值映射；前端据此填充 `data.calibration`。
   * 点序无所谓，后端会按像素 Y 排序。
   */
  public async calibrateDepthAxis(
    marks: Array<{ pixel: number; value: number }>,
    unit: string
  ): Promise<{ canvas: DepthCalibration }> {
    const res = await this.call<
      { y_marks: Array<{ pixel: number; val: number }>; unit: string },
      { status: string; y_scale: { slope: number; intercept: number } }
    >('core.calibrateAxes', {
      y_marks: marks.map((m) => ({ pixel: m.pixel, val: m.value })),
      unit,
    });
    if (!res?.y_scale) {
      throw new Error(tError(-32603, 'core.calibrateAxes returned no y_scale'));
    }
    const ordered = [...marks].sort((a, b) => a.pixel - b.pixel);
    return {
      canvas: {
        isCalibrated: true,
        top_px: ordered[0].pixel,
        top_cm: ordered[0].value,
        bottom_px: ordered[ordered.length - 1].pixel,
        bottom_cm: ordered[ordered.length - 1].value,
        unit,
      },
    };
  }

  /**
   * 在 ROI 内检测横/竖线并取回 QC 叠加掩膜。
   *
   * 后端是唯一事实源：B 键透视看到的就是数字化实际剔除的像素，
   * 前端不再自行实现一套"看起来像去线"的显示逻辑。
   *
   * `strength === 'off'` 也要走一次后端 —— 它会主动清掉会话里的旧掩膜；
   * 只在前端隐藏叠加层的话，关闭后的数字化仍在偷偷减掉那批像素。
   */
  public async applyLineRemoval(
    strength: 'off' | 'weak' | 'medium' | 'strong',
    corrections: LineMaskStroke[],
    removeVertical: boolean
  ): Promise<DegridResult | null> {
    const res = await this.call<
      { strength: string; corrections: LineMaskStroke[]; remove_vertical: boolean },
      DegridResult
    >('algorithm.degrid', { strength, corrections, remove_vertical: removeVertical });
    if (!res || typeof res.success !== 'boolean') {
      throw new Error(tError(-32603, 'algorithm.degrid returned an unexpected payload'));
    }
    if (strength !== 'off' && !res.overlay_png) {
      throw new Error(tError(-32603, 'algorithm.degrid returned no overlay_png'));
    }
    return res;
  }

  /**
   * 一键归零：同步清空后端会话的列、控制点、标尺标定与撤销栈。
   * 前端画布状态由 GeologyCanvas.resetAllOperations() 负责复位。
   */
  public async resetProjectState(): Promise<void> {
    // 前端镜像状态同步清空，确保后续 RPC 调用不会读到旧列
    this.currentDiagramData.columns = [];
    this.currentDiagramData.activeTaxaId = '';

    // 后端清空失败必须冒泡：否则前端显示"已归零"而后端仍保留旧列，
    // 后续所有 col_index 都会指向错误的数据。
    await this.call('project.new', {});
  }

  /**
   * 加载内置范例图谱
   */
  public async loadSampleDiagram(key: string): Promise<DiagramData> {
    // 内置范例只提供「输入」：后端解析内置图片并把会话切到该图；
    // 图片由后端 /image/current 提供给浏览器，前端不再自带示例图副本，
    // 分列与数字化结果一律由真实算法产生。
    const backendResult = await this.call<Record<string, unknown>, any>('core.loadImage', {
      sample_key: key,
    });
    this.applyLoadedImage(backendResult, this.imageUrl());
    return this.currentDiagramData;
  }

  /**
   * 依据后端 core.loadImage 的返回值重建前端状态。
   *
   * `core.loadImage` 只给几何 ROI 建议（`suggested_roi`）—— 图像几何只有后端掌握，
   * 前端不得自造。深度标定此时必然为空：它要等用户在 S4 亲手点两个 Y 轴参考点。
   */
  private applyLoadedImage(backendResult: any, imageSrc: string): void {
    const suggested = backendResult?.suggested_roi;
    if (!suggested) {
      throw new Error(tError(-32603, 'core.loadImage returned no suggested_roi'));
    }
    const rois = backendResult.rois ?? [];
    const primaryId = backendResult.primary_roi_id ?? (rois[0]?.id || 'roi_1');
    const activeId = backendResult.active_roi_id ?? (rois[0]?.id || 'roi_1');
    this.currentDiagramData = {
      imageSrc,
      imageWidth: backendResult.width ?? 0,
      imageHeight: backendResult.height ?? 0,
      rois,
      primary_roi_id: primaryId,
      active_roi_id: activeId,
      line_candidates: [],
      selected_candidate_ids: [],
      line_strokes: [],
      exclusion_regions: [],
      samples: [],
      roi: {
        id: activeId,
        name: 'pollen',
        name_source: 'default',
        composition: true,
        visible: true,
        xlim: [suggested.xMin, suggested.xMax],
        ylim: [suggested.yMin, suggested.yMax],
        columns_stale: false,
        form_defaults: null,
        xMin: suggested.xMin,
        xMax: suggested.xMax,
        yMin: suggested.yMin,
        yMax: suggested.yMax,
      },
      calibration: {
        isCalibrated: false,
        top_px: null,
        top_cm: null,
        bottom_px: null,
        bottom_cm: null,
        unit: 'cm',
      },
      lineCorrections: [],
      columns: [],
      activeTaxaId: '',
      selectedEntity: { type: 'roi' },
    };
  }

  /**
   * 用户打开或拖拽本地图片时，通知后端并生成/获取分列
   */
  public async loadCustomImage(
    imageSrc: string,
    width: number,
    height: number,
    fileName: string = 'Custom Diagram'
  ): Promise<DiagramData> {
    // 图像必须由后端真正载入成功才算数，且初始 ROI 建议由后端给出。
    // 历史实现在后端载图失败时沿用前端自造的建议布局继续工作，
    // 用户会在一个后端并不知情的图像/ROI 上继续操作。
    const isDataUrl = imageSrc.startsWith('data:');
    const payload: Record<string, unknown> = {
      file_name: fileName,
      width,
      height,
    };
    if (isDataUrl) {
      payload.image_data = imageSrc;
    } else {
      payload.image_path = imageSrc;
    }

    const backendResult = await this.call<Record<string, unknown>, any>('core.loadImage', payload);
    // 新载入图像：仅保留图谱元数据与后端建议 ROI，严禁自动切列或数字化，
    // 严格停在 S1 等待用户界定有效区。本地上传图沿用用户自己的 data URL 显示。
    this.applyLoadedImage(backendResult, imageSrc);
    return this.currentDiagramData;
  }

  /**
   * 步骤 2：用户在 Step 1 显式确认有效区 (ROI) 后，调用后端在纯数据区内进行垂直基线推导分列
   */
  public async detectColumnsInRoi(roi: DataRoi): Promise<Column[]> {
    this.currentDiagramData.roi = { ...roi };

    {
      // 参数名必须与后端 session.detect_columns(data_xlim, data_ylim) 一致。
      // 历史上前端发的是 x_bounds/y_bounds，后端一律回 INVALID_PARAMS，
      // 而静默兜底又把它换成"等分切割"结果，于是缺陷被掩盖了很久。
      const res = await this.call<{ data_xlim: [number, number]; data_ylim: [number, number] }, any[]>(
        'core.detectColumns',
        {
          data_xlim: [Math.round(roi.xMin), Math.round(roi.xMax)],
          data_ylim: [Math.round(roi.yMin), Math.round(roi.yMax)],
        }
      );

      if (Array.isArray(res) && res.length > 0) {
        const palette = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb7185', '#2dd4bf', '#818cf8'];
        const cols: Column[] = res.map((c, i) => {
          const colNum = String(i + 1).padStart(2, '0');
          const defaultName = `col${colNum}`;
          const colName = c.name || defaultName;
          return {
            id: `taxa_${c.col_index ?? i}`,
            name: colName,
            species: c.species || colName,
            color: palette[i % palette.length],
            startX: c.start,
            endX: c.end,
            maxPercent: 100,
            tickEndX: c.tickEndX || c.end,
            unit: '%',
            isLocked: false,
            curveType: 'linear',
            visible: true,
            controlPoints: [],
            scale_type: c.scale_type || 'linear',
            startValue: c.startValue || 0,
            tickValue: c.tickValue || 100,
            plotType: c.plot_type || 'area',
            hasExaggeration: c.has_exaggeration || false,
            exaggerationMult: c.exaggeration_multiplier || 5,
          };
        });
        this.currentDiagramData.columns = cols;
        this.currentDiagramData.activeTaxaId = cols[0]?.id || '';
        return cols;
      }
    }

    // 后端未返回任何列边界：如实报错。
    // 历史实现在此把 ROI 等分切割当作"识别出的分列边界"返回，用户确认 ROI 后
    // 即使后端失败也会看到"分列完成"，是典型的伪造科学结果。
    throw new Error(tError(-32603, 'core.detectColumns returned no column bounds'));
  }

  public async detectDeskew(): Promise<{ has_skew: boolean; suggested_rotation_angle: number }> {
    // 探测失败必须冒泡：返回 "没有倾斜" 会让用户以为已核查过，从而带着歪斜的图谱继续工作。
    const res = await this.call<void, { has_skew: boolean; suggested_rotation_angle: number }>('image.detectDeskew');
    if (!res || typeof res.has_skew !== 'boolean') {
      throw new Error(tError(-32603, 'image.detectDeskew returned an unexpected payload'));
    }
    return res;
  }

  /**
   * 获取当前词汇表概况：内置花粉 + 内置 NPP 条数，以及用户自定义条目。
   */
  public async getTaxaDict(): Promise<TaxaDictSummary> {
    const res = await this.call<void, TaxaDictSummary>('ocr.getTaxaDict');
    if (!res || !Array.isArray(res.custom)) {
      throw new Error(tError(-32603, 'ocr.getTaxaDict returned an unexpected payload'));
    }
    return res;
  }

  /**
   * 解析粘贴的词汇表文本（后端为唯一解析实现）。
   *
   * 支持三种形态：期刊图版说明（`a) Genus species; b) ...`，含硬换行与
   * `c), d)` 多键前缀）、`中文名,拉丁名[,分组]`、单列名称。
   */
  public async parseTaxaText(text: string): Promise<TaxaParseResult> {
    const res = await this.call<{ text: string }, TaxaParseResult>('ocr.parseTaxaText', { text });
    if (!res || !Array.isArray(res.entries)) {
      throw new Error(tError(-32603, 'ocr.parseTaxaText returned an unexpected payload'));
    }
    return res;
  }

  /**
   * 保存用户自定义属种词汇表（追加或覆盖）。
   *
   * 传 `rawText` 时由后端解析（图版说明也能直接贴），传 `entries` 时按结构写入。
   */
  public async saveCustomTaxa(
    payload: { rawText?: string; entries?: Array<{ zh_name?: string; latin_name?: string; group?: string }> },
    options: { mode?: 'append' | 'replace'; clear?: boolean } = {}
  ): Promise<TaxaSaveResult> {
    const res = await this.call<
      { entries?: unknown; raw_text?: string; mode: string; clear: boolean },
      TaxaSaveResult
    >('ocr.saveCustomTaxa', {
      entries: payload.entries,
      raw_text: payload.rawText,
      mode: options.mode || 'append',
      clear: options.clear ?? false,
    });
    // 前后端共用同一份词汇表。后端返回的 `entries` 是操作后的【全量】自定义集合，
    // 所以这里按 replace 重建：追加模式下等价于并集，覆盖/清空模式下才能真正
    // 删掉前端残留的旧条目（否则被后端清掉的词仍会被侧边栏"批量导入"纠出来）。
    const names = (res.entries || [])
      .map((e) => (e.latin || e.zh || '').trim())
      .filter(Boolean);
    PollenGlossary.setCustomTaxa(names, 'replace');
    return res;
  }

  /**
   * 拉取持久化的用户自定义词汇并注入前端纠错词典（会话启动时调用）。
   *
   * 同样按 replace 重建：启动时前端状态虽为初始态，但语义上后端才是权威。
   */
  public async syncCustomTaxaToGlossary(): Promise<number> {
    const summary = await this.getTaxaDict();
    const names = summary.custom
      .map((item) => (item.latin || item.zh || '').trim())
      .filter(Boolean);
    return PollenGlossary.setCustomTaxa(names, 'replace');
  }

  public async rotateImage(angle: number): Promise<{ success: boolean; width: number; height: number }> {
    // 旋转失败必须冒泡，否则调用方会以为图已转正、继续在错误朝向上标定。
    const res = await this.call<{ angle: number }, { success: boolean; width: number; height: number }>('image.rotate', { angle });
    if (!res || typeof res.success !== 'boolean') {
      throw new Error(tError(-32603, 'image.rotate returned an unexpected payload'));
    }
    return res;
  }

  public async updateControlPoint(
    colIndex: number,
    row: number,
    x: number,
    remove: boolean = false
  ): Promise<boolean> {
    const res = await this.call<{ col_index: number; row: number; x: number; remove?: boolean }>(
      'core.updateControlPoint',
      { col_index: colIndex, row, x, remove }
    );
    return !!res;
  }

  public async digitizeColumn(taxaId: string): Promise<ControlPoint[]> {
    const colIndex = this.currentDiagramData.columns.findIndex((c) => c.id === taxaId);
    const res = await this.call<{ col_index: number }, { points: ControlPoint[]; control_points?: ControlPoint[] }>('core.digitize', {
      col_index: Math.max(0, colIndex),
    });
    // 优先采用后端拓扑显著性抽稀后的关键控制拐点 (15~32 个波峰波谷)，严禁直接把几百个逐像素行点作为手柄
    if (res.control_points && res.control_points.length > 0) {
      return res.control_points;
    }
    // 如果只有全量 points，前端自动进行特征抽稀降噪至约 25 个控制点
    const rawPts = res.points || [];
    if (rawPts.length <= 35) return rawPts;
    return this.downsampleControlPoints(rawPts, 25);
  }

  private downsampleControlPoints(pts: ControlPoint[], targetCount: number = 25): ControlPoint[] {
    if (pts.length <= targetCount) return pts;
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const step = Math.floor(sorted.length / (targetCount - 1));
    const result: ControlPoint[] = [sorted[0]];
    for (let i = step; i < sorted.length - 1; i += step) {
      result.push(sorted[i]);
    }
    result.push(sorted[sorted.length - 1]);
    return result;
  }

  public async exportData(format: 'csv' | 'json' = 'csv'): Promise<string> {
    const res = await this.call<{ format: 'csv' | 'json'; strict: boolean }, string | { csv_content: string }>(
      'core.exportData',
      { format, strict: false }
    );
    if (typeof res === 'string') return res;
    if (res && 'csv_content' in res) return res.csv_content;
    // 严禁在前端自行合成导出内容：那会在后端导出失败时交给用户一份
    // "看起来正常"的 CSV，属于伪造科学结果。前端不再保留任何导出实现。
    throw new Error(tError(-32603, 'core.exportData returned an unexpected payload'));
  }

  // === 冻结契约 v1.3 多 ROI RPC 核心方法 ===
  public async roiCreate(params: { name?: string; x0?: number; x1?: number; y0?: number; y1?: number; composition?: boolean }): Promise<{ roi: DataRoi; rois_count: number }> {
    return this.call('roi.create', params);
  }

  public async roiUpdate(params: { roi_id?: string; name?: string; xlim?: [number, number]; ylim?: [number, number]; visible?: boolean; composition?: boolean; form_defaults?: any; columns_stale?: boolean; x0?: number; x1?: number; y0?: number; y1?: number }): Promise<{ roi: DataRoi }> {
    return this.call('roi.update', params);
  }

  public async roiRemove(roiId: string): Promise<{ success: boolean; removed_column_ids: string[] }> {
    return this.call('roi.remove', { roi_id: roiId });
  }

  public async roiList(): Promise<{ rois: DataRoi[]; primary_roi_id: string; active_roi_id: string }> {
    return this.call('roi.list', undefined);
  }

  public async roiSetActive(roiId: string): Promise<{ active_roi_id: string }> {
    return this.call('roi.setActive', { roi_id: roiId });
  }

  public async roiSetPrimary(roiId: string): Promise<{ primary_roi_id: string }> {
    return this.call('roi.setPrimary', { roi_id: roiId });
  }

  public async roiApplyFormDefaults(roiId: string): Promise<{ changed: any[]; count: number }> {
    return this.call('roi.applyFormDefaults', { roi_id: roiId });
  }

  public async detectColumns(roiId?: string): Promise<Column[]> {
    return this.call('algorithm.detectColumns', roiId ? { roi_id: roiId } : undefined);
  }

  public async updateColumn(colIndex: number, updates: Partial<Column>): Promise<{ column: Column }> {
    return this.call('column.update', { col_index: colIndex, updates });
  }
}
