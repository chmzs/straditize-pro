import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// 端口必须**在一次运行内对所有进程一致**：Playwright 会在**每个 worker 进程**里
// 重新求值本配置文件，任何依赖 `process.pid` 的"随机端口"都会让主进程把后端起在
// A 端口、而 worker 用 `baseURL` 去连 B 端口（实测：后端起在 20988，worker 却去连
// 22652/21548，25 条全报 ERR_CONNECTION_REFUSED）。所以端口只从**环境变量**取
// （子进程继承，因而稳定），默认固定 8799。
//
// 本仓库多会话并发，默认端口可能被另一会话占着：此时 `reuseExistingServer: false`
// 会让本次运行**快速失败并指名占用者**，而不是静默共用对方的后端会话。并发跑第二
// 份请显式错开：`STRADITIZE_E2E_PORT=22600 pixi run test-e2e`。
const PORT = Number(process.env.STRADITIZE_E2E_PORT ?? 8799);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// 仓库根：本配置在 frontend/ 下。package.json 是 ESM，没有 __dirname。
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Straditize 的 e2e 配置。
 *
 * 四条设计决定，都是被旧套件与并发环境的实际缺陷逼出来的：
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
 * 4. **端口与产物目录都由环境变量决定，且在一次运行内恒定。** 见文件顶部 PORT 注释：
 *    端口若按 `process.pid` 随机化会直接毁掉 `baseURL`（每个 worker 重新求值配置）。
 */
export default defineConfig({
  testDir: './e2e',
  // 产物目录按端口隔离：两个会话同时跑时，共享 `test-results/` 会让 Playwright
  // 在收尾写 trace 时报 `browserContext.close: ENOENT ...recordingN.network`
  // ——测试体其实通过了，红的是产物记账（实测踩中）。端口取自环境变量，因而
  // 主进程与各 worker 得到的路径一致。CI 只有一个运行，保持固定路径以便
  // upload-artifact 直接取用。
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
