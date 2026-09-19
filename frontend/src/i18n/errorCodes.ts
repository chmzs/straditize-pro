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
  [-32002]: 'error.fileNotFound',
  [-32003]: 'error.calibration',
  [-32004]: 'error.export',
};

export function tError(code: number | string, detail?: string): string {
  const numeric = Number(code);
  const key = RPC_ERROR_KEYS[numeric];
  const base = key ? t(key) : t('error.unknown');
  if (detail) {
    console.warn(`[RPC ${code}] ${detail}`);
  }
  return `${base} (code ${code})`;
}
