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

  // ===== 数据来源完整性（严禁用替代数据掩盖失败）=====
  'error.backendOffline': '后端未连接，无法进行真实计算。请启动后端或进入演示模式。',
  'error.backendLost': '与后端的连接已断开，本次操作未执行，未产生任何数据。',
  'error.demoUnsupported': '演示模式不支持该操作（演示模式仅用于界面预览）。',

  // ===== 数据来源横幅 =====
  'banner.backendOffline': '后端未连接 —— 当前无法进行任何真实计算',
  'banner.backendLost': '后端连接已断开 —— 请重连后再继续',
  'banner.demoMode': '演示模式 —— 当前显示的是内置示例数据，严禁用于正式分析或导出',
  'banner.reconnect': '重新连接',
  'banner.exitDemo': '退出演示模式',
  'banner.enterDemo': '进入演示模式',
} as const;

export type MessageKey = keyof typeof zhCN;
