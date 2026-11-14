import {interpolate, useCurrentFrame} from 'remotion';
import {COLORS, IMG} from '../theme';
import {EASE} from '../lib/camera';
import type {Mask} from '../scenario';

/**
 * 遮罩滑入：一块与底色相同的暗块从左向右"拉帘"，把不该入画的部分盖掉。
 * 用途是合法收窄画面（例如只留某次会话可自证的那一块），不修改截图内容本身。
 */
export const MaskLayer = ({mask}: {mask: Mask}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [mask.delay ?? 0, (mask.delay ?? 0) + 22], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (p <= 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: mask.x,
        top: mask.y,
        width: mask.w * p,
        height: mask.h,
        background: mask.color ?? COLORS.bgDeep,
        boxShadow: p < 1 ? `14px 0 40px ${COLORS.bgDeep}` : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 2,
          height: IMG.h,
          background: `linear-gradient(180deg, transparent, ${COLORS.cyan}88, transparent)`,
          opacity: p < 1 ? 1 : 0,
        }}
      />
    </div>
  );
};
