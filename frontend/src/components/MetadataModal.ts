import { RpcClient } from '../services/RpcClient';

export interface PaperMetadata {
  publication: {
    doi: string;
    title: string;
    authors: string[];
    journal: string;
    year: number | null;
    source?: string;
  };
  site: {
    site_name: string;
    latitude: string;
    longitude: string;
    elevation_m: string;
    archive_type: string;
    source?: string;
    conflict?: boolean;
    candidates?: string[];
  };
  chronology: {
    age_model: string;
    age_range: string;
    dating_method: string;
    cal_curve: string;
    source?: string;
  };
  technical: {
    pollen_extraction_method: string;
    laboratory: string;
    sampling_interval_cm: string;
    source?: string;
  };
  quality: {
    quality_notes: string;
    source?: string;
  };
}

export class MetadataModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private modalEl: HTMLElement | null = null;
  private metadata: PaperMetadata = {
    publication: { doi: '', title: '', authors: [], journal: '', year: null },
    site: { site_name: '', latitude: '', longitude: '', elevation_m: '', archive_type: 'lake sediment' },
    chronology: { age_model: 'Bacon', age_range: '', dating_method: '14C AMS', cal_curve: 'IntCal20' },
    technical: { pollen_extraction_method: 'HF digestion / sieving', laboratory: '', sampling_interval_cm: '2' },
    quality: { quality_notes: 'Unobserved taxa strictly filled as 0.00 (Zero-Abundance standard).' },
  };

  private onSaveCallback?: (meta: PaperMetadata) => void;

  constructor(container: HTMLElement, rpcClient: RpcClient, onSave?: (meta: PaperMetadata) => void) {
    this.container = container;
    this.rpcClient = rpcClient;
    this.onSaveCallback = onSave;
  }

  public async open(): Promise<void> {
    this.close();

    // 先尝试从后端拉取现有已保存的元数据
    try {
      const res = await this.rpcClient.call<void, { metadata: PaperMetadata }>('metadata.get');
      if (res && res.metadata) {
        this.metadata = { ...this.metadata, ...res.metadata };
      }
    } catch {
      // ignore
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large metadata-dialog" style="width: min(980px, 94vw); max-height: 90vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">📄</span>
            <h3>论文元数据半自动化提取与审核 (Paper Metadata & FAIR Registry)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #0284c7, #38bdf8); font-size: 10px; padding: 2px 6px;">FAIR / LiPD 兼容</span>
          </div>
          <button class="close-btn" id="meta-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 16px; overflow-y: auto;">
          <!-- 顶部快捷工具栏: DOI 索引 & PDF 解析 -->
          <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 11px; font-weight: bold; color: #38bdf8; display: flex; justify-content: space-between; align-items: center;">
              <span>⚡ 自动化提取工具通道 (DOI 索引 + 论文 PDF 提取)</span>
              <span style="font-size: 10px; color: var(--text-muted);">约束规范：仅提取明确写出的内容，零脑补零推测</span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 220px; display: flex; gap: 6px;">
                <input type="text" id="meta-inp-doi" placeholder="输入论文 DOI (如 10.1016/j.quascirev.2020.106500)" value="${this.metadata.publication.doi}" style="flex: 1; font-size: 11px;" />
                <button id="btn-fetch-doi" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">🔍 索引 DOI</button>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <input type="file" id="meta-file-pdf" accept=".pdf" style="display: none;" />
                <button id="btn-upload-pdf" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;">📤 上传 PDF 提取</button>
                <span id="meta-extract-status" style="font-size: 11px; color: #34d399;"></span>
              </div>
            </div>
          </div>

          <!-- 表单 5 大分组卡片展示区 -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <!-- 分组 1: 出版信息 (DOI 来源) -->
            <div class="meta-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
                <strong style="font-size: 12px; color: #38bdf8;">1. 📚 来源文献与出版信息</strong>
                <span class="chip-tag" style="background: rgba(2, 132, 199, 0.2); color: #38bdf8;">${this.metadata.publication.source || 'DOI'}</span>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 10.5px; color: var(--text-muted);">论文标题 (Title):</label>
                <input type="text" id="meta-pub-title" value="${this.metadata.publication.title || ''}" placeholder="未找到，请手动填写" style="width: 100%; font-size: 11px;" />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 10.5px; color: var(--text-muted);">作者列表 (Authors，逗号分隔):</label>
                <input type="text" id="meta-pub-authors" value="${(this.metadata.publication.authors || []).join(', ')}" placeholder="未找到，请手动填写" style="width: 100%; font-size: 11px;" />
              </div>
              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">期刊名称 (Journal):</label>
                  <input type="text" id="meta-pub-journal" value="${this.metadata.publication.journal || ''}" placeholder="未找到，请手动填写" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">出版年份 (Year):</label>
                  <input type="number" id="meta-pub-year" value="${this.metadata.publication.year || ''}" placeholder="如 2026" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 分组 2: 站点地理位置 (LLM / 手动) -->
            <div class="meta-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
                <strong style="font-size: 12px; color: #34d399;">2. 📍 钻孔/剖面地理位置</strong>
                <span class="chip-tag" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">${this.metadata.site.source || 'LLM / User'}</span>
              </div>
              <div class="form-group" style="margin: 0;">
                <div style="display: flex; justify-content: space-between;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">站点名称 (Site Name):</label>
                  ${this.metadata.site.conflict ? '<span style="color: #f59e0b; font-size: 10px;">⚠️ 检测到冲突候选项</span>' : ''}
                </div>
                <input type="text" id="meta-site-name" value="${this.metadata.site.site_name || ''}" placeholder="未找到，请手动填写 (如 Hoya del Castillo)" style="width: 100%; font-size: 11px;" />
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">纬度 (°N, 南纬为负):</label>
                  <input type="text" id="meta-site-lat" value="${this.metadata.site.latitude || ''}" placeholder="如 39.52" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">经度 (°E, 西经为负):</label>
                  <input type="text" id="meta-site-lon" value="${this.metadata.site.longitude || ''}" placeholder="如 -2.85" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">海拔 (Elevation m):</label>
                  <input type="text" id="meta-site-elev" value="${this.metadata.site.elevation_m || ''}" placeholder="如 950" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">档案类型 (Archive Type):</label>
                  <input type="text" id="meta-site-archive" value="${this.metadata.site.archive_type || 'lake sediment'}" placeholder="如 lake sediment, peat" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 分组 3: 年代学与定年模型 -->
            <div class="meta-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
                <strong style="font-size: 12px; color: #f59e0b;">3. ⏳ 年代学与时间序列模型</strong>
                <span class="chip-tag" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">Chronology</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">年代模型 (Age Model):</label>
                  <input type="text" id="meta-chron-model" value="${this.metadata.chronology.age_model || 'Bacon'}" placeholder="如 Bacon, Bchron, CLAM" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">定年方法 (Dating Method):</label>
                  <input type="text" id="meta-chron-dating" value="${this.metadata.chronology.dating_method || '14C AMS'}" placeholder="如 14C, 210Pb, OSL" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">年代覆盖范围 (Age Range):</label>
                  <input type="text" id="meta-chron-range" value="${this.metadata.chronology.age_range || ''}" placeholder="如 0-12000 cal BP" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">校正曲线 (Cal Curve):</label>
                  <input type="text" id="meta-chron-calcurve" value="${this.metadata.chronology.cal_curve || 'IntCal20'}" placeholder="如 IntCal20" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 分组 4 & 5: 技术实验室与数据质量备注 -->
            <div class="meta-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
                <strong style="font-size: 12px; color: #a78bfa;">4. 🧪 提取实验、技术与质量备注</strong>
                <span class="chip-tag" style="background: rgba(167, 139, 250, 0.2); color: #a78bfa;">Technical & QC</span>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 10.5px; color: var(--text-muted);">花粉提取与实验方法 (Method):</label>
                <input type="text" id="meta-tech-method" value="${this.metadata.technical.pollen_extraction_method || ''}" placeholder="如 HF digestion / heavy liquid sieving" style="width: 100%; font-size: 11px;" />
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">分析实验室 (Lab):</label>
                  <input type="text" id="meta-tech-lab" value="${this.metadata.technical.laboratory || ''}" placeholder="未找到，请手动填写" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">采样间隔 (Sampling Interval):</label>
                  <input type="text" id="meta-tech-interval" value="${this.metadata.technical.sampling_interval_cm || ''}" placeholder="如 1 cm, 2 cm" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 10.5px; color: var(--text-muted);">质量控制与科学备注 (Quality Notes):</label>
                <input type="text" id="meta-qual-notes" value="${this.metadata.quality.quality_notes || ''}" placeholder="如未出现属种严格填报 0.00；重叠层位经高分辨率确认" style="width: 100%; font-size: 11px;" />
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">
            💡 所有字段均可自由手动更正补全，确认后将永久绑定至当前工程并参与 XLSX 与 LiPD 规范化导出。
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" id="meta-btn-cancel">取消</button>
            <button class="btn btn-primary" id="meta-btn-save" style="background: linear-gradient(135deg, #0284c7, #38bdf8);">
              💾 保存并绑定元数据
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(modal);
    this.modalEl = modal;

    // 事件绑定
    modal.querySelector('#meta-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#meta-btn-cancel')?.addEventListener('click', () => this.close());

    // 1. DOI 检索事件
    modal.querySelector('#btn-fetch-doi')?.addEventListener('click', async () => {
      const doiInp = (modal.querySelector('#meta-inp-doi') as HTMLInputElement).value.trim();
      if (!doiInp) {
        alert('请输入有效的 DOI 编号！');
        return;
      }
      const statusEl = modal.querySelector('#meta-extract-status');
      if (statusEl) statusEl.textContent = '⏳ 正在检索 Crossref 与 Semantic Scholar...';

      try {
        const res = await this.rpcClient.call<{ doi: string }, any>('metadata.fetchByDoi', { doi: doiInp });
        if (res && res.success && res.data) {
          const d = res.data;
          (modal.querySelector('#meta-pub-title') as HTMLInputElement).value = d.title || '';
          (modal.querySelector('#meta-pub-authors') as HTMLInputElement).value = (d.authors || []).join(', ');
          (modal.querySelector('#meta-pub-journal') as HTMLInputElement).value = d.journal || '';
          (modal.querySelector('#meta-pub-year') as HTMLInputElement).value = String(d.year || '');
          if (statusEl) statusEl.textContent = `✅ 成功索引出版信息 (来源: ${d.source})！`;
        } else {
          if (statusEl) statusEl.textContent = `⚠️ 未检索到 DOI，请核对编号或手动填写。`;
        }
      } catch (err: any) {
        if (statusEl) statusEl.textContent = `❌ 检索失败: ${err.message || err}`;
      }
    });

    // 2. 上传 PDF 文本分块与提取
    const fileInput = modal.querySelector('#meta-file-pdf') as HTMLInputElement;
    modal.querySelector('#btn-upload-pdf')?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const statusEl = modal.querySelector('#meta-extract-status');
      if (statusEl) statusEl.textContent = `⏳ 正在分块提取论文文本并调用 LLM...`;

      // 将文件传给后端
      const formData = new FormData();
      formData.append('file', file);

      try {
        const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!upRes.ok) throw new Error('PDF 上传失败');
        const upJson = await upRes.json();
        const pdfPath = upJson.path || upJson.saved_path;

        const res = await this.rpcClient.call<any, any>('metadata.extractFromPdf', { pdf_path: pdfPath });
        if (res && res.success && res.current_metadata) {
          const m = res.current_metadata;
          (modal.querySelector('#meta-site-name') as HTMLInputElement).value = m.site.site_name || '';
          (modal.querySelector('#meta-site-lat') as HTMLInputElement).value = m.site.latitude || '';
          (modal.querySelector('#meta-site-lon') as HTMLInputElement).value = m.site.longitude || '';
          (modal.querySelector('#meta-site-elev') as HTMLInputElement).value = m.site.elevation_m || '';
          (modal.querySelector('#meta-site-archive') as HTMLInputElement).value = m.site.archive_type || 'lake sediment';

          (modal.querySelector('#meta-chron-model') as HTMLInputElement).value = m.chronology.age_model || 'Bacon';
          (modal.querySelector('#meta-chron-dating') as HTMLInputElement).value = m.chronology.dating_method || '14C AMS';
          (modal.querySelector('#meta-chron-range') as HTMLInputElement).value = m.chronology.age_range || '';

          (modal.querySelector('#meta-tech-method') as HTMLInputElement).value = m.technical.pollen_extraction_method || '';
          (modal.querySelector('#meta-tech-lab') as HTMLInputElement).value = m.technical.laboratory || '';
          (modal.querySelector('#meta-tech-interval') as HTMLInputElement).value = m.technical.sampling_interval_cm || '';

          (modal.querySelector('#meta-qual-notes') as HTMLInputElement).value = m.quality.quality_notes || '';

          if (statusEl) statusEl.textContent = `✅ 完成 ${res.chunks_count} 块文本提取！未提及项已严格留空。`;
        }
      } catch (err: any) {
        if (statusEl) statusEl.textContent = `⚠️ PDF 提取提示: ${err.message || err}`;
      }
    });

    // 3. 保存更新
    modal.querySelector('#meta-btn-save')?.addEventListener('click', async () => {
      this.collectFormData();
      try {
        await this.rpcClient.call('metadata.update', { updated_metadata: this.metadata });
      } catch {
        // ignore
      }
      if (this.onSaveCallback) {
        this.onSaveCallback(this.metadata);
      }
      this.close();
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private collectFormData(): void {
    if (!this.modalEl) return;
    const m = this.modalEl;

    const doi = (m.querySelector('#meta-inp-doi') as HTMLInputElement)?.value.trim() || '';
    const title = (m.querySelector('#meta-pub-title') as HTMLInputElement)?.value.trim() || '';
    const rawAuthors = (m.querySelector('#meta-pub-authors') as HTMLInputElement)?.value.trim() || '';
    const authors = rawAuthors ? rawAuthors.split(',').map((a) => a.trim()).filter(Boolean) : [];
    const journal = (m.querySelector('#meta-pub-journal') as HTMLInputElement)?.value.trim() || '';
    const yearVal = parseInt((m.querySelector('#meta-pub-year') as HTMLInputElement)?.value, 10);
    const year = !isNaN(yearVal) ? yearVal : null;

    this.metadata.publication = { doi, title, authors, journal, year, source: 'DOI / User' };

    this.metadata.site = {
      site_name: (m.querySelector('#meta-site-name') as HTMLInputElement)?.value.trim() || '',
      latitude: (m.querySelector('#meta-site-lat') as HTMLInputElement)?.value.trim() || '',
      longitude: (m.querySelector('#meta-site-lon') as HTMLInputElement)?.value.trim() || '',
      elevation_m: (m.querySelector('#meta-site-elev') as HTMLInputElement)?.value.trim() || '',
      archive_type: (m.querySelector('#meta-site-archive') as HTMLInputElement)?.value.trim() || 'lake sediment',
      source: 'LLM / User',
    };

    this.metadata.chronology = {
      age_model: (m.querySelector('#meta-chron-model') as HTMLInputElement)?.value.trim() || 'Bacon',
      dating_method: (m.querySelector('#meta-chron-dating') as HTMLInputElement)?.value.trim() || '14C AMS',
      age_range: (m.querySelector('#meta-chron-range') as HTMLInputElement)?.value.trim() || '',
      cal_curve: (m.querySelector('#meta-chron-calcurve') as HTMLInputElement)?.value.trim() || 'IntCal20',
      source: 'User',
    };

    this.metadata.technical = {
      pollen_extraction_method: (m.querySelector('#meta-tech-method') as HTMLInputElement)?.value.trim() || '',
      laboratory: (m.querySelector('#meta-tech-lab') as HTMLInputElement)?.value.trim() || '',
      sampling_interval_cm: (m.querySelector('#meta-tech-interval') as HTMLInputElement)?.value.trim() || '',
      source: 'User',
    };

    this.metadata.quality = {
      quality_notes: (m.querySelector('#meta-qual-notes') as HTMLInputElement)?.value.trim() || '',
      source: 'User',
    };
  }
}
