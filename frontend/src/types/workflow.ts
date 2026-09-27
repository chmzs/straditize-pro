/**
 * Straditize Pro v2.0 Workflow State Machine
 *
 * 严格按照 8 步工作流规范重构（设计稿 §1 / 契约 v1.3）：
 * 1.载入 -> 2.ROI -> 3.Y标定 -> 4.清理 -> 5.分列 -> 6.标定列 -> 7.拐点与采样 -> 8.校验
 * （删导出阶段；导出统一由顶栏总出口承担）
 */

import { t, MessageKey } from '../i18n';

export type WorkflowStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface WorkflowStageMeta {
  stage: WorkflowStage;
  title: string;
  stepName: string;
  guideText: string;
  primaryActionLabel: string | null;
}

export function getWorkflowStageMeta(stage: WorkflowStage): WorkflowStageMeta {
  return {
    stage,
    title: `${stage}. ${t(`workflow.name${stage}` as MessageKey)}`,
    stepName: t(`workflow.step${stage}` as MessageKey),
    guideText: t(`workflow.guide${stage}` as MessageKey),
    primaryActionLabel: t(`workflow.action${stage}` as MessageKey) || null,
  };
}

export function getWorkflowStepItems(): Array<{ step: number; label: string; name: string }> {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({
    step: s,
    label: t(`workflow.step${s}` as MessageKey),
    name: t(`workflow.name${s}` as MessageKey),
  }));
}

export const WORKFLOW_STAGES: Record<WorkflowStage, WorkflowStageMeta> = new Proxy({} as any, {
  get(_target, prop) {
    const stageNum = parseInt(String(prop), 10);
    if (stageNum >= 1 && stageNum <= 8) {
      return getWorkflowStageMeta(stageNum as WorkflowStage);
    }
    return undefined;
  },
});

export const WORKFLOW_STEP_ITEMS: Array<{ step: number; label: string; name: string }> = new Proxy([] as any, {
  get(_target, prop) {
    const items = getWorkflowStepItems();
    if (prop === 'length') return items.length;
    if (prop === 'map') return items.map.bind(items);
    if (prop === 'forEach') return items.forEach.bind(items);
    if (prop === 'filter') return items.filter.bind(items);
    if (prop === 'some') return items.some.bind(items);
    if (prop === 'every') return items.every.bind(items);
    if (prop === Symbol.iterator) return items[Symbol.iterator].bind(items);
    const idx = parseInt(String(prop), 10);
    if (!isNaN(idx)) return items[idx];
    return (items as any)[prop];
  },
});
