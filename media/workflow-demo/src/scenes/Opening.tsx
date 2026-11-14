import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT, H, W} from '../theme';
import {EASE} from '../lib/camera';

/** 开场：纯排版，暗场起 → 文字上浮 + 一次扫描线。首帧全暗，供 GIF 循环。 */
export const Opening = () => {
  const frame = useCurrentFrame();

  const fade = interpolate(frame, [0, 20], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const line = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 20], [0, 1], {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    translate: `0px ${interpolate(frame, [delay, delay + 24], [22, 0], {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })}px`,
    filter: `blur(${interpolate(frame, [delay, delay + 22], [7, 0], {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })}px)`,
  });

  const sweep = interpolate(frame, [4, 34], [-0.05, 1.05], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sweepOpacity = interpolate(frame, [4, 12, 26, 34], [0, 0.5, 0.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fade,
      }}
    >
      {/* 扫描线：全片唯一的"测量"母题，开场扫一次 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: sweep * W,
          width: 2,
          height: H,
          opacity: sweepOpacity,
          background: `linear-gradient(180deg, transparent, ${COLORS.cyan}, transparent)`,
          boxShadow: `0 0 26px ${COLORS.cyan}`,
        }}
      />

      <div
        style={{
          fontSize: 26,
          letterSpacing: 9,
          color: COLORS.cyan,
          fontWeight: 600,
          marginBottom: 40,
          ...line(6),
        }}
      >
        STRADITIZE · 8 步工作流
      </div>

      <div
        style={{
          fontSize: 88,
          fontWeight: 800,
          color: COLORS.ink,
          lineHeight: 1.26,
          textAlign: 'center',
          letterSpacing: 1,
          ...line(12),
        }}
      >
        从一张剖面扫描图
      </div>

      <div
        style={{
          fontSize: 88,
          fontWeight: 800,
          lineHeight: 1.26,
          textAlign: 'center',
          letterSpacing: 1,
          color: COLORS.cyan,
          textShadow: `0 0 60px ${COLORS.cyan}44`,
          ...line(20),
        }}
      >
        到一份可发表的数据表
      </div>

      <div
        style={{
          fontSize: 32,
          color: COLORS.muted,
          marginTop: 46,
          letterSpacing: 3,
          ...line(30),
        }}
      >
        真实后端 · 真实界面 · 数字全部取自当帧画面
      </div>
    </AbsoluteFill>
  );
};
