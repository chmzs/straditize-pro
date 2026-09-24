import { DiagramData } from '../../types/pollen';

export interface StepContext {
  onDataChange: () => void;
  onAdvanceWorkflowStage?: (stage: number) => void;
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
