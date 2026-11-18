/**
 * `rscriptPathUpdate`（保存设置时要不要带 `rscript_path`）的行为。
 *
 * 门禁点（issue #104）：没改过就**不许发**——无条件发送会把已存的 Rscript 路径抹掉；
 * 用户清空输入框 = 明确要清除，必须发空串（后端约定 `""` = 回到自动探测）。
 */
import assert from 'node:assert/strict';
import { rscriptPathUpdate } from './src/services/configUpdates.ts';

const PATH = 'D:/Program Files/R/R/bin/x64/Rscript.exe';

// 1) 没动过 → 不带 key（否则「配置没加载出来」会变成一次静默清空）
assert.deepEqual(rscriptPathUpdate(PATH, PATH), {});
assert.deepEqual(rscriptPathUpdate('', ''), {});

// 2) 用户新填 → 发新值
assert.deepEqual(rscriptPathUpdate('', PATH), { rscript_path: PATH });

// 3) 用户改路径 → 发新值
const OTHER = 'C:/R/bin/Rscript.exe';
assert.deepEqual(rscriptPathUpdate(PATH, OTHER), { rscript_path: OTHER });

// 4) 用户清空 → 发空串（= 明确要回到自动探测，不能因为「空」就不发）
assert.deepEqual(rscriptPathUpdate(PATH, ''), { rscript_path: '' });

// 5) 首尾空白不算修改（输入框常带空格，trim 后相同就不该触发写入）
assert.deepEqual(rscriptPathUpdate(PATH, `  ${PATH}  `), {});

console.log('✔ rscript_path 更新载荷：未改动不发、清空照发、空白不误判');
