/// <reference types="vite/client" />

/**
 * 构建期注入的应用版本，值是 `frontend/package.json` 的 `version`
 * （注入点：`vite.config.ts` 的 `define`）。运行期读取入口：
 * `src/core/appVersion.ts` 的 `APP_VERSION`。
 */
declare const __APP_VERSION__: string;
