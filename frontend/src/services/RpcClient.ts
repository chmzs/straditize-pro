import { BackendStatus, JsonRpcRequest, JsonRpcResponse } from '../types/rpc';
import { tError } from '../i18n/errorCodes';
import { t } from '../i18n';
import { Column, ControlPoint, DiagramData } from '../types/pollen';
import { MockBackend } from './MockBackend';
import { SplineInterpolator } from '../core/SplineInterpolator';

/** 演示模式不支持的方法：这些方法会产出被当作科学结果的数据，绝不允许用示例数据替代 */
const DEMO_FORBIDDEN_METHODS = new Set<string>([
  'core.digitize',
  'core.exportData',
  'ocr.recognizeLabels',
  'ocr.applyLabels',
  'core.updateControlPoint',
]);

export class RpcClient {
  private endpoint: string;
  /**
   * 后端是否可达。只由 probeBackend() 与 call() 的传输结果维护。
   * 为 false 时一律抛错，绝不返回替代数据。
   */
  private backendOnline: boolean = false;
  /**
   * 用户是否【显式】进入演示模式。这是唯一允许使用内置示例数据的场景。
   * 严禁因为后端出错而自动置位 —— 那正是历史上产出虚假数据的根源。
   */
  private demoMode: boolean = false;
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
    this.currentDiagramData = MockBackend.createDefaultDiagramData();
  }

  public setStatusCallback(callback: (status: BackendStatus) => void): void {
    this.statusListeners.push(callback);
    callback(this.getStatus());
  }

  public getStatus(): BackendStatus {
    return {
      connected: this.backendOnline,
      isMock: this.demoMode,
      endpoint: this.endpoint,
      latencyMs: this.backendOnline ? 5 : 0,
      isDesktopMode: this.isDesktopMode,
    };
  }

  /** 演示模式：显式开关，仅用于界面预览，禁止产出任何被当作结果的数据 */
  public isDemoMode(): boolean {
    return this.demoMode;
  }

  public setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    this.notifyStatus();
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
    // === 路径 A：演示模式（用户显式进入）===
    // 仅允许界面预览类方法；会产出"看起来像科学结果"的方法一律拒绝，
    // 避免演示数据被误当成真实分析结果。
    if (this.demoMode) {
      if (DEMO_FORBIDDEN_METHODS.has(method)) {
        throw new Error(t('error.demoUnsupported'));
      }
      return this.mockExecute<TParams, TResult>(method, params);
    }

    // === 路径 B：未连接后端 —— 直接报错，绝不返回替代数据 ===
    if (!this.backendOnline) {
      this.raiseBackendLost(method, new Error('backend not probed / offline'));
    }

    // === 路径 C：真实后端 ===
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

  private async mockExecute<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    await new Promise((resolve) => setTimeout(resolve, 25));

    switch (method) {
      case 'core.loadImage': {
        const p = params as { image_path?: string; image_data?: string; sample_key?: string } | undefined;
        if (p?.sample_key) {
          this.currentDiagramData = MockBackend.getSampleDiagram(p.sample_key);
        }
        return JSON.parse(JSON.stringify(this.currentDiagramData)) as TResult;
      }

      case 'straditize.getDiagramData': {
        return JSON.parse(JSON.stringify(this.currentDiagramData)) as TResult;
      }

      case 'core.updateControlPoint': {
        const p = params as { col_index: number; row: number; x: number; remove?: boolean };
        const col = this.currentDiagramData.columns[p.col_index];
        if (col) {
          if (p.remove) {
            col.controlPoints = col.controlPoints.filter((pt) => Math.abs(pt.y - p.row) > 6);
          } else {
            const existing = col.controlPoints.find((pt) => Math.abs(pt.y - p.row) <= 4);
            if (existing) {
              existing.x = p.x;
              existing.y = p.row;
              existing.isManual = true;
            } else {
              col.controlPoints.push({
                id: `pt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                x: p.x,
                y: p.row,
                type: 'manual',
                isManual: true,
                createdAt: Date.now(),
              });
              col.controlPoints.sort((a, b) => a.y - b.y);
            }
          }
          return {
            col_index: p.col_index,
            action: p.remove ? 'removed' : 'updated',
            points: col.controlPoints,
          } as TResult;
        }
        return true as TResult;
      }

      case 'core.digitize': {
        const p = params as { col_index: number };
        const col = this.currentDiagramData.columns[p.col_index];
        if (col) {
          col.controlPoints.forEach((pt) => {
            if (!pt.isManual) {
              pt.x += (Math.random() - 0.5) * 4;
            }
          });
          return {
            col_index: p.col_index,
            points: col.controlPoints,
          } as TResult;
        }
        return { points: [] } as TResult;
      }

      case 'core.exportData': {
        const p = params as { format: 'csv' | 'json' };
        return this.generateExportData(p?.format || 'csv') as TResult;
      }

      case 'ocr.recognizeLabels': {
        const sampleTaxa = [
          'Pinus', 'Betula', 'Quercus ilex-type', 'Quercus suber-type', 'Olea',
          'Corylus', 'Artemisia', 'Chenopodiaceae', 'Poaceae', 'Abies', 'Picea',
          'Alnus', 'Ulmus', 'Salix', 'Ericaceae', 'Cyperaceae'
        ];
        const cols = this.currentDiagramData.columns || [];
        const labels = cols.map((col, idx) => {
          const matchedName = sampleTaxa[idx % sampleTaxa.length];
          return {
            id: `ocr_label_${idx + 1}`,
            ocr_text: matchedName,
            suggested_name: matchedName,
            group: idx < 6 ? '乔木花粉 (AP)' : '草本与灌木花粉 (NAP)',
            status: 'auto',
            accepted: true,
            anchor_x: col.startX,
            anchor_y: 280,
            associated_column_id: col.id,
            associated_column_index: idx,
            associated_column_name: col.name,
          };
        });
        return {
          success: true,
          data: {
            labels,
            label_row_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            summary: {
              total: labels.length,
              auto: labels.length,
              confirm: 0,
              unrecognized: 0,
            },
          },
        } as TResult;
      }

      case 'ocr.applyLabels': {
        const p = params as { confirmed_labels: Array<{ associated_column_id: string; suggested_name: string }> };
        let count = 0;
        if (p?.confirmed_labels && Array.isArray(p.confirmed_labels)) {
          p.confirmed_labels.forEach((item) => {
            const col = this.currentDiagramData.columns.find((c) => c.id === item.associated_column_id || c.name === item.associated_column_id);
            if (col && item.suggested_name) {
              col.name = item.suggested_name;
              col.species = item.suggested_name;
              count++;
            }
          });
        }
        return {
          success: true,
          applied_count: count,
          columns_count: this.currentDiagramData.columns.length,
        } as TResult;
      }

      default:
        return true as TResult;
    }
  }

  // 对外便捷方法
  public async getDiagramData(): Promise<DiagramData> {
    return this.call<void, DiagramData>('straditize.getDiagramData');
  }

  /**
   * 一键归零：同步清空后端会话的列、控制点、标尺标定与撤销栈。
   * 前端画布状态由 GeologyCanvas.resetAllOperations() 负责复位。
   */
  public async resetProjectState(): Promise<void> {
    // 前端镜像状态同步清空，确保后续 RPC 调用不会读到旧列
    this.currentDiagramData.columns = [];
    this.currentDiagramData.activeTaxaId = '';

    if (this.demoMode) return;
    // 后端清空失败必须冒泡：否则前端显示"已归零"而后端仍保留旧列，
    // 后续所有 col_index 都会指向错误的数据。
    await this.call('project.new', {});
  }

  /**
   * 加载内置范例图谱
   */
  public async loadSampleDiagram(key: string): Promise<DiagramData> {
    // 内置范例是"内置输入"，但分列/数字化结果必须由后端真实计算得出。
    // 历史实现直接把前端写死的 29 列夹具当作结果展示，与后端会话状态分歧
    // （后端 columns 为空，前端却显示 29 列），用户会误以为看到了算法能力。
    let imageSrc = '';
    if (this.demoMode) {
      imageSrc = MockBackend.getSampleDiagram(key).imageSrc;
    }

    const backendResult = await this.call<Record<string, unknown>, any>('core.loadImage', {
      sample_key: key,
      ...(imageSrc ? { image_path: imageSrc } : {}),
    });

    this.currentDiagramData.columns = [];
    this.currentDiagramData.activeTaxaId = '';
    this.currentDiagramData.calibration = {
      ...this.currentDiagramData.calibration,
      isCalibrated: false,
    };
    if (backendResult && backendResult.width && backendResult.height) {
      this.currentDiagramData.imageWidth = backendResult.width;
      this.currentDiagramData.imageHeight = backendResult.height;
    }
    return this.currentDiagramData;
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
    // 前端只提供"初始建议 ROI"作为起始值，但图像必须由后端真正载入成功才算数。
    // 历史实现在后端载图失败时仍沿用前端建议布局继续工作，用户会在一个后端
    // 并不知情的图像/ROI 上继续操作。
    this.currentDiagramData = MockBackend.createInitialSuggestion(width, height, imageSrc, fileName);

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
    // 新载入图像只保留图谱元数据与居中 ROI，严禁自动盲目切列或数字化，严格进入 Step 1 等待用户界定有效区
    this.currentDiagramData.columns = [];
    this.currentDiagramData.activeTaxaId = '';
    if (backendResult && backendResult.width && backendResult.height) {
      this.currentDiagramData.imageWidth = backendResult.width;
      this.currentDiagramData.imageHeight = backendResult.height;
    }

    return this.currentDiagramData;
  }

  /**
   * 步骤 2：用户在 Step 1 显式确认有效区 (ROI) 后，调用后端在纯数据区内进行垂直基线推导分列
   */
  public async detectColumnsInRoi(roi: { x0: number; x1: number; y0: number; y1: number }): Promise<Column[]> {
    this.currentDiagramData.calibration.dataXMin = roi.x0;
    this.currentDiagramData.calibration.dataXMax = roi.x1;
    this.currentDiagramData.calibration.dataYMin = roi.y0;
    this.currentDiagramData.calibration.dataYMax = roi.y1;

    {
      // 参数名必须与后端 session.detect_columns(data_xlim, data_ylim) 一致。
      // 历史上前端发的是 x_bounds/y_bounds，后端一律回 INVALID_PARAMS，
      // 而静默兜底又把它换成"等分切割"结果，于是缺陷被掩盖了很久。
      const res = await this.call<{ data_xlim: [number, number]; data_ylim: [number, number] }, any[]>(
        'core.detectColumns',
        {
          data_xlim: [roi.x0, roi.x1],
          data_ylim: [roi.y0, roi.y1],
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
    // 严禁回落到前端自算的 generateExportData()：那会在后端导出失败时
    // 交给用户一份"看起来正常"的 CSV，属于伪造科学结果。
    throw new Error(tError(-32603, 'core.exportData returned an unexpected payload'));
  }

  public generateExportData(format: 'csv' | 'json'): string {
    const data = this.currentDiagramData;
    const { unit } = data.calibration;
    const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(data.calibration);
    const visibleColumns = data.columns.filter((c) => c.visible);

    if (format === 'json') {
      const exportObj = {
        meta: {
          exportTime: new Date().toISOString(),
          calibration: data.calibration,
          totalHorizons: depths.length,
          depthInterval: data.calibration.depthInterval || 2,
          unit,
        },
        horizons: depths.map((d, i) => {
          const y = yPositions[i];
          const values: Record<string, number> = {};
          visibleColumns.forEach((col) => {
            values[col.name] = SplineInterpolator.interpolatePercentAtY(col, y);
          });
          return {
            depth: d,
            unit,
            y_px: y,
            values,
          };
        }),
        taxaColumns: data.columns.map((c) => ({
          name: c.name,
          color: c.color,
          startX: c.startX,
          endX: c.endX,
          maxPercent: c.maxPercent,
          curveType: c.curveType,
          visible: c.visible,
          controlPointsCount: c.controlPoints.length,
        })),
      };
      return JSON.stringify(exportObj, null, 2);
    }

    // CSV 格式：严格按固定的标准深度层位输出，杜绝任何属种间层位错位
    const headers = [`Depth (${unit})`, ...visibleColumns.map((c) => `"${c.name} (%)"`)];
    const rows: string[] = [headers.join(',')];

    for (let i = 0; i < depths.length; i++) {
      const depth = depths[i];
      const y = yPositions[i];
      const rowValues: (string | number)[] = [depth.toFixed(2)];

      visibleColumns.forEach((col) => {
        const percent = SplineInterpolator.interpolatePercentAtY(col, y);
        rowValues.push(percent.toFixed(2));
      });

      rows.push(rowValues.join(','));
    }

    return rows.join('\n');
  }
}
