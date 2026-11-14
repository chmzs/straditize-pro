import {COLORS} from './theme';
import {framesOf} from './narration';

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

export type Stat =
  | {kind: 'number'; value: number; decimals?: number; suffix?: string; label: string}
  | {kind: 'pair'; a: number; b: number; label: string}
  | {kind: 'text'; text: string; label: string};

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
  /** 字幕标题与读数在这里；字幕正文由配音逐句提供（narration-timing.json），不重写一遍。 */
  caption: {
    index: string;
    title: string;
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
  ocr: 'modal_ocr.png',
  metadata: 'modal_metadata.png',
  roiTooSmall: 'step6_roi_not_covering_axis.png',
  xticks: 'step6_xticks.png',
  agedepth: 'modal_agedepth.png',
  horizons: 'step7_samples.png',
  qa: 'step8_qa_export.png',
  exportBlocked: 'modal_export_uncalibrated.png',
} as const;

const STEPS_BASE: Omit<StepShotSpec, 'frames'>[] = [
  {
    id: 'load',
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
      stat: {kind: 'pair', a: 2339, b: 1654, label: '图像尺寸 px'},
    },
  },
  {
    id: 'roi',
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
      stat: {kind: 'number', value: 28, suffix: ' 列', label: '归属列数'},
    },
  },
  {
    id: 'ycalib',
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
      title: 'Y 轴两点标定',
      stat: {kind: 'number', value: 0.1875, decimals: 4, suffix: ' cm/px', label: 'Ratio 标定比值'},
    },
  },
  {
    id: 'clean-candidates',
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
      stat: {kind: 'number', value: 20, suffix: ' 条', label: '干扰线候选'},
    },
  },
  {
    id: 'clean-mask',
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
      stat: {kind: 'text', text: '已开启', label: '遮罩高亮'},
    },
  },
  {
    id: 'split',
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
      stat: {kind: 'number', value: 28, suffix: ' 列', label: '成功切分'},
    },
  },
  {
    id: 'ocr',
    tone: 'cool',
    image: SHOTS.ocr,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 56, x: 660, y: 372, scale: 1.84},
      {at: 150, x: 700, y: 470, scale: 1.72},
    ],
    boxes: [
      {x: 322, y: 358, w: 452, h: 26, delay: 34, color: COLORS.cyan},
      {x: 322, y: 396, w: 700, h: 26, delay: 62, color: COLORS.amber},
      {x: 322, y: 578, w: 700, h: 32, delay: 96, color: COLORS.cyan},
    ],
    caption: {
      index: '05',
      title: 'OCR 认得出属种名',
      stat: {kind: 'number', value: 30, suffix: ' 列', label: '识别到的属种'},
    },
  },
  {
    id: 'metadata',
    tone: 'cool',
    image: SHOTS.metadata,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 60, x: 719, y: 330, scale: 1.3},
      {at: 150, x: 719, y: 380, scale: 1.5},
    ],
    boxes: [
      {x: 258, y: 166, w: 616, h: 30, delay: 26, color: COLORS.cyan},
      {x: 730, y: 318, w: 450, h: 88, delay: 54, color: COLORS.cyan},
      {x: 258, y: 484, w: 452, h: 148, delay: 92, color: COLORS.amber},
    ],
    caption: {
      index: '05',
      title: '元信息从图版与文献里读出来',
      stat: {kind: 'number', value: 41.25, decimals: 2, suffix: '°N', label: '采样点纬度'},
    },
  },
  {
    id: 'xticks-roi-too-small',
    tone: 'warm',
    image: SHOTS.roiTooSmall,
    camera: [
      {at: 0, x: 900, y: 420, scale: 1.14},
      {at: 52, x: 1280, y: 400, scale: 1.66},
    ],
    boxes: [{x: 1213, y: 338, w: 206, h: 142, delay: 18, color: COLORS.amber}],
    caption: {
      index: '06',
      title: '框没盖住轴行 ⇒ 检测为空',
      stat: {kind: 'text', text: '检测为空', label: '本拍结果'},
    },
  },
  {
    id: 'xticks-ok',
    tone: 'cool',
    image: SHOTS.xticks,
    camera: [
      {at: 0, x: 900, y: 400, scale: 1.14},
      {at: 60, x: 1100, y: 420, scale: 1.36},
      {at: 120, x: 1280, y: 340, scale: 1.7},
    ],
    boxes: [
      {x: 1198, y: 300, w: 228, h: 92, delay: 34, color: COLORS.cyan},
      {x: 1198, y: 538, w: 232, h: 44, delay: 78, color: COLORS.amber},
    ],
    caption: {
      index: '06',
      title: '补上下边界，28 列全部检出',
      stat: {kind: 'number', value: 28, suffix: ' 列', label: '检出刻齿'},
    },
  },
  {
    id: 'agedepth',
    tone: 'cool',
    image: SHOTS.agedepth,
    camera: [
      {at: 0, x: 720, y: 450, scale: 1.0},
      {at: 50, x: 720, y: 470, scale: 1.16},
      {at: 130, x: 700, y: 560, scale: 1.34},
    ],
    boxes: [
      {x: 330, y: 250, w: 520, h: 470, delay: 30, color: COLORS.cyan},
      {x: 745, y: 792, w: 440, h: 24, delay: 96, color: COLORS.amber},
    ],
    caption: {
      index: '06',
      title: '深度轴自己读出来',
      stat: {kind: 'number', value: 682, suffix: ' 个', label: '提取的深度层位'},
    },
  },
  {
    id: 'horizons',
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
      stat: {kind: 'number', value: 112, suffix: ' 个', label: '共识层位'},
    },
  },
  {
    id: 'qa',
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
      stat: {kind: 'number', value: 170.8, decimals: 1, suffix: '%', label: '最大总和'},
    },
  },
  {
    id: 'export-blocked',
    tone: 'warm',
    image: SHOTS.exportBlocked,
    // 只取弹窗右栏这一竖条：readiness 清单 + Dataset + 橙色 caption。
    // 弹窗左侧的表区是空的（0 rows），整张 1440x900 一进来就有三分之一是纯白，
    // 观众会读成"面板白屏"。裁切把它直接裁到画外，而不是盖一块色。
    // h 取 412（而不是卡片刚好装下标题的 390），是为了让最下面那句橙色提示整行可见。
    crop: {x: 1015, y: 140, w: 285, h: 412},
    cardHeight: 780,
    camera: [
      {at: 0, x: 142, y: 205, scale: 1.0},
      {at: 90, x: 142, y: 210, scale: 1.04},
    ],
    boxes: [
      {x: 8, y: 7, w: 270, h: 253, delay: 22, color: COLORS.amber},
      {x: 15, y: 187, w: 250, h: 13, delay: 56, color: COLORS.red},
      {x: 15, y: 348, w: 250, h: 32, delay: 84, color: COLORS.amber},
    ],
    caption: {
      index: '08',
      title: '没标定，就不给导出',
      stat: {kind: 'text', text: '待完善', label: '导出就绪清单'},
    },
  },
];

/** 镜头时长不再手写：由 tools/synthesize_narration.py 量出的音频时长 + 0.5s 留白推导。 */
export const STEPS: StepShotSpec[] = STEPS_BASE.map((step) => ({
  ...step,
  frames: framesOf(step.id),
}));

/** 全片时长 = 开场 + 各镜头 + 账本 + 收尾，减去相邻镜头的交叉淡入重叠。 */
export const OPENING_FRAMES = framesOf('opening');
export const LEDGER_FRAMES = framesOf('ledger');
export const CLOSING_FRAMES = framesOf('closing');

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
  {k: 'OCR 属种', v: '30 列（准确 26 / 待确认 2 / 未识别 2）'},
  {k: 'X 刻度检出', v: '28 列 · 刻距 11 px（不均）'},
  {k: '深度层位', v: '682 个 → 映射 801 个样品'},
  {k: '共识层位', v: '112 个'},
  {k: '总和超标层位', v: '85 个 · 峰值 170.8%'},
];
