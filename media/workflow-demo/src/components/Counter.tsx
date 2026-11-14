import {Easing, useCurrentFrame, interpolate} from 'remotion';
import type {CSSProperties} from 'react';

/**
 * 计数上浮：0 → value，缓入缓出。
 * 用在「关键数据」上；数值全部取自当帧截图里的可见文本。
 */
export const Counter = ({
  value,
  delay = 8,
  duration = 26,
  decimals = 0,
  suffix = '',
  prefix = '',
  separators = false,
  style,
}: {
  value: number;
  delay?: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  separators?: boolean;
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  // 缓出而不是缓入：数字先快后慢地settle到真值，
  // 这样"正在计数"的时长很短，抽帧抽到的中间值也离真值很近。
  const p = interpolate(frame, [delay, delay + duration], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const raw = value * p;

  let text = raw.toFixed(decimals);
  if (separators) {
    const [int, frac] = text.split('.');
    text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (frac ? `.${frac}` : '');
  }

  return (
    <span style={{fontVariantNumeric: 'tabular-nums', ...style}}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
};
