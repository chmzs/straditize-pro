/**
 * 独立复核 J：static F-06 的前端数学 —— **用 rolldown 打包真实产品源码**后执行。
 *
 * 不改任何语义，只做 TS->JS 转译。三组输入：
 *   (a) 完全未标定（isCalibrated=false，端点全 null）
 *   (b) ROI 存在但未标定
 *   (c) 已标定（对照：必须给出真实深度）
 *
 * 运行（在 frontend/ 下）：
 *   node ../scripts/verify_zero_flow/v10_depth_preview.mjs
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FE = process.cwd();
console.log(`[env] frontend cwd = ${FE}`);

const { build } = await import(pathToFileURL(join(FE, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href)
  .catch(async () => await import('rolldown'));

let entry = `
import { CoordinateSystem } from 'CS_PATH';
import { SplineInterpolator } from 'SP_PATH';

const cases = {
  'a_未标定_端点全null': {
    isCalibrated: false, top_px: null, bottom_px: null, top_cm: null, bottom_cm: null,
    unit: 'cm', depthInterval: 2, depthGridEnabled: true,
  },
  'b_未标定_但端点有值': {
    isCalibrated: false, top_px: 511, bottom_px: 1311, top_cm: 0, bottom_cm: 0,
    unit: 'cm', depthInterval: 2, depthGridEnabled: true,
  },
  'c_已标定_对照': {
    isCalibrated: true, top_px: 511, bottom_px: 1311, top_cm: 0, bottom_cm: 1300,
    unit: 'cm', depthInterval: 2, depthGridEnabled: true,
  },
};
const roi = { yMin: 507, yMax: 1310, xMin: 309, xMax: 1945 };

const out = {};
for (const [name, cal] of Object.entries(cases)) {
  const bounds = CoordinateSystem.calibrationBounds(cal);
  const withRoi = SplineInterpolator.getStandardDepthHorizons(cal, roi);
  const noRoi = SplineInterpolator.getStandardDepthHorizons(cal);
  out[name] = {
    calibrationBounds: bounds,
    withRoi: {
      n: withRoi.depths.length,
      depthsHead: withRoi.depths.slice(0, 6),
      yHead: withRoi.yPositions.slice(0, 6),
      uniqueDepthCount: new Set(withRoi.depths).size,
    },
    noRoi: {
      n: noRoi.depths.length,
      depthsHead: noRoi.depths.slice(0, 6),
      uniqueDepthCount: new Set(noRoi.depths).size,
    },
  };
}
console.log(JSON.stringify(out, null, 2));
`;

const CS_ABS = pathToFileURL(join(FE, 'src/core/CoordinateSystem.ts')).href;
const SP_ABS = pathToFileURL(join(FE, 'src/core/SplineInterpolator.ts')).href;
entry = entry.replace('CS_PATH', CS_ABS).replace('SP_PATH', SP_ABS);

const dir = mkdtempSync(join(tmpdir(), 'v10_'));
const entryPath = join(dir, 'entry.ts');
writeFileSync(entryPath, entry, 'utf8');
const outPath = join(dir, 'bundle.mjs');

await build({
  input: entryPath,
  output: { file: outPath, format: 'esm' },
  logLevel: 'silent',
  cwd: FE,
  resolve: { alias: {} },
});

const mod = await import(pathToFileURL(outPath).href);
rmSync(dir, { recursive: true, force: true });
