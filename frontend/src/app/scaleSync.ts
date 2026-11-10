/**
 * 标度变更后的局部同步（步骤 6 写组斜率 → 后端广播 → 前端只回填标度字段）。
 *
 * ## 为什么不能整表重建
 *
 * 试过 `loadNewDiagram(fresh)`：代价是选中列被清空（`activeTaxaId` 重置），而标定后
 * 面板正依赖选中列；批量标定还会在循环中途打断步骤 6 面板的检测缓存（实测
 * col03/col04 被判"未检测到刻度尺"）。所以这里只把后端算好的 `x_ticks` /
 * `scaleCalib` / `scale_provenance` 填回同名列对象，前端不推导、也不重建。
 *
 * 抽成模块的原因：它同时改画布镜像、侧栏、检查器与页脚，是"一次写入、四处刷新"
 * 的典型，散在 bootstrap 里最容易漏掉其中一处（漏了就是"标定成功但界面不动"）。
 */
import type { RpcClient } from '../services/RpcClient';
import type { GeologyCanvas } from '../components/GeologyCanvas';

export interface ScaleSyncDeps {
  rpcClient: RpcClient;
  getCanvas: () => GeologyCanvas;
  getSidebar: () => { updateData: (data: unknown) => void } | null;
  getInspector: () => { updateData: (data: unknown) => void } | null;
  updateFooter: () => void;
  setHudNotice: (text: string, duration?: number) => void;
}

/** 一列上由后端权威下发的标度字段（`onScaleMutated` 与工程包载入共用同一份）。 */
export interface ScaleSnapshotTarget {
  id?: string;
  x_ticks?: unknown;
  x_ticks_dropped?: unknown;
  scaleCalib?: unknown;
  scale_provenance?: unknown;
}

/**
 * 按列 id 把后端权威标度快照回填到目标列上，返回命中的列数。
 *
 * **只搬后端算好的结果，不在这里推断任何东西。** 前端曾自己实现过一套标度优先级，
 * 支持面比后端窄（只认 `x_ticks`），于是组斜率标定（`value_per_px`，后端会把
 * `x_ticks` 清成 null）在界面上被判"未标定"，而导出却照样有数 —— 见
 * `CoordinateSystem.resolveColumnScale` 的注释与 U-NA-01。
 *
 * 抽成公开函数的原因：这条回填现在有两个调用点（标度变更广播、工程包载入后），
 * 两边必须逐字段完全一致，否则又是一处"只在一半路径上修好"的分叉。
 */
export function applyScaleSnapshot<T extends ScaleSnapshotTarget>(
  targetCols: T[],
  fresh: unknown
): number {
  const freshCols =
    (fresh as { columns?: Array<Record<string, unknown>> } | null)?.columns ?? [];
  let applied = 0;
  for (const freshCol of freshCols) {
    const target = targetCols.find((c) => c.id === (freshCol.id as string | undefined));
    if (!target) continue;
    target.x_ticks = freshCol.x_ticks;
    // 「标定已被清空」的提示必须**同批**失效：后端在写组斜率时已清掉该键
    // （roi.py 的 value_per_px 分支），前端若只回填 x_ticks，屏幕上会继续
    // 挂着"需要你重新标定"，与"其实已经能读数"自相矛盾。
    target.x_ticks_dropped = freshCol.x_ticks_dropped;
    target.scaleCalib = freshCol.scaleCalib;
    target.scale_provenance = freshCol.scale_provenance;
    applied += 1;
  }
  return applied;
}

/** 注册 `onScaleMutated`：120ms 防抖后拉一次权威数据并逐列回填。 */
export function setupScaleSync(deps: ScaleSyncDeps): void {
  const { rpcClient, getCanvas, getSidebar, getInspector, updateFooter, setHudNotice } = deps;
  let timer: number | undefined;

  rpcClient.onScaleMutated = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void (async () => {
        try {
          const fresh = await rpcClient.getDiagramData();
          const canvasComponent = getCanvas();
          applyScaleSnapshot(canvasComponent.data.columns, fresh);
          canvasComponent.requestRender();
          getInspector()?.updateData(canvasComponent.data);
          getSidebar()?.updateData(canvasComponent.data);
          updateFooter();
        } catch (err) {
          setHudNotice(
            `标度已写入，但界面同步失败：${err instanceof Error ? err.message : String(err)}`,
            6000
          );
        }
      })();
    }, 120);
  };
}
