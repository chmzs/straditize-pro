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

  // ===== Data provenance (never mask a failure with substitute data) =====
  'error.backendOffline': 'Backend not connected — real computation is unavailable. Start the backend or enter demo mode.',
  'error.backendLost': 'The backend connection was lost. This operation did not run and produced no data.',
  'error.demoUnsupported': 'This operation is not available in demo mode (demo mode is for UI preview only).',

  // ===== Data provenance banner =====
  'banner.backendOffline': 'Backend not connected — no real computation is possible',
  'banner.backendLost': 'Backend connection lost — reconnect to continue',
  'banner.demoMode': 'Demo mode — built-in sample data is shown; never use it for real analysis or export',
  'banner.reconnect': 'Reconnect',
  'banner.exitDemo': 'Exit demo mode',
  'banner.enterDemo': 'Enter demo mode',
} satisfies Record<MessageKey, string>;
