/**
 * JSON-RPC 错误码 → 本地化文案。
 *
 * 后端只返回数值 code + 英文 message；面向用户的叙述由这里按当前语言渲染，
 * 因此新增一门语言无需改动任何后端代码。
 * 技术细节（具体文件路径、堆栈摘要等）留在 console，避免把英文残句混进中文界面。
 */
import { t, type MessageKey } from './index';

export const RPC_ERROR_KEYS: Record<number, MessageKey> = {
  [-32700]: 'error.parse',
  [-32600]: 'error.invalidRequest',
  [-32601]: 'error.methodNotFound',
  [-32602]: 'error.invalidParams',
  [-32603]: 'error.internal',
  [-32001]: 'error.state',
  [-32002]: 'error.conflict',
  [-32003]: 'error.algorithm',
  [-32004]: 'error.fileError',
};

export function tError(code: number | string, detail?: string): string {
  const numeric = Number(code);
  const key = RPC_ERROR_KEYS[numeric];
  const base = key ? t(key) : t('error.unknown');
  const original = (detail ?? '').trim();
  if (!original) {
    return `${base} (code ${numeric})`;
  }
  // 后端的 `message` 是**一手信息**：具体到哪一列、哪个像素、缺了哪个前置条件。
  // 拿通用文案去覆盖它，用户只会看到"前置状态未就绪"这种无从下手的提示，
  // 开发者也只能靠猜（实测为此多花三轮才定位到列坐标错配）。
  // 所以：原文放首位，通用文案退化为括号里的类别标注。
  console.warn(`[RPC ${numeric}] ${original}`);
  return `${original}（${base}，code ${numeric}）`;
}
