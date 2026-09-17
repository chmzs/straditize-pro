/**
 * Straditize Pro v2.0 Workflow State Machine
 * 
 * 严格按照规范定义的 7 阶段线性工作流状态机：
 * S0 空状态 -> S1 图片已加载 -> S2 ROI已确认 -> S3 列已确定 -> S4 标尺已确认 -> S5 拐点已确认 -> S6 校验 -> S7 导出
 */

export type WorkflowStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WorkflowStageMeta {
  stage: WorkflowStage;
  title: string;
  stepName: string;
  guideText: string;
  primaryActionLabel: string | null;
}

export const WORKFLOW_STAGES: Record<WorkflowStage, WorkflowStageMeta> = {
  0: {
    stage: 0,
    title: 'S0：空状态 (Empty State)',
    stepName: '空状态',
    guideText: '请点击顶栏 [📁 图谱] 或拖拽地质剖面图至画布中央开始工作。',
    primaryActionLabel: '📁 加载图片',
  },
  1: {
    stage: 1,
    title: 'S1：图片已加载 (Image Loaded)',
    stepName: '1.加载',
    guideText: '图片已居中自适应展示。请在画布上拖拽框选纯数据有效区 (ROI)，排除外围坐标轴与文字。',
    primaryActionLabel: '👉 确认 ROI 并进入清理 (S2)',
  },
  2: {
    stage: 2,
    title: 'S2：ROI 已确认与图像清理 (ROI Confirmed & Clean)',
    stepName: '2.ROI',
    guideText: '数据有效区已锁定。可开启去横线滤镜与按 B 键红色高亮预览，确认后进入分列。',
    primaryActionLabel: '👉 确认有效区，开始分列 (S3)',
  },
  3: {
    stage: 3,
    title: 'S3：分列与属种名单对齐 (Column Partitioning)',
    stepName: '3.分列',
    guideText: '请在侧边栏批量导入/粘贴属种名单，使用 ▲/▼ 顺位对调或 ➕插空列 保证名单与图谱 100% 严密对齐。',
    primaryActionLabel: '👉 确认列对齐，进入标尺标定 (S4)',
  },
  4: {
    stage: 4,
    title: 'S4：标尺标定 (Calibration)',
    stepName: '4.标尺',
    guideText: '请在右侧检查器完成两点式深度标定与各属种列物理刻度齿标定（支持 Linear/Log 硬约束）。',
    primaryActionLabel: '👉 确认标尺，开始提取拐点 (S5)',
  },
  5: {
    stage: 5,
    title: 'S5：拐点提取与多边形精修 (Digitize & Refine)',
    stepName: '5.拐点',
    guideText: '已提取稀疏控制手柄与绿色半透明原位重绘层 (Visual Ghosting)。左键拉拽、右键删点微调轮廓。',
    primaryActionLabel: '👉 完成精修，进入地学校验 (S6)',
  },
  6: {
    stage: 6,
    title: 'S6：地学校验与自检门禁 (Verification & QA)',
    stepName: '6.校验',
    guideText: '已启动全剖面 100% 丰度总和自检门禁，可切换图层开关、打开双向冻结数据表检查各层位。',
    primaryActionLabel: '👉 校验达标，进入导出交付 (S7)',
  },
  7: {
    stage: 7,
    title: 'S7：导出交付 (Export Deliverables)',
    stepName: '7.导出',
    guideText: '请选择导出格式 (CSV / Straditize .tar 开放归档 / rioja 自动绘图脚本) 保存到本地。',
    primaryActionLabel: '💾 打开导出面板',
  },
};

export const WORKFLOW_STEP_ITEMS = [
  { step: 1, label: '1.加载', name: '加载' },
  { step: 2, label: '2.ROI', name: 'ROI' },
  { step: 3, label: '3.分列', name: '分列' },
  { step: 4, label: '4.标尺', name: '标尺' },
  { step: 5, label: '5.拐点', name: '拐点' },
  { step: 6, label: '6.校验', name: '校验' },
  { step: 7, label: '7.导出', name: '导出' },
] as const;
