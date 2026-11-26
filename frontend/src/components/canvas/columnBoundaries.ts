
/**
 * 列边界与刻度的绘制（红 / 绿 / 蓝三条线的唯一绘制点）。
 *
 * ## 三条线的分工是产品定义，不是配色偏好
 *
 * 红 = `col.startX`（轴线**左缘** = 列切分线，也是上一列的结束位置）；
 * 绿 = `startX + 轴粗`（轴线右缘 = 0 点）；蓝 = `0点 + k × cell_px`（等距外推的刻度）。
 * 完整语义与实测证据见 ARCHITECTURE §6.4 / 不变量 19–20。
 *
 * ## 为什么从画布类里搬出来
 *
 * 这段 250 行只读数据 + 画 ctx，却被留在一个 2755 行的上帝类里，改一次要重读整条
 * 渲染管线。搬出后交互态（hover / 拖拽中的边界）由调用方显式传入，纯函数不再
 * 反向窥探 `toolStrategies`——那正是"哪里改了哪里没改"的温床。
 *
 * 注意：**列结束位置不画**。rioja / Tilia 的列首尾相接，`endX` 恒等于下一列的
 * `startX`（红线已画）；再画一条会让用户无法判断哪条才是真正的分界。
 */
import { shouldDrawColumnLabel } from './labelLayout';
import { resolveAxisStroke } from '../../core/axisStroke';
import { resolveColumnGroup } from '../../core/columnGroup';
import { groupBandRect } from './groupBandRect';
import { groupColorAt } from './groupColor';
import { formatCalibNumber, getGroupCalibMark, setGroupCalibMark } from './groupCalibMarks';
import { STAGE } from '../../core/WorkflowStage';
import type { DataRoi, TaxaColumn } from '../../types/pollen';

/** 边界类型：列起点（红）/ 列终点（仅悬停高亮）。 */
export type BoundaryKind = 'start' | 'end';

export interface BoundaryFocus {
  taxaId: string;
  type: BoundaryKind;
}

export interface ColumnBoundaryEnv {
  ctx: CanvasRenderingContext2D;
  isLight: boolean;
  columns: TaxaColumn[];
  roi: DataRoi;
  rois?: DataRoi[];
  imageHeight: number;
  scale: number;
  activeTaxaId: string | null;
  /** 鼠标悬停的边界（null = 无）。 */
  hovered: BoundaryFocus | null;
  /** 正在拖拽的边界（null = 无）。与 hovered 分开：拖拽时鼠标可能已离开该条线。 */
  dragging: BoundaryFocus | null;
  /** 当前工作流步骤编号（步骤 6 之前不绘制等距外推刻度线）。 */
  workflowStage?: number;
  /** 是否开启单位刻度线显示。 */
  showTicks?: boolean;
}



/** 只有用户确认过的两点标定才算数（判据单一源在 CoordinateSystem）。 */


/**
 * 组归属条：在数据区**上方**的空白带画一条组色横条（同组连续只标一次组名）。
 *
 * 为什么需要：分完组之后画布上没有任何组的信息，用户只能回侧栏逐列核对——8~20 列时对不上。
 * 一条色带 + 每个连续段首列写一次组名，扫一眼就知道组边界在哪。
 *
 * 只在 ≥2 组时画：单组时是全图同色的纯噪声，侧栏已经写明组名。
 * 颜色按组在 `roi.x_groups` 中的顺序取：**唯一取色入口**是 `./groupColor.ts`，
 * 步骤 6 的组按钮用同一个函数，面板与画布逐字节同色（issue #108）。
 */
function drawGroupBands(env: ColumnBoundaryEnv): void {
  const { ctx, columns, roi, scale } = env;
  const groups = roi.x_groups ?? [];
  if (groups.length < 2) return;

  const bandY = Math.max(0, roi.yMin - 30);
  const bandH = Math.max(1, 4 / scale);
  let prevGid: string | null = null;

  ctx.save();

  for (const col of columns) {
    if (!col.visible) continue;
    // 组归属统一走 `resolveColumnGroup`（与画绿线的那处同一个 helper）：
    // 两处各写一套回退，会在「列没有 x_group_id」的工程里给出两个不同的组。
    const groupOfCol = resolveColumnGroup(col, roi);
    const gid = groupOfCol?.id ?? '';
    const idx = Math.max(0, groups.findIndex((g) => g.id === gid));
    const color = groupColorAt(idx);

    ctx.fillStyle = color;
    const band = groupBandRect(col.startX, col.endX, resolveAxisStroke(col, groups[idx]));
    if (band.width > 0) {
      ctx.fillRect(band.x, bandY, band.width, bandH);
    }

    if (gid !== prevGid) {
      const name = groups[idx]?.name ?? '';
      ctx.font = `600 ${Math.max(9, 10 / scale)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(name, col.startX + 2 / scale, bandY - 2 / scale);
    }
    prevGid = gid;
  }
  ctx.restore();
}
export function drawColumnBoundariesOverlay(env: ColumnBoundaryEnv): void {
  const { ctx, isLight, columns, roi, imageHeight, scale, activeTaxaId, hovered, dragging } = env;
    const maxH = imageHeight || 12000;
    const topY = Math.max(0, roi.yMin - 40);
    const bottomY = Math.min(maxH, roi.yMax + 30);

    ctx.save();

    // 组归属条：先画在数据区上方的窄带作为背景带，随后列线与 45° 属种标签覆盖其上。
    drawGroupBands(env);

    let lastLabeledCenterX = Number.NEGATIVE_INFINITY;

    columns.forEach((col) => {
      if (!col.visible) return;

      const isActive = col.id === activeTaxaId;

      // ── 列的四条线（语义由领域确定，不要凭感觉调色）────────────────────────
      //   红实线 = `col.startX` = 轴线**左缘** = 列切分线（也是上一列的结束位置）
      //   绿实线 = `startX + axis_stroke_px` = 该列数据的 **0 点**（轴线右缘）
      //   蓝实线 = 单位刻度齿位置（该刻度代表多少单位由用户填）
      //   深度网格线默认关闭：它铺满画布却不承载任何判定信息，是纯视觉噪声。
      //
      // 红绿是**两条不同的线**，不能合并：列切分线由分列算法给出，0 点还要加上
      // 轴线自身的描边宽度（轴上没有墨迹可量，粗细只能来自组参数，默认 5 可改）。
      // 前提是 `col.startX` 保持"轴线左缘"语义——`detect_columns` 的右缘锚定
      // （`anchor_zero_at_axis_right`）默认关闭就是为了这个；一旦开启，start 变成
      // 右缘，这里再加轴粗即双偏移（实测事故见 ARCHITECTURE §6.4）。
      // 列 → 组：`col.x_group_id` → ROI 的 `default_group_id` → 第一个组。
      // 旧实现只做精确匹配，列上没有 `x_group_id` 时组轴粗被忽略、恒回落缺省 5。
      const roiOfCol = (env.rois || []).find((r) => r.id === col.roi_id) || roi;
      const groupOfCol = resolveColumnGroup(col, roiOfCol);
      // 一个单位刻度的像素长度 = 组级斜率的倒数（value_per_px = 每像素多少单位）。
      // 斜率只由用户「点一个齿 + 填它的数字」写入（ARCHITECTURE §6.4）；未标定 → null → 一条齿都不画。
      // 自动检测的刻距不参与：实测同图各列差 1–2px，且从未经用户确认（§6.4:254）。
      const groupSlope = Number(groupOfCol?.value_per_px);
      const cellPx =
        Number.isFinite(groupSlope) && groupSlope !== 0 ? 1 / Math.abs(groupSlope) : null;
      // 列级覆盖 > 组级初值 > 兜底 `DEFAULT_AXIS_STROKE_PX`（与后端 xscale 同语义）。
      const axisStrokePx = resolveAxisStroke(col, groupOfCol);
      const leftEdgeX = col.startX;
      const zeroX = leftEdgeX + axisStrokePx;

      // 红：列切分线（= 轴线左缘）
      ctx.beginPath();
      ctx.moveTo(leftEdgeX, topY);
      ctx.lineTo(leftEdgeX, bottomY);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = (isActive ? 1.8 : 1.2) / scale;
      ctx.setLineDash([]);
      ctx.stroke();

      // 绿：0 点（= 轴线右缘 = 红线 + 轴线粗）
      ctx.beginPath();
      ctx.moveTo(zeroX, topY);
      ctx.lineTo(zeroX, bottomY);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = (isActive ? 1.8 : 1.2) / scale;
      ctx.setLineDash([]);
      ctx.stroke();

      

      // 手动标定的两个锚点：0 点落绿线（轴线右缘），用户点的那条齿落在它自己的像素上。
      // 只有该组真的标定过才画；未标定列一个标记都没有（ARCHITECTURE §6.4）。
      const isCalibrated = Number.isFinite(groupSlope) && groupSlope !== 0;
      let calibMark = getGroupCalibMark(groupOfCol?.id, groupOfCol);

      // 兼容旧工程 / 恢复真标定：若组已标定但未存 calib_mark，严格依据列自身或组内真实标定端点恢复，绝不编造候选值
      if (!calibMark && isCalibrated) {
        let realReading: number | null = null;
        let realPx: number | null = null;

        // 1. 优先读取列自身在工程保存时携带的权威标定端点 (tickValue + tickEndX)
        const colTickVal = (col as any).tickValue;
        const colTickEndX = (col as any).tickEndX;
        const isSlopeUnitVector =
          Number.isFinite(colTickVal) &&
          Number.isFinite(colTickEndX) &&
          Math.abs(colTickEndX - (zeroX + 1.0)) < 1e-3 &&
          Math.abs(colTickVal - Math.abs(groupSlope)) < 1e-3;
        if (
          !isSlopeUnitVector &&
          Number.isFinite(colTickVal) &&
          colTickVal > 0 &&
          Number.isFinite(colTickEndX) &&
          colTickEndX > zeroX
        ) {
          realReading = Number(colTickVal);
          realPx = Number(colTickEndX);
        } else if (
          (col as any).scaleCalib &&
          Number.isFinite((col as any).scaleCalib.val1) &&
          (col as any).scaleCalib.val1 > 0 &&
          Number.isFinite((col as any).scaleCalib.abs_px1) &&
          (col as any).scaleCalib.abs_px1 > zeroX &&
          !(Math.abs((col as any).scaleCalib.abs_px1 - (zeroX + 1.0)) < 1e-3 && Math.abs((col as any).scaleCalib.val1 - Math.abs(groupSlope)) < 1e-3)
        ) {
          realReading = Number((col as any).scaleCalib.val1);
          realPx = Number((col as any).scaleCalib.abs_px1);
        } else if (Array.isArray(col.x_ticks) && col.x_ticks.length >= 2) {
          const t1 = col.x_ticks[1];
          const t1Val = Number(t1?.value);
          const t1Px = Number(t1?.px);
          if (Number.isFinite(t1Val) && t1Val > 0 && Number.isFinite(t1Px) && t1Px > zeroX) {
            realReading = t1Val;
            realPx = t1Px;
          }
        } else if (
          Array.isArray(col.x_values) &&
          Number.isFinite(Number(col.x_values[1])) &&
          Number(col.x_values[1]) > 0 &&
          Math.abs(Number(col.x_values[1]) - Math.abs(groupSlope)) > 1e-3
        ) {
          realReading = Number(col.x_values[1]);
          const d = realReading / Math.abs(groupSlope);
          realPx = zeroX + d;
        }

        if (realReading !== null && realPx !== null && realReading > 0) {
          const dist = realPx - zeroX;
          if (dist > 0) {
            calibMark = {
              px: realPx,
              reading: realReading,
              dist,
              col_id: col.id,
            };
            if (groupOfCol?.id) {
              setGroupCalibMark(groupOfCol.id, calibMark);
            }
          }
        }
      }

      if (isCalibrated) {
        ctx.save();
        ctx.font = "600 " + String(Math.max(9, 10 / scale)) + "px monospace";
        ctx.textBaseline = "top";
        const drawCalibMark = (x: number, label: string, color: string): void => {
          ctx.beginPath();
          ctx.moveTo(x, bottomY);
          ctx.lineTo(x, bottomY + 10 / scale);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.fillText(label, x, bottomY + 12 / scale);
        };
        drawCalibMark(zeroX, "0", "#22c55e");
        if (calibMark) {
          const isMatchingCol = calibMark.col_id
            ? (calibMark.col_id === col.id || (calibMark.px >= leftEdgeX - 2 && calibMark.px <= col.endX + 2))
            : (calibMark.px >= leftEdgeX - 2 && calibMark.px <= col.endX + 2);
          if (isMatchingCol) {
            const markX = calibMark.dist ? zeroX + calibMark.dist : calibMark.px;
            drawCalibMark(markX, formatCalibNumber(calibMark.reading), isLight ? "#0284c7" : "#38bdf8");
          }
        }
        ctx.restore();
      }

      const isEndHovered =
        (hovered?.taxaId === col.id && hovered.type === 'end') ||
        (dragging?.taxaId === col.id && dragging.type === 'end');

      // 刻度 = 蓝实线，按组级 `cell_px` **等距外推**（0 点已经用绿线画好，不重复画）。
      // 约束：只在步骤 6（STAGE.CALIBRATE_COLUMNS）且 showTicks 不为 false 时显示！其他步骤不呈现，防止干扰视觉。
      const canShowTicks =
        (env.workflowStage === undefined || env.workflowStage === STAGE.CALIBRATE_COLUMNS) &&
        env.showTicks !== false;
      if (canShowTicks && cellPx && cellPx > 2) {
        const kMax = Math.floor((col.endX - zeroX) / cellPx);
        for (let k = 1; k <= kMax; k += 1) {
          const tickX = zeroX + k * cellPx;
          if (tickX > col.endX + 0.5) break;
          ctx.beginPath();
          ctx.moveTo(tickX, topY);
          ctx.lineTo(tickX, bottomY);
          ctx.strokeStyle = isLight
            ? 'rgba(37, 99, 235, 0.55)'
            : 'rgba(96, 165, 250, 0.65)';
          ctx.lineWidth = 1.0 / scale;
          ctx.setLineDash([]);
          ctx.stroke();
        }
      }

      // 3. 列结束位置**不常驻画**：rioja / Tilia 的列首尾相接（inc2 = inc × colM），
      //    `endX` 恒等于下一列的 `startX` —— 那条红线已经画了，再画一条会让用户
      //    无法判断哪条才是真正的分界（历史反馈：「把该列 area 拦腰截断」）。
      //    只在鼠标悬停到该边界时高亮，方便拖动改列宽。
      if (isEndHovered && col.endX > leftEdgeX + 4) {
        ctx.beginPath();
        ctx.moveTo(col.endX, topY);
        ctx.lineTo(col.endX, bottomY);
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2.5 / scale;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // 5. 属种名称（统一 45° 斜向右上排布，彻底杜绝相邻列水平堆叠遮挡）
      const width = col.endX - col.startX;
      const centerX = col.startX + width / 2;

      if (isActive) {
        lastLabeledCenterX = centerX;
        ctx.save();
        const fontSize = Math.max(10, 12 / scale);
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        const displayName = col.name.length > 28 ? col.name.substring(0, 26) + '…' : col.name;
        const textMetrics = ctx.measureText(displayName);
        const badgeW = textMetrics.width + 10 / scale;
        const badgeH = 18 / scale;

        ctx.translate(centerX, topY - 6 / scale);
        ctx.rotate(-Math.PI / 4); // 逆时针 45 度斜向右上

        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        const bx = -2 / scale;
        const by = -badgeH / 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, badgeW, badgeH, 3 / scale);
        } else {
          ctx.rect(bx, by, badgeW, badgeH);
        }
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayName, 3 / scale, 0);
        ctx.restore();

      } else if (shouldDrawColumnLabel(centerX, lastLabeledCenterX, scale)) {
        // 未激活列：一律 45 度斜排，高密度全景下按视口像素抽稀避免过密
        lastLabeledCenterX = centerX;
        ctx.save();
        const fontSize = Math.max(9, 10.5 / scale);
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;

        ctx.translate(centerX, topY - 6 / scale);
        ctx.rotate(-Math.PI / 4); // 逆时针 45 度斜向右上
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const displayName = col.name.length > 28 ? col.name.substring(0, 26) + '…' : col.name;

        // 微弱文字描边，保证在深浅/彩色地层背景上均清晰可读
        if (typeof ctx.strokeText === 'function') {
          ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.9)';
          ctx.lineWidth = 2.5 / scale;
          ctx.lineJoin = 'round';
          ctx.strokeText(displayName, 2 / scale, 0);
        }

        ctx.fillStyle = isLight ? '#334155' : 'rgba(255, 255, 255, 0.88)';
        ctx.fillText(displayName, 2 / scale, 0);
        ctx.restore();
      }
    });

    ctx.restore();
}
