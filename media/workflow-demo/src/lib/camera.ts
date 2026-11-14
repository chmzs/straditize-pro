import {Easing, interpolate, useCurrentFrame} from 'remotion';

/** 运镜关键帧：at=镜内帧，x/y=取景中心（素材像素坐标），scale=推近倍率。 */
export type CamKey = {at: number; x: number; y: number; scale: number};

/** 全片统一缓动：缓入缓出，不用线性。 */
export const EASE = Easing.bezier(0.33, 0, 0.15, 1);

export type CamState = {scale: number; tx: number; ty: number};

/**
 * 把关键帧插值成「相机」变换。
 * 变换约定（CSS 独立 transform 属性：先 translate 后 scale，origin 0 0）：
 *   p_screen = p_src * scale + t
 * 因此把取景中心 c 映射到画面中心：t = imgW/2 - c.x * scale。
 * 取景中心会被钳制，保证可视窗口不越出素材边界。
 */
export const useCamera = (keys: CamKey[], imgW: number, imgH: number): CamState => {
  const frame = useCurrentFrame();

  let i = 0;
  while (i < keys.length - 2 && frame >= keys[i + 1].at) {
    i += 1;
  }
  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const span = Math.max(1, b.at - a.at);

  const p = interpolate(frame, [a.at, a.at + span], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = a.scale + (b.scale - a.scale) * p;
  let cx = a.x + (b.x - a.x) * p;
  let cy = a.y + (b.y - a.y) * p;

  const halfW = imgW / (2 * scale);
  const halfH = imgH / (2 * scale);
  cx = Math.min(Math.max(cx, halfW), imgW - halfW);
  cy = Math.min(Math.max(cy, halfH), imgH - halfH);

  return {
    scale,
    tx: imgW / 2 - cx * scale,
    ty: imgH / 2 - cy * scale,
  };
};
