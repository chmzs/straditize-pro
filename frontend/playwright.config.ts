import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// 端口默认**每次运行都不同**：本仓库是明确的多会话并发环境（HANDOFF.md 规则），
// 固定端口会让两个会话抢同一个后端——一方把另一方当"孤儿"杀掉、或双方共用同一份
// 会话状态互相 `e2e.reset`（实测报 `命名冲突：区域名称 'pollen' 已存在`）。
// 需要固定端口时用 `STRADITIZE_E2E_PORT` 显式覆盖。
const PORT = Number(process.env.STRADITIZE_E2E_PORT ?? 20000 + (process.pid % 20000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
// 仓库根：本配置在 frontend/ 下。package.json 是 ESM，没有 __dirname。
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Straditize 的 e2e 配置。
 *
 * 三条设计决定，都是被旧套件的实际缺陷逼出来的：
 *
 * 1. **一个后端、一个浏览器上下文跑完整个套件。** 旧套件每个测试都
 *    `close` → `open --browser=msedge` → `eval` → `close`，11 个文件等于 11 次
 *    浏览器冷启动，105 秒里大半是启动开销。
 * 2. **`workers: 1`。** 后端只有**一份**会话状态，并行会互相踩。测试之间靠
 *    `e2e.reset` 复位（见 helpers 的 `resetBaseline`），而不是靠祈祷顺序。
 * 3. **`reuseExistingServer: false`（恒定，不看 CI）。** 复用已在监听的那个端口，
 *    在一个多会话并发的仓库里等于**和另一个会话共用同一份后端会话状态**：双方的
 *    `e2e.reset` 交错执行，一方 `project_new` 清了图而另一方正在断言它，症状是
 *    "ROI 'pollen' 已存在""连接已断开"这类与代码无关的随机失败。宁可快速失败并
 *    指向占用者，也不要静默共享。
 * 4. **端口与产物目录都按运行隔离。** 见下方 PORT 与 outputDir 的注释。
 */
export default defineConfig({
  testDir: './e2e',
  // 产物目录按端口隔离：两个会话同时跑时，共享 `test-results/` 会让 Playwright
  // 在收尾写 trace 时报 `browserContext.close: ENOENT ...recordingN.network`
  // ——测试体其实通过了，红的是产物记账（实测踩中）。CI 只有一个运行，保持
  // 固定路径以便 upload-artifact 直接取用。
  outputDir: process.env.CI ? 'test-results' : `test-results-${PORT}`,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: BASE_URL,
    // 与 AGENTS.md「浏览器：MS Edge」一致；channel 用系统已装的 Edge，无需下载 chromium。
    channel: 'msedge',
    viewport: { width: 1680, height: 1050 },
    // 语言必须钉死：`frontend/src/i18n/index.ts:30-31` 在 localStorage 无记录时
    // 回落到 `navigator.language`，非 zh 开头即整站切英文。真实用户是 zh-CN
    // （后端配置也是 zh-CN），不钉死就会出现"断言中文、页面英文"的环境依赖型失败
    // ——旧套件靠系统中文环境掩盖了这一点。
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'msedge',
      // 注意顺序：`devices` 展开在前，后面的键才能覆盖它自带的 viewport/locale。
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        viewport: { width: 1680, height: 1050 },
        locale: 'zh-CN',
      },
    },
  ],

  webServer: {
    command: 'pixi run python support/serve_e2e_backend.py',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/status`,
    env: {
      STRADITIZE_E2E_PORT: String(PORT),
    },
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
