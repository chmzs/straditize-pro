import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

// 开发模式下后端所在地址（与 `pixi run rpc-server` 的默认端口一致）
const BACKEND = process.env.STRADITIZE_BACKEND ?? 'http://127.0.0.1:8765';

// 应用版本的**唯一事实源**：frontend/package.json 的 `version`。
// 构建期读一次，经 `define` 注入为 `__APP_VERSION__`（见下方 define 与
// `src/core/appVersion.ts`）。界面不得再写版本字面量——那是 e896bff 修过的
// 站点徽章漂移的同一个坑。
const PKG_VERSION: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

// 后端自有的路径前缀，开发时全部代理过去。
//
// 这样做的目的是让浏览器【始终只看到同一个源】(localhost:5173)，于是开发与生产
// （后端直接自带前端）共享同一套"同源"语义，后端无需为开发模式开放任何跨源例外。
// 注意 changeOrigin 必须为 false：一旦改写 Host，浏览器发来的 Origin 将不再与 Host
// 同源，后端的同源校验会（正确地）拒绝该请求。
const BACKEND_ROUTES = [
  '/rpc',
  '/status',
  '/health',
  '/events',
  '/image',
  '/api',
  '/components',
  '/webr',
  '/shutdown',
];

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  // 版本号在构建期作为字面量烧进产物（唯一事实源见文件顶部的 PKG_VERSION）。
  define: {
    __APP_VERSION__: JSON.stringify(PKG_VERSION),
  },
  server: {
    port: 5173,
    host: true,
    open: false,
    proxy: Object.fromEntries(
      BACKEND_ROUTES.map((route) => [route, { target: BACKEND, changeOrigin: false }])
    ),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/components/agedepth/') || id.includes('AgeDepthModal')) {
            return 'agedepth';
          }
          if (id.includes('/components/ocr/') || id.includes('OcrReviewModal') || id.includes('diatomGenera') || id.includes('PollenGlossary')) {
            return 'ocr';
          }
          if (id.includes('ExportModal') || id.includes('ProjectManager') || id.includes('TarArchive')) {
            return 'export';
          }
          if (id.includes('MetadataModal')) {
            return 'metadata';
          }
        },
      },
    },
  },
});
