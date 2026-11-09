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
import { CoordinateSystem } from '../../core/CoordinateSystem';
import { resolveAxisStroke } from '../../core/axisStroke';
import { resolveTickSpacingPx } from './tickGeometry';
import type { DataRoi, TaxaColumn } from '../../types/pollen';

/** 边界类型：列起点（红）/ 刻度端点（蓝尺）/ 列终点（仅悬停高亮）。 */
export type BoundaryKind = 'start' | 'tick' | 'end';

export interface BoundaryFocus {
  taxaId: string;
  type: BoundaryKind;
}

export interface ColumnBoundaryEnv {
  ctx: CanvasRenderingContext2D;
  isLight: boolean;
  columns: TaxaColumn[];
  roi: DataRoi;
  imageHeight: number;
  scale: number;
  activeTaxaId: string | null;
  /** 鼠标悬停的边界（null = 无）。 */
  hovered: BoundaryFocus | null;
  /** 正在拖拽的边界（null = 无）。与 hovered 分开：拖拽时鼠标可能已离开该条线。 */
  dragging: BoundaryFocus | null;
}

/** 该列标定端点的像素 x：x_ticks[1] → tickEndX → scaleCalib.calibX → 猜测值。 */
export function getColumnCalibX(col: TaxaColumn): number {
  if (col.x_ticks && col.x_ticks.length >= 2 && col.x_ticks[1].px > col.startX) {
    return col.x_ticks[1].px;
  }
  if (col.tickEndX && col.tickEndX > col.startX) {
    return col.tickEndX;
  }
  if (col.scaleCalib?.calibX && col.scaleCalib.calibX > col.startX) {
    return col.scaleCalib.calibX;
  }
  const span = col.endX - col.startX;
  return col.startX + Math.max(20, Math.min(span * 0.65, 80));
}

/** 该列标定端点的读数：x_ticks[1] → scaleCalib.calibVal → maxPercent/tickValue → 20。 */
export function getColumnCalibVal(col: TaxaColumn): number {
  if (col.x_ticks && col.x_ticks.length >= 2) {
    return col.x_ticks[1].value;
  }
  if (col.scaleCalib?.calibVal !== undefined) {
    return col.scaleCalib.calibVal;
  }
  return col.maxPercent ?? col.tickValue ?? 20;
}

/** 只有用户确认过的两点标定才算数（判据单一源在 CoordinateSystem）。 */
function hasRealCalibration(col: TaxaColumn): boolean {
  return CoordinateSystem.hasRealCalibration(col);
}


/**
 * 组归属条：在数据区**上方**的空白带画一条组色横条（同组连续只标一次组名）。
 *
 * 为什么需要：分完组之后画布上没有任何组的信息，用户只能回侧栏逐列核对——8~20 列时对不上。
 * 一条色带 + 每个连续段首列写一次组名，扫一眼就知道组边界在哪。
 *
 * 只在 ≥2 组时画：单组时是全图同色的纯噪声，侧栏已经写明组名。
 * 颜色按组在 `roi.x_groups` 中的顺序取固定调色板：同组同色、不随列变。
 */
const GROUP_BAND_PALETTE = ['#0ea5e9', '#f59e0b', '#a855f7', '#10b981', '#ef4444', '#64748b'];

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
    const gid = col.x_group_id ?? roi.default_group_id ?? groups[0]?.id ?? '';
    const idx = Math.max(0, groups.findIndex((g) => g.id === gid));
    const color = GROUP_BAND_PALETTE[idx % GROUP_BAND_PALETTE.length];

    ctx.fillStyle = color;
    ctx.fillRect(col.startX, bandY, Math.max(1, col.endX - col.startX), bandH);

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

    columns.forEach((col) => {
      if (!col.visible) return;

      const isActive = col.id === activeTaxaId;
      const sc = {
        originX: col.x_ticks?.[0]?.px ?? col.startX,
        originVal: col.x_ticks?.[0]?.value ?? col.scaleCalib?.originVal ?? 0,
        calibX: getColumnCalibX(col),
        calibVal: getColumnCalibVal(col),
        unit: col.unit || '%',
      };

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
      const groupOfCol = roi.x_groups?.find((g) => g.id === col.x_group_id);
      // 一个单位刻度的像素长度（组级）。有它就按等距外推画刻度，
      // 不再依赖检测齿 —— 检测会漏、会多、会偏 1-2px（实测一列是第 2 个齿、另一列是第 3 个）。
      // 齿的间距：**用户确认值（组级 ref_span_px）> 实测刻距 > 不画**。
      // 只认 ref_span_px 时，用户刚进步骤 6（还没点齿标定）画布上一条齿都没有——
      // 面板却写着「检测: 4 列 · 刻距 124.5px」，于是「点一个刻度齿」无从点起。
      const cellPx = resolveTickSpacingPx(groupOfCol?.ref_span_px);
      // 列级覆盖 > 组级初值 > 缺省 5（与后端 xscale.resolve_axis_stroke 同语义）。
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

      
      const isOriginHovered =
        (hovered?.taxaId === col.id && hovered.type === 'start') ||
        (dragging?.taxaId === col.id && dragging.type === 'start');

      const isCalibHovered =
        (hovered?.taxaId === col.id && hovered.type === 'tick') ||
        (dragging?.taxaId === col.id && dragging.type === 'tick');

      const isEndHovered =
        (hovered?.taxaId === col.id && hovered.type === 'end') ||
        (dragging?.taxaId === col.id && dragging.type === 'end');

      // 刻度 = 蓝实线，按组级 `cell_px` **等距外推**（0 点已经用绿线画好，不重复画）。
      // k=0 落 0 点、k=1 是第二个刻度……与检测齿的数量/位置无关。
      if (cellPx && cellPx > 2) {
        const kMax = Math.floor((col.endX - zeroX) / cellPx);
        for (let k = 1; k <= kMax; k += 1) {
          const tickX = zeroX + k * cellPx;
          if (tickX > col.endX + 0.5) break;
          ctx.beginPath();
          ctx.moveTo(tickX, topY);
          ctx.lineTo(tickX, bottomY);
          const highlight = isCalibHovered && k === 1;
          ctx.strokeStyle = highlight
            ? '#f97316'
            : isLight
              ? 'rgba(37, 99, 235, 0.55)'
              : 'rgba(96, 165, 250, 0.65)';
          ctx.lineWidth = (highlight ? 2.4 : 1.0) / scale;
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

      // 4. 绘制两点式物理刻度手柄 (Tick Pins) — 激活列显式绘制顶部与底部定位把手圆点
      //    未标定列同样不画：把手位置来自 sc.calibX（猜测值），画出来在视觉上等于承认它。
      if (isActive && hasRealCalibration(col)) {
        const origColor = isOriginHovered ? '#f97316' : (isLight ? '#0284c7' : '#38bdf8');
        const calibColor = isCalibHovered ? '#f97316' : '#10b981';
        const pinR = (isOriginHovered ? 6 : 4.5) / scale;
        const calR = (isCalibHovered ? 6 : 4.5) / scale;

        // 顶部圆点把手 (Top Pins)
        ctx.beginPath();
        ctx.arc(sc.originX, topY, pinR, 0, Math.PI * 2);
        ctx.fillStyle = origColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sc.calibX, topY, calR, 0, Math.PI * 2);
        ctx.fillStyle = calibColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();

        // 底部刻度基线与圆点把手 (Bottom Pins & Ruler)
        ctx.beginPath();
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.8)' : 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2 / scale;
        ctx.moveTo(sc.originX, bottomY);
        ctx.lineTo(sc.calibX, bottomY);
        ctx.stroke();

        // 绘制检测到的刻度短锯齿 (Detected Tick Teeth)
        const teeth = col.detected_ticks || [];
        if (teeth.length > 0) {
          ctx.save();
          const toothH = 8 / scale;
          for (const tx of teeth) {
            const isChosen = Math.abs(tx - sc.calibX) <= 3;
            ctx.beginPath();
            ctx.strokeStyle = isChosen ? '#10b981' : (isLight ? '#f97316' : '#fbbf24');
            ctx.lineWidth = (isChosen ? 2.5 : 1.5) / scale;
            ctx.moveTo(tx, bottomY);
            ctx.lineTo(tx, bottomY + toothH);
            ctx.stroke();

            // 小齿底端微型指示圆钉
            ctx.beginPath();
            ctx.arc(tx, bottomY + toothH, (isChosen ? 2.8 : 1.8) / scale, 0, Math.PI * 2);
            ctx.fillStyle = isChosen ? '#10b981' : (isLight ? '#f97316' : '#fbbf24');
            ctx.fill();
          }
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(sc.originX, bottomY, pinR, 0, Math.PI * 2);
        ctx.fillStyle = origColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sc.calibX, bottomY, calR, 0, Math.PI * 2);
        ctx.fillStyle = calibColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();

        // 底部刻度值标签 (Bottom value badges: 直接展示纯数字，不带 % 符号)
        ctx.save();
        const fontPx = Math.max(9, 10 / scale);
        ctx.font = `600 ${fontPx}px monospace`;
        ctx.fillStyle = origColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${sc.originVal}`, sc.originX, bottomY + 6 / scale);

        ctx.fillStyle = calibColor;
        ctx.textAlign = 'center';
        ctx.fillText(`${sc.calibVal}`, sc.calibX, bottomY + 6 / scale);
        ctx.restore();
      }

      // 5. 属种名称与端点数值标签
      const width = col.endX - col.startX;
      const centerX = col.startX + width / 2;

      // 属种名称与刻度防重叠渲染
      const colWidth = col.endX - col.startX;
      if (isActive) {
        ctx.save();
        const fontSize = Math.max(10, 12 / scale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(col.name);
        const badgeW = textMetrics.width + 16 / scale;
        const badgeH = 20 / scale;
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        const bx = centerX - badgeW / 2;
        const by = topY - 26 / scale;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, badgeW, badgeH, 4 / scale);
        } else {
          ctx.rect(bx, by, badgeW, badgeH);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(col.name, centerX, topY - 16 / scale);
        ctx.restore();

        // 仅在当前选中的激活列显示清晰端点刻度（直接展示纯数字），防止几十列文字相互横向打架
        ctx.font = `600 ${Math.max(8.5, 9.5 / scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.textAlign = 'left';
        ctx.fillText(`${sc.originVal}`, sc.originX + 2 / scale, topY - 2 / scale);

        ctx.fillStyle = isLight ? '#dc2626' : '#f87171';
        ctx.textAlign = 'right';
        ctx.fillText(`${sc.calibVal}`, sc.calibX - 2 / scale, topY - 2 / scale);
      } else {
        // 未激活列：若列较窄（< 40px），名称以 45 度优雅斜角呈现，杜绝多列名称横向重叠！
        ctx.save();
        ctx.fillStyle = isLight ? '#475569' : 'rgba(255, 255, 255, 0.75)';
        const fontSize = Math.max(9, 10.5 / scale);
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        if (colWidth < 42 && scale < 1.0) {
          ctx.translate(centerX, topY - 6 / scale);
          ctx.rotate(-Math.PI / 4); // 逆时针 45 度斜排
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const shortName = col.name.length > 12 ? col.name.substring(0, 10) + '…' : col.name;
          ctx.fillText(shortName, 0, 0);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const displayName = col.name.length > 12 ? col.name.substring(0, 10) + '…' : col.name;
          ctx.fillText(displayName, centerX, topY - 4 / scale);
        }
        ctx.restore();
      }
    });

    // 组归属条画在所有列之后：它只在数据区上方的一条窄带里，不遮挡任何列内容。
    drawGroupBands(env);

    ctx.restore();
}
