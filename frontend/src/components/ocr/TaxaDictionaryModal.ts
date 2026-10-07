import { RpcClient } from '../../services/RpcClient';
import { notifyError } from '../../ui/feedback';

export class TaxaDictionaryModal {
  private rpcClient: RpcClient;
  private onDictSaved?: () => Promise<void> | void;
  private dictModalEl: HTMLElement | null = null;

  constructor(rpcClient: RpcClient, onDictSaved?: () => Promise<void> | void) {
    this.rpcClient = rpcClient;
    this.onDictSaved = onDictSaved;
  }

  /**
   * 读取后端词汇表统计并刷新指定徽标元素
   */
  public static async refreshDictBadge(badgeEl: HTMLElement | null, rpcClient: RpcClient): Promise<void> {
    if (!badgeEl) return;
    try {
      const summary = await rpcClient.getTaxaDict();
      badgeEl.textContent = `内置 ${summary.builtin_pollen_count} 花粉 + ${summary.builtin_npp_count} 微体指标 · 自定义 ${summary.custom_count}`;
      badgeEl.setAttribute(
        'title',
        `内置花粉 ${summary.builtin_pollen_count} 条 / 内置微体古生物(NPP) ${summary.builtin_npp_count} 条 / 用户自定义 ${summary.custom_count} 条\n词汇表文件: ${summary.path}`
      );
    } catch (err: any) {
      badgeEl.textContent = 'PP-OCRv6 + 内置词典';
      console.warn('getTaxaDict failed:', err?.message || err);
    }
  }

  /**
   * 词汇表管理弹窗：查看内置统计、列出用户自定义条目、导入/粘贴补充词汇。
   *
   * 格式：每行 `中文名,拉丁名[,分组]`，也支持制表符分隔与 `#` 注释。
   * 自定义词汇与内置词典并存（冗余保留），同名时以用户输入为准。
   */
  public async open(): Promise<void> {
    this.close();

    let summary;
    try {
      summary = await this.rpcClient.getTaxaDict();
    } catch (err: any) {
      notifyError(`无法读取词汇表: ${err?.message || err}`);
      return;
    }

    const dictModal = document.createElement('div');
    dictModal.className = 'modal-backdrop';
    dictModal.style.zIndex = '10000';
    dictModal.innerHTML = `
      <div class="modal-dialog" style="width: min(760px, 94vw); max-height: 88vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="padding: 10px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="font-size: 13.5px; font-weight: 700;">属种词汇表</h3>
          </div>
          <button class="close-btn" id="dict-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="padding: 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;">
          <div class="tip-card" style="margin: 0; padding: 8px 10px; border-left: 3px solid #7c3aed; background: rgba(124, 58, 237, 0.06);">
            <p style="font-size: 11px; line-height: 1.6; color: var(--text-primary); margin: 0;">
              <strong>内置词典:</strong>
              花粉与孢子 <strong>${summary.builtin_pollen_count}</strong> 条 +
              微体古生物 / NPP（绿藻、硅藻、摇蚊、介形虫、粪生真菌孢子等）<strong>${summary.builtin_npp_count}</strong> 条。<br>
              <strong>自定义词汇:</strong> <strong>${summary.custom_count}</strong> 条。
              自定义条目与内置词典<strong>并存冗余保留</strong>，不会被内置词典覆盖。
            </p>
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px;">
              导入补充词汇（<strong>可直接粘贴期刊图版说明</strong>，或每行一条 <code>中文名,拉丁名[,分组]</code>）
            </label>
            <textarea id="dict-import-input" rows="7" style="width: 100%; font-family: var(--font-mono); font-size: 11px; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;" placeholder="示例 1（直接粘贴论文图版说明，支持硬换行与 a), b) 多键前缀）：&#10;图版Ⅱ。a), b) Pediastrum boryanum var. boryanum; c) Pediastrum boryanum var. longicorne type 1; f) Pediastrum cf. argentinense; k), l) Pediastrum asymmetricum&#10;&#10;示例 2（每行一条）：&#10;水绵属,Spirogyra,绿藻类&#10;新疆落叶松,Larix sibirica,地方特有种"></textarea>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
              <button class="tool-btn" id="dict-upload-file" style="font-size: 10.5px; padding: 3px 8px;">从 CSV / TXT 文件导入</button>
              <input type="file" id="dict-file-input" accept=".csv,.txt,.tsv" style="display: none;" />
              <label style="font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="dict-replace-mode" />
                <span>清空已有自定义条目后写入（默认追加）</span>
              </label>
              <span id="dict-import-hint" style="font-size: 10.5px; color: var(--text-muted);"></span>
            </div>
            <div id="dict-import-preview" style="margin-top: 6px; font-size: 10.5px; color: var(--text-secondary); line-height: 1.7; max-height: 96px; overflow-y: auto;"></div>
          </div>

          <div>
            <strong style="font-size: 11px; display: block; margin-bottom: 4px;">当前自定义条目 (${summary.custom_count})</strong>
            <div id="dict-custom-list" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; padding: 6px; font-size: 10.5px; color: var(--text-secondary); line-height: 1.7;">
              ${summary.custom.length === 0
                ? '<em style="color: var(--text-muted);">暂无自定义条目</em>'
                : summary.custom.map((it) => `<div><code>${it.zh}</code> → <strong>${it.latin}</strong> <span style="color:var(--text-muted);">[${it.group}]</span></div>`).join('')}
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; word-break: break-all;">
              词汇表文件: <code>${summary.path}</code>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px;">
          <button class="btn btn-secondary" id="dict-cancel-btn">关闭</button>
          <button class="btn btn-primary" id="dict-save-btn" style="background: linear-gradient(135deg, #7c3aed, #a855f7);">保存并应用</button>
        </div>
      </div>
    `;

    document.body.appendChild(dictModal);
    this.dictModalEl = dictModal;

    const closeDict = () => this.close();
    dictModal.querySelector('#dict-close-btn')?.addEventListener('click', closeDict);
    dictModal.querySelector('#dict-cancel-btn')?.addEventListener('click', closeDict);

    const fileInput = dictModal.querySelector('#dict-file-input') as HTMLInputElement;
    const textarea = dictModal.querySelector('#dict-import-input') as HTMLTextAreaElement;
    const hint = dictModal.querySelector('#dict-import-hint') as HTMLElement;
    const preview = dictModal.querySelector('#dict-import-preview') as HTMLElement;

    // 解析统一走后端：图版说明 / 名单两种形态在前端不重复实现，避免两套解析漂移。
    let previewTimer: number | null = null;
    const refreshPreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = window.setTimeout(async () => {
        const text = textarea.value.trim();
        if (!text) {
          preview.innerHTML = '';
          hint.textContent = '';
          return;
        }
        preview.innerHTML = '<em style="color: var(--text-muted);">解析中…</em>';
        try {
          const res = await this.rpcClient.parseTaxaText(text);
          if (res.count === 0) {
            preview.innerHTML = '<span style="color: var(--accent-amber, #d97706);">未解析出任何词汇，请检查格式</span>';
            return;
          }
          const kind = res.format === 'figure_caption' ? '识别为期刊图版说明' : '识别为名单';
          hint.textContent = `${kind} · 解析出 ${res.count} 条`;
          preview.innerHTML =
            `<strong>${kind}</strong>，将写入 ${res.count} 条：` +
            res.entries
              .map((e) => `<code style="color: var(--accent-blue, #0284c7);">${e.latin_name}</code>`)
              .join('、');
        } catch (err: any) {
          preview.innerHTML = `<span style="color: var(--accent-red, #dc2626);">解析失败: ${err?.message || err}</span>`;
        }
      }, 220);
    };
    textarea?.addEventListener('input', refreshPreview);

    dictModal.querySelector('#dict-upload-file')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n${text}` : text;
        hint.textContent = `已载入 ${file.name}`;
        refreshPreview();
      } catch (err: any) {
        hint.textContent = `读取失败: ${err?.message || err}`;
      }
      fileInput.value = '';
    });

    dictModal.querySelector('#dict-save-btn')?.addEventListener('click', async () => {
      const rawText = textarea.value.trim();
      const replaceMode = (dictModal.querySelector('#dict-replace-mode') as HTMLInputElement)?.checked ?? false;
      if (!rawText && !replaceMode) {
        hint.textContent = '请输入至少一条词汇';
        return;
      }
      const saveBtn = dictModal.querySelector('#dict-save-btn') as HTMLButtonElement;
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';
      try {
        const res = await this.rpcClient.saveCustomTaxa(
          { rawText },
          { mode: replaceMode ? 'replace' : 'append' }
        );
        hint.textContent = `已写入 ${res.added} 条，共 ${res.custom_count} 条自定义词汇`;
        await this.onDictSaved?.();
        closeDict();
      } catch (err: any) {
        hint.textContent = `保存失败: ${err?.message || err}`;
        saveBtn.disabled = false;
        saveBtn.textContent = '保存并应用';
      }
    });
  }

  public close(): void {
    if (this.dictModalEl) {
      this.dictModalEl.remove();
      this.dictModalEl = null;
    }
  }
}
