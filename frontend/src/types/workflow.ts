/**
 * Straditize Pro v2.0 Workflow State Machine
 *
 * 严格按照 8 步工作流规范重构（设计稿 §1 / 契约 v1.3）：
 * 1.载入 -> 2.ROI -> 3.Y标定 -> 4.清理 -> 5.分列 -> 6.标定列 -> 7.拐点与采样 -> 8.校验
 * （删导出阶段；导出统一由顶栏总出口承担）
 */

export type WorkflowStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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
    title: '1. 载入图谱 (Image Loaded)',
    stepName: '1.载入',
    guideText: '图谱已载入并自适应居中。请检查图谱整体形态与水平方向，准备就绪后点击进入 ROI 框选。',
    primaryActionLabel: '👉 进入数据有效区框选 (步骤 2)',
  },
  2: {
    stage: 2,
    title: '2. 多 ROI 与命名 (Data ROI & Naming)',
    stepName: '2.ROI',
    guideText: '框选数据取数区 (ROI) 并命名（如花粉百分比、炭屑浓度等）。ROI 仅为几何窗口与列组容器，不绑定深度数值。',
    primaryActionLabel: '👉 确认 ROI，进入 Y 轴标定 (步骤 3)',
  },
  3: {
    stage: 3,
    title: '3. Y 轴物理标定 (Depth / Age Calibration)',
    stepName: '3.Y标定',
    guideText: '在图上点选 Y 轴上两个已知刻度所在的行并填入真实值（快捷键 Y）。标定后深度标尺全程可用。',
    primaryActionLabel: '👉 确认标尺，进入干扰线清理 (步骤 4)',
  },
  4: {
    stage: 4,
    title: '4. 干扰清理 (Grid Line Removal & Exclusions)',
    stepName: '4.清理',
    guideText: '去除贯穿网格线与图版杂迹，划定排除区，前置生成干净墨迹掩膜，确保分列所见即所得。',
    primaryActionLabel: '👉 确认清理，开始自动分列 (步骤 5)',
  },
  5: {
    stage: 5,
    title: '5. 自动分列与命名 (Columns & Taxa Names)',
    stepName: '5.分列',
    guideText: '基于干净墨迹完成列分割。点击【🔍 OCR】自动识别属种名，亦可在对象清单中快速编辑。',
    primaryActionLabel: '👉 确认列划分，进入 X 轴刻度标定 (步骤 6)',
  },
  6: {
    stage: 6,
    title: '6. 标定列与 X 刻度 (Column Scaling & Ticks)',
    stepName: '6.标定列',
    guideText: '通过 1-D 几何算法自动提取各列真实刻度线齿，或双击手动标定端点，设置 Linear/Log 标度。',
    primaryActionLabel: '👉 确认列刻度，提取拐点与采样层位 (步骤 7)',
  },
  7: {
    stage: 7,
    title: '7. 拐点与采样层位 (Turning Points & Horizons)',
    stepName: '7.拐点',
    guideText: '提取各属种曲线特征拐点，识别并交互微调地学历史采样层位线，形成导出数据行轴。',
    primaryActionLabel: '👉 完成提取，进入全剖面地学校验 (步骤 8)',
  },
  8: {
    stage: 8,
    title: '8. 地学校验与自检 (Verification & QA)',
    stepName: '8.校验',
    guideText: '执行组分总和 ≤100% 门禁检查与异常诊断。全部达标后，可直接点击顶栏 [💾 导出] 导出科学数据。',
    primaryActionLabel: '💾 打开顶栏导出就绪清单',
  },
};

export const WORKFLOW_STEP_ITEMS = [
  { step: 1, label: '1.载入', name: '载入' },
  { step: 2, label: '2.ROI', name: 'ROI' },
  { step: 3, label: '3.Y标定', name: 'Y标定' },
  { step: 4, label: '4.清理', name: '清理' },
  { step: 5, label: '5.分列', name: '分列' },
  { step: 6, label: '6.标定列', name: '标定列' },
  { step: 7, label: '7.拐点', name: '拐点' },
  { step: 8, label: '8.校验', name: '校验' },
] as const;
