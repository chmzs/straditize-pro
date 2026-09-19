/**
 * 简体中文字典 —— 唯一事实源 (Single Source of Truth)
 *
 * 规则:
 *  1. 只放「给人看的界面文案」。科学数据（属种中文名、拉丁学名对照表）严禁进本文件。
 *  2. key 一律语义化 (域.用途)，严禁用中文原文当 key。
 *  3. 新增 key 后必须在 en.ts 同步补齐，否则 `npm run build` 的 tsc 会直接失败。
 */
export const zhCN = {
  // ===== 语言切换 =====
  'lang.badge': '中',
  'lang.switchTo': '切换到 English',

  // ===== JSON-RPC 2.0 标准错误码 =====
  'error.parse': '请求格式无法解析',
  'error.invalidRequest': '请求对象不合法',
  'error.methodNotFound': '后端不支持该接口',
  'error.invalidParams': '参数不合法',
  'error.internal': '后端内部错误',

  // ===== Straditize 业务错误码 =====
  'error.state': '会话状态异常（请先载入图谱）',
  'error.fileNotFound': '文件未找到',
  'error.calibration': '坐标标定缺失或无效',
  'error.export': '导出失败（格式或数据校验未通过）',
  'error.unknown': '未知错误',
} as const;

export type MessageKey = keyof typeof zhCN;
