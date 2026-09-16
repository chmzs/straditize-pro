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
          name: '选择与微调',
          shortcut: 'V',
          hint: '选择图元 / 拖动选中项 / 单击空白处取消选择',
          cursor: 'default',
        };
      case 'pan':
        return {
          name: '抓手平移',
          shortcut: 'H / Space',
          hint: '按住鼠标左键自由平移图谱视口',
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
          name: '添加分列线',
          shortcut: 'C',
          hint: '在画布点击插入新属种垂直分列基线',
          cursor: 'crosshair',
        };
      case 'addPoint':
        return {
          name: '添加控制拐点',
          shortcut: 'P',
          hint: '单击向当前激活属种插入强控制锚点 (自动吸附层位)',
          cursor: 'crosshair',
        };
      case 'eraser':
        return {
          name: '删除工具',
          shortcut: 'E',
          hint: '点击任意控制点或分列线直接删除',
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
