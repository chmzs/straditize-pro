import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT} from '../theme';
import {EASE} from '../lib/camera';

/** 收尾：淡出到暗场，与开场首帧同为暗场，保证动图循环无缝。 */
export const Closing = ({dur}: {dur: number}) => {
  const frame = useCurrentFrame();

  const opacity = Math.min(
    interpolate(frame, [0, 16], [0, 1], {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    interpolate(frame, [dur - 20, dur - 2], [1, 0], {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        justifyContent: 'center',
        alignItems: 'center',
        opacity,
      }}
    >
      <div
        style={{
          fontSize: 26,
          letterSpacing: 9,
          color: COLORS.cyan,
          fontWeight: 600,
          marginBottom: 34,
        }}
      >
        STRADITIZE
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 800,
          color: COLORS.ink,
          letterSpacing: 1,
          textAlign: 'center',
          lineHeight: 1.34,
        }}
      >
        每一步都留痕
        <span style={{color: COLORS.cyan}}>，每一个数字都能回到那一帧</span>
      </div>
    </AbsoluteFill>
  );
};
