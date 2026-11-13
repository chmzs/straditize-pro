/**
 * 应用内「确认 / 取消」对话框。
 *
 * ## 为什么不用 `window.confirm`
 *
 * 本仓库的 e2e 门禁（`e2e/fixtures.ts` 的 `notices`）把**原生对话框**一律判成
 * "用户被意外打断"：Playwright 默认自动 dismiss 原生 confirm，用例会拿到
 * `false` 且失败信息只剩一句语义不明的超时。迁移到应用内弹窗后，这条门禁
 * 才继续只在"真·意外通知"时报警。
 *
 * ## 形状
 *
 * 复用 `showDetailModal` 的 DOM 约定（`modal-backdrop` / `modal-dialog` /
 * `ui-modal__*`），保持全站弹窗观感一致；`#ui-confirm-*` 这套 id 是 e2e 的
 * 唯一入口，别改。
 */

export interface ConfirmOptions {
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string;
  /** 取消按钮文案，默认「取消」。 */
  cancelText?: string;
  /** 危险操作（删除等）用红色确认按钮。 */
  destructive?: boolean;
}

/**
 * 打开确认框并等待用户选择。
 *
 * 解析为 `true` = 用户点了确认；`false` = 取消、按 ESC 或点背景关闭。
 * 同一个 `#ui-confirm-modal` 重复调用会先移除旧实例，不会叠加。
 */
export function showConfirmDialog(
  title: string,
  message: string,
  options: ConfirmOptions = {}
): Promise<boolean> {
  const confirmText = options.confirmText ?? '确认';
  const cancelText = options.cancelText ?? '取消';

  document.getElementById('ui-confirm-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ui-confirm-modal';
  overlay.className = 'modal-backdrop ui-detail-backdrop';
  overlay.innerHTML = `
    <div class="modal-dialog ui-modal" style="--modal-width: 460px;" role="dialog" aria-modal="true" aria-labelledby="ui-confirm-title">
      <div class="ui-modal__header">
        <h3 class="ui-modal__title" id="ui-confirm-title"></h3>
      </div>
      <div class="ui-modal__body">
        <p class="ui-detail-hint" id="ui-confirm-text"></p>
      </div>
      <div class="ui-modal__footer">
        <button class="ui-btn ui-btn--secondary" id="ui-confirm-cancel">${cancelText}</button>
        <button class="ui-btn ${options.destructive ? 'ui-btn--danger' : 'ui-btn--primary'}" id="ui-confirm-ok">${confirmText}</button>
      </div>
    </div>
  `;

  // 文本一律走 textContent：标题/消息里可能含 ROI 名（用户输入），不能拼进 innerHTML。
  const titleEl = overlay.querySelector('#ui-confirm-title');
  const textEl = overlay.querySelector('#ui-confirm-text');
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = message;

  document.body.appendChild(overlay);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKeydown, true);
      resolve(value);
    };
    const onKeydown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    };
    document.addEventListener('keydown', onKeydown, true);

    overlay.querySelector('#ui-confirm-ok')?.addEventListener('click', () => finish(true));
    overlay.querySelector('#ui-confirm-cancel')?.addEventListener('click', () => finish(false));
    // 点背景 = 取消（与全站其它弹窗一致），但点弹窗本体不算。
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) finish(false);
    });
  });
}
