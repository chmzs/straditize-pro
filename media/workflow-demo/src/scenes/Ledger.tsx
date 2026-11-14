import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT} from '../theme';
import {EASE} from '../lib/camera';
import {LEDGER_ROWS} from '../scenario';

/** 账本页：把前面 8 个镜头的真值一次性回收。数据来自 scenario.ts 的 LEDGER_ROWS。 */
export const Ledger = () => {
  const frame = useCurrentFrame();

  const headOpacity = interpolate(frame, [0, 6], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 160px',
      }}
    >
      <div style={{width: '100%', maxWidth: 1500}}>
        <div
          style={{
            fontSize: 26,
            letterSpacing: 8,
            color: COLORS.cyan,
            fontWeight: 600,
            opacity: headOpacity,
          }}
        >
          全片账本
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: COLORS.ink,
            marginTop: 14,
            marginBottom: 46,
            letterSpacing: 1,
            opacity: headOpacity,
          }}
        >
          {LEDGER_ROWS.length} 个数字，全部取自当帧画面
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            columnGap: 72,
            rowGap: 0,
          }}
        >
          {LEDGER_ROWS.map((row, i) => {
            const delay = 8 + i * 8;
            const opacity = interpolate(frame, [delay, delay + 16], [0, 1], {
              easing: EASE,
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const shift = interpolate(frame, [delay, delay + 18], [16, 0], {
              easing: EASE,
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div
                key={row.k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 28,
                  padding: '17px 0',
                  borderBottom: '1px solid rgba(120,180,255,0.13)',
                  opacity,
                  translate: `0px ${shift}px`,
                }}
              >
                <span style={{fontSize: 30, color: COLORS.muted, letterSpacing: 1}}>
                  {row.k}
                </span>
                <span
                  style={{
                    fontSize: 40,
                    fontWeight: 700,
                    color: i === LEDGER_ROWS.length - 1 ? COLORS.amber : COLORS.ink,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.v}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
