import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 「从零开始」旅程测试的独立 Playwright 配置。
 *
 * ## 为什么必须另起一份，而不是改 `playwright.config.ts`
 *
 * 现有 `playwright.config.ts` 的 webServer 是 `support/serve_e2e_backend.py`，那个
 * 启动器**预载 hoya 并预跑 detect_columns**（它是 70 项既有 e2e 的基线）。本套用例要
 * 验证的恰恰是那两项之前的部分："空会话 → 用户真的选了一张图 → 第一次分列"。
 * 改基线等于同时改掉 70 项用例的前提，风险与收益不成比例，所以两者并存、互不影响。
 *
 * ## 端口 22920 起
 *
 * 仓库长期多会话并发。基线占 8799，`test-contract` lane 常占 22901 一类，
 * 本旅程固定落在 22920-22930 段，避免和任何一方抢同一个后端（单会话后端被两个
 * 客户端共用时，两边的 `e2e.reset` 会交错，产生与代码无关的随机红）。
 *
 * `reuseExistingServer: false` 是**恒定**的（不看 CI）：复用已在监听的端口等于和
 * 另一个会话共用同一份会话状态。宁可快速失败并指名端口被占，也不要静默共享。
 */
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22920);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// 仓库根：本配置在 frontend/ 下。package.json 是 ESM，没有 __dirname。
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

if (!(PORT >= 22920 && PORT <= 22930)) {
  // 端口越界直接在这里炸掉，而不是让 webServer 起在别处、worker 却去连 22920。
  throw new Error(
    `STRADITIZE_ZERO_PORT=${PORT} 越界：本套旅程只允许 22920-22930（避免与既有 e2e 抢后端会话）。`
  );
}

export default defineConfig({
  testDir: './e2e',
  // 只跑本套旅程的 spec。`testMatch` 而非 `testIgnore`：新增的其它 spec 默认不会被
  // 拉进这条 lane，避免了"加了条新用例就悄悄改变了这条 lane 的语义"。
  testMatch: /from-zero-journey\.spec\.ts/,
  // 产物目录按端口隔离（与基线同一规则）。trace JSON 就写在这个目录里。
  outputDir: `test-results-${PORT}-zero`,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // 单条用例要走完"上传 2339×1654 真图 + 8 步 + 导出"，基线单步就常有 15s 级等待，
  // 整条链路给足 300s；任何一处卡死仍会被各自的 15-30s 轮询提前打红并指出位置。
  timeout: 300_000,
  expect: { timeout: 10_000 },

  // ## HTML 报告目录**不得**与 outputDir 嵌套（2026-10-19 实测）
  //
  // 第一版曾把报告写进 `test-results-<port>-zero/report`，理由是"不额外制造未跟踪目录"。
  // 那是错的，Playwright 当场报 Configuration Error，原文如下：
  //
  //     Configuration Error: HTML reporter output folder clashes with the tests output folder:
  //         html reporter folder: <repo>/frontend/test-results-22926-zero/report
  //         test results folder:  <repo>/frontend/test-results-22926-zero
  //     HTML reporter will clear its output directory prior to being generated,
  //     which will lead to the artifact loss.
  //
  // 后果不是报错难看，而是**产物真的会丢**：reporter 生成前会清空该目录，
  // 一旦用例失败，`trace: 'retain-on-failure'` 留下的 trace 会被清掉——而那正是
  // 排查失败唯一的东西。所以两者必须**平级、不嵌套**。
  //
  // 落点选 `test-results-<port>-zero-report`：已在 .gitignore 覆盖范围内
  // （`frontend/test-results-*/`，`git check-ignore` 实测命中），既不新增未跟踪目录，
  // 也与 outputDir 平级。
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `test-results-${PORT}-zero-report` }],
  ],

  use: {
    baseURL: BASE_URL,
    // 与 AGENTS.md「浏览器：MS Edge」一致；用系统已装的 Edge，无需下载 chromium。
    channel: 'msedge',
    viewport: { width: 1680, height: 1050 },
    // 语言必须钉死：`frontend/src/i18n/index.ts` 在 localStorage 无记录时回落到
    // `navigator.language`，非 zh 开头即整站切英文。真实用户是 zh-CN。
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'msedge-zero',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        viewport: { width: 1680, height: 1050 },
        locale: 'zh-CN',
      },
    },
  ],

  webServer: {
    command: 'pixi run python support/serve_zero_backend.py',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/status`,
    env: {
      STRADITIZE_ZERO_PORT: String(PORT),
    },
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
