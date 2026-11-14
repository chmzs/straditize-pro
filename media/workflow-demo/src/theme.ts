export const W = 1920;
export const H = 1080;
export const FPS = 30;

/** 素材原始分辨率：docs/assets/tutorials/*.png 全部是 1440×900。 */
export const IMG = {w: 1440, h: 900};

/** 截图卡片在 1920×1080 画布上的落位（scale<1 留出字幕带）。 */
export const CARD = {
  scale: 0.96,
  x: (W - IMG.w * 0.96) / 2, // 268.8
  y: 32,
};

export const FONT =
  '"Noto Sans SC","Microsoft YaHei","Source Han Sans SC","PingFang SC",sans-serif';

export const COLORS = {
  bgDeep: '#04080f',
  bgMid: '#0a1626',
  bgHigh: '#102338',
  ink: '#e9f3ff',
  muted: '#82a0bd',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  amber: '#fbbf24',
  red: '#f87171',
  glass: 'rgba(7,17,30,0.80)',
  hairline: 'rgba(120,180,255,0.16)',
};
