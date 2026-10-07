import { RpcClient } from '../services/RpcClient';
import { notifyError } from '../ui/feedback';

export interface PaperMetadata {
  publication: {
    doi: string;
    title: string;
    authors: string[];
    journal: string;
    year: number | null;
    funding_agency?: string;
    funding_grant?: string;
    source?: string;
  };
  site: {
    site_name: string;
    country?: string;
    latitude: string;
    longitude: string;
    elevation_m: string;
    water_depth_m?: string;
    core_length_m?: string;
    archive_type: string;
    collection_date?: string;
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
    investigators?: string;
    digitizer?: string;
    affiliation?: string;
    digitization_date?: string;
    sampling_interval_cm: string;
    source?: string;
  };
  quality: {
    quality_notes: string;
    dataset_version?: string;
    original_data_url?: string;
    source?: string;
  };
}

const DEFAULT_EXTRACTION_PROMPT = `You are an expert scientific data extractor specializing in quaternary paleoecology, palynology, and paleoclimate stratigraphy.

YOUR ABSOLUTE MANDATE:
- Extract ONLY facts that are EXPLICITLY and UNAMBIGUOUSLY written in the provided text snippet.
- DO NOT extrapolate, DO NOT infer, DO NOT hallucinate, and DO NOT look up external data (e.g. do not guess elevation from coordinates, do not guess country or age model).
- If an item is NOT mentioned explicitly in the text, you MUST return an empty string "" for that field.

Return a valid JSON object matching this schema:
{
  "site_name": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "country": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "latitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "longitude": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "elevation_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "water_depth_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "core_length_m": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "archive_type": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "collection_date": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "investigators": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "funding_agency": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "funding_grant": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_model": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "age_range": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "dating_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "cal_curve": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "pollen_extraction_method": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "laboratory": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "sampling_interval_cm": {"value": string, "confidence": "high"|"medium"|"low", "quote": string},
  "quality_notes": {"value": string, "confidence": "high"|"medium"|"low", "quote": string}
}

Special notes:
- latitude/longitude: Return decimal degrees if written, or convert explicit degrees/minutes/seconds if unambiguously stated. Otherwise keep verbatim string.
- archive_type: e.g. "lake sediment", "peat bog", "marine sediment", "fluvial sediment".
- age_model: e.g. "Bacon", "Bchron", "CLAM", "OxCal", "linear interpolation", or "".
- investigators: Field/coring team or laboratory analysts explicitly mentioned.
- quote: Provide the short verbatim sentence proving this extraction. If value is "", quote must be "".`;

const DEFAULT_EXTERNAL_CHAT_PROMPT = `你是一名第四纪古生态、孢粉学与古气候地层学数据提取专家。请阅读我上传的这篇论文 PDF，严格提取文中**明确写出**的元数据（严禁推测或编造；文中未提及的字段请填 "" 或 null），并**仅输出一个符合以下结构的 JSON 代码块**（可直接复制导入 Straditize Pro）：

\`\`\`json
{
  "publication": {
    "doi": "论文 DOI（不含 https://doi.org/ 前缀，如 10.1016/j.quascirev.2024.108504）",
    "title": "论文完整英文或中文标题",
    "authors": ["作者1", "作者2", "作者3"],
    "journal": "期刊全称",
    "year": 2024,
    "funding_agency": "资助机构（如 NSFC, NSF, ERC）",
    "funding_grant": "基金项目号（如 41771212）"
  },
  "site": {
    "site_name": "钻孔或剖面站点名称（如 Lake Gahai (GHB core)）",
    "country": "国家与地理区域（如 China (Qaidam Basin, Qinghai)）",
    "latitude": "十进制度纬度（北纬为正，如 37.1333）",
    "longitude": "十进制度经度（东经为正，如 97.5167）",
    "elevation_m": "海拔米数（纯数字字符串，如 2848）",
    "water_depth_m": "采样处水深米数（如 11.4）",
    "core_length_m": "钻孔总长米数（如 14.0）",
    "archive_type": "沉积档案类型（如 lake sediment, peat, loess, marine sediment）",
    "collection_date": "野外钻取/采集时间（如 2008-05 或 2018）"
  },
  "chronology": {
    "age_model": "年代-深度模型方法（如 Bacon, Bchron, CLAM, linear interpolation）",
    "dating_method": "测年方法与材料（如 AMS 14C (plant macrofossils / bulk organic)）",
    "age_range": "年代覆盖范围（如 0-11400 cal yr BP）",
    "cal_curve": "校正曲线（如 IntCal20, Marine20）"
  },
  "technical": {
    "investigators": "野外钻取与实验分析人员名单（逗号分隔）",
    "affiliation": "第一完成单位/研究机构名称",
    "laboratory": "孢粉与测年分析实验室名称",
    "pollen_extraction_method": "孢粉提取实验方法（如 HCl-NaOH-HF treatment + Lycopodium tablets）",
    "sampling_interval_cm": "采样间隔厘米数（如 2）"
  },
  "quality": {
    "dataset_version": "1.0.0",
    "original_data_url": "原始数据或补充材料链接（如 https://doi.org/...）",
    "quality_notes": "样品总数、每样统计粒数等质量控制说明（如 660 samples analyzed, >500 terrestrial pollen grains counted per sample）"
  }
}
\`\`\``;

export class MetadataModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private modalEl: HTMLElement | null = null;
  private llmBaseUrl: string = 'https://api.openai.com/v1';
  private llmApiKey: string = '';
  private llmModel: string = 'gpt-4o';
  private llmPromptTemplate: string = DEFAULT_EXTRACTION_PROMPT;
  private metadata: PaperMetadata = {
    publication: { doi: '', title: '', authors: [], journal: '', year: null, funding_agency: '', funding_grant: '' },
    site: { site_name: '', country: '', latitude: '', longitude: '', elevation_m: '', water_depth_m: '', core_length_m: '', archive_type: 'lake sediment', collection_date: '' },
    chronology: { age_model: 'Bacon', age_range: '', dating_method: '14C AMS', cal_curve: 'IntCal20' },
    technical: { pollen_extraction_method: 'HF digestion / sieving', laboratory: '', investigators: '', digitizer: '', affiliation: '', digitization_date: '', sampling_interval_cm: '2' },
    quality: { quality_notes: 'Unobserved taxa strictly filled as 0.00 (Zero-Abundance standard).', dataset_version: '1.0.0', original_data_url: '' },
  };

  private onSaveCallback?: (meta: PaperMetadata) => void;

  constructor(container: HTMLElement, rpcClient: RpcClient, onSave?: (meta: PaperMetadata) => void) {
    this.container = container;
    this.rpcClient = rpcClient;
    this.onSaveCallback = onSave;
  }

  public async open(): Promise<void> {
    this.close();

    // 先尝试从后端拉取现有已保存的元数据与 LLM 配置
    try {
      const res = await this.rpcClient.call<void, { metadata: PaperMetadata }>('metadata.get');
      if (res && res.metadata) {
        this.metadata = { ...this.metadata, ...res.metadata };
      }
      const sysCfg = await this.rpcClient.getSystemConfig();
      if (sysCfg) {
        if (sysCfg.llm_base_url) this.llmBaseUrl = sysCfg.llm_base_url;
        if (sysCfg.llm_api_key !== undefined) this.llmApiKey = sysCfg.llm_api_key;
        if (sysCfg.llm_model) this.llmModel = sysCfg.llm_model;
        if (sysCfg.llm_prompt_template) this.llmPromptTemplate = sysCfg.llm_prompt_template;
      }
    } catch {
      // ignore
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large metadata-dialog ui-modal" style="--modal-width: 980px;">
        <div class="modal-header ui-modal__header">
          <div>
            <h3 class="ui-modal__title">论文与站点元数据</h3>
            <span class="ui-status ui-status--success">FAIR / LiPD 兼容</span>
          </div>
          <button class="ui-icon-btn" id="meta-close-btn" aria-label="关闭元数据窗口" title="关闭">&times;</button>
        </div>

        <div class="modal-body ui-modal__body metadata-modal-body">
          <!-- 顶部快捷工具栏: DOI 索引 & PDF 解析 & LLM 配置 -->
          <div class="meta-quick-tools">
            <div style="font-size: 11px; font-weight: bold; color: var(--accent-blue); display: flex; justify-content: space-between; align-items: center;">
              <span>自动提取</span>
              <span style="font-size: 10px; color: var(--text-muted);">只填入来源中明确出现的内容</span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 220px; display: flex; gap: 6px;">
                <input type="text" id="meta-inp-doi" placeholder="输入论文 DOI (如 10.1016/j.quascirev.2020.106500)" value="${this.metadata.publication.doi}" style="flex: 1; font-size: 11px;" />
                <button id="btn-fetch-doi" class="ui-btn ui-btn--primary ui-btn--sm">检索 DOI</button>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <input type="file" id="meta-file-pdf" accept=".pdf" hidden />
                <button id="btn-upload-pdf" class="ui-btn ui-btn--secondary ui-btn--sm">从 PDF 提取</button>
                <button id="btn-toggle-external-assistant" class="ui-btn ui-btn--quiet ui-btn--sm" title="导入外部工具生成的结构化结果">导入外部结果</button>
                <button id="btn-toggle-llm-config" class="ui-btn ui-btn--quiet ui-btn--sm" title="配置模型接口与提取提示词">提取设置</button>
                <span id="meta-extract-status" style="font-size: 11px; color: var(--accent-green);"></span>
              </div>
            </div>

            <!-- 可折叠：外部 AI 零 Token 成本导入助手面板 -->
            <div id="meta-external-assistant-panel" style="display: none; margin-top: 8px; padding: 10px; border-top: 1px dashed var(--border-color); background: rgba(16, 185, 129, 0.05); border-radius: 6px; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div style="font-size: 11px; color: var(--text-primary);">
                  <strong style="color: #10b981;">零 API 费用三步法：</strong>
                  ① 点击右侧【复制提取提示词】 → ② 打开网页版 DeepSeek / ChatGPT / Kimi 上传论文 PDF 并粘贴发送 → ③ 将 AI 回复的内容粘贴到下方并点击【解析并填入表单】
                </div>
                <div style="display: flex; gap: 6px;">
                  <button id="btn-copy-external-prompt" class="ui-btn ui-btn--secondary" style="font-size: 10.5px; padding: 3px 8px;">复制提取提示词</button>
                  <button id="btn-toggle-external-prompt-preview" class="tool-btn" style="font-size: 10px; padding: 3px 8px;">查看/编辑提示词</button>
                </div>
              </div>
              <textarea id="meta-external-prompt-box" rows="5" style="display: none; width: 100%; font-family: var(--font-mono); font-size: 10px; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-secondary); box-sizing: border-box;"></textarea>
              <div class="form-group" style="margin: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                  <label style="font-size: 10.5px; font-weight: 600; color: var(--text-primary);">粘贴外部 AI 输出结果 (支持直接粘贴含 JSON 代码块的整段回复，或导入 .json/.txt 文件):</label>
                  <div style="display: flex; gap: 6px;">
                    <input type="file" id="meta-file-external-json" accept=".json,.txt,.md" style="display: none;" />
                    <button id="btn-upload-external-json" class="tool-btn" style="font-size: 10px; padding: 2px 8px;">从文件导入 (.json/.txt)</button>
                    <button id="btn-parse-external-json" class="ui-btn ui-btn--primary" style="font-size: 10.5px; padding: 3px 12px; background: #10b981; border-color: var(--accent-green);">解析并填入表单</button>
                  </div>
                </div>
                <textarea id="meta-external-paste-input" rows="5" placeholder="将 DeepSeek / ChatGPT / Kimi / Claude 生成的回复直接粘贴到这里（无需手动删掉前后的聊天文字或代码块标记，系统会自动剥离并识别）..." style="width: 100%; font-family: var(--font-mono); font-size: 10.5px; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); box-sizing: border-box;"></textarea>
              </div>
            </div>

            <!-- 可折叠 LLM API 与提取提示词配置面板 -->
            <div id="meta-llm-config-panel" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color); flex-direction: column; gap: 8px;">
              <div style="display: grid; grid-template-columns: 1.4fr 1.4fr 0.9fr auto; gap: 8px; align-items: end;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10px; color: var(--text-muted);">LLM API Base URL (OpenAI 兼容):</label>
                  <input type="text" id="meta-llm-base-url" value="${this.llmBaseUrl}" placeholder="https://api.openai.com/v1" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10px; color: var(--text-muted);">API Key (支持环境变量或在此持久化):</label>
                  <input type="password" id="meta-llm-api-key" value="${this.llmApiKey}" placeholder="sk-..." style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10px; color: var(--text-muted);">模型名称 (Model):</label>
                  <input type="text" id="meta-llm-model" value="${this.llmModel}" placeholder="gpt-4o / deepseek-chat" style="width: 100%; font-size: 11px;" />
                </div>
                <button id="btn-save-llm-config" class="ui-btn ui-btn--primary" style="font-size: 10.5px; padding: 5px 10px; white-space: nowrap;">保存配置</button>
              </div>
              <div class="form-group" style="margin: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                  <label style="font-size: 10px; color: var(--text-muted);">提取 Meta 系统提示词配置 (System Prompt Template — 决定提取规则与 JSON 字段):</label>
                  <button id="btn-reset-llm-prompt" class="tool-btn" style="font-size: 9.5px; padding: 1px 6px;">恢复默认提示词</button>
                </div>
                <textarea id="meta-llm-prompt" rows="6" style="width: 100%; font-family: var(--font-mono); font-size: 10.5px; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); box-sizing: border-box;"></textarea>
              </div>
            </div>
          </div>

          <!-- 表单 5 大分组卡片展示区 -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <!-- 分组 1: 出版信息 (DOI 来源) -->
            <div class="meta-card">
              <div class="meta-card-header">
                <strong style="font-size: 12px; color: var(--accent-blue);">1. 来源文献与出版信息</strong>
                <span class="chip-tag">${this.metadata.publication.source || 'DOI'}</span>
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
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">资助机构 (Funding Agency):</label>
                  <input type="text" id="meta-pub-funding-agency" value="${this.metadata.publication.funding_agency || ''}" placeholder="如 NSFC, NSF, ERC" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">基金项目号 (Funding Grant):</label>
                  <input type="text" id="meta-pub-funding-grant" value="${this.metadata.publication.funding_grant || ''}" placeholder="如 42071100" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 分组 2: 站点地理位置 (LLM / 手动) -->
            <div class="meta-card">
              <div class="meta-card-header">
                <strong style="font-size: 12px; color: var(--accent-green);">2. 钻孔/剖面地理位置与野外采集</strong>
                <span class="chip-tag" style="color: var(--accent-green);">${this.metadata.site.source || 'LLM / User'}</span>
              </div>
              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <div style="display: flex; justify-content: space-between;">
                    <label style="font-size: 10.5px; color: var(--text-muted);">站点名称 (Site Name):</label>
                    ${this.metadata.site.conflict ? '<span style="color: var(--accent-amber); font-size: 10px;">检测到冲突候选项</span>' : ''}
                  </div>
                  <input type="text" id="meta-site-name" value="${this.metadata.site.site_name || ''}" placeholder="未找到，请手动填写 (如 Hoya del Castillo)" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">国家/行政区 (Country):</label>
                  <input type="text" id="meta-site-country" value="${this.metadata.site.country || ''}" placeholder="如 Spain / 中国青海" style="width: 100%; font-size: 11px;" />
                </div>
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
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">海拔 (Elev m):</label>
                  <input type="text" id="meta-site-elev" value="${this.metadata.site.elevation_m || ''}" placeholder="如 950" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">水深 (Water Depth m):</label>
                  <input type="text" id="meta-site-water-depth" value="${this.metadata.site.water_depth_m || ''}" placeholder="如 15.5" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">钻孔总长 (Core Length m):</label>
                  <input type="text" id="meta-site-core-length" value="${this.metadata.site.core_length_m || ''}" placeholder="如 8.2" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">档案类型 (Archive Type):</label>
                  <input type="text" id="meta-site-archive" value="${this.metadata.site.archive_type || 'lake sediment'}" placeholder="如 lake sediment, peat" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">野外采集时间 (Collection Date):</label>
                  <input type="text" id="meta-site-collection-date" value="${this.metadata.site.collection_date || ''}" placeholder="如 2019-08 或 2019" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 分组 3: 年代学与定年模型 -->
            <div class="meta-card">
              <div class="meta-card-header">
                <strong style="font-size: 12px; color: var(--accent-amber);">3. 年代学与时间序列模型</strong>
                <span class="chip-tag" style="color: var(--accent-amber);">Chronology</span>
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

            <!-- 分组 4 & 5: 采集/分析责任人、单位与质量控制 -->
            <div class="meta-card">
              <div class="meta-card-header">
                <strong style="font-size: 12px; color: #a78bfa;">4. 采集/分析人、单位、技术与质量备注</strong>
                <span class="chip-tag" style="background: rgba(167, 139, 250, 0.2); color: #a78bfa;">Provenance & QC</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">野外采集/实验分析人 (Investigators):</label>
                  <input type="text" id="meta-tech-investigators" value="${this.metadata.technical.investigators || ''}" placeholder="留空则默认同论文作者" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">数字化录入人 (Digitizer / Curator):</label>
                  <input type="text" id="meta-tech-digitizer" value="${this.metadata.technical.digitizer || ''}" placeholder="如 Zhang San" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">所属单位 (Affiliation / Institution):</label>
                  <input type="text" id="meta-tech-affiliation" value="${this.metadata.technical.affiliation || ''}" placeholder="如 中科院青藏高原所 / ITP CAS" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">数字化日期 (Digitization Date):</label>
                  <input type="text" id="meta-tech-digitization-date" value="${this.metadata.technical.digitization_date || ''}" placeholder="如 2026-09-29" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">提取方法 (Method):</label>
                  <input type="text" id="meta-tech-method" value="${this.metadata.technical.pollen_extraction_method || ''}" placeholder="如 HF digestion" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">分析实验室 (Lab):</label>
                  <input type="text" id="meta-tech-lab" value="${this.metadata.technical.laboratory || ''}" placeholder="实验室名称" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">采样间隔 (cm):</label>
                  <input type="text" id="meta-tech-interval" value="${this.metadata.technical.sampling_interval_cm || ''}" placeholder="如 2" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 8px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">数据集版本 (Version):</label>
                  <input type="text" id="meta-qual-version" value="${this.metadata.quality.dataset_version || '1.0.0'}" placeholder="1.0.0" style="width: 100%; font-size: 11px;" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 10.5px; color: var(--text-muted);">原始数据/图谱链接 (Original URL):</label>
                  <input type="text" id="meta-qual-url" value="${this.metadata.quality.original_data_url || ''}" placeholder="如 https://doi.org/... 或 Neotoma URL" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 10.5px; color: var(--text-muted);">质量控制与科学备注 (Quality Notes):</label>
                <input type="text" id="meta-qual-notes" value="${this.metadata.quality.quality_notes || ''}" placeholder="如未出现属种严格填报 0.00；重叠层位经高分辨率确认" style="width: 100%; font-size: 11px;" />
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer ui-modal__footer">
          <button class="ui-btn ui-btn--secondary" id="meta-btn-cancel">取消</button>
          <button class="ui-btn ui-btn--primary" id="meta-btn-save">保存元数据</button>
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
        notifyError('请输入有效的 DOI 编号！');
        return;
      }
      const statusEl = modal.querySelector('#meta-extract-status');
      if (statusEl) statusEl.textContent = '正在检索 Crossref 与 Semantic Scholar...';

      try {
        const res = await this.rpcClient.call<{ doi: string }, any>('metadata.fetchByDoi', { doi: doiInp });
        if (res && res.success && res.data) {
          const d = res.data;
          (modal.querySelector('#meta-pub-title') as HTMLInputElement).value = d.title || '';
          (modal.querySelector('#meta-pub-authors') as HTMLInputElement).value = (d.authors || []).join(', ');
          (modal.querySelector('#meta-pub-journal') as HTMLInputElement).value = d.journal || '';
          (modal.querySelector('#meta-pub-year') as HTMLInputElement).value = String(d.year || '');
          if (statusEl) statusEl.textContent = `成功索引出版信息 (来源: ${d.source})！`;
        } else {
          if (statusEl) statusEl.textContent = `未检索到 DOI，请核对编号或手动填写。`;
        }
      } catch (err: any) {
        if (statusEl) statusEl.textContent = `检索失败: ${err.message || err}`;
      }
    });

    // 1.5 LLM 配置面板展开/收起、重置提示词与保存事件
    const llmPanel = modal.querySelector('#meta-llm-config-panel') as HTMLElement;
    const extPanel = modal.querySelector('#meta-external-assistant-panel') as HTMLElement;
    const promptInp = modal.querySelector('#meta-llm-prompt') as HTMLTextAreaElement;
    if (promptInp) {
      promptInp.value = this.llmPromptTemplate || DEFAULT_EXTRACTION_PROMPT;
    }

    const extPromptBox = modal.querySelector('#meta-external-prompt-box') as HTMLTextAreaElement;
    if (extPromptBox) {
      extPromptBox.value = DEFAULT_EXTERNAL_CHAT_PROMPT;
    }

    modal.querySelector('#btn-toggle-external-assistant')?.addEventListener('click', () => {
      if (extPanel) {
        const nextShow = extPanel.style.display === 'none';
        extPanel.style.display = nextShow ? 'flex' : 'none';
        if (nextShow && llmPanel) llmPanel.style.display = 'none';
      }
    });

    modal.querySelector('#btn-toggle-external-prompt-preview')?.addEventListener('click', () => {
      if (extPromptBox) {
        extPromptBox.style.display = extPromptBox.style.display === 'none' ? 'block' : 'none';
      }
    });

    modal.querySelector('#btn-copy-external-prompt')?.addEventListener('click', async () => {
      const textToCopy = extPromptBox?.value.trim() || DEFAULT_EXTERNAL_CHAT_PROMPT;
      const statusEl = modal.querySelector('#meta-extract-status');
      try {
        await navigator.clipboard.writeText(textToCopy);
        if (statusEl) statusEl.textContent = '已复制提取提示词！请前往网页版 AI 上传论文 PDF 并粘贴发送。';
      } catch {
        if (extPromptBox) {
          extPromptBox.style.display = 'block';
          extPromptBox.select();
        }
        if (statusEl) statusEl.textContent = '已展开提示词框，请按 Ctrl+C 复制。';
      }
    });

    const applyMetadataToForm = (m: any) => {
      if (m.publication) {
        if (m.publication.doi) (modal.querySelector('#meta-inp-doi') as HTMLInputElement).value = m.publication.doi;
        if (m.publication.title) (modal.querySelector('#meta-pub-title') as HTMLInputElement).value = m.publication.title;
        if (Array.isArray(m.publication.authors) && m.publication.authors.length > 0) {
          (modal.querySelector('#meta-pub-authors') as HTMLInputElement).value = m.publication.authors.join(', ');
        }
        if (m.publication.journal) (modal.querySelector('#meta-pub-journal') as HTMLInputElement).value = m.publication.journal;
        if (m.publication.year) (modal.querySelector('#meta-pub-year') as HTMLInputElement).value = String(m.publication.year);
        if (m.publication.funding_agency) {
          (modal.querySelector('#meta-pub-funding-agency') as HTMLInputElement).value = m.publication.funding_agency;
        }
        if (m.publication.funding_grant) {
          (modal.querySelector('#meta-pub-funding-grant') as HTMLInputElement).value = m.publication.funding_grant;
        }
      }
      if (m.site) {
        (modal.querySelector('#meta-site-name') as HTMLInputElement).value = m.site.site_name || '';
        (modal.querySelector('#meta-site-country') as HTMLInputElement).value = m.site.country || '';
        (modal.querySelector('#meta-site-lat') as HTMLInputElement).value = m.site.latitude || '';
        (modal.querySelector('#meta-site-lon') as HTMLInputElement).value = m.site.longitude || '';
        (modal.querySelector('#meta-site-elev') as HTMLInputElement).value = m.site.elevation_m || '';
        (modal.querySelector('#meta-site-water-depth') as HTMLInputElement).value = m.site.water_depth_m || '';
        (modal.querySelector('#meta-site-core-length') as HTMLInputElement).value = m.site.core_length_m || '';
        (modal.querySelector('#meta-site-archive') as HTMLInputElement).value = m.site.archive_type || 'lake sediment';
        (modal.querySelector('#meta-site-collection-date') as HTMLInputElement).value = m.site.collection_date || '';
      }
      if (m.chronology) {
        (modal.querySelector('#meta-chron-model') as HTMLInputElement).value = m.chronology.age_model || 'Bacon';
        (modal.querySelector('#meta-chron-dating') as HTMLInputElement).value = m.chronology.dating_method || '14C AMS';
        (modal.querySelector('#meta-chron-range') as HTMLInputElement).value = m.chronology.age_range || '';
        (modal.querySelector('#meta-chron-calcurve') as HTMLInputElement).value = m.chronology.cal_curve || 'IntCal20';
      }
      if (m.technical) {
        (modal.querySelector('#meta-tech-investigators') as HTMLInputElement).value = m.technical.investigators || '';
        if (m.technical.digitizer) (modal.querySelector('#meta-tech-digitizer') as HTMLInputElement).value = m.technical.digitizer;
        if (m.technical.affiliation) (modal.querySelector('#meta-tech-affiliation') as HTMLInputElement).value = m.technical.affiliation;
        if (m.technical.digitization_date) (modal.querySelector('#meta-tech-digitization-date') as HTMLInputElement).value = m.technical.digitization_date;
        (modal.querySelector('#meta-tech-method') as HTMLInputElement).value = m.technical.pollen_extraction_method || '';
        (modal.querySelector('#meta-tech-lab') as HTMLInputElement).value = m.technical.laboratory || '';
        (modal.querySelector('#meta-tech-interval') as HTMLInputElement).value = m.technical.sampling_interval_cm || '';
      }
      if (m.quality) {
        if (m.quality.dataset_version) (modal.querySelector('#meta-qual-version') as HTMLInputElement).value = m.quality.dataset_version;
        if (m.quality.original_data_url) (modal.querySelector('#meta-qual-url') as HTMLInputElement).value = m.quality.original_data_url;
        (modal.querySelector('#meta-qual-notes') as HTMLInputElement).value = m.quality.quality_notes || '';
      }
    };

    const parseAndApplyExternalText = async (rawText: string) => {
      const statusEl = modal.querySelector('#meta-extract-status');
      if (!rawText.trim()) {
        notifyError('请先在文本框中粘贴外部 AI 生成的 JSON 内容，或选择文件导入！');
        return;
      }
      try {
        const res = await this.rpcClient.call<{ raw_text: string; apply_to_session: boolean }, any>(
          'metadata.parseExternalText',
          { raw_text: rawText, apply_to_session: true }
        );
        if (res && res.success && res.current_metadata) {
          applyMetadataToForm(res.current_metadata);
          if (statusEl) {
            statusEl.textContent = '已成功解析外部 AI 结果并填入全部元数据字段！';
          }
        }
      } catch (err: any) {
        notifyError(`解析外部 AI 结果失败: ${err.message || err}`);
      }
    };

    modal.querySelector('#btn-parse-external-json')?.addEventListener('click', () => {
      const pasteInp = modal.querySelector('#meta-external-paste-input') as HTMLTextAreaElement;
      void parseAndApplyExternalText(pasteInp?.value || '');
    });

    const extFileInp = modal.querySelector('#meta-file-external-json') as HTMLInputElement;
    modal.querySelector('#btn-upload-external-json')?.addEventListener('click', () => extFileInp?.click());
    extFileInp?.addEventListener('change', async () => {
      const f = extFileInp.files?.[0];
      if (!f) return;
      const txt = await f.text();
      const pasteInp = modal.querySelector('#meta-external-paste-input') as HTMLTextAreaElement;
      if (pasteInp) pasteInp.value = txt;
      await parseAndApplyExternalText(txt);
      extFileInp.value = '';
    });

    modal.querySelector('#btn-toggle-llm-config')?.addEventListener('click', () => {
      if (llmPanel) {
        const nextShow = llmPanel.style.display === 'none';
        llmPanel.style.display = nextShow ? 'flex' : 'none';
        if (nextShow && extPanel) extPanel.style.display = 'none';
      }
    });

    modal.querySelector('#btn-reset-llm-prompt')?.addEventListener('click', () => {
      if (promptInp) {
        promptInp.value = DEFAULT_EXTRACTION_PROMPT;
        this.llmPromptTemplate = DEFAULT_EXTRACTION_PROMPT;
      }
    });

    const saveLlmConfigFromInputs = async (showNotice = true) => {
      this.llmBaseUrl = (modal.querySelector('#meta-llm-base-url') as HTMLInputElement)?.value.trim() || 'https://api.openai.com/v1';
      this.llmApiKey = (modal.querySelector('#meta-llm-api-key') as HTMLInputElement)?.value.trim() || '';
      this.llmModel = (modal.querySelector('#meta-llm-model') as HTMLInputElement)?.value.trim() || 'gpt-4o';
      this.llmPromptTemplate = promptInp?.value.trim() || DEFAULT_EXTRACTION_PROMPT;

      const statusEl = modal.querySelector('#meta-extract-status');
      try {
        await this.rpcClient.updateSystemConfig({
          llm_base_url: this.llmBaseUrl,
          llm_api_key: this.llmApiKey,
          llm_model: this.llmModel,
          llm_prompt_template: this.llmPromptTemplate,
        });
        if (showNotice && statusEl) {
          statusEl.textContent = 'LLM 配置与提示词已保存！';
        }
      } catch (err: any) {
        if (showNotice && statusEl) {
          statusEl.textContent = `保存 LLM 配置失败: ${err.message || err}`;
        }
      }
    };

    modal.querySelector('#btn-save-llm-config')?.addEventListener('click', () => {
      void saveLlmConfigFromInputs(true);
    });

    // 2. 上传 PDF 文本分块与提取
    const fileInput = modal.querySelector('#meta-file-pdf') as HTMLInputElement;
    modal.querySelector('#btn-upload-pdf')?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      await saveLlmConfigFromInputs(false);

      const statusEl = modal.querySelector('#meta-extract-status');
      if (statusEl) statusEl.textContent = `正在分块提取论文文本并调用 LLM (${this.llmModel})...`;

      try {
        // 上传统一走 RpcClient（含 HTTP 状态检查与"必须拿到真实路径"校验）。
        const pdfPath = await this.rpcClient.uploadFile(file);

        const res = await this.rpcClient.call<any, any>('metadata.extractFromPdf', {
          pdf_path: pdfPath,
          api_key: this.llmApiKey || undefined,
          base_url: this.llmBaseUrl || undefined,
          model: this.llmModel || 'gpt-4o',
          prompt_template: this.llmPromptTemplate || undefined,
        });
        if (res && res.success && res.current_metadata) {
          applyMetadataToForm(res.current_metadata);
          if (statusEl) statusEl.textContent = `完成 ${res.chunks_count} 块文本提取！未提及项已严格留空。`;
        }
      } catch (err: any) {
        if (statusEl) statusEl.textContent = `PDF 提取提示: ${err.message || err}`;
      }
    });

    // 3. 保存更新（失败必须显式冒泡，严禁静默吞掉）
    modal.querySelector('#meta-btn-save')?.addEventListener('click', async () => {
      this.collectFormData();
      try {
        await this.rpcClient.call('metadata.update', { updated_metadata: this.metadata });
      } catch (err) {
        notifyError(err instanceof Error ? err.message : String(err));
        return;
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
    const funding_agency = (m.querySelector('#meta-pub-funding-agency') as HTMLInputElement)?.value.trim() || '';
    const funding_grant = (m.querySelector('#meta-pub-funding-grant') as HTMLInputElement)?.value.trim() || '';

    this.metadata.publication = { doi, title, authors, journal, year, funding_agency, funding_grant, source: 'DOI / User' };

    this.metadata.site = {
      site_name: (m.querySelector('#meta-site-name') as HTMLInputElement)?.value.trim() || '',
      country: (m.querySelector('#meta-site-country') as HTMLInputElement)?.value.trim() || '',
      latitude: (m.querySelector('#meta-site-lat') as HTMLInputElement)?.value.trim() || '',
      longitude: (m.querySelector('#meta-site-lon') as HTMLInputElement)?.value.trim() || '',
      elevation_m: (m.querySelector('#meta-site-elev') as HTMLInputElement)?.value.trim() || '',
      water_depth_m: (m.querySelector('#meta-site-water-depth') as HTMLInputElement)?.value.trim() || '',
      core_length_m: (m.querySelector('#meta-site-core-length') as HTMLInputElement)?.value.trim() || '',
      archive_type: (m.querySelector('#meta-site-archive') as HTMLInputElement)?.value.trim() || 'lake sediment',
      collection_date: (m.querySelector('#meta-site-collection-date') as HTMLInputElement)?.value.trim() || '',
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
      investigators: (m.querySelector('#meta-tech-investigators') as HTMLInputElement)?.value.trim() || '',
      digitizer: (m.querySelector('#meta-tech-digitizer') as HTMLInputElement)?.value.trim() || '',
      affiliation: (m.querySelector('#meta-tech-affiliation') as HTMLInputElement)?.value.trim() || '',
      digitization_date: (m.querySelector('#meta-tech-digitization-date') as HTMLInputElement)?.value.trim() || '',
      sampling_interval_cm: (m.querySelector('#meta-tech-interval') as HTMLInputElement)?.value.trim() || '',
      source: 'User',
    };

    this.metadata.quality = {
      quality_notes: (m.querySelector('#meta-qual-notes') as HTMLInputElement)?.value.trim() || '',
      dataset_version: (m.querySelector('#meta-qual-version') as HTMLInputElement)?.value.trim() || '1.0.0',
      original_data_url: (m.querySelector('#meta-qual-url') as HTMLInputElement)?.value.trim() || '',
      source: 'User',
    };
  }
}
