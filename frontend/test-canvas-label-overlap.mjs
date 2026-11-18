// 低缩放时列名标签不许叠字：相邻两个**已画**标签的中心距（设备像素）必须 ≥ 24px。
//
// 现场（.recon_20261117，19 列，37% 适配缩放，窗口 1256px）：
//   列间距约 20 图像 px = 7.4 设备 px，远小于一行文字宽度 →
//   19 个 45° 斜排名称叠成一团（截图里 Picea/Pinus/Betula/Quercus、
//   Artemisia/Amaranthaceae/Poaceae 两处糊在一起）。
//
// 判别力（反向验证）：把 shouldDrawColumnLabel 改成恒 true → 第 1 组从 5 变 19，红。
//
// 运行：node --experimental-strip-types test-canvas-label-overlap.mjs
import assert from 'node:assert';

const { shouldDrawColumnLabel, LABEL_MIN_GAP_PX } = await import(
  './src/components/canvas/labelLayout.ts'
);

console.log('--- 列名标签防重叠 ---');

/** 复刻画布里的调用顺序：只有"画出来的"标签才更新 lastLabeledCenterX。 */
const plan = (centers, scale, minGapPx = LABEL_MIN_GAP_PX) => {
  const drawn = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const centerX of centers) {
    if (shouldDrawColumnLabel(centerX, last, scale, minGapPx)) {
      drawn.push(centerX);
      last = centerX;
    }
  }
  return drawn;
};

// 1. 现场密度：19 列、间距 20 图像 px、缩放 0.37
//    门槛换算到图像 px = 24 / 0.37 = 64.86 → 只有 0/80/160/240/320 能画
const tight = Array.from({ length: 19 }, (_, i) => i * 20);
assert.deepEqual(plan(tight, 0.37), [0, 80, 160, 240, 320], '37% 缩放应只剩 5 个名称');

// 2. 正常缩放（100%，列宽 60px）：全部画出来，一个不少
const normal = Array.from({ length: 19 }, (_, i) => i * 60);
assert.equal(plan(normal, 1.0).length, 19, '100% 缩放应全部画出来');

// 3. 门槛本身：恰好等于 24 设备 px 时允许（>= 而不是 >）
assert.equal(shouldDrawColumnLabel(24, 0, 1.0), true);
// 4. 差 1px 就不画
assert.equal(shouldDrawColumnLabel(23, 0, 1.0), false);
// 5. 第一个标签不受限（没有"上一个"）
assert.equal(shouldDrawColumnLabel(5, Number.NEGATIVE_INFINITY, 0.01), true);
// 6. 缩放参与换算：同一图像间距，缩放越小画得越稀
assert.equal(plan(tight, 0.2).length, 4, '20% 缩放只剩 4 个（门槛 24/0.2 = 120 图像 px）');
assert.ok(plan(tight, 0.2).length < plan(tight, 0.37).length);

console.log('OK：标签间距按设备像素判定，跳过者不占额度');
