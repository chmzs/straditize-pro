import { t } from '../i18n';
import { RpcClient } from './RpcClient';

/**
 * 数据来源闸门（Data Provenance Gate）
 * 面向用户的数据只有一个合法来源 —— 后端真实计算。
 */
export function showProvenanceGate(message: string): Promise<void> {
  return new Promise((resolve) => {
    const isLight = document.body.classList.contains('theme-light');
    const overlay = document.createElement('div');
    overlay.id = 'provenance-gate';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(10px);background:' +
      (isLight ? 'rgba(241,245,249,0.94)' : 'rgba(15,23,42,0.95)') +
      ';';
    overlay.innerHTML = `
      <div style="max-width:520px;padding:32px 36px;border-radius:14px;background:var(--bg-card);border:1px solid var(--border-color);box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);">
        <div style="font-size:34px;margin-bottom:10px;">🔌</div>
        <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:var(--text-heading);">${t('banner.backendOffline')}</h2>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:var(--text-secondary);">${message}</p>
        <p style="margin:0 0 20px;font-size:12.5px;line-height:1.65;color:var(--text-muted);">${t('gate.hint')}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="gate-retry" class="btn btn-primary" style="padding:8px 16px;font-size:13px;font-weight:600;">${t('banner.reconnect')}</button>
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
 */
export function reportBackendFailure(actionLabel: string, err: unknown): void {
  const message = (err as Error)?.message || t('error.unknown');
  console.error(`[RPC failure] ${actionLabel}:`, err);
  try {
    window.alert(`${actionLabel}失败：${message}`);
  } catch {
    // ignore
  }

  const existing = document.getElementById('rpc-error-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rpc-error-modal';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);background:rgba(0,0,0,0.65);';

  const fullErrText = `[错误模块] ${actionLabel}\n[错误原因]\n${message}`;

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:520px;width:90%;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 20px 40px rgba(0,0,0,0.4);overflow:hidden;animation:modalEnter 0.2s ease-out;">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border-color);background:var(--bg-tertiary);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">❌</span>
          <h3 style="margin:0;font-size:14px;font-weight:700;color:var(--text-heading);">${escapeHtml(actionLabel)}失败</h3>
        </div>
        <button id="rpc-err-close-x" class="modal-close" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;line-height:1;">×</button>
      </div>
      <div class="modal-body" style="padding:18px;user-select:text;-webkit-user-select:text;">
        <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-secondary);font-weight:500;">
          后端执行操作时报告了以下错误或状态异常：
        </p>
        <div style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:6px;padding:12px;font-family:var(--font-mono);font-size:11.5px;line-height:1.6;color:var(--text-primary);max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;user-select:text;-webkit-user-select:text;">${escapeHtml(message)}</div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--border-color);background:var(--bg-tertiary);">
        <button id="rpc-err-copy-btn" class="tool-btn" style="padding:5px 12px;font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          📋 复制错误详情
        </button>
        <button id="rpc-err-ok-btn" class="btn btn-primary" style="padding:5px 18px;font-size:12px;cursor:pointer;">
          确定
        </button>
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
      copyBtn.textContent = '✅ 已复制到剪贴板';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = '📋 复制错误详情';
      }, 2000);
    } catch {
      copyBtn.textContent = '❌ 复制失败，请手动划选';
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
        `<span>⛔ ${t('banner.backendLost')}</span>` +
        `<button id="banner-retry" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;cursor:pointer;">${t('banner.reconnect')}</button>`;
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
