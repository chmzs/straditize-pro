import { defineConfig } from 'vite';

// 开发模式下后端所在地址（与 `pixi run rpc-server` 的默认端口一致）
const BACKEND = process.env.STRADITIZE_BACKEND ?? 'http://127.0.0.1:8765';

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
