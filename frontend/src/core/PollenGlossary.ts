/**
 * Pollen Taxa Glossary & OCR Spell Corrector
 * 标准化古生态/花粉属种拉丁学名词典与 OCR 常见错别字模糊纠错引擎
 */

import { DIATOM_GENERA, DIATOM_SOURCE_ALIASES } from './diatomGenera.ts';

export interface TaxaParseResult {
  original: string;
  corrected: string;
  wasCorrected: boolean;
  confidence: number;
  note?: string;
}

export class PollenGlossary {
  /**
   * 标准第四纪及全球常见花粉与孢粉属种权威拉丁名全库 (Quaternary & Global Pollen Taxa)
   */
  public static readonly CANONICAL_TAXA: string[] = [
    // 乔木树种 (Arboreal Pollen - AP)
    'Pinus',
    'Pinus canariensis',
    'Pinus sylvestris',
    'Pinus nigra',
    'Abies',
    'Abies alba',
    'Picea',
    'Picea abies',
    'Betula',
    'Betula nana',
    'Betula pendula',
    'Betula pubescens',
    'Alnus',
    'Alnus viridis',
    'Alnus glutinosa',
    'Alnus incana',
    'Quercus',
    'Quercus robur',
    'Quercus ilex',
    'Quercus petraea',
    'Quercus suber',
    'Quercus cerris',
    'Fagus',
    'Fagus sylvatica',
    'Carpinus',
    'Carpinus betulus',
    'Carpinus orientalis',
    'Corylus',
    'Corylus avellana',
    'Castanea',
    'Castanea sativa',
    'Ostrya',
    'Ostrya carpinifolia',
    'Ulmus',
    'Ulmus glabra',
    'Zelkova',
    'Celtis',
    'Tilia',
    'Tilia cordata',
    'Tilia platyphyllos',
    'Fraxinus',
    'Fraxinus excelsior',
    'Fraxinus ornus',
    'Salix',
    'Populus',
    'Populus tremula',
    'Juglans',
    'Juglans regia',
    'Carya',
    'Acer',
    'Acer campestre',
    'Platanus',
    'Liquidambar',
    'Cedrus',
    'Cedrus atlantica',
    'Larix',
    'Larix decidua',
    'Tsuga',
    'Juniperus',
    'Juniperus-type',
    'Cupressaceae',
    'Taxus',
    'Taxus baccata',
    'Ephedra',
    'Ephedra distachya-type',
    'Ephedra fragilis-type',

    // 灌木与特化类群 (Shrubs & Subshrubs)
    'Erica',
    'Erica-type',
    'Erica arborea',
    'Ericaceae',
    'Calluna',
    'Calluna vulgaris',
    'Vaccinium',
    'Olea',
    'Olea europaea',
    'Pistacia',
    'Pistacia lentiscus',
    'Pistacia terebinthus',
    'Myrica',
    'Myrica faya',
    'Tamarix',
    'Hippophae',
    'Hippophae rhamnoides',
    'Rhamnus',
    'Elaeagnus',
    'Sambucus',
    'Viburnum',

    // 草本植物 (Non-Arboreal Pollen - NAP)
    'Artemisia',
    'Artemisia-type',
    'Artemisia sp.',
    'Chenopodiaceae',
    'Chenopodiaceae/Amaranthaceae',
    'Amaranthaceae',
    'Chenopodium',
    'Atriplex',
    'Poaceae',
    'Gramineae',
    'Cerealia-type',
    'Secale-type',
    'Triticum-type',
    'Cyperaceae',
    'Carex',
    'Asteraceae',
    'Asteraceae Asteroideae',
    'Asteraceae Cichorioideae',
    'Asteroideae',
    'Cichorioideae',
    'Tubuliflorae',
    'Liguliflorae',
    'Centaurea',
    'Centaurea jacea-type',
    'Taraxacum-type',
    'Anthemis-type',
    'Brassicaceae',
    'Cruciferae',
    'Plantago',
    'Plantago lanceolata',
    'Plantago major/media',
    'Plantago coronopus',
    'Caryophyllaceae',
    'Stellaria',
    'Cerastium',
    'Silene',
    'Fabaceae',
    'Leguminosae',
    'Trifolium',
    'Lotus',
    'Vicia',
    'Rosaceae',
    'Potentilla-type',
    'Filipendula',
    'Sanguisorba',
    'Sanguisorba minor',
    'Sanguisorba officinalis',
    'Dryas octopetala',
    'Ranunculaceae',
    'Ranunculus-type',
    'Thalictrum',
    'Anemone',
    'Apiaceae',
    'Umbelliferae',
    'Daucus',
    'Polygonaceae',
    'Polygonum',
    'Polygonum bistorta',
    'Polygonum aviculare',
    'Rumex',
    'Rumex acetosella-type',
    'Urticaceae',
    'Urtica',
    'Urtica dioica',
    'Saxifragaceae',
    'Saxifraga',
    'Saxifraga oppositifolia-type',
    'Helianthemum',
    'Geraniaceae',
    'Geranium',
    'Malvaceae',
    'Lamiaceae',
    'Mentha-type',
    'Scrophulariaceae',
    'Campanulaceae',
    'Campanula',
    'Valerianaceae',
    'Valeriana',
    'Rubiaceae',
    'Galium',
    'Plumbaginaceae',
    'Armeria',

    // 水生与湿生植物 (Aquatics & Helophytes)
    'Typha',
    'Typha latifolia',
    'Typha angustifolia',
    'Sparganium',
    'Sparganium-type',
    'Potamogeton',
    'Myriophyllum',
    'Myriophyllum spicatum',
    'Myriophyllum alterniflorum',
    'Nuphar',
    'Nymphaea',
    'Alisma',
    'Sagittaria',
    'Isoetes',
    'Isoetes lacustris',
    'Isoetes echinospora',

    // 蕨类与苔藓孢子 (Pteridophytes & Bryophytes)
    'Pteridium',
    'Pteridium aquilinum',
    'Polypodiaceae',
    'Polypodium',
    'Polypodium vulgare',
    'Lycopodium',
    'Lycopodium clavatum',
    'Lycopodium annotinum',
    'Huperzia selago',
    'Selaginella',
    'Selaginella selaginoides',
    'Equisetum',
    'Osmunda',
    'Osmunda regalis',
    'Botrychium',
    'Ophioglossum',
    'Sphagnum',
    'Bryophyta',

    // ==================== 非花粉微体古生物 (NPP) ====================
    // 绿藻类 (Green algae)
    'Pediastrum',
    'Pediastrum boryanum',
    // Pediastrum 种下分类单元 (图版 I / II，中国与蒙古西部湖泊-水库表层沉积物常见)
    'Pediastrum simplex var. simplex',
    'Pediastrum simplex var. sturmmi',
    'Pediastrum simplex var. clathratum',
    'Pediastrum simplex var. biwaense',
    'Pediastrum simplex var. echinulatum',
    'Pediastrum duplex var. duplex',
    'Pediastrum duplex var. gracillim',
    'Pediastrum duplex var. rugulosum',
    'Pediastrum tetras',
    'Pediastrum boryanum var. boryanum',
    'Pediastrum boryanum var. longicorne type 1',
    'Pediastrum boryanum var. longicorne type 2',
    'Pediastrum cf. argentinense',
    'Pediastrum alternans',
    'Pediastrum boryanum var. brevicorne',
    'Pediastrum kawraiskyi',
    'Pediastrum angulosum var. angulosum',
    'Pediastrum asymmetricum',
    'Botryococcus',
    'Botryococcus braunii',
    'Zygnema',
    'Zygnema-type',
    'Spirogyra',
    'Mougeotia',
    'Cosmarium',
    'Staurastrum',
    'Scenedesmus',
    'Green algae',

    // 硅藻类 (Diatoms)
    'Diatom',
    'Diatoms',
    'Diatom frustule',
    'Melosira',
    'Cyclotella',
    'Navicula',
    'Pinnularia',
    'Cymbella',
    'Fragilaria',
    'Asterionella',
    'Synedra',
    'Tabellaria',
    'Gomphonema',
    'Nitzschia',
    'Coscinodiscus',

    // 摇蚊 (Chironomidae)
    'Chironomidae',
    'Chironomid head capsule',
    'Chironomid larva',
    'Chironomus',
    'Orthocladius',

    // 介形虫 (Ostracoda)
    'Ostracoda',
    'Ostracod',
    'Ostracod valve',
    'Ilyocypris',
    'Candona',
    'Eucypris',
    'Limnocythere',
    'Leucocythere',
    'Darwinula',
    'Candoniella',

    // 粪生真菌孢子 (Coprophilous fungal spores)
    'Coprophilous fungal spore',
    'Coprophilous fungi',
    'Sporormiella',
    'Sporormiella-type',
    'Sordariaceae',
    'Sordaria',
    'Cercophora',
    'Delitschia',
    'Podospora',
    'Chaetomium',
    'Xylaria',
    'Daldinia',
    'Coniochaeta',
    'Carbonicolous fungal spore',

    // 其他微体指标 (Other NPP)
    'Bryophyte spore',
    'Sphagnum spore',
    'Chrysophyte cyst',
    'Sponge spicule',
    'Cladocera',
    'Testate amoeba',
    'Rotifera',
    'Insect remains',
    'Plant tissue',

    // 火事件与统计指标 (Fire & Metrics)
    'Charcoal',
    'Micro-charcoal',
    'Macro-charcoal',
    'Pollen Concentration',
    'Total Pollen Sum',

    // ==================== 硅藻属 (Diatom genera) ====================
    // 自动注入自 ./diatomGenera（与后端 PollenDictionary 同一份词表）：
    // 内陆/淡水 151 属 + 海洋 114 属，含源表拼写别名。
    ...DIATOM_GENERA,
  ];

  /** 源检索表中的拼写异名 -> 规范属名（如 Thalasiosira -> Thalassiosira） */
  public static readonly SOURCE_ALIASES: Record<string, string> = DIATOM_SOURCE_ALIASES;

  /**
   * 内置词典的不可变索引。自定义词汇一律叠加在它之上，
   * 需要「清空/覆盖」时直接由它重建，避免把内置词条一起抹掉。
   */
  private static readonly builtinMap: Map<string, string> = new Map(
    PollenGlossary.CANONICAL_TAXA.map((t) => [t.toLowerCase(), t])
  );

  /** 当前生效的索引 = 内置词典 + 用户自定义扩展 */
  private static normalizedMap: Map<string, string> = new Map(PollenGlossary.builtinMap);

  /** 用户自定义扩展词汇 (内置词典之外追加，始终冗余保留，不会被覆盖) */
  private static customTaxa: string[] = [];

  /**
   * 设置用户自定义属种名，并保持与后端 `ocr.saveCustomTaxa` 的语义一致。
   *
   * @param names 全量自定义词汇
   * @param mode `'append'` 在内置词典与已有自定义之上追加；
   *             `'replace'` 先清空已有自定义再写入（内置词典不受影响）
   * @returns 实际写入的条目数
   */
  public static setCustomTaxa(names: string[], mode: 'append' | 'replace' = 'append'): number {
    if (mode === 'replace') {
      this.clearCustomTaxa();
    }
    let added = 0;
    for (const raw of names) {
      const name = this.cleanRawName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = this.normalizedMap.get(key);
      if (existing === name) continue;
      if (!this.customTaxa.includes(name)) {
        this.customTaxa.push(name);
      }
      this.normalizedMap.set(key, name);
      added++;
    }
    return added;
  }

  /**
   * 清空用户自定义扩展，并把索引重置回纯内置词典。
   *
   * 由 `builtinMap` 重建而非逐个 delete：自定义词条可能以不同大小写覆盖过
   * 内置键（用户输入 `pinus` vs 内置 `Pinus`），逐个删会把内置键一起删掉。
   */
  public static clearCustomTaxa(): void {
    this.customTaxa = [];
    this.normalizedMap = new Map(this.builtinMap);
  }

  /**
   * 追加用户自定义属种名到纠错词典（`setCustomTaxa` 的追加模式快捷方式）。
   * @returns 实际新增的条目数
   */
  public static addCustomTaxa(names: string[]): number {
    return this.setCustomTaxa(names, 'append');
  }

  /** 返回当前已加载的用户自定义词汇 */
  public static getCustomTaxa(): string[] {
    return [...this.customTaxa];
  }

  /** 内置词典条目数 (不含用户自定义扩展) */
  public static getBuiltinCount(): number {
    return this.CANONICAL_TAXA.length;
  }

  /**
   * 图版键匹配：独立单字母 + `)` `]` `、` 或 `.`（后接大写属名）。
   * 前置否定环视是必需的：否则 `Pediastrum cf. argentinense` 里的 `f.`、
   * `var.` 里的 `r.` 都会被当成图版键切掉。
   */
  private static readonly PLATE_KEY_RE = /(?<![A-Za-z])[a-zA-Z]\s*(?:[)\]。、]|\.(?=\s+[A-Z]))/g;

  /**
   * 清理并规范化原始输入字符串
   * （移除 Markdown 斜体 *、下划线、前导编号、图版键 `a)` 等）
   */
  public static cleanRawName(raw: string): string {
    return raw
      .replace(/[*_~`"']/g, '') // 移除 Markdown 强调符号与引号
      .replace(/^[\d+.)\-•\s]+/, '') // 移除前导数字或项目符号，如 "1. " 或 "- "
      .replace(/^[a-zA-Z]\s*[)\]。、]\s*(?=[A-Z\u4e00-\u9fff])/, '') // 移除期刊图版键，如 "a) "
      .replace(/\s+/g, ' ') // 多个空格合并为一个
      .trim();
  }

  /**
   * 针对常见扫描 OCR 错别字做字符级预修复
   * 例如扫描识别常把 rn 认成 m，cl 认成 d，0 认成 O，1 认成 l 等
   */
  public static prehealOcr(str: string): string {
    return str
      .replace(/0([a-zA-Z])/g, 'O$1') // 0lea -> Olea
      .replace(/([a-zA-Z])0/g, '$1o')
      .replace(/1([a-zA-Z])/g, 'l$1')
      .replace(/5([a-zA-Z])/g, 'S$1')
      .replace(/8([a-zA-Z])/g, 'B$1');
  }

  /**
   * 计算两个字符串的 Levenshtein 最小编辑距离
   */
  public static levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // 删除
          dp[i][j - 1] + 1, // 插入
          dp[i - 1][j - 1] + cost // 替换
        );

        // 支持相邻字符易位 (Damerau 转置)
        if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * 对单个输入的拉丁属种名进行标准化与模糊 OCR 纠错
   */
  public static correct(raw: string): TaxaParseResult {
    const cleaned = this.cleanRawName(raw);
    if (!cleaned) {
      return { original: raw, corrected: '', wasCorrected: false, confidence: 0 };
    }

    const prehealed = this.prehealOcr(cleaned);
    const lower = prehealed.toLowerCase();

    // 1. 完全精确匹配（大小写不敏感）
    if (this.normalizedMap.has(lower)) {
      const matched = this.normalizedMap.get(lower)!;
      return {
        original: cleaned,
        corrected: matched,
        wasCorrected: cleaned !== matched,
        confidence: 1.0,
      };
    }

    // 2. 剥离通用词缀后检查属名匹配 (如 "Artemisia sp." / "Erica-type")
    const suffixRegex = /([-\s](type|sp\.|spp\.|gr\.|group|t\.))$/i;
    const suffixMatch = prehealed.match(suffixRegex);
    const suffix = suffixMatch ? suffixMatch[0] : '';
    const baseCore = suffix ? prehealed.slice(0, -suffix.length).trim() : prehealed;
    const baseLower = baseCore.toLowerCase();

    if (this.normalizedMap.has(baseLower)) {
      const matched = this.normalizedMap.get(baseLower)!;
      const combined = `${matched}${suffix}`;
      return {
        original: cleaned,
        corrected: combined,
        wasCorrected: cleaned !== combined,
        confidence: 0.98,
      };
    }

    // 3. 特殊 OCR 模式增强处理 (如 'm' -> 'in', 例如 Pmus -> Pinus, or Cornus -> Comus)
    const candidatesToScore = [baseLower];
    if (baseLower.includes('m')) {
      candidatesToScore.push(baseLower.replace(/m/g, 'in'));
      candidatesToScore.push(baseLower.replace(/m/g, 'rn'));
    }
    if (baseLower.includes('rn')) {
      candidatesToScore.push(baseLower.replace(/rn/g, 'm'));
    }
    if (baseLower.includes('cl')) {
      candidatesToScore.push(baseLower.replace(/cl/g, 'd'));
    }
    if (baseLower.includes('vv')) {
      candidatesToScore.push(baseLower.replace(/vv/g, 'w'));
    }

    // 先检测模式替换后是否有直接命中的词典项
    for (const cand of candidatesToScore) {
      if (this.normalizedMap.has(cand)) {
        const matched = this.normalizedMap.get(cand)!;
        const combined = `${matched}${suffix}`;
        return {
          original: cleaned,
          corrected: combined,
          wasCorrected: true,
          confidence: 0.95,
          note: '基于常见 OCR 扫描连字符形近替换修复',
        };
      }
    }

    // 4. 全局模糊匹配 (Fuzzy Levenshtein Distance)
    let bestMatch: string | null = null;
    let minDistance = Infinity;
    let maxSimilarity = 0;

    for (const canonical of this.CANONICAL_TAXA) {
      const cLower = canonical.toLowerCase();
      // 分别对原词和剥离词缀的核心词求距离
      for (const cand of candidatesToScore) {
        const dist = this.levenshteinDistance(cand, cLower);
        const maxLen = Math.max(cand.length, cLower.length);
        const similarity = 1 - dist / (maxLen || 1);

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          minDistance = dist;
          bestMatch = canonical;
        }
      }
    }

    // 判定阈值：
    // 如果长度 >= 5 且编辑距离 <= 2，或者相似度 >= 0.73，接受纠错
    // 如果长度 4 (如 Olea, Tilia)，编辑距离 <= 1
    const len = baseCore.length;
    const isAcceptable =
      (len <= 4 && minDistance <= 1 && maxSimilarity >= 0.75) ||
      (len >= 5 && minDistance <= 2 && maxSimilarity >= 0.72) ||
      (len >= 8 && minDistance <= 3 && maxSimilarity >= 0.72);

    if (isAcceptable && bestMatch) {
      const finalResult = suffix && !bestMatch.toLowerCase().endsWith(suffix.toLowerCase().trim())
        ? `${bestMatch}${suffix}`
        : bestMatch;

      return {
        original: cleaned,
        corrected: finalResult,
        wasCorrected: true,
        confidence: Number(maxSimilarity.toFixed(2)),
        note: `词典拼写校正 (相似度 ${(maxSimilarity * 100).toFixed(0)}%)`,
      };
    }

    // 5. 无法高置信度纠错，保留用户原始输入（首字母自动大写优化）
    const formatted = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return {
      original: cleaned,
      corrected: formatted,
      wasCorrected: false,
      confidence: 0.5,
    };
  }

  /**
   * 判断文本是否为期刊图版说明（含 `a)` / `b.` 等图版键）。
   */
  public static looksLikePlateCaption(input: string): boolean {
    return /(?<![A-Za-z])[a-zA-Z]\s*(?:[)\]。、]|\.(?=\s+[A-Z]))/.test(input);
  }

  /**
   * 将用户从 Excel（单行制表符分隔/单列回车分隔）、Word 文献，或
   * 期刊图版说明（`a) Genus species; b) ...`，含属名中间的硬换行）复制的
   * 批量属种名进行切分并纠错。
   *
   * @param input 原始文本内容
   * @param enableFuzzy 是否启用花粉词典自动模糊纠错
   */
  public static parseTaxaList(
    input: string,
    enableFuzzy: boolean = true
  ): TaxaParseResult[] {
    if (!input || !input.trim()) return [];

    let work = input;
    if (this.looksLikePlateCaption(input)) {
      // 图版说明：先折叠全部空白以修复属名中间的硬换行，
      // 再把图版键替换成分隔符（而非按它切分）——否则 `c), d)` 这种
      // 后一个键后面才跟大写属名的多键前缀会残留一个孤立的 `c)`。
      work = input.replace(/\s+/g, ' ').replace(this.PLATE_KEY_RE, ';');
      const firstSep = work.indexOf(';');
      if (firstSep >= 0) work = work.slice(firstSep); // 丢弃图版键之前的标题文字
    }

    // 切分正则：支持回车、换行、制表符、分号、逗号（非括号内）
    const tokens = work
      .split(/[\r\n\t;]+/)
      .flatMap((part) => {
        // 如果一行内含有逗号且不包含括号，则按逗号细分
        if (part.includes(',') && !part.includes('(')) {
          return part.split(',');
        }
        return [part];
      })
      .map((s) => s.trim().replace(/[.。]$/, ''))
      .filter((s) => s.length > 0);

    return tokens.map((token) => {
      if (enableFuzzy) {
        return this.correct(token);
      }
      const cleaned = this.cleanRawName(token);
      const formatted = cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
      return {
        original: cleaned,
        corrected: formatted,
        wasCorrected: false,
        confidence: 1.0,
      };
    });
  }
}
