import { t } from '../i18n';
import { RpcClient } from './RpcClient';

/**
 * 数据来源闸门（Data Provenance Gate）
 *
 * 设计原则：面向用户的数据只有一个合法来源 —— 后端真实计算。
 * 历史上后端不可达时会静默降级为 Mock，返回前端编造的分列边界、随机抖动的曲线、
 * 固定名单的属种名，用户无法分辨，可能直接当成科研成果导出。该通路已整体删除。
 *
 * 因此这里没有"进入演示模式"这一退路：没有后端就没有结果，只能重连。
 */
export function showProvenanceGate(message: string): Promise<void> {
  return new Promise((resolve) => {
    const isLight = document.body.classList.contains('theme-light');
    const overlay = document.createElement('div');
    overlay.id = 'provenance-gate';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(10px);background:' +
      (isLight ? 'rgba(241,245,249,0.94)' : 'rgba(15,23,42,0.95)') + ';';
    overlay.innerHTML = `
      <div style="max-width:520px;padding:32px 36px;border-radius:14px;background:var(--bg-card);border:1px solid var(--border-color);box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);">
        <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:var(--text-heading);">${t('banner.backendOffline')}</h2>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:var(--text-secondary);">${message}</p>
        <p style="margin:0 0 20px;font-size:12.5px;line-height:1.65;color:var(--text-muted);">${t('gate.hint')}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="gate-retry" class="ui-btn ui-btn--primary" style="padding:8px 16px;font-size:13px;font-weight:600;">${t('banner.reconnect')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#gate-retry')?.addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

/**
 * 统一的后端失败上报。
 * 移除静默兜底后，后端错误会真的冒泡到这里；必须显式告知用户，
 * 且提供可直接划选和复制的富文本弹窗，取代阻塞且不可复制的原生 window.alert。
 *
 * 只走**一个**通道（可复制的详情弹窗），不叠加 toast：一次失败对应一个通知。
 * 叠加会让同一次失败同时出现在 toast 和弹窗里，用户读两遍同样的信息；
 * 且后端 detail 往往很长，toast 会截断并自动消失，反而不如弹窗可留可复制。
 */
export function reportBackendFailure(actionLabel: string, err: unknown): void {
  const message = (err as Error)?.message || t('error.unknown');
  console.error(`[RPC failure] ${actionLabel}:`, err);

  const existing = document.getElementById('rpc-error-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rpc-error-modal';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);background:rgba(0,0,0,0.65);';

  const fullErrText = `[错误模块] ${actionLabel}\n[错误原因]\n${message}`;

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  overlay.innerHTML = `
    <div class="modal-dialog ui-modal" style="--modal-width: 560px;">
      <div class="ui-modal__header">
        <h3 class="ui-modal__title">${escapeHtml(actionLabel)}失败</h3>
        <button id="rpc-err-close-x" class="ui-icon-btn" aria-label="关闭" title="关闭">&times;</button>
      </div>
      <div class="modal-body ui-modal__body">
        <p class="ui-detail-hint">后端执行操作时报告了以下错误或状态异常：</p>
        <pre class="ui-detail-text">${escapeHtml(message)}</pre>
      </div>
      <div class="ui-modal__footer">
        <button id="rpc-err-copy-btn" class="ui-btn ui-btn--secondary ui-btn--sm">复制错误详情</button>
        <button id="rpc-err-ok-btn" class="ui-btn ui-btn--primary ui-btn--sm">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.querySelector('#rpc-err-close-x')?.addEventListener('click', closeModal);
  overlay.querySelector('#rpc-err-ok-btn')?.addEventListener('click', closeModal);

  const copyBtn = overlay.querySelector('#rpc-err-copy-btn') as HTMLButtonElement | null;
  copyBtn?.addEventListener('click', async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullErrText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = fullErrText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      copyBtn.textContent = '已复制到剪贴板';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = '复制错误详情';
      }, 2000);
    } catch {
      copyBtn.textContent = '复制失败，请手动划选';
    }
  });
}


/** 后端未连接时阻塞启动，直到连上为止 */
export async function ensureDataProvenance(rpcClient: RpcClient): Promise<void> {
  for (;;) {
    await rpcClient.probeBackend();
    if (rpcClient.isAuthNeeded()) return;
    if (rpcClient.getStatus().connected) return;
    if (document.getElementById('auth-gate-modal')) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    await showProvenanceGate(t('error.backendOffline'));
  }
}

/** 离线状态常驻横幅 */
export function mountProvenanceBanner(rpcClient: RpcClient): void {
  const bar = document.createElement('div');
  bar.id = 'provenance-banner';
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99998;display:none;align-items:center;justify-content:center;' +
    'gap:10px;padding:5px 12px;font-size:12px;font-weight:600;letter-spacing:0.2px;';
  document.body.appendChild(bar);

  const render = () => {
    const status = rpcClient.getStatus();
    if (!status.connected) {
      bar.style.display = 'flex';
      bar.style.background = '#b91c1c';
      bar.style.color = '#fff';
      bar.innerHTML =
        `<span>${t('banner.backendLost')}</span>` +
        `<button id="banner-retry" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);color:var(--text-on-accent);border-radius:4px;padding:1px 8px;font-size:11px;cursor:pointer;">${t('banner.reconnect')}</button>`;
      bar.querySelector('#banner-retry')?.addEventListener('click', () => {
        rpcClient.probeBackend().then(render);
      });
    } else {
      bar.style.display = 'none';
    }
    const app = document.getElementById('app');
    if (app) app.style.paddingTop = bar.style.display === 'flex' ? '26px' : '';
  };

  rpcClient.setStatusCallback(render);
  render();
}
