/**
 * 导出下载的公共契约：**拿不到 base64 就报错，绝不静默跳过**。
 *
 * 历史缺陷：ExportModal 里两处 if (res && res.base64) { ...下载... } 没有 else，
 * 而后端 export.exportLipd 从不返回 base64 —— 用户点「LiPD」既不下载、也不报错。
 * 静默跳过违反仓库不变量（失败必须冒泡），故把判定收成一个会抛错的函数，
 * 并让错误消息带上后端实际返回的键名，便于下一次一眼定位契约漂移。
 */

export interface ExportPayloadLike {
  base64?: unknown;
  output_path?: unknown;
  [key: string]: unknown;
}

/** 取出 base64；没有就抛错（消息里列出实际键名）。 */
export function requireExportBase64(res: unknown, label: string): string {
  if (!res || typeof res !== 'object') {
    throw new Error(label + '：后端返回的不是对象（实际：' + String(res) + '）');
  }
  const payload = res as ExportPayloadLike;
  const base64 = payload.base64;
  if (typeof base64 !== 'string' || base64.length === 0) {
    const keys = Object.keys(payload).sort().join(', ');
    const hint = payload.output_path
      ? '；后端写到了 ' + String(payload.output_path) + '（写盘模式不该走浏览器下载）'
      : '';
    throw new Error(
      label + '：后端未返回 base64，无法下载（实际返回键：' + (keys || '空') + '）' + hint
    );
  }
  return base64;
}

/** base64 -> Blob（浏览器下载用）。 */
export function base64ToBlob(base64: string, mime: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array<number>(byteCharacters.length);
  for (let index = 0; index < byteCharacters.length; index++) {
    byteNumbers[index] = byteCharacters.charCodeAt(index);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

/** 触发一次浏览器下载。 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
