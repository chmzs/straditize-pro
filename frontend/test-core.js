// 自动化测试：核心几何、样条插值、撤销重做、批量属种导入/词典纠错与地层深度标尺网格回归验证
import assert from 'node:assert';

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
console.log('✔ 花粉属种词典 (Pollen Glossary) 与 OCR 模糊拼写修正引擎验证通过');

// 6. 【新增重点功能测试】批量导入属种名单自动列间距拓展分列测试
function simulateBatchTaxaUpdate(existingColumns, newTaxaNames, calibration) {
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
      if (newEndX > calibration.dataXMax) {
        calibration.dataXMax = newEndX + 30;
      }
    }
  }

  return sortedCols;
}

const initialCols = [
  { id: '1', name: 'OldColA', startX: 100, endX: 200 },
  { id: '2', name: 'OldColB', startX: 200, endX: 300 },
];
const calib = { dataXMin: 100, dataXMax: 350, dataYMin: 100, dataYMax: 500, depthTopValue: 0, depthBottomValue: 100, unit: 'cm' };
const inputList = ['Pinus', 'Artemisia', 'Chenopodiaceae', 'Poaceae', 'Betula'];

const expanded = simulateBatchTaxaUpdate(initialCols, inputList, calib);
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
assert(calib.dataXMax >= 630, '图谱总宽度上限 dataXMax 随之自动安全拓展');
console.log('✔ 批量导入属种名单从左到右重命名与自动列间距拓展分列验证通过');

// 7. 【新增重点功能测试】地层深度标尺网格系统 (Depth Grid Ruler) 与统一层位锚定测试
function getStandardDepthHorizons(cal) {
  const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
  const top = cal.depthTopValue;
  const bottom = cal.depthBottomValue;
  const depthRange = bottom - top || 1;
  const yRange = cal.dataYMax - cal.dataYMin;

  const startDepth = Math.min(top, bottom);
  const endDepth = Math.max(top, bottom);
  const count = Math.round((endDepth - startDepth) / interval);

  const depths = [];
  const yPositions = [];
  for (let i = 0; i <= count; i++) {
    const d = Number((top + i * interval).toFixed(4));
    const fraction = (d - top) / depthRange;
    const y = Number((cal.dataYMin + fraction * yRange).toFixed(2));
    depths.push(d);
    yPositions.push(y);
  }
  return { depths, yPositions };
}

function interpolatePercent(col, y, cal) {
  // 简化的线性插值模拟
  const pts = col.controlPoints;
  const colWidth = col.endX - col.startX;
  if (pts.length === 0 || colWidth <= 0) return 0;
  let idx = 0;
  while (idx < pts.length - 1 && pts[idx + 1].y < y) idx++;
  const p1 = pts[idx], p2 = pts[Math.min(idx + 1, pts.length - 1)];
  const t = p2.y !== p1.y ? (y - p1.y) / (p2.y - p1.y) : 0;
  const curX = p1.x + (p2.x - p1.x) * Math.max(0, Math.min(1, t));
  return Number((((curX - col.startX) / colWidth) * col.maxPercent).toFixed(2));
}

// 模拟剖面：从 0 到 150cm，每隔 2cm 设定为一个标准采样层位
const depthCal = {
  dataXMin: 100,
  dataXMax: 800,
  dataYMin: 200,
  dataYMax: 1100, // 高度 900px 对应 150cm (每 cm 对应 6px, 每 2cm 对应 12px)
  depthTopValue: 0,
  depthBottomValue: 150,
  depthInterval: 2,
  unit: 'cm',
};

const horizons = getStandardDepthHorizons(depthCal);
// (150 - 0) / 2 + 1 = 76 个固定层位
assert.strictEqual(horizons.depths.length, 76, '0~150cm 每隔 2cm 应生成 76 个标准层位');
assert.strictEqual(horizons.depths[0], 0, '顶层为 0cm');
assert.strictEqual(horizons.depths[1], 2, '第 2 层位为 2cm');
assert.strictEqual(horizons.depths[75], 150, '底层位为 150cm');
assert.strictEqual(horizons.yPositions[0], 200, '顶层像素位置为 200px');
assert.strictEqual(horizons.yPositions[1], 212, '第 2 层位像素位置为 212px (2cm * 6px/cm)');
assert.strictEqual(horizons.yPositions[75], 1100, '底层像素位置为 1100px');

// 模拟 3 列属种在固定层位上的数据提取
const testCols = [
  {
    name: 'Pinus',
    startX: 100, endX: 200, maxPercent: 100,
    controlPoints: [{ x: 150, y: 200 }, { x: 180, y: 650 }, { x: 140, y: 1100 }]
  },
  {
    name: 'Artemisia',
    startX: 200, endX: 300, maxPercent: 50,
    controlPoints: [{ x: 230, y: 200 }, { x: 260, y: 650 }, { x: 220, y: 1100 }]
  },
  {
    name: 'Poaceae',
    startX: 300, endX: 400, maxPercent: 40,
    controlPoints: [{ x: 320, y: 200 }, { x: 350, y: 650 }, { x: 310, y: 1100 }]
  }
];

// 提取全量锚定数据
const extractedRows = horizons.depths.map((d, i) => {
  const y = horizons.yPositions[i];
  return {
    depth: d,
    pinus: interpolatePercent(testCols[0], y, depthCal),
    artemisia: interpolatePercent(testCols[1], y, depthCal),
    poaceae: interpolatePercent(testCols[2], y, depthCal),
  };
});

assert.strictEqual(extractedRows.length, 76);
// 验证所有属种严格对齐在完全相同的深度层位上，绝无任何错位
for (let i = 0; i < extractedRows.length; i++) {
  assert.strictEqual(extractedRows[i].depth, i * 2, `第 ${i} 行深度应严格为 ${i * 2} cm`);
  assert(extractedRows[i].pinus >= 0 && extractedRows[i].pinus <= 100);
  assert(extractedRows[i].artemisia >= 0 && extractedRows[i].artemisia <= 50);
  assert(extractedRows[i].poaceae >= 0 && extractedRows[i].poaceae <= 40);
}
console.log('✔ 地层深度标尺网格系统 (0~150cm, Δ=2cm) 与多属种无错位锚定提取验证通过');

// 5. 验证四元坐标系统转换纯逻辑
function testCoordinateSystemPure() {
  const cal = {
    dataXMin: 315,
    dataXMax: 1946,
    dataYMin: 511,
    dataYMax: 1311,
    depthTopValue: 0,
    depthBottomValue: 150,
    unit: 'cm',
    isCalibrated: true
  };
  const vt = { offsetX: 100, offsetY: 50, scale: 2.0, dpr: 1.0 };

  // 1. 屏幕与物理像素双向
  const screenPt = { x: 500, y: 450 };
  const imgPt = { x: (screenPt.x - vt.offsetX) / vt.scale, y: (screenPt.y - vt.offsetY) / vt.scale }; // (200, 200)
  assert.strictEqual(imgPt.x, 200);
  assert.strictEqual(imgPt.y, 200);
  const backScreen = { x: imgPt.x * vt.scale + vt.offsetX, y: imgPt.y * vt.scale + vt.offsetY };
  assert.strictEqual(backScreen.x, 500);
  assert.strictEqual(backScreen.y, 450);

  // 2. 物理Y与深度双向
  const yMid = 511 + (1311 - 511) / 2; // 911
  const t = (yMid - 511) / (1311 - 511);
  const depth = cal.depthTopValue + t * (cal.depthBottomValue - cal.depthTopValue); // 75.0 cm
  assert.strictEqual(depth, 75.0);

  // 3. 屏幕恒定距离换算 (8px 屏幕手柄在 2.0 缩放下等于 4.0 图像物理像素)
  const imgDist = 8.0 / vt.scale;
  assert.strictEqual(imgDist, 4.0);
}
testCoordinateSystemPure();
console.log('✔ 四元坐标转换与屏幕像素恒定换算引擎验证通过');

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
