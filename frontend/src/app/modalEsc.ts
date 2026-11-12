/**
 * 全局 Esc 关闭模态（界面诚实性修复）。
 *
 * ## 为什么需要单独一个模块
 * 项目里有 10+ 处各自手写的 `modal-backdrop`（导出、设置、元数据、年代模型、OCR、
 * 词汇表、粘贴样本、详情弹层…），没有统一的模态基类。逐个加 keydown 既易漏又易漂移，
 * 所以这里做**一个**全局监听：找最上层 backdrop，点它自己的关闭按钮。
 *
 * ## 两条刻意的限制
 * 1. **不直接 remove DOM**：关闭要走模态自己的处理函数，否则它注册的监听、滚动锁、
 *    未保存状态全都留在原地（历史上就出现过 backdrop 消失但状态没清的情况）。
 * 2. **没有关闭按钮就不猜**：像 ProvenanceGate / AuthModal 这种阻断式遮罩不该被 Esc
 *    关掉，它们内部没有关闭按钮，于是这里直接返回。
 */
const CLOSE_SELECTOR = [
  '[data-ui-detail-close]',
  '#export-modal-close',
  '#modal-close-paste',
  '.modal-close',
  '.ui-modal__header .ui-icon-btn',
].join(', ');

export function installModalEscape(target: Document = document): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;

    const backdrops = Array.from(target.querySelectorAll<HTMLElement>('.modal-backdrop'));
    if (backdrops.length === 0) return;

    // 最后插入的那个通常在最上层（z-index 也更高），从后往前找第一个带关闭按钮的
    for (let i = backdrops.length - 1; i >= 0; i -= 1) {
      const close = backdrops[i].querySelector<HTMLElement>(CLOSE_SELECTOR);
      if (close) {
        e.preventDefault();
        close.click();
        return;
      }
    }
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
