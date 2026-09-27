/**
 * 前端核心功能回归测试。
 *
 * 本文件曾是"复刻实现自测"的典型：自带 5 份副本 ——
 * TestHistory / TestViewport / TestImageDisplayController / TestPollenGlossary /
 * TestCaptionParser —— 外加两个本地函数（批量分列、UStar 打包），
 * 所有断言都打在这些副本上。src/ 里的真代码无论怎么改，本文件都"通过"；
 * setCustomTaxa 覆盖模式删不掉旧条目这一缺陷长期不被发现，就是这么来的
 * （完整背景见 test-glossary.mjs 头注释）。
 *
 * 现已全部改为直接 import src/ 下的真实模块，断言打在真代码上。
 * 仍留在本文件的两处"非模块"断言已就地标注原因。
 *
 * 运行：npm --prefix frontend test（脚本统一加 --experimental-strip-types，
 * 因为本文件与 test-glossary/roi-*.mjs 一样直接 import src/ 下的 .ts）
 */
import assert from 'node:assert';

// Viewport 构造函数读 window.devicePixelRatio —— 垫的是测试运行环境，不是业务逻辑
globalThis.window ??= { devicePixelRatio: 1 };

const { HistoryManager } = await import('./src/core/HistoryManager.ts');
const { Viewport } = await import('./src/core/Viewport.ts');
const { PollenGlossary } = await import('./src/core/PollenGlossary.ts');
const { TarArchive } = await import('./src/core/TarArchive.ts');
const { DIATOM_GENERA, DIATOM_SOURCE_ALIASES } = await import('./src/core/diatomGenera.ts');

console.log('--- 运行 Straditize 前端核心功能回归测试 ---');

// 1. 撤销重做 —— 真模块 HistoryManager（原为本地 TestHistory 副本）
const history = new HistoryManager();
const cols = (n) => [
  { id: 'c1', name: `Col${n}`, startX: 100, endX: 200, maxPercent: 40, visible: true },
];
history.push('state1', cols(1), 'c1');
history.push('state2', cols(2), 'c1');
history.push('state3', cols(3), 'c1');

assert.strictEqual(history.canUndo(), true, '已有 3 个状态应可撤销');
assert.strictEqual(history.undo().columns[0].name, 'Col2', 'Undo 应回滚到 Col2');
assert.strictEqual(history.undo().columns[0].name, 'Col1', 'Undo 应回滚到 Col1');
assert.strictEqual(history.undo(), null, '栈底状态不能继续 Undo');
assert.strictEqual(history.redo().columns[0].name, 'Col2', 'Redo 应恢复到 Col2');
assert.strictEqual(history.redo().columns[0].name, 'Col3', 'Redo 应恢复到 Col3');
assert.strictEqual(history.redo(), null, '栈顶不能继续 Redo');

// 新操作必须清空 redo 栈 —— 复刻版实现了这条，但只有打在真模块上才算数
history.push('state4', cols(4), 'c1');
assert.strictEqual(history.canRedo(), false, '产生新操作后 redo 栈应被清空');
console.log('✔ 历史状态栈 (Undo/Redo) 验证通过');

// 2. 视口坐标转换 —— 真模块 Viewport（原为本地 TestViewport 副本）
const vp = new Viewport();
vp.scale = 1.5;
vp.panX = 100;
vp.panY = 200;

const worldCoord = { x: 500, y: 800 };
const screenCoord = vp.worldToScreen(worldCoord);
const backToWorld = vp.screenToWorld(screenCoord);

assert.strictEqual(screenCoord.x, 500 * 1.5 + 100, 'Screen X 投影计算准确');
assert.strictEqual(screenCoord.y, 800 * 1.5 + 200, 'Screen Y 投影计算准确');
assert(Math.abs(backToWorld.x - worldCoord.x) < 1e-6, '世界坐标反投影无损');
assert(Math.abs(backToWorld.y - worldCoord.y) < 1e-6, '世界坐标反投影无损');
console.log('✔ 视口坐标双向变换 (Screen <-> World) 验证通过');

// 3. 控制点拉伸与排序
// 【保留的非模块断言】src/ 里没有独立的控制点插入 API（逻辑内联在
// GeologyCanvas.ts 的指针事件处理器中，依赖 DOM 事件流），这里只钉住
// "按 y 有序插入"这条数据约定本身，不代表任何模块实现被测试。
const points = [
  { id: '1', x: 350, y: 600 },
  { id: '2', x: 380, y: 800 },
  { id: '3', x: 360, y: 1000 },
];
const newPoint = { id: '4', x: 420, y: 700 };
points.push(newPoint);
points.sort((a, b) => a.y - b.y);

assert.strictEqual(points[1].id, '4', '新控制点精准插入到 y=600 和 y=800 之间');
assert.strictEqual(points[1].x, 420, '曲线在该点被拉伸吸附到 x=420');

const remaining = points.filter((p) => p.id !== '4');
assert.strictEqual(remaining.length, 3, '右键准确删除指定锚点');
assert.strictEqual(remaining.find((p) => p.id === '4'), undefined, '被删锚点已完全移除');
console.log('✔ 控制点添加吸附拉伸与右键删除逻辑验证通过');

// 4. 底图模式与按 B 键二值化透视 —— 真模块 Viewport
//    （原为本地 TestImageDisplayController 副本，其 cycleImageMode /
//      toggleBinaryOverlay 与 Viewport 同名同语义）
const display = new Viewport();
assert.strictEqual(display.toggleBinaryOverlay(), true, '按 B 键透视开启');
assert.strictEqual(display.toggleBinaryOverlay(), false, '按 B 键透视关闭');
assert.strictEqual(display.cycleImageMode(), 'invert', '切为 invert');
assert.strictEqual(display.cycleImageMode(), 'contrast', '切为 contrast');
assert.strictEqual(display.cycleImageMode(), 'binary', '切为 binary');
assert.strictEqual(display.cycleImageMode(), 'normal', '循环回到 normal');
console.log('✔ 底图渲染滤镜与按 B 键二值化叠加遮罩模式验证通过');

// 5. 花粉词典与 OCR 模糊拼写修正 —— 真模块 PollenGlossary
//    （原为本地 TestPollenGlossary 副本，词表是手工摘抄的 15 条）

// 5.1 Markdown 消除与直接匹配
assert.strictEqual(PollenGlossary.correct('*Pinus*').corrected, 'Pinus');
assert.strictEqual(PollenGlossary.correct('_Artemisia_').corrected, 'Artemisia');

// 5.2 典型扫描 OCR 错别字纠正
const typoCases = [
  ['Pmus', 'Pinus'],
  ['Artemesia', 'Artemisia'],
  ['Chenopodiacee', 'Chenopodiaceae'],
  ['0lea', 'Olea'],
  ['Betla', 'Betula'],
  ['Poacee', 'Poaceae'],
  ['Juniperus-typc', 'Juniperus-type'],
];
for (const [raw, expected] of typoCases) {
  assert.strictEqual(
    PollenGlossary.correct(raw).corrected,
    expected,
    `${raw} 应被修正为 ${expected}`,
  );
}

// 5.3 Excel 列粘贴（回车）与行粘贴（制表符）多源切分
//    用 enableFuzzy=false 取"纯切分"语义：本段验证的是分隔符处理，
//    不是模糊纠错（后者由 5.2 与 test-glossary.mjs 覆盖）。
const parsedCol = PollenGlossary.parseTaxaList(
  '*Pinus*\r\nArtemesia\r\nChenopodiacee\r\nPoacee',
  false,
).map((r) => r.corrected);
assert.strictEqual(parsedCol.length, 4, '应解析出 4 个属种');
assert.deepStrictEqual(parsedCol, ['Pinus', 'Artemesia', 'Chenopodiacee', 'Poacee']);

const parsedRow = PollenGlossary.parseTaxaList(
  'Pinus\tArtemesia\tBetla\tCyperaceae',
  false,
).map((r) => r.corrected);
assert.strictEqual(parsedRow.length, 4, '制表符切分应解析出 4 个属种');
assert.deepStrictEqual(parsedRow, ['Pinus', 'Artemesia', 'Betla', 'Cyperaceae']);

// 5.4 微体古生物 (NPP) 词条：不得被模糊纠成花粉属名
//     关键回归：Sordariaceae (粪生菌孢) 不得被纠成 Apiaceae (伞形科)
const NPP_TAXA = [
  'Pediastrum', 'Botryococcus', 'Diatom', 'Cyclotella', 'Chironomidae',
  'Chironomid head capsule', 'Ostracoda', 'Ilyocypris', 'Sporormiella',
  'Sordariaceae', 'Chaetomium', 'Rotifera',
];
for (const name of NPP_TAXA) {
  assert.strictEqual(
    PollenGlossary.correct(name).corrected,
    name,
    `NPP 词条 ${name} 应原样保留，不得被误纠`,
  );
}
assert.notStrictEqual(
  PollenGlossary.correct('Sordariaceae').corrected,
  'Apiaceae',
  'Sordariaceae 不得被误纠为 Apiaceae',
);
// 内置词表规模（原副本只摘抄了 15 条，无法暴露词表缩水）
assert.ok(PollenGlossary.CANONICAL_TAXA.length > 400, '内置词表规模异常');
assert.ok(PollenGlossary.CANONICAL_TAXA.includes('Sordariaceae'), 'NPP 词条应登记在内置词表');
console.log('✔ 花粉属种词典 (Pollen Glossary) 与 OCR 模糊拼写修正引擎验证通过');
console.log('✔ 微体古生物 (NPP) 内置词条不得被跨类误纠验证通过');
console.log('↷ 自定义词汇表（追加/覆盖/清空/内置冗余）由 test-glossary.mjs 在真模块上覆盖');

// 5.5 期刊图版说明解析 —— 真模块 PollenGlossary.looksLikePlateCaption / parseTaxaList
//     （原为本地 TestCaptionParser 副本）
const PLATE_I = '中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅰ。a) Pediastrum\nsimplex var. simplex; b) Pediastrum simplex var. sturmmi; c), d) Pediastrum simplex var.\nclathratum; e), f) Pediastrum simplex var. biwaense; g) Pediastrum simplex var. echinulatum; h)\nPediastrum duplex var. duplex; i), j) Pediastrum duplex var. gracillim; k), l) Pediastrum duplex var.\nrugulosum; l) Pediastrum tetras.';

assert.ok(PollenGlossary.looksLikePlateCaption(PLATE_I), '图版说明应被识别为 caption 形态');
assert.ok(
  !PollenGlossary.looksLikePlateCaption('Pinus\nArtemisia\nChenopodiaceae'),
  '普通名单不得被误判为图版说明',
);

const plateTokens = PollenGlossary.parseTaxaList(PLATE_I, false).map((r) => r.corrected);
assert.strictEqual(
  plateTokens.length,
  9,
  `图版Ⅰ 应解析出 9 个分类单元，实际 ${plateTokens.length}：${JSON.stringify(plateTokens)}`,
);
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
assert.ok(
  !plateTokens.some((t) => /^(Pediastrum|simplex|duplex|clathratum)$/.test(t)),
  '不得残留硬换行造成的碎片',
);
// 多键前缀 c), d) 不得残留孤立键
assert.ok(!plateTokens.some((t) => /^[a-l]\)?$/.test(t)), '不得残留孤立的图版键');

// cf. 是名称的一部分，不是图版键
const cfTokens = PollenGlossary.parseTaxaList(
  'f) Pediastrum cf. argentinense; g) Pediastrum alternans',
  false,
).map((r) => r.corrected);
assert.deepStrictEqual(cfTokens, ['Pediastrum cf. argentinense', 'Pediastrum alternans'], 'cf. 必须保留在名称内');

const PLATE_II = 'S2. 中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅱ。a), b)\nPediastrum boryanum var. boryanum; c) Pediastrum boryanum var. longicorne type 1; d), e)\nPediastrum boryanum var. longicorne type 2; k), l) Pediastrum asymmetricum';
const plate2Tokens = PollenGlossary.parseTaxaList(PLATE_II, false).map((r) => r.corrected);
assert.deepStrictEqual(plate2Tokens, [
  'Pediastrum boryanum var. boryanum',
  'Pediastrum boryanum var. longicorne type 1',
  'Pediastrum boryanum var. longicorne type 2',
  'Pediastrum asymmetricum',
]);
// type 1 与 type 2 必须保持区分，不得被合并或截断
assert.notStrictEqual(plate2Tokens[1], plate2Tokens[2], 'type 1 与 type 2 必须区分');

// 普通换行名单不得被 caption 逻辑破坏。
// 注意：真模块会顺手清洗 markdown 星号（*Pinus* -> Pinus），
// 原副本不会 —— 那是副本漏实现，此处以真模块行为为准。
const excelStillOk = PollenGlossary.parseTaxaList(
  '*Pinus*\nArtemesia\nChenopodiacee\nPoacee',
  false,
).map((r) => r.corrected);
assert.deepStrictEqual(excelStillOk, ['Pinus', 'Artemesia', 'Chenopodiacee', 'Poacee'], '普通换行名单切分不应回归');

console.log('✔ 期刊图版说明（Plate caption）解析与图版键剥离验证通过');

// 5.6 硅藻属名表完整性与前后端一致性 —— 真模块 diatomGenera
//     原先是 readFileSync 把 .ts 当文本用正则抠，改用真实导出后
//     既测得到数组本身，也不会因源码排版变化而假失败。
assert.ok(DIATOM_GENERA.length >= 221, `硅藻属名表应 ≥221 属，实际 ${DIATOM_GENERA.length}`);
// 内陆 151 属 + 海洋 114 属的代表性类群必须在列
for (const g of ['Aulacoseira', 'Cyclotella', 'Melosira', 'Navicula', 'Nitzschia',
                 'Cocconeis', 'Surirella', 'Chaetoceros', 'Rhizosolenia', 'Thalassiosira']) {
  assert.ok(DIATOM_GENERA.includes(g), `硅藻属 ${g} 应在生成的属名表中`);
}
// 去重
assert.strictEqual(new Set(DIATOM_GENERA).size, DIATOM_GENERA.length, '硅藻属名表不得含重复项');

// 源表拼写异名必须存在，且不得作为规范属名出现
const aliasPairs = Object.entries(DIATOM_SOURCE_ALIASES);
assert.ok(aliasPairs.length >= 10, `源表拼写异名应 ≥10 条，实际 ${aliasPairs.length}`);
for (const [slip, accepted] of aliasPairs) {
  assert.ok(!DIATOM_GENERA.includes(slip), `源表拼写 ${slip} 不得成为规范属名`);
  assert.ok(DIATOM_GENERA.includes(accepted), `异名 ${slip} 指向的规范名 ${accepted} 应在属名表中`);
}
assert.strictEqual(DIATOM_SOURCE_ALIASES['Thalasiosira'], 'Thalassiosira', 'Thalasiosira -> Thalassiosira 异名映射缺失');

console.log('✔ 硅藻属名表（内陆+海相）与源表拼写异名验证通过');

// 6. 批量导入属种名单自动列间距拓展分列
// 【保留的非模块断言】真实现在 GeologyCanvas.batchUpdateTaxa()
// （frontend/src/components/GeologyCanvas.ts:413），它依赖已实例化的
// 画布与列数据，Node 下无法脱离 DOM 加载。下面这段是【规格复现】而非
// 产品测试：钉住"只按 ROI 展宽、绝不触碰深度标定"这条不变量的算法规格，
// 不能据此断言真代码正确。真正的产品级覆盖须走 tests/e2e 或浏览器侧测试。
function specBatchTaxaUpdate(existingColumns, newTaxaNames, roi) {
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

const expanded = specBatchTaxaUpdate(initialCols, inputList, roiFixture);
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
console.log('✔ 批量导入属种名单【规格复现】从左到右重命名与自动列间距拓展分列验证通过');

// 7. 地层深度标尺 / 坐标换算：真实模块测试见 test-roi-calibration.mjs。
console.log('↷ 深度标尺与坐标换算已迁移至 test-roi-calibration.mjs（真实模块）');

// 8. 开放标准 .tar (POSIX UStar) 打包与解包 —— 真模块 TarArchive
//    （原为本地 testTarArchivePure 自写编码器/解码器，等于拿自己的实现
//     验证自己的实现）
const encoder = new TextEncoder();
const tarEntries = [
  { name: 'info.json', data: encoder.encode(JSON.stringify({ software: 'Straditize', version: '2.0.0' })) },
  { name: 'straditize.json', data: encoder.encode(JSON.stringify({ columnsCount: 29 })) },
  { name: 'image.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]) },
];

const tarBuffer = TarArchive.create(tarEntries);
assert.ok(tarBuffer instanceof Uint8Array, 'TarArchive.create 应返回 Uint8Array');
assert.ok(tarBuffer.length >= 1536, 'tar 至少包含两个 512B 全零终止块');

// extract 接收 ArrayBuffer：切出本视图对应的那一段，避免带上底层大 buffer 的其余字节
const extracted = TarArchive.extract(
  tarBuffer.buffer.slice(tarBuffer.byteOffset, tarBuffer.byteOffset + tarBuffer.byteLength),
);
assert.strictEqual(extracted.length, 3, `应解出 3 个条目，实际 ${extracted.length}`);
assert.strictEqual(extracted[0].name, 'info.json');
assert.strictEqual(extracted[1].name, 'straditize.json');
assert.strictEqual(extracted[2].name, 'image.png');
assert.deepStrictEqual(
  Array.from(extracted[2].data.slice(0, 4)),
  [137, 80, 78, 71],
  'PNG magic byte 应原样往返',
);
assert.strictEqual(
  new TextDecoder().decode(extracted[0].data),
  JSON.stringify({ software: 'Straditize', version: '2.0.0' }),
  '文本内容应原样往返',
);
console.log('✔ 开放标准 .tar (POSIX UStar) 科学项目归档打包与解包引擎验证通过');

console.log('\n🎉 全部前端核心功能自检测试顺利通过！');
