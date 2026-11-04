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
          const freshCols: Array<Record<string, unknown>> = (fresh as any).columns ?? [];
          for (const freshCol of freshCols) {
            const target = canvasComponent.data.columns.find((c) => c.id === freshCol.id);
            if (!target) continue;
            target.x_ticks = freshCol.x_ticks as typeof target.x_ticks;
            // 「标定已被清空」的提示必须**同批**失效：后端在写组斜率时已清掉该键
            // （roi.py 的 value_per_px 分支），前端若只回填 x_ticks，屏幕上会继续
            // 挂着"需要你重新标定"，与"其实已经能读数"自相矛盾。
            target.x_ticks_dropped = freshCol.x_ticks_dropped as typeof target.x_ticks_dropped;
            target.scaleCalib = freshCol.scaleCalib as typeof target.scaleCalib;
            target.scale_provenance = freshCol.scale_provenance as typeof target.scale_provenance;
          }
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
