/**
 * Straditize Pro v2.0 Workflow State Machine
 * 
 * 严格分步推进状态机定义：
 * 任何新打开或载入的图片，绝对不自动全流程盲跑，必须且只能由用户在各步骤点击显式推进！
 */

export type WorkflowStage = 1 | 2 | 3 | 4;

export interface WorkflowStageMeta {
  stage: WorkflowStage;
  title: string;
  stepName: string;
  guideText: string;
  primaryActionLabel: string | null;
}

export const WORKFLOW_STAGES: Record<WorkflowStage, WorkflowStageMeta> = {
  1: {
    stage: 1,
    title: '步骤 1：界定纯数据有效区 (Select Data ROI)',
    stepName: '有效区',
    guideText: '拖动画布十字手柄框选花粉区，严格排除左侧Y轴与右侧聚类树。',
    primaryActionLabel: '👉 确认有效区 (进入 Step 2)',
  },
  2: {
    stage: 2,
    title: '步骤 2：核对属种列分界与指定形态 (Columns & Plot Types)',
    stepName: '分列形态',
    guideText: '在侧边栏核对名单，使用 ▲/▼ 顺位对调或 ➕插空列 对齐，指定各列形态与倍数。',
    primaryActionLabel: '👉 开始数字化识别 (进入 Step 3)',
  },
  3: {
    stage: 3,
    title: '步骤 3：多边形轮廓微调与原位半透明重叠比对 (Refine & Ghosting)',
    stepName: '轮廓精修',
    guideText: '核对绿色半透明多边形与底图黑斑的吻合度，左键拉拽、右键删点微调。',
    primaryActionLabel: '👉 进入质检与导出 (进入 Step 4)',
  },
  4: {
    stage: 4,
    title: '步骤 4：地学 100% 丰度总和自检与科学导出 (QA & Export)',
    stepName: '质检导出',
    guideText: '全剖面各层位百分比加和实时自检通过后，导出 CSV、R 绘图脚本与项目包。',
    primaryActionLabel: null,
  }
};
