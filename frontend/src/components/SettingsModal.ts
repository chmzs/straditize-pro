import { RpcClient, SystemConfig } from '../services/RpcClient';
import { getLocale, setLocale, Locale, t } from '../i18n';

export class SettingsModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private onSaveCallback?: () => void;
  private modalElement: HTMLElement | null = null;
  private initialThemeIsLight: boolean = true;

  constructor(
    container: HTMLElement,
    rpcClient: RpcClient,
    onSave?: () => void
  ) {
    this.container = container;
    this.rpcClient = rpcClient;
    this.onSaveCallback = onSave;
  }

  public async open(): Promise<void> {
    if (this.modalElement) {
      this.modalElement.remove();
    }

    this.initialThemeIsLight = document.body.classList.contains('theme-light');

    // 基础配置状态
    let config: SystemConfig = {
      remote_access_enabled: false,
      allowed_hosts: ['127.0.0.1', 'localhost'],
      locale: getLocale(),
      theme: this.initialThemeIsLight ? 'light' : 'dark',
      rpc_endpoint: this.rpcClient.getStatus().endpoint,
      webmcp_endpoint: '/mcp',
      is_desktop_mode: this.rpcClient.getStatus().isDesktopMode,
      connected: this.rpcClient.getStatus().connected,
    };

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop settings-modal-backdrop';
    this.modalElement = modal;

    const currentLoc = getLocale();
    const isLight = this.initialThemeIsLight;
    const isRemote = Boolean(config.remote_access_enabled);
    const hostsStr = Array.isArray(config.allowed_hosts)
      ? config.allowed_hosts.join(', ')
      : String(config.allowed_hosts || '');
    const isConnected = this.rpcClient.getStatus().connected;

    modal.innerHTML = `
      <div class="modal-dialog settings-dialog" style="width: min(640px, 94vw); max-height: 90vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding: 12px 18px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-heading);">${t('settings.title')} (Settings)</h3>
          </div>
          <button class="close-btn" id="settings-close-btn" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted); padding: 0 4px;">&times;</button>
        </div>

        <div class="modal-body settings-modal-body" style="padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; flex: 1;">
          <!-- 一、通用偏好 -->
          <div class="settings-section" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 14px 16px;">
            <div style="font-weight: 700; font-size: 13px; color: var(--text-heading); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🌐</span>
              <span>${t('settings.preferences')}</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              <!-- 语言切换 -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <label for="settings-language" style="font-size: 12px; color: var(--text-primary); font-weight: 500;">
                  • ${t('settings.language')} (Language):
                </label>
                <select id="settings-language" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); min-width: 160px;">
                  <option value="zh-CN" ${currentLoc === 'zh-CN' ? 'selected' : ''}>简体中文 (zh-CN)</option>
                  <option value="en" ${currentLoc === 'en' ? 'selected' : ''}>English (en)</option>
                </select>
              </div>

              <!-- 主题外观 -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12px; color: var(--text-primary); font-weight: 500;">
                  • ${t('settings.appearance')} (Appearance):
                </span>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <label style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-primary); cursor: pointer;">
                    <input type="radio" name="settings-theme" id="theme-light-radio" value="light" ${isLight ? 'checked' : ''} style="cursor: pointer;" />
                    <span>☀️ ${t('settings.themeLight')}</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-primary); cursor: pointer;">
                    <input type="radio" name="settings-theme" id="theme-dark-radio" value="dark" ${!isLight ? 'checked' : ''} style="cursor: pointer;" />
                    <span>🌙 ${t('settings.themeDark')}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- 二、远程访问与网关 -->
          <div class="settings-section" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 14px 16px;">
            <div style="font-weight: 700; font-size: 13px; color: var(--text-heading); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🌐</span>
              <span>${t('settings.remote')}</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              <!-- 远程连接开关 -->
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <label for="settings-remote-toggle" style="font-size: 12px; color: var(--text-primary); font-weight: 500; display: flex; align-items: center; gap: 6px;">
                    <span>• ${t('settings.remoteToggle')}:</span>
                    <span id="remote-toggle-badge" style="font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 12px; background: ${isRemote ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.2)'}; color: ${isRemote ? '#10b981' : 'var(--text-muted)'};">
                      ${isRemote ? '[ ON ]' : '[ OFF ]'}
                    </span>
                  </label>
                  <label class="switch" style="position: relative; display: inline-block; width: 38px; height: 20px;">
                    <input type="checkbox" id="settings-remote-toggle" ${isRemote ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;" />
                    <span class="slider round" style="position: absolute; cursor: pointer; inset: 0; background-color: ${isRemote ? '#10b981' : '#64748b'}; transition: .3s; border-radius: 20px;"></span>
                  </label>
                </div>
                <small style="font-size: 11px; line-height: 1.5; color: var(--text-secondary);">
                  ${t('settings.remoteDesc')}
                </small>
              </div>

              <!-- 访问白名单 -->
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label for="settings-allowed-hosts" style="font-size: 12px; color: var(--text-primary); font-weight: 500;">
                  • ${t('settings.allowedHosts')}:
                </label>
                <textarea id="settings-allowed-hosts" rows="2" placeholder="192.168.1.*, 100.*, my-workstation.lan" style="width: 100%; box-sizing: border-box; padding: 6px 10px; font-size: 11.5px; font-family: var(--font-mono); border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); resize: vertical;">${hostsStr}</textarea>
                <small style="font-size: 10.5px; color: var(--text-muted); line-height: 1.4;">
                  ${t('settings.allowedHostsHint')}
                </small>
              </div>

              <!-- 访问保护密码 -->
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label for="settings-remote-password" style="font-size: 12px; color: var(--text-primary); font-weight: 500; display: flex; align-items: center; justify-content: space-between;">
                  <span>• ${t('settings.remotePassword')}:</span>
                  <span id="remote-pwd-status-badge" style="font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: rgba(148,163,184,0.15); color: var(--text-muted);">[免密]</span>
                </label>
                <div style="display: flex; gap: 6px;">
                  <input type="password" id="settings-remote-password" placeholder="${t('settings.remotePasswordHint')}" style="flex: 1; padding: 5px 10px; font-size: 11.5px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
                  <button type="button" id="btn-toggle-remote-pwd" class="tool-btn" style="padding: 2px 8px; font-size: 12px;" title="${t('auth.toggleShow')}">👁️</button>
                </div>
                <small style="font-size: 10.5px; color: var(--text-muted); line-height: 1.4;">
                  ${t('settings.remotePasswordHint')}
                </small>
              </div>
            </div>
          </div>

          <!-- 三、后端连接与 WebMCP 状态 -->
          <div class="settings-section" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 14px 16px;">
            <div style="font-weight: 700; font-size: 13px; color: var(--text-heading); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🔌</span>
              <span>${t('settings.backend')}</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              <!-- JSON-RPC 服务地址 -->
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label for="settings-rpc-endpoint" style="font-size: 12px; color: var(--text-primary); font-weight: 500; white-space: nowrap;">
                  • ${t('settings.rpcEndpoint')}:
                </label>
                <div style="display: flex; gap: 6px; flex: 1; justify-content: flex-end; max-width: 380px;">
                  <input type="text" id="settings-rpc-endpoint" value="${config.rpc_endpoint || 'http://127.0.0.1:8765/rpc'}" style="flex: 1; padding: 4px 8px; font-size: 11px; font-family: var(--font-mono); border-radius: 5px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
                  <button id="btn-settings-probe-rpc" class="tool-btn" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;">${t('settings.probe')}</button>
                </div>
              </div>

              <!-- 运行模式 -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12px; color: var(--text-primary); font-weight: 500;">
                  • ${t('settings.runningMode')}:
                </span>
                <span id="settings-status-pill" class="status-pill ${isConnected ? 'online' : 'mock'}" style="padding: 2px 8px; font-size: 11px;">
                  <span class="status-dot"></span>
                  <span id="settings-status-text" class="status-text">${isConnected ? t('settings.connected') : t('settings.disconnected')}</span>
                </span>
              </div>

              <!-- WebMCP 桥接端点 -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12px; color: var(--text-primary); font-weight: 500;">
                  • ${t('settings.webmcpEndpoint')}:
                </span>
                <div style="font-size: 11.5px; color: var(--text-secondary);">
                  <code style="background: var(--bg-card); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); color: var(--accent-blue);">/mcp</code>
                  <span style="margin-left: 6px; font-size: 10.5px; color: var(--text-muted);">${t('settings.webmcpDesc')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="padding: 12px 18px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px;">
          <button class="btn btn-secondary" id="btn-settings-cancel" style="padding: 6px 14px; font-size: 12px;">${t('settings.cancel')}</button>
          <button class="btn btn-primary" id="btn-settings-save" style="padding: 6px 16px; font-size: 12px; font-weight: 600;">${t('settings.save')}</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    // 异步同步后端已持久化的配置
    if (this.rpcClient.getStatus().connected) {
      this.rpcClient.getSystemConfig().then((remoteCfg) => {
        if (!remoteCfg || !this.modalElement) return;
        if (typeof remoteCfg.remote_access_enabled === 'boolean') {
          remoteToggle.checked = remoteCfg.remote_access_enabled;
          remoteToggle.dispatchEvent(new Event('change'));
        }
        if (remoteCfg.allowed_hosts) {
          const hostsArea = modal.querySelector('#settings-allowed-hosts') as HTMLTextAreaElement;
          if (hostsArea && !hostsArea.value) {
            hostsArea.value = Array.isArray(remoteCfg.allowed_hosts)
              ? remoteCfg.allowed_hosts.join(', ')
              : String(remoteCfg.allowed_hosts);
          }
        }
        const pwdBadge = modal.querySelector('#remote-pwd-status-badge') as HTMLElement;
        const pwdInput = modal.querySelector('#settings-remote-password') as HTMLInputElement;
        if (remoteCfg.has_remote_password) {
          if (pwdBadge) {
            pwdBadge.textContent = '[已设密码]';
            pwdBadge.style.color = '#10b981';
            pwdBadge.style.background = 'rgba(34, 197, 94, 0.15)';
          }
          if (pwdInput) {
            pwdInput.placeholder = '留空保持原密码；输入新密码修改；输入 CLEAR 清除';
          }
        }
      }).catch(() => {});
    }

    // 绑定交互事件
    const pwdInput = modal.querySelector('#settings-remote-password') as HTMLInputElement;
    const togglePwdBtn = modal.querySelector('#btn-toggle-remote-pwd') as HTMLButtonElement;
    togglePwdBtn?.addEventListener('click', () => {
      if (pwdInput) {
        pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
      }
    });

    const closeModal = () => {
      // 若取消，复原主题预览
      if (this.initialThemeIsLight) {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.remove('theme-light');
      }
      modal.remove();
      this.modalElement = null;
    };

    modal.querySelector('#settings-close-btn')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-settings-cancel')?.addEventListener('click', closeModal);

    // 主题即时渲染预览
    const lightRadio = modal.querySelector('#theme-light-radio') as HTMLInputElement;
    const darkRadio = modal.querySelector('#theme-dark-radio') as HTMLInputElement;

    lightRadio?.addEventListener('change', () => {
      if (lightRadio.checked) {
        document.body.classList.add('theme-light');
      }
    });

    darkRadio?.addEventListener('change', () => {
      if (darkRadio.checked) {
        document.body.classList.remove('theme-light');
      }
    });

    // 远程开关视觉状态联动
    const remoteToggle = modal.querySelector('#settings-remote-toggle') as HTMLInputElement;
    const remoteBadge = modal.querySelector('#remote-toggle-badge') as HTMLElement;
    const slider = modal.querySelector('.slider') as HTMLElement;

    remoteToggle?.addEventListener('change', () => {
      const active = remoteToggle.checked;
      if (remoteBadge) {
        remoteBadge.textContent = active ? '[ ON ]' : '[ OFF ]';
        remoteBadge.style.color = active ? '#10b981' : 'var(--text-muted)';
        remoteBadge.style.background = active ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.2)';
      }
      if (slider) {
        slider.style.backgroundColor = active ? '#10b981' : '#64748b';
      }
    });

    // 探测 RPC 端点
    const probeBtn = modal.querySelector('#btn-settings-probe-rpc') as HTMLButtonElement;
    const rpcInput = modal.querySelector('#settings-rpc-endpoint') as HTMLInputElement;
    const statusPill = modal.querySelector('#settings-status-pill') as HTMLElement;
    const statusText = modal.querySelector('#settings-status-text') as HTMLElement;

    probeBtn?.addEventListener('click', async () => {
      const endpoint = rpcInput?.value?.trim();
      probeBtn.disabled = true;
      probeBtn.textContent = t('settings.probing');
      try {
        const st = await this.rpcClient.probeBackend(endpoint);
        if (statusPill && statusText) {
          statusPill.className = `status-pill ${st.connected ? 'online' : 'mock'}`;
          statusText.textContent = st.connected ? t('settings.connected') : t('settings.disconnected');
        }
      } finally {
        probeBtn.disabled = false;
        probeBtn.textContent = t('settings.probe');
      }
    });

    // 保存并应用
    const saveBtn = modal.querySelector('#btn-settings-save') as HTMLButtonElement;
    saveBtn?.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      const langVal = (modal.querySelector('#settings-language') as HTMLSelectElement).value as Locale;
      const themeVal = (modal.querySelector('input[name="settings-theme"]:checked') as HTMLInputElement)?.value || 'light';
      const remoteVal = (modal.querySelector('#settings-remote-toggle') as HTMLInputElement).checked;
      const hostsVal = (modal.querySelector('#settings-allowed-hosts') as HTMLTextAreaElement).value;
      const hostsList = hostsVal
        .split(/[,;\n\r]+/)
        .map((h) => h.trim())
        .filter(Boolean);

      // 1. 同步主题并持久化
      localStorage.setItem('straditize-theme', themeVal);
      if (themeVal === 'light') {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.remove('theme-light');
      }
      this.initialThemeIsLight = themeVal === 'light';

      // 2. 同步语言并即时重绘
      if (langVal !== getLocale()) {
        setLocale(langVal);
      }

      this.onSaveCallback?.();
      modal.remove();
      this.modalElement = null;

      // 3. 异步同步至后端 RPC 持久化与动态白名单
      try {
        if (this.rpcClient.getStatus().connected) {
          const updates: any = {
            remote_access_enabled: remoteVal,
            allowed_hosts: hostsList,
            locale: langVal,
            theme: themeVal,
          };
          const pwdVal = pwdInput?.value?.trim() || '';
          if (pwdVal === 'CLEAR') {
            updates.remote_password = '';
          } else if (pwdVal) {
            updates.remote_password = pwdVal;
          }
          await this.rpcClient.updateSystemConfig(updates);
        }
      } catch (err) {
        console.warn('[SettingsModal] 保存远程配置到后端失败（可能处于离线模式）:', err);
      }
    });
  }

  public close(): void {
    if (this.modalElement) {
      if (this.initialThemeIsLight) {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.remove('theme-light');
      }
      this.modalElement.remove();
      this.modalElement = null;
    }
  }
}
