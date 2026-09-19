import type { MessageKey } from './zh-CN';

/**
 * English dictionary.
 * `satisfies Record<MessageKey, string>` makes any missing key a compile error,
 * so a new Chinese string can never ship without its English counterpart.
 */
export const en = {
  // ===== Locale switch =====
  'lang.badge': 'EN',
  'lang.switchTo': 'Switch to 中文',

  // ===== JSON-RPC 2.0 standard error codes =====
  'error.parse': 'Malformed request',
  'error.invalidRequest': 'Invalid request object',
  'error.methodNotFound': 'Unsupported backend method',
  'error.invalidParams': 'Invalid parameters',
  'error.internal': 'Backend internal error',

  // ===== Straditize domain error codes =====
  'error.state': 'Invalid session state (load a diagram first)',
  'error.fileNotFound': 'File not found',
  'error.calibration': 'Axis calibration missing or invalid',
  'error.export': 'Export failed (format or data validation error)',
  'error.unknown': 'Unknown error',
} satisfies Record<MessageKey, string>;
