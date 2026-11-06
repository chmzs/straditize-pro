import { Column, ControlPoint, DataRoi, DiagramCalibration, DiagramData, LEGACY_FULL_SCALE } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import { SplineInterpolator } from './SplineInterpolator';
import { CoordinateSystem } from './CoordinateSystem';
import { TarArchive } from './TarArchive';
import { notifyError } from '../ui/feedback';

export interface ProjectManagerCallbacks {
  onProjectLoad?: (projectData: DiagramData) => void;
}

/**
 * 把前端自动存档草稿（`DiagramData` 形状）翻译成后端 `project.load` 认的
 * 工程包载荷（`straditize.json` / `project_save` 的形状）。
 *
 * ## 为什么必须翻译，而不是直接把 `draft.data` 丢给 `project.load`
 *
 * 两者是**两套契约**，字段名和嵌套结构都不同：
 *
 * | 语义 | 草稿 (DiagramData) | 工程包 (project_load) |
 * | --- | --- | --- |
 * | 取数区 | `rois[].xlim/ylim` + 平铺 `roi.xMin…` | `rois` + `roi{x,y,w,h}` |
 * | 列横向范围 | `startX` / `endX` / `tickEndX` | `startX` / `endX`（`start`/`end` 亦读） |
 * | 列标度 | `startValue` / `tickValue` + `x_ticks` | `x_group_id` + `x_values`（组管位置、列管数值） |
 * | 深度标定 | `calibration{isCalibrated,…}` | `depth_calibration` / `calibration` 的 `top_px…` |
 * | 底图 | `imageSrc`（可能是 `data:` URL） | `image.base64` |
 *
 * 尤其列标度：`project_load` **优先**用 `x_group_id` + `x_values` 定位标度
 * （`session_parts/xscale.py` 的 Case A1）。只丢 `startX/endX/startValue/tickValue`
 * 而不建组，会把相对位置换成 `tick_layout = [0,1]` 的满宽默认值 —— 用户标定过的
 * 刻度位置被悄悄拉满整列（实测：28 列里 27 列 `tickEndX` 全变），属于典型的
 * "看起来恢复了、数字全错"。所以这里为每列建一个专属 `x_group`，把标度端点
 * 换算成 `tick_layout.rel` + `x_values` 一并下发。
 *
 * `x_ticks` 也原样带上：后端 `resolve_column_scale` 的 A2 分支同样认它，
 * 两条路给出一致的端点与读数。
 *
 * ## 不能恢复的东西必须如实返回，不得假装恢复
 *
 * 返回值的 `unrestored` 列出草稿里有、工程包契约里**没有通道**的状态。
 * 目前确认的只有一项：清理叠加层的**人工修正笔迹**（`line_strokes`）——
 * `project_load` 不读这个键（grep `session_parts/project.py` 无命中），
 * 只能经 `algorithm.applyLineRemoval{strokes}` 写入。调用方据此向用户明说。
 */
export interface DraftRestorePayload {
  /** 直接交给 `project.load` 的 `project_data`。 */
  projectData: Record<string, unknown>;
  /** 草稿中存在、但工程包契约无法承载的状态（面向用户的原因列表）。 */
  unrestored: string[];
}

export function draftToProjectPayload(draft: DiagramData): DraftRestorePayload {
  const unrestored: string[] = [];

  // —— 底图：草稿只存 imageSrc。data: URL 内嵌图可还原为 base64；
  //    `/image/current` 这类后端 URL 说明图还在后端会话里，无需重发。
  const image: Record<string, unknown> = {};
  const src = draft.imageSrc || '';
  const dataUrlMatch = /^data:[^;]+;base64,(.*)$/s.exec(src);
  if (dataUrlMatch) {
    image.base64 = dataUrlMatch[1];
    image.width = draft.imageWidth;
    image.height = draft.imageHeight;
  } else if (draft.imageWidth && draft.imageHeight) {
    image.width = draft.imageWidth;
    image.height = draft.imageHeight;
  }

  // —— 取数区：rois 原样（已含 xlim/ylim），另补 `roi{x,y,w,h}` 兼容旧读法。
  const rois = (draft.rois ?? []).map((r) => ({ ...r }));
  const box = draft.roi;
  const legacyRoi =
    box && Number.isFinite(box.xMin) && Number.isFinite(box.xMax)
      ? {
          x: box.xMin,
          y: box.yMin,
          w: box.xMax - box.xMin,
          h: box.yMax - box.yMin,
        }
      : undefined;

  // —— 列：为每列建专属组，把标度端点换算成 rel + x_values。
  const groupsByRoi: Record<string, Array<Record<string, unknown>>> = {};
  const fallbackRoiId =
    draft.active_roi_id || draft.primary_roi_id || rois[0]?.id || 'roi_1';
  const columns = (draft.columns ?? []).map((c) => {
    const start = Number(c.startX);
    const end = Number(c.endX);
    const span = Math.max(1e-9, end - start);
    const roiId = c.roi_id || fallbackRoiId;

    let rel0: number;
    let rel1: number;
    let xValues: [number, number];
    if (Array.isArray(c.x_ticks) && c.x_ticks.length >= 2) {
      // 标定过的列：端点就是两个真实刻度钉。
      rel0 = (Number(c.x_ticks[0].px) - start) / span;
      rel1 = (Number(c.x_ticks[1].px) - start) / span;
      xValues = [Number(c.x_ticks[0].value), Number(c.x_ticks[1].value)];
    } else {
      // 未标定：起点在列左边界，终点取后端下发的 tickEndX
      // （它已经是后端 `resolve_column_scale` 算出的绝对像素，不是自造值）。
      const tickEndX = c.tickEndX ?? c.endX;
      rel0 = 0;
      rel1 = (Number(tickEndX) - start) / span;
      // legacy 契约（0–100% 占位）不是读数：真正的标度一律经后端
      // `resolve_column_scale`，未标定列在后端就不给数。这里只是让旧工程包
      // 能还原出"当初画的量程"，数值来源仍是后端下发的字段。
      xValues = [Number(c.startValue ?? 0), Number(c.tickValue ?? LEGACY_FULL_SCALE)];
    }
    if (!Number.isFinite(rel0) || !Number.isFinite(rel1)) {
      // 端点算不出来就如实记下，绝不拿 0/1 顶上冒充。
      unrestored.push(`列 ${c.name ?? c.id} 的标度端点像素非法，无法还原其刻度位置`);
      rel0 = 0;
      rel1 = 1;
    }

    const groupId = c.x_group_id || `${roiId}_grp_c${c.col_index ?? c.id}`;
    if (!groupsByRoi[roiId]) groupsByRoi[roiId] = [];
    if (!groupsByRoi[roiId].some((g) => g.id === groupId)) {
      groupsByRoi[roiId].push({
        id: groupId,
        name: `${c.name ?? c.id}组`,
        unit: c.unit || '%',
        plot_type: c.plot_type || c.plotType || 'area',
        scale_type: c.scale_type || 'linear',
        exaggeration_mult: c.exaggeration_mult ?? null,
        tick_layout: [{ rel: rel0 }, { rel: rel1 }],
      });
    }

    return {
      ...c,
      roi_id: roiId,
      x_group_id: groupId,
      // `project_load` 用 x_values 当该列的数值端点（组管位置、列管数值）。
      x_values: xValues,
      x_ticks: c.x_ticks ?? null,
    };
  });

  const roisWithGroups = rois.map((r) => {
    const groups = groupsByRoi[r.id ?? ''] ?? [];
    if (groups.length === 0) return r;
    return {
      ...r,
      x_groups: groups,
      default_group_id: groups[0].id,
    };
  });

  // —— 清理几何：`project_load` 读 `line_candidates` / `selected_candidate_ids`。
  if ((draft.line_strokes ?? []).length > 0) {
    unrestored.push(
      `清理掩膜的 ${draft.line_strokes.length} 条人工修正笔迹需经 algorithm.applyLineRemoval 单独提交，工程包不携带`
    );
  }
  if ((draft.exclusion_regions ?? []).length > 0) {
    unrestored.push(
      `排除区（${draft.exclusion_regions.length} 处）同样只能经清理 RPC 写入，工程包不携带`
    );
  }

  return {
    projectData: {
      version: '3.0.0',
      schema_version: '3.0',
      image,
      roi: legacyRoi,
      rois: roisWithGroups,
      primary_roi_id: draft.primary_roi_id || fallbackRoiId,
      active_roi_id: draft.active_roi_id || fallbackRoiId,
      // 深度标定：`project_load` 同时认 `depth_calibration` 与 `calibration`。
      depth_calibration: {
        is_calibrated: !!draft.calibration?.isCalibrated,
        top_px: draft.calibration?.top_px ?? null,
        top_cm: draft.calibration?.top_cm ?? null,
        bottom_px: draft.calibration?.bottom_px ?? null,
        bottom_cm: draft.calibration?.bottom_cm ?? null,
        unit: draft.calibration?.unit || 'cm',
      },
      calibration: {
        isCalibrated: !!draft.calibration?.isCalibrated,
        top_px: draft.calibration?.top_px ?? null,
        top_cm: draft.calibration?.top_cm ?? null,
        bottom_px: draft.calibration?.bottom_px ?? null,
        bottom_cm: draft.calibration?.bottom_cm ?? null,
        unit: draft.calibration?.unit || 'cm',
      },
      // 清理几何三个键：`project_load` 一律 `is not None` 判定，传 `[]` 等于
      // **主动清空**后端。旧草稿（无这些键）不能因此把后端的候选线抹掉，
      // 所以只在草稿真的带了数组时才下发。
      ...(Array.isArray(draft.line_candidates) ? { line_candidates: draft.line_candidates } : {}),
      ...(Array.isArray(draft.selected_candidate_ids)
        ? { selected_candidate_ids: draft.selected_candidate_ids }
        : {}),
      // `samples` 同理（B-11 那类"上一张图的层位漏进新图"正是这个键失控导致）。
      ...(Array.isArray(draft.samples) ? { samples: draft.samples } : {}),
      columns,
    },
    unrestored,
  };
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
    // 默认**关**：这条浅色网格线不承载任何判定信息，是纯视觉噪声（用户明确要求删）。
    // 之前这里写 `?? true`，与 `GeologyCanvas` 的初始值 `depthGridEnabled: false` 打架 ——
    // 每次加载项目都被重新打开，表现为"网格线怎么清不掉"。
    depthGridEnabled: cal.depthGridEnabled ?? cal.depth_grid_enabled ?? false,
    customDepths: cal.customDepths ?? cal.custom_depths ?? [],
  };

  const normalizedCols = rawCols.map((c: any, idx: number) => {
    const name = c.name || c.species || `Col ${idx + 1}`;
    const startX = c.startX ?? (c.start ?? 0);
    const tickEndX = c.tickEndX ?? (c.scaleCalib?.calibX ?? c.endX ?? c.end ?? startX + 50);
    const endX = c.endX ?? (c.end ?? tickEndX);
    const startVal = c.startValue ?? (c.scaleCalib?.originVal ?? 0);
    const tickVal = c.tickValue ?? (c.scaleCalib?.calibVal ?? c.maxPercent ?? LEGACY_FULL_SCALE);
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
      notifyError('科学项目包 (.tar) 导出失败：' + (err.message || err));
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
          if (scale.calibrated && scale.exaggerationMult && scale.exaggerationMult > 1) {
            v = v / scale.exaggerationMult;
          }
          rowVals.push(v.toFixed(2));
        } else {
          // 未标定 / 无控制点不给数：以前这里写 '0.00'，等于把"没数字化"
          // 报成"该层确实 0%"，导出表上两者无法区分。
          rowVals.push('NA');
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
    // 放大倍数只有 `exaggeration_mult` 一个来源；没有就**不生成** exag 参数。
    // 旧实现里 `Math.max(5, …)` 会在无人设置时也画成 5×——脚本与数据不一致。
    const exagMults = visibleCols
      .map((c) => c.exaggeration_mult)
      .filter((m): m is number => typeof m === 'number' && m > 1);
    const hasAnyExag = exagMults.length > 0;
    const maxExagMult = hasAnyExag ? Math.max(...exagMults) : 0;
    const exagVec = visibleCols
      .map((c) => (typeof c.exaggeration_mult === 'number' && c.exaggeration_mult > 1 ? 'TRUE' : 'FALSE'))
      .join(', ');

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
   * 把自动存档草稿**真正**恢复到后端（B-05）。
   *
   * 旧实现只做 `canvasComponent.loadNewDiagram(draft.data)` + `history.reset(...)`，
   * **零个 RPC**：界面显示 28 列，后端仍是 0 列。之后任何列级 RPC 拿
   * `col_index` 去寻址都会打空，而用户看到的是一次"成功恢复"
   * （违反 `docs/ARCHITECTURE.md` §2：禁止静默兜底）。
   *
   * 现在走 `project.load`：草稿经 `draftToProjectPayload()` 翻译成工程包形状后下发，
   * 再用后端权威数据重建前端镜像。`project.load` 失败即抛出 —— 由调用方冒泡，
   * 绝不"前端恢复了就算恢复"。
   */
  public async restoreDraft(draft: DiagramData): Promise<{
    /** 后端真的接受了这份草稿。 */
    restored: boolean;
    /** 草稿里有、但工程包契约承载不了的状态说明（调用方必须展示给用户）。 */
    unrestored: string[];
    /** 后端恢复后的**权威**图谱数据；调用方据此重建画布镜像。 */
    data: DiagramData;
  }> {
    const { projectData, unrestored } = draftToProjectPayload(draft);

    // ## 图像一致性前置校验：草稿必须属于后端当前这张图
    //
    // 草稿里存的是前端拿到的图谱元数据（`imageWidth` / `imageHeight`）。
    // 若后端当前底图的尺寸与草稿不符 —— 用户换了图、或服务重启后载入了另一张 ——
    // 把草稿 `project.load` 下去等于**把上一张图的列/标定写到新图上**：
    // 列边界指向新图上不存在的位置，而界面显示"恢复成功"。这是比"只写前端"
    // 更坏的静默错误（ARCHITECTURE §2），必须在落库**之前**拦下。
    //
    // 只比尺寸是刻意的：后端 `getDiagramData` 不暴露图像内容指纹（无 sha/来源字段），
    // 同尺寸不同图在此无法区分 —— 该限制写在 `unrestored` 里如实告知，不假装严密。
    const current = await this.rpcClient.getDiagramData();
    const draftW = Number(draft.imageWidth ?? 0);
    const draftH = Number(draft.imageHeight ?? 0);
    const curW = Number(current.imageWidth ?? 0);
    const curH = Number(current.imageHeight ?? 0);
    if (draftW > 0 && draftH > 0 && (draftW !== curW || draftH !== curH)) {
      throw new Error(
        `草稿属于另一张图谱（草稿 ${draftW}×${draftH}，当前底图 ${curW}×${curH}），` +
          '拒绝恢复：把上一张图的分列与标定写到当前图上会产生错误的科学数据。请重新载入草稿对应的图谱后再恢复。'
      );
    }
    if (draftW > 0 && draftH > 0 && draftW === curW && draftH === curH && !draft.imageSrc?.startsWith('data:')) {
      // 尺寸相同但也没有内嵌图可核对 —— 如实记下这条不确定性，不当成"已验证同一张图"。
      unrestored.push(
        '草稿未内嵌底图，只能按尺寸判定为同一张图，无法核对图像内容是否一致'
      );
    }

    const res = await this.rpcClient.call<Record<string, unknown>, { success?: boolean; columns_count?: number }>(
      'project.load',
      { project_data: projectData }
    );
    if (!res || res.success !== true) {
      // 后端没明确应答成功就不能算恢复。
      throw new Error('project.load 未返回 success=true，草稿恢复中止');
    }

    // 镜像重建只认后端回来的状态：草稿是"请求"，后端是"事实"。
    const fresh = await this.rpcClient.getDiagramData();
    const expected = (draft.columns ?? []).length;
    const got = (fresh.columns ?? []).length;
    // 两种真实的"静默丢数据"必须当场拆穿，而不是把界面填上草稿就当成功：
    // 1. 后端没有底图（服务重启过、草稿里存的是 `/image/current` 这类会话 URL）
    //    —— `getDiagramData` 在 `image is None` 时一律返回零态，列全丢；
    // 2. 列数对不上 —— 说明 `project_load` 没有按草稿重建（例如标度端点非法被跳过）。
    if (!fresh.imageSrc) {
      throw new Error(
        '后端当前没有底图，草稿无法真正恢复（草稿只保存了指向后端会话的图片地址）。请重新载入该图谱后再从步骤 1 开始。'
      );
    }
    if (expected > 0 && got !== expected) {
      throw new Error(
        `草稿恢复不完整：草稿有 ${expected} 列，后端只重建了 ${got} 列。已在后端留下不一致状态，请重新载入图谱后重试。`
      );
    }

    // 刻意**不**复用 `onProjectLoad`：那条路径属于"打开项目包"，会把阶段拨到
    // Y 标定并提示"成功载入科学项目包"，对"草稿恢复"是错的状态与错的文案。
    // 镜像重建由调用方负责（它才知道该停在哪个阶段）。
    return { restored: true, unrestored, data: fresh };
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
            notifyError('读取 .tar 归档失败：未找到有效的文件块。');
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
              notifyError('解包成功，但未在 JSON 中找到合法的 columns 或 calibration 字段。');
            }
          } else {
            notifyError('未在 .tar 归档中找到项目数据 JSON 文件。');
          }
        } catch (err) {
          notifyError('解析 .tar 归档失败：' + (err as Error).message);
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
          notifyError('项目文件格式不匹配：未找到有效的 columns 或 calibration 配置。');
        }
      } catch (err) {
        notifyError('读取项目文件失败：无效的 JSON 格式。');
      }
    };
    reader.readAsText(file, 'utf-8');
  }
}
