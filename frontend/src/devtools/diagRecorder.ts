/**
 * 开发模式诊断记录器（最小版）——记录一次真实用户操作的因果链，并一键导出 ZIP。
 *
 * ## 挂载方式
 *
 * `main.ts` 的 bootstrap 第一行调用 `installDiagRecorder()`，本模块自行决定是否启用：
 *
 * - `location.search` 含 `diag=1`，或
 * - `localStorage.getItem('straditize.diag') === '1'`
 *
 * 未启用时只挂一个 `window.__straditizeDiag = { enabled: false, export: 抛错 }`，
 * 不监听任何事件、不包装任何全局函数——生产路径零开销、零行为变化。
 *
 * ## 为什么用「包装 window.fetch」而不是改 RpcClient
 *
 * RPC 是唯一的后端往返通道，`RpcClient.call()` 最终都落到 `fetch(this.endpoint, ...)`。
 * 包装 fetch 能拿到**真实发出的 method + params + 真实返回体**，且：
 *
 * 1. 不需要在 `RpcClient` 里插桩（不改任何现有代码路径）；
 * 2. 包装前后返回的 Promise 与 Response 对象完全同一份（`return origFetch(...)`），
 *    调用方拿到的语义不变；
 * 3. 只有 URL 命中 `/rpc` 且方法为 POST 时才记录，其余请求原样放行。
 *
 * ## 隐私边界（硬性）
 *
 * - 不记录图片正文、不记录项目文件内容；
 * - 参数里的路径类值一律脱敏为 `<redacted:basename>`，只留 basename；
 * - 字符串超过 200 字符截断并标记 `…(truncated)`；
 * - 本模块**没有任何网络出口**：所有数据只进内存缓冲，导出时序列化成 ZIP 交由
 *   用户的浏览器下载。图片 URL 里的 `auth` 查询串在进缓冲前就被剥掉。
 */

import { buildStoreZip, type ZipEntry } from './zipStore';

/** 后端权威状态摘要（`straditize.getDiagramData` 的关键子集，不含任何像素/文件内容）。 */
export interface DiagStateSummary {
  capturedAt: string;
  image: { present: boolean; width: number; height: number; srcBase: string };
  rois: Array<{
    id: string | null;
    name: string | null;
    visible: unknown;
    xlim: unknown;
    ylim: unknown;
  }>;
  primary_roi_id: string | null;
  active_roi_id: string | null;
  calibration: {
    isCalibrated: unknown;
    top_px: unknown;
    top_cm: unknown;
    bottom_px: unknown;
    bottom_cm: unknown;
    unit: unknown;
  };
  columns: { count: number; ids: Array<string | null> };
  samples: { count: number };
  line_candidates: { count: number };
  line_strokes: { count: number };
  exclusion_regions: { count: number };
}

interface DiagActionRecord {
  seq: number;
  timestamp: string;
  stage: number | null;
  action: Record<string, unknown>;
  stateBefore: DiagStateSummary | null;
  stateAfter: DiagStateSummary | null;
  consoleError: string | null;
}

interface DiagRpcRecord {
  seq: number;
  timestamp: string;
  stage: number | null;
  rpc: {
    method: string;
    params: unknown;
    code: number | null;
    durationMs: number;
    transportError?: string;
  };
  stateBefore: DiagStateSummary | null;
  stateAfter: DiagStateSummary | null;
  consoleError: string | null;
}

interface DiagConsoleRecord {
  seq: number;
  timestamp: string;
  stage: number | null;
  kind: 'console.error' | 'window.error' | 'unhandledrejection';
  message: string;
  stack: string | null;
}

export interface DiagExportOptions {
  /** 显式附带项目归档与原图（默认 false）。 */
  includeProject?: boolean;
  /** 是否触发浏览器下载（默认 true）。自动化验证可置 false 只取 base64。 */
  download?: boolean;
}

export interface DiagExportResult {
  filename: string;
  byteLength: number;
  base64: string;
  entries: Array<{ name: string; size: number }>;
}

const ENABLED_KEY = 'straditize.diag';
/** 单缓冲区上限，防止长时间开着诊断把内存吃满。 */
const MAX_RECORDS = 5000;
/** 参数摘要里字符串的最大长度。 */
const MAX_STRING = 200;
/** 状态快照里图的 src 只留文件名，查询串（含 auth token）一律丢弃。 */
/** 路径类键：只保留 basename（`C:\a\b\hoya.png` → `<redacted:hoya.png>`）。 */
const PATH_KEY_PATTERN = /(path|file|dir|folder)/i;
/** 凭据类键：整体抹掉，连 basename 都不留。 */
const SECRET_KEY_PATTERN = /(token|password|passwd|secret|user|auth|cookie)/i;
/**
 * 二进制正文类键：**必须**抹掉。
 *
 * 实测教训：`core.loadImage` 的参数里带 `image_data: "data:image/png;base64,…"`，
 * 只靠 200 字符截断仍会把 PNG 的头几百字节写进报告——这直接违反「不记录图片正文」。
 */
const BLOB_KEY_PATTERN = /(image_?data|base64|data_?url|binary|blob|bytes|content|payload|pixels?)/i;

function isEnabled(): boolean {
  try {
    if (typeof location !== 'undefined' && /(?:^|[?&])diag=1(?:&|$)/.test(location.search)) {
      return true;
    }
    return typeof localStorage !== 'undefined' && localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function basenameOf(raw: string): string {
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((segment) => segment.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function truncateString(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(truncated)` : value;
}

function redactValue(kind: 'path' | 'secret' | 'blob', value: unknown): string {
  if (kind === 'blob') {
    const length =
      typeof value === 'string'
        ? value.length
        : typeof Blob !== 'undefined' && value instanceof Blob
          ? value.size
          : null;
    return length === null ? '<redacted:binary>' : `<redacted:binary(${length})>`;
  }
  if (kind === 'secret') return '<redacted>';
  const asString = typeof value === 'string' ? value : '';
  const base = basenameOf(asString) || asString;
  return base ? `<redacted:${truncateString(base)}>` : '<redacted>';
}

/**
 * 参数摘要：深度 4、数组 20 项、字符串 200 字符，键名命中敏感词一律脱敏。
 *
 * 这条路径是隐私边界的唯一闸门，因此对 `File` / `Blob` 这类不可序列化值也显式
 * 降级成描述字符串，绝不 `JSON.stringify` 一个可能很大的二进制对象。
 */
function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '<function>';
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return `<blob:${value.size}B>`;
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    return `<file:${truncateString(value.name)}>`;
  }
  if (depth >= 4) return '<max-depth>';
  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((item) => sanitizeForLog(item, depth + 1));
    if (value.length > 20) head.push(`…(${value.length - 20} more)`);
    return head;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (BLOB_KEY_PATTERN.test(key)) {
        out[key] = redactValue('blob', item);
      } else if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = redactValue('secret', item);
      } else if (PATH_KEY_PATTERN.test(key)) {
        out[key] = redactValue('path', item);
      } else {
        out[key] = sanitizeForLog(item, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function imageSrcToBasename(src: unknown): string {
  if (typeof src !== 'string' || src.length === 0) return '';
  const withoutQuery = src.split('?')[0].split('#')[0];
  return truncateString(basenameOf(withoutQuery) || withoutQuery);
}

/** 从 `straditize.getDiagramData` 的原始返回里取关键子集。 */
function summarizeDiagram(raw: unknown): DiagStateSummary {
  const data = (raw ?? {}) as Record<string, any>;
  const rois = Array.isArray(data.rois) ? data.rois : [];
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const calibration = (data.calibration ?? {}) as Record<string, unknown>;
  const countOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);

  return {
    capturedAt: new Date().toISOString(),
    image: {
      present: Boolean(data.imageSrc),
      width: Number(data.imageWidth ?? 0),
      height: Number(data.imageHeight ?? 0),
      srcBase: imageSrcToBasename(data.imageSrc),
    },
    rois: rois.map((roi: any) => ({
      id: roi?.id ?? null,
      name: roi?.name ?? null,
      visible: roi?.visible ?? null,
      xlim: roi?.xlim ?? null,
      ylim: roi?.ylim ?? null,
    })),
    primary_roi_id: data.primary_roi_id ?? data.primaryRoiId ?? null,
    active_roi_id: data.active_roi_id ?? data.activeRoiId ?? null,
    calibration: {
      isCalibrated: calibration.isCalibrated ?? null,
      top_px: calibration.top_px ?? null,
      top_cm: calibration.top_cm ?? null,
      bottom_px: calibration.bottom_px ?? null,
      bottom_cm: calibration.bottom_cm ?? null,
      unit: calibration.unit ?? null,
    },
    columns: {
      count: columns.length,
      ids: columns.slice(0, 40).map((column: any) => column?.id ?? column?.name ?? null),
    },
    samples: { count: countOf(data.samples) },
    line_candidates: { count: countOf(data.line_candidates) },
    line_strokes: { count: countOf(data.line_strokes) },
    exclusion_regions: { count: countOf(data.exclusion_regions) },
  };
}

/** 当前工作流阶段：直接读工作流条上的步骤号，避免触碰 `__straditize.getState()`（它会触发重绘）。 */
function readStage(): number | null {
  try {
    const el = document.querySelector('.workflow-action-bar__step');
    const text = el?.textContent?.trim() ?? '';
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function describeTarget(target: EventTarget | null): Record<string, unknown> | null {
  if (!(target instanceof Element)) return null;
  const el = target as HTMLElement;
  const info: Record<string, unknown> = {
    tag: el.tagName,
    id: el.id || null,
    classes: el.className && typeof el.className === 'string' ? truncateString(el.className) : null,
    text: truncateString((el.textContent ?? '').trim().slice(0, 80)),
  };
  if (el.dataset && Object.keys(el.dataset).length > 0) {
    info.dataset = sanitizeForLog(el.dataset);
  }
  info.selector = buildShortSelector(el);
  return info;
}

/** 生成一个短而可读的选择器（最多爬到 4 层）。 */
function buildShortSelector(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 4 && current !== document.body) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segments.unshift(`#${current.id}`);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
      if (sameTag.length > 1) {
        segment += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
    }
    segments.unshift(segment);
    current = current.parentElement;
    depth += 1;
  }
  return segments.join(' > ');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

interface EnvironmentSnapshot {
  app: {
    version: string | null;
    commit: string | null;
    commitSource: string;
    service: string | null;
  };
  userAgent: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  screen: { width: number; height: number; availWidth: number; availHeight: number; colorDepth: number };
  locale: string;
  language: string;
  url: { origin: string; pathname: string; diagViaQuery: boolean };
  startedAt: string;
  exportedAt: string;
  recordCounts: { actions: number; rpc: number; console: number };
  stateCapture: { mode: string; perActionDeltas: false; reason: string };
  screenshot: { ok: boolean; error?: string };
  project: { included: boolean; reason: string };
  privacy: {
    imageBytesRecorded: false;
    projectFilesRecorded: boolean;
    absolutePathsRecorded: false;
    redaction: string;
  };
}

let installed = false;

/** 安装诊断记录器。未启用时只挂一个显式禁用的占位对象，不包装任何全局函数。 */
export function installDiagRecorder(): void {
  if (installed) return;
  installed = true;

  if (!isEnabled()) {
    (window as unknown as Record<string, unknown>).__straditizeDiag = {
      enabled: false,
      export: () => {
        throw new Error(
          `诊断记录器未启用：请用 ?diag=1 打开页面，或执行 localStorage.setItem('${ENABLED_KEY}','1') 后刷新`,
        );
      },
    };
    return;
  }

  const startedAt = new Date().toISOString();
  const actions: DiagActionRecord[] = [];
  const rpcs: DiagRpcRecord[] = [];
  const consoles: DiagConsoleRecord[] = [];

  let seq = 0;
  const nextSeq = () => ++seq;
  /** 记录器自己发起的 JSON-RPC id 段，避开前端 RpcClient 的递增 id 区间。 */
  let diagRequestId = 900000;

  let firstState: DiagStateSummary | null = null;
  let latestState: DiagStateSummary | null = null;
  /** 最近一条还在等「动作落地后的状态」的动作记录。 */
  let pendingAction: DiagActionRecord | null = null;
  /** 最近一条还在等「RPC 之后的状态」的 RPC 记录。 */
  let pendingRpc: DiagRpcRecord | null = null;
  let lastConsoleError: string | null = null;
  let appVersion: string | null = null;
  let serviceName: string | null = null;

  const push = <T extends { seq: number }>(bucket: T[], record: T) => {
    bucket.push(record);
    if (bucket.length > MAX_RECORDS) bucket.splice(0, bucket.length - MAX_RECORDS);
  };

  const noteState = (summary: DiagStateSummary) => {
    if (!firstState) firstState = summary;
    latestState = summary;
    if (pendingAction) {
      pendingAction.stateAfter = summary;
      pendingAction = null;
    }
    if (pendingRpc) {
      pendingRpc.stateAfter = summary;
      pendingRpc = null;
    }
  };

  // ---- 会话环境：只取一次（version / service 来自同源 GET /status，不发任何业务数据） ----
  void (async () => {
    try {
      const res = await fetch('/status', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const payload = (await res.json()) as Record<string, unknown>;
        appVersion = typeof payload.version === 'string' ? payload.version : null;
        serviceName = typeof payload.service === 'string' ? payload.service : null;
      }
    } catch {
      // 版本号取不到就是取不到，不编造。
    }
  })();

  // ---- 1. RPC 往返：包装 window.fetch ----
  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isRpcCall =
      typeof url === 'string' && /\/rpc(?:$|[?#])/.test(url) && (init?.method ?? '').toUpperCase() === 'POST';

    if (!isRpcCall) return originalFetch(input, init);

    let method = '<unknown>';
    let params: unknown = null;
    try {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      if (bodyText) {
        const payload = JSON.parse(bodyText) as Record<string, unknown>;
        method = typeof payload.method === 'string' ? payload.method : '<unknown>';
        params = payload.params ?? null;
      }
    } catch {
      // 请求体不是 JSON：记录方法名为 unknown，不阻断请求。
    }

    const recordSeq = nextSeq();
    const startedAtMs = performance.now();
    const stateBefore = latestState;
    const stage = readStage();

    const promise = originalFetch(input, init);

    void promise
      .then(async (response) => {
        let code: number | null = null;
        let summary: DiagStateSummary | null = null;
        try {
          const clone = response.clone();
          const payload = (await clone.json()) as Record<string, any>;
          if (payload && typeof payload === 'object' && payload.error) {
            code = typeof payload.error.code === 'number' ? payload.error.code : -1;
          } else {
            code = 0;
          }
          if (method === 'straditize.getDiagramData' && payload?.result) {
            summary = summarizeDiagram(payload.result);
          }
        } catch {
          code = null;
        }

        const record: DiagRpcRecord = {
          seq: recordSeq,
          timestamp: new Date().toISOString(),
          stage,
          rpc: {
            method,
            params: sanitizeForLog(params),
            code,
            durationMs: Math.round((performance.now() - startedAtMs) * 10) / 10,
          },
          stateBefore,
          stateAfter: summary,
          consoleError: lastConsoleError,
        };
        push(rpcs, record);
        if (summary) noteState(summary);
        else pendingRpc = record;
      })
      .catch((err: unknown) => {
        push(rpcs, {
          seq: recordSeq,
          timestamp: new Date().toISOString(),
          stage,
          rpc: {
            method,
            params: sanitizeForLog(params),
            code: null,
            durationMs: Math.round((performance.now() - startedAtMs) * 10) / 10,
            transportError: truncateString(err instanceof Error ? err.message : String(err)),
          },
          stateBefore,
          stateAfter: null,
          consoleError: lastConsoleError,
        });
      });

    return promise;
  } as typeof window.fetch;

  /**
   * 显式拉一次后端权威状态。
   *
   * 为什么需要：前端并不是每个动作后都调 `straditize.getDiagramData`（多数动作走的是
   * 定向 RPC + 局部状态更新），所以纯被动快照会一直停在启动那一刻——实测导出的
   * `state-after.json` 写着 `image.present:false`，而那一刻图早就载入了。这种报告
   * 比没有更糟：它会把人引向完全错误的结论。
   *
   * 这一跳是**真实往返**，同样会被上面的 fetch 包装记录进 `rpc.jsonl`，不伪造。
   */
  const captureStateNow = async (): Promise<DiagStateSummary | null> => {
    try {
      const res = await window.fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++diagRequestId,
          method: 'straditize.getDiagramData',
        }),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as Record<string, any>;
      if (payload?.error) return null;
      return summarizeDiagram(payload?.result);
    } catch {
      return null;
    }
  };

  // ---- 2. 用户动作：捕获阶段监听，绝不 preventDefault / stopPropagation ----
  const recordAction = (type: string, extra: Record<string, unknown>) => {
    const record: DiagActionRecord = {
      seq: nextSeq(),
      timestamp: new Date().toISOString(),
      stage: readStage(),
      action: { type, ...extra },
      stateBefore: latestState,
      stateAfter: null,
      consoleError: lastConsoleError,
    };
    push(actions, record);
    pendingAction = record;
  };

  const canvasCoords = (ev: MouseEvent): Record<string, unknown> | null => {
    const canvas = document.getElementById('geology-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (
      ev.clientX < rect.left ||
      ev.clientX > rect.right ||
      ev.clientY < rect.top ||
      ev.clientY > rect.bottom
    ) {
      return null;
    }
    return {
      canvasX: Math.round(ev.clientX - rect.left),
      canvasY: Math.round(ev.clientY - rect.top),
      canvasWidth: Math.round(rect.width),
      canvasHeight: Math.round(rect.height),
    };
  };

  document.addEventListener(
    'pointerdown',
    (ev) => {
      const coords = canvasCoords(ev);
      recordAction('pointerdown', {
        target: describeTarget(ev.target),
        clientX: Math.round(ev.clientX),
        clientY: Math.round(ev.clientY),
        button: ev.button,
        ...(coords ?? {}),
      });
    },
    true,
  );

  document.addEventListener(
    'click',
    (ev) => {
      recordAction('click', {
        target: describeTarget(ev.target),
        clientX: Math.round(ev.clientX),
        clientY: Math.round(ev.clientY),
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (ev) => {
      recordAction('keydown', {
        key: ev.key,
        code: ev.code,
        ctrl: ev.ctrlKey,
        shift: ev.shiftKey,
        alt: ev.altKey,
        meta: ev.metaKey,
        target: describeTarget(ev.target),
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (ev) => {
      recordAction('change', {
        target: describeTarget(ev.target),
        // 只记值的长度与类型，不记内容：输入框可能是用户私密文本。
        valueKind: typeof (ev.target as HTMLInputElement)?.value === 'string' ? 'string' : null,
        valueLength:
          typeof (ev.target as HTMLInputElement)?.value === 'string'
            ? (ev.target as HTMLInputElement).value.length
            : null,
      });
    },
    true,
  );

  // ---- 3. 控制台错误 ----
  const originalConsoleError = console.error.bind(console);
  console.error = function patchedConsoleError(...args: unknown[]) {
    try {
      const message = truncateString(
        args
          .map((arg) => {
            if (arg instanceof Error) return arg.message;
            if (typeof arg === 'string') return arg;
            return safeStringify(arg);
          })
          .join(' '),
      );
      const stack = args.find((arg): arg is Error => arg instanceof Error)?.stack ?? null;
      lastConsoleError = message;
      push(consoles, {
        seq: nextSeq(),
        timestamp: new Date().toISOString(),
        stage: readStage(),
        kind: 'console.error',
        message,
        stack: stack ? truncateString(stack) : null,
      });
    } catch {
      // 记录失败不能影响原调用。
    }
    return originalConsoleError(...args);
  };

  window.addEventListener('error', (ev) => {
    push(consoles, {
      seq: nextSeq(),
      timestamp: new Date().toISOString(),
      stage: readStage(),
      kind: 'window.error',
      message: truncateString(ev.message || 'window error'),
      stack: ev.error instanceof Error ? truncateString(ev.error.stack ?? '') : null,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    push(consoles, {
      seq: nextSeq(),
      timestamp: new Date().toISOString(),
      stage: readStage(),
      kind: 'unhandledrejection',
      message: truncateString(reason instanceof Error ? reason.message : String(reason)),
      stack: reason instanceof Error ? truncateString(reason.stack ?? '') : null,
    });
  });

  // ---- 4. 用户可见通知：观察 toast 宿主，而不是去改 feedback.ts ----
  try {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (!node.classList.contains('ui-toast')) continue;
          const level =
            Array.from(node.classList)
              .find((cls) => cls.startsWith('ui-toast--'))
              ?.replace('ui-toast--', '') ?? 'info';
          recordAction('notify', {
            text: truncateString((node.textContent ?? '').trim()),
            level,
          });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    // 观察器装不上就只是记不到通知，不阻断。
  }

  // ---- 5. 截图 ----
  const captureScreenshot = (): { ok: true; bytes: Uint8Array } | { ok: false; error: string } => {
    try {
      const canvas = document.getElementById('geology-canvas') as HTMLCanvasElement | null;
      if (!canvas) return { ok: false, error: 'geology-canvas 元素不存在' };
      const dataUrl = canvas.toDataURL('image/png');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return { ok: false, error: 'toDataURL 返回了非 data URL' };
      return { ok: true, bytes: base64ToBytes(dataUrl.slice(comma + 1)) };
    } catch (err) {
      // 画布被跨源图像污染等情况下 toDataURL 会抛 SecurityError：如实记录，不伪造。
      return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    }
  };

  // ---- 6. 导出 ----
  const buildEnvironment = (
    includeProject: boolean,
    screenshot: { ok: boolean; error?: string },
  ): EnvironmentSnapshot => {
    const projectReason = includeProject
      ? '本最小版本没有暴露「取项目归档字节」的后端通道；如需附带，请设置 window.__straditizeDiag.projectProvider（返回 Uint8Array 的异步函数）'
      : '默认不含项目内容与原图（隐私边界）；仅 export({includeProject:true}) 才会尝试附带';
    return {
      app: {
        version: appVersion,
        commit: null,
        commitSource: '页面与 /status 均未暴露 commit；不猜值',
        service: serviceName,
      },
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
      },
      locale: navigator.language,
      language: navigator.languages?.join(',') ?? navigator.language,
      url: {
        origin: location.origin,
        pathname: location.pathname,
        diagViaQuery: /(?:^|[?&])diag=1(?:&|$)/.test(location.search),
      },
      startedAt,
      exportedAt: new Date().toISOString(),
      recordCounts: { actions: actions.length, rpc: rpcs.length, console: consoles.length },
      stateCapture: {
        mode:
          '被动快照（应用自己调 straditize.getDiagramData 时取）+ 导出前一次显式真实往返',
        perActionDeltas: false,
        reason:
          '前端多数动作只发定向 RPC 并局部更新本地状态，不会重新拉整份 DiagramData；' +
          '记录器不主动在每个动作后注入 RPC（那会改变真实时序），因此逐动作的 stateAfter ' +
          '只在应用恰好重取时才有值，否则为 null。state-before.json = 会话第一份快照，' +
          'state-after.json = 导出瞬间的真实快照。',
      },
      screenshot,
      project: { included: false, reason: projectReason },
      privacy: {
        imageBytesRecorded: false,
        projectFilesRecorded: false,
        absolutePathsRecorded: false,
        redaction:
          '路径类键(path|file|dir|folder) → <redacted:basename>；凭据类键(token|password|secret|user|auth|cookie) → <redacted>；' +
          '二进制类键(image_data|base64|data_url|binary|blob|bytes|content|payload|pixels) → <redacted:binary(N)>；' +
          '普通字符串 >200 字符截断并标 …(truncated)',
      },
    };
  };

  const exportReport = async (options: DiagExportOptions = {}): Promise<DiagExportResult> => {
    const includeProject = options.includeProject === true;

    // 导出前显式补一次真实往返，让 state-after.json 是"现在的后端状态"而不是"启动时"。
    const finalState = await captureStateNow();
    if (finalState) noteState(finalState);
    // 上面这次往返的记录是在 fetch 包装的 `.then` 里异步落盘的（不阻塞调用方）。
    // 不等它一拍，就会出现「state-after.json 有内容但 rpc.jsonl 里没有对应那一跳」，
    // 读报告的人会以为状态是凭空来的。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const shot = captureScreenshot();

    const encoder = new TextEncoder();
    const jsonl = (rows: unknown[]) => encoder.encode(rows.map((row) => safeStringify(row)).join('\n') + (rows.length ? '\n' : ''));
    const orderedRpc = [...rpcs].sort((a, b) => a.seq - b.seq);
    const orderedActions = [...actions].sort((a, b) => a.seq - b.seq);
    const orderedConsole = [...consoles].sort((a, b) => a.seq - b.seq);

    const environment = buildEnvironment(includeProject, {
      ok: shot.ok,
      ...(shot.ok ? {} : { error: shot.error }),
    });

    const entries: ZipEntry[] = [
      { name: 'actions.jsonl', data: jsonl(orderedActions) },
      { name: 'rpc.jsonl', data: jsonl(orderedRpc) },
      { name: 'console.jsonl', data: jsonl(orderedConsole) },
      {
        name: 'state-before.json',
        data: encoder.encode(JSON.stringify(firstState ?? latestState, null, 2)),
      },
      {
        name: 'state-after.json',
        data: encoder.encode(JSON.stringify(latestState, null, 2)),
      },
      {
        name: 'environment.json',
        data: encoder.encode(JSON.stringify(environment, null, 2)),
      },
    ];

    if (shot.ok) {
      entries.push({ name: 'screenshot.png', data: shot.bytes });
    }

    if (includeProject) {
      const provider = (window as any).__straditizeDiag?.projectProvider;
      if (typeof provider === 'function') {
        try {
          const archive = (await provider()) as Uint8Array;
          if (archive instanceof Uint8Array && archive.length > 0) {
            entries.push({ name: 'project.tar', data: archive });
            environment.project = { included: true, reason: '由 window.__straditizeDiag.projectProvider 提供' };
          }
        } catch (err) {
          void err;
        }
      }
    }

    // environment.json 必须在 project 状态定稿后重写一次。
    const envIndex = entries.findIndex((entry) => entry.name === 'environment.json');
    entries[envIndex] = {
      name: 'environment.json',
      data: encoder.encode(JSON.stringify(environment, null, 2)),
    };

    const zipBytes = buildStoreZip(entries, new Date());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
    const filename = `bug-report-${stamp}.zip`;

    if (options.download !== false) {
      try {
        // TS 的 Uint8Array<ArrayBufferLike> 与 BlobPart 要求的 ArrayBuffer 视图互不兼容；
        // 这里的底层缓冲一定是 zipStore 里 new 出来的 ArrayBuffer，直接窄化即可。
        const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        console.warn('[diag] 触发下载失败（zip 已生成，可用 base64 取回）:', err);
      }
    }

    return {
      filename,
      byteLength: zipBytes.length,
      base64: bytesToBase64(zipBytes),
      entries: entries.map((entry) => ({ name: entry.name, size: entry.data.length })),
    };
  };

  (window as unknown as Record<string, unknown>).__straditizeDiag = {
    enabled: true,
    export: exportReport,
    /** 只读调试入口：看缓冲里已有多少条，避免到处打 console。 */
    stats: () => ({ actions: actions.length, rpc: rpcs.length, console: consoles.length }),
  };

  console.info('[diag] 诊断记录器已启用（?diag=1）。导出：window.__straditizeDiag.export()');
}
