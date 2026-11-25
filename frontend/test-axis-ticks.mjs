import assert from 'node:assert/strict';
import { generateAxisTicks } from './src/utils/axisTicks.ts';

console.log('--- 运行 AxisTicks 自适应刻度生成器单元测试 ---');

// 1. 年代大尺度跨度测试（例如 0 ~ 20000 cal yrBP, 1200px 宽度）
{
  const res = generateAxisTicks(0, 20000, 1200, 100);
  assert.ok(res.majorStep >= 1000, '主步长应为千年以上整洁数');
  assert.equal(res.decimals, 0, '万年量级小数位数为 0');
  assert.ok(res.majorTicks.includes(0), '应包含 0');
  assert.ok(res.majorTicks.length >= 5, '主刻度应有足够数量');
}

// 2. 沉积速率极小尺度测试（例如 0.015 ~ 0.175 cm/yr, 120px 高度）
{
  const res = generateAxisTicks(0.015, 0.175, 120, 30);
  assert.ok(res.majorStep > 0 && res.majorStep < 1, '步长应为小数');
  assert.ok(res.decimals >= 2, '小数位数应为 2 位或以上');
  assert.ok(res.majorTicks.length >= 3, '至少生成 3 个主刻度');
  for (const t of res.majorTicks) {
    assert.ok(t >= 0.015 && t <= 0.175, `刻度 ${t} 应在范围内`);
  }
}

// 3. 负数起点（例如 -65 ~ 18000）
{
  const res = generateAxisTicks(-65, 18000, 1000, 100);
  assert.ok(res.majorTicks.includes(0), '包含 0 刻度线');
  assert.ok(res.majorTicks.length >= 4);
}

// 4. 单点退化
{
  const res = generateAxisTicks(10, 10, 500, 100);
  assert.equal(res.majorTicks.length, 1);
  assert.equal(res.majorTicks[0], 10);
}

console.log('✔ 全部 AxisTicks 自适应刻度生成器测试顺利通过！');
