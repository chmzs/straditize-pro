import { t } from '../i18n';
import type { RpcClient } from '../services/RpcClient';

export class AuthModal {
  private rpcClient: RpcClient;
  private modalEl: HTMLElement | null = null;
  private onSuccess: () => void;

  constructor(rpcClient: RpcClient, onSuccess: () => void) {
    this.rpcClient = rpcClient;
    this.onSuccess = onSuccess;
  }

  public show(): void {
    if (this.modalEl) return;

    const isLight = document.body.classList.contains('theme-light');
    const overlay = document.createElement('div');
    overlay.id = 'auth-gate-modal';
    overlay.className = 'modal-backdrop auth-modal-backdrop';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(10px);background:' +
      (isLight ? 'rgba(241,245,249,0.92)' : 'rgba(15,23,42,0.93)') + ';';

    overlay.innerHTML = `
      <div class="modal-dialog auth-dialog" style="width: min(420px, 92vw); padding: 28px 24px; border-radius: 12px; background: var(--bg-card); border: 1px solid var(--border-color); box-shadow: 0 20px 40px rgba(0,0,0,0.4); text-align: center; display: flex; flex-direction: column; gap: 16px;">
        <div>
          <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: var(--text-heading);">${t('auth.title')}</h3>
          <p style="margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">${t('auth.desc')}</p>
        </div>

        <div id="auth-error-banner" style="display: none; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: var(--accent-red); font-size: 11.5px; padding: 6px 12px; border-radius: 6px;"></div>

        <div style="display: flex; gap: 6px; position: relative;">
          <input type="password" id="auth-password-input" placeholder="${t('auth.placeholder')}" style="flex: 1; padding: 8px 12px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); outline: none;" autofocus />
          <button type="button" id="auth-toggle-pwd" class="tool-btn" style="padding: 4px 10px; font-size: 12px;" title="${t('auth.toggleShow')}">${t('auth.show')}</button>
        </div>

        <div style="display: flex; justify-content: stretch;">
          <button type="button" id="auth-submit-btn" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 16px; font-size: 13px; font-weight: 700;">
            ${t('auth.unlock')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.modalEl = overlay;

    const inp = overlay.querySelector('#auth-password-input') as HTMLInputElement;
    const btn = overlay.querySelector('#auth-submit-btn') as HTMLButtonElement;
    const toggle = overlay.querySelector('#auth-toggle-pwd') as HTMLButtonElement;
    const errBanner = overlay.querySelector('#auth-error-banner') as HTMLElement;

    toggle?.addEventListener('click', () => {
      inp.type = inp.type === 'password' ? 'text' : 'password';
      toggle.textContent = inp.type === 'password' ? t('auth.show') : t('auth.hide');
    });

    const submit = async () => {
      const pwd = inp.value;
      btn.disabled = true;
      btn.textContent = t('auth.verifying');
      errBanner.style.display = 'none';

      const ok = await this.rpcClient.authenticate(pwd);
      btn.disabled = false;
      btn.textContent = t('auth.unlock');

      if (ok) {
        this.close();
        this.onSuccess();
      } else {
        errBanner.textContent = t('auth.failed');
        errBanner.style.display = 'block';
        inp.select();
        inp.focus();
      }
    };

    btn?.addEventListener('click', submit);
    inp?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void submit();
    });

    setTimeout(() => inp?.focus(), 50);
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}
