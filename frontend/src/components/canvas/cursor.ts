/**
 * 画布光标决策（纯函数，可直接单测）。
 *
 * 优先级是产品行为，不是随便排的：
 * 1. 平移中 / 空格 / pan 工具 → grab / grabbing（此时什么都不该抢光标）；
 * 2. ROI 手柄 → 四向 resize（拖手柄时最明确的反馈）；
 * 3. 锚点 → move（可拖的圆点）；
 * 4. 列边界 → col-resize（拖列宽）；
 * 5. 工具自带光标（如 pickTick 的 crosshair）；
 * 6. 工具默认光标。
 *
 * 抽出来的原因：这段原来写在 2400 行类里，靠 6 个 if-else 隐式排序，
 * 想验证"拖 ROI 手柄时是不是 resize"必须起整个画布。现在只喂一个对象。
 */
import type { RoiHandle } from '../../core/tools';

export interface CursorEnv {
  /** 工具默认光标（来自 ToolModeManager 的描述）。 */
  defaultCursor: string;
  /** 工具策略自带光标；已由调用方在平移态下置空。 */
  strategyCursor?: string | null;
  /** 正在拖拽或悬停的 ROI 手柄。 */
  roiHandle?: RoiHandle | null;
  hasAnchor: boolean;
  hasBoundary: boolean;
  /** 步骤 6：指针在列 0 点（绿线）上——拖它改的是轴线粗，不是列宽。 */
  hasZeroLine?: boolean;
  /** 平移进行中（左键已按下拖动）。 */
  isPanning: boolean;
  isSpaceDown: boolean;
  /** 工具本身就是 pan。 */
  modeIsPan: boolean;
  isMouseDown: boolean;
}

function cursorForRoiHandle(handle: RoiHandle): string {
  if (handle === 'tl' || handle === 'br') return 'nwse-resize';
  if (handle === 'tr' || handle === 'bl') return 'nesw-resize';
  if (handle === 't' || handle === 'b') return 'ns-resize';
  return 'ew-resize';
}

export function resolveCanvasCursor(env: CursorEnv): string {
  if (env.isPanning || env.isSpaceDown || env.modeIsPan) {
    // 平移优先级最高：拖图时光标必须始终是 grab/grabbing，别让 hover 抢走。
    return env.isMouseDown ? 'grabbing' : 'grab';
  }
  if (env.roiHandle) return cursorForRoiHandle(env.roiHandle);
  if (env.hasAnchor || env.strategyCursor === 'move') return 'move';
  // 0 点（绿线）与列边界（红线）是两条不同的线：前者调轴线粗、后者调列宽，光标必须能区分。
  if (env.hasZeroLine) return 'ew-resize';
  if (env.hasBoundary || env.strategyCursor === 'col-resize') return 'col-resize';
  if (env.strategyCursor) return env.strategyCursor;
  return env.defaultCursor;
}
