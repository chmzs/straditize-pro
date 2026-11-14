import {COLORS} from './theme';

/**
 * 演示对象配置：换演示图 / 换工作流时**只改本文件**。
 * 三样东西都在这里：帧图路径、运镜关键帧、高亮框与字幕取值。
 * 场景组件（src/scenes/StepShotView.tsx）不写死任何坐标或数字。
 *
 * 数字铁律：每个 value 都必须能在对应截图上读到，禁止估算。
 */

export type CamKey = {at: number; x: number; y: number; scale: number};

export type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  delay?: number;
  /** 从该帧起淡出：推进镜头时主动把注意力交出去。 */
  until?: number;
  color?: string;
  label?: string;
};

export type Stat =
  | {kind: 'number'; value: number; decimals?: number; suffix?: string; label: string}
  | {kind: 'pair'; a: number; b: number; label: string}
  | {kind: 'text'; text: string; label: string};

/** 遮罩：从左侧滑入的暗块，用来合法地「收窄」画面（不出画、不篡改界面）。 */
export type Mask = {
  x: number;
  y: number;
  w: number;
  h: number;
  delay?: number;
  /** 默认铺底深色；要与弹窗白底一致时传 '#ffffff'。 */
  color?: string;
};

export type StepShotSpec = {
  id: string;
  frames: number;
  tone: 'cool' | 'warm';
  /** public/shots/ 下的文件名 */
  image: string;
  /** 只取原图的一块区域展示（取景裁切，不改像素）。用于把空表之类无关区域裁出画外。 */
  crop?: {x: number; y: number; w: number; h: number};
  /** 给了就把卡片做成该高度（像素）；宽度按裁切比例。 */
  cardHeight?: number;
  camera: CamKey[];
  boxes: Box[];
  masks?: Mask[];
  caption: {
    index: string;
    title: string;
    detail: string;
    stat: Stat;
  };
};

/** 素材文件名集中处：换对象只改这里。 */
export const SHOTS = {
  load: 'step1_load.png',
  roi: 'step2_roi.png',
  ycalib: 'step3_ycalib.png',
  cleanCandidates: 'step4_cleanup.png',
  cleanMask: 'step4_binary_overlay.png',
  split: 'step5_naming.png',
  xticks: 'step6_xticks.png',
  xticksRoiWarn: 'step6_roi_not_covering_axis.png',
  horizons: 'step7_samples.png',
  qa: 'step8_qa_export.png',
  exportBlocked: 'modal_export_uncalibrated.png',
} as const;

export const STEPS: StepShotSpec[] = [
  {
    id: 'load',
    frames: 150,
    tone: 'cool',
    image: SHOTS.load,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 40, x: 800, y: 420, scale: 1.16},
      {at: 104, x: 900, y: 380, scale: 1.3},
    ],
    boxes: [{x: 1196, y: 144, w: 232, h: 124, delay: 30}],
    caption: {
      index: '01',
      title: '载入图谱',
      detail: '扫描图进画布即完成解析 · 自动识别 28 个属性列',
      stat: {kind: 'pair', a: 2339, b: 1654, label: '图像尺寸 px'},
    },
  },
  {
    id: 'roi',
    frames: 180,
    tone: 'cool',
    image: SHOTS.roi,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 36, x: 720, y: 470, scale: 1.14},
      {at: 112, x: 910, y: 520, scale: 1.34},
    ],
    boxes: [
      {x: 443, y: 364, w: 542, h: 278, delay: 20},
      {x: 1197, y: 446, w: 228, h: 58, delay: 56},
    ],
    caption: {
      index: '02',
      title: '框出有效区',
      detail: '像素边界 X 315–1946 · Y 511–1311',
      stat: {kind: 'number', value: 28, suffix: ' 列', label: '归属列数'},
    },
  },
  {
    id: 'ycalib',
    frames: 190,
    tone: 'cool',
    image: SHOTS.ycalib,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.05},
      {at: 34, x: 1000, y: 430, scale: 1.32},
      {at: 122, x: 1290, y: 410, scale: 1.72},
    ],
    boxes: [
      {x: 1197, y: 308, w: 232, h: 86, delay: 34},
      {x: 1197, y: 414, w: 232, h: 86, delay: 48},
    ],
    caption: {
      index: '03',
      title: '两点定标尺',
      detail: '511 px → 0 cm ；1311 px → 150 cm',
      stat: {kind: 'number', value: 0.1875, decimals: 4, suffix: ' cm/px', label: 'Ratio 标定比值'},
    },
  },
  {
    id: 'clean-candidates',
    frames: 150,
    tone: 'cool',
    image: SHOTS.cleanCandidates,
    camera: [
      {at: 0, x: 760, y: 450, scale: 1.06},
      {at: 30, x: 900, y: 300, scale: 1.22},
      {at: 104, x: 1010, y: 380, scale: 1.66},
    ],
    boxes: [
      {x: 858, y: 126, w: 152, h: 28, delay: 24},
      {x: 1198, y: 394, w: 232, h: 142, delay: 52},
    ],
    caption: {
      index: '04',
      title: '找干扰线',
      detail: '虚线框＝待确认几何，不点确认不动像素 · 二值化遮罩 已关闭',
      stat: {kind: 'number', value: 20, suffix: ' 条', label: '干扰线候选'},
    },
  },
  {
    id: 'clean-mask',
    frames: 160,
    tone: 'cool',
    image: SHOTS.cleanMask,
    camera: [
      {at: 0, x: 1010, y: 380, scale: 1.66},
      {at: 58, x: 940, y: 430, scale: 1.42},
      {at: 132, x: 860, y: 470, scale: 1.28},
    ],
    boxes: [
      {x: 858, y: 126, w: 152, h: 28, delay: 6, color: COLORS.cyan},
      {x: 443, y: 364, w: 542, h: 278, delay: 34, color: COLORS.cyan},
    ],
    caption: {
      index: '04',
      title: '叠上二值化遮罩',
      detail: '同一 ROI 只换遮罩态 · 灰色＝被遮罩像素，分列只认剩下的黑',
      stat: {kind: 'text', text: '已开启', label: '遮罩高亮'},
    },
  },
  {
    id: 'split',
    frames: 170,
    tone: 'cool',
    image: SHOTS.split,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 40, x: 820, y: 440, scale: 1.2},
      {at: 116, x: 660, y: 400, scale: 1.5},
    ],
    boxes: [
      {x: 843, y: 126, w: 286, h: 28, delay: 18},
      {x: 443, y: 364, w: 300, h: 278, delay: 46},
    ],
    caption: {
      index: '05',
      title: '一列一列拆开',
      detail: '红＝列切分线 · 绿＝0 点 · 蓝＝单位刻度',
      stat: {kind: 'number', value: 28, suffix: ' 列', label: '成功切分'},
    },
  },
  {
    id: 'xticks',
    frames: 210,
    tone: 'warm',
    image: SHOTS.xticks,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 40, x: 1000, y: 430, scale: 1.24},
      {at: 106, x: 1280, y: 340, scale: 1.7},
    ],
    boxes: [
      {x: 1198, y: 300, w: 228, h: 92, delay: 30, color: COLORS.cyan},
      {x: 1198, y: 538, w: 232, h: 44, delay: 78, color: COLORS.amber},
    ],
    caption: {
      index: '06',
      title: '刻度标定：不是一键完成',
      detail: '检出 28 列 · 刻距 11px · 刻距不均\n仍需人工点一个刻度齿填读数，才定得下斜率',
      stat: {kind: 'number', value: 11, suffix: ' px', label: '检出刻距'},
    },
  },
  {
    id: 'xticks-roi-warn',
    frames: 78,
    tone: 'warm',
    image: SHOTS.xticksRoiWarn,
    camera: [
      {at: 0, x: 900, y: 420, scale: 1.14},
      {at: 70, x: 1280, y: 400, scale: 1.66},
    ],
    boxes: [{x: 1213, y: 338, w: 206, h: 142, delay: 26, color: COLORS.amber}],
    caption: {
      index: '06',
      title: '框没盖住轴行，界面直接说',
      detail: '有效区下边界 y=1300 未覆盖印刷轴行 y≈1307\n框没盖住时不会静默返回空值，而是给出下边界该移到哪',
      stat: {kind: 'number', value: 25, suffix: ' / 28 列', label: '测不到轴线的列'},
    },
  },
  {
    id: 'horizons',
    frames: 190,
    tone: 'cool',
    image: SHOTS.horizons,
    camera: [
      {at: 0, x: 700, y: 450, scale: 1.0},
      {at: 36, x: 700, y: 470, scale: 1.16},
      {at: 112, x: 1000, y: 470, scale: 1.55},
    ],
    boxes: [
      {x: 443, y: 364, w: 130, h: 278, delay: 14, until: 74},
      {x: 1196, y: 376, w: 232, h: 192, delay: 62},
    ],
    caption: {
      index: '07',
      title: '跨属性找共识层位',
      detail: '拐点共识自动提取 · 深度分辨率 0.188 cm/px',
      stat: {kind: 'number', value: 112, suffix: ' 个', label: '共识层位'},
    },
  },
  {
    id: 'qa',
    frames: 210,
    tone: 'warm',
    image: SHOTS.qa,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 36, x: 1000, y: 420, scale: 1.22},
      {at: 108, x: 1285, y: 330, scale: 1.72},
    ],
    boxes: [
      {x: 1196, y: 242, w: 230, h: 48, delay: 26, color: COLORS.red},
      {x: 1196, y: 302, w: 108, h: 66, delay: 52, color: COLORS.cyan},
      {x: 1196, y: 388, w: 112, h: 46, delay: 74, color: COLORS.amber},
    ],
    caption: {
      index: '08',
      title: '先过 ±2% 门禁',
      detail: '85 个层位总和 > 102% · 总层位 112 · 空层 0',
      stat: {kind: 'number', value: 170.8, decimals: 1, suffix: '%', label: '最大总和'},
    },
  },
  {
    id: 'export-blocked',
    frames: 180,
    tone: 'warm',
    image: SHOTS.exportBlocked,
    // 只取弹窗右栏这一竖条：readiness 清单 + Dataset + 橙色 caption。
    // 弹窗左侧的表区是空的（0 rows），整张 1440x900 一进来就有三分之一是纯白，
    // 观众会读成"面板白屏"。裁切把它直接裁到画外，而不是盖一块色。
    crop: {x: 1015, y: 140, w: 285, h: 390},
    cardHeight: 780,
    camera: [
      {at: 0, x: 142, y: 190, scale: 1.0},
      {at: 78, x: 142, y: 196, scale: 1.05},
    ],
    boxes: [
      {x: 8, y: 7, w: 270, h: 253, delay: 22, color: COLORS.amber},
      {x: 15, y: 187, w: 250, h: 13, delay: 56, color: COLORS.red},
      {x: 15, y: 348, w: 250, h: 32, delay: 84, color: COLORS.amber},
    ],
    caption: {
      index: '08',
      title: '没标定，就不给导出',
      detail: '拒绝导出 ⇒ 表区为空，不是一张 0 值表\n未就绪清单写明缺什么：0 列已标定 / 28 列未标定',
      stat: {kind: 'text', text: '待完善', label: '导出就绪清单'},
    },
  },
];

/** 全片时长 = 开场 + 各镜头 + 账本 + 收尾，减去相邻镜头的交叉淡入重叠。 */
export const OPENING_FRAMES = 78;
export const LEDGER_FRAMES = 135;
export const CLOSING_FRAMES = 66;

/** 相邻镜头重叠帧数：后一镜在前一镜上面淡入，段间不出现全黑。 */
export const OVERLAP_FRAMES = 5;

/** 镜头总数：开场 + 步骤镜头 + 账本 + 收尾。 */
export const SCENE_COUNT = STEPS.length + 3;

export const TOTAL_FRAMES =
  OPENING_FRAMES +
  STEPS.reduce((sum, step) => sum + step.frames, 0) +
  LEDGER_FRAMES +
  CLOSING_FRAMES -
  OVERLAP_FRAMES * (SCENE_COUNT - 1);

/** 账本页回收的数字：全部来自上面各镜头的真值。 */
export const LEDGER_ROWS: {k: string; v: string}[] = [
  {k: '图像尺寸', v: '2339 × 1654 px'},
  {k: '属性列', v: '28'},
  {k: 'ROI 像素边界', v: 'X 315–1946 / Y 511–1311'},
  {k: 'Y 轴标定比', v: '0.1875 cm/px'},
  {k: '干扰线候选', v: '20 条'},
  {k: '成功切分', v: '28 列'},
  {k: 'X 刻距', v: '11 px（不均）'},
  {k: '共识层位', v: '112 个'},
  {k: '总和超标层位', v: '85 个 · 峰值 170.8%'},
];
