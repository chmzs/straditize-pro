import { DiagramData } from '../../types/pollen';

export interface StepContext {
  onDataChange: () => void;
  onAdvanceWorkflowStage?: (stage: number) => void;
  /** 打开 OCR 复核模态。步骤 5 面板的【自动识别属种名】按钮用它。 */
  onOpenOcrReviewModal?: () => void;
  /** 步骤 6：两点式 X 轴（列标度）标定。像素取自列几何，用户只填两个读数。
   *  传原始字符串而非已解析数字：解析与报错统一在 main.ts（唯一错误出口）。 */
  onCalibrateXTicks?: (colIndex: number, val1Raw: string, val2Raw: string) => void;
  /** 步骤 6：清空该列的 X 标度，回到「未标定」。 */
  onClearXTicks?: (colIndex: number) => void;
  [key: string]: any;
}

export interface StepPanelModule {
  step: number;
  title?: string;
  render: (data: DiagramData) => string;
  mount: (root: HTMLElement, ctx: StepContext) => void;
}

// 自动扫描 steps 目录下的所有 *Panel.ts
const modules = import.meta.glob<StepPanelModule>('./*Panel.ts', { eager: true });

const stepRegistry = new Map<number, StepPanelModule>();

for (const path in modules) {
  const mod = modules[path];
  if (typeof mod.step === 'number' && typeof mod.render === 'function' && typeof mod.mount === 'function') {
    stepRegistry.set(mod.step, mod);
  }
}

export function getStepPanel(step: number): StepPanelModule | undefined {
  return stepRegistry.get(step);
}

export function getAllStepPanels(): StepPanelModule[] {
  return Array.from(stepRegistry.values());
}
