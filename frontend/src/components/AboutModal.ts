import { APP_VERSION, compareVersions } from '../core/appVersion';
import { notify } from '../ui/feedback';

// 版本号**不在这里定义**：唯一事实源是 `frontend/package.json` 的 `version`，
// 由 `vite.config.ts` 在构建期注入（见 `src/core/appVersion.ts`）。

const CITATION_CN = `陈鸿明, 向丽雄*, 王文佳, 欧阳瑶, 闫创子, 李鹏宇, 黄小忠*. (2026). Straditize Pro: 专业地层花粉与古气候图表数字化科研解译系统 (v2.0) [CP/OL]. 兰州大学资源环境学院. https://github.com/chmzs/straditize-pro (*通讯作者).`;

const CITATION_EN = `Chen, H., Xiang, L.*, Wang, W., Ouyang, Y., Yan, C., Li, P., & Huang, X.* (2026). Straditize Pro: Next-Generation Scientific Digitization System for Palynological & Stratigraphic Diagrams (v2.0). College of Earth and Environmental Sciences, Lanzhou University. https://github.com/chmzs/straditize-pro (*Corresponding authors).`;

const CITATION_BIBTEX = `@software{straditize_pro_2026,
  author       = {Chen, Hongming and Xiang, Lixiong and Wang, Wenjia and Ouyang, Yao and Yan, Chuangzi and Li, Pengyu and Huang, Xiaozhong},
  title        = {Straditize Pro: Next-Generation Scientific Digitization System for Palynological & Stratigraphic Diagrams (v2.0)},
  year         = {2026},
  institution  = {College of Earth and Environmental Sciences, Lanzhou University},
  url          = {https://github.com/chmzs/straditize-pro},
  license      = {GPL-3.0-or-later},
  note         = {*Corresponding authors: Lixiong Xiang (xianglx@lzu.edu.cn), Xiaozhong Huang (xzhuang@lzu.edu.cn)}
}`;

export class AboutModal {
  private container: HTMLElement;
  private modalElement: HTMLElement | null = null;
  private checkingUpdate: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(): void {
    if (this.modalElement) {
      this.modalElement.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop about-modal-backdrop';
    this.modalElement = modal;

    modal.innerHTML = `
      <div class="modal-dialog about-dialog ui-modal" style="--modal-width: 680px; max-height: 90vh;">
        <div class="ui-modal__header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            <h3 class="ui-modal__title">关于 Straditize Pro</h3>
          </div>
          <button class="ui-icon-btn" id="about-close-btn" aria-label="关闭" title="关闭">&times;</button>
        </div>

        <div class="ui-modal__body about-modal-body" style="gap: 14px; overflow-y: auto;">
          <!-- 软件主名片与版本 -->
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 16px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-heading);">Straditize Pro</h4>
                  <span id="about-version" style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: color-mix(in srgb, var(--accent-blue) 15%, transparent); color: var(--accent-blue);">
                    v${APP_VERSION}
                  </span>
                </div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary);">
                  地层与古生态多指标图谱数字化工具
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button id="btn-check-update" class="ui-btn ui-btn--secondary ui-btn--sm" style="white-space: nowrap;">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                  </svg>
                  <span>检查更新</span>
                </button>
              </div>
            </div>
            <div id="about-update-status" style="margin-top: 8px; font-size: 11px; min-height: 16px; color: var(--text-muted); display: none;"></div>
          </div>

          <!-- 软件简介 -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">系统介绍</div>
            <p style="margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--text-secondary);">
              多指标地层图谱 (Polydiagrams) 数字化系统，面向第四纪古生态与沉积地层剖面。功能：倾斜自校正、网格线去除、属种名 OCR 识别与词典纠错、等深几何截交、贝叶斯年代-深度模型提取；导出 CSV / XLSX / LiPD / .tar 与 R 绘图脚本。
            </p>
          </div>

          <!-- 作者与研究团队 -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-heading); margin-bottom: 8px;">作者与研发团队</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; font-size: 11.5px;">
              <div>
                <span style="color: var(--text-muted);">主要开发者：</span>
                <strong style="color: var(--text-primary);">陈鸿明</strong>
                <a href="https://github.com/chmzs" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: none; margin-left: 6px;">@chmzs</a>
              </div>
              <div>
                <span style="color: var(--text-muted);">联系邮箱：</span>
                <a href="mailto:chmzs@outlook.com" style="color: var(--accent-blue); text-decoration: none; font-family: var(--font-mono);">chmzs@outlook.com</a>
              </div>
              <div style="grid-column: 1 / -1;">
                <span style="color: var(--text-muted);">所属单位：</span>
                <span style="color: var(--text-primary); font-weight: 600;">兰州大学资源环境学院 黄小忠课题组</span>
                <span style="font-size: 10.5px; color: var(--text-muted); margin-left: 4px;">(College of Earth and Environmental Sciences, Lanzhou University)</span>
              </div>
            </div>
          </div>

          <!-- 必要运行依赖与环境 -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-heading); margin-bottom: 8px;">核心技术与必要依赖</div>
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-secondary);">
              <div>• <strong>后端服务：</strong>Python 3.12+ (<code style="background: var(--bg-tertiary); padding: 1px 4px; border-radius: 4px;">straditize_core</code>，支持 Pixi / Conda / PyPI 环境)</div>
              <div>• <strong>前端引擎：</strong>TypeScript + HTML5 Canvas 2D + Vite</div>
              <div>• <strong>属种名 OCR：</strong>PP-OCR (ONNX Runtime 离线推理) + 属种词典纠错</div>
              <div>• <strong>贝叶斯年代学 (可选)：</strong>R 或内置 WebAssembly WebR (Bacon / Bchron 模型提取)</div>
            </div>
          </div>

          <!-- 开源许可 -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">开源许可协议</div>
            <div style="font-size: 11px; line-height: 1.5; color: var(--text-secondary);">
              本项目基于 <strong>GNU General Public License v3.0 or later (GPL-3.0-or-later)</strong> 开源分发。
              算法原型与底层地层数字化理念继承自 Philipp S. Sommer 原版 Straditize (<a href="https://doi.org/10.21105/joss.01216" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: none;">JOSS 2019</a>)。
            </div>
          </div>

          <!-- 学术引用 -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-heading);">学术引用格式</div>
              <div style="display: flex; gap: 6px;">
                <button id="btn-copy-cite-cn" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 2px 6px; font-size: 10.5px;">复制中文</button>
                <button id="btn-copy-cite-en" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 2px 6px; font-size: 10.5px;">复制英文</button>
                <button id="btn-copy-cite-bib" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 2px 6px; font-size: 10.5px;">复制 BibTeX</button>
              </div>
            </div>
            <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 10px; font-size: 10.5px; font-family: var(--font-mono); line-height: 1.5; color: var(--text-primary); max-height: 110px; overflow-y: auto;">
              ${CITATION_CN}
            </div>
          </div>
        </div>

        <div class="ui-modal__footer" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px; font-size: 11px;">
            <a href="https://chmzs.github.io/straditize-pro/" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: none; display: flex; align-items: center; gap: 4px;">
              <span>官方主页</span>
            </a>
            <a href="https://github.com/chmzs/straditize-pro" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: none; display: flex; align-items: center; gap: 4px;">
              <span>GitHub 源码</span>
            </a>
          </div>
          <button class="ui-btn ui-btn--primary ui-btn--sm" id="about-confirm-btn">确定</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);
    this.bindEvents(modal);
  }

  public close(): void {
    if (this.modalElement) {
      this.modalElement.remove();
      this.modalElement = null;
    }
  }

  private bindEvents(modal: HTMLElement): void {
    modal.querySelector('#about-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#about-confirm-btn')?.addEventListener('click', () => this.close());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.close();
      }
    });

    // 复制引用
    modal.querySelector('#btn-copy-cite-cn')?.addEventListener('click', () => {
      void this.copyText(CITATION_CN, '中文引用已复制到剪贴板');
    });
    modal.querySelector('#btn-copy-cite-en')?.addEventListener('click', () => {
      void this.copyText(CITATION_EN, '英文引用已复制到剪贴板');
    });
    modal.querySelector('#btn-copy-cite-bib')?.addEventListener('click', () => {
      void this.copyText(CITATION_BIBTEX, 'BibTeX 引用已复制到剪贴板');
    });

    // 检查更新
    modal.querySelector('#btn-check-update')?.addEventListener('click', () => {
      void this.handleCheckUpdate(modal);
    });
  }

  private async copyText(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      notify(successMessage, 'success', 3000);
    } catch {
      // 剪贴板 API 备选方案
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      notify(successMessage, 'success', 3000);
    }
  }

  private async handleCheckUpdate(modal: HTMLElement): Promise<void> {
    if (this.checkingUpdate) return;
    this.checkingUpdate = true;

    const statusEl = modal.querySelector('#about-update-status') as HTMLElement | null;
    const btn = modal.querySelector('#btn-check-update') as HTMLButtonElement | null;
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = `<span style="color: var(--accent-blue);">正在连接 GitHub 检查最新版本...</span>`;
    }
    if (btn) btn.disabled = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch('https://api.github.com/repos/chmzs/straditize-pro/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const latestTag = String(data.tag_name || '').replace(/^v/, '');
      const currentVer = APP_VERSION.replace(/^v/, '');

      if (!statusEl) return;

      // 语义化比较，不是字符串不等比较：`'2.0.10' < '2.0.9'` 在字典序下成立，
      // 字符串比较会把新版判成旧版。cmp 的三向语义见 core/appVersion.ts。
      const cmp = latestTag && currentVer ? compareVersions(latestTag, currentVer) : 0;

      if (!currentVer) {
        // 构建期未注入版本时如实说"不知道"，不假装能比较。
        statusEl.innerHTML = `
          <span style="color: var(--status-warning); font-weight: 600;">
            无法读取当前构建的版本号，跳过版本比较。
          </span>
          <a href="${data.html_url || 'https://github.com/chmzs/straditize-pro/releases/latest'}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline; margin-left: 6px;">
            前往 Releases 页面 &rarr;
          </a>
        `;
      } else if (!latestTag) {
        statusEl.innerHTML = `
          <span style="color: var(--status-warning); font-weight: 600;">
            无法从 GitHub Release 读到版本号，当前为 v${currentVer}。
          </span>
        `;
      } else if (cmp > 0) {
        statusEl.innerHTML = `
          <span style="color: var(--status-warning); font-weight: 600;">
            发现新版本 v${latestTag}，当前为 v${currentVer}。
          </span>
          <a href="${data.html_url || 'https://github.com/chmzs/straditize-pro/releases/latest'}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline; margin-left: 6px;">
            前往下载更新 &rarr;
          </a>
        `;
      } else if (cmp < 0) {
        // 本地构建比线上最新发布还新（预发布 / 本地打包），不能说"已是最新"。
        statusEl.innerHTML = `
          <span style="color: var(--status-success); font-weight: 600;">
            当前版本 v${currentVer} 高于线上最新发布 v${latestTag}。
          </span>
        `;
      } else {
        statusEl.innerHTML = `
          <span style="color: var(--status-success); font-weight: 600;">
            当前已是最新版本 (v${currentVer})。
          </span>
        `;
      }
    } catch (err: any) {
      if (statusEl) {
        statusEl.innerHTML = `
          <span style="color: var(--text-muted);">
            检查更新超时或无法连接 GitHub：可直接访问
            <a href="https://github.com/chmzs/straditize-pro/releases/latest" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline;">Releases 页面</a>
            手动查看。
          </span>
        `;
      }
    } finally {
      this.checkingUpdate = false;
      if (btn) btn.disabled = false;
    }
  }
}
