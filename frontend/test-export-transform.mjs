import assert from 'node:assert';

const { transformMatrix } = await import('./src/components/exportTransform.ts');

console.log('--- 运行 Export Matrix Transform (浮点精度、排序、编辑覆盖) 单元测试 ---');

const headers = ['depth', 'Taxon A', 'Taxon B'];
const rawRows = [
  ['1887.1090', '0.5195', '3.8961'],
  ['1867.4882', '1.0390', '5.9740'],
  ['1915.5450', '0.0000', '1.8182'],
];

// 1. 浮点精度测试 (digits=1)
{
  const res = transformMatrix(headers, rawRows, new Map(), {
    digits: 1,
    sortBy: 'raw',
    sortOrder: 'asc',
  });
  assert.deepStrictEqual(res.rows[0], ['1887.1', '0.5', '3.9'], 'digits=1 四舍五入正确');
  assert.deepStrictEqual(res.rows[1], ['1867.5', '1.0', '6.0'], 'digits=1 四舍五入正确');
}

// 2. 浮点精度测试 (digits=0)
{
  const res = transformMatrix(headers, rawRows, new Map(), {
    digits: 0,
    sortBy: 'raw',
    sortOrder: 'asc',
  });
  assert.deepStrictEqual(res.rows[0], ['1887', '1', '4'], 'digits=0 整数格式化正确');
}

// 3. 排序测试 (sortBy=depth, sortOrder=asc)
{
  const res = transformMatrix(headers, rawRows, new Map(), {
    digits: 2,
    sortBy: 'depth',
    sortOrder: 'asc',
  });
  assert.strictEqual(res.rows[0][0], '1867.49', '升序首行为最小深度');
  assert.strictEqual(res.rows[1][0], '1887.11', '升序中间行深度');
  assert.strictEqual(res.rows[2][0], '1915.55', '升序末行为最大深度');
  assert.deepStrictEqual(res.rowOrigIndices, [1, 0, 2], 'origIndex 准确映射');
}

// 4. 排序测试 (sortBy=depth, sortOrder=desc)
{
  const res = transformMatrix(headers, rawRows, new Map(), {
    digits: 2,
    sortBy: 'depth',
    sortOrder: 'desc',
  });
  assert.strictEqual(res.rows[0][0], '1915.55', '降序首行为最大深度');
  assert.strictEqual(res.rows[1][0], '1887.11', '降序中间行深度');
  assert.strictEqual(res.rows[2][0], '1867.49', '降序末行为最小深度');
  assert.deepStrictEqual(res.rowOrigIndices, [2, 0, 1], 'origIndex 准确映射');
}

// 5. 用户微调保持测试
{
  const edits = new Map();
  // 用户修改原始第 1 行（depth 1867.4882）的 Taxon A 为 99.99
  edits.set('1_1', '99.99');
  const res = transformMatrix(headers, rawRows, edits, {
    digits: 1,
    sortBy: 'depth',
    sortOrder: 'desc',
  });
  // 降序排序后，原始第 1 行排在最后一行（索引 2）
  assert.strictEqual(res.rows[2][1], '99.99', '用户编辑在降序排序后依然绑定在原行');
}

console.log('✔ 全部 Export Matrix Transform 单元测试通过！');
