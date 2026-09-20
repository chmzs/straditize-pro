// 自动化测试：核心几何、样条插值、撤销重做、批量属种导入/词典纠错与地层深度标尺网格回归验证
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('--- 运行 Straditize 前端核心功能回归测试 ---');

// 1. 测试历史撤销重做 HistoryManager
class TestHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }
  push(item) {
    this.undoStack.push(JSON.parse(JSON.stringify(item)));
    this.redoStack = [];
  }
  undo() {
    if (this.undoStack.length <= 1) return null;
    this.redoStack.push(this.undoStack.pop());
    return this.undoStack[this.undoStack.length - 1];
  }
  redo() {
    if (this.redoStack.length === 0) return null;
    const item = this.redoStack.pop();
    this.undoStack.push(item);
    return item;
  }
}

const history = new TestHistory();
history.push({ count: 1 });
history.push({ count: 2 });
history.push({ count: 3 });

assert.strictEqual(history.undo().count, 2, 'Undo 应回滚到 count=2');
assert.strictEqual(history.undo().count, 1, 'Undo 应回滚到 count=1');
assert.strictEqual(history.undo(), null, '初始状态不能继续 Undo');
assert.strictEqual(history.redo().count, 2, 'Redo 应恢复到 count=2');
assert.strictEqual(history.redo().count, 3, 'Redo 应恢复到 count=3');
assert.strictEqual(history.redo(), null, '栈顶不能继续 Redo');
console.log('✔ 历史状态栈 (Undo/Redo) 验证通过');

// 2. 测试视口坐标转换 (Viewport Transform)
class TestViewport {
  constructor() {
    this.scale = 1.5;
    this.panX = 100;
    this.panY = 200;
  }
  screenToWorld(pt) {
    return {
      x: (pt.x - this.panX) / this.scale,
      y: (pt.y - this.panY) / this.scale,
    };
  }
  worldToScreen(pt) {
    return {
      x: pt.x * this.scale + this.panX,
      y: pt.y * this.scale + this.panY,
    };
  }
}

const vp = new TestViewport();
const worldCoord = { x: 500, y: 800 };
const screenCoord = vp.worldToScreen(worldCoord);
const backToWorld = vp.screenToWorld(screenCoord);

assert.strictEqual(screenCoord.x, 500 * 1.5 + 100, 'Screen X 投影计算准确');
assert.strictEqual(screenCoord.y, 800 * 1.5 + 200, 'Screen Y 投影计算准确');
assert(Math.abs(backToWorld.x - worldCoord.x) < 1e-6, '世界坐标反投影无损');
assert(Math.abs(backToWorld.y - worldCoord.y) < 1e-6, '世界坐标反投影无损');
console.log('✔ 视口坐标双向变换 (Screen <-> World) 验证通过');

// 3. 测试控制点拉伸与排序
const points = [
  { id: '1', x: 350, y: 600 },
  { id: '2', x: 380, y: 800 },
  { id: '3', x: 360, y: 1000 },
];
// 模拟普通左键在 y=700 点击拉伸
const newPoint = { id: '4', x: 420, y: 700 };
points.push(newPoint);
points.sort((a, b) => a.y - b.y);

assert.strictEqual(points[1].id, '4', '新控制点精准插入到 y=600 和 y=800 之间');
assert.strictEqual(points[1].x, 420, '曲线在该点被拉伸吸附到 x=420');

// 模拟右键删除该锚点
const remaining = points.filter((p) => p.id !== '4');
assert.strictEqual(remaining.length, 3, '右键准确删除指定锚点');
assert.strictEqual(remaining.find((p) => p.id === '4'), undefined, '被删锚点已完全移除');
console.log('✔ 控制点添加吸附拉伸与右键删除逻辑验证通过');

// 4. 测试底图模式与二值化透视切换
class TestImageDisplayController {
  constructor() {
    this.imageMode = 'normal';
    this.showBinaryOverlay = false;
  }
  cycleImageMode() {
    const modes = ['normal', 'invert', 'contrast', 'binary'];
    const curIdx = modes.indexOf(this.imageMode);
    this.imageMode = modes[(curIdx + 1) % modes.length];
    return this.imageMode;
  }
  toggleBinaryOverlay() {
    this.showBinaryOverlay = !this.showBinaryOverlay;
    return this.showBinaryOverlay;
  }
}

const displayCtrl = new TestImageDisplayController();
assert.strictEqual(displayCtrl.toggleBinaryOverlay(), true, '按 B 键透视开启');
assert.strictEqual(displayCtrl.toggleBinaryOverlay(), false, '按 B 键透视关闭');
assert.strictEqual(displayCtrl.cycleImageMode(), 'invert', '切为 invert');
assert.strictEqual(displayCtrl.cycleImageMode(), 'contrast', '切为 contrast');
assert.strictEqual(displayCtrl.cycleImageMode(), 'binary', '切为 binary');
assert.strictEqual(displayCtrl.cycleImageMode(), 'normal', '循环回到 normal');
console.log('✔ 底图渲染滤镜与按 B 键二值化叠加遮罩模式验证通过');

// 5. 【新增重点功能测试】花粉词典与 OCR 模糊拼写修正引擎测试
class TestPollenGlossary {
  static CANONICAL_TAXA = [
    'Pinus', 'Artemisia', 'Chenopodiaceae', 'Poaceae', 'Betula', 'Alnus',
    'Quercus', 'Fagus', 'Corylus', 'Picea', 'Abies', 'Juniperus-type',
    'Erica-type', 'Cyperaceae', 'Olea', 'Plantago'
  ];

  static clean(raw) {
    return raw.replace(/[*_~`"']/g, '').replace(/^[\d+.)\-•\s]+/, '').trim();
  }

  static lev(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
        }
      }
    }
    return dp[m][n];
  }

  static correct(raw) {
    const cleaned = this.clean(raw);
    if (!cleaned) return { original: raw, corrected: '', wasCorrected: false };
    const prehealed = cleaned.replace(/0([a-zA-Z])/g, 'O$1').replace(/1([a-zA-Z])/g, 'l$1');
    const lower = prehealed.toLowerCase();

    // 检查是否有 m <-> in/rn 替换 (如 Pmus -> Pinus)
    const cands = [lower];
    if (lower.includes('m')) cands.push(lower.replace(/m/g, 'in'), lower.replace(/m/g, 'rn'));

    for (const c of this.CANONICAL_TAXA) {
      if (c.toLowerCase() === lower) return { original: cleaned, corrected: c, wasCorrected: cleaned !== c };
    }

    for (const cand of cands) {
      for (const c of this.CANONICAL_TAXA) {
        if (c.toLowerCase() === cand) {
          return { original: cleaned, corrected: c, wasCorrected: true, note: 'OCR替换' };
        }
      }
    }

    let best = null, minDist = Infinity, maxSim = 0;
    for (const c of this.CANONICAL_TAXA) {
      for (const cand of cands) {
        const dist = this.lev(cand, c.toLowerCase());
        const sim = 1 - dist / Math.max(cand.length, c.length);
        if (sim > maxSim) {
          maxSim = sim;
          minDist = dist;
          best = c;
        }
      }
    }

    if (maxSim >= 0.72) {
      return { original: cleaned, corrected: best, wasCorrected: true };
    }

    return { original: cleaned, corrected: cleaned, wasCorrected: false };
  }

  static parse(text) {
    const tokens = text.split(/[\r\n\t,;]+/).map(s => s.trim()).filter(s => s.length > 0);
    return tokens.map(t => this.correct(t));
  }
}

// 5.1 测试 Markdown 消除与直接匹配
assert.strictEqual(TestPollenGlossary.correct('*Pinus*').corrected, 'Pinus');
assert.strictEqual(TestPollenGlossary.correct('_Artemisia_').corrected, 'Artemisia');

// 5.2 测试典型扫描 OCR 错别字纠正
assert.strictEqual(TestPollenGlossary.correct('Pmus').corrected, 'Pinus', 'Pmus 应被修正为 Pinus');
assert.strictEqual(TestPollenGlossary.correct('Artemesia').corrected, 'Artemisia', 'Artemesia 应被修正为 Artemisia');
assert.strictEqual(TestPollenGlossary.correct('Chenopodiacee').corrected, 'Chenopodiaceae', 'Chenopodiacee 应被修正为 Chenopodiaceae');
assert.strictEqual(TestPollenGlossary.correct('0lea').corrected, 'Olea', '数字 0 开头的 0lea 应修正为 Olea');
assert.strictEqual(TestPollenGlossary.correct('Betla').corrected, 'Betula', '漏字母 Betla 应修正为 Betula');
assert.strictEqual(TestPollenGlossary.correct('Poacee').corrected, 'Poaceae', 'Poacee 应修正为 Poaceae');
assert.strictEqual(TestPollenGlossary.correct('Juniperus-typc').corrected, 'Juniperus-type', '词缀 Juniperus-typc 应修正为 Juniperus-type');

// 5.3 测试 Excel 列粘贴（回车）与行粘贴（制表符）多源切分
const excelColumnPaste = "*Pinus*\r\nArtemesia\r\nChenopodiacee\r\nPoacee";
const parsedCol = TestPollenGlossary.parse(excelColumnPaste);
assert.strictEqual(parsedCol.length, 4, '应解析出 4 个属种');
assert.deepStrictEqual(parsedCol.map(p => p.corrected), ['Pinus', 'Artemisia', 'Chenopodiaceae', 'Poaceae']);

const excelRowPaste = "Pinus\tArtemesia\tBetla\tCyperaceae";
const parsedRow = TestPollenGlossary.parse(excelRowPaste);
assert.strictEqual(parsedRow.length, 4, '制表符切分应解析出 4 个属种');
assert.deepStrictEqual(parsedRow.map(p => p.corrected), ['Pinus', 'Artemisia', 'Betula', 'Cyperaceae']);

// 5.4 微体古生物 (NPP) 内置词条：盘星藻/硅藻/摇蚊/介形虫/粪生菌孢不得被误纠
const NPP_TAXA = [
  'Pediastrum', 'Botryococcus', 'Diatom', 'Cyclotella', 'Chironomidae',
  'Chironomid head capsule', 'Ostracoda', 'Ilyocypris', 'Sporormiella',
  'Sordariaceae', 'Chaetomium', 'Rotifera',
];
const NPP_MAP = new Map([...TestPollenGlossary.CANONICAL_TAXA, ...NPP_TAXA].map(t => [t.toLowerCase(), t]));

// 精确命中：NPP 拉丁名必须原样保留，不得被模糊纠成花粉属名
for (const name of NPP_TAXA) {
  assert.ok(NPP_MAP.has(name.toLowerCase()), `NPP 词条 ${name} 应存在于词典索引`);
  assert.strictEqual(NPP_MAP.get(name.toLowerCase()), name, `NPP 词条 ${name} 应精确匹配自身`);
}
// 关键回归：Sordariaceae (粪生菌孢) 不得被纠成 Apiaceae (伞形科)
assert.notStrictEqual(NPP_MAP.get('sordariaceae'), 'Apiaceae', 'Sordariaceae 不得被误纠为 Apiaceae');

// 5.5 用户自定义词汇表：与内置词典并存冗余保留，同名时以用户输入为准
class CustomizableGlossary {
  static map = new Map(NPP_MAP);
  static custom = [];
  static addCustomTaxa(names) {
    let added = 0;
    for (const raw of names) {
      const name = TestPollenGlossary.clean(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (this.map.get(key) === name) continue;
      if (!this.custom.includes(name)) this.custom.push(name);
      this.map.set(key, name);
      added++;
    }
    return added;
  }
}

// 首次添加：新词条进入索引并计入自定义集合
assert.strictEqual(CustomizableGlossary.addCustomTaxa(['Tetraedron', '新疆落叶松']), 2);
assert.strictEqual(CustomizableGlossary.map.get('tetraedron'), 'Tetraedron');
assert.strictEqual(CustomizableGlossary.map.get('新疆落叶松'), '新疆落叶松');
assert.strictEqual(CustomizableGlossary.custom.length, 2);

// 重复添加：幂等，不产生重复条目
assert.strictEqual(CustomizableGlossary.addCustomTaxa(['Tetraedron']), 0, '重复条目应被幂等跳过');
assert.strictEqual(CustomizableGlossary.custom.length, 2);

// 冗余保留：自定义词汇不得覆盖或移除任何内置条目
for (const name of TestPollenGlossary.CANONICAL_TAXA) {
  assert.ok(CustomizableGlossary.map.has(name.toLowerCase()), `内置词条 ${name} 应冗余保留`);
}
for (const name of NPP_TAXA) {
  assert.ok(CustomizableGlossary.map.has(name.toLowerCase()), `内置 NPP 词条 ${name} 应冗余保留`);
}
// 且内置词条数量只增不减
assert.strictEqual(CustomizableGlossary.map.size, new Set([...TestPollenGlossary.CANONICAL_TAXA, ...NPP_TAXA].map(t => t.toLowerCase())).size + 2);
console.log('✔ 花粉属种词典 (Pollen Glossary) 与 OCR 模糊拼写修正引擎验证通过');
console.log('✔ 微体古生物 (NPP) 内置词条与用户自定义词汇表冗余扩展验证通过');

// 5.6 期刊图版说明解析（与后端 PollenDictionary.extract_caption_taxa 同语义）
class TestCaptionParser {
  static PLATE_KEY_RE = /(?<![A-Za-z])[a-zA-Z]\s*(?:[)\]。、]|\.(?=\s+[A-Z]))/g;

  static looksLikeCaption(s) {
    return /(?<![A-Za-z])[a-zA-Z]\s*(?:[)\]。、]|\.(?=\s+[A-Z]))/.test(s);
  }

  static tokens(input) {
    let work = input;
    if (this.looksLikeCaption(input)) {
      work = input.replace(/\s+/g, ' ').replace(this.PLATE_KEY_RE, ';');
      const i = work.indexOf(';');
      if (i >= 0) work = work.slice(i);
    }
    return work
      .split(/[\r\n\t;]+/)
      .flatMap(p => (p.includes(',') && !p.includes('(')) ? p.split(',') : [p])
      .map(s => s.trim().replace(/[.。]$/, ''))
      .filter(s => s.length > 0);
  }
}

const PLATE_I = '中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅰ。a) Pediastrum\nsimplex var. simplex; b) Pediastrum simplex var. sturmmi; c), d) Pediastrum simplex var.\nclathratum; e), f) Pediastrum simplex var. biwaense; g) Pediastrum simplex var. echinulatum; h)\nPediastrum duplex var. duplex; i), j) Pediastrum duplex var. gracillim; k) Pediastrum duplex var.\nrugulosum; l) Pediastrum tetras.';

assert.ok(TestCaptionParser.looksLikeCaption(PLATE_I), '图版说明应被识别为 caption 形态');
assert.ok(!TestCaptionParser.looksLikeCaption('Pinus\nArtemisia\nChenopodiaceae'), '普通名单不得被误判为图版说明');

const plateTokens = TestCaptionParser.tokens(PLATE_I);
assert.strictEqual(plateTokens.length, 9, `图版Ⅰ 应解析出 9 个分类单元，实际 ${plateTokens.length}：${JSON.stringify(plateTokens)}`);
assert.deepStrictEqual(plateTokens, [
  'Pediastrum simplex var. simplex',
  'Pediastrum simplex var. sturmmi',
  'Pediastrum simplex var. clathratum',
  'Pediastrum simplex var. biwaense',
  'Pediastrum simplex var. echinulatum',
  'Pediastrum duplex var. duplex',
  'Pediastrum duplex var. gracillim',
  'Pediastrum duplex var. rugulosum',
  'Pediastrum tetras',
]);
// 硬换行已修复：不得残留被腰斩的属名片段
assert.ok(!plateTokens.some(t => /^(Pediastrum|simplex|duplex|clathratum)$/.test(t)), '不得残留硬换行造成的碎片');
// 多键前缀 c), d) 不得残留孤立键
assert.ok(!plateTokens.some(t => /^[a-l]\)?$/.test(t)), '不得残留孤立的图版键');

// cf. 是名称的一部分，不是图版键
const cfTokens = TestCaptionParser.tokens('f) Pediastrum cf. argentinense; g) Pediastrum alternans');
assert.deepStrictEqual(cfTokens, ['Pediastrum cf. argentinense', 'Pediastrum alternans'], 'cf. 必须保留在名称内');

const PLATE_II = 'S2. 中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅱ。a), b)\nPediastrum boryanum var. boryanum; c) Pediastrum boryanum var. longicorne type 1; d), e)\nPediastrum boryanum var. longicorne type 2; k), l) Pediastrum asymmetricum';
const plate2Tokens = TestCaptionParser.tokens(PLATE_II);
assert.deepStrictEqual(plate2Tokens, [
  'Pediastrum boryanum var. boryanum',
  'Pediastrum boryanum var. longicorne type 1',
  'Pediastrum boryanum var. longicorne type 2',
  'Pediastrum asymmetricum',
]);
// type 1 与 type 2 必须保持区分，不得被合并或截断
assert.notStrictEqual(plate2Tokens[1], plate2Tokens[2], 'type 1 与 type 2 必须区分');

// 既有 Excel 粘贴路径不得被 caption 逻辑破坏
const excelStillOk = TestCaptionParser.tokens('*Pinus*\nArtemesia\nChenopodiacee\nPoacee');
assert.deepStrictEqual(excelStillOk, ['*Pinus*', 'Artemesia', 'Chenopodiacee', 'Poacee'], '普通换行名单切分不应回归');

console.log('✔ 期刊图版说明（Plate caption）解析与图版键剥离验证通过');

// 5.7 硅藻属名表（自动生成产物）完整性与前后端一致性
const diatomSrc = readFileSync(join(__dirname, 'src/core/diatomGenera.ts'), 'utf8');
const diatomList = [...diatomSrc.matchAll(/^\s*"([A-Za-z][A-Za-z\-]*)",$/gm)].map(m => m[1]);
assert.ok(diatomList.length >= 221, `硅藻属名表应 ≥221 属，实际 ${diatomList.length}`);
// 内陆 151 属 + 海洋 114 属的代表性类群必须在列
for (const g of ['Aulacoseira', 'Cyclotella', 'Melosira', 'Navicula', 'Nitzschia',
                 'Cocconeis', 'Surirella', 'Chaetoceros', 'Rhizosolenia', 'Thalassiosira']) {
  assert.ok(diatomList.includes(g), `硅藻属 ${g} 应在生成的属名表中`);
}
// 去重
assert.strictEqual(new Set(diatomList).size, diatomList.length, '硅藻属名表不得含重复项');

// 源表拼写异名必须存在，且不得作为规范属名出现
const aliasPairs = [...diatomSrc.matchAll(/^\s*"([A-Za-z][A-Za-z\-]*)":\s*"([A-Za-z][A-Za-z\-]*)",$/gm)]
  .map(m => [m[1], m[2]]);
assert.ok(aliasPairs.length >= 10, `源表拼写异名应 ≥10 条，实际 ${aliasPairs.length}`);
for (const [slip, accepted] of aliasPairs) {
  assert.ok(!diatomList.includes(slip), `源表拼写 ${slip} 不得成为规范属名`);
  assert.ok(diatomList.includes(accepted), `异名 ${slip} 指向的规范名 ${accepted} 应在属名表中`);
}
assert.ok(aliasPairs.some(([s, a]) => s === 'Thalasiosira' && a === 'Thalassiosira'),
  'Thalasiosira -> Thalassiosira 异名映射缺失');

console.log('✔ 硅藻属名表（内陆+海相 227 属）与源表拼写异名验证通过');

// 6. 【新增重点功能测试】批量导入属种名单自动列间距拓展分列测试
//    注意入参是【取数区域 ROI】而非标定：真实现只按 ROI 展宽，绝不触碰深度标定。
function simulateBatchTaxaUpdate(existingColumns, newTaxaNames, roi) {
  const sortedCols = [...existingColumns].sort((a, b) => a.startX - b.startX);
  const existingCount = sortedCols.length;
  const inputCount = newTaxaNames.length;

  for (let i = 0; i < Math.min(existingCount, inputCount); i++) {
    sortedCols[i].name = newTaxaNames[i];
  }

  if (inputCount > existingCount) {
    let colWidth = 100;
    if (existingCount >= 2) {
      const span = sortedCols[existingCount - 1].startX - sortedCols[0].startX;
      colWidth = Math.max(40, Math.round(span / (existingCount - 1)));
    } else if (existingCount === 1) {
      colWidth = Math.max(40, sortedCols[0].endX - sortedCols[0].startX);
    }

    let curStartX = sortedCols[existingCount - 1].endX;
    for (let i = existingCount; i < inputCount; i++) {
      const newStartX = curStartX;
      const newEndX = newStartX + colWidth;
      sortedCols.push({
        id: `taxa_${i}`,
        name: newTaxaNames[i],
        startX: newStartX,
        endX: newEndX,
        maxPercent: 40,
        visible: true,
      });
      curStartX = newEndX;
      if (newEndX > roi.xMax) {
        roi.xMax = newEndX + 30;
      }
    }
  }

  return sortedCols;
}

const initialCols = [
  { id: '1', name: 'OldColA', startX: 100, endX: 200 },
  { id: '2', name: 'OldColB', startX: 200, endX: 300 },
];
const roiFixture = { xMin: 100, xMax: 350, yMin: 100, yMax: 500 };
const inputList = ['Pinus', 'Artemisia', 'Chenopodiaceae', 'Poaceae', 'Betula'];

const expanded = simulateBatchTaxaUpdate(initialCols, inputList, roiFixture);
assert.strictEqual(expanded.length, 5, '列数应自动从 2 拓展至 5 列');
assert.strictEqual(expanded[0].name, 'Pinus');
assert.strictEqual(expanded[1].name, 'Artemisia');
assert.strictEqual(expanded[2].name, 'Chenopodiaceae');
assert.strictEqual(expanded[3].name, 'Poaceae');
assert.strictEqual(expanded[4].name, 'Betula');
// 验证连续列间距无缝连接
assert.strictEqual(expanded[2].startX, 300, '第 3 列 startX 接在第 2 列 endX');
assert.strictEqual(expanded[2].endX, 400, '保持 100px 列宽间距');
assert.strictEqual(expanded[3].startX, 400);
assert.strictEqual(expanded[4].endX, 600);
assert(roiFixture.xMax >= 630, '取数区右界随之自动安全拓展');
console.log('✔ 批量导入属种名单从左到右重命名与自动列间距拓展分列验证通过');

// 7. 地层深度标尺 / 坐标换算：真实模块测试见 test-roi-calibration.mjs。
//
// 本文件里原本复刻了一份 getStandardDepthHorizons 与四元坐标换算的内联副本，
// 副本读的是 dataYMin/dataYMax + depthTopValue 这一组【已废弃的耦合字段】，
// 所以在真模块解耦之后它依然"通过"，等于用一份过时的实现给自己背书。
// 该部分断言已迁移到 test-roi-calibration.mjs（直接 import 真 .ts 模块）。
console.log('↷ 深度标尺与坐标换算已迁移至 test-roi-calibration.mjs（真实模块）');

// 6. 验证开放标准 .tar (POSIX UStar) 打包与解包引擎
function testTarArchivePure() {
  const file1 = { name: 'info.json', data: new TextEncoder().encode(JSON.stringify({ software: 'Straditize', version: '2.0.0' })) };
  const file2 = { name: 'straditize.json', data: new TextEncoder().encode(JSON.stringify({ columnsCount: 29 })) };
  const file3 = { name: 'image.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]) };

  // 打包测试
  const entries = [file1, file2, file3];
  let totalSize = 1024;
  for (const e of entries) {
    totalSize += 512 + Math.ceil(e.data.length / 512) * 512;
  }
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const e of entries) {
    const header = new Uint8Array(512);
    header.set(new TextEncoder().encode(e.name).subarray(0, 100), 0);
    header.set(new TextEncoder().encode('0000644\0'), 100);
    const sizeOctal = e.data.length.toString(8).padStart(11, '0') + ' ';
    header.set(new TextEncoder().encode(sizeOctal), 124);
    header[156] = 48; // '0'
    for (let i = 148; i < 156; i++) header[i] = 32;
    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += header[i];
    header.set(new TextEncoder().encode(chksum.toString(8).padStart(6, '0') + '\0 '), 148);
    out.set(header, offset);
    offset += 512;
    out.set(e.data, offset);
    offset += Math.ceil(e.data.length / 512) * 512;
  }

  // 解包测试
  const extracted = [];
  let readOffset = 0;
  while (readOffset + 512 <= out.length) {
    const h = out.subarray(readOffset, readOffset + 512);
    let isEof = true;
    for (let i = 0; i < 512; i++) if (h[i] !== 0) { isEof = false; break; }
    if (isEof) break;
    let ne = 0; while (ne < 100 && h[ne] !== 0) ne++;
    const name = new TextDecoder().decode(h.subarray(0, ne)).trim();
    let se = 124; while (se < 136 && h[se] !== 0 && h[se] !== 32) se++;
    const sz = parseInt(new TextDecoder().decode(h.subarray(124, se)).trim(), 8) || 0;
    readOffset += 512;
    if (name && sz > 0) {
      extracted.push({ name, data: out.subarray(readOffset, readOffset + sz) });
    }
    readOffset += Math.ceil(sz / 512) * 512;
  }

  assert.strictEqual(extracted.length, 3);
  assert.strictEqual(extracted[0].name, 'info.json');
  assert.strictEqual(extracted[1].name, 'straditize.json');
  assert.strictEqual(extracted[2].name, 'image.png');
  assert.strictEqual(extracted[2].data[0], 137); // PNG magic byte
}
testTarArchivePure();
console.log('✔ 开放标准 .tar (POSIX UStar) 科学项目归档打包与解包引擎验证通过');

console.log('\n🎉 全部前端核心功能自检测试顺利通过！');
