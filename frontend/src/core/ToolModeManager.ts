import { ToolMode } from '../types/pollen';

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
          name: '选择与微调 (Adjust)',
          shortcut: 'S / V',
          hint: '选择图元 / 拖动微调控制点 (S) / 方向键 1px 精调',
          cursor: 'default',
        };
      case 'pan':
        return {
          name: '抓手平移 (Pan)',
          shortcut: 'H / 右键 / 空格',
          hint: '右键拖拽 / 中键拖拽 / 按住空格+左键平移图谱',
          cursor: 'grab',
        };
      case 'roi':
        return {
          name: 'ROI 矩形数据区',
          shortcut: 'R',
          hint: '拖拽 8 个恒定手柄微调地质数据有效区边界',
          cursor: 'crosshair',
        };
      case 'addCol':
        return {
          name: '添加属种列 (Column)',
          shortcut: 'C',
          hint: '在画布点击插入新属种垂直分列基线 (C)',
          cursor: 'crosshair',
        };
      case 'addPoint':
        return {
          name: '添加控制点 (Add Point)',
          shortcut: 'A',
          hint: '点击左键向当前属种插入控制锚点 (A)',
          cursor: 'crosshair',
        };
      case 'eraser':
        return {
          name: '删除控制点 (Delete Point)',
          shortcut: 'D',
          hint: '点击左键删除控制点或属种列 (D)',
          cursor: 'not-allowed',
        };
      default:
        return {
          name: '选择',
          shortcut: 'V',
          hint: '选择与微调',
          cursor: 'default',
        };
    }
  }
}
