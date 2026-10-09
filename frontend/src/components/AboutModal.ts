import { notify } from '../ui/feedback';

const CURRENT_VERSION = '2.0.0';

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
                  <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: color-mix(in srgb, var(--accent-blue) 15%, transparent); color: var(--accent-blue);">
                    v${CURRENT_VERSION}
                  </span>
                </div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary);">
                  地质地层与古生态多指标图表高精度数字化科研系统
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
              专为第四纪古生态学、古气候学与沉积地层学打造的高精度多指标图表数字化科研系统。针对复杂多列地层图谱 (Polydiagrams) 的高维并列、点位参差与伪空值难题，提供倾斜自校正、智能网格去线、PP-OCRv6 古生物学名识别纠错、等深几何截交与贝叶斯年代学模型提取，直通 R 语言分析与 FAIR 开放数据标准。
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
              <div>• <strong>前端引擎：</strong>TypeScript 7 + HTML5 Canvas 2D + Vite 8 (120 FPS 视口渲染与零框架响应)</div>
              <div>• <strong>古生物 OCR：</strong>PP-OCRv6 拉丁学名识别引擎 (ONNX Runtime 离线推理 + 500+ 分类词典)</div>
              <div>• <strong>贝叶斯年代学 (可选)：</strong>R (≥ 4.2) 或内置 WebAssembly WebR (Bacon / Bchron 模型提取)</div>
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
      const currentVer = CURRENT_VERSION.replace(/^v/, '');

      if (!statusEl) return;

      if (latestTag && latestTag !== currentVer) {
        statusEl.innerHTML = `
          <span style="color: var(--status-warning); font-weight: 600;">
            发现新版本 v${latestTag}！当前为 v${currentVer}。
          </span>
          <a href="${data.html_url || 'https://github.com/chmzs/straditize-pro/releases/latest'}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline; margin-left: 6px;">
            前往下载更新 &rarr;
          </a>
        `;
      } else {
        statusEl.innerHTML = `
          <span style="color: var(--status-success); font-weight: 600;">
            当前已是最新版本 (v${CURRENT_VERSION})。
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
