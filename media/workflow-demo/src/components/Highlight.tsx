import {useCurrentFrame, interpolate} from 'remotion';
import {COLORS, IMG} from '../theme';
import {EASE} from '../lib/camera';

/**
 * 高亮框：描边按周长生长（stroke-dashoffset 动画），不做假鼠标指针。
 * 坐标一律是素材像素坐标（1440×900），与截图内容对齐。
 */
export const Highlight = ({
  x,
  y,
  w,
  h,
  delay = 0,
  until,
  color = COLORS.cyan,
  label,
  radius = 6,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  delay?: number;
  until?: number;
  color?: string;
  label?: string;
  radius?: number;
}) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [delay, delay + 22], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fade =
    until === undefined
      ? 1
      : interpolate(frame, [until, until + 12], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  if (grow <= 0 || fade <= 0) {
    return null;
  }

  const per = 2 * (w + h);
  const glow = interpolate(grow, [0, 1], [0, 0.55]);

  return (
    <svg
      width={IMG.w}
      height={IMG.h}
      viewBox={`0 0 ${IMG.w} ${IMG.h}`}
      style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none'}}
    >
      {/* 柔光底 */}
      <rect
        x={x - 3}
        y={y - 3}
        width={w + 6}
        height={h + 6}
        rx={radius + 3}
        fill="none"
        stroke={color}
        strokeWidth={7}
        opacity={0.16 * glow * fade}
      />
      {/* 主描边：周长生长 */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        fill={color}
        fillOpacity={0.05 * glow}
        stroke={color}
        strokeWidth={2.6}
        opacity={fade}
        strokeDasharray={per}
        strokeDashoffset={per * (1 - grow)}
        strokeLinecap="round"
      />
      {label ? (
        <g opacity={glow}>
          <rect
            x={x}
            y={y - 30}
            width={label.length * 15 + 22}
            height={26}
            rx={5}
            fill={color}
            opacity={0.92}
          />
          <text
            x={x + 11}
            y={y - 12}
            fill="#04121c"
            fontSize={17}
            fontWeight={700}
            fontFamily="inherit"
          >
            {label}
          </text>
        </g>
      ) : null}
    </svg>
  );
};
