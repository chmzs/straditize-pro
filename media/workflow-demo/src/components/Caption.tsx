import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT} from '../theme';
import {EASE} from '../lib/camera';
import {Counter} from './Counter';
import type {Stat} from '../scenario';

/**
 * 字幕条（lower-third）：左侧步骤号 + 标题 + 说明，右侧大号真值读数。
 * 数字用 Counter 做计数上浮；全部取值来自 scenario.ts 里的截图真值。
 */
export const Caption = ({
  index,
  title,
  detail,
  stat,
  accent = COLORS.cyan,
  dur,
}: {
  index: string;
  title: string;
  detail: string;
  stat?: Stat;
  accent?: string;
  dur: number;
}) => {
  const frame = useCurrentFrame();

  // 字幕层由 CaptionTrack 统一托管：任一帧有且只有一条字幕，恒为不透明。
  // 这里只做一点上浮，不加透明度动画 —— 半透明字幕帧抽出来就是废图。
  const rise = interpolate(frame, [0, 8], [18, 0], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* 只压底部一条，不遮住截图主体 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 250,
          background:
            'linear-gradient(180deg, rgba(3,8,15,0) 0%, rgba(3,8,15,0.72) 46%, rgba(3,8,15,0.96) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 104,
          right: 104,
          bottom: 46,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 48,
          fontFamily: FONT,
          translate: `0px ${rise}px`,
        }}
      >
        <div style={{display: 'flex', alignItems: 'flex-start', gap: 22, maxWidth: 1230}}>
          <div
            style={{
              minWidth: 62,
              height: 62,
              borderRadius: 14,
              border: `1.5px solid ${accent}`,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
              background: `${accent}14`,
              marginTop: 4,
            }}
          >
            {index}
          </div>
          <div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 800,
                color: COLORS.ink,
                letterSpacing: 0.6,
                lineHeight: 1.18,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 32,
                color: COLORS.muted,
                lineHeight: 1.45,
                marginTop: 10,
                fontWeight: 400,
                whiteSpace: 'pre-line',
              }}
            >
              {detail}
            </div>
          </div>
        </div>

        {stat ? (
        <div
          style={{
            textAlign: 'right',
            paddingBottom: 6,
            flexShrink: 0,
            // 读数与单位一起在开始计数那一刻才出现：既避免「0 列 / 0.0000」，
            // 也避免只剩一个孤零零的单位标签
            opacity: interpolate(frame, [11, 15], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <div
            style={{
              fontSize: stat.kind === 'text' ? 64 : 82,
              fontWeight: 800,
              color: accent,
              lineHeight: 1,
              letterSpacing: 0.5,
              textShadow: `0 0 40px ${accent}55`,
            }}
          >
            {stat.kind === 'number' ? (
              <Counter
                value={stat.value}
                decimals={stat.decimals ?? 0}
                suffix={stat.suffix ?? ''}
                delay={11}
                duration={15}
              />
            ) : stat.kind === 'pair' ? (
              <>
                <Counter value={stat.a} delay={11} duration={15} />
                <span style={{opacity: 0.75, padding: '0 10px'}}>×</span>
                <Counter value={stat.b} delay={11} duration={15} />
              </>
            ) : (
              stat.text
            )}
          </div>
          <div
            style={{
              fontSize: 26,
              color: COLORS.muted,
              letterSpacing: 2.5,
              marginTop: 8,
              fontWeight: 500,
            }}
          >
            {stat.label}
          </div>
        </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
