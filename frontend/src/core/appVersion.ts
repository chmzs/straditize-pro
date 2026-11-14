/**
 * 应用版本的唯一事实源接入点 + 语义化版本比较。
 *
 * ## 版本号只有一处事实源：`frontend/package.json` 的 `version`
 *
 * `__APP_VERSION__` 由 `vite.config.ts` 在构建期读 package.json 后通过 `define`
 * 注入（构建产物里是字面量，开发模式由 vite 的 define 插件同样替换）。
 * 本文件**不保存任何版本字面量**，也不允许新增版本常量：历史上
 * `AboutModal` 写死过 `CURRENT_VERSION = '2.0.0'`，与 package.json 漂移到 2.0.5，
 * 后果不只是显示旧版本——更新检查拿它跟 GitHub tag 做字符串不等比较，
 * 于是 2.0.1–2.0.5 全部被判成"发现新版本"。
 *
 * 未注入时返回空串而不是任何猜测值：宁可显式说"读不到版本"，也不假装自己知道。
 */
declare const __APP_VERSION__: string;

/** 当前应用版本（如 `2.0.5`）；构建期未注入时为空串。 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'undefined' ? '' : __APP_VERSION__;

/** 把 `v2.0.10-beta.1` 拆成 `{ core: [2,0,10], pre: 'beta.1' }`。 */
function parseVersion(text: string): { core: number[]; pre: string } {
  const raw = String(text ?? '')
    .trim()
    .replace(/^[vV]/, '');
  const dash = raw.indexOf('-');
  const numbers = dash < 0 ? raw : raw.slice(0, dash);
  const pre = dash < 0 ? '' : raw.slice(dash + 1);
  const core = numbers.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  return { core, pre };
}

/**
 * 语义化版本三向比较：`a < b` 返回 -1，相等返回 0，`a > b` 返回 1。
 *
 * 只比较数字段（省略的末段按 0 处理），并让预发布版本低于同号正式版本
 * （`2.0.0-beta.1 < 2.0.0`）。**禁止**用字符串不等比较替代它：
 * `'2.0.10' < '2.0.9'` 在字典序下成立，那会把新版判成旧版。
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  const length = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.core[index] ?? 0;
    const r = right.core[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  // 数字段相同：有预发布后缀的一方更低（正式版高于自己的 beta）。
  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return left.pre > right.pre ? 1 : -1;
}
