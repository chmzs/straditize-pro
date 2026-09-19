/**
 * 轻量 i18n 运行时 (无第三方依赖)。
 *
 * 设计要点:
 *  - 语言持久化在 localStorage，切换即生效，无需重启。
 *  - switchLocale() 会通知所有订阅者重新渲染各自的 DOM（组件持数据、DOM 是派生物）。
 *  - 缺 key 时回落中文，绝不抛异常、绝不显示空白。
 */
import { zhCN, type MessageKey } from './locales/zh-CN';
import { en } from './locales/en';

export type Locale = 'zh-CN' | 'en';
export type { MessageKey };

const DICTS: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
};

const STORAGE_KEY = 'straditize-locale';
const listeners: Array<(locale: Locale) => void> = [];

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {
    // 隐私模式下 localStorage 可能不可用，回落浏览器语言
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav && !nav.toLowerCase().startsWith('zh') ? 'en' : 'zh-CN';
}

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 取本地化文案。params 用于替换 {name} 占位符。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = DICTS[currentLocale][key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split('{' + name + '}').join(String(value));
    }
  }
  return text;
}

export function onLocaleChange(fn: (locale: Locale) => void): void {
  listeners.push(fn);
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 忽略存储异常，本次会话内仍然生效
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale);
  }
  for (const fn of listeners) fn(locale);
}

export function toggleLocale(): Locale {
  setLocale(currentLocale === 'zh-CN' ? 'en' : 'zh-CN');
  return currentLocale;
}

/** 应用启动时把 <html lang> 同步为当前语言 */
export function applyLocaleToDocument(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', currentLocale);
  }
}
