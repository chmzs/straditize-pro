/**
 * 现行 8 步工作流的「步骤 → 可绘制/可交互能力」映射。
 *
 * ## 为什么必须集中在这里
 *
 * 本文件出现之前，各能力的阶段判断散落在 GeologyCanvas.render() 的 6 处
 * `workflowStage >= N` 里，注释用的还是**旧 7 步编号**。8 步重构
 * （docs/plans/2026-09-20-8step-workflow-redesign.md §1）之后编号整体位移，
 * 于是出现成片缺陷：
 *
 *   - Y 标定：选点守卫 `=== 3`、绘制守卫 `>= 4` → 步骤 3 点完画布没反应
 *   - 花粉曲线：守卫 `>= 5`（旧 S5=拐点），新编号 5=分列 → 一分列就描好轮廓
 *   - 深度网格：外层 `>= 4`、内层却用新编号排除 4/5 → 步骤 3 标定完画不出来
 *
 * 结论：**同一个步骤编号在两处各写一遍就一定会漂移**。集中成常量 + 谓词，
 * 由 test-workflow-stage.mjs 钉住语义，改编号时测试立刻变红。
 *
 * ## 现行 8 步（与设计稿 §1 对照表一致）
 *
 *   1 载入 → 2 ROI → 3 Y轴标定 → 4 清理 → 5 分列 → 6 标定列 → 7 拐点与采样层位 → 8 校验
 *
 * 旧 7 步 → 新编号：S1→1, S2→2, S3分列→5, S4标尺→6, S5拐点→7, S6校验→8, S7导出→删除
 */

/** 现行 8 步工作流的步骤编号。 */
export const STAGE = {
  /** 未载入任何图谱（含空态） */
  EMPTY: 0,
  LOAD: 1,
  ROI: 2,
  Y_CALIB: 3,
  CLEANUP: 4,
  SPLIT: 5,
  CALIBRATE_COLUMNS: 6,
  /** 拐点与采样层位（旧 7 步里的「S5 拐点」） */
  SPEARS_AND_SAMPLES: 7,
  QA: 8,
} as const;

/** 步骤 2 起才存在 ROI 矩形与 8 个调整手柄（步骤 1 绝不呈现）。 */
export function showsRoiOverlay(stage: number): boolean {
  return stage >= STAGE.ROI;
}

/**
 * 步骤 2 起才允许命中 ROI 手柄。
 *
 * 与 showsRoiOverlay 必须同真同假：绘制了却点不到、或点得到却看不见，
 * 都会让用户以为手柄坏了。
 */
export function canHitRoiHandle(stage: number): boolean {
  return showsRoiOverlay(stage);
}

/**
 * 步骤 3 起绘制 Y1/Y2 标定标记。
 *
 * 与 canPickYCalibMark 必须同步：一个管"画不画"、一个管"点不点得上"，
 * 此前二者分别写成 `>= 4` 和 `=== 3`，导致步骤 3 点完两点毫无反馈。
 */
export function showsYCalibMarks(stage: number): boolean {
  return stage >= STAGE.Y_CALIB;
}

/** 是否处于「画布左键点击即拾取 Y1/Y2」的步骤（mode 为 ycalib 时同样放行）。 */
export function canPickYCalibMark(stage: number, mode: string): boolean {
  return mode === 'ycalib' || stage === STAGE.Y_CALIB;
}

/**
 * 深度标尺网格：步骤 3 起可画，但 4 清理 / 5 分列 默认不画。
 *
 * 设计稿 §1.1：「把 Y 标定放前面是因为标定后深度标尺即可绘制，清理时有坐标系可定位」
 * —— 所以必须能从步骤 3 就出现；而 4/5 要在干净墨迹上作业，画网格会抹黑图谱。
 * 未完成标定时由 drawDepthGrid 内部的 `!bounds` 短路，不会画出假刻度。
 */
export function showsDepthGrid(stage: number): boolean {
  if (stage < STAGE.Y_CALIB) return false;
  return stage !== STAGE.CLEANUP && stage !== STAGE.SPLIT;
}

/**
 * 属种垂直分界标线：只要列已存在就持续可见。
 *
 * 用 `columnCount > 0` 而不是 `stage >= SPLIT`，是为了跨步骤回退时不突然消失
 * （列已经画在图上了，回到步骤 3/4 再让它消失只会让人以为分列丢了）。
 */
export function showsColumnBoundaries(stage: number, columnCount: number): boolean {
  return stage >= STAGE.Y_CALIB && columnCount > 0;
}

/**
 * 花粉轮廓面积图、控制锚点与质检比对层：**必须等到步骤 7（拐点与采样层位）**。
 *
 * 这是本轮用户直接反馈的问题：旧守卫 `>= 5`（旧编号 S5=拐点）在 8 步里
 * 对应的是「分列」，于是一进分列就看见已经描好的曲线与锚点，
 * 而此时用户还没进拐点步骤，这些本不该出现。
 */
export function showsPollenCurves(stage: number, columnCount: number): boolean {
  return stage >= STAGE.SPEARS_AND_SAMPLES && columnCount > 0;
}

/**
 * 供调试句柄（window.__straditize.getState().layers）与 e2e 断言使用：
 * 返回"当前步骤下会绘制哪些层"，让 UI 验证可以直接断言能力，而不是去数像素。
 */
export function visibleLayers(
  stage: number,
  opts: { hasImage: boolean; columnCount: number } = { hasImage: false, columnCount: 0 },
): string[] {
  const layers: string[] = [];
  if (opts.hasImage) layers.push('background');
  if (showsRoiOverlay(stage)) layers.push('roi');
  if (showsYCalibMarks(stage)) layers.push('yCalibMarks');
  if (showsDepthGrid(stage)) layers.push('depthGrid');
  if (showsColumnBoundaries(stage, opts.columnCount)) layers.push('columnBoundaries');
  if (showsPollenCurves(stage, opts.columnCount)) {
    layers.push('pollenCurves', 'anchors', 'ghosting');
  }
  return layers;
}
