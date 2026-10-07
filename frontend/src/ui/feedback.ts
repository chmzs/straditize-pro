/**
 * 统一状态反馈通道（UI 设计规范 · 状态反馈）。
 *
 * 规范：面向用户的通知一律走本模块，禁止使用阻塞、不可复制、样式不受控的原生
 * `window.alert`。分两级：
 *
 * - `notify()` / `notifyError()`：非阻塞浮层提示，用于操作结果与校验失败。
 * - `showDetailModal()`：需要用户复制细节的富文本弹窗（后端错误、OCR 解析失败等）。
 *
 * 浮层挂载在 `document.body`，多次调用会叠加而不是互相覆盖，并带 aria-live 播报。
 */

export type FeedbackLevel = 'info' | 'success' | 'warning' | 'danger';

const LEVEL_ROLE: Record<FeedbackLevel, string> = {
  info: 'status',
  success: 'status',
  warning: 'status',
  danger: 'alert',
};

let toastHost: HTMLElement | null = null;

function ensureToastHost(): HTMLElement {
  if (toastHost && toastHost.isConnected) return toastHost;

  const host = document.createElement('div');
  host.className = 'ui-toast-host';
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'false');
  document.body.appendChild(host);
  toastHost = host;
  return host;
}

/** 非阻塞提示。默认 4 秒后自动消失；warning/danger 保留更久。 */
export function notify(message: string, level: FeedbackLevel = 'info', durationMs?: number): void {
  const text = String(message ?? '').trim();
  if (!text) return;

  const host = ensureToastHost();
  const toast = document.createElement('div');
  toast.className = `ui-toast ui-toast--${level}`;
  toast.setAttribute('role', LEVEL_ROLE[level]);
  toast.textContent = text;
  host.appendChild(toast);

  const timeout = durationMs ?? (level === 'danger' ? 8000 : level === 'warning' ? 6000 : 4000);
  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    toast.classList.add('ui-toast--leaving');
    window.setTimeout(() => toast.remove(), 160);
  };

  toast.addEventListener('click', dismiss);
  window.setTimeout(dismiss, timeout);
}

/** 校验失败、操作被拒绝等错误提示。 */
export function notifyError(message: string, durationMs?: number): void {
  notify(message, 'danger', durationMs);
}

/** 把任意抛出物渲染成一行可读文案，避免各处重复 `instanceof Error` 判断。 */
export function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  try {
    const asJson = JSON.stringify(err);
    if (asJson && asJson !== '{}' && asJson !== 'null') return asJson;
  } catch {
    // 循环引用等无法序列化时退化为 String()
  }
  return String(err);
}

/** 便捷组合：提示任意抛出物。 */
export function notifyCaught(prefix: string, err: unknown): void {
  notifyError(`${prefix}${describeError(err)}`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 需要用户复制细节的富文本弹窗。内容可划选复制，替代原生 alert 的单行截断。
 * 同一 id 重复调用会复用同一弹窗，避免叠加。
 */
export function showDetailModal(title: string, detail: string, hint?: string): void {
  const existing = document.getElementById('ui-detail-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ui-detail-modal';
  overlay.className = 'modal-backdrop ui-detail-backdrop';

  overlay.innerHTML = `
    <div class="modal-dialog ui-modal" style="--modal-width: 520px;" role="dialog" aria-modal="true">
      <div class="modal-header ui-modal__header">
        <h3 class="ui-modal__title">${escapeHtml(title)}</h3>
        <button class="ui-icon-btn" data-ui-detail-close aria-label="关闭" title="关闭">&times;</button>
      </div>
      <div class="modal-body ui-modal__body">
        ${hint ? `<p class="ui-detail-hint">${escapeHtml(hint)}</p>` : ''}
        <pre class="ui-detail-text" data-ui-detail-text></pre>
      </div>
      <div class="modal-footer ui-modal__footer">
        <button class="ui-btn ui-btn--secondary" data-ui-detail-copy>复制详情</button>
        <button class="ui-btn ui-btn--primary" data-ui-detail-close>关闭</button>
      </div>
    </div>
  `;

  const textEl = overlay.querySelector('[data-ui-detail-text]') as HTMLElement | null;
  if (textEl) textEl.textContent = detail;

  overlay.querySelectorAll('[data-ui-detail-close]').forEach((el) => {
    el.addEventListener('click', () => overlay.remove());
  });
  overlay.querySelector('[data-ui-detail-copy]')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(`${title}\n${detail}`).then(
      () => notify('已复制详情', 'success'),
      () => notifyError('复制失败，请手动划选文本'),
    );
  });

  document.body.appendChild(overlay);
}
