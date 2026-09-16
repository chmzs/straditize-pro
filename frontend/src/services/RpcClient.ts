import { BackendStatus, JsonRpcRequest, JsonRpcResponse } from '../types/rpc';
import { Column, ControlPoint, DiagramData } from '../types/pollen';
import { MockBackend } from './MockBackend';
import { SplineInterpolator } from '../core/SplineInterpolator';

export class RpcClient {
  private endpoint: string;
  private isMock: boolean = true;
  private isDesktopMode: boolean = false;
  private requestId: number = 1;
  private currentDiagramData: DiagramData;
  private onStatusChange: ((status: BackendStatus) => void) | null = null;

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
    this.onStatusChange = callback;
  }

  public getStatus(): BackendStatus {
    return {
      connected: !this.isMock,
      isMock: this.isMock,
      endpoint: this.endpoint,
      latencyMs: this.isMock ? 0 : 5,
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
            this.isMock = false;
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

    this.isMock = true;
    this.notifyStatus();
    return this.getStatus();
  }

  private notifyStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }

  /**
   * 通用 JSON-RPC 2.0 请求方法
   */
  public async call<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams
  ): Promise<TResult> {
    if (!this.isMock) {
      try {
        const payload: JsonRpcRequest<TParams> = {
          jsonrpc: '2.0',
          id: ++this.requestId,
          method,
          params,
        };

        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const rpcRes: JsonRpcResponse<TResult> = await response.json();
          if (rpcRes.error) {
            throw new Error(`RPC Error [${rpcRes.error.code}]: ${rpcRes.error.message}`);
          }
          return rpcRes.result as TResult;
        }
      } catch (err) {
        console.warn(`Backend RPC call ${method} failed, falling back to Mock:`, err);
        this.isMock = true;
        this.notifyStatus();
      }
    }

    return this.mockExecute<TParams, TResult>(method, params);
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

      default:
        return true as TResult;
    }
  }

  // 对外便捷方法
  public async getDiagramData(): Promise<DiagramData> {
    return this.call<void, DiagramData>('straditize.getDiagramData');
  }

  /**
   * 加载内置范例图谱
   */
  public async loadSampleDiagram(key: string): Promise<DiagramData> {
    const sampleData = MockBackend.getSampleDiagram(key);
    this.currentDiagramData = JSON.parse(JSON.stringify(sampleData));

    if (!this.isMock) {
      try {
        await this.call('core.loadImage', {
          sample_key: key,
          image_path: sampleData.imageSrc,
        });
      } catch (e) {
        console.warn('Backend load sample sync failed:', e);
      }
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
    const initial = MockBackend.createInitialSuggestion(width, height, imageSrc, fileName);
    this.currentDiagramData = initial;

    if (!this.isMock) {
      try {
        // 如果数据过大，传前缀或文件标头
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
      } catch (err) {
        console.warn('Backend loadImage notification failed, using client suggested layout:', err);
      }
    }

    return this.currentDiagramData;
  }

  /**
   * 步骤 2：用户在 Step 1 显式确认有效区 (ROI) 后，调用后端在纯数据区内进行垂直基线推导分列
   */
  public async detectColumnsInRoi(roi: { x0: number; x1: number; y0: number; y1: number }): Promise<Column[]> {
    if (this.isMock) {
      const cal = this.currentDiagramData.calibration;
      cal.dataXMin = roi.x0;
      cal.dataXMax = roi.x1;
      cal.dataYMin = roi.y0;
      cal.dataYMax = roi.y1;
      const cols = MockBackend.createColumnsFromRoi(cal);
      this.currentDiagramData.columns = cols;
      this.currentDiagramData.activeTaxaId = cols[0]?.id || '';
      return cols;
    }

    try {
      const res = await this.call<{ x_bounds: [number, number]; y_bounds: [number, number] }, any[]>('core.detectColumns', {
        x_bounds: [roi.x0, roi.x1],
        y_bounds: [roi.y0, roi.y1],
      });

      if (Array.isArray(res) && res.length > 0) {
        const palette = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb7185', '#2dd4bf', '#818cf8'];
        const cols: Column[] = res.map((c, i) => ({
          id: `taxa_${c.col_index ?? i}`,
          name: c.name || `Taxon ${i + 1}`,
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
        }));
        this.currentDiagramData.columns = cols;
        this.currentDiagramData.activeTaxaId = cols[0]?.id || '';
        return cols;
      }
    } catch (e) {
      console.warn('Backend detectColumns failed, fallback to ROI split:', e);
    }

    const fallbackCols = MockBackend.createColumnsFromRoi(this.currentDiagramData.calibration);
    this.currentDiagramData.columns = fallbackCols;
    this.currentDiagramData.activeTaxaId = fallbackCols[0]?.id || '';
    return fallbackCols;
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
    return this.generateExportData(format);
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
