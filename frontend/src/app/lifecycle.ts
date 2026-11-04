/**
 * 应用生命周期守卫：离开前确认 + 关停抑制。
 *
 * 抽出来的理由：它靠一个**闭包变量**（`isShuttingDown`）在"用户主动退出"与
 * "浏览器正常卸载"之间区分，而这个变量还被 `window.__straditize_suppress_beforeunload`
 * 从外部改写。这种"隐式全局开关"埋在 800 行函数里没人找得到，单独成文件后
 * 谁改写它、为什么改写一目了然。
 */
import type { HistoryManager } from '../core/HistoryManager';

export function installBeforeUnloadGuard(history: HistoryManager): void {
  let isShuttingDown = false;
  (window as any).__straditize_suppress_beforeunload = () => {
    isShuttingDown = true;
  };

  window.addEventListener('beforeunload', (e) => {
    if (isShuttingDown) return;
    if (history.canUndo()) {
      e.preventDefault();
      e.returnValue = '您有未保存的地学数字化工程修改，确定离开吗？';
    }
  });
}
