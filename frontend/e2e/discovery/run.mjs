#!/usr/bin/env node
/**
 * Discovery lane —— 随机状态机探索器主入口。
 *
 * ## 它是什么、不是什么
 *
 * 它是**探索**工具：用确定性随机种子在真实 UI 上乱走，把状态机里"人真会碰到但
 * regression lane 没写死"的路径踩一遍。它**不是**回归套件：没有固定断言序列，
 * 失败即报警并把证据全留下，由人判断是产品缺陷还是动作选得不合理。
 *
 * 分工与 CI 落点见 `docs/testing-strategy.md` §10。
 *
 * ## 为什么自己实现 RNG
 *
 * `Math.random()` 不可复现，同一个 seed 跑两次会得到不同动作序列，"重放"这件事
 * 就不成立。这里用 mulberry32（32 位状态、单函数、无依赖）。动作选择 = 给定状态
 * 的候选动作**排序后**取 `floor(rng() * n)`，因此
 * 「同 seed + 同动作表 ⇒ 逐条相同的动作序列」是由构造保证的，不是靠运气。
 *
 * `--replay` 会拿本次动作序列与磁盘上既有的 `seq.json` 逐条比对，把
 * `replayMatch` 写进新记录——重放不一致是**失败**，不是提示。
 *
 * ## 用法
 *
 * ```bash
 * npm run discovery -- --seeds=1-3 --steps=10 --port=22960
 * npm run discovery -- --seed=7 --replay --steps=20
 * npm run discovery:replay          # 只跑 known-failures.json 里的 seed
 * ```
 *
 * 需要先起**零状态**后端（本脚本不负责起后端，避免和多会话抢端口）：
 *
 * ```bash
 * STRADITIZE_ZERO_PORT=22960 pixi run python support/serve_zero_backend.py
 * ```
 *
 * ## 产物
 *
 * `.scratch/discovery/<seed>/`：`seq.json`、`trace.zip`、`shot-<n>.png`、
 * `console.jsonl`、`rpc.jsonl`、`state-before.json`、`state-after.json`、
 * `steps/<n>/state-before|after.json`、以及（若保存过项目）`saved-project.tar`。
 *
 * **失败保留全部**；**通过时默认只留 `seq.json`**（`--keep-artifacts` 可关掉裁剪，
 * 冒烟时用它确认目录结构）。`--compact` 额外把通过的 `seq.json` 压成摘要。
 */

import { chromium } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIONS,
  ActionFailed,
  ActionUnavailable,
  REAL_POLLEN_IMAGE,
  readFront,
  readyFn,
  runFn,
  waitForQuiet,
} from './actions.mjs';
import { MANUAL_ONLY, runChecks } from './invariants.mjs';
import {
  STATES,
  STATE_LIST,
  TRANSITION_BY_ID,
  TRANSITIONS,
  actionWeight,
  inferState,
  legalActionIds,
} from './states.mjs';

// ---------------------------------------------------------------------------
// 路径与常量
// ---------------------------------------------------------------------------

/** 仓库根：本文件在 `frontend/e2e/discovery/` 下，上跳三级。 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 只读 RPC 白名单。白名单外的方法一律抛错——不给"顺手写一下"留口子。 */
const READ_ONLY_RPC = new Set([
  'straditize.getDiagramData',
  'roi.list',
  'samples.list',
  'qa.summarize',
  'core.getStatus',
  'system.ping',
  'e2e.health',
]);

/** 动作表与实现必须一一对应；任何一边多出来都要当场炸（配置漂移）。 */
function assertTableMatchesImplementations() {
  const tableIds = TRANSITIONS.map((t) => t.id).sort();
  const implIds = Object.keys(ACTIONS)
    .filter((k) => !k.startsWith('ready_'))
    .sort();
  const missing = tableIds.filter((id) => !implIds.includes(id));
  const extra = implIds.filter((id) => !tableIds.includes(id));
  if (missing.length || extra.length) {
    throw new Error(
      `动作表与实现不一致：表里有实现没有 ${JSON.stringify(missing)}；实现里有表没有 ${JSON.stringify(extra)}`
    );
  }
  for (const id of tableIds) {
    if (typeof readyFn(id) !== 'function' || typeof runFn(id) !== 'function') {
      throw new Error(`动作 ${id} 缺少 run/ready 实现`);
    }
  }
}

// ---------------------------------------------------------------------------
// 确定性 RNG
// ---------------------------------------------------------------------------

/** mulberry32：32 位状态、无依赖、跨平台逐位一致。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    float: next,
    /** 取 `[min, max)` 的实数；先取再算，保证只消耗一次随机数。 */
    floatBetween(min, max) {
      return min + next() * (max - min);
    },
    /** 取 `[0, max)` 的整数。 */
    int(max) {
      return Math.floor(next() * max);
    },
  };
}

/**
 * 按权重从**已排序**的 id 列表里挑一个。
 *
 * 只消耗一次随机数，且遍历顺序与 `legalActionIds()` 的排序一致，
 * 所以"同 seed + 同动作表 ⇒ 同选择"是由构造保证的。
 */
function weightedPick(ids, rng) {
  const total = ids.reduce((sum, id) => sum + actionWeight(id), 0);
  let r = rng.float() * total;
  for (const id of ids) {
    r -= actionWeight(id);
    if (r < 0) return id;
  }
  return ids[ids.length - 1];
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function expandSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*(?:\.\.|-|:)\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const step = from <= to ? 1 : -1;
      for (let s = from; s !== to + step; s += step) out.push(s);
      continue;
    }
    if (!/^\d+$/.test(trimmed)) throw new Error(`无法解析 seed 片段 ${JSON.stringify(trimmed)}`);
    out.push(Number(trimmed));
  }
  if (!out.length) throw new Error(`--seeds=${spec} 没有解析出任何 seed`);
  return [...new Set(out)];
}

function parseArgs(argv) {
  const args = {
    seedsSpec: '1',
    steps: 10,
    port: 22960,
    replay: false,
    keepArtifacts: false,
    compact: false,
    printActions: false,
    outDir: null,
  };
  for (const raw of argv.slice(2)) {
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw : raw.slice(0, eq);
    const value = eq === -1 ? null : raw.slice(eq + 1);
    switch (key) {
      case '--seeds':
        args.seedsSpec = value ?? '1';
        break;
      case '--seed':
        args.seedsSpec = value ?? '1';
        break;
      case '--steps':
        args.steps = Number(value);
        break;
      case '--port':
        args.port = Number(value);
        break;
      case '--out':
        args.outDir = value;
        break;
      case '--replay':
        args.replay = true;
        break;
      case '--keep-artifacts':
        args.keepArtifacts = true;
        break;
      case '--compact':
        args.compact = true;
        break;
      case '--print-actions':
        args.printActions = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(
          `未知参数 ${raw}（可用：--seeds=1..20 / --seed=N --replay / --steps=10..30 / --port=22960 / --out=… / --keep-artifacts / --compact / --print-actions）`
        );
    }
  }
  if (!Number.isFinite(args.steps) || args.steps < 1 || args.steps > 200) {
    throw new Error(`--steps=${args.steps} 越界（1..200）`);
  }
  if (!Number.isFinite(args.port)) throw new Error(`--port=${args.port} 不是数字`);
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      'Discovery lane —— 随机状态机探索器',
      '',
      '  --seeds=1..20 | 1-3 | 1,2,3   seed 集合（默认 1）',
      '  --seed=N --replay             单 seed 重放；--replay 还会与磁盘上既有 seq.json 逐条比对',
      '  --steps=10..30                每条序列的动作数（默认 10）',
      '  --port=22960                  零状态后端端口（默认 22960，第二实例保留 22961）',
      '  --out=<dir>                   产物根目录（默认 <repo>/.scratch/discovery）',
      '  --keep-artifacts              通过时也保留全部产物（冒烟验证目录结构用）',
      '  --compact                     通过时把 seq.json 压成摘要（默认保留完整动作序列）',
      '  --print-actions               额外打印每条序列的动作 id 数组（便于跨次 diff）',
      '',
      '不带 --seeds / --seed 而只给 --replay 时，跑 known-failures.json 里的 seed 清单。',
    ].join('\n') + '\n'
  );
}

// ---------------------------------------------------------------------------
// 后端读（只读，走 Node 侧 HTTP，不碰页面）
// ---------------------------------------------------------------------------

function makeBackend(context, baseUrl, onRecord) {
  async function call(method, params = {}) {
    if (!READ_ONLY_RPC.has(method)) {
      throw new Error(
        `禁止在探索器里调用非只读 RPC ${method}：动作必须走真实 UI，读状态只允许 ${JSON.stringify([
          ...READ_ONLY_RPC,
        ])}`
      );
    }
    const started = Date.now();
    const res = await context.request.post(`${baseUrl}/rpc`, {
      data: { jsonrpc: '2.0', id: 1, method, params },
    });
    const ms = Date.now() - started;
    if (!res.ok()) {
      onRecord({ dir: 'read', method, ok: false, status: res.status(), ms });
      throw new Error(`后端 RPC ${method} 返回 HTTP ${res.status()}：${(await res.text()).slice(0, 400)}`);
    }
    const body = await res.json();
    if (body.error) {
      onRecord({ dir: 'read', method, ok: false, error: body.error, ms });
      throw new Error(`后端 RPC ${method} 失败 [${body.error.code}] ${body.error.message}`);
    }
    onRecord({ dir: 'read', method, ok: true, ms });
    return body.result;
  }
  return { call };
}

// ---------------------------------------------------------------------------
// 页面遥测
// ---------------------------------------------------------------------------

/**
 * 装控制台/异常/原生对话框/应用内通知的采集器。
 *
 * 通知通道（toast / 错误弹窗 / 详情弹窗）用 `addInitScript` 装的 MutationObserver
 * 采集：toast 4 秒后会自行消失，轮询式检查会漏。这与 `helpers.ts` 的 `watchPage`
 * 同一套理由，但**采集面独立**：本 lane 需要"这一步有没有通知"的增量，
 * 而不是整轮的汇总。
 */
async function installTelemetry(page, sink) {
  page.on('console', (msg) => {
    const entry = { t: new Date().toISOString(), type: msg.type(), text: msg.text() };
    sink.console.push(entry);
    if (msg.type() === 'error') sink.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    const text = `pageerror: ${err?.message ?? err}`;
    sink.console.push({ t: new Date().toISOString(), type: 'pageerror', text });
    sink.consoleErrors.push(text);
  });
  page.on('dialog', (dialog) => {
    sink.notices.push(dialog.message());
    void dialog.dismiss();
  });

  await page.exposeFunction('__discoveryRecordNotice', (text) => {
    const clean = String(text ?? '').trim();
    if (clean) sink.notices.push(clean);
  });
  await page.addInitScript(() => {
    const SELECTOR = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
    let recorded = new WeakSet();
    const record = (el) => {
      if (recorded.has(el)) return;
      recorded.add(el);
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      const fn = window.__discoveryRecordNotice;
      if (typeof fn === 'function') fn(text);
    };
    const scan = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      if (el.matches && el.matches(SELECTOR)) record(el);
      if (el.querySelectorAll) el.querySelectorAll(SELECTOR).forEach(record);
    };
    const start = () => {
      scan(document.documentElement);
      new MutationObserver((records) => {
        recorded = new WeakSet();
        for (const rec of records) rec.addedNodes.forEach(scan);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });

  /**
   * 页面侧的 `/rpc` 在飞计数。
   *
   * 这是"动作之后到底该等什么"的答案：**等应用自己的请求回完**，而不是等一个毫秒数。
   * 三个细节都是为了不骗自己：
   *
   * 1. 只包 pathname === '/rpc' —— 应用还有别的长连接（SSE `/events`），
   *    把它们算进去会让计数永远不归零，quiescence 直接变成死等。
   * 2. 减计数发生在 **body 被读完之后**（`res.clone().text()`），不是响应头到达时。
   *    `fetch()` 的 Promise 在响应头就到了，而业务代码在 `await res.json()` 之后才动状态；
   *    若在响应头处减，"安静"会早于数据落地，读到的仍是半完成状态。
   * 3. 暴露 `__discRpcWrapped` 累计计数：整轮若一次都没包到，说明应用的 RPC 不走 fetch
   *    （XHR / 其它传输层），此时本机制**退化为帧边界等待**——run.mjs 会把这件事
   *    写进 `seq.json` 的 observations，不允许它静默变成"看起来有等待"。
   */
  await page.addInitScript(() => {
    window.__discInflightRpc = 0;
    window.__discRpcWrapped = 0;
    const orig = window.fetch;
    if (typeof orig !== 'function' || orig.__discWrapped) return;
    const wrapped = function (input, init) {
      let path = '';
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        path = new URL(url, location.href).pathname;
      } catch {
        path = '';
      }
      if (path !== '/rpc') return orig.call(this, input, init);

      window.__discInflightRpc += 1;
      window.__discRpcWrapped += 1;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.__discInflightRpc = Math.max(0, window.__discInflightRpc - 1);
      };
      let promise;
      try {
        promise = orig.call(this, input, init);
      } catch (err) {
        done();
        throw err;
      }
      return Promise.resolve(promise).then(
        (res) => {
          // body 读完才算结束；clone 不影响调用方拿到的那个 Response。
          try {
            res
              .clone()
              .text()
              .then(done, done);
          } catch {
            done();
          }
          return res;
        },
        (err) => {
          done();
          throw err;
        }
      );
    };
    wrapped.__discWrapped = true;
    window.fetch = wrapped;
  });

  // 页面自己发起的写 RPC：只看响应体里的 error（本后端是 HTTP 200 + body.error）。
  page.on('response', (res) => {
    if (!res.url().includes('/rpc')) return;
    let method = '?';
    try {
      method = res.request().postDataJSON?.()?.method ?? '?';
    } catch {
      /* 非 JSON 请求体不参与 */
    }
    if (READ_ONLY_RPC.has(method) || method === '?') return;
    void res
      .json()
      .then((body) => {
        const err = body?.error;
        if (!err) {
          sink.rpc.push({ t: new Date().toISOString(), dir: 'write', method, ok: true });
          return;
        }
        sink.rpc.push({ t: new Date().toISOString(), dir: 'write', method, ok: false, error: err });
        sink.writeRpcErrors.push({ method, code: err.code, message: err.message });
      })
      .catch(() => {
        /* 非 JSON 响应不参与 */
      });
  });
}

// ---------------------------------------------------------------------------
// 单 seed 运行
// ---------------------------------------------------------------------------

function writeJsonl(path, rows) {
  if (!rows.length) {
    writeFileSync(path, '', 'utf8');
    return;
  }
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function squash(backend, extra) {
  if (!backend || !backend.imageSrc) {
    return { state: STATES.EMPTY, imageSrc: null };
  }
  const cols = backend.columns ?? [];
  return {
    state: inferState(backend, extra),
    imageW: backend.imageWidth,
    imageH: backend.imageHeight,
    rois: (backend.rois ?? []).length,
    roiIds: (backend.rois ?? []).map((r) => r.id),
    activeRoiId: backend.activeRoiId ?? null,
    primaryRoiId: backend.primaryRoiId ?? null,
    columns: cols.length,
    calibratedColumns: cols.filter((c) => c?.scale_provenance?.calibrated === true).length,
    yCalibrated: !!backend.calibration?.isCalibrated,
    candidates: (backend.line_candidates ?? []).length,
    exclusionRegions: (backend.exclusion_regions ?? []).length,
    strokes: (backend.line_strokes ?? []).length,
    samples: Number(extra?.samplesCount ?? 0),
    stage: Number(extra?.frontStage ?? 0),
    qaRan: extra?.qaRan === true,
  };
}

async function runSeed({ seed, args, browser, baseUrl, seedsDir, prevSeq }) {
  const seedDir = join(seedsDir, String(seed));
  rmSync(seedDir, { recursive: true, force: true });
  mkdirSync(join(seedDir, 'steps'), { recursive: true });

  const sink = { console: [], rpc: [], consoleErrors: [], writeRpcErrors: [], notices: [] };
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1680, height: 1050 },
    locale: 'zh-CN',
    acceptDownloads: true,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  await installTelemetry(page, sink);

  const backend = makeBackend(context, baseUrl, (row) => sink.rpc.push({ t: new Date().toISOString(), ...row }));

  /** 动作实现拿到的上下文。所有副作用都在这里被记账，不给动作留隐藏状态。 */
  const ctx = {
    page,
    seed,
    step: 0,
    rng: makeRng(seed),
    seedDir,
    realImagePath: join(REPO_ROOT, REAL_POLLEN_IMAGE),
    savedProjectPath: null,
    savedKeyState: null,
    reopenedKeyState: null,
    /**
     * 「最近一次保存之后有没有真的重开过」。
     *
     * 不能用"保存次数 vs 重开次数"来配对：实测 seed 2 先保存两次再重开一次，
     * 计数比较会判成"未配对"从而静默跳过不变量 ⑥。配对关系是**事件序**，
     * 一个布尔量就够：保存置 false、重开置 true。
     */
    reopenAfterSave: false,
    deletedRoiIds: new Set(),
    backend: null,
    front: null,
    extra: { samplesCount: 0, frontStage: 0, qaRan: false },
    readDiagram: () => backend.call('straditize.getDiagramData'),
    readRois: () => backend.call('roi.list'),
    readSamples: () => backend.call('samples.list'),
    markQaRan: () => {
      ctx.extra.qaRan = true;
    },
    noteDeletedRoiId: (id) => ctx.deletedRoiIds.add(id),
    setSavedProject: (path, snapshot) => {
      ctx.savedProjectPath = path;
      ctx.savedKeyState = snapshot;
      ctx.reopenedKeyState = null; // 新的保存作废旧的重开比对
      ctx.reopenAfterSave = false;
    },
    async captureKeyState() {
      const d = await backend.call('straditize.getDiagramData');
      const rois = d.rois ?? [];
      return {
        roiNames: rois.map((r) => r.name).sort(),
        primaryRoiName: rois.find((r) => r.id === d.primaryRoiId)?.name ?? null,
        columnCount: (d.columns ?? []).length,
        calibration: {
          isCalibrated: !!d.calibration?.isCalibrated,
          top_px: d.calibration?.top_px ?? null,
          bottom_px: d.calibration?.bottom_px ?? null,
        },
      };
    },
  };

  const seq = {
    seed,
    port: args.port,
    steps: args.steps,
    startedAt: new Date().toISOString(),
    baseUrl,
    ok: null,
    failure: null,
    replayRequested: args.replay,
    replayMatch: null,
    actions: [],
    statesVisited: [],
    finalState: null,
    invariants: [],
    observations: [],
    // 把"刻意不做机检"的清单也写进产物：读 seq.json 的人能立刻看到
    // 这份绿灯**不覆盖**哪些东西，而不是误以为它覆盖了全部。
    manualOnlyChecks: [...MANUAL_ONLY],
  };

  const fail = (code, message, extra = {}) => {
    seq.ok = false;
    seq.failure = { code, message, ...extra };
  };

  try {
    // 会话复位到**零状态**（e2e.reset 由零状态启动器注册；本 lane 只用它做 seed 隔离，
    // 绝不用它摆业务状态）。
    const resetRes = await context.request.post(`${baseUrl}/rpc`, {
      data: { jsonrpc: '2.0', id: 1, method: 'e2e.reset', params: {} },
    });
    const resetBody = await resetRes.json();
    if (resetBody.error) {
      throw new Error(
        `e2e.reset 失败（端口 ${args.port} 上的后端不是零状态启动器？）：${JSON.stringify(resetBody.error)}`
      );
    }

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 60_000 });
    await page.waitForSelector('#geology-canvas', { state: 'visible', timeout: 30_000 });

    ctx.backend = await backend.call('straditize.getDiagramData');
    ctx.front = await readFront(page);
    const firstBefore = squash(ctx.backend, ctx.extra);
    // 起点也要进覆盖统计，否则 EMPTY 永远是 0（那个"0"会让人误以为没走过零状态）。
    seq.statesVisited.push(firstBefore.state);
    writeFileSync(join(seedDir, 'state-before.json'), JSON.stringify(firstBefore, null, 2) + '\n', 'utf8');

    for (let step = 1; step <= args.steps; step += 1) {
      ctx.step = step;
      const stepDir = join(seedDir, 'steps', String(step));
      mkdirSync(stepDir, { recursive: true });

      // ---- 读当前状态 ----
      let samplesCount = 0;
      try {
        samplesCount = Number((await backend.call('samples.list')).count ?? 0);
      } catch {
        samplesCount = 0;
      }
      ctx.extra.samplesCount = samplesCount;
      ctx.extra.frontStage = Number(ctx.front?.stage ?? 0);
      ctx.backend = await backend.call('straditize.getDiagramData');
      ctx.front = await readFront(page);

      const preState = inferState(ctx.backend, ctx.extra);
      const stateBefore = squash(ctx.backend, ctx.extra);
      writeFileSync(join(stepDir, 'state-before.json'), JSON.stringify(stateBefore, null, 2) + '\n', 'utf8');
      await page.screenshot({ path: join(seedDir, `shot-${step}.png`) });

      // ---- 选动作 ----
      const candidates = legalActionIds(preState);
      const ready = [];
      const unavailable = [];
      for (const id of candidates) {
        let okReady = false;
        try {
          okReady = await readyFn(id)(ctx);
        } catch (err) {
          unavailable.push({ id, reason: `ready() 抛错：${err?.message ?? err}` });
          continue;
        }
        if (okReady) ready.push(id);
      }

      const record = {
        n: step,
        preState,
        candidates,
        readyCount: ready.length,
        action: null,
        status: null,
        ms: 0,
        postState: null,
        detail: null,
        reason: null,
      };

      if (ready.length === 0) {
        record.status = 'NO_LEGAL_ACTION';
        record.reason =
          `状态 ${preState} 下没有任何可执行动作（候选 ${JSON.stringify(candidates)}）` +
          (unavailable.length ? `；ready() 拒绝：${JSON.stringify(unavailable)}` : '');
        seq.actions.push(record);
        fail('NO_LEGAL_ACTION', record.reason, { step, preState });
        await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) });
        break;
      }

      const actionId = weightedPick(ready, ctx.rng);
      record.action = actionId;
      const danger = TRANSITION_BY_ID[actionId]?.dangerous === true;
      record.dangerous = danger;

      // ---- 执行 ----
      const started = Date.now();
      const noticesBefore = sink.notices.length;
      const rpcErrorsBefore = sink.writeRpcErrors.length;
      try {
        const result = await runFn(actionId)(ctx);
        record.status = 'OK';
        record.detail = result?.detail ?? null;
      } catch (err) {
        record.ms = Date.now() - started;
        const isUnavailable = err instanceof ActionUnavailable;
        record.status = isUnavailable ? 'ACTION_UNAVAILABLE' : 'ACTION_FAILED';
        record.reason = `${err?.name ?? 'Error'}: ${err?.message ?? err}${
          err instanceof ActionUnavailable && err.selector ? `（selector=${err.selector}）` : ''
        }`;
        await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) }).catch(() => {});
        seq.actions.push(record);
        fail(record.status, record.reason, { step, actionId, preState });
        break;
      }
      record.ms = Date.now() - started;

      // ---- 读后状态 ----
      //
      // 这里原来是一句 `await page.waitForTimeout(80)`。那是**固定 sleep 当同步用**：
      // 短了会把半完成状态读成 PASS（一次写分两阶段落地时最典型），长了则掩盖
      // "动作其实早就结束"。现在改成条件等待：等页面侧自己发出的 /rpc 全部回完
      // （且连续两帧为 0）。动作若标了 heuristic_wait，说明它没有可等的行为信号，
      // 已在 actions.mjs / states.mjs 里写明理由，并在下面逐步记进 seq.json。
      const quiesce = await waitForQuiet(page);
      record.waitMode = TRANSITION_BY_ID[actionId]?.waitMode ?? 'condition';
      // heuristic_wait 的理由也逐条写进 seq.json：读产物的人不必翻源码就能判断
      // "这一步的等待到底是条件还是猜的"。
      record.waitNote = TRANSITION_BY_ID[actionId]?.waitWhy ?? null;
      record.quiesce = { quiet: quiesce.quiet, frames: quiesce.frames, inflight: quiesce.inflight };
      if (!quiesce.quiet) {
        seq.actions.push(record);
        fail(
          'QUIESCE_TIMEOUT',
          `动作 ${actionId} 之后页面仍有 ${quiesce.inflight} 个 /rpc 请求在飞` +
            `（${quiesce.frames} 帧内未安静）：此时读到的是半完成状态，不能据此判通过`,
          { step, actionId }
        );
        await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) }).catch(() => {});
        break;
      }
      try {
        ctx.extra.samplesCount = Number((await backend.call('samples.list')).count ?? 0);
      } catch {
        /* 保持旧值 */
      }
      ctx.backend = await backend.call('straditize.getDiagramData');
      ctx.front = await readFront(page);
      ctx.extra.frontStage = Number(ctx.front?.stage ?? 0);
      const postState = inferState(ctx.backend, ctx.extra);
      record.postState = postState;
      const stateAfter = squash(ctx.backend, ctx.extra);
      writeFileSync(join(stepDir, 'state-after.json'), JSON.stringify(stateAfter, null, 2) + '\n', 'utf8');
      if (!seq.statesVisited.includes(postState)) seq.statesVisited.push(postState);

      if (actionId === 'reopen_project') {
        ctx.reopenedKeyState = await ctx.captureKeyState();
        ctx.reopenAfterSave = true;
      }

      // ---- 白屏检查（先把"页面还在不在"排掉，再谈业务不变量）----
      const alive = await page
        .evaluate(() => {
          const canvas = document.querySelector('#geology-canvas');
          const bodyText = (document.body?.innerText ?? '').trim();
          return {
            handle: Boolean(window.__straditize),
            canvas: Boolean(canvas),
            bodyLen: bodyText.length,
          };
        })
        .catch(() => ({ handle: false, canvas: false, bodyLen: 0 }));
      if (!alive.handle || !alive.canvas || alive.bodyLen === 0) {
        seq.actions.push(record);
        fail('WHITE_SCREEN', `页面结构消失：${JSON.stringify(alive)}`, { step, actionId });
        await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) }).catch(() => {});
        break;
      }

      // ---- 写 RPC 失败：区分"已告知用户"与"静默吞掉" ----
      const newRpcErrors = sink.writeRpcErrors.slice(rpcErrorsBefore);
      const newNotices = sink.notices.length - noticesBefore;
      if (newRpcErrors.length) {
        const surfaced = newNotices > 0;
        record.rpcErrors = newRpcErrors;
        record.rpcErrorSurfaced = surfaced;
        if (!surfaced) {
          seq.actions.push(record);
          fail(
            'RPC_WRITE_FAILED',
            `写 RPC 失败且**用户完全没被告知**（AGENTS.md 不变量 1 要求错误必须冒泡）：${JSON.stringify(
              newRpcErrors
            )}`,
            { step, actionId }
          );
          await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) }).catch(() => {});
          break;
        }
        // 已告知用户的拒绝 = 产品在正确工作，记录为观测项，不算失败。
        record.status = 'OK_RPC_REJECTED_SURFACED';
      }

      // ---- 不变量 ----
      const { results, observations } = await runChecks({
        backend: ctx.backend,
        front: ctx.front,
        page,
        consoleErrors: sink.consoleErrors,
        deletedRoiIds: [...ctx.deletedRoiIds],
        savedKeyState: ctx.reopenAfterSave ? ctx.savedKeyState : null,
        reopenedKeyState: ctx.reopenedKeyState,
        declaredTo: TRANSITION_BY_ID[actionId]?.to ?? [],
        postState,
        actionId,
      });
      record.invariants = results.map((r) => ({ id: r.id, status: r.status }));

      const violated = results.filter((r) => r.status === 'fail');
      if (violated.length) {
        seq.actions.push(record);
        seq.invariants = results;
        seq.observations = observations;
        fail(
          'INVARIANT_VIOLATION',
          violated.map((v) => `${v.id} ${v.title}：${v.detail}`).join(' | '),
          { step, actionId, invariants: violated.map((v) => v.id) }
        );
        await page.screenshot({ path: join(seedDir, `shot-${step}-fail.png`) }).catch(() => {});
        break;
      }

      seq.actions.push(record);
      // 记最后一轮的检查结果（全部 pass），用于报告。
      seq.invariants = results;
      seq.observations = observations;
    }

    if (seq.ok === null) {
      seq.ok = true;
      seq.finalState = seq.actions.length ? seq.actions[seq.actions.length - 1].postState : STATES.EMPTY;
    }
  } catch (err) {
    seq.ok = false;
    seq.failure = {
      code: err instanceof ActionFailed ? 'ACTION_FAILED' : 'HARNESS_ERROR',
      message: `${err?.name ?? 'Error'}: ${err?.message ?? err}`,
      stack: String(err?.stack ?? '').split('\n').slice(0, 6),
    };
  } finally {
    // ---- 重放比对 ----
    if (prevSeq && Array.isArray(prevSeq.actions)) {
      const prevIds = prevSeq.actions.map((a) => a.action);
      const nowIds = seq.actions.map((a) => a.action);
      seq.replayMatch =
        prevIds.length === nowIds.length && prevIds.every((id, i) => id === nowIds[i]);
      seq.replayPrevIds = prevIds;
      seq.replayNowIds = nowIds;
      if (!seq.replayMatch) {
        seq.ok = false;
        seq.failure = {
          code: 'REPLAY_MISMATCH',
          message: `同 seed 重放的动作序列不同：上次 ${JSON.stringify(prevIds)}，本次 ${JSON.stringify(
            nowIds
          )}`,
        };
      }
    }

    seq.finishedAt = new Date().toISOString();
    seq.consoleErrorCount = sink.consoleErrors.length;
    seq.noticeCount = sink.notices.length;

    // in-flight 计数器必须自证"真的包到了东西"。整轮一次都没包到，说明应用的 RPC
    // 不走 window.fetch（XHR / worker / 其它），此时 `waitForQuiet` 实际退化成
    // 帧边界等待——把它写进 observations，不允许它静默变成"看起来有等待"。
    try {
      seq.inflightWrappedRpcs = await page.evaluate(() => window.__discRpcWrapped ?? 0);
    } catch {
      seq.inflightWrappedRpcs = null;
    }
    if (seq.inflightWrappedRpcs === 0) {
      seq.observations = [
        ...(seq.observations ?? []),
        {
          id: 'O3',
          title: 'in-flight 计数器是否真的包到了应用的 /rpc',
          status: 'inert',
          detail:
            '整轮没有观测到任何被包装的 /rpc 请求：应用可能不走 window.fetch（XHR / worker / 其它传输层）。'
            + '这意味着本轮的"等安静"退化成了帧边界等待，等价于 heuristic_wait —— 本轮不该被当作'
            + '"有条件的同步"来信任。',
        },
      ];
    }

    // ---- 落盘 ----
    writeJsonl(join(seedDir, 'console.jsonl'), sink.console);
    writeJsonl(join(seedDir, 'rpc.jsonl'), sink.rpc);
    if (ctx.backend) {
      writeFileSync(
        join(seedDir, 'state-after.json'),
        JSON.stringify(squash(ctx.backend, ctx.extra), null, 2) + '\n',
        'utf8'
      );
    }
    try {
      await context.tracing.stop({ path: join(seedDir, 'trace.zip') });
    } catch {
      /* tracing 收尾失败不应改写业务结论 */
    }

    const seqPath = join(seedDir, 'seq.json');
    if (seq.ok) {
      if (args.compact) {
        // 摘要式 seq.json：只保留复核需要的最小字段。
        writeFileSync(
          seqPath,
          JSON.stringify({
            seed: seq.seed,
            ok: true,
            steps: seq.actions.length,
            finalState: seq.finalState,
            actions: seq.actions.map((a) => a.action),
          }) + '\n',
          'utf8'
        );
      } else {
        writeFileSync(seqPath, JSON.stringify(seq, null, 2) + '\n', 'utf8');
      }
      if (!args.keepArtifacts) {
        for (const entry of ['trace.zip', 'console.jsonl', 'rpc.jsonl', 'state-before.json', 'state-after.json', 'steps']) {
          rmSync(join(seedDir, entry), { recursive: true, force: true });
        }
        for (const name of readDirSafe(seedDir)) {
          if (/^shot-\d+.*\.png$/.test(name) || name === 'saved-project.tar') {
            rmSync(join(seedDir, name), { force: true });
          }
        }
      }
    } else {
      writeFileSync(seqPath, JSON.stringify(seq, null, 2) + '\n', 'utf8');
    }

    await context.close();
  }

  return seq;
}

function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// known-failures.json
// ---------------------------------------------------------------------------

function knownFailuresPath() {
  return join(REPO_ROOT, 'frontend/e2e/discovery/known-failures.json');
}

function readKnownFailures() {
  const path = knownFailuresPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
  } catch (err) {
    throw new Error(`known-failures.json 解析失败（${path}）：${err?.message ?? err}`);
  }
}

function writeKnownFailures(seeds) {
  const path = knownFailuresPath();
  const normalized = [...new Set(seeds.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  assertTableMatchesImplementations();
  const args = parseArgs(process.argv);

  const seedsDir = args.outDir
    ? resolve(REPO_ROOT, args.outDir)
    : join(REPO_ROOT, '.scratch/discovery');
  mkdirSync(seedsDir, { recursive: true });

  // `--replay` 且没有显式给 seed 时，跑 known-failures 清单。
  const explicitSeeds = process.argv.slice(2).some((a) => a.startsWith('--seed=') || a.startsWith('--seeds='));
  let seeds;
  if (args.replay && !explicitSeeds) {
    seeds = readKnownFailures();
    if (!seeds.length) {
      process.stdout.write('known-failures.json 为空：没有需要重放的 seed。\n');
      return;
    }
  } else {
    seeds = expandSeeds(args.seedsSpec);
  }

  const baseUrl = `http://127.0.0.1:${args.port}`;
  let statusRes;
  try {
    statusRes = await fetch(`${baseUrl}/status`);
  } catch (err) {
    throw new Error(
      `连不上 ${baseUrl}/status（${err?.message ?? err}）。先起零状态后端：\n` +
        `  STRADITIZE_ZERO_PORT=${args.port} pixi run python support/serve_zero_backend.py`
    );
  }
  if (!statusRes.ok) {
    throw new Error(`后端 ${baseUrl}/status 返回 HTTP ${statusRes.status}；端口可能被别的服务占用`);
  }

  process.stdout.write(
    `Discovery lane：seed=${JSON.stringify(seeds)} steps=${args.steps} port=${args.port}` +
      `${args.replay ? ' replay=true' : ''}${args.keepArtifacts ? ' keep-artifacts=true' : ''}\n`
  );

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const seed of seeds) {
      const seqPath = join(seedsDir, String(seed), 'seq.json');
      let prevSeq = null;
      if (args.replay && existsSync(seqPath)) {
        try {
          prevSeq = JSON.parse(readFileSync(seqPath, 'utf8'));
        } catch {
          prevSeq = null;
        }
      }
      const seq = await runSeed({ seed, args, browser, baseUrl, seedsDir, prevSeq });
      results.push(seq);

      const steps = seq.actions.length;
      const verdict = seq.ok ? 'PASS' : `FAIL(${seq.failure?.code})`;
      process.stdout.write(
        `  seed ${String(seed).padStart(2)}  ${verdict.padEnd(18)} 步骤 ${String(steps).padStart(2)}/${args.steps}  ` +
          `状态 ${JSON.stringify(seq.statesVisited)}  终态 ${seq.finalState ?? '-'}\n`
      );
      if (!seq.ok && seq.failure) {
        process.stdout.write(`          ↳ ${seq.failure.message}\n`);
      }
      if (args.printActions) {
        process.stdout.write(
          `ACTIONS seed=${seed} ${JSON.stringify(seq.actions.map((a) => a.action))}\n`
        );
      }
      if (args.replay && prevSeq) {
        process.stdout.write(`          replayMatch=${seq.replayMatch}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  // 维护 known-failures 清单：失败的 seed 加入，通过的 seed 移除。
  const failing = results.filter((r) => !r.ok).map((r) => r.seed);
  const passing = new Set(results.filter((r) => r.ok).map((r) => r.seed));
  const merged = readKnownFailures().filter((s) => !passing.has(s)).concat(failing);
  const known = writeKnownFailures(merged);

  const okCount = results.filter((r) => r.ok).length;
  process.stdout.write(
    `\n合计：${results.length} 条序列，通过 ${okCount}，失败 ${results.length - okCount}。` +
      `known-failures.json = ${JSON.stringify(known)}\n`
  );

  // 有一条明确的状态覆盖报告，方便判断"这次到底走没走进深层状态"。
  const coverage = new Map(STATE_LIST.map((s) => [s, 0]));
  for (const seq of results) {
    for (const s of seq.statesVisited) coverage.set(s, (coverage.get(s) ?? 0) + 1);
  }
  process.stdout.write(
    `状态覆盖：${JSON.stringify(
      [...coverage.entries()].map(([s, n]) => `${s}:${n}`)
    )}\n`
  );

  if (failing.length) process.exitCode = 1;
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`\n[discovery] 致命错误：${err?.stack ?? err}\n`);
    process.exitCode = 2;
  });
}

export { mulberry32, parseArgs, expandSeeds, runSeed };
