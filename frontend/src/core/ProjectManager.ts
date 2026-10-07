import { Column, ControlPoint, DataRoi, DiagramCalibration, DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { SplineInterpolator } from './SplineInterpolator';
import { CoordinateSystem } from './CoordinateSystem';
import { TarArchive } from './TarArchive';

export interface ProjectManagerCallbacks {
  onProjectLoad?: (projectData: DiagramData) => void;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize))
    );
  }
  return btoa(binary);
}

export function normalizeProject(
  parsed: any,
  imageBlobUrl: string | null,
  fallbackData?: DiagramData
): DiagramData | null {
  const rawCal = parsed.depth_calibration || parsed.calibration;
  const rawRoi = parsed.roi;
  const rawCols = parsed.columns;
  if (!rawCols || !Array.isArray(rawCols) || (!rawCal && !rawRoi)) {
    return null;
  }

  // ROI 与深度标定各读各的键。不使用互相兜底，确保深度不被错误推断。
  const normalizedRoi: DataRoi = rawRoi
    ? 'w' in rawRoi
      ? {
          xMin: rawRoi.x ?? 0,
          yMin: rawRoi.y ?? 0,
          xMax: (rawRoi.x ?? 0) + (rawRoi.w ?? 0),
          yMax: (rawRoi.y ?? 0) + (rawRoi.h ?? 0),
        }
      : {
          xMin: rawRoi.xMin ?? 0,
          xMax: rawRoi.xMax ?? 0,
          yMin: rawRoi.yMin ?? 0,
          yMax: rawRoi.yMax ?? 0,
        }
    : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };

  const cal = rawCal || {};
  const hasBothMarks =
    cal.top_px != null && cal.bottom_px != null && cal.top_cm != null && cal.bottom_cm != null;
  const normalizedCal: DiagramCalibration = {
    isCalibrated: hasBothMarks && (cal.is_calibrated ?? cal.isCalibrated ?? true),
    top_px: cal.top_px ?? null,
    top_cm: cal.top_cm ?? null,
    bottom_px: cal.bottom_px ?? null,
    bottom_cm: cal.bottom_cm ?? null,
    unit: cal.unit || 'cm',
    depthInterval: cal.depthInterval ?? cal.depth_interval ?? 2,
    depthGridEnabled: cal.depthGridEnabled ?? cal.depth_grid_enabled ?? true,
    customDepths: cal.customDepths ?? cal.custom_depths ?? [],
  };

  const normalizedCols = rawCols.map((c: any, idx: number) => {
    const name = c.name || c.species || `Col ${idx + 1}`;
    const startX = c.startX ?? (c.start ?? 0);
    const tickEndX = c.tickEndX ?? (c.scaleCalib?.calibX ?? c.endX ?? c.end ?? startX + 50);
    const endX = c.endX ?? (c.end ?? tickEndX);
    const startVal = c.startValue ?? (c.scaleCalib?.originVal ?? 0);
    const tickVal = c.tickValue ?? (c.scaleCalib?.calibVal ?? c.maxPercent ?? 100);
    const rawPts = c.controlPoints || c.points || [];

    const pts: ControlPoint[] = rawPts.map((p: any, pIdx: number) => ({
      id: p.id || `pt_${idx}_${pIdx}`,
      x: p.x,
      y: p.y,
      value: p.value,
      kind: p.kind || (p.type === 'manual' || p.isManual ? 'manual' : 'peak'),
      valid_segment: p.valid_segment ?? true,
      isManual: p.kind === 'manual' || p.isManual || false,
      type: p.kind || p.type || 'peak',
      createdAt: p.createdAt || Date.now(),
    }));

    const xTicks =
      c.x_ticks && Array.isArray(c.x_ticks) && c.x_ticks.length === 2
        ? c.x_ticks
        : null;

    const exagMult =
      c.exaggeration_mult ?? (c.has_exaggeration && c.exaggeration_multiplier ? c.exaggeration_multiplier : c.exaggerationMult);

    return {
      id: c.id || `col_${idx}`,
      col_index: c.col_index ?? idx,
      roi_id: c.roi_id,
      x_group_id: c.x_group_id,
      x_values: c.x_values,
      name,
      species: name,
      color: c.color || '#38bdf8',
      startX,
      endX,
      maxPercent: tickVal,
      tickEndX,
      unit: c.unit || '%',
      isLocked: c.isLocked || false,
      curveType: c.curveType || 'linear',
      visible: c.visible !== false,
      scale_type: c.scale_type || 'linear',
      plot_type: c.plot_type || c.plotType || 'area',
      plotType: c.plot_type || c.plotType || 'area',
      exaggeration_mult: exagMult,
      hasExaggeration: exagMult != null && exagMult > 1,
      exaggerationMult: exagMult,
      x_ticks: xTicks,
      startValue: startVal,
      tickValue: tickVal,
      controlPoints: pts,
      points: pts,
      scaleCalib: c.scaleCalib || {
        originX: startX,
        originVal: startVal,
        calibX: tickEndX,
        calibVal: tickVal,
        unit: c.unit || '%',
      },
    };
  });

  // 如果 JSON 内嵌了 base64 图片且没有从 tar 解压出外部 blob，优先使用内嵌图片（自包含）
  const resolvedImageSrc =
    imageBlobUrl ||
    (parsed.image?.base64 ? `data:image/png;base64,${parsed.image.base64}` : null) ||
    parsed.image?.src ||
    parsed.imageSrc ||
    fallbackData?.imageSrc ||
    '';

  return {
    imageSrc: resolvedImageSrc,
    imageWidth: parsed.image?.width || parsed.imageWidth || fallbackData?.imageWidth || 0,
    imageHeight: parsed.image?.height || parsed.imageHeight || fallbackData?.imageHeight || 0,
    rois: parsed.rois || (normalizedRoi ? [normalizedRoi] : []),
    primary_roi_id: parsed.primary_roi_id || 'roi_1',
    active_roi_id: parsed.active_roi_id || 'roi_1',
    roi: normalizedRoi,
    calibration: normalizedCal,
    line_candidates: parsed.line_candidates || [],
    selected_candidate_ids: parsed.selected_candidate_ids || [],
    line_strokes: parsed.line_strokes || [],
    exclusion_regions: parsed.exclusion_regions || [],
    samples: parsed.samples || [],
    columns: normalizedCols,
    activeTaxaId: parsed.activeTaxaId || normalizedCols[0]?.id || '',
    selectedEntity: null,
  };
}

/**
 * 工程文件核心管理服务 (非 UI 服务)
 * 职责：
 * 1. saveProjectFile: 打包导出为开放标准 .tar 归档 (POSIX UStar)
 * 2. openProjectFile: 读取并解析已有的 .tar 或 .json 科学项目归档并还原前后端状态
 * 3. generateStandardCsv: 生成符合地学标准的无 NA 丰度表 CSV
 * 4. generateRScript: 生成符合 rioja::strat.plot 规范的可复现绘图 R 脚本
 */
export class ProjectManager {
  private data: DiagramData;
  private rpcClient: RpcClient;
  private onProjectLoad?: (projectData: DiagramData) => void;

  constructor(
    data: DiagramData,
    rpcClient: RpcClient,
    onProjectLoad?: (projectData: DiagramData) => void
  ) {
    this.data = data;
    this.rpcClient = rpcClient;
    this.onProjectLoad = onProjectLoad;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
  }

  /**
   * 项目化保存为开放标准 .tar 归档 (POSIX UStar)
   * 优先直连后端 T10 权威 export.tar 多 ROI 导出；
   * 包含 manifest.json, image/original.png, straditize.json, data.csv, data/<roi>.csv, plot_strat.R, README.txt
   */
  public async saveProjectFile(): Promise<void> {
    try {
      const res = await this.rpcClient.call<any, any>('export.tar');
      if (res && (res.tar_base64 || res.data)) {
        const b64 = res.tar_base64 || (typeof res.data === 'string' ? res.data : '');
        if (b64) {
          const byteCharacters = atob(b64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/x-tar' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `straditize_project_${Date.now()}.tar`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
      }
      throw new Error('export.tar 返回的数据不合法');
    } catch (err: any) {
      console.error('后端 export.tar 导出失败:', err);
      alert('❌ 科学项目包 (.tar) 导出失败：' + (err.message || err));
    }
  }

  /**
   * 生成地学标准 CSV 表格 (首列深度，未观察属种严格输出 0.0)
   */
  public generateStandardCsv(): string {
    const cal = this.data.calibration;
    const visibleCols = this.data.columns.filter((c) => c.visible);
    const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal);
    const headers = [`Depth_${cal.unit || 'cm'}`, ...visibleCols.map((c) => `"${c.name}"`)];
    const rows: string[] = [headers.join(',')];

    for (let i = 0; i < depths.length; i++) {
      const d = depths[i];
      const y = yPositions[i];
      const rowVals: string[] = [d.toFixed(2)];
      for (const col of visibleCols) {
        let v = SplineInterpolator.interpolatePercentAtY(col, y);
        if (v !== undefined && !isNaN(v)) {
          // 统一经 CoordinateSystem.resolveColumnScale 读取放大倍数（兼容 exaggeration_mult 与 legacy 字段）
          const scale = CoordinateSystem.resolveColumnScale(col);
          if (scale.exaggerationMult && scale.exaggerationMult > 1) {
            v = v / scale.exaggerationMult;
          }
          rowVals.push(v.toFixed(2));
        } else {
          rowVals.push('0.00');
        }
      }
      rows.push(rowVals.join(','));
    }
    return rows.join('\n');
  }

  /**
   * 生成针对当前图谱与属种列的 R 语言绘图脚本 (基于 rioja::strat.plot)
   */
  public static generateRScript(columns: Column[], unit: string = 'cm'): string {
    const visibleCols = columns.filter((c) => c.visible);
    const polyVec = visibleCols.map((c) => (c.plotType === 'bar' || c.plotType === 'line' || c.plotType === 'symbol' ? 'FALSE' : 'TRUE')).join(', ');
    const barVec = visibleCols.map((c) => (c.plotType === 'bar' ? 'TRUE' : 'FALSE')).join(', ');
    const lineVec = visibleCols.map((c) => (c.plotType === 'line' ? 'TRUE' : 'FALSE')).join(', ');
    const hasAnyExag = visibleCols.some((c) => c.hasExaggeration);
    const maxExagMult = Math.max(5, ...visibleCols.filter((c) => c.hasExaggeration).map((c) => c.exaggerationMult || 5));
    const exagVec = visibleCols.map((c) => (c.hasExaggeration ? 'TRUE' : 'FALSE')).join(', ');

    const exagParam = hasAnyExag
      ? `  exag = plot_exag,\n  exag.mult = ${maxExagMult},\n  col.exag = "auto",\n  exag.alpha = 0.5,\n`
      : '';

    return `# ==============================================================================
# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script
# Generated automatically by Straditize v2.0 (straditize pro)
# Requires R package 'rioja' (install.packages("rioja"))
# ==============================================================================

if (!requireNamespace("rioja", quietly = TRUE)) {
  message("Installing required package 'rioja' from CRAN...")
  install.packages("rioja", repos = "https://cloud.r-project.org")
}
library(rioja)

# 1. Locate and load exported stratigraphic CSV table
data_file <- "data.csv"
if (!file.exists(data_file)) {
  csv_candidates <- list.files(pattern = "\\\\.csv$", full.names = TRUE)
  if (length(csv_candidates) > 0) {
    data_file <- csv_candidates[1]
  } else {
    stop("Cannot find data.csv in current directory.")
  }
}

message("Loading stratigraphic dataset from: ", data_file)
df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)

# Extract depth horizon (first column) and taxa abundance matrix
depth <- df[[1]]
taxa_data <- df[, -1, drop = FALSE]

# Ensure matrix is strictly numeric, replace any residual NAs with 0
taxa_matrix <- as.matrix(sapply(taxa_data, as.numeric))
taxa_matrix[is.na(taxa_matrix)] <- 0

# 2. Configure per-column plot styles based on user selections in Straditize Pro
plot_poly <- c(${polyVec})
plot_bar  <- c(${barVec})
plot_line <- c(${lineVec})
${hasAnyExag ? `plot_exag <- c(${exagVec})` : ''}

# 3. Render stratigraphic plot using rioja::strat.plot
message("Rendering stratigraphic pollen profile...")
strat.plot(
  d = taxa_matrix,
  yvar = depth,
  y.rev = TRUE,             # Depth increases downwards (standard geological convention)
  ylabel = paste0("Depth (", "${unit}", ")"),
  plot.poly = plot_poly,    # Silhouette area fill
  plot.line = plot_line,    # Pure line curves
  plot.bar = plot_bar,      # Discrete horizontal bars
  col.poly = "grey35",
  col.line = "black",
  lwd.line = 1.0,
  scale.percent = TRUE,     # Percentage scale labels
${exagParam}  xRight = 0.95,
  yTop = 0.88,
  title = "Stratigraphic Pollen Diagram (Straditize Pro)"
)

message("Finished! Stratigraphic plot generated successfully.")
`;
  }

  public generateRScript(columns?: Column[], unit?: string): string {
    return ProjectManager.generateRScript(
      columns || this.data.columns,
      unit || this.data.calibration.unit || 'cm'
    );
  }

  /**
   * 打开已有项目 (支持标准 .tar 归档 / .json)
   */
  public openProjectFile(file: File): void {
    const isTar =
      file.name.toLowerCase().endsWith('.tar') ||
      file.name.toLowerCase().endsWith('.tar.gz') ||
      file.type.includes('tar');

    if (isTar) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const buf = e.target?.result as ArrayBuffer;
          if (!buf) return;

          const entries = TarArchive.extract(buf);
          if (entries.length === 0) {
            alert('读取 .tar 归档失败：未找到有效的文件块。');
            return;
          }

          let jsonContent: string | null = null;
          let imageBlobUrl: string | null = null;
          let mainImgEntry: Uint8Array | null = null;
          let adImgEntry: Uint8Array | null = null;

          for (const entry of entries) {
            const nl = entry.name.toLowerCase();
            if (
              nl.endsWith('straditize.json') ||
              nl.endsWith('wpd.json') ||
              (nl.endsWith('.json') && !nl.includes('manifest.json') && !nl.includes('info.json'))
            ) {
              jsonContent = new TextDecoder().decode(entry.data);
            } else if (nl.includes('age_depth') && (nl.endsWith('.png') || nl.endsWith('.jpg') || nl.endsWith('.jpeg'))) {
              adImgEntry = entry.data;
            } else if (
              nl.endsWith('.png') ||
              nl.endsWith('.jpg') ||
              nl.endsWith('.jpeg') ||
              nl.endsWith('.webp')
            ) {
              mainImgEntry = entry.data;
              const mime = nl.endsWith('.jpg') || nl.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
              const imgBlob = new Blob([entry.data as unknown as BlobPart], { type: mime });
              imageBlobUrl = URL.createObjectURL(imgBlob);
            }
          }

          if (jsonContent) {
            const parsed = JSON.parse(jsonContent);
            // 将内嵌的底图与年代深度图一并同步至后端会话，保证前后端权威状态一致
            if (mainImgEntry) {
              parsed.image = parsed.image || {};
              parsed.image.base64 = uint8ToBase64(mainImgEntry);
            }
            if (adImgEntry) {
              parsed.age_depth = parsed.age_depth || {};
              parsed.age_depth.image_base64 = uint8ToBase64(adImgEntry);
            }
            try {
              await this.rpcClient.call('project.load', { project_data: parsed });
            } catch {
              // 离线模式忽略
            }

            const projectData = normalizeProject(parsed, imageBlobUrl, this.data);
            if (projectData) {
              if (this.onProjectLoad) {
                this.onProjectLoad(projectData);
              }
            } else {
              alert('解包成功，但未在 JSON 中找到合法的 columns 或 calibration 字段。');
            }
          } else {
            alert('未在 .tar 归档中找到项目数据 JSON 文件。');
          }
        } catch (err) {
          alert('解析 .tar 归档失败：' + (err as Error).message);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // 普通 JSON 文件读取
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const parsed = JSON.parse(text);
        try {
          await this.rpcClient.call('project.load', { project_data: parsed });
        } catch {
          // 离线模式忽略
        }
        const projectData = normalizeProject(parsed, null, this.data);
        if (projectData) {
          if (this.onProjectLoad) {
            this.onProjectLoad(projectData);
          }
        } else {
          alert('项目文件格式不匹配：未找到有效的 columns 或 calibration 配置。');
        }
      } catch (err) {
        alert('读取项目文件失败：无效的 JSON 格式。');
      }
    };
    reader.readAsText(file, 'utf-8');
  }
}
