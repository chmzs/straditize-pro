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
      default:
        return {
          name: t('tool.selectName'),
          shortcut: 'V',
          hint: t('tool.selectHint'),
          cursor: 'default',
        };
    }
  }
}
