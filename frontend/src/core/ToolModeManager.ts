import { ToolMode } from '../types/pollen';
import { t } from '../i18n';

export class ToolModeManager {
  private currentMode: ToolMode = 'select';
  private listeners: Array<(mode: ToolMode) => void> = [];

  constructor(initialMode: ToolMode = 'select') {
    this.currentMode = initialMode;
  }

  public getMode(): ToolMode {
    return this.currentMode;
  }

  public setMode(mode: ToolMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.notify();
  }

  public onModeChange(fn: (mode: ToolMode) => void): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn(this.currentMode);
    }
  }

  public getToolDescription(mode: ToolMode = this.currentMode): { name: string; shortcut: string; hint: string; cursor: string } {
    switch (mode) {
      case 'select':
        return {
          name: t('tool.selectName'),
          shortcut: t('tool.selectShortcut'),
          hint: t('tool.selectHint'),
          cursor: 'default',
        };
      case 'pan':
        return {
          name: t('tool.panName'),
          shortcut: t('tool.panShortcut'),
          hint: t('tool.panHint'),
          cursor: 'grab',
        };
      case 'roi':
        return {
          name: t('tool.roiName'),
          shortcut: t('tool.roiShortcut'),
          hint: t('tool.roiHint'),
          cursor: 'crosshair',
        };
      case 'addCol':
        return {
          name: t('tool.addColName'),
          shortcut: t('tool.addColShortcut'),
          hint: t('tool.addColHint'),
          cursor: 'crosshair',
        };
      case 'addPoint':
        return {
          name: t('tool.addPointName'),
          shortcut: t('tool.addPointShortcut'),
          hint: t('tool.addPointHint'),
          cursor: 'crosshair',
        };
      case 'eraser':
        return {
          name: t('tool.eraserName'),
          shortcut: t('tool.eraserShortcut'),
          hint: t('tool.eraserHint'),
          cursor: 'not-allowed',
        };
      case 'ycalib':
        return {
          name: t('tool.ycalibName'),
          shortcut: t('tool.ycalibShortcut'),
          hint: t('tool.ycalibHint'),
          cursor: 'crosshair',
        };
      case 'linefix':
        return {
          name: t('tool.linefixName'),
          shortcut: t('tool.linefixShortcut'),
          hint: t('tool.linefixHint'),
          cursor: 'crosshair',
        };
      case 'measure':
        return {
          name: t('tool.measureName'),
          shortcut: t('tool.measureShortcut'),
          hint: t('tool.measureHint'),
          cursor: 'crosshair',
        };
      case 'pickTick':
        return {
          name: t('tool.pickTickName'),
          shortcut: t('tool.pickTickShortcut'),
          hint: t('tool.pickTickHint'),
          cursor: 'crosshair',
        };
      case 'drawLineH':
        return {
          name: t('tool.drawLineHName'),
          shortcut: t('tool.drawLineHShortcut'),
          hint: t('tool.drawLineHHint'),
          cursor: 'crosshair',
        };
      case 'drawLineV':
        return {
          name: t('tool.drawLineVName'),
          shortcut: t('tool.drawLineVShortcut'),
          hint: t('tool.drawLineVHint'),
          cursor: 'crosshair',
        };
      default: {
        // 兜底分支以前直接返回「选择与微调 (V)」，于是任何漏写的模式（`pickTick`
        // 就是这么被漏掉的）都会让页脚宣称用户在 select 模式 —— 指令与状态相反。
        // 改成编译期强制：新增 ToolMode 却没写描述时 `mode` 不是 never，这里过不了
        // 类型检查（`npm --prefix frontend run build` 即报错）；万一运行期真的走到，
        // 也如实报出模式名而不是冒充 select。
        const unhandled: never = mode;
        return {
          name: String(unhandled),
          shortcut: '?',
          hint: '',
          cursor: 'default',
        };
      }
    }
  }
}
