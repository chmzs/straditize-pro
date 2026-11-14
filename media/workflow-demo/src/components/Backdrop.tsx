import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import type {CSSProperties, ReactNode} from 'react';
import {COLORS, H, W} from '../theme';

/** 全局底：深海军蓝 + 极淡网格 + 暗角。所有镜头共用一层，避免转场时底色脉动。 */
export const Backdrop = ({children}: {children?: ReactNode}) => (
  <AbsoluteFill style={{backgroundColor: COLORS.bgDeep}}>
    <AbsoluteFill
      style={{
        backgroundImage: [
          `radial-gradient(1100px 720px at 50% 34%, ${COLORS.bgHigh} 0%, ${COLORS.bgMid} 46%, ${COLORS.bgDeep} 100%)`,
          'repeating-linear-gradient(0deg, rgba(120,180,255,0.055) 0 1px, transparent 1px 64px)',
          'repeating-linear-gradient(90deg, rgba(120,180,255,0.055) 0 1px, transparent 1px 64px)',
        ].join(','),
      }}
    />
    {children}
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(120% 90% at 50% 46%, transparent 42%, rgba(2,5,10,0.72) 100%)',
      }}
    />
  </AbsoluteFill>
);

/** 每个镜头的光晕：cool=推进，warm=刹车（琥珀）。 */
export const Tone = ({tone = 'cool'}: {tone?: 'cool' | 'warm'}) => {
  const color = tone === 'warm' ? COLORS.amber : COLORS.cyan;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(680px 400px at 50% 6%, ${color}22 0%, transparent 70%)`,
      }}
    />
  );
};

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 镜头槽：入场用**遮罩滑动**（自上而下的一道竖帘），不用交叉淡化。
 * 为什么不用交叉淡化 / 焦点模糊：
 *   - 两张界面 50% 叠在一起会成重影，抽帧一眼就是糊的；
 *   - 淡到 0 再淡回 1 会在每个交界处闪一下全黑（v1 的问题）；
 *   - 大半径模糊帧看起来像加载占位图，最糟。
 * 遮罩滑动时两侧各自完整，不重叠、不变暗、不虚。
 */
export const Slot = ({
  children,
  dur,
  fadeIn = 0,
  fadeOut = 0,
  style,
}: {
  children: ReactNode;
  dur: number;
  fadeIn?: number;
  fadeOut?: number;
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();

  const wipe =
    fadeIn > 0
      ? interpolate(frame, [0, fadeIn], [0, 1], {
          easing: EASE_OUT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const outP =
    fadeOut > 0
      ? interpolate(frame, [dur - fadeOut, dur], [1, 0], {
          easing: EASE_OUT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  if (wipe >= 1 && outP >= 1) {
    return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
  }

  // 帘边一道细光，交代"这是转场，不是画面抖动"
  const edge = 3;
  return (
    <AbsoluteFill
      style={{
        opacity: outP,
        clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
        ...style,
      }}
    >
      {children}
      {wipe < 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `calc(${wipe * 100}% - ${edge / 2}px)`,
            width: edge,
            background: `linear-gradient(180deg, transparent, ${COLORS.cyan}, transparent)`,
            opacity: 0.85,
            boxShadow: `0 0 26px ${COLORS.cyan}`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** 纯排版镜头（开场/账本/收尾）用的居中内容层。 */
export const Stage = ({children}: {children: ReactNode}) => (
  <AbsoluteFill
    style={{
      width: W,
      height: H,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    {children}
  </AbsoluteFill>
);
