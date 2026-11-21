import assert from 'node:assert/strict';
import {
  sanitizeFilenameStem,
  formatExportTimestamp,
  resolveProjectName,
  resolveExportFilename,
  extractProjectNameFromFilename,
} from './src/utils/exportNaming.ts';

console.log('--- 运行 Standardized Export File Naming 单元测试 ---');

// 1. sanitizeFilenameStem: 边界字符清理与交替点/下划线测试
assert.equal(
  sanitizeFilenameStem('...___test_project___...'),
  'test_project',
  'Leading and trailing dots and underscores must be completely stripped'
);

assert.equal(
  sanitizeFilenameStem('._.core_data._.'),
  'core_data',
  'Interleaved boundary dots and underscores must be completely stripped'
);

assert.equal(
  sanitizeFilenameStem('...___...'),
  'straditize',
  'Interleaved boundary dots and underscores without content must fallback to straditize'
);

assert.equal(
  sanitizeFilenameStem('_._._._'),
  'straditize',
  'Alternating boundary dots and underscores without content must fallback to straditize'
);

assert.equal(
  sanitizeFilenameStem('../../etc/passwd'),
  'etc_passwd',
  'Path traversal attempts must have leading dot-slash sequences sanitized'
);

// 2. sanitizeFilenameStem: 基础合法性与非法字符替换
assert.equal(sanitizeFilenameStem('My_Project'), 'My_Project');
assert.equal(sanitizeFilenameStem('suigetsu_2020'), 'suigetsu_2020');
assert.equal(
  sanitizeFilenameStem('  Lake: Core / Section #1 *test? "quoted" <tag> | pipe \\ backslash  '),
  'Lake_Core_Section_#1_test_quoted_tag_pipe_backslash'
);

// 3. sanitizeFilenameStem: 空值与全非法字符回退
assert.equal(sanitizeFilenameStem(''), 'straditize');
assert.equal(sanitizeFilenameStem('   '), 'straditize');
assert.equal(sanitizeFilenameStem(null), 'straditize');
assert.equal(sanitizeFilenameStem(undefined), 'straditize');
assert.equal(sanitizeFilenameStem('???:::***///'), 'straditize');

// 4. resolveProjectName: 优先级与底图提取
// 4a. 用户项目名为全点/下划线时，视为无效输入，回退至底图主文件名
assert.equal(
  resolveProjectName('...___...', 'upload://core.png'),
  'core',
  'Invalid user project name containing only boundary chars must fallback to image name'
);

// 4b. 用户显式项目名有效时，优先于底图文件名
assert.equal(
  resolveProjectName('my_lake_project', 'upload://core.png'),
  'my_lake_project',
  'Valid user project name must take precedence over image name'
);

// 4c. 用户项目名带非法字符及边界字符时，被正确清洗且优先
assert.equal(
  resolveProjectName('...___User Project___...', 'upload://core.png'),
  'User_Project',
  'Sanitized user project name must take precedence'
);

// 4d. 用户显式项目名为空，但底图有效
assert.equal(
  resolveProjectName(null, 'upload://lake_suigetsu_pollen.png'),
  'lake_suigetsu_pollen'
);
assert.equal(
  resolveProjectName('', 'archive://image/suigetsu_varve.jpg'),
  'suigetsu_varve'
);
assert.equal(
  resolveProjectName('   ', 'C:\\data\\research\\pollen_core_100.tif'),
  'pollen_core_100'
);

// 4e. 底图为通用名称 original / diagram（忽略大小写）时回退到 straditize
assert.equal(resolveProjectName(null, 'archive://image/original.png'), 'straditize');
assert.equal(resolveProjectName(null, 'upload://Original.PNG'), 'straditize');
assert.equal(resolveProjectName(null, 'upload://diagram.png'), 'straditize');
assert.equal(resolveProjectName(null, 'upload://Diagram.jpg'), 'straditize');

// 4f. 两者皆空时回退到 straditize
assert.equal(resolveProjectName(null, null), 'straditize');
assert.equal(resolveProjectName('', ''), 'straditize');

// 5. formatExportTimestamp 与 resolveExportFilename 测试
const testDate = new Date(2026, 10, 19, 14, 30, 45); // 2026-11-19 14:30:45
assert.equal(formatExportTimestamp(testDate), '20261119_1430');

// 5a. resolveExportFilename 固定时间断言
assert.equal(
  resolveExportFilename('...___my_project___...', null, '_report', 'xlsx', testDate),
  'my_project_stradpro_report_20261119_1430.xlsx'
);

// 5b. resolveExportFilename 当前时间正则断言
const liveFilename = resolveExportFilename('...___my_project___...', null, '_report', 'xlsx');
assert.match(
  liveFilename,
  /^my_project_stradpro_report_\d{8}_\d{4}\.xlsx$/,
  'Generated live filename must match pattern {project_name}_stradpro_{suffix}_{YYYYMMDD_HHmm}.{ext}'
);

// 5c. 各标准导出类型后缀格式验证
assert.equal(
  resolveExportFilename('suigetsu', null, '_project', 'tar', testDate),
  'suigetsu_stradpro_project_20261119_1430.tar'
);
assert.equal(
  resolveExportFilename('suigetsu', null, '_matrix', 'csv', testDate),
  'suigetsu_stradpro_matrix_20261119_1430.csv'
);
assert.equal(
  resolveExportFilename('suigetsu', null, '_plot_bundle', 'zip', testDate),
  'suigetsu_stradpro_plot_bundle_20261119_1430.zip'
);
assert.equal(
  resolveExportFilename('suigetsu', null, '_lipd', 'lpd', testDate),
  'suigetsu_stradpro_lipd_20261119_1430.lpd'
);

// 6. extractProjectNameFromFilename: 导入文件名项目名前缀提取
assert.equal(
  extractProjectNameFromFilename('pollen_bars_riojaplot_stradpro_project_20261120_1200.tar'),
  'pollen_bars_riojaplot',
  'Must extract prefix before _stradpro_project timestamp'
);
assert.equal(
  extractProjectNameFromFilename('pollen_bars_riojaplot_stradpro_matrix_20261120_1200.csv'),
  'pollen_bars_riojaplot',
  'Must extract prefix before _stradpro_matrix timestamp'
);
assert.equal(
  extractProjectNameFromFilename('pollen_bars_riojaplot_project_20261120_120034.tar'),
  'pollen_bars_riojaplot',
  'Must extract prefix before legacy _project timestamp'
);
assert.equal(
  extractProjectNameFromFilename('pollen_bars_riojaplot_project.tar'),
  'pollen_bars_riojaplot',
  'Must extract prefix before _project'
);
assert.equal(
  extractProjectNameFromFilename('my_lake_core.tar'),
  'my_lake_core',
  'Must extract clean stem if no _project suffix'
);
assert.equal(
  extractProjectNameFromFilename('pollen_bars_riojaplot_matrix_20261120_120034.csv'),
  'pollen_bars_riojaplot',
  'Must extract prefix before legacy _matrix timestamp'
);
assert.equal(
  extractProjectNameFromFilename('straditize_stradpro_project_20261120_1200.tar'),
  null,
  'straditize default generic fallback should return null'
);

console.log('✔ 全部 exportNaming 真实模块命名规则与边界字符测试顺利通过！');
